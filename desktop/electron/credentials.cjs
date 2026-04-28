let keytarModulePromise = null

const CREDENTIAL_SERVICE = 'DungeonMaestro'
const BOT_TOKEN_ACCOUNT = 'discord-bot-token'

async function getKeytarModule() {
  if (!keytarModulePromise) {
    keytarModulePromise = import('keytar')
      .then((module) => module.default || module)
      .catch((error) => {
        keytarModulePromise = null
        throw new Error(`Credential Manager is unavailable: ${error.message}`)
      })
  }
  return keytarModulePromise
}

async function readBotTokenCredential() {
  const keytar = await getKeytarModule()
  const token = await keytar.getPassword(CREDENTIAL_SERVICE, BOT_TOKEN_ACCOUNT)
  return typeof token === 'string' ? token.trim() : ''
}

async function writeBotTokenCredential(token) {
  const normalizedToken = String(token || '').trim()
  const keytar = await getKeytarModule()
  if (!normalizedToken) {
    await keytar.deletePassword(CREDENTIAL_SERVICE, BOT_TOKEN_ACCOUNT)
    return ''
  }
  await keytar.setPassword(CREDENTIAL_SERVICE, BOT_TOKEN_ACCOUNT, normalizedToken)
  return normalizedToken
}

async function deleteBotTokenCredential() {
  const keytar = await getKeytarModule()
  await keytar.deletePassword(CREDENTIAL_SERVICE, BOT_TOKEN_ACCOUNT)
}

module.exports = {
  readBotTokenCredential,
  writeBotTokenCredential,
  deleteBotTokenCredential,
}
