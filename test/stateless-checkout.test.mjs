import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

function snapshotEnvironment() {
  return new Map(Object.entries(process.env))
}

function restoreEnvironment(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (!snapshot.has(key)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of snapshot.entries()) {
    process.env[key] = value
  }
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  const address = server.address()
  assert.equal(typeof address, 'object')
  return `http://127.0.0.1:${address.port}`
}

async function startMockCreemServer() {
  const requests = []
  let productSequence = 1
  let checkoutSequence = 1
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const body = await readJsonBody(request)
    requests.push({
      method: request.method,
      pathname: url.pathname,
      headers: request.headers,
      body,
    })

    if (request.method === 'POST' && url.pathname === '/v1/products') {
      sendJson(response, 200, {
        id: `CREEM-PRODUCT-${productSequence++}`,
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/v1/checkouts') {
      const id = `CREEM-CHECKOUT-${checkoutSequence++}`
      sendJson(response, 200, {
        id,
        checkout_url: `https://checkout.creem.test/session/${id}`,
      })
      return
    }

    sendJson(response, 404, {
      message: 'Not found',
    })
  })

  const baseUrl = await listen(server)
  return {
    baseUrl,
    requests,
    stop: async () => {
      await new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

async function startCheckoutServer() {
  const runId = `vercel-api-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const serverModule = await import(`../server.mjs?test=${encodeURIComponent(runId)}`)
  const server = createServer((request, response) => {
    void serverModule.handleGenericAgentApiRequest(request, response)
  })
  const baseUrl = await listen(server)

  return {
    baseUrl,
    stop: async () => {
      await new Promise((resolve) => server.close(() => resolve()))
      await serverModule.stopMulticaLaunchServer()
    },
  }
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init)
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(payload?.message ?? `Request failed with status ${response.status}.`)
  }

  return payload
}

test('Vercel launch checkout creates a database order and Creem hosted payment', async () => {
  const environmentSnapshot = snapshotEnvironment()
  const creem = await startMockCreemServer()
  const memoryId = `vercel-checkout-${Date.now()}-${Math.random().toString(16).slice(2)}`

  Object.assign(process.env, {
    NODE_ENV: 'production',
    GENERICAGENT_SERVERLESS_API: 'true',
    GENERICAGENT_DISABLE_LOCAL_ENV: 'true',
    MULTICA_POSTGRES_DRIVER: 'memory',
    MULTICA_POSTGRES_MEMORY_ID: memoryId,
    MULTICA_DEPLOYMENT_MODE: 'manual',
    MULTICA_TOKEN_SECRET: 'vercel-checkout-test-secret',
    APP_ORIGIN: 'https://my-ruflo.yangdengkui01.workers.dev',
    PAYMENT_PROVIDER: 'creem',
    CREEM_ENV: 'test',
    API_TEST_KEY: 'mock-creem-test-key',
    CREEM_BASE_URL: creem.baseUrl,
  })

  const checkoutServer = await startCheckoutServer()

  try {
    const payload = await fetchJson(`${checkoutServer.baseUrl}/api/launch-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        planId: 'starter:monthly',
        modelId: 'claude-opus-4-6',
        channelId: 'telegram',
        communicationToken: 'telegram-stateless-token',
      }),
    })

    assert.equal(payload.paymentProvider, 'creem')
    assert.equal(payload.checkoutUrl, 'https://checkout.creem.test/session/CREEM-CHECKOUT-1')
    assert.equal(payload.creemCheckoutId, 'CREEM-CHECKOUT-1')
    assert.equal(payload.amountCents, 950)
    assert.equal(payload.amountLabel, '$9.50')
    assert.equal(payload.stateless, false)
    assert.equal(payload.order.id, payload.orderId)
    assert.equal(payload.order.paymentStatus, 'pending')

    const productRequest = creem.requests.find((request) => request.method === 'POST' && request.pathname === '/v1/products')
    const checkoutRequest = creem.requests.find((request) => request.method === 'POST' && request.pathname === '/v1/checkouts')

    assert.equal(productRequest?.headers['x-api-key'], 'mock-creem-test-key')
    assert.equal(productRequest?.body.price, 950)
    assert.equal(productRequest?.body.currency, 'USD')
    assert.equal(checkoutRequest?.headers['x-api-key'], 'mock-creem-test-key')
    assert.equal(checkoutRequest?.body.request_id, payload.orderId)
    assert.ok(checkoutRequest?.body.success_url.startsWith(`https://my-ruflo.yangdengkui01.workers.dev/console?order=${payload.orderId}`))
    assert.equal(checkoutRequest?.body.metadata.orderId, payload.orderId)
  } finally {
    await checkoutServer.stop()
    await creem.stop()
    restoreEnvironment(environmentSnapshot)
  }
})
