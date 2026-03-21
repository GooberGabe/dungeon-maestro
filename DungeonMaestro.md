# DungeonMaestro
## Voice-Triggered Ambient Audio for TTRPG Sessions
### Architecture & Implementation Reference | v1.0

---

## 1. Overview

DungeonMaestro is a desktop application that listens to a DM's local microphone, transcribes speech in real time, matches detected keywords to user-defined audio soundscapes, and streams music into a Discord voice channel. The DM retains explicit approval control over every soundscape switch, preventing false triggers mid-session.

The application has two distinct UI modes:

- **Prep Dashboard** — full-featured soundscape and track manager used before and between sessions.
- **Game HUD** — a compact, always-on-top window used during live sessions with three core functions: display current track, skip track, and approve/dismiss detected soundscape transitions.

---

## 2. High-Level Architecture

### 2.1 Process Model

The application consists of three OS-level processes that communicate over a local WebSocket connection:

```
┌─────────────────────────────────────────────────┐
│              Electron (Main Process)            │
│  ┌─────────────────┐   ┌─────────────────────┐ │
│  │  Dashboard UI   │   │      Game HUD       │ │
│  │ (BrowserWindow) │   │  (BrowserWindow,    │ │
│  │                 │   │   alwaysOnTop)       │ │
│  └────────┬────────┘   └──────────┬──────────┘ │
│           └──────── IPC ───────────┘            │
│                      │                          │
└──────────────────────┼──────────────────────────┘
                       │ WebSocket (localhost)
          ┌────────────┴────────────┐
          │    Python Sidecar        │
          │  sounddevice → VAD →     │
          │  faster-whisper →        │
          │  keyword matcher →       │
          │  yt-dlp → ffmpeg pipe   │
          └────────────┬────────────┘
                       │ subprocess / stdin pipe
          ┌────────────┴────────────┐
          │   discord.py Bot         │
          │  (voice channel output)  │
          └─────────────────────────┘
```

### 2.2 Data Flow

```
Mic Input
  └─► Silero VAD (gate — drops silence)
         └─► Ring Buffer (fixed-size PCM window)
                └─► faster-whisper (speech only, resident model)
                       └─► Keyword Matcher
                             └─► [if match AND not in cooldown]
                                    └─► Emit 'transition_pending' to HUD
                                           └─► [DM approves]
                                                  └─► Soundscape Switch
                                                  └─► Cooldown timer starts
                                                  └─► yt-dlp resolves next track
                                                  └─► ffmpeg → discord.py → Discord
```

---

## 3. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Desktop Shell | Electron | Multi-window management, always-on-top HUD, IPC bridge, packaging |
| UI Framework | React | Dashboard and HUD renderer (single Electron app, two BrowserWindows) |
| Audio Pipeline | Python 3.11+ sidecar | Mic capture, VAD, transcription, keyword logic, track resolution |
| Mic Capture | sounddevice | Cross-platform microphone input, PCM streaming |
| Voice Activity Detection | Silero VAD | Drops silence before passing audio to Whisper |
| Transcription | faster-whisper (base/tiny) | Resident model, low latency, CPU-friendly |
| Track Resolution | yt-dlp | Resolves search terms, single URLs, and playlist URLs to audio streams |
| Audio Encoding | ffmpeg | PCM → Opus pipe into discord.py voice client |
| Discord Integration | discord.py + PyNaCl | Joins voice channel, receives ffmpeg audio stream, plays to channel |
| Config Format | YAML | Human-editable, shareable soundscape definitions |
| Session State | JSON | Active soundscape, track index, cooldown, session log |
| IPC Transport | WebSocket (localhost) | Sidecar ↔ Electron message passing |
| Packaging | electron-builder + PyInstaller | Bundles Electron shell and Python sidecar into single installer |
| Auto-Update | electron-updater | GitHub Releases–integrated update checking, download, and installation |

---

## 4. YAML Configuration Schema

### 4.1 Full Schema Reference

