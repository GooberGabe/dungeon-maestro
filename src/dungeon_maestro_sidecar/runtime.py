from __future__ import annotations

from dataclasses import dataclass
import threading
from typing import Callable

from .audio import MicrophoneAudioSource
from .config import load_pipeline_config
from .discord_bot import DiscordVoiceBridge
from .persistence import SessionStateStore
from .playback import LocalAudioPlayer, PlaybackController
from .session import PipelineEvent, PipelineSession
from .tracks import YtDlpTrackResolver
from .transcription import FasterWhisperTranscriber, NullTranscriber, normalize_transcription_profile
from .vad import SileroVadGate


EventCallback = Callable[[str, dict[str, object]], None]


def normalize_output_mode(output_mode: str | None) -> str:
    candidate = (output_mode or "local").strip().lower()
    if candidate not in {"local", "discord"}:
        raise RuntimeError("output_mode must be either 'local' or 'discord'")
    return candidate


@dataclass(slots=True)
class RuntimeOptions:
    config_path: str
    starting_collection: str | None = None
    starting_soundscape: str | None = None
    session_state_path: str | None = None
    resume: bool = False
    input_device: str | int | None = None
    no_transcription: bool = False
    transcription_profile: str | None = None
    enable_transition_proposals: bool | None = None
    transition_popup_timeout: int | None = None
    volume_percent: int | None = None
    muted: bool | None = None
    paused: bool | None = None
    output_mode: str | None = None
    no_auto_play: bool = False
    discord_token: str | None = None
    discord_guild_id: int | None = None
    discord_voice_channel_id: int | None = None
    crossfade_enabled: bool | None = None
    crossfade_duration_seconds: float | None = None

    def __post_init__(self) -> None:
        if self.starting_soundscape is None:
            self.starting_soundscape = self.starting_collection
        if self.starting_collection is None:
            self.starting_collection = self.starting_soundscape


