from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

from .audio import MicrophoneAudioSource
from .config import ConfigError, load_pipeline_config
from .discord_bot import DiscordVoiceBridge
from .playback import FfmpegStdoutStreamer, LocalAudioPlayer
from .persistence import SessionStateStore
from .session import PipelineSession
from .tracks import YtDlpTrackResolver
from .transcription import FasterWhisperTranscriber, NullTranscriber, normalize_transcription_profile
from .vad import SileroVadGate


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="DungeonMaestro Phase 3 sidecar CLI")
    parser.add_argument(
        "--list-audio-devices",
        action="store_true",
        help="List available input devices and exit.",
    )
    parser.add_argument(
        "--input-device",
        help="Optional microphone device id or name override. Defaults to the OS default input device.",
    )
    parser.add_argument(
        "--config",
        default="dungeon-maestro.yaml",
        help="Path to the YAML config file.",
    )
    parser.add_argument(
        "--session-state",
        help="Optional path to the JSON session state file. Defaults to the config name with a .session.json suffix.",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from the session state file if it exists.",
    )
    parser.add_argument(
        "--resolve-only",
        action="store_true",
        help="Resolve track metadata and exit without opening the microphone.",
    )
    parser.add_argument(
        "--no-transcription",
        action="store_true",
        help="Disable faster-whisper and only validate capture, VAD, and resolution.",
    )
    parser.add_argument(
        "--transcription-profile",
        choices=("fast", "balanced", "accurate"),
        help="Optional transcription profile override. Defaults to the YAML setting.",
    )
    parser.add_argument(
        "--stream-active-track",
        action="store_true",
        help="Resolve the active collection's next track and pipe raw PCM audio to stdout via ffmpeg.",
    )
    parser.add_argument(
        "--stream-seconds",
        type=float,
        default=5.0,
        help="When streaming to stdout, stop after this many seconds of PCM audio. Use 0 for no limit.",
    )
    parser.add_argument(
        "--write-active-track-wav",
        help="Write the active collection's next track to a WAV file instead of piping raw PCM to stdout.",
    )
    parser.add_argument(
        "--discord-token",
        help="Discord bot token. Defaults to the DISCORD_BOT_TOKEN environment variable.",
    )
    parser.add_argument(
        "--discord-guild-id",
        type=int,
        help="Optional Discord guild id used to resolve the target voice channel.",
    )
    parser.add_argument(
        "--discord-voice-channel-id",
        type=int,
        help="Discord voice channel id to join for playback.",
    )
    parser.add_argument(
        "--no-auto-play",
        action="store_true",
        help="Disable automatic local playback when a live keyword match selects a track.",
    )
    return parser


def pcm_preview_byte_count(seconds: float) -> int | None:
    if seconds <= 0:
        return None
    sample_rate_hz = 48_000
    channels = 2
    bytes_per_sample = 2
    return int(seconds * sample_rate_hz * channels * bytes_per_sample)


def default_session_state_path(config_path: Path) -> Path:
    if config_path.suffix:
        return config_path.with_suffix(".session.json")
    return config_path.with_name(config_path.name + ".session.json")


