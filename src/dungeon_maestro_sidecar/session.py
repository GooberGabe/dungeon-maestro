from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import time
from typing import Protocol

from .matching import KeywordMatcher
from .models import Collection, PipelineSettings, PipelineState, ResolvedTrack
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
        if resumed_state is not None:
            self._restore_state(resumed_state)
        self._persist_state()

    @property
    def state(self) -> PipelineState:
        return self._state

    def in_cooldown(self) -> bool:
        return self._state.cooldown_until_epoch > time.time()

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
        events: list[PipelineEvent] = []
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
        transcript = self._transcriber.transcribe(self._ring_buffer.snapshot())
        if not transcript or transcript == self._state.last_transcript:
            return events

        self._state.last_transcript = transcript
        events.append(PipelineEvent(event_type="transcript", message=transcript))

        match = self._matcher.match(transcript, self._state.active_collection_id)
        if match is None:
            return events

        self._state.active_collection_id = match.collection_id
        events.append(
            PipelineEvent(
                event_type="keyword_match",
                message=f"keyword={match.keyword!r} -> collection={match.collection_name}",
            )
        )

        selection = self._select_next_track(match.collection_id)
        if selection is not None:
            resolved, track_index = selection
            events.append(
                PipelineEvent(
                    event_type="selected_track",
                    message=f"next_track={resolved.title}",
                )
            )
            self._append_log(
                "track_selected",
                collection=match.collection_id,
                track_index=track_index,
                title=resolved.title,
            )

        self._state.cooldown_until_epoch = time.time() + self._settings.cooldown_seconds
        self._append_log(
            "collection_switch",
            keyword=match.keyword,
            collection=match.collection_id,
            cooldown_seconds=self._settings.cooldown_seconds,
        )
        events.append(
            PipelineEvent(
                event_type="cooldown_started",
                message=f"seconds={self._settings.cooldown_seconds}",
            )
        )
        self._persist_state()

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
