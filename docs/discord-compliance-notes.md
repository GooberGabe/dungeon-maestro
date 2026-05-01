# Discord Compliance Notes

This document defines runtime and release safeguards for Discord integration in DungeonMaestro.

## Runtime Guardrails

- Authentication must use bot tokens only.
- User-token and self-bot workflows are not supported.
- Discord intents must remain least-privilege:
  - `guilds`
  - `voice_states`
- Strict compliance mode is enabled by default in desktop-launched sidecar sessions via `DUNGEON_MAESTRO_DISCORD_COMPLIANCE_STRICT=1`.
- Runtime guardrails include bounded retries and action rate limiting for:
  - voice channel connect
  - voice channel move
  - track switch operations
  - presence updates

## Logging and Data Hygiene

- Compliance events are recorded as JSONL in the desktop app user-data logs directory.
- Logged payload fields are sanitized before write:
  - token-like fields are redacted
  - `*_id` fields are hashed
  - long free-text fields are truncated
- Compliance logging errors must never impact playback/session behavior.

## Release and CI Requirements

- Strict release secret guard must pass for tracked files.
- Strict release secret guard must pass for packaged resources.
- Strict release secret guard must pass for desktop dist artifacts.
- CI must run strict guard checks before build/test stages.

## Incident Response

If Discord policy-risk behavior or credential leakage is suspected:

1. Disable Discord output path in release artifacts until resolved.
2. Revoke and rotate affected bot token immediately.
3. Run strict release guard scans across source and packaged outputs.
4. Review compliance logs for high-frequency reconnect/move/switch patterns.
5. Document root cause and corrective actions before re-enabling Discord route.
