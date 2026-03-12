from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
from statistics import mean
import time
import wave

import numpy as np

from .config import load_pipeline_config
from .ring_buffer import AudioRingBuffer
from .transcription import FasterWhisperTranscriber, normalize_transcription_profile
from .vad import SileroVadGate


REPO_ROOT = Path(__file__).resolve().parents[2]


def normalize_text(value: str) -> str:
    return " ".join("".join(character.lower() if character.isalnum() else " " for character in value).split())


def resolve_config_path(config_path: str) -> Path:
    candidate = Path(config_path)
    if candidate.is_absolute():
        return candidate

    if candidate.is_file():
        return candidate.resolve()

    repo_candidate = (REPO_ROOT / candidate).resolve()
    if repo_candidate.is_file():
        return repo_candidate

    return candidate.resolve()


def word_error_rate(reference_text: str, hypothesis_text: str) -> float | None:
    normalized_reference = normalize_text(reference_text)
    normalized_hypothesis = normalize_text(hypothesis_text)
    if not normalized_reference:
        return None

    reference_words = normalized_reference.split()
    hypothesis_words = normalized_hypothesis.split()
    distances = [[0] * (len(hypothesis_words) + 1) for _ in range(len(reference_words) + 1)]

    for index in range(len(reference_words) + 1):
        distances[index][0] = index
    for index in range(len(hypothesis_words) + 1):
        distances[0][index] = index

    for row_index, reference_word in enumerate(reference_words, start=1):
        for column_index, hypothesis_word in enumerate(hypothesis_words, start=1):
            substitution_cost = 0 if reference_word == hypothesis_word else 1
            distances[row_index][column_index] = min(
                distances[row_index - 1][column_index] + 1,
                distances[row_index][column_index - 1] + 1,
                distances[row_index - 1][column_index - 1] + substitution_cost,
            )

    return distances[-1][-1] / max(len(reference_words), 1)


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * fraction))))
    return ordered[index]


def hit_summary(targets: list[str], transcripts: list[str]) -> dict[str, object]:
    normalized_targets = [normalize_text(target) for target in targets if normalize_text(target)]
    haystack = "\n".join(normalize_text(transcript) for transcript in transcripts if transcript)
    hits = [target for target in normalized_targets if target and target in haystack]
    misses = [target for target in normalized_targets if target not in hits]
    return {
        "targets": normalized_targets,
        "hits": hits,
        "misses": misses,
        "hit_count": len(hits),
        "target_count": len(normalized_targets),
    }


def resample_audio(audio: np.ndarray, source_rate_hz: int, target_rate_hz: int) -> np.ndarray:
    if source_rate_hz == target_rate_hz or audio.size == 0:
        return audio.astype(np.float32, copy=False)

    duration_seconds = audio.size / float(source_rate_hz)
    target_samples = max(1, int(round(duration_seconds * target_rate_hz)))
    source_positions = np.linspace(0.0, duration_seconds, num=audio.size, endpoint=False)
    target_positions = np.linspace(0.0, duration_seconds, num=target_samples, endpoint=False)
    resampled = np.interp(target_positions, source_positions, audio)
    return np.asarray(resampled, dtype=np.float32)


