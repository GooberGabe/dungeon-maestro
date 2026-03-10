from __future__ import annotations

from collections.abc import Iterator
from importlib import import_module
from queue import Empty, Queue
import threading

import numpy as np

from .models import PipelineSettings


def _load_optional_module(module_name: str):
    return import_module(module_name)


class MicrophoneAudioSource:
    def __init__(self, settings: PipelineSettings) -> None:
        self._settings = settings

    @staticmethod
    def list_input_devices() -> tuple[int | None, list[dict[str, object]]]:
        try:
            sd = _load_optional_module("sounddevice")
        except ImportError as exc:
            raise RuntimeError(
                "sounddevice is required for microphone capture. Install dependencies first."
            ) from exc

        devices: list[dict[str, object]] = []
        default_input = sd.default.device[0] if sd.default.device else None
        for index, device in enumerate(sd.query_devices()):
            max_input_channels = int(device.get("max_input_channels", 0))
            if max_input_channels <= 0:
                continue
            devices.append(
                {
                    "index": index,
                    "name": str(device.get("name", "Unknown")),
                    "max_input_channels": max_input_channels,
                    "default_samplerate": device.get("default_samplerate"),
                    "is_default": index == default_input,
                }
            )

        return default_input, devices

    @staticmethod
    def describe_input_device(device: str | int | None) -> str:
        try:
            sd = _load_optional_module("sounddevice")
        except ImportError as exc:
            raise RuntimeError(
                "sounddevice is required for microphone capture. Install dependencies first."
            ) from exc

        query_target = device if device is not None else None
        try:
            info = sd.query_devices(query_target, "input")
        except Exception as exc:
            raise RuntimeError(f"Failed to query microphone device {device!r}: {exc}") from exc

        name = str(info.get("name", "Unknown"))
        channels = int(info.get("max_input_channels", 0))
        sample_rate = info.get("default_samplerate")
        if sample_rate is None:
            return f"{name} ({channels} in)"
        return f"{name} ({channels} in, default {sample_rate:.0f} Hz)"

    def stream_chunks(self, stop_event: threading.Event | None = None) -> Iterator[np.ndarray]:
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
            device=self._settings.input_device,
            dtype="float32",
            callback=callback,
        ):
            while True:
                if stop_event is not None and stop_event.is_set():
                    break
                try:
                    yield chunk_queue.get(timeout=0.25)
                except Empty:
                    continue
