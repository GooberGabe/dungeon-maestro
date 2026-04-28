#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const args = new Map(
  process.argv.slice(2)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const [key, ...rest] = value.split('=')
      return [key, rest.join('=')]
    })
)

const mode = args.get('--mode') || 'git'
const rootPath = path.resolve(args.get('--root') || '.')

const textExtensions = new Set([
  '.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx', '.json', '.yaml', '.yml', '.ini', '.cfg', '.env', '.txt', '.md', '.toml', '.py', '.ps1', '.sh',
])

const blockedPatterns = [
  /mfa\.[A-Za-z0-9_-]{20,}/g,
  /[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{20,}/g,
  /(discord(?:_|-)?token|bot(?:_|-)?token|api(?:_|-)?key|secret|password)\s*[:=]\s*['\"][^'\"\n]{16,}['\"]/gi,
  /DISCORD_BOT_TOKEN\s*=\s*[^\s#]{16,}/g,
]

const ignoredPathFragments = [
  `${path.sep}.git${path.sep}`,
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.venv${path.sep}`,
  `${path.sep}desktop${path.sep}node_modules${path.sep}`,
  `${path.sep}desktop${path.sep}release${path.sep}`,
  `${path.sep}desktop${path.sep}sidecar-python${path.sep}`,
]

function isLikelyTextFile(filePath) {
  return textExtensions.has(path.extname(filePath).toLowerCase())
}

function normalizeForDisplay(filePath) {
  return path.relative(process.cwd(), filePath).split(path.sep).join('/')
}

function shouldIgnorePath(filePath) {
  return ignoredPathFragments.some((fragment) => filePath.includes(fragment))
}

function collectFilesFromDirectory(directoryPath) {
  const files = []
  const stack = [directoryPath]

  while (stack.length) {
    const current = stack.pop()
    const stat = fs.statSync(current)
    if (stat.isDirectory()) {
      const children = fs.readdirSync(current, { withFileTypes: true })
      for (const child of children) {
        stack.push(path.join(current, child.name))
      }
      continue
    }
    files.push(current)
  }

  return files
}

function collectTrackedFiles(repositoryRoot) {
  const output = execFileSync('git', ['-C', repositoryRoot, 'ls-files'], { encoding: 'utf8' })
  return output
    .split(/\r?\n/)
    .map((relativePath) => relativePath.trim())
    .filter(Boolean)
    .map((relativePath) => path.resolve(repositoryRoot, relativePath))
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const findings = []
  for (const pattern of blockedPatterns) {
    pattern.lastIndex = 0
    const match = pattern.exec(content)
    if (match) {
      findings.push({
        pattern: pattern.toString(),
        snippet: match[0].slice(0, 160),
      })
    }
  }
  return findings
}

let candidates
if (mode === 'git') {
  candidates = collectTrackedFiles(rootPath)
} else if (mode === 'dir') {
  if (!fs.existsSync(rootPath)) {
    throw new Error(`Guard scan path does not exist: ${rootPath}`)
  }
  candidates = collectFilesFromDirectory(rootPath)
} else {
  throw new Error(`Unsupported mode: ${mode}. Use --mode=git or --mode=dir`)
}

const findings = []
for (const filePath of candidates) {
  if (shouldIgnorePath(filePath) || !isLikelyTextFile(filePath)) {
    continue
  }

  let fileFindings
  try {
    fileFindings = scanFile(filePath)
  } catch {
    continue
  }

  for (const finding of fileFindings) {
    findings.push({
      filePath: normalizeForDisplay(filePath),
      ...finding,
    })
  }
}

if (findings.length) {
  console.error('Release secret guard failed. Potential secret material detected:')
  for (const finding of findings) {
    console.error(`- ${finding.filePath}`)
    console.error(`  pattern: ${finding.pattern}`)
    console.error(`  snippet: ${finding.snippet}`)
  }
  process.exit(1)
}

console.log(`Release secret guard passed for mode=${mode} root=${normalizeForDisplay(rootPath) || '.'}`)