```yaml
# dungeon-maestro.yaml
settings:
  cooldown_seconds: 180          # Time after approval before re-detecting transitions
  whisper_model: base            # tiny | base | small
  default_collection: ambient    # Soundscape to play on session start
  transition_popup_timeout: 30   # Seconds before HUD popup auto-dismisses

collections:
  <collection_id>:
    name: "Display Name"         # Human-readable label shown in HUD/Dashboard
    keywords:                    # Words that trigger this soundscape
      - keyword1
      - keyword2
    tracks:
      - source: "<value>"        # URL (single video), playlist URL, or search term
      - source: "<value>"
    playback:
      mode: sequential_loop      # Only supported mode in v1
```

### 4.2 Annotated Example

```yaml
settings:
  cooldown_seconds: 180
  whisper_model: base
  default_collection: ambient
  transition_popup_timeout: 30

collections:
  ambient:
    name: "Ambient Exploration"
    keywords: ["explore", "travel", "walk", "ambient"]
    tracks:
      - source: "fantasy exploration ambience"          # Search term
      - source: "https://youtube.com/playlist?list=..." # Playlist URL
    playback:
      mode: sequential_loop

  combat:
    name: "Combat"
    keywords: ["combat", "fight", "battle", "initiative", "roll for initiative"]
    tracks:
      - source: "https://www.youtube.com/watch?v=..."   # Single video URL
      - source: "Bloodborne Soundtrack full OST"        # Search term
      - source: "intense orchestral battle music"
    playback:
      mode: sequential_loop

  tavern:
    name: "Tavern"
    keywords: ["tavern", "inn", "rest", "town"]
    tracks:
      - source: "medieval tavern music ambience"
    playback:
      mode: sequential_loop

  dungeon:
    name: "Dungeon"
    keywords: ["dungeon", "cave", "underground", "darkness"]
    tracks:
      - source: "dark dungeon ambience no music"
      - source: "https://youtube.com/playlist?list=..."
    playback:
      mode: sequential_loop
```

### 4.3 Track Source Types

The `source` field accepts three input types, all handled identically by yt-dlp:

| Source Type | Behavior |
|---|---|
| Search term (no http prefix) | Passed to yt-dlp as `ytsearch1:<term>`. Resolves to the top YouTube result. |
| Single video URL | Resolves to one track. If the URL contains both `watch?v=` and `list=`, the Dashboard will prompt the user to clarify: single video or full playlist. |
| Playlist URL (`list=` only) | Expanded at session start into a flat ordered list of tracks. Stream URLs are resolved lazily, just before each track plays. |

### 4.4 Keyword Matching Rules

Keyword matching uses simple case-insensitive string matching against the rolling transcription window. The following priority rules apply when multiple soundscapes could match:

1. Exact phrase match beats partial word match.
2. Longer keyword phrases beat shorter ones ("roll for initiative" beats "initiative").
3. If the active soundscape is already the matched soundscape, the match is silently ignored.
4. If the system is within the cooldown window, all matches are silently dropped — Whisper processing is suspended entirely during this period.

---

## 5. Audio Pipeline Detail

### 5.1 Microphone Capture

