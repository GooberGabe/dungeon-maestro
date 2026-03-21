from __future__ import annotations

import asyncio
from concurrent.futures import CancelledError as FutureCancelledError
from concurrent.futures import TimeoutError as FutureTimeoutError
import threading
from typing import Callable

from .models import ResolvedTrack
from .playback import FfmpegStdoutStreamer, PlaybackController

try:
    import discord as _discord_base
except ImportError:
    _discord_base = None


if _discord_base is not None:
    DiscordAudioSourceBase = _discord_base.AudioSource
else:
    class DiscordAudioSourceBase:
        pass


class DiscordPcmAudioSource(DiscordAudioSourceBase):
    def __init__(
        self,
        track: ResolvedTrack,
        ffmpeg_path: str | None = None,
        playback_controller: PlaybackController | None = None,
    ) -> None:
        _load_discord_module()
        self.track = track
        self._streamer = FfmpegStdoutStreamer(ffmpeg_path)
        self._playback_controller = playback_controller or PlaybackController()
        self._process, self._ytdlp_process = self._streamer._start_processes(
            track,
            self._streamer._build_ffmpeg_pcm_command(),
        )
        self._buffer = b""
        self._eof = False
        self._closed = False
        self._suppress_finished_callback = False

    def read(self) -> bytes:
        if self._closed:
            return b""

        if self._eof and not self._buffer:
            self.cleanup()
            return b""

        frame_size = 3_840
        stdout_pipe = self._process.stdout
        if stdout_pipe is None:
            self.cleanup()
            return b""

        while len(self._buffer) < frame_size:
            chunk = stdout_pipe.read(frame_size - len(self._buffer))
            if not chunk:
                break
            self._buffer += chunk

        if not self._buffer:
            self.cleanup()
            return b""

        if len(self._buffer) < frame_size:
            frame = self._buffer + (b"\x00" * (frame_size - len(self._buffer)))
            self._buffer = b""
            self._eof = True
            return self._playback_controller.apply_gain(frame)

        frame = self._buffer[:frame_size]
        self._buffer = self._buffer[frame_size:]
        return self._playback_controller.apply_gain(frame)

    def is_opus(self) -> bool:
        return False

    def cleanup(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._streamer._finalize_processes(self._process, self._ytdlp_process, hit_limit=True)


class _ReadyDiscordClient:
    def __init__(self, ready_callback) -> None:
        discord = _load_discord_module()
        intents = discord.Intents.none()
        intents.guilds = True
        intents.voice_states = True

        class ReadyClient(discord.Client):
            async def on_ready(self_nonlocal) -> None:
                ready_callback()

        self.client = ReadyClient(intents=intents)


class DiscordVoiceBridge:
    def __init__(
        self,
        token: str,
        voice_channel_id: int,
        guild_id: int | None = None,
        ffmpeg_path: str | None = None,
        playback_controller: PlaybackController | None = None,
        on_track_finished: Callable[[ResolvedTrack], None] | None = None,
    ) -> None:
        if not token.strip():
            raise RuntimeError("Discord token is required")

        self._token = token
        self._voice_channel_id = voice_channel_id
        self._guild_id = guild_id
        self._ffmpeg_path = ffmpeg_path
        self._playback_controller = playback_controller or PlaybackController()
        self._on_track_finished = on_track_finished
        self._loop: asyncio.AbstractEventLoop | None = None
        self._client = None
        self._thread: threading.Thread | None = None
        self._ready_event = threading.Event()
        self._startup_error: BaseException | None = None
        self._playback_error: BaseException | None = None
        self._active_source: DiscordPcmAudioSource | None = None
        self._state_lock = threading.Lock()

    def start(self, timeout_seconds: float = 30.0) -> None:
        if self._thread is not None:
            return

        self._thread = threading.Thread(target=self._thread_main, daemon=True, name="discord-voice-bridge")
        self._thread.start()
        if not self._ready_event.wait(timeout_seconds):
            raise RuntimeError("Timed out waiting for Discord bot to connect")
        if self._startup_error is not None:
            raise RuntimeError(f"Discord bot failed to start: {self._startup_error}")
        self._run_coroutine(self._connect_voice_channel(), timeout_seconds)

    def play(self, track: ResolvedTrack, timeout_seconds: float = 15.0) -> None:
        self._run_coroutine(self._play_track(track), timeout_seconds)

    def pause(self, timeout_seconds: float = 10.0) -> None:
        self._run_coroutine(self._pause_playback(), timeout_seconds)

    def resume(self, timeout_seconds: float = 10.0) -> None:
        self._run_coroutine(self._resume_playback(), timeout_seconds)

    def stop(self, timeout_seconds: float = 10.0) -> None:
        if self._thread is None:
            return
        try:
            if self._loop is not None and self._thread.is_alive():
                try:
                    self._run_coroutine(self._shutdown(), timeout_seconds)
                except (RuntimeError, FutureCancelledError):
                    pass
        finally:
            self._thread.join(timeout=timeout_seconds)
            self._thread = None
            self._loop = None
            self._client = None
            self._ready_event.clear()
            self._startup_error = None

    def _thread_main(self) -> None:
        loop = asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)
        ready_client = _ReadyDiscordClient(self._ready_event.set)
        self._client = ready_client.client

        try:
            loop.run_until_complete(self._client.start(self._token))
        except BaseException as exc:
            self._startup_error = exc
            self._ready_event.set()
        finally:
            try:
                pending = asyncio.all_tasks(loop)
                for task in pending:
                    task.cancel()
                if pending:
                    loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
                loop.run_until_complete(loop.shutdown_asyncgens())
            finally:
                loop.close()

    def _run_coroutine(self, coroutine, timeout_seconds: float):
        if self._loop is None:
            raise RuntimeError("Discord bot is not running")

        future = asyncio.run_coroutine_threadsafe(coroutine, self._loop)
        try:
            return future.result(timeout=timeout_seconds)
        except FutureTimeoutError as exc:
            future.cancel()
            raise RuntimeError("Timed out waiting for Discord operation") from exc

    async def _connect_voice_channel(self):
        discord = _load_discord_module()
        if self._client is None:
            raise RuntimeError("Discord client is not initialized")

        channel = self._client.get_channel(self._voice_channel_id)
        guild = self._client.get_guild(self._guild_id) if self._guild_id is not None else None
        if channel is None and guild is not None:
            channel = guild.get_channel(self._voice_channel_id)
        if channel is None:
            try:
                if guild is not None:
                    channel = await guild.fetch_channel(self._voice_channel_id)
                else:
                    channel = await self._client.fetch_channel(self._voice_channel_id)
            except Exception as exc:
                raise RuntimeError(
                    f"Discord voice channel {self._voice_channel_id} could not be fetched: {exc}"
                ) from exc
        if channel is None:
            raise RuntimeError(f"Discord voice channel {self._voice_channel_id} was not found")

        is_connectable = isinstance(channel, (discord.VoiceChannel, discord.StageChannel)) or (
            hasattr(channel, "connect") and hasattr(channel, "guild")
        )
        if not is_connectable:
            channel_type = getattr(getattr(channel, "type", None), "name", type(channel).__name__)
            raise RuntimeError(
                f"Channel {self._voice_channel_id} is not a voice channel (resolved type: {channel_type})"
            )

        voice_client = channel.guild.voice_client
        if voice_client is not None:
            if voice_client.channel.id != channel.id:
                await voice_client.move_to(channel)
            return voice_client

        return await channel.connect(self_deaf=True)

    async def _play_track(self, track: ResolvedTrack) -> None:
        voice_client = await self._connect_voice_channel()
        source = DiscordPcmAudioSource(
            track,
            ffmpeg_path=self._ffmpeg_path,
            playback_controller=self._playback_controller,
        )
        with self._state_lock:
            previous_source = self._active_source
            self._active_source = source
        if voice_client.is_playing() or voice_client.is_paused():
            if previous_source is not None:
                previous_source._suppress_finished_callback = True
            voice_client.stop()
        voice_client.play(source, after=lambda exc: self._after_playback(source, exc))

    async def _pause_playback(self) -> None:
        voice_client = await self._connect_voice_channel()
        if voice_client.is_playing():
            voice_client.pause()

    async def _resume_playback(self) -> None:
        voice_client = await self._connect_voice_channel()
        if voice_client.is_paused():
            voice_client.resume()

    def _after_playback(self, source: DiscordPcmAudioSource, exc) -> None:
        try:
            source.cleanup()
        finally:
            with self._state_lock:
                if self._active_source is source:
                    self._active_source = None
            if exc:
                self._playback_error = exc
            elif not source._suppress_finished_callback and self._on_track_finished is not None:
                self._on_track_finished(source.track)

    async def _shutdown(self) -> None:
        if self._client is None:
            return

        for guild in list(self._client.guilds):
            voice_client = guild.voice_client
            if voice_client is not None:
                if voice_client.is_playing() or voice_client.is_paused():
                    with self._state_lock:
                        if self._active_source is not None:
                            self._active_source._suppress_finished_callback = True
                    voice_client.stop()
                await voice_client.disconnect(force=True)

        await self._client.close()


def _load_discord_module():
    try:
        import discord
    except ImportError as exc:
        raise RuntimeError(
            "discord.py voice dependencies are required for Discord playback. Install discord.py and PyNaCl."
        ) from exc
    return discord