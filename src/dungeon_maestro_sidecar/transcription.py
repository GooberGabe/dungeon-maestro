from __future__ import annotations

from importlib import import_module

import numpy as np


def _load_optional_module(module_name: str):
    return import_module(module_name)


class Transcriber:
    def transcribe(self, audio_chunk: np.ndarray) -> str:
        raise NotImplementedError


class FasterWhisperTranscriber(Transcriber):
    def __init__(self, model_name: str) -> None:
        try:
            whisper_module = _load_optional_module("faster_whisper")
        except ImportError as exc:
            raise RuntimeError(
                "faster-whisper is required for transcription. Install optional ML dependencies first."
            ) from exc

        self._model = whisper_module.WhisperModel(model_name, device="cpu", compute_type="int8")

    def transcribe(self, audio_chunk: np.ndarray) -> str:
        normalized = np.asarray(audio_chunk, dtype=np.float32)
        # External VAD already gates chunks before transcription; a second VAD pass
        # on short rolling windows can suppress valid speech entirely.
        segments, _ = self._model.transcribe(normalized, vad_filter=False)
        return " ".join(segment.text for segment in segments).lower().strip()


class NullTranscriber(Transcriber):
    def transcribe(self, audio_chunk: np.ndarray) -> str:
        del audio_chunk
        return ""
