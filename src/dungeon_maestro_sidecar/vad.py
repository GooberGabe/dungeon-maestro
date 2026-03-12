from __future__ import annotations

import numpy as np

from . import load_optional_module


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
    def __init__(self, sample_rate_hz: int, threshold: float = 0.5) -> None:
        self._sample_rate_hz = sample_rate_hz
        self._threshold = threshold
        self._fallback = EnergyVadGate()
        self._torch = None
        self._model = None
        self._load_error: Exception | None = None
        self._try_load()

    def is_speech(self, chunk: np.ndarray) -> bool:
        if self._model is None or self._torch is None:
            return self._fallback.is_speech(chunk)

        audio = np.asarray(chunk, dtype=np.float32)
        if audio.size == 0:
            return False

        # Silero's streaming path expects fixed-size frames: 512 samples at 16 kHz.
        expected_size = 512 if self._sample_rate_hz == 16_000 else 256
        if audio.size < expected_size:
            audio = np.pad(audio, (0, expected_size - audio.size))
        elif audio.size > expected_size:
            audio = audio[-expected_size:]

        try:
            with self._torch.no_grad():
                tensor = self._torch.from_numpy(audio)
                probability = float(self._model(tensor, self._sample_rate_hz).item())
        except Exception as exc:
            self._load_error = exc
            return self._fallback.is_speech(chunk)

        return probability >= self._threshold

    @property
    def using_fallback(self) -> bool:
        return self._model is None

    @property
    def load_error(self) -> Exception | None:
        return self._load_error

    def _try_load(self) -> None:
        try:
            torch = load_optional_module("torch")
        except ImportError as exc:
            self._load_error = exc
            return

        self._torch = torch

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

        self._model, _utils = loaded
