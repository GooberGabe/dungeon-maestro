from __future__ import annotations

import audioop
import threading
import time
from typing import Callable
from typing import BinaryIO

from .models import ResolvedTrack
from .pcm_mixer import PcmMixer
from .track_buffer import TrackBuffer
from .ffmpeg_streamer import FfmpegStdoutStreamer, discover_ffmpeg


class PlaybackController:
    def __init__(self, volume_percent: int = 100, muted: bool = False) -> None:
        self._lock = threading.Lock()
        self._volume_percent = self._clamp_volume(volume_percent)
        self._muted = bool(muted)

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return {
                "volume_percent": self._volume_percent,
                "muted": self._muted,
            }

    def set_volume_percent(self, volume_percent: int) -> None:
        with self._lock:
            self._volume_percent = self._clamp_volume(volume_percent)

    def set_muted(self, muted: bool) -> None:
        with self._lock:
            self._muted = bool(muted)

    def apply_gain(self, pcm_bytes: bytes) -> bytes:
        if not pcm_bytes:
            return pcm_bytes

        with self._lock:
            volume_percent = self._volume_percent
            muted = self._muted

        if muted or volume_percent <= 0:
            return b"\x00" * len(pcm_bytes)
        if volume_percent >= 100:
            return pcm_bytes
        return audioop.mul(pcm_bytes, 2, volume_percent / 100.0)

    @staticmethod
    def _clamp_volume(volume_percent: int) -> int:
        return max(0, min(100, int(volume_percent)))


def _discover_ffmpeg(ffmpeg_path: str | None) -> str | None:
    return discover_ffmpeg(ffmpeg_path)


class _FadeEnvelope:
    """Thread-safe linear gain envelope for crossfade ramps."""

    def __init__(self, start: float, end: float, duration_seconds: float) -> None:
        self._start = start
        self._end = end
        self._duration = max(duration_seconds, 0.01)
        self._t0 = time.monotonic()

    @property
    def finished(self) -> bool:
        return (time.monotonic() - self._t0) >= self._duration

    def gain(self) -> float:
        elapsed = time.monotonic() - self._t0
        t = min(elapsed / self._duration, 1.0)
        return self._start + (self._end - self._start) * t

    def apply(self, pcm_bytes: bytes) -> bytes:
        if not pcm_bytes:
            return pcm_bytes
        g = self.gain()
        if g <= 0.0:
            return b"\x00" * len(pcm_bytes)
        if g >= 1.0:
            return pcm_bytes
        return audioop.mul(pcm_bytes, 2, g)


