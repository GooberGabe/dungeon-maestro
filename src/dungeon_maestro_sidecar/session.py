from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from collections import deque
from dataclasses import dataclass
from datetime import datetime
import threading
import time
from typing import Protocol

import numpy as np

from .matching import KeywordMatcher
from .models import PendingTransition, PipelineSettings, PipelineState, ResolvedTrack, Soundscape
from .persistence import SessionStateStore
from .ring_buffer import AudioRingBuffer


class TrackResolver(Protocol):
    def resolve(self, source: str) -> ResolvedTrack:
        ...


class Transcriber(Protocol):
    def transcribe(self, audio_chunk):
        ...


class SpeechGate(Protocol):
    def is_speech(self, chunk) -> bool:
        ...


@dataclass(slots=True)
class PipelineEvent:
    event_type: str
    message: str
    track: ResolvedTrack | None = None
    collection_id: str | None = None
    track_index: int | None = None
    keyword: str | None = None
    collection_name: str | None = None

    @property
    def soundscape_id(self) -> str | None:
        return self.collection_id

    @property
    def soundscape_name(self) -> str | None:
        return self.collection_name


class PipelineSession:
    def __init__(
        self,
        settings: PipelineSettings,
        soundscapes: list[Soundscape],
        speech_gate: SpeechGate,
        transcriber: Transcriber,
        track_resolver: TrackResolver,
        state_store: SessionStateStore | None = None,
        resumed_state: dict[str, object] | None = None,
    ) -> None:
        self._settings = settings
        self._soundscapes = soundscapes
        self._soundscapes_by_id = {soundscape.soundscape_id: soundscape for soundscape in soundscapes}
        self._speech_gate = speech_gate
        self._transcriber = transcriber
        self._track_resolver = track_resolver
        self._state_store = state_store
        self._matcher = KeywordMatcher(soundscapes)
        default_soundscape_id = settings.default_soundscape if settings.default_soundscape in self._soundscapes_by_id else soundscapes[0].soundscape_id
        self._state = PipelineState(
            session_id=datetime.now().isoformat(timespec="seconds"),
            active_soundscape_id=default_soundscape_id,
        )
        self._ring_buffer = AudioRingBuffer(settings.sample_rate_hz * settings.ring_buffer_seconds)
        self._chunks_since_transcription = 0
        self._transcription_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dungeon-maestro-transcribe")
        self._transcription_request_serial = 0
        self._transcriber_generation = 0
        self._pending_transcription_request: tuple[int, int, np.ndarray] | None = None
        self._transcription_future: Future[tuple[int, int, str]] | None = None
        self._resolve_lock = threading.Lock()
        self._resolve_cv = threading.Condition(self._resolve_lock)
        self._resolve_queue: deque[str] = deque()
        self._resolve_worker: threading.Thread | None = None
        self._resolve_stop = threading.Event()
        if resumed_state is not None:
            self._restore_state(resumed_state)
        self._initialize_resolve_state()
        self._persist_state()

    @property
    def state(self) -> PipelineState:
        return self._state

    @property
    def settings(self) -> PipelineSettings:
        return self._settings

    def set_transcriber(self, transcriber: Transcriber) -> None:
        self._transcriber = transcriber
        self._transcriber_generation += 1
        self._pending_transcription_request = None

    def close(self) -> None:
        self._resolve_stop.set()
        with self._resolve_lock:
            self._resolve_cv.notify_all()
        if self._resolve_worker is not None:
            self._resolve_worker.join(timeout=2)
        self._resolve_worker = None
        self._pending_transcription_request = None
        self._transcription_executor.shutdown(wait=False, cancel_futures=True)

    def start_background_resolve(self, soundscape_id: str | None) -> None:
        if soundscape_id is not None and soundscape_id not in self._soundscapes_by_id:
            return
        self._ensure_resolve_worker()
        with self._resolve_lock:
            if soundscape_id is not None and self._has_unresolved(soundscape_id):
                if soundscape_id not in self._resolve_queue:
                    self._resolve_queue.append(soundscape_id)
            self._resolve_cv.notify_all()

    def update_runtime_settings(
        self,
        *,
        transcription_profile: str | None = None,
        enable_transition_proposals: bool | None = None,
        transition_popup_timeout: int | None = None,
    ) -> list[PipelineEvent]:
        events: list[PipelineEvent] = []

        if transcription_profile is not None:
            self._settings.transcription_profile = transcription_profile

        if enable_transition_proposals is not None:
            self._settings.enable_transition_proposals = enable_transition_proposals
            if not enable_transition_proposals and self._state.pending_transition is not None:
                events.extend(self._dismiss_pending_transition(reason="settings_updated"))

        if transition_popup_timeout is not None:
            if transition_popup_timeout <= 0:
                raise RuntimeError("transition_popup_timeout must be greater than 0")
            self._settings.transition_popup_timeout = transition_popup_timeout
            if self._state.pending_transition is not None:
                self._state.pending_transition.expires_at_epoch = time.time() + transition_popup_timeout

        self._persist_state()
        return events

    def in_cooldown(self) -> bool:
        return self._state.cooldown_until_epoch > time.time()

    def has_pending_transition(self) -> bool:
        return self._state.pending_transition is not None

    def pending_transition_payload(self) -> dict[str, object] | None:
        pending = self._state.pending_transition
        if pending is None:
            return None
        return {
            "keyword": pending.keyword,
            "target_soundscape": pending.soundscape_id,
            "target_collection": pending.collection_id,
            "display_name": pending.soundscape_name,
            "expires_at_epoch": pending.expires_at_epoch,
        }

    def warm_resolve_tracks(self) -> list[PipelineEvent]:
        events: list[PipelineEvent] = []
        self._initialize_resolve_state()
        for soundscape in self._soundscapes:
            if not soundscape.tracks:
                continue
            resolved = self._resolve_track_at_index(soundscape.soundscape_id, 0)
            if resolved is None:
                source = soundscape.tracks[0].source
                events.append(
                    PipelineEvent(
                        event_type="resolve_error",
                        message=f"[{soundscape.soundscape_id}] failed to resolve {source!r}",
                    )
                )
                continue
            events.append(
                PipelineEvent(
                    event_type="track_resolved",
                    message=(
                        f"[{soundscape.soundscape_id}] {resolved.title}"
                        + (f" ({resolved.duration_seconds:.0f}s)" if resolved.duration_seconds else "")
                    ),
                )
            )
        self._persist_state()
        return events

    def next_track_for_soundscape(self, soundscape_id: str) -> ResolvedTrack | None:
        track, track_index = self._resolve_next_track(soundscape_id)
        if track is None:
            return None
        self._append_log(
            "track_selected",
            soundscape=soundscape_id,
            collection=soundscape_id,
            track_index=track_index,
            title=track.title,
        )
        self._persist_state()
        return track

    def next_track_for_collection(self, collection_id: str) -> ResolvedTrack | None:
        return self.next_track_for_soundscape(collection_id)

    def track_at_soundscape_index(self, soundscape_id: str, track_index: int) -> tuple[ResolvedTrack, int] | None:
        total = self._soundscape_track_count(soundscape_id)
        if total == 0 or track_index < 0 or track_index >= total:
            return None
        resolved = self._resolve_track_at_index(soundscape_id, track_index)
        if resolved is None:
            return None
        self._state.active_soundscape_id = soundscape_id
        self._state.active_track_index = track_index
        self._state.next_track_index_by_soundscape[soundscape_id] = (track_index + 1) % total
        self._append_log(
            "track_selected",
            soundscape=soundscape_id,
            collection=soundscape_id,
            track_index=track_index,
            title=resolved.title,
        )
        self._persist_state()
        return resolved, track_index

    def track_at_index(self, collection_id: str, track_index: int) -> tuple[ResolvedTrack, int] | None:
        return self.track_at_soundscape_index(collection_id, track_index)

    def _select_next_track_index(self, soundscape_id: str) -> int | None:
        total = self._soundscape_track_count(soundscape_id)
        if total == 0:
            return None

        current_index = self._state.next_track_index_by_soundscape.get(soundscape_id, 0) % total
        self._state.next_track_index_by_soundscape[soundscape_id] = (current_index + 1) % total
        self._state.active_track_index = current_index
        return current_index

    def _resolve_next_track(self, soundscape_id: str) -> tuple[ResolvedTrack | None, int | None]:
        total = self._soundscape_track_count(soundscape_id)
        if total == 0:
            return None, None

        attempts = 0
        while attempts < total:
            track_index = self._select_next_track_index(soundscape_id)
            if track_index is None:
                return None, None
            resolved = self._resolve_track_at_index(soundscape_id, track_index)
            if resolved is not None:
                return resolved, track_index
            attempts += 1
        return None, None

    def _initialize_resolve_state(self) -> None:
        with self._resolve_lock:
            for soundscape in self._soundscapes:
                track_count = len(soundscape.tracks)
                if track_count == 0:
                    continue
                existing = self._state.resolved_tracks.get(soundscape.soundscape_id)
                if existing is None or len(existing) != track_count:
                    self._state.resolved_tracks[soundscape.soundscape_id] = [None] * track_count
                existing_status = self._state.resolved_track_status.get(soundscape.soundscape_id)
                if existing_status is None or len(existing_status) != track_count:
                    self._state.resolved_track_status[soundscape.soundscape_id] = [False] * track_count

    def _ensure_resolve_worker(self) -> None:
        if self._resolve_worker is not None and self._resolve_worker.is_alive():
            return
        self._resolve_worker = threading.Thread(
            target=self._resolve_worker_main,
            daemon=True,
            name="dungeon-maestro-resolve-worker",
        )
        self._resolve_worker.start()

    def _resolve_worker_main(self) -> None:
        while not self._resolve_stop.is_set():
            soundscape_id = None
            with self._resolve_lock:
                while not self._resolve_stop.is_set() and soundscape_id is None:
                    while self._resolve_queue and soundscape_id is None:
                        candidate = self._resolve_queue.popleft()
                        if self._has_unresolved(candidate):
                            soundscape_id = candidate
                    if soundscape_id is None:
                        soundscape_id = self._find_next_unresolved_soundscape()
                    if soundscape_id is None:
                        self._resolve_cv.wait(timeout=0.5)
            if soundscape_id is None:
                continue
            self._resolve_soundscape_tracks(soundscape_id)

    def _resolve_soundscape_tracks(self, soundscape_id: str) -> None:
        total = self._soundscape_track_count(soundscape_id)
        if total == 0:
            return
        for index in range(total):
            if self._resolve_stop.is_set():
                break
            self._resolve_track_at_index(soundscape_id, index)

    def _find_next_unresolved_soundscape(self) -> str | None:
        active_id = self._state.active_soundscape_id
        if active_id and self._has_unresolved(active_id):
            return active_id
        for soundscape in self._soundscapes:
            if self._has_unresolved(soundscape.soundscape_id):
                return soundscape.soundscape_id
        return None

    def _has_unresolved(self, soundscape_id: str) -> bool:
        status_list = self._state.resolved_track_status.get(soundscape_id)
        if not status_list:
            return False
        return any(not item for item in status_list)

    def _resolve_track_at_index(self, soundscape_id: str, track_index: int) -> ResolvedTrack | None:
        if soundscape_id not in self._soundscapes_by_id:
            return None
        self._initialize_resolve_state()

        with self._resolve_lock:
            resolved_list = self._state.resolved_tracks.get(soundscape_id)
            if resolved_list is None:
                return None
            existing = resolved_list[track_index]
            if isinstance(existing, ResolvedTrack):
                return existing

        soundscape = self._soundscapes_by_id[soundscape_id]
        try:
            resolved = self._track_resolver.resolve(soundscape.tracks[track_index].source)
        except Exception:
            return None

        with self._resolve_lock:
            resolved_list = self._state.resolved_tracks.get(soundscape_id)
            status_list = self._state.resolved_track_status.get(soundscape_id)
            if resolved_list is None or status_list is None:
                return resolved
            resolved_list[track_index] = resolved
            status_list[track_index] = True
        return resolved

    def _soundscape_track_count(self, soundscape_id: str) -> int:
        soundscape = self._soundscapes_by_id.get(soundscape_id)
        if soundscape is None:
            return 0
        return len(soundscape.tracks)

    def process_chunk(self, chunk) -> list[PipelineEvent]:
        events = self._collect_transcription_events()
        expired = self._expire_pending_transition_if_needed(reason="timeout")
        if expired is not None:
            events.append(expired)
        if self.has_pending_transition():
            return events
        if self.in_cooldown():
            return events
        if not self._speech_gate.is_speech(chunk):
            return events

        self._state.speech_chunks_seen += 1
        self._ring_buffer.append(chunk)
        self._chunks_since_transcription += 1

        min_window_samples = int(self._settings.sample_rate_hz * self._settings.transcription_window_seconds)
        stride_chunks = max(
            1,
            int((self._settings.sample_rate_hz * self._settings.transcription_stride_seconds) / self._settings.chunk_size),
        )
        if self._ring_buffer.total_samples < min_window_samples:
            return events
        if self._chunks_since_transcription < stride_chunks:
            return events

        self._chunks_since_transcription = 0
        self._queue_transcription_snapshot(self._ring_buffer.snapshot())
        self._dispatch_pending_transcription()

        return events

    def approve_pending_transition(self) -> list[PipelineEvent]:
        pending = self._state.pending_transition
        if pending is None:
            return []

        events: list[PipelineEvent] = []
        self._state.pending_transition = None
        self._state.active_soundscape_id = pending.soundscape_id
        self._append_log(
            "collection_switch",
            keyword=pending.keyword,
            soundscape=pending.soundscape_id,
            collection=pending.collection_id,
            cooldown_seconds=self._settings.cooldown_seconds,
        )
        events.append(
            PipelineEvent(
                event_type="transition_approved",
                message=f"approved transition to {pending.soundscape_name}",
                collection_id=pending.collection_id,
                keyword=pending.keyword,
                collection_name=pending.soundscape_name,
            )
        )
        events.append(
            PipelineEvent(
                event_type="keyword_match",
                message=f"keyword={pending.keyword!r} -> soundscape={pending.soundscape_name}",
                collection_id=pending.collection_id,
                keyword=pending.keyword,
                collection_name=pending.soundscape_name,
            )
        )

        resolved, track_index = self._resolve_next_track(pending.soundscape_id)
        if resolved is not None and track_index is not None:
            events.append(
                PipelineEvent(
                    event_type="selected_track",
                    message=f"next_track={resolved.title}",
                    track=resolved,
                    collection_id=pending.collection_id,
                    track_index=track_index,
                )
            )
            self._append_log(
                "track_selected",
                soundscape=pending.soundscape_id,
                collection=pending.collection_id,
                track_index=track_index,
                title=resolved.title,
            )

        self._state.cooldown_until_epoch = time.time() + self._settings.cooldown_seconds
        events.append(
            PipelineEvent(
                event_type="cooldown_started",
                message=f"seconds={self._settings.cooldown_seconds}",
            )
        )
        self._persist_state()
        return events

    def dismiss_pending_transition(self, reason: str = "manual") -> list[PipelineEvent]:
        return self._dismiss_pending_transition(reason)

    def poll(self) -> list[PipelineEvent]:
        events = self._collect_transcription_events()
        expired = self._expire_pending_transition_if_needed(reason="timeout")
        if expired is not None:
            events.append(expired)
        return events

    def _restore_state(self, payload: dict[str, object]) -> None:
        session_id = payload.get("session_id")
        if isinstance(session_id, str) and session_id.strip():
            self._state.session_id = session_id

        active_soundscape = payload.get("active_soundscape", payload.get("active_collection"))
        if isinstance(active_soundscape, str) and active_soundscape in self._soundscapes_by_id:
            self._state.active_soundscape_id = active_soundscape

        track_index = payload.get("track_index")
        if isinstance(track_index, int) and track_index >= 0:
            self._state.active_track_index = track_index

        next_indexes = payload.get("next_track_index_by_soundscape", payload.get("next_track_index_by_collection"))
        if isinstance(next_indexes, dict):
            restored_indexes: dict[str, int] = {}
            for soundscape_id, index in next_indexes.items():
                if soundscape_id in self._soundscapes_by_id and isinstance(index, int) and index >= 0:
                    restored_indexes[soundscape_id] = index
            self._state.next_track_index_by_soundscape = restored_indexes

        cooldown_remaining = payload.get("cooldown_remaining")
        if isinstance(cooldown_remaining, int) and cooldown_remaining > 0:
            self._state.cooldown_until_epoch = time.time() + cooldown_remaining

        session_log = payload.get("log")
        if isinstance(session_log, list):
            self._state.session_log = [entry for entry in session_log if isinstance(entry, dict)]

    def _append_log(self, event_name: str, **details: object) -> None:
        entry = {
            "time": datetime.now().strftime("%H:%M:%S"),
            "event": event_name,
        }
        entry.update(details)
        self._state.session_log.append(entry)

    def _persist_state(self) -> None:
        if self._state_store is not None:
            self._state_store.save(self._state)

    def _expire_pending_transition_if_needed(self, reason: str) -> PipelineEvent | None:
        pending = self._state.pending_transition
        if pending is None:
            return None
        if pending.expires_at_epoch > time.time():
            return None
        return self._dismiss_pending_transition(reason=reason)[0]

    def _dismiss_pending_transition(self, reason: str) -> list[PipelineEvent]:
        pending = self._state.pending_transition
        if pending is None:
            return []
        self._state.pending_transition = None
        self._append_log(
            "transition_dismissed",
            keyword=pending.keyword,
            soundscape=pending.soundscape_id,
            collection=pending.collection_id,
            reason=reason,
        )
        self._persist_state()
        return [
            PipelineEvent(
                event_type="transition_dismissed",
                message=f"dismissed transition to {pending.soundscape_name} ({reason})",
                collection_id=pending.collection_id,
                keyword=pending.keyword,
                collection_name=pending.soundscape_name,
            )
        ]

    def _queue_transcription_snapshot(self, snapshot: np.ndarray) -> None:
        self._transcription_request_serial += 1
        self._pending_transcription_request = (
            self._transcription_request_serial,
            self._transcriber_generation,
            snapshot,
        )

    def _dispatch_pending_transcription(self) -> None:
        if self._transcription_future is not None and not self._transcription_future.done():
            return
        if self._pending_transcription_request is None:
            return

        request_id, generation, snapshot = self._pending_transcription_request
        transcriber = self._transcriber
        self._pending_transcription_request = None
        self._transcription_future = self._transcription_executor.submit(
            self._run_transcription_request,
            request_id,
            generation,
            transcriber,
            snapshot,
        )

    def _collect_transcription_events(self) -> list[PipelineEvent]:
        events: list[PipelineEvent] = []
        future = self._transcription_future
        if future is None or not future.done():
            return events

        self._transcription_future = None
        _, generation, transcript = future.result()
        if generation == self._transcriber_generation:
            events.extend(self._apply_transcript(transcript))

        self._dispatch_pending_transcription()
        return events

    @staticmethod
    def _run_transcription_request(
        request_id: int,
        generation: int,
        transcriber: Transcriber,
        snapshot: np.ndarray,
    ) -> tuple[int, int, str]:
        return request_id, generation, transcriber.transcribe(snapshot)

    def _apply_transcript(self, transcript: str) -> list[PipelineEvent]:
        if not transcript or transcript == self._state.last_transcript:
            return []

        self._state.last_transcript = transcript
        events = [PipelineEvent(event_type="transcript", message=transcript)]

        if not self._settings.enable_transition_proposals:
            self._persist_state()
            return events

        match = self._matcher.match(transcript, self._state.active_soundscape_id)
        if match is None:
            return events

        self._state.pending_transition = PendingTransition(
            soundscape_id=match.soundscape_id,
            soundscape_name=match.soundscape_name,
            keyword=match.keyword,
            expires_at_epoch=time.time() + self._settings.transition_popup_timeout,
        )
        self._append_log(
            "transition_pending",
            keyword=match.keyword,
            soundscape=match.soundscape_id,
            collection=match.collection_id,
            display_name=match.soundscape_name,
        )
        events.append(
            PipelineEvent(
                event_type="transition_pending",
                message=f"keyword={match.keyword!r} -> soundscape={match.soundscape_name}",
                collection_id=match.collection_id,
                keyword=match.keyword,
                collection_name=match.soundscape_name,
            )
        )
        self._persist_state()
        return events
