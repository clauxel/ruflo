const allowedRouteQueryKeys = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'])

const stageOrder = [
  'unknown',
  'landing_viewed',
  'pricing_viewed',
  'launch_clicked',
  'plan_selected',
  'checkout_started',
  'checkout_redirected',
  'payment_completed',
  'console_viewed',
]

const stageLabelMap = {
  unknown: 'Unknown',
  landing_viewed: 'Landing viewed',
  pricing_viewed: 'Pricing viewed',
  launch_clicked: 'Launch clicked',
  plan_selected: 'Plan selected',
  checkout_started: 'Checkout started',
  checkout_redirected: 'Redirected to checkout',
  payment_completed: 'Payment completed',
  console_viewed: 'Console viewed',
}

function nowFallbackIso() {
  return new Date().toISOString()
}

function sanitizeText(value, maxLength = 160) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return null
  }

  return normalized.slice(0, maxLength)
}

function sanitizeIdentifier(value, maxLength = 80) {
  const text = sanitizeText(value, maxLength)
  if (!text) {
    return null
  }

  return text.toLowerCase().replace(/[^a-z0-9:_/-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function sanitizeRoutePath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '/'
  }

  try {
    const url = new URL(value, 'https://genericagent.local')
    const query = new URLSearchParams()

    for (const [key, item] of url.searchParams.entries()) {
      if (!allowedRouteQueryKeys.has(key)) {
        continue
      }

      const sanitizedValue = sanitizeText(item, 120)
      if (sanitizedValue) {
        query.set(key, sanitizedValue)
      }
    }

    const pathname = url.pathname.startsWith('/') ? url.pathname : `/${url.pathname}`
    return query.size > 0 ? `${pathname}?${query.toString()}` : pathname
  } catch {
    return '/'
  }
}

function sanitizeHost(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return sanitizeText(value.toLowerCase(), 120)
  }
}

function sanitizeMetadata(value, depth = 0) {
  if (depth > 3) {
    return null
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 12)
      .map((item) => sanitizeMetadata(item, depth + 1))
      .filter((item) => item !== null)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, item]) => [sanitizeIdentifier(key, 60) ?? key, sanitizeMetadata(item, depth + 1)])
        .filter(([, item]) => item !== null),
    )
  }

  if (typeof value === 'string') {
    return sanitizeText(value, 240)
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'boolean') {
    return value
  }

  return null
}

async function buildAccessContext(getAuthenticatedContext, getGuestToken, request) {
  const authenticatedContext = await getAuthenticatedContext(request)
  const guestToken = getGuestToken(request)

  if (authenticatedContext) {
    return {
      ...authenticatedContext,
      guestToken,
    }
  }

  return guestToken
    ? {
        kind: 'guest',
        guestToken,
      }
    : null
}

function resolveAnalyticsStage(event) {
  if (event.eventName === 'page_view' && event.routePath === '/') {
    return 'landing_viewed'
  }

  if (event.eventName === 'content_view' && event.sectionKey === 'pricing') {
    return 'pricing_viewed'
  }

  if (event.eventName === 'launch_clicked') {
    return 'launch_clicked'
  }

  if (event.eventName === 'plan_selected') {
    return 'plan_selected'
  }

  if (event.eventName === 'checkout_started') {
    return 'checkout_started'
  }

  if (event.eventName === 'checkout_redirected') {
    return 'checkout_redirected'
  }

  if (event.eventName === 'payment_completed') {
    return 'payment_completed'
  }

  if (event.eventName === 'page_view' && event.routePath.startsWith('/console')) {
    return 'console_viewed'
  }

  return 'unknown'
}

function pickHigherStage(left, right) {
  return stageOrder.indexOf(right) > stageOrder.indexOf(left) ? right : left
}

