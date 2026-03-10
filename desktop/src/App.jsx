import { useEffect, useMemo, useState } from 'react'

function App() {
  const [bootstrap, setBootstrap] = useState(null)
  const [botTokenDraft, setBotTokenDraft] = useState('')
  const [startingCollection, setStartingCollection] = useState('')
  const [bootstrapError, setBootstrapError] = useState('')

  useEffect(() => {
    if (!window.dungeonMaestro) {
      setBootstrapError('Electron preload bridge is unavailable. The dashboard cannot talk to the main process yet.')
      return undefined
    }

    let unsubscribe = null

    window.dungeonMaestro.getBootstrapData()
      .then((data) => {
        setBootstrap(data)
        setBotTokenDraft(data.settings.botToken || '')
        setStartingCollection(data.config.settings.default_collection || data.config.collections[0]?.collectionId || '')
      })
      .catch((error) => {
        setBootstrapError(error?.message || String(error))
      })

    try {
      unsubscribe = window.dungeonMaestro.onStateChanged((data) => {
        setBootstrap(data)
      })
    } catch (error) {
      setBootstrapError(error?.message || String(error))
    }

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [])

  const collections = bootstrap?.config.collections || []
  const state = bootstrap?.state
  const settings = bootstrap?.settings

  const activeCollection = useMemo(
    () => collections.find((collection) => collection.collectionId === state?.activeCollection),
    [collections, state?.activeCollection]
  )

  if (bootstrapError) {
    return (
      <div className="loading-shell error-shell">
        <div className="error-panel">
          <p className="eyebrow">Dashboard Error</p>
          <h1>Renderer bootstrap failed.</h1>
          <p className="supporting-text">{bootstrapError}</p>
        </div>
      </div>
    )
  }

  if (!bootstrap) {
    return <div className="loading-shell">Forging dashboard...</div>
  }

  const saveBotToken = async () => {
    const updated = await window.dungeonMaestro.saveBotToken(botTokenDraft)
    setBootstrap(updated)
  }

  const startSession = async () => {
    const updated = await window.dungeonMaestro.startSession({ startingCollection })
    setBootstrap(updated)
  }

  const endSession = async () => {
    const updated = await window.dungeonMaestro.endSession()
    setBootstrap(updated)
  }

  const skipTrack = async () => {
    const updated = await window.dungeonMaestro.skipTrack()
    setBootstrap(updated)
  }

  const approveTransition = async () => {
    const updated = await window.dungeonMaestro.approveTransition()
    setBootstrap(updated)
  }

  const dismissTransition = async () => {
    const updated = await window.dungeonMaestro.dismissTransition()
    setBootstrap(updated)
  }

  return (
    <div className="app-shell">
      <aside className="control-rail">
        <div className="brand-card panel">
          <p className="eyebrow">DungeonMaestro</p>
          <h1>Blue halls, gilded torchlight, one command center.</h1>
          <p className="supporting-text">
            Dashboard-first Phase 4 shell. The floating pin window comes later, but every live-session control already lives here.
          </p>
        </div>

        <section className="panel discord-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Discord</p>
              <h2>Bot Connection</h2>
            </div>
            <span className={`status-chip ${state.connectedBot ? 'online' : 'idle'}`}>
              {state.connectedBot ? 'Token Saved' : 'Awaiting Token'}
            </span>
          </div>

          <label className="field-label" htmlFor="bot-token">Bot token</label>
          <textarea
            id="bot-token"
            className="token-field"
            rows={4}
            value={botTokenDraft}
            onChange={(event) => setBotTokenDraft(event.target.value)}
            placeholder="Paste the bot token once. The dashboard will own the rest of the Discord wiring."
          />
          <div className="button-row">
            <button className="primary-button" onClick={saveBotToken}>Save Token</button>
          </div>
          <p className="status-copy">{state.discordStatus}</p>
          <p className="status-copy subdued">{state.sidecarStatus}</p>
        </section>

        <section className="panel session-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Session</p>
              <h2>Launch Controls</h2>
            </div>
            <span className={`status-chip ${state.sessionRunning ? 'online' : 'idle'}`}>
              {state.sessionRunning ? 'Live' : 'Idle'}
            </span>
          </div>

          <label className="field-label" htmlFor="starting-collection">Starting collection</label>
          <select
            id="starting-collection"
            className="select-field"
            value={startingCollection}
            onChange={(event) => setStartingCollection(event.target.value)}
          >
            {collections.map((collection) => (
              <option key={collection.collectionId} value={collection.collectionId}>
                {collection.name}
              </option>
            ))}
          </select>

          <div className="session-grid">
            <div>
              <span className="metric-label">Config</span>
              <strong>{settings.configPath}</strong>
            </div>
            <div>
              <span className="metric-label">Default collection</span>
              <strong>{bootstrap.config.settings.default_collection}</strong>
            </div>
            <div>
              <span className="metric-label">Last transcript</span>
              <strong>{state.lastTranscript || 'No transcript yet'}</strong>
            </div>
            <div>
              <span className="metric-label">Last error</span>
              <strong>{state.lastError || 'No errors'}</strong>
            </div>
          </div>

          <div className="button-row">
            <button className="primary-button" onClick={startSession}>Start Session</button>
            <button className="ghost-button" onClick={endSession}>End Session</button>
          </div>
        </section>

        <section className="panel collection-panel">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Collections</p>
              <h2>Current Library</h2>
            </div>
          </div>
          <div className="collection-list">
            {collections.map((collection) => (
              <article key={collection.collectionId} className={`collection-card ${state.activeCollection === collection.collectionId ? 'active' : ''}`}>
                <div className="collection-title-row">
                  <h3>{collection.name}</h3>
                  <span>{collection.trackCount} tracks</span>
                </div>
                <p className="keyword-line">{collection.keywords.join(' • ')}</p>
              </article>
            ))}
          </div>
        </section>
      </aside>

      <main className="stage-column">
        <section className="panel stage-hero">
          <div>
            <p className="eyebrow">Dashboard HUD</p>
            <h2>All live controls stay here until the pin window ships.</h2>
          </div>
          <p className="supporting-text">
            The compact floating window can come later. For now, skip, approve, dismiss, and track context are all available directly inside the dashboard.
          </p>
        </section>

        <section className="hud-board">
          <div className="hud-compact panel">
            <div className="hud-topline">
              <div>
                <p className="hud-label">Now playing</p>
                <h3>{activeCollection?.name || 'No active collection'}</h3>
              </div>
              <span className="track-pill">
                {state.currentTrackIndex === null ? 'Track --' : `Track ${state.currentTrackIndex + 1}`}
              </span>
            </div>

            <p className="current-track">{state.currentTrackTitle}</p>

            <div className="button-row hud-actions">
              <button className="primary-button" onClick={skipTrack}>Skip Track</button>
              <button className="ghost-button" onClick={startSession}>Launch Dashboard Session</button>
            </div>
          </div>

          <div className={`hud-expanded panel ${state.pendingTransition ? 'visible' : 'muted'}`}>
            <div className="panel-header compact">
              <div>
                <p className="eyebrow">Transition gate</p>
                <h2>{state.pendingTransition ? 'Pending switch' : 'No pending transition'}</h2>
              </div>
            </div>

            {state.pendingTransition ? (
              <>
                <p className="transition-copy">
                  <span className="transition-keyword">“{state.pendingTransition.keyword}”</span> detected. Move to{' '}
                  <strong>{state.pendingTransition.displayName}</strong>?
                </p>
                <div className="button-row hud-actions">
                  <button className="primary-button" onClick={approveTransition}>Switch Collection</button>
                  <button className="ghost-button" onClick={dismissTransition}>Dismiss</button>
                </div>
              </>
            ) : (
              <p className="supporting-text">Transition prompts will surface here with the same controls planned for the future pinned HUD.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App