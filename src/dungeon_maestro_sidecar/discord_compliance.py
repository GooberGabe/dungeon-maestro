from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import re
import time
from typing import Iterable


_TOKEN_RE = re.compile(r"(token|secret|password|authorization)", re.IGNORECASE)


def coerce_strict_mode(value: object | None) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return True
    text = str(value).strip().lower()
    if text in {"", "1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return True


def assert_intents_configuration(
    intents,
    *,
    required_enabled: Iterable[str],
    allowed_enabled: Iterable[str],
) -> None:
    required = {item for item in required_enabled}
    allowed = {item for item in allowed_enabled}
    enabled = {
        name
        for name in dir(intents)
        if not name.startswith("_") and isinstance(getattr(intents, name, None), bool) and getattr(intents, name)
    }

    missing_required = sorted(required - enabled)
    if missing_required:
        raise RuntimeError(f"Missing required Discord intents: {', '.join(missing_required)}")

    disallowed = sorted(enabled - allowed)
    if disallowed:
        raise RuntimeError(f"Disallowed Discord intents enabled: {', '.join(disallowed)}")


@dataclass(frozen=True)
class RateLimitRule:
    action: str
    max_events: int
    window_seconds: float


class ComplianceRateLimiter:
    def __init__(self, rules: list[RateLimitRule]) -> None:
        self._rules = {rule.action: rule for rule in rules}
        self._events: dict[tuple[str, str], deque[float]] = defaultdict(deque)

    def allow(self, key: str, action: str, now: float | None = None) -> tuple[bool, float]:
        rule = self._rules.get(action)
        if rule is None:
            return True, 0.0

        current = time.monotonic() if now is None else now
        bucket_key = (key, action)
        bucket = self._events[bucket_key]
        cutoff = current - rule.window_seconds
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()

        if len(bucket) >= rule.max_events:
            retry_after = max(0.0, (bucket[0] + rule.window_seconds) - current)
            return False, retry_after

        bucket.append(current)
        return True, 0.0


def is_transient_discord_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    transient_terms = (
        "rate limit",
        "timed out",
        "temporarily",
        "connection reset",
        "server disconnected",
        "503",
        "502",
        "429",
    )
    return any(term in text for term in transient_terms)


def short_hash(value: object | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return digest[:12]


def sanitize_payload(payload: dict[str, object]) -> dict[str, object]:
    safe: dict[str, object] = {}
    for key, value in payload.items():
        if _TOKEN_RE.search(key):
            safe[key] = "[redacted]"
            continue

        if key.endswith("_id"):
            safe[f"{key}_hash"] = short_hash(value)
            continue

        if isinstance(value, str):
            safe[key] = value[:160]
        else:
            safe[key] = value

    return safe


def compliance_event_payload(event_name: str, payload: dict[str, object]) -> dict[str, object]:
    return {
        "name": event_name,
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        "payload": sanitize_payload(payload),
    }
