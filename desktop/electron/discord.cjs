const { spawn } = require('child_process')

const { desktopSettings, sessionState, workspaceRoot } = require('./state.cjs')
const { normalizeDiscordId, pythonExecutable } = require('./validation.cjs')
const { saveDesktopSettings } = require('./config.cjs')

function getSelectedGuild() {
  return sessionState.discordTargets.find((guild) => guild.id === desktopSettings.discordGuildId) || null
}

function getSelectedVoiceChannel() {
  const guild = getSelectedGuild()
  if (!guild) {
    return null
  }
  return guild.voice_channels.find((channel) => channel.id === desktopSettings.discordVoiceChannelId) || null
}

function buildDiscordStatus() {
  if (!desktopSettings.botToken) {
    return 'Bot token not connected'
  }

  if (sessionState.discordDiscoveryInFlight) {
    return 'Resolving Discord guilds and voice channels...'
  }

  if (!sessionState.discordTargets.length) {
    return 'Bot token saved. No Discord servers resolved yet.'
  }

  const selectedGuild = getSelectedGuild()
  const selectedChannel = getSelectedVoiceChannel()
  if (!selectedGuild) {
    return 'Select a Discord server for voice playback.'
  }
  if (!selectedChannel) {
    return `Select a voice channel in ${selectedGuild.name}.`
  }

  return `Ready for ${selectedGuild.name} / ${selectedChannel.name}`
}

function ensureDiscordSelection() {
  const guilds = sessionState.discordTargets
  if (!guilds.length) {
    desktopSettings.discordGuildId = null
    desktopSettings.discordVoiceChannelId = null
    return
  }

  let guild = getSelectedGuild()
  if (!guild) {
    guild = guilds.find((item) => item.voice_channels.length > 0) || guilds[0]
    desktopSettings.discordGuildId = guild?.id ?? null
  }

  const voiceChannels = guild?.voice_channels || []
  const selectedChannel = voiceChannels.find((channel) => channel.id === desktopSettings.discordVoiceChannelId) || null
  desktopSettings.discordVoiceChannelId = selectedChannel?.id ?? voiceChannels[0]?.id ?? null
}

function syncConfigIntoState() {
  sessionState.connectedBot = desktopSettings.botToken.length > 0
  sessionState.outputMode = desktopSettings.outputMode
  sessionState.discordStatus = buildDiscordStatus()
}

function applyDiscordTargets(discovery) {
  sessionState.discordTargets = Array.isArray(discovery?.guilds) ? discovery.guilds : []
  sessionState.discordBotUser = discovery?.bot_user || null
  ensureDiscordSelection()
  saveDesktopSettings()
  syncConfigIntoState()
}

function resolveDiscordTargets(emitState, getBootstrapData) {
  if (!desktopSettings.botToken) {
    sessionState.discordTargets = []
    sessionState.discordBotUser = null
    desktopSettings.discordGuildId = null
    desktopSettings.discordVoiceChannelId = null
    syncConfigIntoState()
    emitState()
    return Promise.resolve(getBootstrapData())
  }

  sessionState.discordDiscoveryInFlight = true
  syncConfigIntoState()
  emitState()

  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonExecutable(),
      ['-m', 'dungeon_maestro_sidecar.discord_discovery'],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          DUNGEON_MAESTRO_DISCORD_TOKEN: desktopSettings.botToken,
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
      sessionState.discordDiscoveryInFlight = false
      sessionState.lastError = error.message
      syncConfigIntoState()
      emitState()
      reject(error)
    })

    child.on('close', (code) => {
      sessionState.discordDiscoveryInFlight = false
      if (code !== 0) {
        const message = stderr.trim() || `Discord discovery failed with exit code ${code}`
        sessionState.discordTargets = []
        sessionState.discordBotUser = null
        sessionState.lastError = message
        syncConfigIntoState()
        emitState()
        reject(new Error(message))
        return
      }

      try {
        applyDiscordTargets(JSON.parse(stdout))
        emitState()
        resolve(getBootstrapData())
      } catch (error) {
        sessionState.discordTargets = []
        sessionState.discordBotUser = null
        sessionState.lastError = error.message
        syncConfigIntoState()
        emitState()
        reject(error)
      }
    })
  })
}

module.exports = {
  getSelectedGuild,
  getSelectedVoiceChannel,
  buildDiscordStatus,
  ensureDiscordSelection,
  syncConfigIntoState,
  applyDiscordTargets,
  resolveDiscordTargets,
}
