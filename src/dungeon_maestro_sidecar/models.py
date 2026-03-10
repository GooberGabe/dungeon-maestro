from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class TrackSource:
    source: str


@dataclass(slots=True)
class Collection:
    collection_id: str
    name: str
    keywords: list[str]
    tracks: list[TrackSource]
    playback_mode: str = "sequential_loop"


@dataclass(slots=True)
class ResolvedTrack:
    source: str
    title: str
    webpage_url: str | None = None
    stream_url: str | None = None
    duration_seconds: float | None = None
    http_headers: dict[str, str] = field(default_factory=dict)


@dataclass(slots=True)
class KeywordMatch:
    collection_id: str
    collection_name: str
    keyword: str


@dataclass(slots=True)
class PipelineSettings:
    sample_rate_hz: int = 16_000
    channels: int = 1
    chunk_size: int = 512
    ring_buffer_seconds: int = 10
    transcription_window_seconds: float = 3.0
    transcription_stride_seconds: float = 1.0
    cooldown_seconds: int = 180
    whisper_model: str = "base"
    default_collection: str = "ambient"
    transition_popup_timeout: int = 30


@dataclass(slots=True)
class PipelineState:
    session_id: str = ""
    active_collection_id: str = "ambient"
    active_track_index: int = 0
    last_transcript: str = ""
    speech_chunks_seen: int = 0
    cooldown_until_epoch: float = 0.0
    resolved_tracks: dict[str, list[ResolvedTrack]] = field(default_factory=dict)
    next_track_index_by_collection: dict[str, int] = field(default_factory=dict)
    session_log: list[dict[str, object]] = field(default_factory=list)
