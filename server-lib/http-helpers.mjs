export function createHttpHelpers({ bodyLimitBytes, HttpError }) {
  function getClientKey(request) {
    const forwardedFor = request.headers['x-forwarded-for']

    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0].trim()
    }

    return request.socket.remoteAddress ?? 'unknown'
  }

  function enforceRateLimit(request, limiter, label) {
    const result = limiter(`${label}:${getClientKey(request)}`)

    if (!result.allowed) {
      throw new HttpError(429, 'Too many attempts. Please wait and try again.')
    }
  }

  async function readJsonBody(request) {
    const chunks = []
    let size = 0

    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length

      if (size > bodyLimitBytes) {
        throw new HttpError(413, 'Request body is too large.')
      }

      chunks.push(buffer)
    }

    if (chunks.length === 0) {
      return {}
    }

    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new HttpError(400, 'Request body must be valid JSON.')
    }
  }

  async function readTextBody(request) {
    const chunks = []
    let size = 0

    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length

      if (size > bodyLimitBytes) {
        throw new HttpError(413, 'Request body is too large.')
      }

      chunks.push(buffer)
    }

    return Buffer.concat(chunks).toString('utf8')
  }

  function sendJson(response, statusCode, payload) {
    const body = JSON.stringify(payload)
    response.statusCode = statusCode
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Content-Length', Buffer.byteLength(body))
    response.end(body)
  }

  return {
    enforceRateLimit,
    readJsonBody,
    readTextBody,
    sendJson,
  }
}
