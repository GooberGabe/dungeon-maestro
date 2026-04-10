from pathlib import Path
import subprocess

from .ffmpeg_streamer import FfmpegStdoutStreamer, discover_ffmpeg

def ffmpeg_pcm_generator(track, ffmpeg_path=None, seek_offset=0.0, frame_size=3840):
    """
    Yields PCM frames from ffmpeg for the given track.
    track: must have .source (URL or file path)
    """
    if track is None:
        raise ValueError('track is required')
    if not getattr(track, 'source', None) and not getattr(track, 'webpage_url', None):
        raise ValueError('track.source or track.webpage_url must be a non-empty string')
    streamer = FfmpegStdoutStreamer(ffmpeg_path)
    ffmpeg_command = streamer._build_ffmpeg_pcm_command(seek_offset_seconds=seek_offset)
    proc, ytdlp_proc = streamer._start_processes(track, ffmpeg_command)
    try:
        got_any = False
        while True:
            chunk = proc.stdout.read(frame_size) if proc.stdout is not None else b""
            if not chunk:
                break
            got_any = True
            if len(chunk) < frame_size:
                chunk += b'\x00' * (frame_size - len(chunk))
            yield chunk
    finally:
        stderr_output, ytdlp_stderr = streamer._finalize_processes(proc, ytdlp_proc, hit_limit=False)
        if not got_any:
            stderr = stderr_output.decode("utf-8", errors="replace").strip()
            ytdlp_err = ytdlp_stderr.decode("utf-8", errors="replace").strip()
            if stderr:
                print(f"[ffmpeg_pcm] stderr: {stderr}")
            if ytdlp_err:
                print(f"[ffmpeg_pcm] ytdlp: {ytdlp_err}")


def ffmpeg_pcm_direct_generator(source: str, ffmpeg_path=None, seek_offset=0.0, frame_size=3840):
    """
    Yields PCM frames from ffmpeg for a direct media file path or URL.
    """
    if not source:
        raise ValueError('source must be a non-empty string')
    resolved_ffmpeg = discover_ffmpeg(ffmpeg_path)
    if not resolved_ffmpeg:
        raise RuntimeError('ffmpeg not found on PATH')

    command = [
        resolved_ffmpeg,
        '-hide_banner',
        '-loglevel', 'error',
    ]
    if seek_offset > 0:
        command += ['-ss', str(seek_offset)]
    command += [
        '-i', source,
        '-vn',
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-ac', '2',
        '-ar', '48000',
        'pipe:1',
    ]

    print(f"[ffmpeg_pcm_direct] source={source}")
    print(f"[ffmpeg_pcm_direct] cmd={' '.join(command)}")
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        got_any = False
        while True:
            chunk = proc.stdout.read(frame_size) if proc.stdout is not None else b""
            if not chunk:
                break
            got_any = True
            if len(chunk) < frame_size:
                chunk += b'\x00' * (frame_size - len(chunk))
            yield chunk
    finally:
        stderr_output = b""
        if proc.stderr is not None:
            stderr_output = proc.stderr.read()
        proc.terminate()
        proc.wait()
        if not got_any:
            stderr = stderr_output.decode("utf-8", errors="replace").strip()
            if stderr:
                print(f"[ffmpeg_pcm_direct] stderr: {stderr}")
