from __future__ import annotations

from collections.abc import Iterator
from importlib import import_module
from queue import Queue

import numpy as np

from .models import PipelineSettings


def _load_optional_module(module_name: str):
    return import_module(module_name)


class MicrophoneAudioSource:
    def __init__(self, settings: PipelineSettings) -> None:
        self._settings = settings

    def stream_chunks(self) -> Iterator[np.ndarray]:
        try:
            sd = _load_optional_module("sounddevice")
        except ImportError as exc:
            raise RuntimeError(
                "sounddevice is required for microphone capture. Install dependencies first."
            ) from exc

        chunk_queue: Queue[np.ndarray] = Queue()

        def callback(indata, frames, time_info, status) -> None:
            del frames, time_info
            if status:
                print(f"[audio] callback status: {status}")
            chunk_queue.put(np.copy(indata).reshape(-1))

        with sd.InputStream(
            samplerate=self._settings.sample_rate_hz,
            channels=self._settings.channels,
            blocksize=self._settings.chunk_size,
            dtype="float32",
            callback=callback,
        ):
            while True:
                yield chunk_queue.get()
