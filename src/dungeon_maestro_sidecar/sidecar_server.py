from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

from websockets.asyncio.server import serve

from .runtime import LiveSessionRuntime, RuntimeOptions


class SidecarServer:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._clients = set()
        self._runtime: LiveSessionRuntime | None = None
        self._last_status: dict[str, object] = {
            "sessionRunning": False,
            "activeCollection": None,
            "currentTrackTitle": "No track active",
            "currentTrackIndex": None,
            "lastTranscript": "",
            "lastError": "",
        }

    async def handle_connection(self, websocket) -> None:
        self._clients.add(websocket)
        try:
            await websocket.send(json.dumps({"type": "event", "event": "status", "payload": self._last_status}))
            async for message in websocket:
                await self._handle_message(websocket, message)
        finally:
            self._clients.discard(websocket)

    async def _handle_message(self, websocket, message: str) -> None:
        data = json.loads(message)
        command_id = data.get("id")
        command = data.get("command")
        payload = data.get("payload") or {}

        try:
            result = await self._dispatch_command(command, payload)
            response = {"type": "command_result", "id": command_id, "ok": True, "result": result}
        except Exception as exc:
            response = {"type": "command_result", "id": command_id, "ok": False, "error": str(exc)}
        await websocket.send(json.dumps(response))

    async def _dispatch_command(self, command: str, payload: dict[str, Any]) -> dict[str, object]:
        if command == "get_status":
            return self._last_status

        if command == "start_session":
            if self._runtime is not None:
                await asyncio.to_thread(self._runtime.stop)
            options = RuntimeOptions(
                config_path=str(payload.get("config_path") or Path("tabletop-dj.yaml")),
                starting_collection=payload.get("starting_collection"),
                session_state_path=payload.get("session_state_path"),
                resume=bool(payload.get("resume", False)),
                input_device=payload.get("input_device"),
                no_transcription=bool(payload.get("no_transcription", False)),
                no_auto_play=bool(payload.get("no_auto_play", False)),
                discord_token=payload.get("discord_token"),
                discord_guild_id=payload.get("discord_guild_id"),
                discord_voice_channel_id=payload.get("discord_voice_channel_id"),
            )
            self._runtime = LiveSessionRuntime(options, on_event=self._threadsafe_emit)
            self._last_status = await asyncio.to_thread(self._runtime.start)
            return self._last_status

        if command == "end_session":
            if self._runtime is not None:
                self._last_status = await asyncio.to_thread(self._runtime.stop)
                self._runtime = None
            return self._last_status

        if command == "skip_track":
            if self._runtime is None:
                raise RuntimeError("Session is not running")
            self._last_status = await asyncio.to_thread(self._runtime.skip_track)
            return self._last_status

        if command in {"approve_transition", "dismiss_transition"}:
            return self._last_status

        raise RuntimeError(f"Unknown command: {command}")

    def _threadsafe_emit(self, event_name: str, payload: dict[str, object]) -> None:
        if event_name == "track_started":
            self._last_status["activeCollection"] = payload.get("collection")
            self._last_status["currentTrackTitle"] = payload.get("title")
            self._last_status["currentTrackIndex"] = payload.get("track_index")
            self._last_status["sessionRunning"] = True
        elif event_name == "transcript":
            self._last_status["lastTranscript"] = payload.get("text", "")
        elif event_name == "error":
            self._last_status["lastError"] = payload.get("message", "")
        elif event_name == "session_ended":
            self._last_status = dict(payload)

        if self._loop is not None:
            asyncio.run_coroutine_threadsafe(self._broadcast(event_name, payload), self._loop)

    async def _broadcast(self, event_name: str, payload: dict[str, object]) -> None:
        if not self._clients:
            return
        message = json.dumps({"type": "event", "event": event_name, "payload": payload})
        stale_clients = []
        for client in list(self._clients):
            try:
                await client.send(message)
            except Exception:
                stale_clients.append(client)
        for client in stale_clients:
            self._clients.discard(client)


async def run_server(host: str, port: int) -> None:
    server = SidecarServer()
    server._loop = asyncio.get_running_loop()
    async with serve(server.handle_connection, host, port):
        await asyncio.Future()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="DungeonMaestro sidecar WebSocket server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9001)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    asyncio.run(run_server(args.host, args.port))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())