class LocalAudioPlayer:
    def __init__(
        self,
        ffmpeg_path: str | None = None,
        output_device: str | int | None = None,
        playback_controller: PlaybackController | None = None,
        crossfade_enabled: bool = False,
        crossfade_duration_seconds: float = 3.0,
        on_track_finished: Callable[[ResolvedTrack], None] | None = None,
    ) -> None:
        self._streamer = FfmpegStdoutStreamer(ffmpeg_path)
        self._output_device = output_device
        self._playback_controller = playback_controller or PlaybackController()
        self._crossfade_enabled = crossfade_enabled
        self._crossfade_duration = max(0.5, min(15.0, crossfade_duration_seconds))
        self._on_track_finished = on_track_finished
        self._worker: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._playback_allowed = threading.Event()
        self._playback_allowed.set()
        self._lock = threading.Lock()
        self._current_track_title: str | None = None
        self._current_track: ResolvedTrack | None = None
        self._loop_enabled: bool = False
        self._crossfade_pause: bool = False
        self._pause_fade: _FadeEnvelope | None = None
        self._last_error: str | None = None
        self._fadeout_workers: list[threading.Thread] = []

    @property
    def crossfade_enabled(self) -> bool:
        return self._crossfade_enabled

    @crossfade_enabled.setter
    def crossfade_enabled(self, value: bool) -> None:
        self._crossfade_enabled = bool(value)

    @property
    def crossfade_duration(self) -> float:
        return self._crossfade_duration

    @crossfade_duration.setter
    def crossfade_duration(self, value: float) -> None:
        self._crossfade_duration = max(0.5, min(15.0, float(value)))

    @property
    def loop_enabled(self) -> bool:
        return self._loop_enabled

    @loop_enabled.setter
    def loop_enabled(self, value: bool) -> None:
        self._loop_enabled = bool(value)

    @property
    def crossfade_pause(self) -> bool:
        return self._crossfade_pause

    @crossfade_pause.setter
    def crossfade_pause(self, value: bool) -> None:
        self._crossfade_pause = bool(value)

    @property
    def current_track_title(self) -> str | None:
        return self._current_track_title

    @property
    def last_error(self) -> str | None:
        return self._last_error

    def play(self, track: ResolvedTrack) -> None:
        if self._crossfade_enabled:
            self._begin_crossfade(track)
        else:
            self.stop()
            self._start_worker(track, fade_in=None)
        with self._lock:
            self._current_track = track

    def seek(self, position_seconds: float) -> None:
        with self._lock:
            track = self._current_track
            was_paused = not self._playback_allowed.is_set()
        if track is None:
            return
        self.stop()
        self._start_worker(track, fade_in=None, seek_offset=max(0.0, position_seconds))
        with self._lock:
            self._current_track = track
        if was_paused:
            self._playback_allowed.clear()

    def pause(self) -> None:
        if self._crossfade_pause and self._crossfade_duration > 0:
            self._pause_fade = _FadeEnvelope(1.0, 0.0, self._crossfade_duration)
        else:
            self._playback_allowed.clear()

    def resume(self) -> None:
        self._playback_allowed.set()
        if self._crossfade_pause and self._crossfade_duration > 0:
            self._pause_fade = _FadeEnvelope(0.0, 1.0, self._crossfade_duration)
        else:
            self._pause_fade = None

    def stop(self) -> None:
        with self._lock:
            worker = self._worker
            stop_event = self._stop_event
            self._worker = None
            self._current_track_title = None
            self._current_track = None
            self._pause_fade = None
            fadeout_workers = list(self._fadeout_workers)
        self._playback_allowed.set()
        if worker is not None:
            stop_event.set()
            if worker is not threading.current_thread():
                worker.join(timeout=5)
        for fw in fadeout_workers:
            if fw is not threading.current_thread():
                fw.join(timeout=3)
        with self._lock:
            self._fadeout_workers.clear()

    def _begin_crossfade(self, track: ResolvedTrack) -> None:
        with self._lock:
            old_worker = self._worker
            old_stop = self._stop_event
            self._worker = None

        if old_worker is not None and old_worker.is_alive():
            fade_out = _FadeEnvelope(1.0, 0.0, self._crossfade_duration)
            old_stop.fade_envelope = fade_out  # type: ignore[attr-defined]
            old_stop.begin_fade = True  # type: ignore[attr-defined]

            def _fadeout_cleanup() -> None:
                old_worker.join(timeout=self._crossfade_duration + 5)
                with self._lock:
                    if old_worker in self._fadeout_workers:
                        self._fadeout_workers.remove(old_worker)

            cleanup_thread = threading.Thread(target=_fadeout_cleanup, daemon=True)
            with self._lock:
                self._fadeout_workers.append(old_worker)
            cleanup_thread.start()
        else:
            if old_worker is not None:
                old_stop.set()
                old_worker.join(timeout=3)

        fade_in = _FadeEnvelope(0.0, 1.0, self._crossfade_duration)
        self._start_worker(track, fade_in=fade_in)

    def _start_worker(self, track: ResolvedTrack, *, fade_in: _FadeEnvelope | None, seek_offset: float = 0.0) -> None:
        self._stop_event = threading.Event()
        self._playback_allowed = threading.Event()
        self._playback_allowed.set()
        self._last_error = None
        self._current_track_title = track.title
        self._worker = threading.Thread(
            target=self._play_worker,
            args=(track, self._stop_event, fade_in, seek_offset),
            daemon=True,
        )
        self._worker.start()

    def _play_worker(
        self,
        track: ResolvedTrack,
        stop_event: threading.Event,
        fade_envelope: _FadeEnvelope | None,
        seek_offset: float = 0.0,
    ) -> None:
        try:
            sd = __import__("sounddevice")
        except ImportError as exc:
            self._last_error = f"sounddevice is required for local playback: {exc}"
            return

        current_seek = seek_offset

        while True:
            process, ytdlp_process = self._streamer._start_processes(
                track, self._streamer._build_ffmpeg_pcm_command(current_seek))
            frame_bytes = 4
            hit_stop = False
            playback_error = False
            buffered = b""

            try:
                with sd.RawOutputStream(
                    samplerate=48_000,
                    channels=2,
                    dtype="int16",
                    device=self._output_device,
                ) as output_stream:
                    stdout_pipe = process.stdout
                    assert stdout_pipe is not None
                    while not stop_event.is_set():
                        crossfade_fade: _FadeEnvelope | None = getattr(stop_event, "fade_envelope", None)
                        if crossfade_fade is not None and crossfade_fade.finished:
                            hit_stop = True
                            break

                        if not self._playback_allowed.wait(timeout=0.1):
                            continue

                        chunk = stdout_pipe.read(4096)
                        if not chunk:
                            break

                        buffered += chunk
                        usable = len(buffered) - (len(buffered) % frame_bytes)
                        if usable <= 0:
                            continue

                        pcm = self._playback_controller.apply_gain(buffered[:usable])

                        active_fade = fade_envelope if (fade_envelope and not fade_envelope.finished) else None
                        if active_fade is None:
                            active_fade = getattr(stop_event, "fade_envelope", None)
                        if active_fade is not None:
                            pcm = active_fade.apply(pcm)

                        pf = self._pause_fade
                        if pf is not None:
                            pcm = pf.apply(pcm)
                            if pf.finished:
                                self._pause_fade = None
                                if pf._end <= 0.0:
                                    self._playback_allowed.clear()

                        output_stream.write(pcm)
                        buffered = buffered[usable:]

                    if stop_event.is_set():
                        hit_stop = True
            except Exception as exc:
                self._last_error = str(exc)
                playback_error = True
            finally:
                stderr_output, ytdlp_stderr = self._streamer._finalize_processes(
                    process, ytdlp_process, hit_stop or playback_error)
                if not hit_stop and not playback_error:
                    if process.returncode not in (0, None):
                        message = stderr_output.decode("utf-8", errors="replace").strip()
                        self._last_error = message or f"ffmpeg exited with code {process.returncode}"
                    if ytdlp_process.returncode not in (0, None):
                        message = ytdlp_stderr.decode("utf-8", errors="replace").strip()
                        self._last_error = message or f"yt-dlp exited with code {ytdlp_process.returncode}"

            # Loop logic fix: if looping is enabled and playback ended naturally, restart from beginning
            if hit_stop or playback_error:
                break
            if self._loop_enabled:
                current_seek = 0.0
                fade_envelope = None
                continue
            else:
                break

        should_notify_finished = not hit_stop and not playback_error and not self._loop_enabled
        with self._lock:
            if self._worker is not None and threading.current_thread() is self._worker:
                self._worker = None
                self._current_track_title = None
                self._current_track = None

        if should_notify_finished and self._on_track_finished is not None:
            self._on_track_finished(track)


