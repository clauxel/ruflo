import { createHash } from 'node:crypto'

function stripTrailingSlash(value) {
  return String(value ?? '').replace(/\/+$/, '')
}

function normalizeRemoteAddress(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized
}

export function normalizeModelProxyUpstreamBaseUrl(value) {
  const normalized = stripTrailingSlash(String(value ?? '').trim())
  if (!normalized) {
    return ''
  }

  return /\/v\d+$/i.test(normalized) ? normalized : `${normalized}/v1`
}

export function buildInternalModelProxyBaseUrl(instanceName, environment = process.env) {
  const configuredBaseUrl = stripTrailingSlash(String(environment.MULTICA_MODEL_PROXY_INTERNAL_BASE_URL ?? '').trim())
  const baseUrl =
    configuredBaseUrl || `http://127.0.0.1:${Number(environment.PORT ?? 5175) || 5175}/api/internal/model-proxy`
  const normalizedInstanceName = String(instanceName ?? '').trim()

  if (!normalizedInstanceName) {
    return `${baseUrl}/v1`
  }

  return `${baseUrl}/${encodeURIComponent(normalizedInstanceName)}/v1`
}

export function buildModelProxyInternalToken(instanceName, environment = process.env) {
  const normalizedInstanceName = String(instanceName ?? '').trim()
  const secret = String(
    environment.MULTICA_MODEL_PROXY_INTERNAL_SECRET ??
      environment.MULTICA_CONFIG_SECRET ??
      environment.MULTICA_TOKEN_SECRET ??
      '',
  ).trim()

  if (!normalizedInstanceName || !secret) {
    return ''
  }

  return createHash('sha256').update(`${secret}:${normalizedInstanceName}`).digest('hex')
}

export function isLoopbackAddress(address) {
  const normalized = normalizeRemoteAddress(address)
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1'
}

export function isAllowedModelProxyRemoteAddress(address, environment = process.env) {
  if (isLoopbackAddress(address)) {
    return true
  }

  const normalized = normalizeRemoteAddress(address)
  const configuredAddresses = String(environment.MULTICA_MODEL_PROXY_ALLOWED_REMOTE_ADDRESSES ?? '')
    .split(',')
    .map((item) => normalizeRemoteAddress(item))
    .filter(Boolean)

  return configuredAddresses.includes(normalized)
}
