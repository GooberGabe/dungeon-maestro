try:
    import discord as _discord_base
except ImportError:
    _discord_base = None

if _discord_base is not None:
    DiscordAudioSourceBase = _discord_base.AudioSource
else:
    class DiscordAudioSourceBase:
        pass
