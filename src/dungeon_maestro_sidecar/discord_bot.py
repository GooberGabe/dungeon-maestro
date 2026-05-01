from __future__ import annotations

import asyncio
from concurrent.futures import CancelledError as FutureCancelledError
from concurrent.futures import TimeoutError as FutureTimeoutError
import os
import time
import threading
from typing import Callable

from .models import ResolvedTrack
from .playback import FfmpegStdoutStreamer, PlaybackController
from .discord_pcm_mixer_source import DiscordPcmMixerSource
from .pcm_mixer import PcmMixer
from .track_buffer import TrackBuffer
from .discord_audio_base import DiscordAudioSourceBase
from .discord_compliance import (
    ComplianceRateLimiter,
    RateLimitRule,
    assert_intents_configuration,
    coerce_strict_mode,
    compliance_event_payload,
    is_transient_discord_error,
)

try:
    import discord as _discord_base
except ImportError:
    _discord_base = None


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

    @property
    def playback_position_seconds(self) -> float:
        # 3840 bytes per frame = 20ms at 48kHz stereo (2 bytes/sample * 2 channels * 48000 Hz * 0.02s)
        # self._frames_sent is the number of frames sent
        return getattr(self, '_frames_sent', 0) * 0.02

    def read(self) -> bytes:
        if self._closed:
            return b""

        # Track frames sent for playback position
        if not hasattr(self, '_frames_sent'):
            self._frames_sent = 0

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
            self._frames_sent += 1
            return self._playback_controller.apply_gain(frame)

        frame = self._buffer[:frame_size]
        self._buffer = self._buffer[frame_size:]
        self._frames_sent += 1
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
        assert_intents_configuration(
            intents,
            required_enabled={"guilds", "voice_states"},
            allowed_enabled={"guilds", "voice_states"},
        )

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
        on_compliance_event: Callable[[dict[str, object]], None] | None = None,
        crossfade_enabled: bool = False,
        crossfade_duration: float = 3.0,
        strict_mode: bool | None = None,
    ) -> None:
        if not token.strip():
            raise RuntimeError("Discord token is required")

        self._token = token
        self._voice_channel_id = voice_channel_id
        self._guild_id = guild_id
        self._ffmpeg_path = ffmpeg_path
        self._playback_controller = playback_controller or PlaybackController()
        self._on_track_finished = on_track_finished
        self._on_compliance_event = on_compliance_event
        self._crossfade_enabled = bool(crossfade_enabled)
        self._crossfade_duration = max(0.5, min(15.0, float(crossfade_duration)))
        self._strict_mode = coerce_strict_mode(strict_mode if strict_mode is not None else os.environ.get("DUNGEON_MAESTRO_DISCORD_COMPLIANCE_STRICT"))
        self._bridge_key = f"guild:{self._guild_id or 'auto'}:channel:{self._voice_channel_id}"
        self._rate_limiter = ComplianceRateLimiter(
            rules=[
                RateLimitRule(action="connect", max_events=20, window_seconds=60.0),
                RateLimitRule(action="move", max_events=20, window_seconds=60.0),
                RateLimitRule(action="play_switch", max_events=120, window_seconds=60.0),
                RateLimitRule(action="presence_update", max_events=60, window_seconds=60.0),
            ]
        )
        self._loop: asyncio.AbstractEventLoop | None = None
        self._client = None
        self._thread: threading.Thread | None = None
        self._ready_event = threading.Event()
        self._startup_error: BaseException | None = None
        self._playback_error: BaseException | None = None
        self._active_source: DiscordPcmAudioSource | None = None
        self._state_lock = threading.Lock()
        self._last_presence_title: str | None = None
        self._last_presence_at = 0.0

    def start(self, timeout_seconds: float = 30.0) -> None:
        if self._thread is not None:
            return

        self._emit_compliance(
            "discord_connect_requested",
            {
                "guild_id": self._guild_id,
                "voice_channel_id": self._voice_channel_id,
                "strict_mode": self._strict_mode,
            },
        )

        self._thread = threading.Thread(target=self._thread_main, daemon=True, name="discord-voice-bridge")
        self._thread.start()
        if not self._ready_event.wait(timeout_seconds):
            self._emit_compliance("discord_connect_timeout", {"timeout_seconds": timeout_seconds})
            raise RuntimeError("Timed out waiting for Discord bot to connect")
        if self._startup_error is not None:
            self._emit_compliance("discord_connect_failed", {"error": str(self._startup_error)})
            raise RuntimeError(f"Discord bot failed to start: {self._startup_error}")
        self._run_coroutine(self._connect_voice_channel(), timeout_seconds)
        self._emit_compliance("discord_connect_succeeded", {"voice_channel_id": self._voice_channel_id})

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

    def set_crossfade_enabled(self, enabled: bool) -> None:
        self._crossfade_enabled = bool(enabled)

    def set_crossfade_duration(self, duration_seconds: float) -> None:
        self._crossfade_duration = max(0.5, min(15.0, float(duration_seconds)))

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

        allowed, retry_after = self._rate_limiter.allow(self._bridge_key, "connect")
        if not allowed:
            self._emit_compliance(
                "discord_connect_throttled",
                {"retry_after_seconds": round(retry_after, 3)},
            )
            if self._strict_mode:
                raise RuntimeError("Discord connect throttled due to excessive reconnect activity")

        channel = self._client.get_channel(self._voice_channel_id)
        guild = self._client.get_guild(self._guild_id) if self._guild_id is not None else None
        if channel is None and guild is not None:
            channel = guild.get_channel(self._voice_channel_id)
        if channel is None:
            try:
                if guild is not None:
                    channel = await self._run_with_retry(
                        "fetch_channel",
                        lambda: guild.fetch_channel(self._voice_channel_id),
                    )
                else:
                    channel = await self._run_with_retry(
                        "fetch_channel",
                        lambda: self._client.fetch_channel(self._voice_channel_id),
                    )
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
                move_allowed, retry_after = self._rate_limiter.allow(self._bridge_key, "move")
                if not move_allowed:
                    self._emit_compliance(
                        "discord_move_throttled",
                        {"retry_after_seconds": round(retry_after, 3)},
                    )
                    if self._strict_mode:
                        raise RuntimeError("Discord voice move throttled due to excessive channel moves")
                await self._run_with_retry("move_channel", lambda: voice_client.move_to(channel))
                self._emit_compliance("discord_channel_moved", {"voice_channel_id": channel.id})
            return voice_client

        connected_client = await self._run_with_retry("connect_channel", lambda: channel.connect(self_deaf=True))
        self._emit_compliance("discord_channel_joined", {"voice_channel_id": channel.id})
        return connected_client

    async def _play_track(self, track: ResolvedTrack) -> None:
        voice_client = await self._connect_voice_channel()
        allowed, retry_after = self._rate_limiter.allow(self._bridge_key, "play_switch")
        if not allowed:
            self._emit_compliance(
                "discord_track_switch_throttled",
                {
                    "retry_after_seconds": round(retry_after, 3),
                    "track_title": track.title,
                },
            )
            if self._strict_mode:
                raise RuntimeError("Discord track switching temporarily throttled")

        await self._update_presence(track)
        crossfade_enabled = self._crossfade_enabled
        crossfade_duration = self._crossfade_duration
        print(f"[discord] switch_track title={track.title} crossfade={crossfade_enabled} duration={crossfade_duration}")
        # Use a persistent mixer for Discord output
        if not hasattr(self, '_pcm_mixer') or self._pcm_mixer is None or not self._pcm_mixer.is_alive():
            self._pcm_mixer = PcmMixer()
            self._discord_source = DiscordPcmMixerSource(self._pcm_mixer, playback_controller=self._playback_controller)
            print("[discord] created new PCM mixer")
        # Keep previous track playing until the new track has produced audio.
        with self._state_lock:
            previous_source = self._active_source
            self._active_source = self._discord_source
        previous_track = getattr(self, '_last_mixer_track', None)
        # Predecode into a buffer so switching does not gap.
        new_buffer = TrackBuffer(
            track,
            prebuffer_frames=100,
            ffmpeg_path=self._ffmpeg_path,
        )
        new_buffer.start()
        new_buffer.wait_ready(timeout=5.0)

        def buffer_source():
            while not new_buffer.finished or new_buffer.buffered_frames > 0:
                yield new_buffer.read_frame(timeout=0.5)

        def _on_track_finished() -> None:
            new_buffer.stop()
            if self._on_track_finished is not None:
                self._on_track_finished(track)

        fade_in = crossfade_duration if crossfade_enabled else None
        new_track = self._pcm_mixer.add_track(buffer_source(), fade_in=fade_in, on_finished=_on_track_finished)
        # Start mixer thread if not running
        self._discord_source.start()
        if not (voice_client.is_playing() or voice_client.is_paused()):
            voice_client.play(self._discord_source, after=lambda exc: self._after_playback(self._discord_source, exc))
            print("[discord] voice_client.play started")
        # Track the last added mixer track for future transitions
        self._last_mixer_track = new_track
        previous_buffer = getattr(self, '_last_track_buffer', None)
        if previous_track is not None:
            if crossfade_enabled:
                fade_out = crossfade_duration
                self._pcm_mixer.remove_track(previous_track, fade_out=fade_out)
                print("[discord] requested mixer fade out")
            else:
                self._pcm_mixer.remove_track(previous_track, fade_out=None)
                print("[discord] removed previous track")
            if not crossfade_enabled and previous_buffer is not None:
                previous_buffer.stop()
        self._last_track_buffer = new_buffer
        print(f"[discord] active_tracks={len(self._pcm_mixer.tracks)}")
        self._emit_compliance(
            "discord_track_switch",
            {
                "track_title": track.title,
                "crossfade_enabled": crossfade_enabled,
                "crossfade_duration": crossfade_duration,
            },
        )

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

        await self._update_presence(None)

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

    async def _update_presence(self, track: ResolvedTrack | None) -> None:
        if self._client is None:
            return

        now = time.monotonic()
        if now - self._last_presence_at < 1.0 and track is not None:
            return

        allowed, retry_after = self._rate_limiter.allow(self._bridge_key, "presence_update", now=now)
        if not allowed:
            self._emit_compliance(
                "discord_presence_throttled",
                {"retry_after_seconds": round(retry_after, 3)},
            )
            return

        discord = _load_discord_module()
        activity = None
        title = None
        if track is not None:
            title = (track.title or track.source or "").strip() or "Unknown track"
            if len(title) > 128:
                title = f"{title[:125]}..."
            activity = discord.Activity(
                type=discord.ActivityType.listening,
                name=f"Now playing: {title}",
            )

        try:
            await self._run_with_retry("change_presence", lambda: self._client.change_presence(activity=activity))
            self._last_presence_title = title
            self._last_presence_at = now
            self._emit_compliance(
                "discord_presence_updated",
                {
                    "track_title": title,
                    "activity_enabled": bool(activity),
                },
            )
        except Exception as exc:
            print(f"[discord] presence update failed: {exc}")
            self._emit_compliance("discord_presence_failed", {"error": str(exc)})

    async def _run_with_retry(self, operation: str, coro_factory, attempts: int = 3):
        last_exc = None
        for attempt in range(1, attempts + 1):
            try:
                return await coro_factory()
            except Exception as exc:
                last_exc = exc
                transient = is_transient_discord_error(exc)
                self._emit_compliance(
                    "discord_operation_failed",
                    {
                        "operation": operation,
                        "attempt": attempt,
                        "transient": transient,
                        "error": str(exc),
                    },
                )
                if attempt >= attempts or not transient:
                    raise
                await asyncio.sleep(min(1.5, (0.25 * (2 ** (attempt - 1))) + (0.05 * attempt)))

        if last_exc is not None:
            raise last_exc

    def _emit_compliance(self, event_name: str, payload: dict[str, object]) -> None:
        if self._on_compliance_event is None:
            return
        try:
            self._on_compliance_event(compliance_event_payload(event_name, payload))
        except Exception:
            return


def _load_discord_module():
    try:
        import discord
    except ImportError as exc:
        raise RuntimeError(
            "discord.py voice dependencies are required for Discord playback. Install discord.py and PyNaCl."
        ) from exc
    return discord