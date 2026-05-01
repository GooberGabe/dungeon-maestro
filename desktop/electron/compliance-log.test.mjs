import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createComplianceLogger, sanitizePayload } = require('./compliance-log.cjs')

describe('compliance-log', () => {
  let tempDir

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-compliance-log-'))
  })

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('sanitizes sensitive payload keys and hashes ids', () => {
    const sanitized = sanitizePayload({
      discord_token: 'token-value',
      guild_id: '12345',
      message: 'hello',
    })

    expect(sanitized.discord_token).toBe('[redacted]')
    expect(sanitized.guild_id).toBeUndefined()
    expect(sanitized.guild_id_hash).toBeTypeOf('string')
    expect(sanitized.message).toBe('hello')
  })

  it('writes structured records and rotates files', () => {
    const logger = createComplianceLogger({
      logDirectory: tempDir,
      maxBytes: 200,
      maxFiles: 2,
    })

    for (let index = 0; index < 12; index += 1) {
      logger.write({
        name: 'discord_track_switch',
        payload: {
          guild_id: `guild-${index}`,
          track_title: 'A'.repeat(40),
        },
      })
    }

    logger.close()

    const activePath = path.join(tempDir, 'discord-compliance.log.jsonl')
    const rotatedPath = `${activePath}.1`

    expect(fs.existsSync(activePath)).toBe(true)
    expect(fs.existsSync(rotatedPath)).toBe(true)

    const line = fs.readFileSync(activePath, 'utf8').trim().split(/\r?\n/).filter(Boolean)[0]
    const parsed = JSON.parse(line)
    expect(parsed.name).toBe('discord_track_switch')
    expect(parsed.payload.guild_id).toBeUndefined()
    expect(parsed.payload.guild_id_hash).toBeTypeOf('string')
  })
})
