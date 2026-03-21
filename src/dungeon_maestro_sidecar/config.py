from __future__ import annotations

from pathlib import Path

import yaml

from .models import PipelineSettings, Soundscape, TrackSource
from .transcription import normalize_transcription_profile


class ConfigError(RuntimeError):
    pass


def default_settings() -> PipelineSettings:
    return PipelineSettings(
        cooldown_seconds=180,
        transcription_profile="fast",
        whisper_model="base",
        default_soundscape="ambient",
        enable_transition_proposals=True,
        transition_popup_timeout=30,
        crossfade_enabled=False,
        crossfade_duration_seconds=3.0,
    )


def default_soundscapes() -> list[Soundscape]:
    return [
        Soundscape(
            soundscape_id="ambient",
            name="Ambient Exploration",
            keywords=["explore", "travel", "walk", "ambient"],
            tracks=[
                TrackSource("fantasy exploration ambience"),
                TrackSource("forest ambience for tabletop rpg"),
            ],
            playback_mode="sequential_loop",
        ),
        Soundscape(
            soundscape_id="combat",
            name="Combat",
            keywords=["combat", "fight", "battle", "initiative", "roll for initiative"],
            tracks=[
                TrackSource("epic combat music dnd"),
                TrackSource("Bloodborne Soundtrack full OST"),
                TrackSource("intense orchestral battle music"),
            ],
            playback_mode="sequential_loop",
        ),
        Soundscape(
            soundscape_id="tavern",
            name="Tavern",
            keywords=["tavern", "inn", "rest", "town"],
            tracks=[TrackSource("medieval tavern music ambience")],
            playback_mode="sequential_loop",
        ),
        Soundscape(
            soundscape_id="dungeon",
            name="Dungeon",
            keywords=["dungeon", "cave", "underground", "darkness"],
            tracks=[
                TrackSource("dark dungeon ambience no music"),
                TrackSource("cavern ambience dark fantasy"),
            ],
            playback_mode="sequential_loop",
        ),
    ]


def default_collections() -> list[Soundscape]:
    return default_soundscapes()


def load_pipeline_config(config_path: str | Path) -> tuple[PipelineSettings, list[Soundscape]]:
    path = Path(config_path)
    if not path.is_file():
        raise ConfigError(f"Config file not found: {path}")

    try:
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ConfigError(f"Invalid YAML in {path}: {exc}") from exc

    if document is None:
        raise ConfigError(f"Config file {path} is empty")
    if not isinstance(document, dict):
        raise ConfigError("Top-level config document must be a mapping")

    settings = _parse_settings(document.get("settings", {}))
    soundscapes = _parse_soundscapes(_raw_soundscapes(document))
    soundscape_ids = {soundscape.soundscape_id for soundscape in soundscapes}
    if settings.default_soundscape and settings.default_soundscape not in soundscape_ids:
        raise ConfigError(
            f"settings.default_soundscape={settings.default_soundscape!r} does not match any soundscape id"
        )

    return settings, soundscapes


def _raw_soundscapes(document: dict[str, object]) -> object:
    raw_soundscapes = document.get("soundscapes")
    if raw_soundscapes is not None:
        return raw_soundscapes

    raw_collections = document.get("collections")
    if _looks_like_legacy_soundscapes(raw_collections):
        return raw_collections

    return None


def _looks_like_legacy_soundscapes(raw_collections: object) -> bool:
    if not isinstance(raw_collections, dict) or not raw_collections:
        return False

    return all(
        isinstance(value, dict) and isinstance(value.get("tracks"), list)
        for value in raw_collections.values()
    )


