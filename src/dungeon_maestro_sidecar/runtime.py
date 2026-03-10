from __future__ import annotations

from dataclasses import dataclass
import threading
from typing import Callable

from .audio import MicrophoneAudioSource
from .config import load_pipeline_config
from .discord_bot import DiscordVoiceBridge
from .persistence import SessionStateStore
from .playback import LocalAudioPlayer
from .session import PipelineEvent, PipelineSession
from .tracks import YtDlpTrackResolver
from .transcription import FasterWhisperTranscriber, NullTranscriber
from .vad import SileroVadGate


EventCallback = Callable[[str, dict[str, object]], None]


@dataclass(slots=True)
class RuntimeOptions:
    config_path: str
    starting_collection: str | None = None
    session_state_path: str | None = None
    resume: bool = False
    input_device: str | int | None = None
    no_transcription: bool = False
    no_auto_play: bool = False
    discord_token: str | None = None
    discord_guild_id: int | None = None
    discord_voice_channel_id: int | None = None


class LiveSessionRuntime:
    def __init__(self, options: RuntimeOptions, on_event: EventCallback | None = None) -> None:
        self._options = options
        self._on_event = on_event
        self._session: PipelineSession | None = None
        self._audio_source: MicrophoneAudioSource | None = None
        self._worker: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._player: LocalAudioPlayer | None = None
        self._discord_bridge: DiscordVoiceBridge | None = None
        self._status: dict[str, object] = {
            "sessionRunning": False,
            "activeCollection": None,
            "currentTrackTitle": "No track active",
            "currentTrackIndex": None,
            "lastTranscript": "",
            "lastError": "",
        }

    def start(self) -> dict[str, object]:
        settings, collections = load_pipeline_config(self._options.config_path)
        if self._options.input_device is not None:
            settings.input_device = self._options.input_device

        session_state_path = self._options.session_state_path
        state_store = SessionStateStore(session_state_path) if session_state_path else None
        resumed_state: dict[str, object] | None = None
        if self._options.resume and state_store is not None and state_store.exists():
            resumed_state = state_store.load()

        speech_gate = SileroVadGate(settings.sample_rate_hz)
        transcriber = NullTranscriber() if self._options.no_transcription else FasterWhisperTranscriber(settings.whisper_model)
        resolver = YtDlpTrackResolver()

        self._session = PipelineSession(
            settings,
            collections,
            speech_gate,
            transcriber,
            resolver,
            state_store=state_store,
            resumed_state=resumed_state,
        )

        if self._options.starting_collection and self._options.starting_collection in {item.collection_id for item in collections}:
            self._session.state.active_collection_id = self._options.starting_collection

        self._audio_source = MicrophoneAudioSource(settings)
        self._status["sessionRunning"] = True
        self._status["activeCollection"] = self._session.state.active_collection_id
        self._emit(
            "session_ready",
            {
                "collections": [
                    {
                        "collection_id": item.collection_id,
                        "name": item.name,
                        "keywords": item.keywords,
                        "track_count": len(item.tracks),
                    }
                    for item in collections
                ],
                "active_collection": self._session.state.active_collection_id,
            },
        )

        for event in self._session.warm_resolve_tracks():
            self._emit("resolve_event", {"event_type": event.event_type, "message": event.message})

        if not self._options.no_auto_play:
            self._player = LocalAudioPlayer()

        if self._options.discord_voice_channel_id is not None:
            self._discord_bridge = DiscordVoiceBridge(
                token=self._options.discord_token or "",
                guild_id=self._options.discord_guild_id,
                voice_channel_id=self._options.discord_voice_channel_id,
            )
            self._discord_bridge.start()
            self._emit("discord_connected", {"voice_channel_id": self._options.discord_voice_channel_id})

        self.skip_track(initial=True)

        self._stop_event.clear()
        self._worker = threading.Thread(target=self._run_loop, daemon=True, name="dungeon-maestro-runtime")
        self._worker.start()
        return self.status_snapshot()

    def stop(self) -> dict[str, object]:
        self._stop_event.set()
        if self._worker is not None:
            self._worker.join(timeout=5)
            self._worker = None
        if self._discord_bridge is not None:
            self._discord_bridge.stop()
            self._discord_bridge = None
        if self._player is not None:
            self._player.stop()
            self._player = None
        self._status.update(
            {
                "sessionRunning": False,
                "currentTrackTitle": "No track active",
                "currentTrackIndex": None,
            }
        )
        self._emit("session_ended", self.status_snapshot())
        return self.status_snapshot()

    def skip_track(self, initial: bool = False) -> dict[str, object]:
        if self._session is None:
            raise RuntimeError("Session is not running")
        track = self._session.next_track_for_collection(self._session.state.active_collection_id)
        if track is None:
            raise RuntimeError("No resolved tracks are available for the active collection")

        collection_id = self._session.state.active_collection_id
        track_index = self._session.state.active_track_index
        self._status.update(
            {
                "activeCollection": collection_id,
                "currentTrackTitle": track.title,
                "currentTrackIndex": track_index,
            }
        )
        if self._player is not None:
            self._player.play(track)
        if self._discord_bridge is not None:
            self._discord_bridge.play(track)
        self._emit(
            "track_started",
            {
                "collection": collection_id,
                "track_index": track_index,
                "title": track.title,
                "duration_seconds": track.duration_seconds,
                "initial": initial,
            },
        )
        return self.status_snapshot()

    def status_snapshot(self) -> dict[str, object]:
        return dict(self._status)

    def _run_loop(self) -> None:
        assert self._audio_source is not None
        assert self._session is not None
        try:
            for chunk in self._audio_source.stream_chunks(stop_event=self._stop_event):
                if self._stop_event.is_set():
                    break
                for event in self._session.process_chunk(chunk):
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
            self._status["activeCollection"] = event.collection_id
            self._emit(
                "keyword_match",
                {
                    "collection": event.collection_id,
                    "message": event.message,
                },
            )
            return

        if event.event_type == "selected_track" and event.track is not None:
            self._status["activeCollection"] = event.collection_id
            self._status["currentTrackTitle"] = event.track.title
            self._status["currentTrackIndex"] = event.track_index
            if self._player is not None:
                self._player.play(event.track)
            if self._discord_bridge is not None:
                self._discord_bridge.play(event.track)
            self._emit(
                "track_started",
                {
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