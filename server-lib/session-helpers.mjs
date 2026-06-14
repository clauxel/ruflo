import { createHash } from 'node:crypto'

export function createSessionHelpers({
  createSessionStatement,
  deleteSessionByHashStatement,
  deleteUserSessionsStatement,
  findSessionStatement,
  guestCookieName,
  guestTtlMs,
  HttpError,
  isProduction,
  nowIso,
  randomBytes,
  serializeUser,
  sessionCookieName,
  sessionTtlMs,
  updateSessionSeenStatement,
}) {
  function shouldUseSecureCookie(request) {
    const forwardedProto = request?.headers?.['x-forwarded-proto']
    if (typeof forwardedProto === 'string' && forwardedProto.trim()) {
      return forwardedProto
        .split(',')[0]
        .trim()
        .toLowerCase() === 'https'
    }

    if (request?.socket?.encrypted) {
      return true
    }

    return isProduction
  }

  function parseCookies(request) {
    const rawCookie = request.headers.cookie ?? ''
    const cookies = {}

    rawCookie.split(';').forEach((item) => {
      const [key, ...value] = item.trim().split('=')
      if (!key) {
        return
      }

      cookies[key] = decodeURIComponent(value.join('='))
    })

    return cookies
  }

  function hashSessionToken(token) {
    return createHash('sha256').update(token).digest('hex')
  }

  function createSessionForUser(userId) {
    const token = randomBytes(32).toString('base64url')
    const timestamp = nowIso()
    const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString()

    return createSessionStatement.run(
      randomBytes(16).toString('hex'),
      userId,
      hashSessionToken(token),
      timestamp,
      timestamp,
      expiresAt,
    ).then(() => token)
  }

  function setSessionCookie(response, token, request) {
    const parts = [
      `${sessionCookieName}=${encodeURIComponent(token)}`,
      'Path=/',
      `Max-Age=${Math.floor(sessionTtlMs / 1000)}`,
      'HttpOnly',
      'SameSite=Lax',
    ]

    if (shouldUseSecureCookie(request)) {
      parts.push('Secure')
    }

    response.setHeader('Set-Cookie', parts.join('; '))
  }

  function setGuestCookie(response, token, request) {
    const parts = [
      `${guestCookieName}=${encodeURIComponent(token)}`,
      'Path=/',
      `Max-Age=${Math.floor(guestTtlMs / 1000)}`,
      'HttpOnly',
      'SameSite=Lax',
    ]

    if (shouldUseSecureCookie(request)) {
      parts.push('Secure')
    }

    response.setHeader('Set-Cookie', parts.join('; '))
  }

  function clearSessionCookie(response, request) {
    const parts = [
      `${sessionCookieName}=`,
      'Path=/',
      'Max-Age=0',
      'HttpOnly',
      'SameSite=Lax',
    ]

    if (shouldUseSecureCookie(request)) {
      parts.push('Secure')
    }

    response.setHeader('Set-Cookie', parts.join('; '))
  }

  function getGuestToken(request) {
    const cookies = parseCookies(request)
    const guestTokenFromCookie = cookies[guestCookieName]
    if (guestTokenFromCookie) {
      return guestTokenFromCookie
    }

    const guestTokenHeader = request.headers['x-multica-guest-token']
    if (typeof guestTokenHeader === 'string' && guestTokenHeader.trim()) {
      return guestTokenHeader.trim()
    }

    try {
      const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
      const guestTokenFromQuery = requestUrl.searchParams.get('guest_token')
      if (guestTokenFromQuery?.trim()) {
        return guestTokenFromQuery.trim()
      }
    } catch {}

    return null
  }

  async function getAuthenticatedContext(request) {
    const cookies = parseCookies(request)
    const token = cookies[sessionCookieName]

    if (!token) {
      return null
    }

    const session = await findSessionStatement.get(hashSessionToken(token))
    if (!session) {
      return null
    }

    if (Date.parse(session.expires_at) <= Date.now()) {
      await deleteSessionByHashStatement.run(hashSessionToken(token))
      return null
    }

    if (session.status !== 'active') {
      await deleteUserSessionsStatement.run(session.user_id)
      return null
    }

    await updateSessionSeenStatement.run(nowIso(), session.session_id)

    return {
      kind: 'user',
      sessionId: session.session_id,
      user: serializeUser(session),
      token,
    }
  }

  async function getRequestAccessContext(request) {
    const authContext = await getAuthenticatedContext(request)
    const guestToken = getGuestToken(request)
    if (authContext) {
      return {
        ...authContext,
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

  async function requireOrderAccessContext(request) {
    const context = await getRequestAccessContext(request)
    if (!context) {
      throw new HttpError(401, 'Authentication or guest access required.')
    }

    return context
  }

  async function requireAuthenticatedUser(request) {
    const context = await getAuthenticatedContext(request)

    if (!context) {
      throw new HttpError(401, 'Authentication required.')
    }

    return context
  }

  async function requireAdminUser(request) {
    const context = await requireAuthenticatedUser(request)

    if (context.user.role !== 'admin') {
      throw new HttpError(403, 'Admin access required.')
    }

    return context
  }

  return {
    clearSessionCookie,
    createSessionForUser,
    getAuthenticatedContext,
    getGuestToken,
    hashSessionToken,
    parseCookies,
    requireAdminUser,
    requireAuthenticatedUser,
    requireOrderAccessContext,
    setGuestCookie,
    setSessionCookie,
  }
}
