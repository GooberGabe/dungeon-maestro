# Transcription Benchmarking

This workspace now includes an offline transcription benchmark harness that replays WAV recordings through the same core live-session policy used by DungeonMaestro:

- Silero VAD gating
- fixed chunking
- rolling ring buffer windows
- one background transcription worker
- overwrite-the-pending-window behavior when speech outruns decode speed

That last point matters for DungeonMaestro's real audience. A GM often speaks in long uninterrupted bursts, which means the most accurate checkpoint is not automatically the best live checkpoint. If a model falls behind during narration, the current policy will skip older pending windows and only keep the newest one.

## Command

From the repo root, after updating the example manifest to point at real recordings:

```powershell
C:/Users/gdubs/GitHub/dungeon-maestro/.venv/Scripts/python.exe -m dungeon_maestro_sidecar.benchmark_transcription --manifest benchmarks/transcription-scenarios.example.json --model base --model small.en --profile fast --profile accurate --output-json benchmarks/last-run.json
```

Or via the console script after reinstalling editable metadata if needed:

```powershell
dungeon-maestro-benchmark-transcription --manifest benchmarks/transcription-scenarios.example.json
```

## Scenario Format

Use a JSON manifest with one or more scenarios:

```json
{
  "scenarios": [
    {
      "name": "gm-long-narration",
      "audio_path": "audio/gm-long-narration.wav",
      "description": "Two minutes of continuous narration with sparse pauses.",
      "tags": ["gm", "long-burst"],
      "reference_text_path": "transcripts/gm-long-narration.txt",
      "expected_phrases": ["the cavern opens before you"],
      "expected_keywords": ["initiative", "combat"]
    }
  ]
}
```

Paths in the manifest are resolved relative to the manifest file.

The checked-in example manifest is a template. Replace the sample `audio_path` and `reference_text_path` values with your own recordings and transcripts before running it.

## Metrics To Watch

- `full_audio.word_error_rate`: best for raw model quality when you have a reference transcript.
- `full_audio.real_time_factor`: whole-file decode speed relative to audio duration.
- `live_policy.transcription_requests_dropped`: direct signal that the model cannot keep up with sustained speech under the current single-worker policy.
- `live_policy.p95_lag_seconds`: how stale the live transcript becomes during long narration.
- `live_policy.expected_phrase_hits` and `live_policy.expected_keyword_hits`: whether the live policy still surfaces important trigger language.

## Recommended Corpus For DungeonMaestro

Build a small but deliberate benchmark set instead of a single sample:

- `gm-long-narration`: 1 to 3 minutes of uninterrupted scene-setting.
- `gm-rapid-dialogue`: fast character voice switching with proper nouns.
- `gm-asides-during-table-talk`: short DM interjections while players speak over one another.
- `player-chatter-only`: non-DM speech to show how much irrelevant table speech leaks into transcripts.
- `combat-trigger-phrases`: phrases like `roll for initiative`, `the tavern grows quiet`, `you descend into the dungeon`.
- `quiet-low-energy-narration`: to see whether VAD or model choice drops softly spoken lines.

If the benchmark shows that stronger checkpoints improve full-audio WER but also increase dropped live windows during GM monologues, that points to a policy problem, not just a model problem. In that case, the next things to evaluate are longer stride windows, transcript stabilization, or a different backend optimized for streaming.