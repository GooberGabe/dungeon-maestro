from __future__ import annotations

from .models import Collection, KeywordMatch


class KeywordMatcher:
    def __init__(self, collections: list[Collection]) -> None:
        self._collections = collections

    def match(self, text: str, active_collection_id: str) -> KeywordMatch | None:
        normalized = text.lower().strip()
        if not normalized:
            return None

        candidates: list[tuple[int, int, Collection, str]] = []
        for collection in self._collections:
            if collection.collection_id == active_collection_id:
                continue
            for keyword in collection.keywords:
                lowered = keyword.lower()
                if lowered in normalized:
                    exact_phrase = 1 if lowered == normalized or f" {lowered} " in f" {normalized} " else 0
                    candidates.append((exact_phrase, len(lowered), collection, keyword))

        if not candidates:
            return None

        candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
        _, _, collection, keyword = candidates[0]
        return KeywordMatch(
            collection_id=collection.collection_id,
            collection_name=collection.name,
            keyword=keyword,
        )
