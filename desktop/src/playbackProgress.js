import { useCallback, useEffect, useRef, useState } from 'react'

export function formatPlaybackTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remainderSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainderSeconds.toString().padStart(2, '0')}`
}

function clampTrackPosition(positionSeconds, durationSeconds, loopEnabled) {
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0) {
    return 0
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return positionSeconds
  }
  if (loopEnabled) {
    return positionSeconds % durationSeconds
  }
  return Math.min(positionSeconds, durationSeconds)
}

function resolveInitialPosition(durationSeconds, startedAtEpoch, loopEnabled, paused, pausedPositionSeconds) {
  if (paused && Number.isFinite(pausedPositionSeconds)) {
    return clampTrackPosition(pausedPositionSeconds, durationSeconds, loopEnabled)
  }
  if (!startedAtEpoch) {
    return 0
  }
  const elapsedSeconds = Math.max(0, (Date.now() / 1000) - startedAtEpoch)
  return clampTrackPosition(elapsedSeconds, durationSeconds, loopEnabled)
}

export function usePlaybackPosition({ durationSeconds, paused, startedAtEpoch, trackKey, loopEnabled, pausedPositionSeconds = null }) {
  const anchorRef = useRef({ baseSeconds: 0, startedAtMs: performance.now() })
  const rafRef = useRef(null)
  const [positionSeconds, setPositionSeconds] = useState(0)

  const getCurrentPosition = useCallback(() => {
    const anchor = anchorRef.current
    if (paused) {
      return clampTrackPosition(anchor.baseSeconds, durationSeconds, loopEnabled)
    }

    const elapsedSinceAnchor = (performance.now() - anchor.startedAtMs) / 1000
    return clampTrackPosition(anchor.baseSeconds + elapsedSinceAnchor, durationSeconds, loopEnabled)
  }, [durationSeconds, loopEnabled, paused])

  useEffect(() => {
    const initialPosition = resolveInitialPosition(durationSeconds, startedAtEpoch, loopEnabled, paused, pausedPositionSeconds)
    anchorRef.current = {
      baseSeconds: initialPosition,
      startedAtMs: performance.now(),
    }
    setPositionSeconds(initialPosition)
  }, [durationSeconds, loopEnabled, paused, pausedPositionSeconds, startedAtEpoch, trackKey])

  useEffect(() => {
    const nowMs = performance.now()
    const anchor = anchorRef.current
    if (paused) {
      anchor.baseSeconds = Number.isFinite(pausedPositionSeconds)
        ? clampTrackPosition(pausedPositionSeconds, durationSeconds, loopEnabled)
        : clampTrackPosition(
          anchor.baseSeconds + ((nowMs - anchor.startedAtMs) / 1000),
          durationSeconds,
          loopEnabled,
        )
      anchor.startedAtMs = nowMs
      setPositionSeconds(anchor.baseSeconds)
      return
    }

    anchor.startedAtMs = nowMs
  }, [durationSeconds, loopEnabled, paused, pausedPositionSeconds])

  useEffect(() => {
    const tick = () => {
      setPositionSeconds(getCurrentPosition())
      rafRef.current = window.requestAnimationFrame(tick)
    }

    setPositionSeconds(getCurrentPosition())
    if (paused || !(durationSeconds > 0)) {
      return undefined
    }

    rafRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [durationSeconds, getCurrentPosition, paused])

  const setPlaybackPosition = useCallback((nextPositionSeconds) => {
    const clampedPosition = clampTrackPosition(nextPositionSeconds, durationSeconds, false)
    anchorRef.current = {
      baseSeconds: clampedPosition,
      startedAtMs: performance.now(),
    }
    setPositionSeconds(clampedPosition)
    return clampedPosition
  }, [durationSeconds])

  const progress = durationSeconds > 0
    ? Math.min(positionSeconds / durationSeconds, 1)
    : 0

  return {
    positionSeconds,
    progress,
    setPlaybackPosition,
  }
}