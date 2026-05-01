from __future__ import annotations

import unittest

from dungeon_maestro_sidecar.discord_compliance import (
    ComplianceRateLimiter,
    RateLimitRule,
    assert_intents_configuration,
    coerce_strict_mode,
    sanitize_payload,
)


class _FakeIntents:
    guilds = True
    voice_states = True
    message_content = False


class DiscordComplianceTests(unittest.TestCase):
    def test_coerce_strict_mode_defaults_true(self) -> None:
        self.assertTrue(coerce_strict_mode(None))
        self.assertTrue(coerce_strict_mode(""))
        self.assertTrue(coerce_strict_mode("true"))
        self.assertFalse(coerce_strict_mode("false"))

    def test_intents_assertion_rejects_disallowed_enabled(self) -> None:
        intents = _FakeIntents()
        intents.message_content = True

        with self.assertRaises(RuntimeError):
            assert_intents_configuration(
                intents,
                required_enabled={"guilds", "voice_states"},
                allowed_enabled={"guilds", "voice_states"},
            )

    def test_intents_assertion_accepts_allowed_set(self) -> None:
        intents = _FakeIntents()

        assert_intents_configuration(
            intents,
            required_enabled={"guilds", "voice_states"},
            allowed_enabled={"guilds", "voice_states"},
        )

    def test_rate_limiter_blocks_excess_with_retry_after(self) -> None:
        limiter = ComplianceRateLimiter([RateLimitRule(action="connect", max_events=2, window_seconds=10.0)])

        allow_one, retry_one = limiter.allow("guild:1", "connect", now=100.0)
        allow_two, retry_two = limiter.allow("guild:1", "connect", now=101.0)
        allow_three, retry_three = limiter.allow("guild:1", "connect", now=101.5)

        self.assertTrue(allow_one)
        self.assertEqual(retry_one, 0.0)
        self.assertTrue(allow_two)
        self.assertEqual(retry_two, 0.0)
        self.assertFalse(allow_three)
        self.assertGreater(retry_three, 0.0)

    def test_sanitize_payload_redacts_and_hashes(self) -> None:
        payload = {
            "discord_token": "abc123secretvalue",
            "guild_id": "1234567890",
            "voice_channel_id": "9876543210",
            "track_title": "x" * 300,
        }

        safe = sanitize_payload(payload)

        self.assertEqual(safe["discord_token"], "[redacted]")
        self.assertNotIn("guild_id", safe)
        self.assertIn("guild_id_hash", safe)
        self.assertNotIn("voice_channel_id", safe)
        self.assertIn("voice_channel_id_hash", safe)
        self.assertLessEqual(len(safe["track_title"]), 160)


if __name__ == "__main__":
    unittest.main()
