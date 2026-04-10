from __future__ import annotations

from collections import deque
import threading
import time
from typing import Callable

from .ffmpeg_pcm import ffmpeg_pcm_generator
from .models import ResolvedTrack


class TrackBuffer:
    def __init__(
        self,
        track: ResolvedTrack,
        *,
        prebuffer_frames: int = 50,
        frame_size: int = 3840,
        ffmpeg_path: str | None = None,
        generator_factory: Callable[[], object] | None = None,
        seek_offset_seconds: float = 0.0,
    ) -> None:
        self._track = track
        self._frame_size = frame_size
        self._prebuffer_frames = prebuffer_frames
        self._ffmpeg_path = ffmpeg_path
        self._generator_factory = generator_factory
        self._seek_offset_seconds = seek_offset_seconds
        self._buffer = deque()
        self._lock = threading.Lock()
        self._buffer_cv = threading.Condition(self._lock)
        self._data_event = threading.Event()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._finished = False
        self._started = False
        self._max_frames = self._prebuffer_frames * 4

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        print(f"[track_buffer] start track={self._track.title}")

    def _run(self) -> None:
        self._started = True
        try:
            if self._generator_factory is not None:
                gen = self._generator_factory()
            else:
                gen = ffmpeg_pcm_generator(
                    self._track,
                    ffmpeg_path=self._ffmpeg_path,
                    seek_offset=self._seek_offset_seconds,
                )
            for frame in gen:
                if self._stop_event.is_set():
                    break
                with self._lock:
                    while len(self._buffer) >= self._max_frames and not self._stop_event.is_set():
                        self._buffer_cv.wait(timeout=0.1)
                    if self._stop_event.is_set():
                        break
                    self._buffer.append(frame)
                    if len(self._buffer) >= self._prebuffer_frames:
                        self._data_event.set()
                    else:
                        self._data_event.set()
                    if len(self._buffer) == self._prebuffer_frames:
                        print(f"[track_buffer] prebuffer ready track={self._track.title} frames={len(self._buffer)}")
                    self._buffer_cv.notify_all()
        finally:
            self._finished = True
            self._data_event.set()
            print(f"[track_buffer] finished track={self._track.title} buffered={self.buffered_frames}")
            with self._lock:
                self._buffer_cv.notify_all()

    def wait_ready(self, timeout: float = 2.0) -> bool:
        return self._data_event.wait(timeout=timeout)

    def read_frame(self, timeout: float = 0.5) -> bytes:
        with self._lock:
            end_time = time.monotonic() + timeout
            while not self._buffer and not self._finished:
                remaining = end_time - time.monotonic()
                if remaining <= 0:
                    break
                self._buffer_cv.wait(timeout=remaining)
            if self._buffer:
                frame = self._buffer.popleft()
                if not self._buffer:
                    self._data_event.clear()
                self._buffer_cv.notify_all()
                if not isinstance(frame, (bytes, bytearray)) or len(frame) == 0:
                    return b"\x00" * self._frame_size
                if len(frame) < self._frame_size:
                    return frame + (b"\x00" * (self._frame_size - len(frame)))
                if len(frame) > self._frame_size:
                    return frame[:self._frame_size]
                return frame
            print(f"[track_buffer] underrun track={self._track.title} buffered=0")
            return b"\x00" * self._frame_size

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=2)

    @property
    def finished(self) -> bool:
        return self._finished

    @property
    def buffered_frames(self) -> int:
        with self._lock:
            return len(self._buffer)