class LiveSessionRuntime:
    def __init__(self, options: RuntimeOptions, on_event: EventCallback | None = None) -> None:
        self._options = options
        self._on_event = on_event
        self._session: PipelineSession | None = None
        self._audio_source: MicrophoneAudioSource | None = None
        self._worker: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._playback_controller = PlaybackController(
            volume_percent=options.volume_percent if options.volume_percent is not None else 100,
            muted=options.muted if options.muted is not None else False,
        )
        self._player: LocalAudioPlayer | None = None
        self._discord_bridge: DiscordVoiceBridge | None = None
        self._current_track = None
        self._session_lock = threading.RLock()
        playback_snapshot = self._playback_controller.snapshot()
        initial_output_mode = normalize_output_mode(options.output_mode)
        self._options.output_mode = initial_output_mode
        self._crossfade_enabled = bool(options.crossfade_enabled) if options.crossfade_enabled is not None else False
        self._crossfade_duration = float(options.crossfade_duration_seconds) if options.crossfade_duration_seconds is not None else 3.0
        self._loop_enabled = False
        self._crossfade_pause_enabled = False
        self._status: dict[str, object] = {
            "sessionRunning": False,
            "activeSoundscape": None,
            "activeCollection": None,
            "currentTrackTitle": "No track active",
            "currentTrackIndex": None,
            "lastTranscript": "",
            "lastError": "",
            "pendingTransition": None,
            "transcriptionProfile": None,
            "outputMode": initial_output_mode,
            "volumePercent": playback_snapshot["volume_percent"],
            "playbackMuted": playback_snapshot["muted"],
            "playbackPaused": bool(options.paused),
            "crossfadeEnabled": self._crossfade_enabled,
            "crossfadeDurationSeconds": self._crossfade_duration,
            "loopEnabled": self._loop_enabled,
            "crossfadePauseEnabled": self._crossfade_pause_enabled,
        }

    def start(self) -> dict[str, object]:
        settings, soundscapes = load_pipeline_config(self._options.config_path)
        if self._options.input_device is not None:
            settings.input_device = self._options.input_device
        if self._options.transcription_profile is not None:
            settings.transcription_profile = normalize_transcription_profile(self._options.transcription_profile)
        if self._options.enable_transition_proposals is not None:
            settings.enable_transition_proposals = self._options.enable_transition_proposals
        if self._options.transition_popup_timeout is not None:
            if self._options.transition_popup_timeout <= 0:
                raise RuntimeError("transition_popup_timeout must be greater than 0")
            settings.transition_popup_timeout = self._options.transition_popup_timeout

        session_state_path = self._options.session_state_path
        state_store = SessionStateStore(session_state_path) if session_state_path else None
        resumed_state: dict[str, object] | None = None
        if self._options.resume and state_store is not None and state_store.exists():
            resumed_state = state_store.load()

        speech_gate = SileroVadGate(settings.sample_rate_hz)
        transcriber = NullTranscriber() if self._options.no_transcription else FasterWhisperTranscriber(
            settings.whisper_model,
            settings.transcription_profile,
        )
        resolver = YtDlpTrackResolver()

        self._session = PipelineSession(
            settings,
            soundscapes,
            speech_gate,
            transcriber,
            resolver,
            state_store=state_store,
            resumed_state=resumed_state,
        )

        starting_soundscape = self._options.starting_soundscape or self._options.starting_collection
        if starting_soundscape and starting_soundscape in {item.soundscape_id for item in soundscapes}:
            self._session.state.active_soundscape_id = starting_soundscape

        self._audio_source = MicrophoneAudioSource(settings)
        self._status["sessionRunning"] = True
        self._status["activeSoundscape"] = self._session.state.active_soundscape_id
        self._status["activeCollection"] = self._session.state.active_collection_id
        self._status["pendingTransition"] = self._session.pending_transition_payload()
        self._status["transcriptionProfile"] = settings.transcription_profile
        self._emit(
            "session_ready",
            {
                "soundscapes": [
                    {
                        "soundscape_id": item.soundscape_id,
                        "name": item.name,
                        "keywords": item.keywords,
                        "track_count": len(item.tracks),
                    }
                    for item in soundscapes
                ],
                "collections": [
                    {
                        "collection_id": item.collection_id,
                        "name": item.name,
                        "keywords": item.keywords,
                        "track_count": len(item.tracks),
                    }
                    for item in soundscapes
                ],
                "active_soundscape": self._session.state.active_soundscape_id,
                "active_collection": self._session.state.active_collection_id,
            },
        )

        for event in self._session.warm_resolve_tracks():
            self._emit("resolve_event", {"event_type": event.event_type, "message": event.message})

        self._configure_output_mode(self._options.output_mode, replay_current_track=False)

        if starting_soundscape is not None:
            self.skip_track(initial=True)
        if self._status["playbackPaused"]:
            self._apply_pause_state(True)

        self._stop_event.clear()
        self._worker = threading.Thread(target=self._run_loop, daemon=True, name="dungeon-maestro-runtime")
        self._worker.start()
        return self.status_snapshot()

    def update_output_mode(self, output_mode: str) -> dict[str, object]:
        next_mode = normalize_output_mode(output_mode)
        with self._session_lock:
            if self._session is None:
                raise RuntimeError("Session is not running")
            self._configure_output_mode(next_mode, replay_current_track=True)

        self._emit("output_mode_updated", {"outputMode": self._status["outputMode"]})
        return self.status_snapshot()

    def update_playback_settings(
        self,
        *,
        volume_percent: int | None = None,
        muted: bool | None = None,
        paused: bool | None = None,
        crossfade_enabled: bool | None = None,
        crossfade_duration_seconds: float | None = None,
        loop_enabled: bool | None = None,
        crossfade_pause_enabled: bool | None = None,
    ) -> dict[str, object]:
        if volume_percent is not None:
            self._playback_controller.set_volume_percent(volume_percent)
            self._options.volume_percent = int(volume_percent)
        if muted is not None:
            self._playback_controller.set_muted(muted)
            self._options.muted = bool(muted)
        if paused is not None:
            self._options.paused = bool(paused)
            self._status["playbackPaused"] = bool(paused)
            self._apply_pause_state(bool(paused))
        if crossfade_enabled is not None:
            self._crossfade_enabled = bool(crossfade_enabled)
            self._status["crossfadeEnabled"] = self._crossfade_enabled
            if self._player is not None:
                self._player.crossfade_enabled = self._crossfade_enabled
        if crossfade_duration_seconds is not None:
            self._crossfade_duration = max(0.5, min(15.0, float(crossfade_duration_seconds)))
            self._status["crossfadeDurationSeconds"] = self._crossfade_duration
            if self._player is not None:
                self._player.crossfade_duration = self._crossfade_duration
        if loop_enabled is not None:
            self._loop_enabled = bool(loop_enabled)
            self._status["loopEnabled"] = self._loop_enabled
            if self._player is not None:
                self._player.loop_enabled = self._loop_enabled
        if crossfade_pause_enabled is not None:
            self._crossfade_pause_enabled = bool(crossfade_pause_enabled)
            self._status["crossfadePauseEnabled"] = self._crossfade_pause_enabled
            if self._player is not None:
                self._player.crossfade_pause = self._crossfade_pause_enabled

        playback_snapshot = self._playback_controller.snapshot()
        self._status["volumePercent"] = playback_snapshot["volume_percent"]
        self._status["playbackMuted"] = playback_snapshot["muted"]
        self._emit(
            "playback_settings_updated",
            {
                "volumePercent": playback_snapshot["volume_percent"],
                "playbackMuted": playback_snapshot["muted"],
                "playbackPaused": self._status["playbackPaused"],
                "crossfadeEnabled": self._status["crossfadeEnabled"],
                "crossfadeDurationSeconds": self._status["crossfadeDurationSeconds"],
                "loopEnabled": self._status["loopEnabled"],
                "crossfadePauseEnabled": self._status["crossfadePauseEnabled"],
            },
        )
        return self.status_snapshot()

    def seek_track(self, position_seconds: float) -> dict[str, object]:
        with self._session_lock:
            if self._session is None:
                raise RuntimeError("Session is not running")
        if self._player is not None:
            self._player.seek(position_seconds)
        self._emit("track_seeked", {"position_seconds": position_seconds})
        return self.status_snapshot()

    def update_session_settings(
        self,
        *,
        transcription_enabled: bool | None = None,
        transcription_profile: str | None = None,
        enable_transition_proposals: bool | None = None,
        transition_popup_timeout: int | None = None,
    ) -> dict[str, object]:
        if self._session is None:
            raise RuntimeError("Session is not running")

        with self._session_lock:
            normalized_profile = None
            if transcription_profile is not None:
                normalized_profile = normalize_transcription_profile(transcription_profile)
                self._options.transcription_profile = normalized_profile

            if transcription_enabled is not None:
                self._options.no_transcription = not transcription_enabled
                if transcription_enabled:
                    active_profile = normalized_profile or self._session.settings.transcription_profile
                    self._session.set_transcriber(FasterWhisperTranscriber(self._session.settings.whisper_model, active_profile))
                else:
                    self._session.set_transcriber(NullTranscriber())
            elif normalized_profile is not None and not self._options.no_transcription:
                self._session.set_transcriber(FasterWhisperTranscriber(self._session.settings.whisper_model, normalized_profile))

            if enable_transition_proposals is not None:
                self._options.enable_transition_proposals = enable_transition_proposals

            if transition_popup_timeout is not None:
                self._options.transition_popup_timeout = transition_popup_timeout

            events = self._session.update_runtime_settings(
                transcription_profile=normalized_profile,
                enable_transition_proposals=enable_transition_proposals,
                transition_popup_timeout=transition_popup_timeout,
            )

            self._status["transcriptionProfile"] = self._session.settings.transcription_profile

        for event in events:
            self._handle_event(event)

        pending_payload = self._session.pending_transition_payload()
        self._status["pendingTransition"] = (
            {
                "keyword": pending_payload.get("keyword"),
                "targetSoundscape": pending_payload.get("target_soundscape", pending_payload.get("target_collection")),
                "targetCollection": pending_payload.get("target_collection"),
                "displayName": pending_payload.get("display_name"),
                "expiresAtEpoch": pending_payload.get("expires_at_epoch"),
            }
            if pending_payload is not None
            else None
        )
        self._emit(
            "session_settings_updated",
            {
                "transcription_enabled": not self._options.no_transcription,
                "transcription_profile": self._session.settings.transcription_profile,
                "enable_transition_proposals": self._session.settings.enable_transition_proposals,
                "transition_popup_timeout": self._session.settings.transition_popup_timeout,
            },
        )
        return self.status_snapshot()

    def stop(self) -> dict[str, object]:
        self._stop_event.set()
        if self._worker is not None:
            self._worker.join(timeout=5)
            self._worker = None
        if self._session is not None:
            self._session.close()
            self._session = None
        if self._discord_bridge is not None:
            self._discord_bridge.stop()
            self._discord_bridge = None
        if self._player is not None:
            self._player.stop()
            self._player = None
        with self._session_lock:
            self._current_track = None
        self._status.update(
            {
                "sessionRunning": False,
                "currentTrackTitle": "No track active",
                "currentTrackIndex": None,
                "pendingTransition": None,
            }
        )
        self._emit("session_ended", self.status_snapshot())
        return self.status_snapshot()

    def skip_track(self, initial: bool = False) -> dict[str, object]:
        with self._session_lock:
            if self._session is None:
                raise RuntimeError("Session is not running")
            track = self._session.next_track_for_collection(self._session.state.active_collection_id)
            if track is None:
                raise RuntimeError("No resolved tracks are available for the active collection")

            soundscape_id = self._session.state.active_soundscape_id
            track_index = self._session.state.active_track_index
        self._status.update(
            {
                "activeSoundscape": soundscape_id,
                "activeCollection": soundscape_id,
                "currentTrackTitle": track.title,
                "currentTrackIndex": track_index,
                "pendingTransition": None,
            }
        )
        with self._session_lock:
            self._current_track = track
        self._play_track_on_active_output(track)
        if self._status["playbackPaused"]:
            self._apply_pause_state(True)
        self._emit(
            "track_started",
            {
                "soundscape": soundscape_id,
                "collection": soundscape_id,
                "track_index": track_index,
                "title": track.title,
                "duration_seconds": track.duration_seconds,
                "initial": initial,
            },
        )
        return self.status_snapshot()

    def status_snapshot(self) -> dict[str, object]:
        return dict(self._status)

    def play_track_at_index(self, collection_id: str, track_index: int) -> dict[str, object]:
        with self._session_lock:
            if self._session is None:
                raise RuntimeError("Session is not running")
            result = self._session.track_at_index(collection_id, track_index)
            if result is None:
                raise RuntimeError("Invalid collection or track index")
            track, resolved_index = result
        self._status.update(
            {
                "activeSoundscape": collection_id,
                "activeCollection": collection_id,
                "currentTrackTitle": track.title,
                "currentTrackIndex": resolved_index,
                "pendingTransition": None,
            }
        )
        with self._session_lock:
            self._current_track = track
        self._play_track_on_active_output(track)
        if self._status["playbackPaused"]:
            self._apply_pause_state(True)
        self._emit(
            "track_started",
            {
                "soundscape": collection_id,
                "collection": collection_id,
                "track_index": resolved_index,
                "title": track.title,
                "duration_seconds": track.duration_seconds,
                "initial": False,
            },
        )
        return self.status_snapshot()

    def switch_collection(self, collection_id: str) -> dict[str, object]:
        with self._session_lock:
            if self._session is None:
                raise RuntimeError("Session is not running")
            self._session.state.active_collection_id = collection_id
            track = self._session.next_track_for_collection(collection_id)
            if track is None:
                raise RuntimeError("No resolved tracks are available for this collection")
            track_index = self._session.state.active_track_index
        self._status.update(
            {
                "activeSoundscape": collection_id,
                "activeCollection": collection_id,
                "currentTrackTitle": track.title,
                "currentTrackIndex": track_index,
                "pendingTransition": None,
            }
        )
        with self._session_lock:
            self._current_track = track
        self._play_track_on_active_output(track)
        if self._status["playbackPaused"]:
            self._apply_pause_state(True)
        self._emit(
            "track_started",
            {
                "soundscape": collection_id,
                "collection": collection_id,
                "track_index": track_index,
                "title": track.title,
                "duration_seconds": track.duration_seconds,
                "initial": False,
            },
        )
        return self.status_snapshot()

    def approve_transition(self) -> dict[str, object]:
        with self._session_lock:
            if self._session is None:
                raise RuntimeError("Session is not running")
            events = self._session.approve_pending_transition()
        for event in events:
            self._handle_event(event)
        return self.status_snapshot()

    def dismiss_transition(self) -> dict[str, object]:
        with self._session_lock:
            if self._session is None:
                raise RuntimeError("Session is not running")
            events = self._session.dismiss_pending_transition()
        for event in events:
            self._handle_event(event)
        return self.status_snapshot()

    def _run_loop(self) -> None:
        assert self._audio_source is not None
        assert self._session is not None
        try:
            for chunk in self._audio_source.stream_chunks(stop_event=self._stop_event):
                if self._stop_event.is_set():
                    break
                with self._session_lock:
                    poll_events = self._session.poll()
                    chunk_events = self._session.process_chunk(chunk)
                for event in poll_events:
                    self._handle_event(event)
                for event in chunk_events:
                    self._handle_event(event)
                if self._player is not None and self._player.last_error:
                    self._status["lastError"] = self._player.last_error
                    self._emit("error", {"code": "local_playback", "message": self._player.last_error})
                    self._player.stop()
        except Exception as exc:
            self._status["lastError"] = str(exc)
            self._emit("error", {"code": "runtime", "message": str(exc)})

    def _handle_event(self, event: PipelineEvent) -> None:
        if event.event_type == "transcript":
            self._status["lastTranscript"] = event.message
            self._emit("transcript", {"text": event.message})
            return

        if event.event_type == "keyword_match":
            self._status["activeSoundscape"] = event.soundscape_id
            self._status["activeCollection"] = event.collection_id
            self._emit(
                "keyword_match",
                {
                    "soundscape": event.soundscape_id,
                    "collection": event.collection_id,
                    "message": event.message,
                },
            )
            return

        if event.event_type == "transition_pending":
            pending_payload = self._session.pending_transition_payload() if self._session is not None else None
            self._status["pendingTransition"] = {
                "keyword": event.keyword,
                "targetSoundscape": event.soundscape_id,
                "targetCollection": event.collection_id,
                "displayName": event.soundscape_name,
                "expiresAtEpoch": pending_payload.get("expires_at_epoch") if pending_payload is not None else None,
            }
            self._emit(
                "transition_pending",
                {
                    "keyword": event.keyword,
                    "target_soundscape": event.soundscape_id,
                    "target_collection": event.collection_id,
                    "display_name": event.soundscape_name,
                    "expires_at_epoch": pending_payload.get("expires_at_epoch") if pending_payload is not None else None,
                },
            )
            return

        if event.event_type in {"transition_dismissed", "transition_approved"}:
            self._status["pendingTransition"] = None
            self._emit(event.event_type, {"message": event.message})
            return

        if event.event_type == "selected_track" and event.track is not None:
            self._status["activeSoundscape"] = event.soundscape_id
            self._status["activeCollection"] = event.collection_id
            self._status["currentTrackTitle"] = event.track.title
            self._status["currentTrackIndex"] = event.track_index
            self._status["pendingTransition"] = None
            with self._session_lock:
                self._current_track = event.track
            self._play_track_on_active_output(event.track)
            self._emit(
                "track_started",
                {
                    "soundscape": event.soundscape_id,
                    "collection": event.collection_id,
                    "track_index": event.track_index,
                    "title": event.track.title,
                    "duration_seconds": event.track.duration_seconds,
                    "initial": False,
                },
            )
            return

        if event.event_type == "cooldown_started":
            self._emit("cooldown_started", {"message": event.message})
            return

        self._emit("session_event", {"event_type": event.event_type, "message": event.message})

    def _emit(self, event_name: str, payload: dict[str, object]) -> None:
        if self._on_event is not None:
            self._on_event(event_name, payload)

    def _apply_pause_state(self, paused: bool) -> None:
        if self._player is not None:
            if paused:
                self._player.pause()
            else:
                self._player.resume()
        if self._discord_bridge is not None:
            if paused:
                self._discord_bridge.pause()
            else:
                self._discord_bridge.resume()

    def _configure_output_mode(self, output_mode: str, replay_current_track: bool) -> None:
        next_mode = normalize_output_mode(output_mode)
        with self._session_lock:
            current_track = self._current_track

        if next_mode == "discord":
            next_bridge = self._build_discord_bridge()
            if replay_current_track and current_track is not None:
                try:
                    next_bridge.play(current_track)
                except Exception:
                    next_bridge.stop()
                    raise

            if self._player is not None:
                self._player.stop()
                self._player = None
            if self._discord_bridge is not None:
                self._discord_bridge.stop()
            self._discord_bridge = next_bridge
            self._status["outputMode"] = "discord"
            self._emit("discord_connected", {"voice_channel_id": self._options.discord_voice_channel_id})
        else:
            next_player = self._player if self._player is not None else LocalAudioPlayer(
                playback_controller=self._playback_controller,
                crossfade_enabled=self._crossfade_enabled,
                crossfade_duration_seconds=self._crossfade_duration,
                on_track_finished=self._handle_output_track_finished,
            )
            if replay_current_track and current_track is not None:
                next_player.play(current_track)

            if self._discord_bridge is not None:
                self._discord_bridge.stop()
                self._discord_bridge = None
            self._player = next_player
            self._status["outputMode"] = "local"

        self._options.output_mode = next_mode
        if self._status["playbackPaused"]:
            self._apply_pause_state(True)

    def _build_discord_bridge(self) -> DiscordVoiceBridge:
        if self._options.discord_voice_channel_id is None:
            raise RuntimeError("Discord output requires a selected voice channel")
        if not (self._options.discord_token or "").strip():
            raise RuntimeError("Discord output requires a bot token")

        bridge = DiscordVoiceBridge(
            token=self._options.discord_token or "",
            guild_id=self._options.discord_guild_id,
            voice_channel_id=self._options.discord_voice_channel_id,
            playback_controller=self._playback_controller,
            on_track_finished=self._handle_output_track_finished,
        )
        bridge.start()
        return bridge

    def _play_track_on_active_output(self, track) -> None:
        if self._status["outputMode"] == "discord":
            if self._discord_bridge is not None:
                self._discord_bridge.play(track)
            return

        if self._player is not None:
            self._player.play(track)

    def _handle_output_track_finished(self, track) -> None:
        with self._session_lock:
            if self._session is None or self._current_track is not track:
                return

        try:
            self.skip_track()
        except RuntimeError:
            return
