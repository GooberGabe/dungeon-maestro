from __future__ import annotations

from .models import KeywordMatch, Soundscape


class KeywordMatcher:
    def __init__(self, soundscapes: list[Soundscape]) -> None:
        self._soundscapes = soundscapes

    def match(self, text: str, active_soundscape_id: str) -> KeywordMatch | None:
        normalized = text.lower().strip()
        if not normalized:
            return None

        candidates: list[tuple[int, int, Soundscape, str]] = []
        for soundscape in self._soundscapes:
            if soundscape.soundscape_id == active_soundscape_id:
                continue
            for keyword in soundscape.keywords:
                lowered = keyword.lower()
                if lowered in normalized:
                    exact_phrase = 1 if lowered == normalized or f" {lowered} " in f" {normalized} " else 0
                    candidates.append((exact_phrase, len(lowered), soundscape, keyword))

        if not candidates:
            return None

        candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
        _, _, soundscape, keyword = candidates[0]
        return KeywordMatch(
            soundscape_id=soundscape.soundscape_id,
            soundscape_name=soundscape.name,
            keyword=keyword,
        )
