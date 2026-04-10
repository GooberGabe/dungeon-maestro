from __future__ import annotations

import os
from pathlib import Path
from shutil import which
import subprocess
import sys
from urllib.parse import urlparse

from .models import ResolvedTrack


def discover_ffmpeg(ffmpeg_path: str | None) -> str | None:
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
        self._ffmpeg_path = discover_ffmpeg(ffmpeg_path)
        if self._ffmpeg_path is None:
            raise RuntimeError("ffmpeg is required for stdout audio streaming but was not found on PATH.")

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
