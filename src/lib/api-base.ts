const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')

export function getApiBaseUrl() {
  return configuredApiBaseUrl
}

export function resolveApiUrl(path: string) {
  const apiBaseUrl = getApiBaseUrl()
  if (!apiBaseUrl) {
    return path
  }

  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`
}