sounddevice captures PCM audio from the default system microphone in a streaming callback at 16kHz mono (Whisper's native sample rate). Chunks are pushed into a fixed-size ring buffer. The ring buffer holds a sliding window of the last 5–10 seconds of audio — older chunks are discarded automatically.

Key parameters:

- Sample rate: 16,000 Hz
- Channels: 1 (mono)
- Chunk size: 512 samples (~32ms per chunk)
- Ring buffer: 160,000 samples (~10 seconds)

### 5.2 Voice Activity Detection

Silero VAD runs on each incoming chunk before any data reaches Whisper. Chunks classified as silence are dropped immediately. Only speech-containing chunks are accumulated and sent for transcription. This is non-negotiable for long sessions — without VAD, Whisper runs continuously on silence and produces garbage output that triggers false keyword matches.

### 5.3 Transcription

faster-whisper is loaded once at session start with the configured model (default: `base`) and kept resident in memory for the duration of the session. It is never reloaded between calls.

```python
# Load ONCE at session start
model = WhisperModel("base", device="cpu", compute_type="int8")

# Reuse for every transcription call
def transcribe(audio_chunk: np.ndarray) -> str:
    segments, _ = model.transcribe(audio_chunk, vad_filter=True)
    return " ".join(s.text for s in segments).lower().strip()
```

### 5.4 Track Resolution & Playback

Track metadata (title, duration) is resolved at session start. Stream URLs are resolved lazily — immediately before each track begins playing — because yt-dlp stream URLs are temporary signed URLs that expire within a few hours.

```python
def resolve_stream_url(source: str) -> str:
    query = source if source.startswith("http") else f"ytsearch1:{source}"
    ydl_opts = {"format": "bestaudio", "quiet": True}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(query, download=False)
        if "entries" in info:
            info = info["entries"][0]
        return info["url"]  # Signed, temporary — resolve fresh each play
```

The resolved stream URL is passed to ffmpeg, which encodes it as Opus and pipes it to the discord.py voice client.

---

## 6. Transition Management

### 6.1 Approval Gate

No soundscape switch happens automatically. When the keyword matcher detects a potential transition, it emits a `transition_pending` event to the Electron frontend via WebSocket. The HUD expands to display the detected soundscape and a single approve button. If the DM does not interact within `transition_popup_timeout` seconds, the popup is dismissed silently and the current soundscape continues.

### 6.2 Cooldown

On approval, a cooldown timer starts. During the cooldown window, Whisper processing is suspended entirely — audio chunks are dropped at the VAD gate without transcription. This is the primary long-session load reduction mechanism. The cooldown duration is configurable in settings (default: 180 seconds).

```python
def on_audio_chunk(chunk):
    if transition_manager.in_cooldown():
        return  # Drop — suspend processing entirely
    if not vad.is_speech(chunk):
        return  # Drop — silence gate
    text = transcribe(chunk)
    transition_manager.check_keywords(text)
```

### 6.3 State Machine

```
States: IDLE → LISTENING → PENDING_APPROVAL → COOLDOWN → LISTENING

IDLE:             Session not started. No processing.
LISTENING:        VAD + Whisper active. Checking keywords.
PENDING_APPROVAL: Keyword matched. HUD popup shown. Whisper paused.
COOLDOWN:         DM approved. Soundscape switching. Whisper suspended.
                  Returns to LISTENING after cooldown_seconds.
```

---

## 7. Session Persistence

Session state is written to a JSON file on every track transition and soundscape switch. On application launch, if a session file is detected, the user is offered the option to resume.

```json
{
  "session_id": "2025-03-08T19:00:00",
  "active_collection": "combat",
  "track_index": 3,
  "cooldown_remaining": 0,
  "log": [
    { "time": "19:04:22", "event": "collection_switch", "keyword": "combat", "collection": "combat" },
    { "time": "19:47:11", "event": "collection_switch", "keyword": "tavern", "collection": "tavern" },
    { "time": "20:12:03", "event": "track_skip", "collection": "tavern", "track_index": 1 }
  ]
}
```

---

## 8. UI Specification

### 8.1 Prep Dashboard

Full-size window. Entry point on application launch. Accessible mid-session via the HUD's dashboard button (session continues playing).

Key views:

- **Soundscape List** — all defined soundscapes with keyword tags, track count, edit/delete actions.
- **Soundscape Editor** — name, keywords (tag input), track list. Each track shows resolved title (fetched from yt-dlp on add), source string, and drag handle for reordering. Supports add by URL or search term.
- **Settings Panel** — cooldown duration, Whisper model selection, Discord bot token, default soundscape, popup timeout.
- **Session Launcher** — select starting soundscape, start session (spawns HUD, minimizes dashboard, starts sidecar).

### 8.2 Game HUD

Always-on-top, frameless, drag-repositionable, position persisted between sessions.

Normal state (compact):
```
┌──────────────────────────────────────────┐
│ 🎵  Tavern Ambience  •  Track 2           │
│ [⏭ Skip]                      [⬆ Dash]  │
└──────────────────────────────────────────┘
```

Transition pending (expanded):
```
┌──────────────────────────────────────────┐
│ 🎵  Tavern Ambience  •  Track 2           │
│ [⏭ Skip]                      [⬆ Dash]  │
│ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │
│ ⚔  "combat" detected → Combat             │
│ [✓ Switch]                  [✕ Dismiss]  │
└──────────────────────────────────────────┘
```

### 8.3 HUD Electron Configuration

```javascript
const hud = new BrowserWindow({
  width: 360,
  height: 72,           // Compact state
  alwaysOnTop: true,
  frame: false,
  resizable: false,
  skipTaskbar: true,
  transparent: true,
})

// Expand on transition_pending
ipcMain.on('transition_pending', () => {
  hud.setSize(360, 136, true)  // Animated expand
})

// Restore on dismiss or approve
ipcMain.on('transition_resolved', () => {
  hud.setSize(360, 72, true)
})
```

---

## 9. IPC Message Protocol

All messages between the Python sidecar and Electron are JSON objects transmitted over a local WebSocket (default port 9001).

### 9.1 Sidecar → Electron

| Event | Payload |
|---|---|
| `track_started` | `{ collection, track_index, title, duration_seconds }` |
| `track_ended` | `{ collection, track_index }` |
| `transition_pending` | `{ keyword, target_collection, display_name }` |
| `session_ready` | `{ collections: [...], active_collection }` |
| `error` | `{ code, message }` |

### 9.2 Electron → Sidecar

| Command | Payload |
|---|---|
| `start_session` | `{ config_path, starting_collection }` |
| `approve_transition` | `{ collection }` |
| `dismiss_transition` | `{}` |
| `skip_track` | `{}` |
| `end_session` | `{}` |

---

## 10. Phased Implementation Plan

### Phase 1 — Core Audio Pipeline (CLI)

**Goal:** Working end-to-end pipeline with no UI. Validate all audio processing components.

- sounddevice mic capture → ring buffer
- Silero VAD gate
- faster-whisper transcription (resident model)
- Hardcoded keyword → soundscape mapping
- yt-dlp track resolution (search term + URL)
- ffmpeg audio pipe to stdout
- Console output: detected keywords, resolved track titles, state transitions

**Deliverable:** Python CLI script. Run it, speak keywords, see transcription and track resolution in terminal.

### Phase 2 — YAML Configuration

**Goal:** Full config system replacing all hardcoded values.

- YAML schema implementation with validation
- Soundscape loader: parse all source types, expand playlists at session start
- Keyword matcher with priority rules (exact, phrase length, active soundscape guard)
- Transition manager with cooldown logic
- Session state persistence (JSON read/write on every transition)
- Session resume on relaunch

**Deliverable:** CLI tool now reads from `dungeon-maestro.yaml`. Fully configurable without code changes.

### Phase 3 — Discord Bot Integration

**Goal:** Route audio from the pipeline to a Discord voice channel.

- discord.py bot process with voice channel join command
- ffmpeg Opus encoding pipe → discord.py voice client
- Bot subprocess management from the Python sidecar
- Graceful disconnect on session end

**Deliverable:** CLI tool + Discord bot. Full audio loop: mic → keyword → yt-dlp → Discord.

### Phase 4 — Electron Shell & HUD

**Goal:** Desktop application with Game HUD.

- Electron project setup with two BrowserWindow instances
- WebSocket bridge between Electron main process and Python sidecar
- Game HUD: now playing, skip, approve/dismiss popup, dashboard link
- Always-on-top, frameless, draggable, position persistence
- IPC message protocol fully implemented

**Deliverable:** Launchable desktop app with working HUD during sessions.

### Phase 5 — Prep Dashboard

**Goal:** Full soundscape management UI.

- Soundscape list view with keyword tags and track counts
- Soundscape editor: name, keywords, track list with add/reorder/remove
- Track add flow: input URL or search term, preview resolved title via yt-dlp
- Ambiguous URL detection (`watch?v=` + `list=` prompt)
- Settings panel: cooldown, Whisper model, Discord token, defaults
- Session launcher: starting soundscape picker, Start Session button
- YAML read/write from dashboard (load on open, save on change)

**Deliverable:** Complete application. Full prep-to-session workflow.

### Phase 6 — Packaging & Auto-Update

**Goal:** Single installer for end users with GitHub-integrated auto-updates. No manual Python or ffmpeg setup.

- PyInstaller: bundle Python sidecar + faster-whisper model + yt-dlp + ffmpeg into standalone executable
- electron-builder: wrap Electron shell + PyInstaller output into platform installer
- Auto-launch sidecar executable from Electron main process
- electron-updater: configure `publish` provider in electron-builder config to target GitHub Releases
- Update lifecycle: check for updates on app launch, notify user via Dashboard banner, download in background, prompt to restart to apply
- Sidecar update: PyInstaller bundle included in the electron-builder output so both Electron and sidecar are versioned and updated together as a single artifact
- Test on clean machines (no Python, no ffmpeg installed)

**Deliverable:** `.exe` (Windows) and `.dmg` (macOS) installers published to GitHub Releases with auto-update support.

### Estimated Timeline

| Phase | Estimated Effort | Key Risk |
|---|---|---|
| 1 — Core Pipeline | 1–2 days | Whisper latency on target hardware |
| 2 — YAML Config | 1–2 days | Playlist expansion edge cases |
| 3 — Discord Bot | 1–2 days | ffmpeg → Opus pipe stability |
| 4 — Electron HUD | 2–3 days | WebSocket bridge, window management |
| 5 — Dashboard UI | 3–5 days | yt-dlp preview UX, YAML sync |
| 6 — Packaging | 3–5 days | PyInstaller + Electron bundling |

---

## 11. Key Implementation Notes

### Long Session Stability

- Never accumulate transcription history in memory. Use a fixed-size ring buffer for raw audio. Display rolling transcript in the HUD/Dashboard but write overflow to a session log file.
- Never cache yt-dlp stream URLs. Resolve fresh immediately before each track play. Cached URLs expire within a few hours.
- Load faster-whisper model once at session start. Never reload between calls.
- Suspend Whisper processing entirely during cooldown. Drop chunks at the VAD gate.

### yt-dlp Reliability

- YouTube periodically changes internal APIs, which temporarily breaks yt-dlp. Pin the yt-dlp version in `requirements.txt` and update it deliberately rather than auto-updating.
- Ambiguous URLs (`watch?v=XYZ&list=ABC`) must surface a user prompt in the Dashboard. Do not silently guess intent.
- Playlist expansion at session start may take several seconds for large playlists. Run expansion in a background thread and show progress in the Dashboard.

### Packaging Considerations

- ffmpeg must be bundled. Do not assume it is installed on the user's machine. Include a platform-appropriate static binary.
- The faster-whisper model file must be bundled or downloaded on first run. Base model is ~145MB. Consider a first-launch download with progress indicator rather than shipping inside the installer.
- Discord bot token must never be hardcoded. Store in the settings file (not the YAML config) with appropriate file permissions.

### Auto-Update (electron-updater)

- Use `electron-updater` with the `github` publish provider. electron-builder generates the required `latest.yml` / `latest-mac.yml` manifest alongside each installer artifact.
- Release flow: tag a version, push to GitHub, CI builds installers and publishes them as a GitHub Release. electron-updater checks the release feed on app launch.
- Never auto-restart during an active session. If an update is downloaded while a session is running, defer the restart prompt until the session ends or the user returns to the Dashboard.
- The PyInstaller sidecar bundle must be included inside the electron-builder output directory (e.g., `resources/sidecar/`) so it is replaced atomically with each update. Do not version the sidecar separately.
- Sign installers with a code-signing certificate for Windows (and notarize for macOS) so electron-updater's signature verification passes and OS security prompts are minimized.

---

## 12. Future Considerations (Post-v1)

- **Config sharing:** Export/import soundscape sets as standalone YAML files. Natural for the TTRPG community to share campaign audio configs on forums or Reddit.
- **Per-soundscape playback modes:** shuffle, weighted shuffle, single-track loop (sequential loop is the only v1 mode).
- **Configurable cooldown per soundscape:** combat might warrant a shorter cooldown than ambient.
- **Push-to-talk trigger mode:** optional alternative to always-listening for DMs who prefer explicit control.
- **Transition crossfade:** fade out current track while fading in the new soundscape's first track.
- **Volume control in HUD:** per-soundscape volume normalization.

---

*DungeonMaestro Architecture Document  •  v1.0  •  March 2025*
