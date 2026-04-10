import argparse
import time
import wave

from .models import ResolvedTrack
from pathlib import Path
from .track_buffer import TrackBuffer
from .ffmpeg_pcm import ffmpeg_pcm_direct_generator


def _build_track(source: str, title: str | None = None) -> ResolvedTrack:
    return ResolvedTrack(
        source=source,
        title=title or source,
        webpage_url=source if source.startswith("http") else None,
        stream_url=None,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="TrackBuffer predecode test")
    parser.add_argument("--track1", required=True, help="Track 1 source (URL or search term)")
    parser.add_argument("--track2", required=True, help="Track 2 source (URL or search term)")
    parser.add_argument("--output", default="track_buffer_test.wav", help="Output wav file path")
    parser.add_argument("--duration", type=float, default=30.0, help="Total duration in seconds")
    parser.add_argument("--switch-at", type=float, default=10.0, help="Switch time in seconds")
    parser.add_argument("--prebuffer", type=int, default=50, help="Prebuffer frames before switch")
    args = parser.parse_args()

    t1 = _build_track(args.track1, "track1")
    t2 = _build_track(args.track2, "track2")

    track1_path = Path(args.track1).expanduser()
    track2_path = Path(args.track2).expanduser()

    if track1_path.is_file():
        t1 = ResolvedTrack(source=str(track1_path), title="track1")
        buffer1 = TrackBuffer(
            t1,
            prebuffer_frames=args.prebuffer,
            generator_factory=lambda: ffmpeg_pcm_direct_generator(str(track1_path)),
        )
    else:
        buffer1 = TrackBuffer(t1, prebuffer_frames=args.prebuffer)

    if track2_path.is_file():
        t2 = ResolvedTrack(source=str(track2_path), title="track2")
        buffer2 = TrackBuffer(
            t2,
            prebuffer_frames=args.prebuffer,
            generator_factory=lambda: ffmpeg_pcm_direct_generator(str(track2_path)),
        )
    else:
        buffer2 = TrackBuffer(t2, prebuffer_frames=args.prebuffer)

    buffer1.start()
    buffer2.start()

    print("[track_buffer_test] waiting for buffer1...")
    buffer1.wait_ready(timeout=5.0)
    print("[track_buffer_test] waiting for buffer2...")
    buffer2.wait_ready(timeout=5.0)

    start = time.monotonic()
    switched = False
    frame_duration = 0.02
    next_deadline = start
    frame_index = 0

    with wave.open(args.output, "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(48000)

        while True:
            now = time.monotonic()
            elapsed = now - start
            if elapsed >= args.duration:
                break

            if not switched and elapsed >= args.switch_at:
                switched = True
                print(f"[track_buffer_test] switched at {elapsed:.2f}s")

            frame = buffer2.read_frame(timeout=1.0) if switched else buffer1.read_frame(timeout=1.0)
            wav.writeframes(frame)
            if frame_index % 100 == 0:
                print(
                    f"[track_buffer_test] t={elapsed:.2f}s "
                    f"buf1={buffer1.buffered_frames} buf2={buffer2.buffered_frames}"
                )
            frame_index += 1
            next_deadline += frame_duration
            sleep_for = next_deadline - time.monotonic()
            if sleep_for > 0:
                time.sleep(sleep_for)

    buffer1.stop()
    buffer2.stop()


if __name__ == "__main__":
    main()