def main() -> int:
    args = build_parser().parse_args()
    discord_token = args.discord_token or os.environ.get("DISCORD_BOT_TOKEN")
    if args.discord_voice_channel_id is not None and not discord_token:
        print("[startup] Discord playback requested but no token was provided")
        return 1

    if args.list_audio_devices:
        try:
            default_input, devices = MicrophoneAudioSource.list_input_devices()
        except RuntimeError as exc:
            print(f"[audio] {exc}")
            return 1

        if not devices:
            print("[audio] no input devices found")
            return 1

        for device in devices:
            marker = "*" if device["is_default"] else " "
            sample_rate = device["default_samplerate"]
            sample_rate_text = f", default {sample_rate:.0f} Hz" if isinstance(sample_rate, (int, float)) else ""
            print(
                f"[{marker}] {device['index']}: {device['name']} ({device['max_input_channels']} in{sample_rate_text})"
            )
        if default_input is not None:
            print(f"[audio] default input device index: {default_input}")
        return 0

    log_stream = sys.stderr if args.stream_active_track else sys.stdout
    config_path = Path(args.config)

    try:
        settings, collections = load_pipeline_config(config_path)
    except ConfigError as exc:
        print(f"[startup] {exc}", file=log_stream)
        return 1

    if args.input_device is not None:
        input_device = args.input_device
        if input_device.isdigit():
            settings.input_device = int(input_device)
        else:
            settings.input_device = input_device
    if args.transcription_profile is not None:
        settings.transcription_profile = normalize_transcription_profile(args.transcription_profile)

    session_state_path = Path(args.session_state) if args.session_state else default_session_state_path(config_path)
    state_store = SessionStateStore(session_state_path)
    resumed_state: dict[str, object] | None = None
    if args.resume:
        if state_store.exists():
            try:
                resumed_state = state_store.load()
            except Exception as exc:
                print(f"[startup] failed to load session state {session_state_path}: {exc}", file=log_stream)
                return 1
            print(f"[startup] resuming session state from {session_state_path}", file=log_stream)
        else:
            print(f"[startup] requested resume, but no session state exists at {session_state_path}", file=log_stream)
    elif state_store.exists():
        print(f"[startup] session state found at {session_state_path}; re-run with --resume to restore it", file=log_stream)

    print(f"[startup] loaded config from {config_path}", file=log_stream)

    speech_gate = SileroVadGate(settings.sample_rate_hz)
    if speech_gate.using_fallback:
        reason = f": {speech_gate.load_error}" if speech_gate.load_error else ""
        print(f"[startup] Silero VAD unavailable, using energy fallback{reason}", file=log_stream)

    if args.no_transcription:
        transcriber = NullTranscriber()
    else:
        try:
            transcriber = FasterWhisperTranscriber(settings.whisper_model, settings.transcription_profile)
        except RuntimeError as exc:
            print(f"[startup] {exc}", file=log_stream)
            print("[startup] Re-run with --no-transcription to validate the rest of the pipeline.", file=log_stream)
            return 1

    try:
        track_resolver = YtDlpTrackResolver()
    except RuntimeError as exc:
        print(f"[startup] {exc}", file=log_stream)
        return 1

    session = PipelineSession(
        settings,
        collections,
        speech_gate,
        transcriber,
        track_resolver,
        state_store=state_store,
        resumed_state=resumed_state,
    )

    print("[startup] resolving configured collection tracks", file=log_stream)
    for event in session.warm_resolve_tracks():
        print(f"[{event.event_type}] {event.message}", file=log_stream)

    if args.stream_active_track or args.write_active_track_wav:
        track = session.next_track_for_collection(session.state.active_collection_id)
        if track is None:
            print("[error] no resolved tracks available for the active collection", file=sys.stderr)
            return 1

        try:
            streamer = FfmpegStdoutStreamer()
            if args.write_active_track_wav:
                streamer.write_wav(track, args.write_active_track_wav, max_seconds=args.stream_seconds)
                print(
                    f"[shutdown] wrote WAV preview to {args.write_active_track_wav} from {track.title!r}",
                    file=sys.stderr,
                )
                return 0

            written = streamer.stream(
                track,
                sys.stdout.buffer,
                max_bytes=pcm_preview_byte_count(args.stream_seconds),
            )
        except RuntimeError as exc:
            print(f"[error] {exc}", file=sys.stderr)
            return 1

        print(
            f"\n[shutdown] streamed {written} bytes from {track.title!r}",
            file=sys.stderr,
        )
        return 0

    if args.resolve_only:
        return 0

    try:
        device_description = MicrophoneAudioSource.describe_input_device(settings.input_device)
    except RuntimeError as exc:
        print(f"[startup] {exc}", file=log_stream)
        return 1

    player: LocalAudioPlayer | None = None
    discord_bridge: DiscordVoiceBridge | None = None
    if not args.no_auto_play:
        try:
            player = LocalAudioPlayer()
            print("[startup] automatic local playback enabled", file=log_stream)
        except RuntimeError as exc:
            print(f"[startup] automatic playback unavailable: {exc}", file=log_stream)

    if args.discord_voice_channel_id is not None:
        try:
            discord_bridge = DiscordVoiceBridge(
                token=discord_token or "",
                guild_id=args.discord_guild_id,
                voice_channel_id=args.discord_voice_channel_id,
            )
            discord_bridge.start()
            print(
                f"[startup] connected Discord bot to voice channel {args.discord_voice_channel_id}",
                file=log_stream,
            )
        except RuntimeError as exc:
            if player is not None:
                player.stop()
            print(f"[startup] Discord playback unavailable: {exc}", file=log_stream)
            return 1

    print("[startup] opening microphone stream", file=log_stream)
    print(f"[startup] using input device: {device_description}", file=log_stream)
    print("[startup] press Ctrl+C to stop", file=log_stream)
    audio_source = MicrophoneAudioSource(settings)

    try:
        for chunk in audio_source.stream_chunks():
            for event in session.process_chunk(chunk):
                print(f"[{event.event_type}] {event.message}", file=log_stream)
                if player is not None and event.event_type == "selected_track" and event.track is not None:
                    player.play(event.track)
                    print(f"[playback_started] {event.track.title}", file=log_stream)
                if discord_bridge is not None and event.event_type == "selected_track" and event.track is not None:
                    try:
                        discord_bridge.play(event.track)
                    except RuntimeError as exc:
                        print(f"[discord_playback_error] {exc}", file=log_stream)
                    else:
                        print(f"[discord_playback_started] {event.track.title}", file=log_stream)
                if player is not None and player.last_error:
                    print(f"[playback_error] {player.last_error}", file=log_stream)
                    player.stop()
    except KeyboardInterrupt:
        if discord_bridge is not None:
            discord_bridge.stop()
        if player is not None:
            player.stop()
        print("\n[shutdown] stopped by user", file=log_stream)
        return 0
    except RuntimeError as exc:
        if discord_bridge is not None:
            discord_bridge.stop()
        if player is not None:
            player.stop()
        print(f"[error] {exc}", file=log_stream)
        return 1

    if discord_bridge is not None:
        discord_bridge.stop()
    if player is not None:
        player.stop()

    return 0


if __name__ == "__main__":
    sys.exit(main())