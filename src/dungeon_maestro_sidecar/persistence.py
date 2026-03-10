from __future__ import annotations

import json
import time
from pathlib import Path

from .models import PipelineState


class SessionStateStore:
    def __init__(self, file_path: str | Path) -> None:
        self._file_path = Path(file_path)

    @property
    def file_path(self) -> Path:
        return self._file_path

    def exists(self) -> bool:
        return self._file_path.is_file()

    def load(self) -> dict[str, object]:
        payload = json.loads(self._file_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise RuntimeError(f"Session state {self._file_path} is not a JSON object")
        return payload

    def save(self, state: PipelineState) -> None:
        cooldown_remaining = max(0, int(state.cooldown_until_epoch - time.time()))
        payload = {
            "session_id": state.session_id,
            "active_collection": state.active_collection_id,
            "track_index": state.active_track_index,
            "cooldown_remaining": cooldown_remaining,
            "next_track_index_by_collection": state.next_track_index_by_collection,
            "log": state.session_log,
        }
        self._file_path.parent.mkdir(parents=True, exist_ok=True)
        self._file_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")