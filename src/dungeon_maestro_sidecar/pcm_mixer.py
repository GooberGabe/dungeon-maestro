import threading
import audioop
import time
from queue import Queue, Empty

class PcmTrack:
    def __init__(self, pcm_source, gain=1.0, fade=None, on_finished=None):
        self.pcm_source = pcm_source  # generator yielding PCM frames
        self.gain = gain
        self.fade = fade  # (start_gain, end_gain, duration, start_time)
        self.done = False
        self.on_finished = on_finished
        self.stop_requested = False
        self.frames_produced = 0

    def next_chunk(self, frame_size):
        if self.stop_requested and self.fade is None:
            self.done = True
            return b'\x00' * frame_size
        try:
            chunk = next(self.pcm_source)
            self.frames_produced += 1
            if self.fade:
                elapsed = time.monotonic() - self.fade[3]
                t = min(elapsed / self.fade[2], 1.0)
                gain = self.fade[0] + (self.fade[1] - self.fade[0]) * t
                chunk = audioop.mul(chunk, 2, gain)
                if t >= 1.0:
                    self.gain = self.fade[1]
                    self.fade = None
                    if self.stop_requested and self.gain <= 0.0:
                        self.done = True
                        return b'\x00' * frame_size
            else:
                if self.gain != 1.0:
                    chunk = audioop.mul(chunk, 2, self.gain)
            return chunk
        except StopIteration:
            self.done = True
            return b'\x00' * frame_size

class PcmMixer(threading.Thread):
    def __init__(self, frame_size=3840, sample_rate=48000, channels=2):
        super().__init__()
        self.frame_size = frame_size
        self._silence = b'\x00' * frame_size
        self.tracks = []
        # Buffer a bit to absorb ffmpeg jitter but avoid unbounded growth.
        self.output_queue = Queue(maxsize=50)
        self.running = True
        self.lock = threading.Lock()

    def add_track(self, pcm_source, fade_in=None, on_finished=None):
        track = PcmTrack(pcm_source, on_finished=on_finished)
        if fade_in:
            track.fade = (0.0, 1.0, fade_in, time.monotonic())
        with self.lock:
            self.tracks.append(track)
        print(f"[mixer] add_track fade_in={fade_in} total={len(self.tracks)}")
        return track

    def remove_track(self, track, fade_out=None):
        with self.lock:
            if fade_out:
                track.fade = (track.gain, 0.0, fade_out, time.monotonic())
                track.stop_requested = True
            else:
                track.stop_requested = True
        print(f"[mixer] remove_track fade_out={fade_out} stop_requested={track.stop_requested}")

    def run(self):
        while self.running:
            with self.lock:
                active_tracks = self.tracks[:]
            if not active_tracks:
                time.sleep(0.01)
                continue
            if len(active_tracks) == 1:
                track = active_tracks[0]
                try:
                    mixed = track.next_chunk(self.frame_size)
                except Exception as exc:
                    print(f"[mixer] track error: {exc}")
                    track.done = True
                    mixed = self._silence
                if track.done:
                    with self.lock:
                        if track in self.tracks:
                            self.tracks.remove(track)
                    if track.on_finished is not None:
                        try:
                            track.on_finished()
                        except Exception:
                            pass
            else:
                mixed = self._silence
                for track in active_tracks:
                    try:
                        chunk = track.next_chunk(self.frame_size)
                    except Exception as exc:
                        print(f"[mixer] track error: {exc}")
                        track.done = True
                        chunk = self._silence
                    mixed = audioop.add(mixed, chunk, 2)
                    if track.done:
                        with self.lock:
                            if track in self.tracks:
                                self.tracks.remove(track)
                        if track.on_finished is not None:
                            try:
                                track.on_finished()
                            except Exception:
                                pass
            # Block when buffer is full; this naturally paces production to consumption.
            self.output_queue.put(mixed)

    def get_output(self, timeout=1.0):
        try:
            return self.output_queue.get(timeout=timeout)
        except Empty:
            return b'\x00' * self.frame_size

    def buffered_frames(self) -> int:
        # Approximate buffer depth for pre-roll decisions.
        return self.output_queue.qsize()

    def inject_frames(self, frames: list[bytes]) -> None:
        # Push prebuffered frames into the output queue to avoid gaps on switches.
        for frame in frames:
            self.output_queue.put(frame)

    def stop(self):
        self.running = False
