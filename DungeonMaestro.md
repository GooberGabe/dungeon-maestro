# DungeonMaestro

DungeonMaestro is a desktop app for running live tabletop audio.

It lets a DM organize soundscapes, build session collections, and route playback to local speakers or Discord voice with fast in-session control.

## Beta Scope

Current beta behavior focuses on reliable playback and session control:

- Soundscape and collection management
- Session startup with selected output mode
- Local and Discord audio routing
- Playback controls (play, pause, seek, volume, loop)
- Crossfade controls
- HUD window for live status
- Persisted desktop settings

Automatic switching is currently not part of the active beta surface.

## Desktop Architecture

- Electron main process handles app lifecycle, IPC, window management, and persistence.
- React renderer powers dashboard and HUD interfaces.
- Python sidecar handles playback runtime, track resolution, and output transport.

## Key Workflows

### 1. Manage Library

Use the Library workspace to:

- Create and edit soundscapes
- Add keywords and tracks
- Reorder tracks
- Preview and validate track sources

### 2. Build Session Collections

Use the Live workspace to:

- Create collections
- Add or remove soundscapes from a collection
- Reorder soundscapes for session flow

### 3. Start Session

When a session starts, DungeonMaestro:

- Loads the selected collection and playback preferences
- Connects output to local or Discord route
- Prepares runtime playback state

### 4. Control Playback

During a session:

- Pause/resume current track
- Seek within current track
- Change volume
- Enable loop
- Configure crossfade behavior
- Skip or switch tracks/soundscapes

## Persistence

Desktop preferences are saved between launches, including:

- Output mode
- Discord target selection and bot token (stored securely via Windows Credential Manager in desktop builds)
- Playback defaults (volume, mute, loop, crossfade)
- HUD window bounds

## Packaging Status

Packaging and auto-update work is planned for beta hardening.

## Development

### Prerequisites

- Python 3.10+
- Node.js 20+
- ffmpeg installed and available

### Run Desktop UI

From [desktop/package.json](desktop/package.json):

- `npm install`
- `npm run dev`

### Build Desktop UI

From [desktop/package.json](desktop/package.json):

- `npm run build`

### Run Desktop Unit Tests

From [desktop/package.json](desktop/package.json):

- `npm run test:unit`

### Sidecar

The Python sidecar package lives under [src/dungeon_maestro_sidecar](src/dungeon_maestro_sidecar).

Install from repo root:

- `python -m pip install -e .`

### Run Sidecar Tests

From repo root:

- `python -m unittest discover -s tests -p "test_*.py"`

### CI/CD Playbook

Pipeline operation details, release checklists, and branch protection setup live in [docs/pipeline-playbook.md](docs/pipeline-playbook.md).

### Local Config Files

- Copy [dungeon-maestro.yaml.example](dungeon-maestro.yaml.example) to a local [dungeon-maestro.yaml](dungeon-maestro.yaml) for personal testing.
- Copy [dungeon-maestro.session.example.json](dungeon-maestro.session.example.json) to a local [dungeon-maestro.session.json](dungeon-maestro.session.json) if you need a seeded session state.

Both local files are intentionally ignored so personal test content is not committed.

## Notes

This document reflects the current beta-facing product behavior. Internal experiments and postponed features may still exist in code but are not considered active user-facing functionality.
