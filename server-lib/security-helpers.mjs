export function createSecurityHelpers({
  appOriginValue,
  getAbsoluteRequestOrigin,
  HttpError,
}) {
  function applySecurityHeaders(response) {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  }

  function getConfiguredAppOrigins() {
    return appOriginValue
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  function getPublicAppOrigin(request) {
    const configuredOrigin = getConfiguredAppOrigins()[0]
    if (configuredOrigin) {
      return configuredOrigin
    }

    return getAbsoluteRequestOrigin(request)
  }

  function getCreemReturnOrigin(request) {
    const requestOrigin = getPublicAppOrigin(request)
    if (requestOrigin.includes('127.0.0.1')) {
      return requestOrigin.replace('127.0.0.1', 'localhost')
    }

    return requestOrigin
  }

  function canUseCreemHostedReturnUrl(origin) {
    return !origin.includes('localhost') && !origin.includes('127.0.0.1') && !origin.includes('[::1]') && !origin.includes('::1')
  }

  function getRequestOrigin(request) {
    const origin = request.headers.origin

    if (!origin || Array.isArray(origin)) {
      return null
    }

    return origin
  }

  function getAllowedOrigins(request) {
    const allowedOrigins = new Set(getConfiguredAppOrigins())

    if (request.headers.host) {
      allowedOrigins.add(`http://${request.headers.host}`)
      allowedOrigins.add(`https://${request.headers.host}`)
    }

    return allowedOrigins
  }

  function applyCorsHeaders(request, response) {
    const origin = getRequestOrigin(request)
    if (!origin) {
      return
    }

    if (!getAllowedOrigins(request).has(origin)) {
      return
    }

    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Credentials', 'true')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-multica-guest-token')
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
    response.setHeader('Vary', 'Origin')
  }

  function verifyOrigin(request) {
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method ?? '')) {
      return
    }

    const origin = getRequestOrigin(request)
    if (!origin) {
      return
    }

    if (!getAllowedOrigins(request).has(origin)) {
      throw new HttpError(403, 'Request origin is not allowed.')
    }
  }

  return {
    applyCorsHeaders,
    applySecurityHeaders,
    canUseCreemHostedReturnUrl,
    getConfiguredAppOrigins,
    getCreemReturnOrigin,
    getPublicAppOrigin,
    verifyOrigin,
  }
}
