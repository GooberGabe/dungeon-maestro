from __future__ import annotations

import audioop
import os
from pathlib import Path
from shutil import which
import subprocess
import sys
import threading
import time
from typing import Callable
from typing import BinaryIO
from urllib.parse import urlparse

from .models import ResolvedTrack


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
    if ffmpeg_path:
        return ffmpeg_path

    discovered = which("ffmpeg")
    if discovered:
        return discovered

    local_app_data = os.environ.get("LOCALAPPDATA")
    program_files = os.environ.get("ProgramFiles")
    program_files_x86 = os.environ.get("ProgramFiles(x86)")

    candidates = [
        Path(local_app_data) / "Microsoft" / "WinGet" / "Links" / "ffmpeg.exe"
        if local_app_data
        else None,
        Path(program_files) / "FFmpeg" / "bin" / "ffmpeg.exe" if program_files else None,
        Path(program_files_x86) / "FFmpeg" / "bin" / "ffmpeg.exe" if program_files_x86 else None,
    ]

    for candidate in candidates:
        if candidate and candidate.is_file():
            return str(candidate)

    return None


class FfmpegStdoutStreamer:
    def __init__(self, ffmpeg_path: str | None = None) -> None:
        self._ffmpeg_path = _discover_ffmpeg(ffmpeg_path)
        if self._ffmpeg_path is None:
            raise RuntimeError("ffmpeg is required for stdout audio streaming but was not found on PATH.")

    def stream(self, track: ResolvedTrack, output: BinaryIO, max_bytes: int | None = None) -> int:
        process, ytdlp_process = self._start_processes(track, self._build_ffmpeg_pcm_command())

        total_written = 0
        hit_limit = False

        try:
            assert process.stdout is not None
            while True:
                read_size = 4096
                if max_bytes is not None:
                    remaining = max_bytes - total_written
                    if remaining <= 0:
                        hit_limit = True
                        break
                    read_size = min(read_size, remaining)

                chunk = process.stdout.read(read_size)
                if not chunk:
                    break

                output.write(chunk)
                output.flush()
                total_written += len(chunk)

                if max_bytes is not None and total_written >= max_bytes:
                    hit_limit = True
                    break
        finally:
            stderr_output, ytdlp_stderr = self._finalize_processes(process, ytdlp_process, hit_limit)

        if process.returncode not in (0, None) and not hit_limit:
            message = stderr_output.decode("utf-8", errors="replace").strip()
            raise RuntimeError(message or f"ffmpeg exited with code {process.returncode}")

        if ytdlp_process.returncode not in (0, None) and not hit_limit:
            message = ytdlp_stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(message or f"yt-dlp exited with code {ytdlp_process.returncode}")

        return total_written

    def write_wav(self, track: ResolvedTrack, output_path: str | Path, max_seconds: float | None = None) -> None:
        expected_truncation = max_seconds is not None and max_seconds > 0
        ffmpeg_command = [
            self._ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "pipe:0",
            "-vn",
        ]
        if max_seconds is not None and max_seconds > 0:
            ffmpeg_command.extend(["-t", str(max_seconds)])
        ffmpeg_command.extend([
            "-acodec",
            "pcm_s16le",
            "-ac",
            "2",
            "-ar",
            "48000",
            "-y",
            str(output_path),
        ])

        process, ytdlp_process = self._start_processes(track, ffmpeg_command)
        stderr_output, ytdlp_stderr = self._finalize_processes(process, ytdlp_process, hit_limit=False)

        if process.returncode not in (0, None):
            message = stderr_output.decode("utf-8", errors="replace").strip()
            raise RuntimeError(message or f"ffmpeg exited with code {process.returncode}")

        if ytdlp_process.returncode not in (0, None) and not expected_truncation:
            message = ytdlp_stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(message or f"yt-dlp exited with code {ytdlp_process.returncode}")

    def _build_ytdlp_command(self, track: ResolvedTrack) -> list[str]:
        query = track.webpage_url or track.source
        is_search_term = not query.startswith("http")
        if is_search_term:
            query = f"ytsearch1:{query}"

        if self._is_youtube_query(query):
            return [
                sys.executable,
                "-m",
                "yt_dlp",
                "--quiet",
                "--no-warnings",
                "--extractor-args",
                "youtube:player_client=android",
                "--format",
                "18",
                "--output",
                "-",
                query,
            ]

        return [
            sys.executable,
            "-m",
            "yt_dlp",
            "--quiet",
            "--no-warnings",
            "--format",
            "bestaudio/best",
            "--output",
            "-",
            query,
        ]

    def _build_ffmpeg_pcm_command(self, seek_offset_seconds: float = 0.0) -> list[str]:
        cmd = [
            self._ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "pipe:0",
        ]
        if seek_offset_seconds > 0:
            cmd.extend(["-ss", str(seek_offset_seconds)])
        cmd.extend([
            "-vn",
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "-ac",
            "2",
            "-ar",
            "48000",
            "pipe:1",
        ])
        return cmd

    def _start_processes(
        self,
        track: ResolvedTrack,
        ffmpeg_command: list[str],
    ) -> tuple[subprocess.Popen, subprocess.Popen]:
        ytdlp_command = self._build_ytdlp_command(track)
        ytdlp_process = subprocess.Popen(
            ytdlp_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        process = subprocess.Popen(
            ffmpeg_command,
            stdin=ytdlp_process.stdout,
            stdout=subprocess.PIPE if ffmpeg_command[-1] == "pipe:1" else None,
            stderr=subprocess.PIPE,
        )

        if ytdlp_process.stdout is not None:
            ytdlp_process.stdout.close()

        return process, ytdlp_process

    def _finalize_processes(
        self,
        ffmpeg_process: subprocess.Popen,
        ytdlp_process: subprocess.Popen,
        hit_limit: bool,
    ) -> tuple[bytes, bytes]:
        if hit_limit and ffmpeg_process.poll() is None:
            ffmpeg_process.terminate()

        if hit_limit and ytdlp_process.poll() is None:
            ytdlp_process.terminate()

        try:
            _, ffmpeg_stderr = ffmpeg_process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            ffmpeg_process.kill()
            _, ffmpeg_stderr = ffmpeg_process.communicate()

        try:
            ytdlp_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            ytdlp_process.kill()
            ytdlp_process.wait()

        ytdlp_stderr = b""
        if ytdlp_process.stderr is not None:
            ytdlp_stderr = ytdlp_process.stderr.read()

        return ffmpeg_stderr, ytdlp_stderr

    def _is_youtube_query(self, query: str) -> bool:
        if query.startswith("ytsearch"):
            return True

        if not query.startswith("http"):
            return True

        hostname = urlparse(query).netloc.lower()
        return "youtube.com" in hostname or "youtu.be" in hostname


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

            if hit_stop or playback_error or not self._loop_enabled:
                break
            current_seek = 0.0
            fade_envelope = None

        should_notify_finished = not hit_stop and not playback_error and not self._loop_enabled
        with self._lock:
            if self._worker is not None and threading.current_thread() is self._worker:
                self._worker = None
                self._current_track_title = None
                self._current_track = None

        if should_notify_finished and self._on_track_finished is not None:
            self._on_track_finished(track)
