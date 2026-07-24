import { useState, useCallback } from 'react'

function StreamWorkspace({ isSessionActive, isSessionStarting, playStream }) {
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const handlePlay = useCallback(async () => {
    const source = query.trim()
    if (!source || pending) return
    setPending(true)
    setError('')
    try {
      await playStream(source)
    } catch (e) {
      setError(e?.message || 'Stream failed')
    } finally {
      setPending(false)
    }
  }, [query, pending, playStream])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') void handlePlay()
  }, [handlePlay])

  return (
    <section className="stream-workspace">
      <div className="panel stream-panel">
        <div>
          <p className="eyebrow">Stream</p>
          <h2>Direct Playback</h2>
        </div>
        {!isSessionActive ? (
          <p className="supporting-text">Start a session to enable direct stream playback.</p>
        ) : (
          <>
            <p className="supporting-text">
              Enter a YouTube URL or search term. Volume, crossfade, and mute settings from the active session apply.
            </p>
            <div className="stream-search-row">
              <input
                className="select-field stream-search-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Paste a YouTube URL or search term…"
                disabled={isSessionStarting || pending}
              />
              <button
                className="primary-button"
                type="button"
                onClick={() => void handlePlay()}
                disabled={!query.trim() || isSessionStarting || pending}
              >
                {pending ? 'Resolving…' : 'Play'}
              </button>
            </div>
            {error ? <p className="editor-error-copy">{error}</p> : null}
          </>
        )}
      </div>
    </section>
  )
}

export default StreamWorkspace
