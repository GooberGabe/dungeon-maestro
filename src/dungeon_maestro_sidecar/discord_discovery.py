from __future__ import annotations

import argparse
import asyncio
import json
import os


def _load_discord_module():
    try:
        import discord
    except ImportError as exc:
        raise RuntimeError(
            "discord.py is required for Discord discovery. Install discord.py before resolving channels."
        ) from exc
    return discord


async def discover_discord_targets(token: str) -> dict[str, object]:
    if not token.strip():
        raise RuntimeError("Discord token is required")

    discord = _load_discord_module()
    intents = discord.Intents.none()
    intents.guilds = True

    results: dict[str, object] = {"bot_user": None, "guilds": []}

    class DiscoveryClient(discord.Client):
        async def on_ready(self) -> None:
            try:
                results["bot_user"] = {
                    "id": str(self.user.id) if self.user is not None else None,
                    "username": str(self.user) if self.user is not None else "Unknown bot",
                }
                guilds_payload: list[dict[str, object]] = []
                for guild in sorted(self.guilds, key=lambda item: item.name.lower()):
                    try:
                        fetched_channels = await guild.fetch_channels()
                    except Exception:
                        fetched_channels = list(guild.channels)

                    voice_channels = []
                    for channel in fetched_channels:
                        if isinstance(channel, (discord.VoiceChannel, discord.StageChannel)):
                            voice_channels.append(
                                {
                                    "id": str(channel.id),
                                    "name": channel.name,
                                    "type": "stage" if isinstance(channel, discord.StageChannel) else "voice",
                                }
                            )

                    guilds_payload.append(
                        {
                            "id": str(guild.id),
                            "name": guild.name,
                            "voice_channels": sorted(voice_channels, key=lambda item: item["name"].lower()),
                        }
                    )

                results["guilds"] = guilds_payload
            finally:
                await self.close()

    client = DiscoveryClient(intents=intents)
    await client.start(token)
    return results


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Discover Discord guilds and voice channels for a bot token")
    parser.add_argument(
        "--token-env",
        default="DUNGEON_MAESTRO_DISCORD_TOKEN",
        help="Environment variable name that contains the bot token",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    token = os.environ.get(args.token_env, "")
    payload = asyncio.run(discover_discord_targets(token))
    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())