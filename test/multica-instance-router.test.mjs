import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMulticaRouterRouteRecord } from '../server-lib/multica-router-helpers.mjs'
import { createMulticaInstanceRouter } from '../server-lib/multica-instance-router.mjs'

const tempDirectories = new Set()

after(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createTempDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  tempDirectories.add(directory)
  return directory
}

async function startHttpServer(handler) {
  const server = createServer(handler)

  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolvePromise()
    })
  })

  return {
    server,
    port: server.address().port,
    async stop() {
      await new Promise((resolvePromise, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolvePromise()
        })
      })
    },
  }
}

async function performWebSocketUpgrade({ port, path, headers = {} }) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port,
      method: 'GET',
      path,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...headers,
      },
    })

    request.on('upgrade', (response, socket) => {
      socket.destroy()
      resolvePromise(response.statusCode ?? 0)
    })

    request.on('response', (response) => {
      response.resume()
      resolvePromise(response.statusCode ?? 0)
    })

    request.on('error', rejectPromise)
    request.end()
  })
}

test('实例路由服务会把 HTTP 请求转发到对应实例端口', async () => {
  const routesDir = createTempDirectory('multica-router-routes-')
  const upstream = await startHttpServer(async (request, response) => {
    const bodyChunks = []
    for await (const chunk of request) {
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    const payload = Buffer.from(
      JSON.stringify({
        method: request.method,
        url: request.url,
        body: Buffer.concat(bodyChunks).toString('utf8'),
      }),
      'utf8',
    )

    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Content-Length', String(payload.length))
    response.end(payload)
  })

  const router = createMulticaInstanceRouter({
    host: '127.0.0.1',
    port: 0,
    routesDir,
  })

  writeFileSync(
    join(routesDir, 'demo-instance.json'),
    JSON.stringify(
      buildMulticaRouterRouteRecord({
        instanceName: 'demo-instance',
        consolePort: upstream.port,
        runtimeState: 'running',
      }),
      null,
      2,
    ),
  )

  await router.start()

  try {
    const response = await fetch(`http://127.0.0.1:${router.port}/instances/demo-instance/api/ping?hello=world`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ok: true }),
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      method: 'POST',
      url: '/api/ping?hello=world',
      body: JSON.stringify({ ok: true }),
    })
  } finally {
    await router.stop()
    await upstream.stop()
  }
})

test('实例路由服务支持 WebSocket upgrade 转发', async () => {
  const routesDir = createTempDirectory('multica-router-ws-routes-')
  const upstream = await startHttpServer((request, response) => {
    response.statusCode = 404
    response.end()
  })

  upstream.server.on('upgrade', (_request, socket) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Connection: Upgrade\r\n' +
      'Upgrade: websocket\r\n' +
      '\r\n',
    )
    setTimeout(() => {
      if (!socket.destroyed) {
        socket.destroy()
      }
    }, 50)
  })

  const router = createMulticaInstanceRouter({
    host: '127.0.0.1',
    port: 0,
    routesDir,
  })

  writeFileSync(
    join(routesDir, 'demo-ws-instance.json'),
    JSON.stringify(
      buildMulticaRouterRouteRecord({
        instanceName: 'demo-ws-instance',
        consolePort: upstream.port,
        runtimeState: 'running',
      }),
      null,
      2,
    ),
  )

  await router.start()

  try {
    const statusCode = await performWebSocketUpgrade({
      port: router.port,
      path: '/instances/demo-ws-instance/socket',
    })

    assert.equal(statusCode, 101)
  } finally {
    await router.stop()
    await upstream.stop()
  }
})

test('实例路由服务可选要求内部共享令牌', async () => {
  const routesDir = createTempDirectory('multica-router-token-routes-')
  const upstream = await startHttpServer((_request, response) => {
    response.statusCode = 204
    response.end()
  })
  const router = createMulticaInstanceRouter({
    host: '127.0.0.1',
    port: 0,
    routesDir,
    sharedToken: 'router-secret',
  })

  writeFileSync(
    join(routesDir, 'demo-token-instance.json'),
    JSON.stringify(
      buildMulticaRouterRouteRecord({
        instanceName: 'demo-token-instance',
        consolePort: upstream.port,
        runtimeState: 'running',
      }),
      null,
      2,
    ),
  )

  await router.start()

  try {
    const missingTokenResponse = await fetch(`http://127.0.0.1:${router.port}/instances/demo-token-instance/`)
    assert.equal(missingTokenResponse.status, 401)

    const invalidTokenResponse = await fetch(`http://127.0.0.1:${router.port}/instances/demo-token-instance/`, {
      headers: {
        'x-multica-router-token': 'wrong-secret',
      },
    })
    assert.equal(invalidTokenResponse.status, 403)

    const validTokenResponse = await fetch(`http://127.0.0.1:${router.port}/instances/demo-token-instance/`, {
      headers: {
        'x-multica-router-token': 'router-secret',
      },
    })
    assert.equal(validTokenResponse.status, 204)
  } finally {
    await router.stop()
    await upstream.stop()
  }
})
