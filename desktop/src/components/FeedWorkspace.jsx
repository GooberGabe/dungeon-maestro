function FeedWorkspace({ bootstrap, lastError, lastTranscript, settings, state }) {
  return (
    <section className="feed-workspace">
      <div className="panel feed-primary-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Feed</p>
            <h2>Session Feed</h2>
          </div>
        </div>

        <div className="session-grid output-grid">
          <div>
            <span className="metric-label">Config</span>
            <strong>{settings.configPath}</strong>
          </div>
          <div>
            <span className="metric-label">Default collection</span>
            <strong>{bootstrap.config.settings.default_collection}</strong>
          </div>
          <div>
            <span className="metric-label">Bot route</span>
            <strong>{state.discordStatus}</strong>
          </div>
          <div>
            <span className="metric-label">Sidecar</span>
            <strong>{state.sidecarStatus}</strong>
          </div>
          <div className="wide-metric">
            <span className="metric-label">Last transcript</span>
            <strong>{lastTranscript}</strong>
          </div>
          <div className="wide-metric">
            <span className="metric-label">Last error</span>
            <strong>{lastError}</strong>
          </div>
        </div>
      </div>
    </section>
  )
}

export default FeedWorkspace
