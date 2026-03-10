from __future__ import annotations

from importlib import import_module

import numpy as np


TRANSCRIPTION_PROFILES: dict[str, dict[str, object]] = {
    "fast": {
        "beam_size": 1,
        "best_of": 1,
        "condition_on_previous_text": False,
        "without_timestamps": True,
        "word_timestamps": False,
        "temperature": 0.0,
    },
    "balanced": {
        "beam_size": 2,
        "best_of": 2,
        "condition_on_previous_text": False,
        "without_timestamps": True,
        "word_timestamps": False,
        "temperature": 0.0,
    },
    "accurate": {
        "beam_size": 5,
        "best_of": 5,
        "condition_on_previous_text": True,
        "without_timestamps": True,
        "word_timestamps": False,
        "temperature": 0.0,
    },
}


def _load_optional_module(module_name: str):
    return import_module(module_name)


class Transcriber:
    def transcribe(self, audio_chunk: np.ndarray) -> str:
        raise NotImplementedError


def available_transcription_profiles() -> tuple[str, ...]:
    return tuple(TRANSCRIPTION_PROFILES.keys())


def normalize_transcription_profile(profile_name: str | None) -> str:
    candidate = (profile_name or "fast").strip().lower()
    if candidate not in TRANSCRIPTION_PROFILES:
        supported = ", ".join(available_transcription_profiles())
        raise RuntimeError(f"Unsupported transcription profile {profile_name!r}. Expected one of: {supported}")
    return candidate


class FasterWhisperTranscriber(Transcriber):
    def __init__(self, model_name: str, profile_name: str = "fast") -> None:
        try:
            whisper_module = _load_optional_module("faster_whisper")
        except ImportError as exc:
            raise RuntimeError(
                "faster-whisper is required for transcription. Install optional ML dependencies first."
            ) from exc

        self._profile_name = normalize_transcription_profile(profile_name)
        self._decode_options = dict(TRANSCRIPTION_PROFILES[self._profile_name])
        self._model = whisper_module.WhisperModel(model_name, device="cpu", compute_type="int8")

    @property
    def profile_name(self) -> str:
        return self._profile_name

    def transcribe(self, audio_chunk: np.ndarray) -> str:
        normalized = np.asarray(audio_chunk, dtype=np.float32)
        # External VAD already gates chunks before transcription; a second VAD pass
        # on short rolling windows can suppress valid speech entirely.
        segments, _ = self._model.transcribe(
            normalized,
            vad_filter=False,
            **self._decode_options,
        )
        return " ".join(segment.text for segment in segments).lower().strip()


class NullTranscriber(Transcriber):
    def transcribe(self, audio_chunk: np.ndarray) -> str:
        del audio_chunk
        return ""
