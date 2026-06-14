import { createExactRoute } from './route-utils.mjs'

export function createAuthRoutes(deps) {
  const {
    getAuthenticatedContext,
    sendJson,
    enforceRateLimit,
    registerRateLimiter,
    loginRateLimiter,
    readJsonBody,
    sanitizeName,
    normalizeEmail,
    createUserRecord,
    createSessionForUser,
    nowIso,
    updateUserLastLoginStatement,
    setSessionCookie,
    serializeUser,
    findUserByIdStatement,
    findUserByEmailStatement,
    getConfiguredUserRole,
    syncUserRoleWithAdminConfig,
    verifyPassword,
    deleteUserSessionsStatement,
    deleteSessionByHashStatement,
    hashSessionToken,
    clearSessionCookie,
  } = deps

  return [
    createExactRoute('GET', '/api/auth/me', async ({ request, response }) => {
      const context = await getAuthenticatedContext(request)
      sendJson(response, 200, { user: context?.user ?? null })
    }),
    createExactRoute('POST', '/api/auth/register', async ({ request, response }) => {
      enforceRateLimit(request, registerRateLimiter, 'register')

      const body = await readJsonBody(request)
      const name = sanitizeName(body.name ?? '')
      const email = normalizeEmail(body.email ?? '')
      const password = String(body.password ?? '')
      const user = await createUserRecord({
        email,
        name,
        password,
        role: getConfiguredUserRole(email),
      })
      const token = await createSessionForUser(user.id)
      const timestamp = nowIso()

      await updateUserLastLoginStatement.run(timestamp, timestamp, user.id)
      setSessionCookie(response, token, request)
      sendJson(response, 201, {
        message: 'Account created. Secure session is active.',
        user: serializeUser(await findUserByIdStatement.get(user.id)),
      })
    }),
    createExactRoute('POST', '/api/auth/login', async ({ request, response }) => {
      enforceRateLimit(request, loginRateLimiter, 'login')

      const body = await readJsonBody(request)
      const email = normalizeEmail(body.email ?? '')
      const password = String(body.password ?? '')
      const user = await findUserByEmailStatement.get(email)

      if (!user || !verifyPassword(password, user.password_hash)) {
        throw new deps.HttpError(401, 'Email or password is incorrect.')
      }

      if (user.status !== 'active') {
        throw new deps.HttpError(403, 'This user account is disabled.')
      }

      const syncedUser = await syncUserRoleWithAdminConfig(user)

      await deleteUserSessionsStatement.run(syncedUser.id)

      const token = await createSessionForUser(syncedUser.id)
      const timestamp = nowIso()

      await updateUserLastLoginStatement.run(timestamp, timestamp, syncedUser.id)
      setSessionCookie(response, token, request)
      sendJson(response, 200, {
        message: 'Signed in successfully.',
        user: serializeUser(await findUserByIdStatement.get(syncedUser.id)),
      })
    }),
    createExactRoute('POST', '/api/auth/logout', async ({ request, response }) => {
      const context = await getAuthenticatedContext(request)

      if (context) {
        await deleteSessionByHashStatement.run(hashSessionToken(context.token))
      }

      clearSessionCookie(response, request)
      sendJson(response, 200, { message: 'Signed out successfully.' })
    }),
  ]
}
