import { createServer, request as httpRequest } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { URL } from 'node:url'
import {
  buildMulticaRouterRouteFilePath,
  normalizeMulticaRouterInstanceName,
} from './multica-router-helpers.mjs'

function jsonResponse(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', String(body.length))
  response.end(body)
}

function normalizeProxyPathSegment(segment) {
  if (!segment || segment === '/') {
    return '/'
  }

  return segment.startsWith('/') ? segment : `/${segment}`
}

function getInstanceRouteMatch(pathname) {
  return pathname.match(/^\/instances\/([^/]+)(\/.*)?$/)
}

function resolveRouterRequestPath(pathname) {
  const match = getInstanceRouteMatch(pathname)
  if (!match) {
    return null
  }

  return {
    instanceName: normalizeMulticaRouterInstanceName(decodeURIComponent(match[1] ?? '')),
    pathSuffix: normalizeProxyPathSegment(match[2] ?? '/'),
  }
}

function filterProxyRequestHeaders(headers, upstreamUrl) {
  const nextHeaders = {}

  for (const [key, value] of Object.entries(headers)) {
    if (
      value === undefined ||
      [
        'host',
        'connection',
        'content-length',
        'transfer-encoding',
        'accept-encoding',
      ].includes(key.toLowerCase())
    ) {
      continue
    }

    nextHeaders[key] = value
  }

  nextHeaders.host = upstreamUrl.host
  return nextHeaders
}

function filterUpgradeHeaders(headers, upstreamUrl) {
  const nextHeaders = {}

  for (const [key, value] of Object.entries(headers)) {
    if (
      value === undefined ||
      ['host', 'connection', 'upgrade', 'sec-websocket-extensions'].includes(key.toLowerCase())
    ) {
      continue
    }

    nextHeaders[key] = value
  }

  nextHeaders.host = upstreamUrl.host
  nextHeaders.connection = 'Upgrade'
  nextHeaders.upgrade = 'websocket'
  return nextHeaders
}

function writeUpgradeHeaders(socket, statusCode, statusMessage, headers) {
  socket.write(`HTTP/1.1 ${statusCode} ${statusMessage}\r\n`)

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        socket.write(`${key}: ${item}\r\n`)
      }
      continue
    }

    socket.write(`${key}: ${value}\r\n`)
  }

  socket.write('\r\n')
}

function createRouterHttpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function readRouteRecord(routesDir, instanceName) {
  const routeFilePath = buildMulticaRouterRouteFilePath(routesDir, instanceName)
  if (!existsSync(routeFilePath)) {
    throw createRouterHttpError(404, 'Multica instance route is not registered.')
  }

  let parsed
  try {
    parsed = JSON.parse(readFileSync(routeFilePath, 'utf8'))
  } catch {
    throw createRouterHttpError(500, 'Multica instance route metadata is invalid.')
  }

  const consolePort = Number.parseInt(String(parsed?.consolePort ?? ''), 10)
  if (!Number.isInteger(consolePort) || consolePort <= 0) {
    throw createRouterHttpError(500, 'Multica instance route is missing a valid console port.')
  }

  return {
    instanceName,
    consoleHost: String(parsed?.consoleHost ?? '127.0.0.1').trim() || '127.0.0.1',
    consolePort,
    runtimeState: String(parsed?.runtimeState ?? '').trim() || 'running',
  }
}

function validateRouterToken(request, sharedToken) {
  if (!sharedToken) {
    return
  }

  const providedToken = String(request.headers['x-multica-router-token'] ?? '').trim()
  if (!providedToken) {
    throw createRouterHttpError(401, 'Multica router authentication is required.')
  }

  if (providedToken !== sharedToken) {
    throw createRouterHttpError(403, 'Multica router authentication failed.')
  }
}

async function proxyHttpRequest({ request, response, routesDir, sharedToken }) {
  validateRouterToken(request, sharedToken)

  const requestUrl = new URL(request.url ?? '/', 'http://localhost')
  if (requestUrl.pathname === '/healthz') {
    jsonResponse(response, 200, { ok: true })
    return
  }

  const routeMatch = resolveRouterRequestPath(requestUrl.pathname)
  if (!routeMatch) {
    jsonResponse(response, 404, { message: 'Multica router route not found.' })
    return
  }

  const routeRecord = readRouteRecord(routesDir, routeMatch.instanceName)
  if (routeRecord.runtimeState !== 'running') {
    jsonResponse(response, 409, { message: 'Multica instance is not running.' })
    return
  }

  const upstreamUrl = new URL(`http://${routeRecord.consoleHost}:${routeRecord.consolePort}${routeMatch.pathSuffix}`)
  upstreamUrl.search = requestUrl.search
  const method = request.method ?? 'GET'
  const bodyChunks = []

  if (!['GET', 'HEAD'].includes(method)) {
    for await (const chunk of request) {
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
  }

  let upstreamResponse
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers: filterProxyRequestHeaders(request.headers, upstreamUrl),
      body: bodyChunks.length ? Buffer.concat(bodyChunks) : undefined,
      redirect: 'manual',
    })
  } catch {
    throw createRouterHttpError(502, 'Multica instance upstream is unreachable.')
  }

  response.statusCode = upstreamResponse.status
  for (const [key, value] of upstreamResponse.headers.entries()) {
    if (['connection', 'content-length', 'transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) {
      continue
    }

    response.setHeader(key, value)
  }

  const payload = Buffer.from(await upstreamResponse.arrayBuffer())
  response.setHeader('Content-Length', String(payload.length))
  response.end(payload)
}