def _parse_settings(raw_settings: object) -> PipelineSettings:
    if raw_settings is None:
        raw_settings = {}
    if not isinstance(raw_settings, dict):
        raise ConfigError("settings must be a mapping")

    defaults = default_settings()
    input_device = raw_settings.get("input_device", defaults.input_device)
    if input_device is not None and not isinstance(input_device, (str, int)):
        raise ConfigError("settings.input_device must be a string, integer device id, or null")

    settings = PipelineSettings(
        sample_rate_hz=int(raw_settings.get("sample_rate_hz", defaults.sample_rate_hz)),
        channels=int(raw_settings.get("channels", defaults.channels)),
        input_device=input_device,
        chunk_size=int(raw_settings.get("chunk_size", defaults.chunk_size)),
        ring_buffer_seconds=int(raw_settings.get("ring_buffer_seconds", defaults.ring_buffer_seconds)),
        transcription_window_seconds=float(
            raw_settings.get("transcription_window_seconds", defaults.transcription_window_seconds)
        ),
        transcription_stride_seconds=float(
            raw_settings.get("transcription_stride_seconds", defaults.transcription_stride_seconds)
        ),
        transcription_profile=normalize_transcription_profile(
            str(raw_settings.get("transcription_profile", defaults.transcription_profile))
        ),
        cooldown_seconds=int(raw_settings.get("cooldown_seconds", defaults.cooldown_seconds)),
        whisper_model=str(raw_settings.get("whisper_model", defaults.whisper_model)),
        default_soundscape=str(raw_settings.get("default_soundscape", raw_settings.get("default_collection", defaults.default_soundscape))),
        enable_transition_proposals=bool(
            raw_settings.get("enable_transition_proposals", defaults.enable_transition_proposals)
        ),
        transition_popup_timeout=int(
            raw_settings.get("transition_popup_timeout", defaults.transition_popup_timeout)
        ),
        crossfade_enabled=bool(
            raw_settings.get("crossfade_enabled", defaults.crossfade_enabled)
        ),
        crossfade_duration_seconds=float(
            raw_settings.get("crossfade_duration_seconds", defaults.crossfade_duration_seconds)
        ),
    )

    if settings.sample_rate_hz <= 0 or settings.channels <= 0 or settings.chunk_size <= 0:
        raise ConfigError("Audio settings must be positive integers")
    if settings.ring_buffer_seconds <= 0:
        raise ConfigError("settings.ring_buffer_seconds must be > 0")
    if settings.transcription_window_seconds <= 0 or settings.transcription_stride_seconds <= 0:
        raise ConfigError("Transcription window and stride must be > 0")
    if settings.cooldown_seconds < 0:
        raise ConfigError("settings.cooldown_seconds must be >= 0")
    if settings.transition_popup_timeout <= 0:
        raise ConfigError("settings.transition_popup_timeout must be > 0")
    if settings.crossfade_duration_seconds < 0.5 or settings.crossfade_duration_seconds > 15.0:
        raise ConfigError("settings.crossfade_duration_seconds must be between 0.5 and 15")

    return settings


def _parse_soundscapes(raw_soundscapes: object) -> list[Soundscape]:
    if not isinstance(raw_soundscapes, dict) or not raw_soundscapes:
        raise ConfigError("soundscapes must be a non-empty mapping")

    soundscapes: list[Soundscape] = []
    for raw_soundscape_id, raw_soundscape in raw_soundscapes.items():
        soundscape_id = str(raw_soundscape_id).strip()
        if not soundscape_id:
            raise ConfigError("Each soundscape id must be a non-empty string")
        if not isinstance(raw_soundscape, dict):
            raise ConfigError(f"soundscapes.{soundscape_id} must be a mapping")

        name = raw_soundscape.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ConfigError(f"soundscapes.{soundscape_id}.name must be a non-empty string")

        keywords = raw_soundscape.get("keywords")
        if keywords is None:
            keywords = []
        if not isinstance(keywords, list):
            raise ConfigError(f"soundscapes.{soundscape_id}.keywords must be a list")
        normalized_keywords: list[str] = []
        for index, keyword in enumerate(keywords):
            if not isinstance(keyword, str) or not keyword.strip():
                raise ConfigError(f"soundscapes.{soundscape_id}.keywords[{index}] must be a non-empty string")
            normalized_keywords.append(keyword.strip())

        tracks = raw_soundscape.get("tracks")
        if not isinstance(tracks, list) or not tracks:
            raise ConfigError(f"soundscapes.{soundscape_id}.tracks must be a non-empty list")
        parsed_tracks: list[TrackSource] = []
        for index, track in enumerate(tracks):
            if not isinstance(track, dict):
                raise ConfigError(f"soundscapes.{soundscape_id}.tracks[{index}] must be a mapping")
            source = track.get("source")
            if not isinstance(source, str) or not source.strip():
                raise ConfigError(f"soundscapes.{soundscape_id}.tracks[{index}].source must be a non-empty string")
            parsed_tracks.append(TrackSource(source.strip()))

        playback = raw_soundscape.get("playback", {})
        if playback is None:
            playback = {}
        if not isinstance(playback, dict):
            raise ConfigError(f"soundscapes.{soundscape_id}.playback must be a mapping")
        playback_mode = str(playback.get("mode", "sequential_loop"))
        if playback_mode != "sequential_loop":
            raise ConfigError(
                f"soundscapes.{soundscape_id}.playback.mode={playback_mode!r} is not supported yet"
            )

        soundscapes.append(
            Soundscape(
                soundscape_id=soundscape_id.strip(),
                name=name.strip(),
                keywords=normalized_keywords,
                tracks=parsed_tracks,
                playback_mode=playback_mode,
            )
        )

    return soundscapes


def _parse_collections(raw_collections: object) -> list[Soundscape]:
    return _parse_soundscapes(raw_collections)
