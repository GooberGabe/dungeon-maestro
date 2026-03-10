from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from dungeon_maestro_sidecar.config import load_pipeline_config
from dungeon_maestro_sidecar.models import ResolvedTrack
from dungeon_maestro_sidecar.persistence import SessionStateStore
from dungeon_maestro_sidecar.session import PipelineSession


class AlwaysSpeechGate:
    def is_speech(self, chunk) -> bool:
        return True


class StaticTranscriber:
    def __init__(self, text: str) -> None:
        self._text = text

    def transcribe(self, audio_chunk) -> str:
        return self._text


class StaticResolver:
    def resolve(self, source: str) -> ResolvedTrack:
        return ResolvedTrack(source=source, title=source, webpage_url=source)


settings, collections = load_pipeline_config("tabletop-dj.yaml")
settings.cooldown_seconds = 5
settings.transcription_window_seconds = 0.01
settings.transcription_stride_seconds = 0.01
state_path = Path("tabletop-dj.test-session.json")
if state_path.exists():
    state_path.unlink()

session = PipelineSession(
    settings,
    collections,
    AlwaysSpeechGate(),
    StaticTranscriber("roll for initiative"),
    StaticResolver(),
    state_store=SessionStateStore(state_path),
)
session.warm_resolve_tracks()
chunk = np.ones(settings.sample_rate_hz * 4, dtype=np.float32)
first_events = [event.event_type for event in session.process_chunk(chunk)]
second_events = [event.event_type for event in session.process_chunk(chunk)]
payload = json.loads(state_path.read_text(encoding="utf-8"))
print(json.dumps({
    "first_events": first_events,
    "second_events": second_events,
    "active_collection": payload.get("active_collection"),
    "cooldown_remaining": payload.get("cooldown_remaining"),
    "log_events": [entry.get("event") for entry in payload.get("log", [])],
}, indent=2))
state_path.unlink()
