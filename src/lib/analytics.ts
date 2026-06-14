import { resolveApiUrl } from './api-base'
const visitorStorageKey = 'ruflo-analytics-visitor-id'
const sessionStorageKey = 'ruflo-analytics-session'
const pendingEventsStorageKey = 'ruflo-analytics-pending-events'
const sessionInactivityMs = 30 * 60 * 1000
const flushIntervalMs = 2000
const maxQueuedEvents = 250
const sectionSelector = '[data-analytics-section]'
const trackedScrollDepths = [25, 50, 75, 100]

type AnalyticsEventType = 'session' | 'page' | 'section' | 'scroll' | 'click' | 'business' | 'error'

type AnalyticsEventPayload = {
  id: string
  visitorId: string
  sessionId: string
  occurredAt: string
  sessionStartedAt: string
  eventType: AnalyticsEventType
  eventName: string
  routePath: string
  pageKey?: string | null
  sectionKey?: string | null
  elementKey?: string | null
  orderId?: string | null
  referrerHost?: string | null
  browserLanguage?: string | null
  deviceType?: string | null
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  utmTerm?: string | null
  utmContent?: string | null
  metadata?: Record<string, unknown>
}

type TrackEventInput = {
  eventType: AnalyticsEventType
  eventName: string
  pageKey?: string | null
  sectionKey?: string | null
  elementKey?: string | null
  orderId?: string | null
  metadata?: Record<string, unknown>
}

type AnalyticsSessionState = {
  id: string
  startedAt: string
  lastSeenAt: string
}

let initialized = false
let pendingEvents: AnalyticsEventPayload[] = []
let flushTimer: number | null = null
let seenSections = new Set<string>()
let seenScrollDepths = new Set<string>()
let contentObserver: IntersectionObserver | null = null
let currentRouteKey = '/'
let lastTrackedPageKey = ''
const trackedClientErrors = new Set<string>()

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function sanitizeIdentifier(value: string | null | undefined, maxLength = 80) {
  if (!value) {
    return null
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_/-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return normalized ? normalized.slice(0, maxLength) : null
}

function sanitizeText(value: string | null | undefined, maxLength = 160) {
  if (!value) {
    return null
  }

  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function sanitizeRoutePath(pathname: string, search: string) {
  const url = new URL(`${pathname}${search}`, window.location.origin)
  const allowedQueryKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref']
  const sanitizedSearch = new URLSearchParams()

  for (const key of allowedQueryKeys) {
    const value = sanitizeText(url.searchParams.get(key), 120)
    if (value) {
      sanitizedSearch.set(key, value)
    }
  }

  return sanitizedSearch.size > 0 ? `${url.pathname}?${sanitizedSearch.toString()}` : url.pathname
}

function getReferrerHost() {
  if (!document.referrer) {
    return null
  }

  try {
    return new URL(document.referrer).host
  } catch {
    return null
  }
}

function getVisitorId() {
  try {
    const existing = localStorage.getItem(visitorStorageKey)
    if (existing) {
      return existing
    }

    const next = generateId()
    localStorage.setItem(visitorStorageKey, next)
    return next
  } catch {
    return generateId()
  }
}

function getSessionState() {
  const now = Date.now()

  try {
    const raw = sessionStorage.getItem(sessionStorageKey)
    if (raw) {
      const parsed = JSON.parse(raw) as AnalyticsSessionState
      if (parsed?.id && parsed?.startedAt && parsed?.lastSeenAt) {
        const lastSeenAt = Date.parse(parsed.lastSeenAt)
        if (Number.isFinite(lastSeenAt) && now - lastSeenAt < sessionInactivityMs) {
          const refreshed = {
            ...parsed,
            lastSeenAt: new Date(now).toISOString(),
          }
          sessionStorage.setItem(sessionStorageKey, JSON.stringify(refreshed))
          return { ...refreshed, isNew: false }
        }
      }
    }

    const next = {
      id: generateId(),
      startedAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
    }
    sessionStorage.setItem(sessionStorageKey, JSON.stringify(next))
    return { ...next, isNew: true }
  } catch {
    const fallback = {
      id: generateId(),
      startedAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
    }
    return { ...fallback, isNew: true }
  }
}

function getDeviceType() {
  const width = window.innerWidth
  if (width < 768) {
    return 'mobile'
  }

  if (width < 1100) {
    return 'tablet'
  }

  return 'desktop'
}

function getCurrentPageKey(pathname: string) {
  if (pathname === '/') {
    return 'home'
  }

  if (pathname.startsWith('/plans')) {
    return 'plans'
  }

  if (pathname.startsWith('/console')) {
    return 'console'
  }

  if (pathname.startsWith('/compare')) {
    return 'compare'
  }

  if (pathname.startsWith('/solutions/')) {
    return 'solution'
  }

  if (pathname.startsWith('/resources/')) {
    return 'resource'
  }

  if (pathname.startsWith('/privacy')) {
    return 'privacy'
  }

  if (pathname.startsWith('/terms')) {
    return 'terms'
  }

  return 'other'
}

function persistPendingEvents() {
  try {
    localStorage.setItem(pendingEventsStorageKey, JSON.stringify(pendingEvents.slice(-maxQueuedEvents)))
  } catch {}
}

function loadPendingEvents() {
  try {
    const raw = localStorage.getItem(pendingEventsStorageKey)
    if (!raw) {
      return
    }

    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      pendingEvents = parsed.slice(-maxQueuedEvents)
    }
  } catch {}
}

function scheduleFlush() {
  if (flushTimer !== null) {
    return
  }

  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flushAnalyticsEvents()
  }, flushIntervalMs)
}