async function proxyUpgradeRequest({ request, socket, head, routesDir, sharedToken }) {
  try {
    validateRouterToken(request, sharedToken)
    const requestUrl = new URL(request.url ?? '/', 'http://localhost')
    const routeMatch = resolveRouterRequestPath(requestUrl.pathname)

    if (!routeMatch) {
      writeUpgradeHeaders(socket, 404, 'Not Found', {
        'Content-Type': 'text/plain; charset=utf-8',
        Connection: 'close',
      })
      socket.end('Multica router route not found.')
      return
    }

    const routeRecord = readRouteRecord(routesDir, routeMatch.instanceName)
    if (routeRecord.runtimeState !== 'running') {
      writeUpgradeHeaders(socket, 409, 'Conflict', {
        'Content-Type': 'text/plain; charset=utf-8',
        Connection: 'close',
      })
      socket.end('Multica instance is not running.')
      return
    }

    const upstreamUrl = new URL(`http://${routeRecord.consoleHost}:${routeRecord.consolePort}${routeMatch.pathSuffix}`)
    upstreamUrl.search = requestUrl.search
    const upstreamRequest = httpRequest({
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || 80,
      method: 'GET',
      path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
      headers: filterUpgradeHeaders(request.headers, upstreamUrl),
    })

    upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      writeUpgradeHeaders(socket, 101, 'Switching Protocols', upstreamResponse.headers)
      if (head?.length) {
        upstreamSocket.write(head)
      }
      if (upstreamHead?.length) {
        socket.write(upstreamHead)
      }
      upstreamSocket.pipe(socket)
      socket.pipe(upstreamSocket)
      upstreamSocket.on('error', () => socket.destroy())
      socket.on('error', () => upstreamSocket.destroy())
    })

    upstreamRequest.on('response', (upstreamResponse) => {
      writeUpgradeHeaders(socket, upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage ?? 'Bad Gateway', {
        Connection: 'close',
      })
      upstreamResponse.pipe(socket)
    })

    upstreamRequest.on('error', () => {
      if (!socket.destroyed) {
        writeUpgradeHeaders(socket, 502, 'Bad Gateway', {
          Connection: 'close',
        })
        socket.end()
      }
    })

    upstreamRequest.end()
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500
    const message = error instanceof Error ? error.message : 'Multica router failed.'
    writeUpgradeHeaders(socket, statusCode, 'Proxy Error', {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(message),
      Connection: 'close',
    })
    socket.end(message)
  }
}

export function createMulticaInstanceRouter({
  routesDir = process.env.MULTICA_ROUTER_ROUTES_DIR ?? '/data/multica/router/routes',
  host = process.env.MULTICA_ROUTER_HOST ?? '127.0.0.1',
  port = Number(process.env.MULTICA_ROUTER_PORT ?? 19280),
  sharedToken = process.env.MULTICA_ROUTER_SHARED_TOKEN ?? '',
} = {}) {
  const router = {
    host,
    port,
    routesDir,
    server: null,
    async start() {},
    async stop() {},
  }
  const server = createServer(async (request, response) => {
    try {
      await proxyHttpRequest({
        request,
        response,
        routesDir,
        sharedToken: String(sharedToken ?? '').trim(),
      })
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500
      const message = error instanceof Error ? error.message : 'Multica router failed.'
      jsonResponse(response, statusCode, { message })
    }
  })

  server.on('upgrade', (request, socket, head) => {
    proxyUpgradeRequest({
      request,
      socket,
      head,
      routesDir,
      sharedToken: String(sharedToken ?? '').trim(),
    })
  })

  router.server = server
  router.start = async () => {
    if (server.listening) {
      return
    }

    await new Promise((resolvePromise, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        server.off('error', reject)
        const address = server.address()
        if (address && typeof address === 'object' && typeof address.port === 'number') {
          router.port = address.port
        }
        resolvePromise()
      })
    })
  }
  router.stop = async () => {
    if (!server.listening) {
      return
    }

    await new Promise((resolvePromise, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolvePromise()
      })
    })
  }

  return router
}
