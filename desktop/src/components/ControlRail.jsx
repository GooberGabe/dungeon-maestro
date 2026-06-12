import { useMemo, useState } from 'react'

function ControlRail({
  botTokenDraft,
  exportSoundscapes,
  hasSavedBotToken,
  importSoundscapes,
  chooseDiscordGuild,
  chooseDiscordVoiceChannel,
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
  settings,
  startSession,
  endSession,
  state,
}) {
  const [isEditingBotToken, setIsEditingBotToken] = useState(false)
  const [libraryIoMode, setLibraryIoMode] = useState('merge')
  const [libraryIoStatus, setLibraryIoStatus] = useState('')
  const [libraryIoPending, setLibraryIoPending] = useState(false)
  const displayedBotToken = useMemo(() => {
    if (isEditingBotToken) {
      return botTokenDraft
    }
    if (botTokenDraft) {
      return botTokenDraft.replace(/./g, '•')
    }
    if (hasSavedBotToken) {
      return '••••••••••••••••'
    }
    return botTokenDraft.replace(/./g, '•')
  }, [botTokenDraft, hasSavedBotToken, isEditingBotToken])

  const handleExport = async () => {
    setLibraryIoStatus('')
    setLibraryIoPending(true)
    try {
      const response = await exportSoundscapes()
      if (!response?.cancelled) {
        setLibraryIoStatus(`Exported ${response.exported} soundscape${response.exported !== 1 ? 's' : ''}.`)
      }
    } catch (error) {
      setLibraryIoStatus(error?.message || 'Export failed.')
    } finally {
      setLibraryIoPending(false)
    }
  }

  const handleImport = async () => {
    setLibraryIoStatus('')
    setLibraryIoPending(true)
    try {
      const response = await importSoundscapes(libraryIoMode)
      if (!response?.cancelled) {
        const { importedCount, skippedCount } = response
        let msg = `Imported ${importedCount} soundscape${importedCount !== 1 ? 's' : ''}.`
        if (skippedCount > 0) {
          msg += ` ${skippedCount} skipped (already exist).`
        }
        setLibraryIoStatus(msg)
      }
    } catch (error) {
      setLibraryIoStatus(error?.message || 'Import failed.')
    } finally {
      setLibraryIoPending(false)
    }
  }

  return (
    <aside className="control-rail">
      <div className="sidebar-frame">
        <section className="panel session-panel launch-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Session</p>
              <h2>Launch Controls</h2>
            </div>
            <span className={`status-chip ${sessionStatusClass}`}>
              {sessionStatusLabel}
            </span>
          </div>

          <div className="settings-stack">
            <div className="settings-row">
              <label className="settings-name" htmlFor="output-mode">Output route</label>
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
            value={displayedBotToken}
            onFocus={() => setIsEditingBotToken(true)}
            onBlur={() => setIsEditingBotToken(false)}
            onChange={(event) => setBotTokenDraft(event.target.value)}
            readOnly={!isEditingBotToken}
            placeholder="Paste the bot token once. The dashboard will own the rest of the Discord wiring."
          />
          <div className="button-row">
            <button className="primary-button" onClick={saveBotToken} disabled={!botTokenDraft.trim() || state.discordDiscoveryInFlight}>Save And Resolve</button>
            <button className="ghost-button" onClick={refreshDiscordTargets} disabled={!(botTokenDraft.trim() || hasSavedBotToken) || state.discordDiscoveryInFlight}>Refresh Targets</button>
          </div>
          {hasSavedBotToken ? (
            <p className="status-copy subdued">Token is saved in Windows Credential Manager.</p>
          ) : null}
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

        <section className="panel library-io-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Library</p>
              <h2>Import / Export</h2>
            </div>
          </div>

          <div className="settings-stack">
            <div className="settings-row">
              <label className="settings-name" htmlFor="library-io-mode">Import mode</label>
              <select
                id="library-io-mode"
                className="select-field compact-select-field"
                value={libraryIoMode}
                onChange={(event) => { setLibraryIoMode(event.target.value); setLibraryIoStatus('') }}
                disabled={libraryIoPending}
              >
                <option value="merge">Merge</option>
                <option value="replace">Replace all</option>
              </select>
            </div>
            {libraryIoMode === 'replace' && (
              <p className="status-copy">All existing soundscapes will be removed before importing.</p>
            )}
          </div>

          <div className="button-row">
            <button className="primary-button" onClick={handleImport} disabled={libraryIoPending}>Import</button>
            <button className="ghost-button" onClick={handleExport} disabled={libraryIoPending}>Export</button>
          </div>
          {libraryIoStatus && <p className="status-copy">{libraryIoStatus}</p>}
        </section>
      </div>
    </aside>
  )
}

export default ControlRail