function buildBaseEvent(input: TrackEventInput): AnalyticsEventPayload {
  const session = getSessionState()
  const routePath = sanitizeRoutePath(window.location.pathname, window.location.search)

  return {
    id: generateId(),
    visitorId: getVisitorId(),
    sessionId: session.id,
    occurredAt: new Date().toISOString(),
    sessionStartedAt: session.startedAt,
    eventType: input.eventType,
    eventName: sanitizeIdentifier(input.eventName, 64) ?? 'unknown_event',
    routePath,
    pageKey: sanitizeIdentifier(input.pageKey ?? getCurrentPageKey(window.location.pathname), 64),
    sectionKey: sanitizeIdentifier(input.sectionKey, 64),
    elementKey: sanitizeIdentifier(input.elementKey, 96),
    orderId: sanitizeIdentifier(input.orderId, 64),
    referrerHost: getReferrerHost(),
    browserLanguage: sanitizeText(navigator.language, 24),
    deviceType: getDeviceType(),
    utmSource: sanitizeText(new URLSearchParams(window.location.search).get('utm_source'), 80),
    utmMedium: sanitizeText(new URLSearchParams(window.location.search).get('utm_medium'), 80),
    utmCampaign: sanitizeText(new URLSearchParams(window.location.search).get('utm_campaign'), 120),
    utmTerm: sanitizeText(new URLSearchParams(window.location.search).get('utm_term'), 120),
    utmContent: sanitizeText(new URLSearchParams(window.location.search).get('utm_content'), 120),
    metadata: input.metadata ?? {},
  }
}

export function trackAnalyticsEvent(input: TrackEventInput) {
  const event = buildBaseEvent(input)
  pendingEvents = [...pendingEvents, event].slice(-maxQueuedEvents)
  persistPendingEvents()
  scheduleFlush()
}

function describeClickedElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return null
  }

  const element = target.closest<HTMLElement>('button, a, [role="button"]')
  if (!element || element.dataset.analyticsIgnore === 'true') {
    return null
  }

  const explicitKey = sanitizeIdentifier(element.dataset.analyticsClick, 96)
  const isCta = element.dataset.analyticsCta === 'true'
  const ariaLabel = sanitizeText(element.getAttribute('aria-label'), 96)
  const text = sanitizeText(element.textContent, 96)
  const href =
    element instanceof HTMLAnchorElement
      ? sanitizeRoutePath(element.pathname || '/', element.search || '')
      : sanitizeText(element.getAttribute('href'), 120)

  return {
    eventName: isCta ? 'cta_click' : 'ui_click',
    elementKey:
      explicitKey ??
      sanitizeIdentifier(element.id, 96) ??
      sanitizeIdentifier(ariaLabel, 96) ??
      sanitizeIdentifier(text, 96) ??
      sanitizeIdentifier(href, 96) ??
      'ui-click',
    metadata: {
      tagName: element.tagName.toLowerCase(),
      label: text ?? ariaLabel ?? null,
      hrefPath: href ?? null,
      section: sanitizeIdentifier(element.closest<HTMLElement>(sectionSelector)?.dataset.analyticsSection, 64),
      ctaId: explicitKey,
      isCta,
    },
  }
}

function handleDocumentClick(event: MouseEvent) {
  const click = describeClickedElement(event.target)
  if (!click) {
    return
  }

  trackAnalyticsEvent({
    eventType: 'click',
    eventName: click.eventName,
    elementKey: click.elementKey,
    sectionKey: typeof click.metadata.section === 'string' ? click.metadata.section : undefined,
    metadata: click.metadata,
  })
}

