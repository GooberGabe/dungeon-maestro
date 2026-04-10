import threading
from .pcm_mixer import PcmMixer
from .ffmpeg_pcm import ffmpeg_pcm_generator
from .discord_audio_base import DiscordAudioSourceBase

class DiscordPcmMixerSource(DiscordAudioSourceBase):
    """
    Discord-compatible audio source that streams PCM from the PcmMixer.
    """
    def __init__(self, mixer: PcmMixer, playback_controller=None):
        self.mixer = mixer
        self._playback_controller = playback_controller
        self._closed = False
        self._thread = None
        self._suppress_finished_callback = True
        self.track = None

    def start(self):
        if not self.mixer.is_alive():
            self.mixer.start()

    def read(self) -> bytes:
        if self._closed:
            return b""
        pcm = self.mixer.get_output(timeout=1.0)
        if self._playback_controller is not None:
            pcm = self._playback_controller.apply_gain(pcm)
        return pcm

    def is_opus(self) -> bool:
        return False

    def cleanup(self):
        self._closed = True
        self.mixer.stop()
        if self.mixer.is_alive():
            self.mixer.join(timeout=2)

# Example usage:
# mixer = PcmMixer()
# track1 = ffmpeg_pcm_generator(track1_obj)
# mixer.add_track(track1, fade_in=2.0)
# discord_source = DiscordPcmMixerSource(mixer)
# voice_client.play(discord_source)
