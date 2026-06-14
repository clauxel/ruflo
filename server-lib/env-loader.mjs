import { existsSync, readFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'

function parseEnvValue(rawValue) {
  const value = rawValue.trim()
  if (!value) {
    return ''
  }

  const quote = value[0]
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    const inner = value.slice(1, -1)
    return quote === '"'
      ? inner
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
      : inner.replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  }

  return value.replace(/\s+#.*$/, '').trim()
}

function parseEnvContent(content) {
  const entries = []

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const normalizedLine = line.startsWith('export ') ? line.slice(7).trim() : line
    const separatorIndex = normalizedLine.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = normalizedLine.slice(0, separatorIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue
    }

    const value = parseEnvValue(normalizedLine.slice(separatorIndex + 1))
    entries.push([key, value])
  }

  return entries
}

function getAutomaticCandidates(projectRoot, runtimeMode) {
  const normalizedMode = String(runtimeMode || 'development').trim().toLowerCase()
  const isProduction = normalizedMode === 'production'

  if (isProduction) {
    return [join(projectRoot, '.env.production')]
  }

  return [join(projectRoot, '.env.development')]
}

export function loadLocalEnvironment({
  projectRoot,
  runtimeMode = 'development',
  environment = process.env,
  explicitEnvPath = environment.GENERICAGENT_ENV_PATH ?? environment.MULTICA_ENV_PATH ?? '',
}) {
  if (environment.VERCEL || environment.GENERICAGENT_DISABLE_LOCAL_ENV === 'true') {
    return []
  }

  const protectedKeys = new Set(Object.keys(environment))
  const explicitPaths = explicitEnvPath
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolve(projectRoot, item))

  const candidates = [
    ...getAutomaticCandidates(projectRoot, runtimeMode),
    ...explicitPaths,
  ]

  const loadedFiles = []

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue
    }

    const content = readFileSync(filePath, 'utf8')
    const entries = parseEnvContent(content)

    for (const [key, value] of entries) {
      if (protectedKeys.has(key)) {
        continue
      }

      environment[key] = value
    }

    loadedFiles.push(filePath)
  }

  return loadedFiles
}
