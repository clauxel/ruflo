import { join } from 'node:path'

function stripTrailingSlash(value) {
  return String(value ?? '').replace(/\/+$/, '')
}

export function normalizeMulticaRouterInstanceName(value) {
  const instanceName = String(value ?? '').trim()
  if (!instanceName || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(instanceName)) {
    throw new Error('Multica router instance name is invalid.')
  }

  return instanceName
}

export function buildMulticaRouterInstancePath(instanceName) {
  return `/instances/${encodeURIComponent(normalizeMulticaRouterInstanceName(instanceName))}/`
}

export function buildMulticaRouterConsoleUrl(baseUrl, instanceName) {
  const normalizedBaseUrl = stripTrailingSlash(baseUrl)
  if (!normalizedBaseUrl) {
    return ''
  }

  return `${normalizedBaseUrl}${buildMulticaRouterInstancePath(instanceName)}`
}

export function buildMulticaRouterRouteFileName(instanceName) {
  return `${normalizeMulticaRouterInstanceName(instanceName)}.json`
}

export function buildMulticaRouterRouteFilePath(routesDir, instanceName) {
  return join(String(routesDir ?? '').trim(), buildMulticaRouterRouteFileName(instanceName))
}

export function buildMulticaRouterRouteRecord({
  instanceName,
  consolePort,
  consoleHost = '127.0.0.1',
  serviceName = '',
  workspacePath = '',
  runtimeState = 'running',
}) {
  const normalizedInstanceName = normalizeMulticaRouterInstanceName(instanceName)
  const normalizedConsolePort = Number.parseInt(String(consolePort ?? ''), 10)

  if (!Number.isInteger(normalizedConsolePort) || normalizedConsolePort <= 0) {
    throw new Error('Multica router console port is invalid.')
  }

  return {
    instanceName: normalizedInstanceName,
    consoleHost: String(consoleHost ?? '').trim() || '127.0.0.1',
    consolePort: normalizedConsolePort,
    serviceName: String(serviceName ?? '').trim(),
    workspacePath: String(workspacePath ?? '').trim(),
    runtimeState: String(runtimeState ?? '').trim() || 'running',
    updatedAt: new Date().toISOString(),
  }
}