def load_wave_audio(audio_path: Path, target_rate_hz: int) -> tuple[np.ndarray, dict[str, object]]:
    if not audio_path.is_file():
        raise RuntimeError(f"Benchmark audio file not found: {audio_path}")

    with wave.open(str(audio_path), "rb") as reader:
        if reader.getcomptype() != "NONE":
            raise RuntimeError(f"Benchmark only supports PCM WAV input right now: {audio_path}")

        channel_count = reader.getnchannels()
        sample_width = reader.getsampwidth()
        frame_rate_hz = reader.getframerate()
        frame_count = reader.getnframes()
        raw_frames = reader.readframes(frame_count)

    if sample_width == 1:
        pcm = np.frombuffer(raw_frames, dtype=np.uint8).astype(np.float32)
        pcm = (pcm - 128.0) / 128.0
    elif sample_width == 2:
        pcm = np.frombuffer(raw_frames, dtype=np.int16).astype(np.float32) / 32768.0
    elif sample_width == 4:
        pcm = np.frombuffer(raw_frames, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise RuntimeError(f"Unsupported WAV sample width {sample_width} bytes: {audio_path}")

    if channel_count > 1:
        pcm = pcm.reshape(-1, channel_count).mean(axis=1)

    pcm = np.asarray(pcm, dtype=np.float32)
    resampled = resample_audio(pcm, frame_rate_hz, target_rate_hz)
    metadata = {
        "audio_path": str(audio_path),
        "original_sample_rate_hz": frame_rate_hz,
        "target_sample_rate_hz": target_rate_hz,
        "original_channels": channel_count,
        "sample_width_bytes": sample_width,
        "duration_seconds": round(resampled.size / float(target_rate_hz), 3),
    }
    return resampled, metadata


@dataclass(slots=True)
class BenchmarkScenario:
    name: str
    audio_path: Path
    description: str = ""
    tags: tuple[str, ...] = ()
    reference_text: str = ""
    expected_phrases: tuple[str, ...] = ()
    expected_keywords: tuple[str, ...] = ()


@dataclass(slots=True)
class LiveRequestResult:
    request_id: int
    request_time_seconds: float
    transcription_seconds: float
    transcript: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark transcription models against offline DungeonMaestro scenarios.")
    parser.add_argument("--config", default="dungeon-maestro.yaml", help="Path to the YAML config file.")
    parser.add_argument("--audio", action="append", default=[], help="Path to a WAV file benchmark scenario. Repeat for multiple scenarios.")
    parser.add_argument("--manifest", help="Path to a JSON manifest describing one or more benchmark scenarios.")
    parser.add_argument("--name", help="Optional scenario name when benchmarking a single --audio input.")
    parser.add_argument("--description", default="", help="Optional scenario description when benchmarking a single --audio input.")
    parser.add_argument("--tag", action="append", default=[], help="Optional scenario tag when benchmarking a single --audio input.")
    parser.add_argument("--reference-text", default="", help="Reference transcript for the single --audio input.")
    parser.add_argument("--reference-text-file", help="Path to a text file containing the reference transcript for the single --audio input.")
    parser.add_argument("--expected-phrase", action="append", default=[], help="Phrase that should appear in the transcript. Repeat as needed.")
    parser.add_argument("--expected-keyword", action="append", default=[], help="Keyword that should appear in the transcript. Repeat as needed.")
    parser.add_argument("--model", action="append", default=[], help="faster-whisper model name to benchmark. Repeat to compare multiple models.")
    parser.add_argument("--profile", action="append", default=[], choices=("fast", "balanced", "accurate"), help="Transcription profile to benchmark. Repeat to compare multiple profiles.")
    parser.add_argument("--skip-full-audio", action="store_true", help="Skip the single-pass full-audio transcription quality check.")
    parser.add_argument("--sample-transcripts", type=int, default=4, help="Number of live transcript samples to print per scenario.")
    parser.add_argument("--output-json", help="Optional path to write the full benchmark report as JSON.")
    return parser.parse_args()


def load_scenarios(args: argparse.Namespace) -> list[BenchmarkScenario]:
    scenarios: list[BenchmarkScenario] = []

    if args.manifest:
        manifest_path = Path(args.manifest).resolve()
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        raw_scenarios = payload.get("scenarios")
        if not isinstance(raw_scenarios, list) or not raw_scenarios:
            raise RuntimeError(f"Manifest must contain a non-empty 'scenarios' array: {manifest_path}")
        for index, raw_scenario in enumerate(raw_scenarios, start=1):
            if not isinstance(raw_scenario, dict):
                raise RuntimeError(f"Manifest scenario #{index} must be an object")
            name = str(raw_scenario.get("name") or f"scenario-{index}").strip()
            audio_path_value = raw_scenario.get("audio_path")
            if not isinstance(audio_path_value, str) or not audio_path_value.strip():
                raise RuntimeError(f"Manifest scenario '{name}' is missing audio_path")
            reference_text = str(raw_scenario.get("reference_text") or "")
            reference_text_path = raw_scenario.get("reference_text_path")
            if reference_text_path:
                reference_text = (manifest_path.parent / str(reference_text_path)).read_text(encoding="utf-8")
            scenarios.append(
                BenchmarkScenario(
                    name=name,
                    audio_path=(manifest_path.parent / audio_path_value).resolve(),
                    description=str(raw_scenario.get("description") or ""),
                    tags=tuple(str(tag) for tag in raw_scenario.get("tags") or []),
                    reference_text=reference_text,
                    expected_phrases=tuple(str(value) for value in raw_scenario.get("expected_phrases") or []),
                    expected_keywords=tuple(str(value) for value in raw_scenario.get("expected_keywords") or []),
                )
            )

    for audio_path_value in args.audio:
        audio_path = Path(audio_path_value).resolve()
        reference_text = args.reference_text
        if args.reference_text_file:
            reference_text = Path(args.reference_text_file).resolve().read_text(encoding="utf-8")
        scenarios.append(
            BenchmarkScenario(
                name=args.name or audio_path.stem,
                audio_path=audio_path,
                description=args.description,
                tags=tuple(args.tag),
                reference_text=reference_text,
                expected_phrases=tuple(args.expected_phrase),
                expected_keywords=tuple(args.expected_keyword),
            )
        )

    if not scenarios:
        raise RuntimeError("Provide at least one --audio input or a --manifest file.")

    return scenarios


def benchmark_full_audio(
    audio: np.ndarray,
    audio_duration_seconds: float,
    transcriber: FasterWhisperTranscriber,
    scenario: BenchmarkScenario,
) -> dict[str, object]:
    started = time.perf_counter()
    transcript = transcriber.transcribe(audio)
    elapsed = time.perf_counter() - started
    transcript_sources = [transcript]
    return {
        "transcript": transcript,
        "transcription_seconds": round(elapsed, 3),
        "real_time_factor": round((elapsed / audio_duration_seconds) if audio_duration_seconds else 0.0, 3),
        "word_error_rate": (round(word_error_rate(scenario.reference_text, transcript), 4) if scenario.reference_text else None),
        "expected_phrase_hits": hit_summary(list(scenario.expected_phrases), transcript_sources),
        "expected_keyword_hits": hit_summary(list(scenario.expected_keywords), transcript_sources),
    }


def simulate_live_policy(
    audio: np.ndarray,
    transcriber: FasterWhisperTranscriber,
    scenario: BenchmarkScenario,
    *,
    sample_rate_hz: int,
    chunk_size: int,
    ring_buffer_seconds: int,
    transcription_window_seconds: float,
    transcription_stride_seconds: float,
) -> dict[str, object]:
    speech_gate = SileroVadGate(sample_rate_hz)
    ring_buffer = AudioRingBuffer(sample_rate_hz * ring_buffer_seconds)
    min_window_samples = int(sample_rate_hz * transcription_window_seconds)
    stride_chunks = max(1, int((sample_rate_hz * transcription_stride_seconds) / chunk_size))
    chunks_since_transcription = 0
    total_chunks = 0
    speech_chunks = 0
    requests: list[LiveRequestResult] = []

    for start_index in range(0, audio.size, chunk_size):
        end_index = min(start_index + chunk_size, audio.size)
        raw_chunk = np.asarray(audio[start_index:end_index], dtype=np.float32)
        total_chunks += 1
        chunk_end_seconds = end_index / float(sample_rate_hz)
        chunk = raw_chunk if raw_chunk.size == chunk_size else np.pad(raw_chunk, (0, chunk_size - raw_chunk.size))

        if not speech_gate.is_speech(chunk):
            continue

        speech_chunks += 1
        ring_buffer.append(chunk)
        chunks_since_transcription += 1
        if ring_buffer.total_samples < min_window_samples:
            continue
        if chunks_since_transcription < stride_chunks:
            continue

        chunks_since_transcription = 0
        snapshot = ring_buffer.snapshot()
        started = time.perf_counter()
        transcript = transcriber.transcribe(snapshot)
        elapsed = time.perf_counter() - started
        requests.append(
            LiveRequestResult(
                request_id=len(requests) + 1,
                request_time_seconds=chunk_end_seconds,
                transcription_seconds=elapsed,
                transcript=transcript,
            )
        )

    completed_requests: list[dict[str, object]] = []
    active_request: dict[str, object] | None = None
    pending_request: LiveRequestResult | None = None

    def start_request(request: LiveRequestResult, start_time_seconds: float) -> dict[str, object]:
        return {
            "request_id": request.request_id,
            "request_time_seconds": request.request_time_seconds,
            "start_time_seconds": start_time_seconds,
            "finish_time_seconds": start_time_seconds + request.transcription_seconds,
            "transcription_seconds": request.transcription_seconds,
            "transcript": request.transcript,
        }

    def drain_until(target_time_seconds: float) -> None:
        nonlocal active_request, pending_request
        while active_request is not None and active_request["finish_time_seconds"] <= target_time_seconds:
            finished_request = active_request
            completed_requests.append(finished_request)
            active_request = None
            if pending_request is not None:
                active_request = start_request(pending_request, finished_request["finish_time_seconds"])
                pending_request = None

    for request in requests:
        drain_until(request.request_time_seconds)
        if active_request is None:
            active_request = start_request(request, request.request_time_seconds)
        else:
            pending_request = request

    drain_until(float("inf"))

    applied_transcripts: list[str] = []
    last_transcript = ""
    empty_transcript_count = 0
    duplicate_transcript_count = 0
    for request in completed_requests:
        transcript = str(request["transcript"] or "").strip()
        if not transcript:
            empty_transcript_count += 1
            continue
        if transcript == last_transcript:
            duplicate_transcript_count += 1
            continue
        applied_transcripts.append(transcript)
        last_transcript = transcript

    request_durations = [float(request["transcription_seconds"]) for request in completed_requests]
    request_lags = [
        float(request["finish_time_seconds"] - request["request_time_seconds"])
        for request in completed_requests
    ]
    audio_duration_seconds = audio.size / float(sample_rate_hz) if audio.size else 0.0
    speech_seconds = speech_chunks * (chunk_size / float(sample_rate_hz))
    live_rtf = (sum(request_durations) / audio_duration_seconds) if audio_duration_seconds else 0.0

    return {
        "audio_duration_seconds": round(audio_duration_seconds, 3),
        "speech_seconds_estimate": round(speech_seconds, 3),
        "total_chunks": total_chunks,
        "speech_chunks": speech_chunks,
        "speech_ratio": round((speech_chunks / total_chunks) if total_chunks else 0.0, 3),
        "transcription_requests_triggered": len(requests),
        "transcription_requests_completed": len(completed_requests),
        "transcription_requests_dropped": max(0, len(requests) - len(completed_requests)),
        "applied_transcripts": applied_transcripts,
        "applied_transcript_count": len(applied_transcripts),
        "empty_transcript_count": empty_transcript_count,
        "duplicate_transcript_count": duplicate_transcript_count,
        "mean_request_seconds": round(mean(request_durations), 3) if request_durations else None,
        "p95_request_seconds": round(percentile(request_durations, 0.95), 3) if request_durations else None,
        "mean_lag_seconds": round(mean(request_lags), 3) if request_lags else None,
        "p95_lag_seconds": round(percentile(request_lags, 0.95), 3) if request_lags else None,
        "max_lag_seconds": round(max(request_lags), 3) if request_lags else None,
        "live_real_time_factor": round(live_rtf, 3),
        "expected_phrase_hits": hit_summary(list(scenario.expected_phrases), applied_transcripts),
        "expected_keyword_hits": hit_summary(list(scenario.expected_keywords), applied_transcripts),
    }


def print_run_summary(
    scenario: BenchmarkScenario,
    audio_metadata: dict[str, object],
    *,
    model_name: str,
    profile_name: str,
    model_load_seconds: float,
    full_audio_result: dict[str, object] | None,
    live_result: dict[str, object],
    sample_transcripts: int,
) -> None:
    print(f"Scenario: {scenario.name}")
    print(f"  Audio: {audio_metadata['audio_path']}")
    print(f"  Duration: {audio_metadata['duration_seconds']}s | Tags: {', '.join(scenario.tags) if scenario.tags else 'none'}")
    if scenario.description:
        print(f"  Notes: {scenario.description}")
    print(f"  Model: {model_name} | Profile: {profile_name} | Load: {model_load_seconds:.3f}s")

    if full_audio_result is not None:
        print(
            "  Full Audio: "
            f"{full_audio_result['transcription_seconds']}s decode | "
            f"RTF={full_audio_result['real_time_factor']} | "
            f"WER={full_audio_result['word_error_rate'] if full_audio_result['word_error_rate'] is not None else 'n/a'} | "
            f"phrase hits={full_audio_result['expected_phrase_hits']['hit_count']}/{full_audio_result['expected_phrase_hits']['target_count']}"
        )

    print(
        "  Live Policy: "
        f"triggered={live_result['transcription_requests_triggered']} | "
        f"completed={live_result['transcription_requests_completed']} | "
        f"dropped={live_result['transcription_requests_dropped']} | "
        f"p95 request={live_result['p95_request_seconds'] if live_result['p95_request_seconds'] is not None else 'n/a'}s | "
        f"p95 lag={live_result['p95_lag_seconds'] if live_result['p95_lag_seconds'] is not None else 'n/a'}s | "
        f"RTF={live_result['live_real_time_factor']} | "
        f"phrase hits={live_result['expected_phrase_hits']['hit_count']}/{live_result['expected_phrase_hits']['target_count']}"
    )

    for transcript in live_result["applied_transcripts"][: max(0, sample_transcripts)]:
        print(f"    transcript> {transcript}")


def main() -> int:
    args = parse_args()
    config_path = resolve_config_path(args.config)
    settings, _collections = load_pipeline_config(config_path)
    scenarios = load_scenarios(args)
    model_names = args.model or [settings.whisper_model]
    profile_names = [normalize_transcription_profile(profile) for profile in (args.profile or [settings.transcription_profile])]

    scenario_audio_cache: dict[Path, tuple[np.ndarray, dict[str, object]]] = {}
    report: dict[str, object] = {
        "config_path": str(config_path.resolve()),
        "settings": {
            "sample_rate_hz": settings.sample_rate_hz,
            "chunk_size": settings.chunk_size,
            "ring_buffer_seconds": settings.ring_buffer_seconds,
            "transcription_window_seconds": settings.transcription_window_seconds,
            "transcription_stride_seconds": settings.transcription_stride_seconds,
        },
        "runs": [],
    }

    for model_name in model_names:
        for profile_name in profile_names:
            load_started = time.perf_counter()
            transcriber = FasterWhisperTranscriber(model_name, profile_name)
            model_load_seconds = time.perf_counter() - load_started

            for scenario in scenarios:
                if scenario.audio_path not in scenario_audio_cache:
                    scenario_audio_cache[scenario.audio_path] = load_wave_audio(scenario.audio_path, settings.sample_rate_hz)
                audio, audio_metadata = scenario_audio_cache[scenario.audio_path]

                full_audio_result = None
                if not args.skip_full_audio:
                    full_audio_result = benchmark_full_audio(
                        audio,
                        float(audio_metadata["duration_seconds"]),
                        transcriber,
                        scenario,
                    )

                live_result = simulate_live_policy(
                    audio,
                    transcriber,
                    scenario,
                    sample_rate_hz=settings.sample_rate_hz,
                    chunk_size=settings.chunk_size,
                    ring_buffer_seconds=settings.ring_buffer_seconds,
                    transcription_window_seconds=settings.transcription_window_seconds,
                    transcription_stride_seconds=settings.transcription_stride_seconds,
                )

                run_payload = {
                    "scenario": {
                        "name": scenario.name,
                        "audio_path": str(scenario.audio_path),
                        "description": scenario.description,
                        "tags": list(scenario.tags),
                        "reference_text_present": bool(scenario.reference_text.strip()),
                        "expected_phrases": list(scenario.expected_phrases),
                        "expected_keywords": list(scenario.expected_keywords),
                    },
                    "audio": audio_metadata,
                    "model": model_name,
                    "profile": profile_name,
                    "model_load_seconds": round(model_load_seconds, 3),
                    "full_audio": full_audio_result,
                    "live_policy": live_result,
                }
                report["runs"].append(run_payload)
                print_run_summary(
                    scenario,
                    audio_metadata,
                    model_name=model_name,
                    profile_name=profile_name,
                    model_load_seconds=model_load_seconds,
                    full_audio_result=full_audio_result,
                    live_result=live_result,
                    sample_transcripts=args.sample_transcripts,
                )

    if args.output_json:
        output_path = Path(args.output_json).resolve()
        output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nWrote benchmark report to {output_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())