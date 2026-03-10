from __future__ import annotations

from importlib import import_module

from .models import ResolvedTrack


def _load_optional_module(module_name: str):
    return import_module(module_name)


class YtDlpTrackResolver:
    def __init__(self) -> None:
        try:
            yt_dlp = _load_optional_module("yt_dlp")
        except ImportError as exc:
            raise RuntimeError("yt-dlp is required for track resolution.") from exc

        self._yt_dlp = yt_dlp

    def resolve(self, source: str) -> ResolvedTrack:
        query = source if source.startswith("http") else f"ytsearch1:{source}"
        ydl_opts = {
            "format": "bestaudio",
            "quiet": True,
            "no_warnings": True,
            "noplaylist": False,
            "extract_flat": False,
        }
        with self._yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(query, download=False)
            if "entries" in info and info["entries"]:
                info = info["entries"][0]

        return ResolvedTrack(
            source=source,
            title=info.get("title", source),
            webpage_url=info.get("webpage_url") or info.get("original_url"),
            stream_url=info.get("url"),
            duration_seconds=info.get("duration"),
            http_headers=dict(info.get("http_headers") or {}),
        )