class LocalMixerPlayer:
    def __init__(
        self,
        ffmpeg_path: str | None = None,
        output_device: str | int | None = None,
        playback_controller: PlaybackController | None = None,
        crossfade_enabled: bool = False,
        crossfade_duration_seconds: float = 3.0,
        on_track_finished: Callable[[ResolvedTrack], None] | None = None,
    ) -> None:
        self._ffmpeg_path = _discover_ffmpeg(ffmpeg_path)
        if self._ffmpeg_path is None:
            raise RuntimeError("ffmpeg is required for local mixer playback but was not found on PATH.")
        self._output_device = output_device
        self._playback_controller = playback_controller or PlaybackController()
        self._crossfade_enabled = crossfade_enabled
        self._crossfade_duration = max(0.5, min(15.0, crossfade_duration_seconds))
        self._on_track_finished = on_track_finished
        self._mixer = PcmMixer()
        self._output_thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._playback_allowed = threading.Event()
        self._playback_allowed.set()
        self._lock = threading.Lock()
        self._current_track_title: str | None = None
        self._current_track: ResolvedTrack | None = None
        self._loop_enabled: bool = False
        self._crossfade_pause: bool = False
        self._pause_fade: _FadeEnvelope | None = None
        self._last_error: str | None = None
        self._last_mixer_track = None

    @property
    def crossfade_enabled(self) -> bool:
        return self._crossfade_enabled

    @crossfade_enabled.setter
    def crossfade_enabled(self, value: bool) -> None:
        self._crossfade_enabled = bool(value)

    @property
    def crossfade_duration(self) -> float:
        return self._crossfade_duration

    @crossfade_duration.setter
    def crossfade_duration(self, value: float) -> None:
        self._crossfade_duration = max(0.5, min(15.0, float(value)))

    @property
    def loop_enabled(self) -> bool:
        return self._loop_enabled

    @loop_enabled.setter
    def loop_enabled(self, value: bool) -> None:
        self._loop_enabled = bool(value)

    @property
    def crossfade_pause(self) -> bool:
        return self._crossfade_pause

    @crossfade_pause.setter
    def crossfade_pause(self, value: bool) -> None:
        self._crossfade_pause = bool(value)

    @property
    def current_track_title(self) -> str | None:
        return self._current_track_title

    @property
    def last_error(self) -> str | None:
        return self._last_error

    def play(self, track: ResolvedTrack) -> None:
        fade_in = self._crossfade_duration if self._crossfade_enabled else None
        fade_out = self._crossfade_duration if self._crossfade_enabled else None

        buffer = TrackBuffer(
            track,
            prebuffer_frames=100,
            ffmpeg_path=self._ffmpeg_path,
        )
        buffer.start()
        buffer.wait_ready(timeout=5.0)

        def buffer_source():
            while not buffer.finished or buffer.buffered_frames > 0:
                yield buffer.read_frame(timeout=0.5)

        def _on_finished() -> None:
            buffer.stop()
            if self._loop_enabled and self._current_track is track:
                self.play(track)
            elif self._on_track_finished is not None:
                self._on_track_finished(track)

        new_track = self._mixer.add_track(buffer_source(), fade_in=fade_in, on_finished=_on_finished)
        if self._last_mixer_track is not None:
            self._mixer.remove_track(self._last_mixer_track, fade_out=fade_out)
        if not self._crossfade_enabled and hasattr(self, '_last_track_buffer') and self._last_track_buffer is not None:
            self._last_track_buffer.stop()
        self._last_mixer_track = new_track
        self._last_track_buffer = buffer
        with self._lock:
            self._current_track = track
            self._current_track_title = track.title

        self._start_output_if_needed()

    def seek(self, position_seconds: float) -> None:
        with self._lock:
            track = self._current_track
        if track is None:
            return
        self.stop()
        buffer = TrackBuffer(
            track,
            prebuffer_frames=100,
            ffmpeg_path=self._ffmpeg_path,
            seek_offset_seconds=max(0.0, position_seconds),
        )
        buffer.start()
        buffer.wait_ready(timeout=5.0)

        def buffer_source():
            while not buffer.finished or buffer.buffered_frames > 0:
                yield buffer.read_frame(timeout=0.5)

        new_track = self._mixer.add_track(buffer_source(), fade_in=None, on_finished=buffer.stop)
        self._last_mixer_track = new_track
        self._last_track_buffer = buffer
        self._start_output_if_needed()

    def pause(self) -> None:
        if self._crossfade_pause and self._crossfade_duration > 0:
            self._pause_fade = _FadeEnvelope(1.0, 0.0, self._crossfade_duration)
        else:
            self._playback_allowed.clear()

    def resume(self) -> None:
        self._playback_allowed.set()
        if self._crossfade_pause and self._crossfade_duration > 0:
            self._pause_fade = _FadeEnvelope(0.0, 1.0, self._crossfade_duration)
        else:
            self._pause_fade = None

    def stop(self) -> None:
        self._stop_event.set()
        self._playback_allowed.set()
        if self._output_thread is not None and self._output_thread.is_alive():
            self._output_thread.join(timeout=3)
        self._output_thread = None
        self._mixer.stop()
        if self._mixer.is_alive():
            self._mixer.join(timeout=2)
        self._mixer = PcmMixer()
        if hasattr(self, '_last_track_buffer') and self._last_track_buffer is not None:
            self._last_track_buffer.stop()
            self._last_track_buffer = None
        with self._lock:
            self._current_track = None
            self._current_track_title = None
            self._pause_fade = None
        self._stop_event = threading.Event()

    def _start_output_if_needed(self) -> None:
        if not self._mixer.is_alive():
            self._mixer.start()
        if self._output_thread is None or not self._output_thread.is_alive():
            self._output_thread = threading.Thread(target=self._output_worker, daemon=True)
            self._output_thread.start()

    def _output_worker(self) -> None:
        try:
            sd = __import__("sounddevice")
        except ImportError as exc:
            self._last_error = f"sounddevice is required for local playback: {exc}"
            return
        try:
            with sd.RawOutputStream(
                samplerate=48_000,
                channels=2,
                dtype="int16",
                device=self._output_device,
            ) as output_stream:
                while not self._stop_event.is_set():
                    chunk = self._mixer.get_output(timeout=0.25)
                    if not self._playback_allowed.is_set():
                        continue
                    pcm = self._playback_controller.apply_gain(chunk)
                    pf = self._pause_fade
                    if pf is not None:
                        pcm = pf.apply(pcm)
                        if pf.finished:
                            self._pause_fade = None
                            if pf._end <= 0.0:
                                self._playback_allowed.clear()
                    output_stream.write(pcm)
        except Exception as exc:
            self._last_error = str(exc)
