const { spawn } = require('child_process')

const { desktopSettings, sessionState, workspaceRoot, trackPreviewCache, trackPreviewInFlight } = require('./state.cjs')
const { normalizeTextInput, normalizeTrackPreviewPayload, pythonExecutable } = require('./validation.cjs')
const { saveDesktopSettings } = require('./config.cjs')

function writeTrackPreviewCacheEntry(source, payload) {
  const normalizedPayload = normalizeTrackPreviewPayload(source, payload)
  if (!normalizedPayload) {
    return null
  }
  trackPreviewCache.set(normalizedPayload.source, normalizedPayload)
  desktopSettings.trackPreviewCache = {
    ...(desktopSettings.trackPreviewCache || {}),
    [normalizedPayload.source]: normalizedPayload,
  }
  saveDesktopSettings()
  return normalizedPayload
}

function previewTrackSource(source) {
  const normalizedSource = normalizeTextInput(source)
  if (!normalizedSource) {
    return Promise.resolve({ ok: false, source: normalizedSource, message: 'Enter a URL or search term.' })
  }

  if (trackPreviewCache.has(normalizedSource)) {
    return Promise.resolve(trackPreviewCache.get(normalizedSource))
  }

  if (trackPreviewInFlight.has(normalizedSource)) {
    return trackPreviewInFlight.get(normalizedSource)
  }

  const pending = new Promise((resolve) => {
    const child = spawn(
      pythonExecutable(),
      ['-m', 'dungeon_maestro_sidecar.track_preview', normalizedSource],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      const payload = { ok: false, source: normalizedSource, message: error.message }
      writeTrackPreviewCacheEntry(normalizedSource, payload)
      trackPreviewInFlight.delete(normalizedSource)
      resolve(payload)
    })

    child.on('close', (code) => {
      let payload
      if (code !== 0) {
        payload = {
          ok: false,
          source: normalizedSource,
          message: stderr.trim() || `Preview probe failed with exit code ${code}`,
        }
      } else {
        try {
          payload = JSON.parse(stdout)
        } catch (error) {
          payload = { ok: false, source: normalizedSource, message: error.message }
        }
      }
      payload = writeTrackPreviewCacheEntry(normalizedSource, payload) || payload
      trackPreviewInFlight.delete(normalizedSource)
      resolve(payload)
    })
  })

  trackPreviewInFlight.set(normalizedSource, pending)
  return pending
}

module.exports = {
  writeTrackPreviewCacheEntry,
  previewTrackSource,
}
