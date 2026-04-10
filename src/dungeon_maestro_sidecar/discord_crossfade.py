import time
import audioop

from .playback import FfmpegStdoutStreamer, PlaybackController
from .models import ResolvedTrack
try:
    import discord as _discord_base
except ImportError:
    _discord_base = None

if _discord_base is not None:
    DiscordAudioSourceBase = _discord_base.AudioSource
else:
    class DiscordAudioSourceBase:
        pass

class DiscordCrossfadeAudioSource(DiscordAudioSourceBase):
    """
    Audio source for Discord that crossfades between two tracks.
    """
    def __init__(
        self,
        outgoing_track: ResolvedTrack,
        incoming_track: ResolvedTrack,
        crossfade_duration: float = 3.0,
        ffmpeg_path: str | None = None,
        playback_controller: PlaybackController | None = None,
        outgoing_seek_offset: float = 0.0,
    ):
        self.track = incoming_track
        self._crossfade_duration = max(0.5, min(15.0, crossfade_duration))
        self._start_time = time.monotonic()
        self._outgoing_streamer = FfmpegStdoutStreamer(ffmpeg_path)
        self._incoming_streamer = FfmpegStdoutStreamer(ffmpeg_path)
        # Start outgoing ffmpeg at the correct seek offset
        self._outgoing_proc, self._outgoing_ytdlp = self._outgoing_streamer._start_processes(
            outgoing_track, self._outgoing_streamer._build_ffmpeg_pcm_command(seek_offset_seconds=outgoing_seek_offset)
        )
        self._incoming_proc, self._incoming_ytdlp = self._incoming_streamer._start_processes(
            incoming_track, self._incoming_streamer._build_ffmpeg_pcm_command()
        )
        self._playback_controller = playback_controller or PlaybackController()
        self._frame_size = 3840
        self._outgoing_eof = False
        self._incoming_eof = False
        self._closed = False

    def read(self) -> bytes:
        if self._closed:
            return b""
        now = time.monotonic()
        t = min((now - self._start_time) / self._crossfade_duration, 1.0)
        fade_out_gain = 1.0 - t
        fade_in_gain = t
        # Read frames from both sources
        outgoing_frame = self._read_frame(self._outgoing_proc, '_outgoing_eof')
        incoming_frame = self._read_frame(self._incoming_proc, '_incoming_eof')
        # If both are done, cleanup
        if self._outgoing_eof and self._incoming_eof:
            self.cleanup()
            return b""
        # If one is done, fill with silence
        if outgoing_frame is None:
            outgoing_frame = b"\x00" * self._frame_size
        if incoming_frame is None:
            incoming_frame = b"\x00" * self._frame_size
        # Apply fades
        outgoing_faded = audioop.mul(outgoing_frame, 2, fade_out_gain)
        incoming_faded = audioop.mul(incoming_frame, 2, fade_in_gain)
        # Mix
        mixed = audioop.add(outgoing_faded, incoming_faded, 2)
        # Apply volume/mute
        return self._playback_controller.apply_gain(mixed)

    def _read_frame(self, proc, eof_attr):
        if getattr(self, eof_attr):
            return None
        pipe = proc.stdout
        if pipe is None:
            setattr(self, eof_attr, True)
            return None
        buf = b""
        while len(buf) < self._frame_size:
            chunk = pipe.read(self._frame_size - len(buf))
            if not chunk:
                break
            buf += chunk
        if not buf:
            setattr(self, eof_attr, True)
            return None
        if len(buf) < self._frame_size:
            buf += b"\x00" * (self._frame_size - len(buf))
            setattr(self, eof_attr, True)
        return buf

    def is_opus(self) -> bool:
        return False

    def cleanup(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._outgoing_streamer._finalize_processes(self._outgoing_proc, self._outgoing_ytdlp, hit_limit=True)
        self._incoming_streamer._finalize_processes(self._incoming_proc, self._incoming_ytdlp, hit_limit=True)
