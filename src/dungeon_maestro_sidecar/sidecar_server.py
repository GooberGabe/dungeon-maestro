from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

from websockets.asyncio.server import serve

from .runtime import LiveSessionRuntime, RuntimeOptions, normalize_output_mode
from .transcription import normalize_transcription_profile


class SidecarServer:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._clients = set()
        self._runtime: LiveSessionRuntime | None = None
        self._startup_task: asyncio.Task | None = None
        self._startup_cancel_requested = False
        self._last_status: dict[str, object] = {
            "sessionRunning": False,
            "startupInProgress": False,
            "activeSoundscape": None,
            "activeCollection": None,
            "currentTrackTitle": "No track active",
            "currentTrackIndex": None,
            "lastTranscript": "",
            "lastError": "",
            "pendingTransition": None,
            "transcriptionProfile": None,
            "outputMode": "local",
            "volumePercent": 100,
            "playbackMuted": False,
            "playbackPaused": False,
            "crossfadeEnabled": False,
            "crossfadeDurationSeconds": 3.0,
            "loopEnabled": False,
            "crossfadePauseEnabled": False,
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
            if self._startup_task is not None and not self._startup_task.done():
                return self._last_status
            if self._runtime is not None:
                return self._last_status
            self._startup_cancel_requested = False
            options = RuntimeOptions(
                config_path=str(payload.get("config_path") or Path("dungeon-maestro.yaml")),
                starting_soundscape=payload.get("starting_soundscape"),
                starting_collection=payload.get("starting_collection"),
                session_state_path=payload.get("session_state_path"),
                resume=bool(payload.get("resume", False)),
                input_device=payload.get("input_device"),
                no_transcription=bool(payload.get("no_transcription", False)),
                transcription_profile=(normalize_transcription_profile(payload.get("transcription_profile")) if payload.get("transcription_profile") else None),
                enable_transition_proposals=_optional_bool(payload.get("enable_transition_proposals")),
                transition_popup_timeout=_optional_int(payload.get("transition_popup_timeout")),
                volume_percent=_optional_int(payload.get("volume_percent")),
                muted=_optional_bool(payload.get("muted")),
                paused=_optional_bool(payload.get("paused")),
                output_mode=(normalize_output_mode(payload.get("output_mode")) if payload.get("output_mode") else None),
                no_auto_play=bool(payload.get("no_auto_play", False)),
                discord_token=payload.get("discord_token"),
                discord_guild_id=_optional_int(payload.get("discord_guild_id")),
                discord_voice_channel_id=_optional_int(payload.get("discord_voice_channel_id")),
                crossfade_enabled=_optional_bool(payload.get("crossfade_enabled")),
                crossfade_duration_seconds=_optional_float(payload.get("crossfade_duration_seconds")),
            )
            self._runtime = LiveSessionRuntime(options, on_event=self._threadsafe_emit)
            self._last_status = {
                **self._last_status,
                "sessionRunning": True,
                "startupInProgress": True,
                "activeSoundscape": options.starting_soundscape or options.starting_collection,
                "activeCollection": options.starting_collection or options.starting_soundscape,
                "currentTrackTitle": "Preparing session...",
                "lastError": "",
            }
            self._startup_task = asyncio.create_task(self._start_runtime())
            return self._last_status

        if command == "end_session":
            if self._startup_task is not None and not self._startup_task.done():
                self._startup_cancel_requested = True
                self._last_status = {
                    **self._last_status,
                    "sessionRunning": True,
                    "startupInProgress": True,
                    "currentTrackTitle": "Preparing session...",
                }
                return self._last_status
            if self._runtime is not None:
                self._last_status = await asyncio.to_thread(self._runtime.stop)
                self._runtime = None
            return self._last_status

        if command == "update_session_settings":
            if self._runtime is None:
                raise RuntimeError("Session is not running")
            self._last_status = await asyncio.to_thread(
                self._runtime.update_session_settings,
                transcription_enabled=_optional_bool(payload.get("transcription_enabled")),
                transcription_profile=(normalize_transcription_profile(payload.get("transcription_profile")) if payload.get("transcription_profile") else None),
                enable_transition_proposals=_optional_bool(payload.get("enable_transition_proposals")),
                transition_popup_timeout=_optional_int(payload.get("transition_popup_timeout")),
            )
            return self._last_status

        if command == "update_playback_settings":
            if self._runtime is None:
                raise RuntimeError("Session is not running")
            self._last_status = await asyncio.to_thread(
                self._runtime.update_playback_settings,
                volume_percent=_optional_int(payload.get("volume_percent")),
                muted=_optional_bool(payload.get("muted")),
                paused=_optional_bool(payload.get("paused")),
                crossfade_enabled=_optional_bool(payload.get("crossfade_enabled")),
                crossfade_duration_seconds=_optional_float(payload.get("crossfade_duration_seconds")),
                loop_enabled=_optional_bool(payload.get("loop_enabled")),
                crossfade_pause_enabled=_optional_bool(payload.get("crossfade_pause_enabled")),
            )
            return self._last_status

        if command == "update_output_mode":
            if self._runtime is None:
                raise RuntimeError("Session is not running")
            self._last_status = await asyncio.to_thread(
                self._runtime.update_output_mode,
                normalize_output_mode(payload.get("output_mode")),
            )
            return self._last_status

        if command == "skip_track":
            if self._runtime is None:
                raise RuntimeError("Session is not running")
            self._last_status = await asyncio.to_thread(self._runtime.skip_track)
            return self._last_status

        if command == "seek_track":
            if self._runtime is None:
                raise RuntimeError("Session is not running")
            position = _optional_float(payload.get("position_seconds"))
            if position is None:
                raise RuntimeError("position_seconds is required")
            self._last_status = await asyncio.to_thread(self._runtime.seek_track, position)
            return self._last_status

        if command == "play_track":
            if self._runtime is None:
                raise RuntimeError("Session is not running")
            collection_id = payload.get("collection_id", "")
            track_index = _optional_int(payload.get("track_index"))
            if not collection_id or track_index is None:
                raise RuntimeError("collection_id and track_index are required")
            self._last_status = await asyncio.to_thread(
                self._runtime.play_track_at_index, collection_id, track_index
            )
            return self._last_status

        if command == "play_soundscape_track":
            if self._runtime is None:
                raise RuntimeError("Session is not running")
            soundscape_id = payload.get("soundscape_id", payload.get("collection_id", ""))
            track_index = _optional_int(payload.get("track_index"))
            if not soundscape_id or track_index is None:
                raise RuntimeError("soundscape_id and track_index are required")
            self._last_status = await asyncio.to_thread(
                self._runtime.play_track_at_index, soundscape_id, track_index
            )
            return self._last_status

        if command == "switch_collection":
            if self._runtime is None:
                raise RuntimeError("Session is not running")
            collection_id = payload.get("collection_id", "")
            if not collection_id:
                raise RuntimeError("collection_id is required")
            self._last_status = await asyncio.to_thread(self._runtime.switch_collection, collection_id)
            return self._last_status

        if command == "switch_soundscape":
            if self._runtime is None:
                raise RuntimeError("Session is not running")
            soundscape_id = payload.get("soundscape_id", payload.get("collection_id", ""))
            if not soundscape_id:
                raise RuntimeError("soundscape_id is required")
            self._last_status = await asyncio.to_thread(self._runtime.switch_collection, soundscape_id)
            return self._last_status

        if command == "approve_transition":
            if self._runtime is None:
                raise RuntimeError("Session is not running")
            self._last_status = await asyncio.to_thread(self._runtime.approve_transition)
            return self._last_status

        if command == "dismiss_transition":
            if self._runtime is None:
                raise RuntimeError("Session is not running")
            self._last_status = await asyncio.to_thread(self._runtime.dismiss_transition)
            return self._last_status

        raise RuntimeError(f"Unknown command: {command}")

    async def _start_runtime(self) -> None:
        if self._runtime is None:
            return
        try:
            self._last_status = await asyncio.to_thread(self._runtime.start)
            if self._startup_cancel_requested and self._runtime is not None:
                self._last_status = await asyncio.to_thread(self._runtime.stop)
                self._runtime = None
                self._startup_cancel_requested = False
                self._last_status["startupInProgress"] = False
                await self._broadcast("status", self._last_status)
                return
            self._last_status["startupInProgress"] = False
            await self._broadcast("status", self._last_status)
        except Exception as exc:
            self._last_status = {
                **self._last_status,
                "sessionRunning": False,
                "startupInProgress": False,
                "currentTrackTitle": "No track active",
                "currentTrackIndex": None,
                "lastError": str(exc),
            }
            await self._broadcast("error", {"code": "startup", "message": str(exc)})
            await self._broadcast("status", self._last_status)
        finally:
            self._startup_cancel_requested = False
            self._startup_task = None

    def _threadsafe_emit(self, event_name: str, payload: dict[str, object]) -> None:
        if event_name == "track_started":
            self._last_status["activeSoundscape"] = payload.get("soundscape", payload.get("collection"))
            self._last_status["activeCollection"] = payload.get("collection")
            self._last_status["currentTrackTitle"] = payload.get("title")
            self._last_status["currentTrackIndex"] = payload.get("track_index")
            self._last_status["sessionRunning"] = True
            self._last_status["startupInProgress"] = False
        elif event_name == "transcript":
            self._last_status["lastTranscript"] = payload.get("text", "")
        elif event_name == "error":
            self._last_status["lastError"] = payload.get("message", "")
        elif event_name == "transition_pending":
            self._last_status["pendingTransition"] = {
                "keyword": payload.get("keyword"),
                "targetSoundscape": payload.get("target_soundscape", payload.get("target_collection")),
                "targetCollection": payload.get("target_collection"),
                "displayName": payload.get("display_name"),
            }
        elif event_name == "playback_settings_updated":
            self._last_status["volumePercent"] = payload.get("volumePercent", self._last_status["volumePercent"])
            self._last_status["playbackMuted"] = payload.get("playbackMuted", self._last_status["playbackMuted"])
            self._last_status["playbackPaused"] = payload.get("playbackPaused", self._last_status["playbackPaused"])
            self._last_status["loopEnabled"] = payload.get("loopEnabled", self._last_status["loopEnabled"])
            self._last_status["crossfadePauseEnabled"] = payload.get("crossfadePauseEnabled", self._last_status["crossfadePauseEnabled"])
        elif event_name == "session_settings_updated":
            self._last_status["transcriptionProfile"] = payload.get("transcription_profile", self._last_status["transcriptionProfile"])
        elif event_name == "output_mode_updated":
            self._last_status["outputMode"] = payload.get("outputMode", self._last_status["outputMode"])
        elif event_name in {"transition_dismissed", "transition_approved"}:
            self._last_status["pendingTransition"] = None
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


def _optional_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    return int(value)


def _optional_bool(value: Any) -> bool | None:
    if value is None:
        return None
    return bool(value)


def _optional_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    return float(value)


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