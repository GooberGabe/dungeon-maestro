from __future__ import annotations

import audioop
import os
from pathlib import Path
from shutil import which
import subprocess
import sys
import threading
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

    def _build_ffmpeg_pcm_command(self) -> list[str]:
        return [
            self._ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "pipe:0",
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
        ]

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


class LocalAudioPlayer:
    def __init__(
        self,
        ffmpeg_path: str | None = None,
        output_device: str | int | None = None,
        playback_controller: PlaybackController | None = None,
    ) -> None:
        self._streamer = FfmpegStdoutStreamer(ffmpeg_path)
        self._output_device = output_device
        self._playback_controller = playback_controller or PlaybackController()
        self._worker: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._playback_allowed = threading.Event()
        self._playback_allowed.set()
        self._lock = threading.Lock()
        self._current_track_title: str | None = None
        self._last_error: str | None = None

    @property
    def current_track_title(self) -> str | None:
        return self._current_track_title

    @property
    def last_error(self) -> str | None:
        return self._last_error

    def play(self, track: ResolvedTrack) -> None:
        self.stop()
        self._stop_event = threading.Event()
        self._playback_allowed = threading.Event()
        self._playback_allowed.set()
        self._last_error = None
        self._current_track_title = track.title
        self._worker = threading.Thread(target=self._play_worker, args=(track, self._stop_event), daemon=True)
        self._worker.start()

    def pause(self) -> None:
        self._playback_allowed.clear()

    def resume(self) -> None:
        self._playback_allowed.set()

    def stop(self) -> None:
        with self._lock:
            worker = self._worker
            stop_event = self._stop_event
            self._worker = None
            self._current_track_title = None
        self._playback_allowed.set()
        if worker is None:
            return
        stop_event.set()
        worker.join(timeout=5)

    def _play_worker(self, track: ResolvedTrack, stop_event: threading.Event) -> None:
        try:
            sd = __import__("sounddevice")
        except ImportError as exc:
            self._last_error = f"sounddevice is required for local playback: {exc}"
            return

        process, ytdlp_process = self._streamer._start_processes(track, self._streamer._build_ffmpeg_pcm_command())
        frame_bytes = 4
        hit_stop = False
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
                    if not self._playback_allowed.wait(timeout=0.1):
                        continue

                    chunk = stdout_pipe.read(4096)
                    if not chunk:
                        break

                    buffered += chunk
                    usable = len(buffered) - (len(buffered) % frame_bytes)
                    if usable <= 0:
                        continue

                    output_stream.write(self._playback_controller.apply_gain(buffered[:usable]))
                    buffered = buffered[usable:]

                if stop_event.is_set():
                    hit_stop = True
        except Exception as exc:
            self._last_error = str(exc)
        finally:
            stderr_output, ytdlp_stderr = self._streamer._finalize_processes(process, ytdlp_process, hit_stop)
            if not hit_stop and process.returncode not in (0, None):
                message = stderr_output.decode("utf-8", errors="replace").strip()
                self._last_error = message or f"ffmpeg exited with code {process.returncode}"
            if not hit_stop and ytdlp_process.returncode not in (0, None):
                message = ytdlp_stderr.decode("utf-8", errors="replace").strip()
                self._last_error = message or f"yt-dlp exited with code {ytdlp_process.returncode}"
            with self._lock:
                if self._worker is not None and threading.current_thread() is self._worker:
                    self._worker = None
                    self._current_track_title = None
