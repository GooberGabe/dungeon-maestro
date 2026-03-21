from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class TrackSource:
    source: str


@dataclass(slots=True)
class Soundscape:
    soundscape_id: str
    name: str
    keywords: list[str]
    tracks: list[TrackSource]
    playback_mode: str = "sequential_loop"

    @property
    def collection_id(self) -> str:
        return self.soundscape_id

    @collection_id.setter
    def collection_id(self, value: str) -> None:
        self.soundscape_id = value


Collection = Soundscape


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
    soundscape_id: str
    soundscape_name: str
    keyword: str

    @property
    def collection_id(self) -> str:
        return self.soundscape_id

    @property
    def collection_name(self) -> str:
        return self.soundscape_name


@dataclass(slots=True)
class PendingTransition:
    soundscape_id: str
    soundscape_name: str
    keyword: str
    expires_at_epoch: float

    @property
    def collection_id(self) -> str:
        return self.soundscape_id

    @property
    def collection_name(self) -> str:
        return self.soundscape_name


@dataclass(slots=True)
class PipelineSettings:
    sample_rate_hz: int = 16_000
    channels: int = 1
    input_device: str | int | None = None
    chunk_size: int = 512
    ring_buffer_seconds: int = 10
    transcription_window_seconds: float = 3.0
    transcription_stride_seconds: float = 1.0
    transcription_profile: str = "fast"
    cooldown_seconds: int = 180
    whisper_model: str = "base"
    default_soundscape: str = "ambient"
    enable_transition_proposals: bool = True
    transition_popup_timeout: int = 30
    crossfade_enabled: bool = False
    crossfade_duration_seconds: float = 3.0

    @property
    def default_collection(self) -> str:
        return self.default_soundscape

    @default_collection.setter
    def default_collection(self, value: str) -> None:
        self.default_soundscape = value


@dataclass(slots=True)
class PipelineState:
    session_id: str = ""
    active_soundscape_id: str = "ambient"
    active_track_index: int = 0
    last_transcript: str = ""
    speech_chunks_seen: int = 0
    cooldown_until_epoch: float = 0.0
    pending_transition: PendingTransition | None = None
    resolved_tracks: dict[str, list[ResolvedTrack]] = field(default_factory=dict)
    next_track_index_by_soundscape: dict[str, int] = field(default_factory=dict)
    session_log: list[dict[str, object]] = field(default_factory=list)

    @property
    def active_collection_id(self) -> str:
        return self.active_soundscape_id

    @active_collection_id.setter
    def active_collection_id(self, value: str) -> None:
        self.active_soundscape_id = value

    @property
    def next_track_index_by_collection(self) -> dict[str, int]:
        return self.next_track_index_by_soundscape

    @next_track_index_by_collection.setter
    def next_track_index_by_collection(self, value: dict[str, int]) -> None:
        self.next_track_index_by_soundscape = value