function handleScrollDepth() {
  const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight
  const ratio = scrollableHeight <= 0 ? 100 : Math.round((window.scrollY / scrollableHeight) * 100)

  for (const depth of trackedScrollDepths) {
    const key = `${currentRouteKey}:${depth}`
    if (ratio < depth || seenScrollDepths.has(key)) {
      continue
    }

    seenScrollDepths.add(key)
    trackAnalyticsEvent({
      eventType: 'scroll',
      eventName: 'scroll_depth',
      elementKey: `depth-${depth}`,
      metadata: {
        depth,
      },
    })
  }
}

function observeTrackedSections() {
  if (contentObserver) {
    contentObserver.disconnect()
  }

  contentObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.45) {
          continue
        }

        const section = entry.target as HTMLElement
        const sectionKey =
          sanitizeIdentifier(section.dataset.analyticsSection, 64) ??
          sanitizeIdentifier(section.id, 64) ??
          'content'
        const dedupeKey = `${currentRouteKey}:${sectionKey}`

        if (seenSections.has(dedupeKey)) {
          continue
        }

        seenSections.add(dedupeKey)
        trackAnalyticsEvent({
          eventType: 'section',
          eventName: 'content_view',
          sectionKey,
          metadata: {
            heading: sanitizeText(section.querySelector('h1, h2, h3')?.textContent ?? null, 120),
          },
        })
      }
    },
    {
      threshold: [0.45, 0.7],
    },
  )

  document.querySelectorAll<HTMLElement>(sectionSelector).forEach((section) => {
    contentObserver?.observe(section)
  })
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    flushAnalyticsEvents(true)
  }
}

function handlePageHide() {
  flushAnalyticsEvents(true)
}

function trackClientError(eventName: string, message: string | null) {
  const sanitizedMessage = sanitizeText(message, 180)
  if (!sanitizedMessage) {
    return
  }

  const dedupeKey = `${eventName}:${sanitizedMessage}`
  if (trackedClientErrors.has(dedupeKey)) {
    return
  }

  trackedClientErrors.add(dedupeKey)
  trackAnalyticsEvent({
    eventType: 'error',
    eventName,
    metadata: {
      message: sanitizedMessage,
    },
  })
}

function loadAnalyticsInfrastructure() {
  if (initialized) {
    return
  }

  initialized = true
  loadPendingEvents()
  document.addEventListener('click', handleDocumentClick, true)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('pagehide', handlePageHide)
  window.addEventListener('scroll', handleScrollDepth, { passive: true })
  window.addEventListener('error', (event) => trackClientError('client_error', event.message))
  window.addEventListener('unhandledrejection', (event) =>
    trackClientError('client_promise_rejection', String(event.reason ?? 'Unknown rejection')),
  )
}

async function sendAnalyticsBatch(events: AnalyticsEventPayload[], useBeacon = false) {
  const body = JSON.stringify({ events })
  const url = resolveApiUrl('/api/analytics/events')

  if (useBeacon && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'application/json' })
    return navigator.sendBeacon(url, blob)
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
    credentials: 'include',
    keepalive: true,
  })

  return response.ok
}

export async function flushAnalyticsEvents(useBeacon = false) {
  if (pendingEvents.length === 0) {
    return true
  }

  const events = [...pendingEvents]

  try {
    const delivered = await sendAnalyticsBatch(events, useBeacon)
    if (!delivered) {
      return false
    }

    pendingEvents = pendingEvents.slice(events.length)
    persistPendingEvents()
    return true
  } catch {
    return false
  }
}

export function initializeAnalytics() {
  loadAnalyticsInfrastructure()
}

export function syncAnalyticsPage(pathname: string, search: string) {
  initializeAnalytics()
  currentRouteKey = sanitizeRoutePath(pathname, search)
  seenSections = new Set()
  seenScrollDepths = new Set()

  const session = getSessionState()
  if (session.isNew) {
    trackAnalyticsEvent({
      eventType: 'session',
      eventName: 'session_started',
      metadata: {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        referrerHost: getReferrerHost(),
      },
    })
  }

  const pageKey = getCurrentPageKey(pathname)
  const dedupeKey = `${currentRouteKey}:${pageKey}`
  if (lastTrackedPageKey !== dedupeKey) {
    lastTrackedPageKey = dedupeKey
    trackAnalyticsEvent({
      eventType: 'page',
      eventName: 'page_view',
      pageKey,
      metadata: {
        title: sanitizeText(document.title, 160),
      },
    })
  }

  window.requestAnimationFrame(() => {
    observeTrackedSections()
    handleScrollDepth()
  })
}
