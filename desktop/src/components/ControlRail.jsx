function ControlRail({
  botTokenDraft,
  chooseDiscordGuild,
  chooseDiscordVoiceChannel,
  collections,
  discordTargets,
  handleOutputModeChange,
  isSessionStarting,
  isSessionBusy,
  outputMode,
  refreshDiscordTargets,
  saveBotToken,
  selectedGuild,
  selectedVoiceChannels,
  sessionStatusClass,
  sessionStatusLabel,
  setBotTokenDraft,
  setStartingCollection,
  settings,
  startingCollection,
  startSession,
  endSession,
  state,
}) {
  return (
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
  )
}

export default ControlRail
