from __future__ import annotations

import argparse
import json
import sys

from .tracks import YtDlpTrackResolver


def build_preview_payload(source: str) -> dict[str, object]:
    resolver = YtDlpTrackResolver()
    try:
        track = resolver.resolve(source)
    except Exception as exc:  # pragma: no cover - CLI boundary path
        return {
            "ok": False,
            "source": source,
            "message": str(exc),
        }

    return {
        "ok": True,
        "source": source,
        "title": track.title,
        "webpage_url": track.webpage_url,
        "duration_seconds": track.duration_seconds,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Resolve lightweight preview metadata for a track source.")
    parser.add_argument("source", help="Track source to probe, either a search term or URL.")
    args = parser.parse_args()

    payload = build_preview_payload(args.source)
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())