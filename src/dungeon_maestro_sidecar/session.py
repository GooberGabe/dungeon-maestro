from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
import time
from typing import Protocol

import numpy as np

from .matching import KeywordMatcher
from .models import Collection, PendingTransition, PipelineSettings, PipelineState, ResolvedTrack
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


class PipelineSession:
    def __init__(
        self,
        settings: PipelineSettings,
        collections: list[Collection],
        speech_gate: SpeechGate,
        transcriber: Transcriber,
        track_resolver: TrackResolver,
        state_store: SessionStateStore | None = None,
        resumed_state: dict[str, object] | None = None,
    ) -> None:
        self._settings = settings
        self._collections = collections
        self._collections_by_id = {collection.collection_id: collection for collection in collections}
        self._speech_gate = speech_gate
        self._transcriber = transcriber
        self._track_resolver = track_resolver
        self._state_store = state_store
        self._matcher = KeywordMatcher(collections)
        default_collection_id = settings.default_collection if settings.default_collection in self._collections_by_id else collections[0].collection_id
        self._state = PipelineState(
            session_id=datetime.now().isoformat(timespec="seconds"),
            active_collection_id=default_collection_id,
        )
        self._ring_buffer = AudioRingBuffer(settings.sample_rate_hz * settings.ring_buffer_seconds)
        self._chunks_since_transcription = 0
        self._transcription_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dungeon-maestro-transcribe")
        self._transcription_request_serial = 0
        self._transcriber_generation = 0
        self._pending_transcription_request: tuple[int, int, np.ndarray] | None = None
        self._transcription_future: Future[tuple[int, int, str]] | None = None
        if resumed_state is not None:
            self._restore_state(resumed_state)
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
        self._pending_transcription_request = None
        self._transcription_executor.shutdown(wait=False, cancel_futures=True)

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
            "target_collection": pending.collection_id,
            "display_name": pending.collection_name,
            "expires_at_epoch": pending.expires_at_epoch,
        }

    def warm_resolve_tracks(self) -> list[PipelineEvent]:
        events: list[PipelineEvent] = []
        for collection in self._collections:
            resolved: list[ResolvedTrack] = []
            for track in collection.tracks:
                try:
                    item = self._track_resolver.resolve(track.source)
                except Exception as exc:
                    events.append(
                        PipelineEvent(
                            event_type="resolve_error",
                            message=f"[{collection.collection_id}] failed to resolve {track.source!r}: {exc}",
                        )
                    )
                    continue
                resolved.append(item)
                events.append(
                    PipelineEvent(
                        event_type="track_resolved",
                        message=(
                            f"[{collection.collection_id}] {item.title}"
                            + (f" ({item.duration_seconds:.0f}s)" if item.duration_seconds else "")
                        ),
                    )
                )
            self._state.resolved_tracks[collection.collection_id] = resolved
        self._persist_state()
        return events

    def next_track_for_collection(self, collection_id: str) -> ResolvedTrack | None:
        selection = self._select_next_track(collection_id)
        if selection is None:
            return None

        track, track_index = selection
        self._append_log(
            "track_selected",
            collection=collection_id,
            track_index=track_index,
            title=track.title,
        )
        self._persist_state()
        return track

    def _select_next_track(self, collection_id: str) -> tuple[ResolvedTrack, int] | None:
        resolved = self._state.resolved_tracks.get(collection_id, [])
        if not resolved:
            return None

        current_index = self._state.next_track_index_by_collection.get(collection_id, 0) % len(resolved)
        self._state.next_track_index_by_collection[collection_id] = (current_index + 1) % len(resolved)
        self._state.active_track_index = current_index
        return resolved[current_index], current_index

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
        self._state.active_collection_id = pending.collection_id
        self._append_log(
            "collection_switch",
            keyword=pending.keyword,
            collection=pending.collection_id,
            cooldown_seconds=self._settings.cooldown_seconds,
        )
        events.append(
            PipelineEvent(
                event_type="transition_approved",
                message=f"approved transition to {pending.collection_name}",
                collection_id=pending.collection_id,
                keyword=pending.keyword,
                collection_name=pending.collection_name,
            )
        )
        events.append(
            PipelineEvent(
                event_type="keyword_match",
                message=f"keyword={pending.keyword!r} -> collection={pending.collection_name}",
                collection_id=pending.collection_id,
                keyword=pending.keyword,
                collection_name=pending.collection_name,
            )
        )

        selection = self._select_next_track(pending.collection_id)
        if selection is not None:
            resolved, track_index = selection
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

        active_collection = payload.get("active_collection")
        if isinstance(active_collection, str) and active_collection in self._collections_by_id:
            self._state.active_collection_id = active_collection

        track_index = payload.get("track_index")
        if isinstance(track_index, int) and track_index >= 0:
            self._state.active_track_index = track_index

        next_indexes = payload.get("next_track_index_by_collection")
        if isinstance(next_indexes, dict):
            restored_indexes: dict[str, int] = {}
            for collection_id, index in next_indexes.items():
                if collection_id in self._collections_by_id and isinstance(index, int) and index >= 0:
                    restored_indexes[collection_id] = index
            self._state.next_track_index_by_collection = restored_indexes

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
            collection=pending.collection_id,
            reason=reason,
        )
        self._persist_state()
        return [
            PipelineEvent(
                event_type="transition_dismissed",
                message=f"dismissed transition to {pending.collection_name} ({reason})",
                collection_id=pending.collection_id,
                keyword=pending.keyword,
                collection_name=pending.collection_name,
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

        match = self._matcher.match(transcript, self._state.active_collection_id)
        if match is None:
            return events

        self._state.pending_transition = PendingTransition(
            collection_id=match.collection_id,
            collection_name=match.collection_name,
            keyword=match.keyword,
            expires_at_epoch=time.time() + self._settings.transition_popup_timeout,
        )
        self._append_log(
            "transition_pending",
            keyword=match.keyword,
            collection=match.collection_id,
            display_name=match.collection_name,
        )
        events.append(
            PipelineEvent(
                event_type="transition_pending",
                message=f"keyword={match.keyword!r} -> collection={match.collection_name}",
                collection_id=match.collection_id,
                keyword=match.keyword,
                collection_name=match.collection_name,
            )
        )
        self._persist_state()
        return events
