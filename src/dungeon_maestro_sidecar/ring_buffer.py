from __future__ import annotations

from collections import deque

import numpy as np


class AudioRingBuffer:
    def __init__(self, max_samples: int) -> None:
        self._max_samples = max_samples
        self._chunks: deque[np.ndarray] = deque()
        self._total_samples = 0

    @property
    def total_samples(self) -> int:
        return self._total_samples

    def append(self, chunk: np.ndarray) -> None:
        flattened = np.asarray(chunk, dtype=np.float32).reshape(-1)
        if flattened.size == 0:
            return
        self._chunks.append(flattened)
        self._total_samples += int(flattened.size)
        self._trim()

    def snapshot(self) -> np.ndarray:
        if not self._chunks:
            return np.array([], dtype=np.float32)
        return np.concatenate(tuple(self._chunks))

    def clear(self) -> None:
        self._chunks.clear()
        self._total_samples = 0

    def _trim(self) -> None:
        while self._chunks and self._total_samples > self._max_samples:
            removed = self._chunks.popleft()
            self._total_samples -= int(removed.size)
