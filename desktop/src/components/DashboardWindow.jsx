function DashboardWindow({
  activeCollection,
  bootstrap,
  botTokenDraft,
  chooseDiscordGuild,
  chooseDiscordVoiceChannel,
  collections,
  approveTransition,
  dismissTransition,
  discordTargets,
  handleOutputModeChange,
  handlePlaybackVolumeChange,
  handleTranscriptionProfileChange,
  handleTransitionProposalToggle,
  handleTransitionTimeoutChange,
  handleTranscriptionToggle,
  isSessionActive,
  isSessionBusy,
  isSessionStarting,
  lastError,
  lastTranscript,
  libraryFocusCollection,
  outputMode,
  playbackMuted,
  playbackPaused,
  playbackRouteLabel,
  playbackStatusLabel,
  playbackVolumePercent,
  refreshDiscordTargets,
  saveBotToken,
  selectedDiscordVoiceChannel,
  selectedGuild,
  selectedLibraryCollectionId,
  selectedVoiceChannels,
  sessionStatusClass,
  sessionStatusLabel,
  settings,
  setBotTokenDraft,
  setSelectedLibraryCollectionId,
  setStartingCollection,
  setWorkspaceTab,
  skipTrack,
  startSession,
  startingCollection,
  state,
  togglePinnedHud,
  togglePlaybackMute,
  togglePlaybackPause,
  transcriptionEnabled,
  transcriptionProfile,
  transitionProgress,
  transitionProposalsEnabled,
  transitionTimeoutSeconds,
  transportStateLabel,
  workspaceTab,
  endSession,
}) {
  return (
    <div className="app-shell">
      <aside className="control-rail">
        <div className="sidebar-frame">
          <section className="panel output-panel">
            <div className="panel-header compact">
              <div>
                <p className="eyebrow">Audio</p>
                <h2>Output Route</h2>
              </div>
            </div>

            <div className="settings-stack">
              <div className="settings-row">
                <label className="settings-name" htmlFor="output-mode">Destination</label>
                <select
                  id="output-mode"
                  className="select-field compact-select-field"
                  value={outputMode}
                  onChange={handleOutputModeChange}
                  disabled={isSessionStarting}
                >
                  <option value="local">Local</option>
                  <option value="discord">Discord</option>
                </select>
              </div>
            </div>

            <p className="status-copy">
              {outputMode === 'discord'
                ? 'Session playback will route only to the selected Discord voice channel.'
                : 'Session playback will stay local and skip Discord connection attempts.'}
            </p>
          </section>

          <section className="panel session-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Session</p>
                <h2>Launch Controls</h2>
              </div>
              <span className={`status-chip ${sessionStatusClass}`}>
                {sessionStatusLabel}
              </span>
            </div>

            <label className="field-label" htmlFor="starting-collection">Starting collection</label>
            <select
              id="starting-collection"
              className="select-field"
              value={startingCollection}
              onChange={(event) => setStartingCollection(event.target.value)}
            >
              <option value="">None (wait to start playback)</option>
              {collections.map((collection) => (
                <option key={collection.collectionId} value={collection.collectionId}>
                  {collection.name}
                </option>
              ))}
            </select>

            <div className="button-row">
              <button className="primary-button" onClick={startSession} disabled={state.sessionRunning || isSessionBusy}>Start Session</button>
              <button className="ghost-button" onClick={endSession} disabled={!state.sessionRunning && !state.startupInProgress}>End Session</button>
            </div>
          </section>

          <section className="panel discord-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Discord</p>
                <h2>Bot Connection</h2>
              </div>
              <span className={`status-chip ${state.connectedBot ? 'online' : 'idle'}`}>
                {state.discordDiscoveryInFlight ? 'Resolving' : state.connectedBot ? 'Token Saved' : 'Awaiting Token'}
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
              <button className="primary-button" onClick={saveBotToken} disabled={state.discordDiscoveryInFlight}>Save And Resolve</button>
              <button className="ghost-button" onClick={refreshDiscordTargets} disabled={!botTokenDraft.trim() || state.discordDiscoveryInFlight}>Refresh Targets</button>
            </div>
            {state.discordBotUser ? (
              <p className="status-copy">Signed in as <strong>{state.discordBotUser.username}</strong>.</p>
            ) : null}
            {discordTargets.length > 0 ? (
              <div className="stack-fields">
                <div>
                  <label className="field-label" htmlFor="discord-guild">Discord server</label>
                  <select
                    id="discord-guild"
                    className="select-field"
                    value={settings.discordGuildId || ''}
                    onChange={(event) => chooseDiscordGuild(event.target.value)}
                  >
                    {discordTargets.map((guild) => (
                      <option key={guild.id} value={guild.id}>
                        {guild.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="discord-voice-channel">Voice channel</label>
                  <select
                    id="discord-voice-channel"
                    className="select-field"
                    value={settings.discordVoiceChannelId || ''}
                    onChange={(event) => chooseDiscordVoiceChannel(event.target.value)}
                    disabled={!selectedGuild || selectedVoiceChannels.length === 0}
                  >
                    {selectedVoiceChannels.length > 0 ? (
                      selectedVoiceChannels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.name}{channel.type === 'stage' ? ' (Stage)' : ''}
                        </option>
                      ))
                    ) : (
                      <option value="">No voice channels found</option>
                    )}
                  </select>
                </div>
              </div>
            ) : null}
            <p className="status-copy">{state.discordStatus}</p>
            <p className="status-copy subdued">{state.sidecarStatus}</p>
          </section>
        </div>
      </aside>

      <main className="workspace-column">
        <div className="workspace-tabs">
          <div className="tab-row" role="tablist" aria-label="Workspace sections">
            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'live'}
              className={`tab-button ${workspaceTab === 'live' ? 'active' : ''}`}
              onClick={() => setWorkspaceTab('live')}
            >
              Live
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'library'}
              className={`tab-button ${workspaceTab === 'library' ? 'active' : ''}`}
              onClick={() => setWorkspaceTab('library')}
            >
              Library
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'feed'}
              className={`tab-button ${workspaceTab === 'feed' ? 'active' : ''}`}
              onClick={() => setWorkspaceTab('feed')}
            >
              Feed
            </button>
          </div>
        </div>

        {workspaceTab === 'library' ? (
          <section className="library-workspace">
            <div className="panel library-browser-panel">
              <div>
                <p className="eyebrow">Library</p>
                <h2>Collections</h2>
              </div>
              <div className="collection-list workspace-collection-list">
                {collections.map((collection) => (
                  <button
                    key={collection.collectionId}
                    type="button"
                    className={`collection-card collection-button ${libraryFocusCollection?.collectionId === collection.collectionId ? 'selected' : ''} ${state.activeCollection === collection.collectionId ? 'active' : ''}`}
                    onClick={() => setSelectedLibraryCollectionId(collection.collectionId)}
                  >
                    <div className="collection-title-row">
                      <h3>{collection.name}</h3>
                      <span>{collection.trackCount} tracks</span>
                    </div>
                    <p className="keyword-line">{collection.keywords.join(' • ')}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel collection-editor-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Collection Detail</p>
                  <h2>{libraryFocusCollection?.name || 'No collection selected'}</h2>
                </div>
                {libraryFocusCollection ? (
                  <span className={`status-chip ${state.activeCollection === libraryFocusCollection.collectionId ? 'online' : 'idle'}`}>
                    {state.activeCollection === libraryFocusCollection.collectionId ? 'Active Now' : 'Library View'}
                  </span>
                ) : null}
              </div>

              {libraryFocusCollection ? (
                <>
                  <div className="detail-grid">
                    <div>
                      <span className="metric-label">Collection ID</span>
                      <strong>{libraryFocusCollection.collectionId}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Tracks</span>
                      <strong>{libraryFocusCollection.trackCount}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Keywords</span>
                      <strong>{libraryFocusCollection.keywords.length}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Session start target</span>
                      <strong>{startingCollection ? (startingCollection === libraryFocusCollection.collectionId ? 'Yes' : 'No') : 'Config default'}</strong>
                    </div>
                  </div>

                  <div className="collection-detail-block">
                    <span className="metric-label">Keywords</span>
                    <div className="keyword-chip-row">
                      {libraryFocusCollection.keywords.map((keyword) => (
                        <span key={keyword} className="keyword-chip">{keyword}</span>
                      ))}
                    </div>
                  </div>

                  <div className="collection-detail-block subdued-panel">
                    <span className="metric-label">Editing surface</span>
                    <p className="supporting-text">
                      This panel is reserved for collection editing. For now it keeps metadata organized and leaves room for the first real track and keyword management actions.
                    </p>
                    <div className="button-row">
                      <button className="ghost-button" disabled>Rename Collection</button>
                      <button className="ghost-button" disabled>Edit Keywords</button>
                      <button className="ghost-button" disabled>Manage Tracks</button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="supporting-text">Choose a collection from the library browser to inspect its metadata.</p>
              )}
            </div>
          </section>
        ) : workspaceTab === 'feed' ? (
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
        ) : (
          <section className="live-workspace">
            {!isSessionActive ? (
              <div className="panel live-idle-panel">
                <p className="eyebrow">Live</p>
                <h2>No session currently active.</h2>
                <p className="supporting-text">Start a session from the left rail to enable playback controls, route status, transcript updates, and transition handling.</p>
              </div>
            ) : (
              <>
                <div className="panel live-deck-panel">
                  {isSessionStarting ? (
                    <div className="loading-banner" role="status" aria-live="polite">
                      <span className="loading-dot" />
                      <div>
                        <strong>Preparing session</strong>
                        <p className="supporting-text loading-copy">The sidecar is resolving tracks, standing up the audio loop, and connecting playback routes. This can take a minute or two.</p>
                      </div>
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}

                  <div className="live-summary-grid">
                    <div className="live-summary-card emphasis-card">
                      <span className="metric-label">Output route</span>
                      <strong>{playbackRouteLabel}</strong>
                    </div>
                    <div className="live-summary-card">
                      <span className="metric-label">Transcript stream</span>
                      <strong>{lastTranscript}</strong>
                    </div>
                    <div className="live-summary-card">
                      <span className="metric-label">Active collection</span>
                      <strong>{activeCollection?.name || 'No collection active'}</strong>
                    </div>
                    <div className="live-summary-card">
                      <span className="metric-label">Session state</span>
                      <strong>{isSessionStarting ? 'Preparing session' : 'Live'}</strong>
                    </div>
                  </div>

                  <div className="transport-ribbon">
                    <div className="transport-group">
                      <div className="transport-header-row">
                        <span className="metric-label">Transport</span>
                        <span className={`status-chip mini-chip ${playbackMuted ? 'idle' : 'online'}`}>
                          {transportStateLabel}
                        </span>
                      </div>
                      <div className="button-row compact-actions">
                        <button className="primary-button" onClick={skipTrack} disabled={isSessionStarting}>Skip Track</button>
                        <button className="ghost-button" onClick={togglePlaybackPause} disabled={isSessionStarting}>{playbackPaused ? 'Play' : 'Pause'}</button>
                        <button className="ghost-button" onClick={togglePlaybackMute} disabled={isSessionStarting}>{playbackMuted ? 'Unmute' : 'Mute'}</button>
                      </div>
                    </div>

                    <div className="transport-group volume-group">
                      <div className="transport-header-row">
                        <span className="metric-label">Volume</span>
                        <strong className="volume-readout">{playbackStatusLabel}</strong>
                      </div>
                      <input className="slider-field" type="range" min="0" max="100" value={playbackVolumePercent} onChange={handlePlaybackVolumeChange} disabled={isSessionStarting} />
                      <div className="transport-footnote-row">
                        <span className="supporting-text compact-copy">Applies live to current playback.</span>
                        <span className="supporting-text compact-copy">{playbackRouteLabel}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="live-side-column">
              <div className={`panel transition-panel ${state.pendingTransition ? 'visible' : 'muted'}`}>
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
                    <div className="transition-timer-block">
                      <div className="transition-progress-track" aria-hidden="true">
                        <div className="transition-progress-fill" style={{ transform: `scaleX(${transitionProgress})` }} />
                      </div>
                    </div>
                    <div className="button-row hud-actions">
                      <button className="primary-button" onClick={approveTransition}>Switch Collection</button>
                      <button className="ghost-button" onClick={dismissTransition}>Dismiss</button>
                    </div>
                  </>
                ) : (
                  <p className="supporting-text">Transition prompts will appear here when a detected phrase proposes a collection switch.</p>
                )}
              </div>

              <div className="panel live-status-panel session-settings-panel">
                <div className="panel-header compact">
                  <div>
                    <p className="eyebrow">Session</p>
                    <h2>Session Settings</h2>
                  </div>
                </div>

                <div className="settings-stack">
                  <label className="settings-row toggle-row">
                    <span className="settings-name">Live transcription</span>
                    <input type="checkbox" checked={transcriptionEnabled} onChange={handleTranscriptionToggle} />
                  </label>

                  <div className={`settings-row ${!transcriptionEnabled ? 'disabled' : ''}`}>
                    <label className="settings-name" htmlFor="transcription-profile">Profile</label>
                    <select
                      id="transcription-profile"
                      className="select-field compact-select-field"
                      value={transcriptionProfile}
                      onChange={handleTranscriptionProfileChange}
                      disabled={!transcriptionEnabled}
                    >
                      <option value="fast">Fast</option>
                      <option value="balanced">Balanced</option>
                      <option value="accurate">Accurate</option>
                    </select>
                  </div>

                  <label className={`settings-row toggle-row ${!transcriptionEnabled ? 'disabled' : ''}`}>
                    <span className="settings-name">Transition proposals</span>
                    <input type="checkbox" checked={transcriptionEnabled && transitionProposalsEnabled} onChange={handleTransitionProposalToggle} disabled={!transcriptionEnabled} />
                  </label>

                  <div className="settings-row">
                    <label className="settings-name" htmlFor="transition-timeout-seconds">Transition timeout</label>
                    <div className="number-field-row compact-number-row">
                      <input
                        id="transition-timeout-seconds"
                        className="number-field compact-number-field"
                        type="number"
                        min="5"
                        max="300"
                        step="5"
                        value={transitionTimeoutSeconds}
                        onChange={handleTransitionTimeoutChange}
                      />
                      <span className="number-suffix">s</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      <button className="dashboard-fab" type="button" onClick={togglePinnedHud} title="Collapse into pinned HUD">
        <img src="/flip.svg" alt="Collapse into pinned HUD" />
      </button>
    </div>
  )
}

export default DashboardWindow