function serializeAnalyticsSession(row) {
  if (!row) {
    return null
  }

  return {
    id: row.id,
    visitorId: row.visitor_id,
    userId: row.user_id,
    landingPath: row.landing_path,
    referrerHost: row.referrer_host,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    deviceType: row.device_type,
    browserLanguage: row.browser_language,
    eventCount: row.event_count,
    clickCount: row.click_count,
    sectionViewCount: row.section_view_count,
    pageViewCount: row.page_view_count,
    lastEventName: row.last_event_name,
    lastRoutePath: row.last_route_path,
    lastStage: row.last_stage,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeAnalyticsEvent(row) {
  return {
    id: row.id,
    visitorId: row.visitor_id,
    sessionId: row.session_id,
    userId: row.user_id,
    orderId: row.order_id,
    eventType: row.event_type,
    eventName: row.event_name,
    routePath: row.route_path,
    pageKey: row.page_key,
    sectionKey: row.section_key,
    elementKey: row.element_key,
    referrerHost: row.referrer_host,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  }
}

function coerceWindowDays(value) {
  const parsed = Number.parseInt(String(value ?? '7'), 10)
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 90) : 7
}

function coerceLimit(value, fallback = 25, max = 100) {
  const parsed = Number.parseInt(String(value ?? fallback), 10)
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback
}

export function createAnalyticsHelpers({
  analyticsRateLimiter,
  assertOrderAccess,
  countAnalyticsSessionsSinceStatement,
  countDistinctAnalyticsSessionsByEventNameSinceStatement,
  countDistinctAnalyticsSessionsByPagePathSinceStatement,
  countDistinctAnalyticsSessionsBySectionSinceStatement,
  countDistinctAnalyticsVisitorsSinceStatement,
  createAnalyticsSessionStatement,
  createAnalyticsEventStatement,
  enforceRateLimit,
  findAnalyticsSessionByIdStatement,
  findOrderByIdStatement,
  getAuthenticatedContext,
  getGuestToken,
  listAnalyticsDropOffStagesSinceStatement,
  listAnalyticsEventsBySessionIdStatement,
  listAnalyticsSessionsSinceStatement,
  listAnalyticsTopCtaClicksSinceStatement,
  listAnalyticsTopReferrersSinceStatement,
  nowIso = nowFallbackIso,
  readJsonBody,
  requireAdminUser,
  sumAnalyticsSessionMetricsSinceStatement,
  updateAnalyticsSessionStatement,
}) {
  async function readAnalyticsBody(request) {
    const body = await readJsonBody(request)
    if (!Array.isArray(body?.events)) {
      throw new Error('Analytics events must be sent as an events array.')
    }

    if (body.events.length === 0 || body.events.length > 50) {
      throw new Error('Analytics batch size must be between 1 and 50 events.')
    }

    return body.events
  }

  async function normalizeAnalyticsEvent(rawEvent, accessContext, authenticatedUserId) {
    const visitorId = sanitizeIdentifier(rawEvent?.visitorId, 64)
    const sessionId = sanitizeIdentifier(rawEvent?.sessionId, 64)
    const eventType = sanitizeIdentifier(rawEvent?.eventType, 32)
    const eventName = sanitizeIdentifier(rawEvent?.eventName, 64)

    if (!visitorId || !sessionId || !eventType || !eventName) {
      throw new Error('Analytics events require visitorId, sessionId, eventType, and eventName.')
    }

    const orderIdCandidate = sanitizeIdentifier(rawEvent?.orderId, 64)
    let orderId = null

    if (orderIdCandidate) {
      const order = await findOrderByIdStatement.get(orderIdCandidate)
      if (order && accessContext) {
        try {
          await assertOrderAccess(accessContext, order)
          orderId = order.id
        } catch {
          orderId = null
        }
      }
    }

    const routePath = sanitizeRoutePath(rawEvent?.routePath)
    const metadata = sanitizeMetadata(rawEvent?.metadata ?? {}) ?? {}
    const occurredAt = sanitizeText(rawEvent?.occurredAt, 64) ?? nowIso()
    const referrerHost = sanitizeHost(rawEvent?.referrerHost)

    return {
      id: sanitizeIdentifier(rawEvent?.id, 64) ?? crypto.randomUUID(),
      visitorId,
      sessionId,
      userId: authenticatedUserId,
      orderId,
      eventType,
      eventName,
      routePath,
      pageKey: sanitizeIdentifier(rawEvent?.pageKey, 64),
      sectionKey: sanitizeIdentifier(rawEvent?.sectionKey, 64),
      elementKey: sanitizeIdentifier(rawEvent?.elementKey, 96),
      referrerHost,
      metadata,
      occurredAt,
      sessionStartedAt: sanitizeText(rawEvent?.sessionStartedAt, 64) ?? occurredAt,
      deviceType: sanitizeIdentifier(rawEvent?.deviceType, 32) ?? 'unknown',
      browserLanguage: sanitizeText(rawEvent?.browserLanguage, 32),
      utmSource: sanitizeText(rawEvent?.utmSource, 80),
      utmMedium: sanitizeText(rawEvent?.utmMedium, 80),
      utmCampaign: sanitizeText(rawEvent?.utmCampaign, 120),
      utmTerm: sanitizeText(rawEvent?.utmTerm, 120),
      utmContent: sanitizeText(rawEvent?.utmContent, 120),
    }
  }

  async function ingestAnalyticsEvents(request) {
    enforceRateLimit(request, analyticsRateLimiter, 'analytics')

    let rawEvents
    try {
      rawEvents = await readAnalyticsBody(request)
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Invalid analytics payload.')
    }

    const accessContext = await buildAccessContext(getAuthenticatedContext, getGuestToken, request)
    const authenticatedUserId = accessContext?.kind === 'user' ? accessContext.user.id : null
    const normalizedEvents = await Promise.all(
      rawEvents.map((rawEvent) => normalizeAnalyticsEvent(rawEvent, accessContext, authenticatedUserId)),
    )

    const now = nowIso()
    const sessionAggregates = new Map()
    const ensuredSessions = new Set()

    for (const event of normalizedEvents) {
      const existingSession = sessionAggregates.get(event.sessionId) ?? {
        visitorId: event.visitorId,
        userId: event.userId,
        startedAt: event.sessionStartedAt,
        lastSeenAt: event.occurredAt,
        landingPath: event.routePath,
        referrerHost: event.referrerHost,
        utmSource: event.utmSource,
        utmMedium: event.utmMedium,
        utmCampaign: event.utmCampaign,
        utmTerm: event.utmTerm,
        utmContent: event.utmContent,
        deviceType: event.deviceType,
        browserLanguage: event.browserLanguage,
        eventCount: 0,
        clickCount: 0,
        sectionViewCount: 0,
        pageViewCount: 0,
        lastEventName: null,
        lastRoutePath: event.routePath,
        lastStage: 'unknown',
      }

      if (!ensuredSessions.has(event.sessionId)) {
        const existing = await findAnalyticsSessionByIdStatement.get(event.sessionId)

        if (!existing) {
          await createAnalyticsSessionStatement.run(
            event.sessionId,
            event.visitorId,
            event.userId,
            event.routePath,
            event.referrerHost,
            event.utmSource,
            event.utmMedium,
            event.utmCampaign,
            event.utmTerm,
            event.utmContent,
            event.deviceType,
            event.browserLanguage,
            0,
            0,
            0,
            0,
            null,
            event.routePath,
            'unknown',
            event.sessionStartedAt,
            event.occurredAt,
            now,
            now,
          )
        }

        ensuredSessions.add(event.sessionId)
      }

      const insertResult = await createAnalyticsEventStatement.run(
        event.id,
        event.visitorId,
        event.sessionId,
        event.userId,
        event.orderId,
        event.eventType,
        event.eventName,
        event.routePath,
        event.pageKey,
        event.sectionKey,
        event.elementKey,
        event.referrerHost,
        JSON.stringify(event.metadata ?? {}),
        event.occurredAt,
        now,
      )

      if (!insertResult.changes) {
        continue
      }

      existingSession.eventCount += 1
      existingSession.clickCount += event.eventType === 'click' ? 1 : 0
      existingSession.sectionViewCount += event.eventName === 'content_view' ? 1 : 0
      existingSession.pageViewCount += event.eventName === 'page_view' ? 1 : 0
      existingSession.lastSeenAt = event.occurredAt
      existingSession.lastEventName = event.eventName
      existingSession.lastRoutePath = event.routePath
      existingSession.lastStage = pickHigherStage(existingSession.lastStage, resolveAnalyticsStage(event))

      sessionAggregates.set(event.sessionId, existingSession)
    }

    for (const [sessionId, session] of sessionAggregates.entries()) {
      const existing = await findAnalyticsSessionByIdStatement.get(sessionId)
      const lastStage = pickHigherStage(existing?.last_stage ?? 'unknown', session.lastStage)

      if (existing) {
        await updateAnalyticsSessionStatement.run(
          session.visitorId,
          session.userId ?? existing.user_id ?? null,
          session.referrerHost,
          session.utmSource,
          session.utmMedium,
          session.utmCampaign,
          session.utmTerm,
          session.utmContent,
          session.deviceType,
          session.browserLanguage,
          session.eventCount,
          session.clickCount,
          session.sectionViewCount,
          session.pageViewCount,
          session.lastEventName,
          session.lastRoutePath,
          lastStage,
          session.startedAt,
          session.startedAt,
          session.lastSeenAt,
          now,
          sessionId,
        )
      } else if (!ensuredSessions.has(sessionId)) {
        await createAnalyticsSessionStatement.run(
          sessionId,
          session.visitorId,
          session.userId,
          session.landingPath,
          session.referrerHost,
          session.utmSource,
          session.utmMedium,
          session.utmCampaign,
          session.utmTerm,
          session.utmContent,
          session.deviceType,
          session.browserLanguage,
          session.eventCount,
          session.clickCount,
          session.sectionViewCount,
          session.pageViewCount,
          session.lastEventName,
          session.lastRoutePath,
          lastStage,
          session.startedAt,
          session.lastSeenAt,
          now,
          now,
        )
      }
    }

    return {
      ingested: normalizedEvents.length,
      sessionsTouched: sessionAggregates.size,
    }
  }

  async function getAdminAnalyticsSummary(days) {
    const windowDays = coerceWindowDays(days)
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
    const totals = await sumAnalyticsSessionMetricsSinceStatement.get(since)

    const funnel = [
      {
        key: 'landing_viewed',
        label: stageLabelMap.landing_viewed,
        sessions: Number((await countDistinctAnalyticsSessionsByPagePathSinceStatement.get(since, '/')).count),
      },
      {
        key: 'pricing_viewed',
        label: stageLabelMap.pricing_viewed,
        sessions: Number((await countDistinctAnalyticsSessionsBySectionSinceStatement.get(since, 'pricing')).count),
      },
      {
        key: 'launch_clicked',
        label: stageLabelMap.launch_clicked,
        sessions: Number((await countDistinctAnalyticsSessionsByEventNameSinceStatement.get(since, 'launch_clicked')).count),
      },
      {
        key: 'plan_selected',
        label: stageLabelMap.plan_selected,
        sessions: Number((await countDistinctAnalyticsSessionsByEventNameSinceStatement.get(since, 'plan_selected')).count),
      },
      {
        key: 'checkout_started',
        label: stageLabelMap.checkout_started,
        sessions: Number((await countDistinctAnalyticsSessionsByEventNameSinceStatement.get(since, 'checkout_started')).count),
      },
      {
        key: 'checkout_redirected',
        label: stageLabelMap.checkout_redirected,
        sessions: Number((await countDistinctAnalyticsSessionsByEventNameSinceStatement.get(since, 'checkout_redirected')).count),
      },
      {
        key: 'payment_completed',
        label: stageLabelMap.payment_completed,
        sessions: Number((await countDistinctAnalyticsSessionsByEventNameSinceStatement.get(since, 'payment_completed')).count),
      },
      {
        key: 'console_viewed',
        label: stageLabelMap.console_viewed,
        sessions: Number((await countDistinctAnalyticsSessionsByPagePathSinceStatement.get(since, '/console')).count),
      },
    ]

    return {
      windowDays,
      totals: {
        visitors: Number((await countDistinctAnalyticsVisitorsSinceStatement.get(since)).count),
        sessions: Number((await countAnalyticsSessionsSinceStatement.get(since)).count),
        pageViews: Number(totals.page_views ?? 0),
        sectionViews: Number(totals.section_views ?? 0),
        clicks: Number(totals.clicks ?? 0),
        launchClicks: Number((await countDistinctAnalyticsSessionsByEventNameSinceStatement.get(since, 'launch_clicked')).count),
        checkoutStarts: Number(
          (await countDistinctAnalyticsSessionsByEventNameSinceStatement.get(since, 'checkout_started')).count,
        ),
        paymentCompletions: Number(
          (await countDistinctAnalyticsSessionsByEventNameSinceStatement.get(since, 'payment_completed')).count,
        ),
      },
      funnel,
      dropOffs: (await listAnalyticsDropOffStagesSinceStatement.all(since, 5)).map((row) => ({
        key: row.stage,
        label: stageLabelMap[row.stage] ?? row.stage,
        sessions: Number(row.count),
      })),
      topCtas: (await listAnalyticsTopCtaClicksSinceStatement.all(since, 8)).map((row) => ({
        key: row.key,
        section: row.section,
        clicks: Number(row.clicks),
        sessions: Number(row.sessions),
      })),
      referrers: (await listAnalyticsTopReferrersSinceStatement.all(since, 5)).map((row) => ({
        host: row.host,
        sessions: Number(row.count),
      })),
    }
  }

  async function listAdminAnalyticsSessions({ days, limit }) {
    const since = new Date(Date.now() - coerceWindowDays(days) * 24 * 60 * 60 * 1000).toISOString()
    return (await listAnalyticsSessionsSinceStatement.all(since, coerceLimit(limit))).map(serializeAnalyticsSession)
  }

  async function getAdminAnalyticsSessionDetail(sessionId) {
    const sanitizedSessionId = sanitizeIdentifier(sessionId, 64)
    if (!sanitizedSessionId) {
      throw new Error('Analytics session not found.')
    }

    const session = await findAnalyticsSessionByIdStatement.get(sanitizedSessionId)
    if (!session) {
      throw new Error('Analytics session not found.')
    }

    return {
      session: serializeAnalyticsSession(session),
      events: (await listAnalyticsEventsBySessionIdStatement.all(session.id)).map(serializeAnalyticsEvent),
    }
  }

  async function requireAnalyticsAdmin(request) {
    return await requireAdminUser(request)
  }

  return {
    getAdminAnalyticsSessionDetail,
    getAdminAnalyticsSummary,
    ingestAnalyticsEvents,
    listAdminAnalyticsSessions,
    requireAnalyticsAdmin,
  }
}
