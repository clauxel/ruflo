import type { RouteView } from '../app-types'

export const launchDraftStorageKey = 'ruflo-draft'

export function normalizePathname(pathname: string) {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

export function scrollToHashTarget(hash: string, behavior: ScrollBehavior = 'smooth') {
  if (!hash) {
    return
  }

  const target = document.querySelector(hash)
  if (!(target instanceof HTMLElement)) {
    return
  }

  target.scrollIntoView({ behavior, block: 'start' })
}

export function deriveRouteView(pathname: string): RouteView {
  const normalized = normalizePathname(pathname)
  if (normalized === '/') return 'home'
  if (normalized === '/plans') return 'plans'
  if (normalized === '/console') return 'console'
  if (normalized === '/checkout') return 'console'
  if (normalized === '/privacy') return 'privacy'
  if (normalized === '/terms') return 'terms'
  if (normalized.startsWith('/compare/')) return 'compare'
  if (normalized.startsWith('/solutions/')) return 'solution'
  if (normalized.startsWith('/resources/')) return 'resource'
  return 'notFound'
}
