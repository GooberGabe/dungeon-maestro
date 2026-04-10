import argparse
import audioop
from pathlib import Path
import time
import wave

from .ffmpeg_pcm import ffmpeg_pcm_generator, ffmpeg_pcm_direct_generator
from .models import ResolvedTrack
from .pcm_mixer import PcmMixer


def _build_track(source: str, title: str | None = None) -> ResolvedTrack:
    return ResolvedTrack(
        source=source,
        title=title or source,
        webpage_url=source if source.startswith("http") else None,
        stream_url=None,
    )


def run_test(
    track1: str,
    track2: str,
    output_path: str,
    duration_seconds: float,
    switch_at_seconds: float,
    prebuffer_frames: int,
    rms_threshold: int,
) -> None:
    mixer = PcmMixer()
    mixer.start()

    t1 = _build_track(track1, "track1")
    t2 = _build_track(track2, "track2")

    track1_path = Path(track1).expanduser()
    if track1_path.is_file():
        print(f"[mixer_test] using local file for track1: {track1_path}")
        track1_gen = ffmpeg_pcm_direct_generator(str(track1_path))
    else:
        track1_gen = ffmpeg_pcm_generator(t1)
    track1_handle = mixer.add_track(track1_gen, fade_in=None)
    track2_handle = None

    start = time.monotonic()
    switched = False

    with wave.open(output_path, "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(48000)

        while True:
            now = time.monotonic()
            elapsed = now - start
            if elapsed >= duration_seconds:
                break

            if (not switched) and elapsed >= switch_at_seconds:
                # Prebuffer frames from track2 to reduce startup gap.
                track2_path = Path(track2).expanduser()
                if track2_path.is_file():
                    print(f"[mixer_test] using local file for track2: {track2_path}")
                    track2_gen = ffmpeg_pcm_direct_generator(str(track2_path))
                else:
                    track2_gen = ffmpeg_pcm_generator(t2)
                prebuffer = []
                for _ in range(prebuffer_frames):
                    try:
                        prebuffer.append(next(track2_gen))
                    except StopIteration:
                        break

                original_gen = track2_gen

                def buffered_gen():
                    for frame in prebuffer:
                        yield frame
                    for frame in original_gen:
                        yield frame

                track2_handle = mixer.add_track(buffered_gen(), fade_in=None)
                mixer.remove_track(track1_handle, fade_out=None)
                switched = True
                print(f"[mixer_test] switch at {elapsed:.2f}s, prebuffer_frames={len(prebuffer)}")

            frame = mixer.get_output(timeout=1.0)
            wav.writeframes(frame)

            if rms_threshold > 0:
                rms = audioop.rms(frame, 2)
                if rms < rms_threshold:
                    print(f"[mixer_test] low rms={rms} at {elapsed:.2f}s")

    mixer.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description="PCM mixer transition test")
    parser.add_argument("--track1", required=True, help="Track 1 source (URL or search term)")
    parser.add_argument("--track2", required=True, help="Track 2 source (URL or search term)")
    parser.add_argument("--output", default="mixer_test.wav", help="Output wav file path")
    parser.add_argument("--duration", type=float, default=30.0, help="Total duration in seconds")
    parser.add_argument("--switch-at", type=float, default=10.0, help="Switch time in seconds")
    parser.add_argument("--prebuffer", type=int, default=20, help="Prebuffer frames before switch")
    parser.add_argument("--rms-threshold", type=int, default=0, help="Log if RMS below this")
    args = parser.parse_args()

    run_test(
        track1=args.track1,
        track2=args.track2,
        output_path=args.output,
        duration_seconds=args.duration,
        switch_at_seconds=args.switch_at,
        prebuffer_frames=args.prebuffer,
        rms_threshold=args.rms_threshold,
    )


if __name__ == "__main__":
    main()
