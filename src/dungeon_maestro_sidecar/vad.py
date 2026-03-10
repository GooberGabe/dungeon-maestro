from __future__ import annotations

from importlib import import_module

import numpy as np


def _load_optional_module(module_name: str):
    return import_module(module_name)


class SpeechGate:
    def is_speech(self, chunk: np.ndarray) -> bool:
        raise NotImplementedError


class EnergyVadGate(SpeechGate):
    def __init__(self, threshold: float = 0.015) -> None:
        self._threshold = threshold

    def is_speech(self, chunk: np.ndarray) -> bool:
        if chunk.size == 0:
            return False
        energy = float(np.sqrt(np.mean(np.square(chunk))))
        return energy >= self._threshold


class SileroVadGate(SpeechGate):
    def __init__(self, sample_rate_hz: int) -> None:
        self._sample_rate_hz = sample_rate_hz
        self._fallback = EnergyVadGate()
        self._model = None
        self._utils = None
        self._load_error: Exception | None = None
        self._try_load()

    def is_speech(self, chunk: np.ndarray) -> bool:
        if self._model is None or self._utils is None:
            return self._fallback.is_speech(chunk)

        get_speech_timestamps = self._utils[0]
        audio = np.asarray(chunk, dtype=np.float32)
        timestamps = get_speech_timestamps(audio, self._model, sampling_rate=self._sample_rate_hz)
        return bool(timestamps)

    @property
    def using_fallback(self) -> bool:
        return self._model is None

    @property
    def load_error(self) -> Exception | None:
        return self._load_error

    def _try_load(self) -> None:
        try:
            torch = _load_optional_module("torch")
        except ImportError as exc:
            self._load_error = exc
            return

        try:
            loaded = torch.hub.load(
                repo_or_dir="snakers4/silero-vad",
                model="silero_vad",
                trust_repo=True,
                onnx=False,
            )
        except Exception as exc:
            self._load_error = exc
            return

        self._model, self._utils = loaded
