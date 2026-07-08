import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { handleCloudflareRequest } from '../worker/index.js'

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

    sendJson(response, 404, { message: 'Not found' })
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

async function readJson(response) {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

const seoHtmlTemplate =
  '<!doctype html><html><head><title>Ruflo AI</title><meta name="description" content="" /><meta name="robots" content="" /><link rel="canonical" href="" /></head><body><div id="root"></div></body></html>'

test('Cloudflare worker serves API catalog JSON instead of SPA HTML', async () => {
  const response = await handleCloudflareRequest(
    new Request('https://my-ruflo.yangdengkui01.workers.dev/api/catalog'),
    {
      APP_ORIGIN: 'https://my-ruflo.yangdengkui01.workers.dev',
    },
  )
  const payload = await readJson(response)

  assert.equal(response.status, 200)
  assert.match(response.headers.get('Content-Type') ?? '', /application\/json/)
  assert.ok(Array.isArray(payload.plans))
  assert.ok(Array.isArray(payload.models))
  assert.ok(Array.isArray(payload.channels))
})

test('Cloudflare worker keeps temporary workers.dev hosts out of public SEO assets', async () => {
  const env = {
    APP_ORIGIN: 'https://my-ruflo.yangdengkui01.workers.dev',
  }
  const sitemapResponse = await handleCloudflareRequest(
    new Request('https://my-ruflo.yangdengkui01.workers.dev/sitemap.xml'),
    env,
  )
  const robotsResponse = await handleCloudflareRequest(
    new Request('https://my-ruflo.yangdengkui01.workers.dev/robots.txt'),
    env,
  )
  const sitemapXml = await sitemapResponse.text()
  const robotsTxt = await robotsResponse.text()

  assert.equal(sitemapResponse.status, 200)
  assert.match(sitemapXml, /<loc>https:\/\/ruflo\.online\/<\/loc>/)
  assert.match(sitemapXml, /<loc>https:\/\/ruflo\.online\/resources\/<\/loc>/)
  assert.match(sitemapXml, /<loc>https:\/\/ruflo\.online\/plans<\/loc>/)
  assert.doesNotMatch(sitemapXml, /workers\.dev/)
  assert.equal(robotsResponse.status, 200)
  assert.match(robotsTxt, /^Sitemap: https:\/\/ruflo\.online\/sitemap\.xml$/m)
  assert.match(robotsTxt, /^Content-Signal: search=yes,ai-input=yes,ai-train=no$/m)
  assert.doesNotMatch(robotsTxt, /workers\.dev/)
})

test('Cloudflare worker redirects live duplicate URL variants to apex HTTPS', async () => {
  const response = await handleCloudflareRequest(
    new Request('http://www.ruflo.online/resources/ruflo-ai/?utm_source=test'),
    {
      APP_ORIGIN: 'https://ruflo.online',
    },
  )

  assert.equal(response.status, 301)
  assert.equal(response.headers.get('Location'), 'https://ruflo.online/resources/ruflo-ai?utm_source=test')
})

test('Cloudflare worker redirects legacy static SEO URLs to canonical routes', async () => {
  const response = await handleCloudflareRequest(
    new Request('https://ruflo.online/checkout/index.html?plan=growth&billing=annual&utm_source=test'),
    {
      APP_ORIGIN: 'https://ruflo.online',
    },
  )

  assert.equal(response.status, 301)
  assert.equal(response.headers.get('Location'), 'https://ruflo.online/plans?plan=growth&billing=annual&utm_source=test')
})

test('Cloudflare worker serves pricing page and canonicalizes resources', async () => {
  const env = {
    APP_ORIGIN: 'https://ruflo.online',
  }

  const pricingResponse = await handleCloudflareRequest(
    new Request('https://ruflo.online/pricing/', {
      headers: {
        Accept: 'text/html',
      },
    }),
    env,
    {
      assetFetcher: async (request) => {
        const url = new URL(request.url)
        if (url.pathname === '/pricing/index.html') {
          return new Response(seoHtmlTemplate, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
            },
          })
        }

        return new Response('Not found', { status: 404 })
      },
    },
  )
  const resourcesResponse = await handleCloudflareRequest(new Request('https://ruflo.online/resources/index.html'), env)
  const pricingHtml = await pricingResponse.text()

  assert.equal(pricingResponse.status, 200)
  assert.match(pricingHtml, /<title>Pricing - Ruflo AI<\/title>/)
  assert.equal(resourcesResponse.status, 301)
  assert.equal(resourcesResponse.headers.get('Location'), 'https://ruflo.online/resources/')
})

test('Cloudflare worker injects crawlable route fallback content into HTML', async () => {
  const response = await handleCloudflareRequest(
    new Request('https://ruflo.online/resources/ruflo-ai', {
      headers: {
        Accept: 'text/html',
      },
    }),
    {
      APP_ORIGIN: 'https://ruflo.online',
    },
    {
      assetFetcher: async () =>
        new Response(seoHtmlTemplate, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
          },
        }),
    },
  )
  const html = await response.text()

  assert.equal(response.status, 200)
  assert.match(html, /id="ruflo-seo-fallback"/)
  assert.match(html, /What Ruflo AI is/)
  assert.match(html, /hosted product surface/)
})

test('Cloudflare worker serves resources hub as an indexable page', async () => {
  const response = await handleCloudflareRequest(
    new Request('https://ruflo.online/resources/', {
      headers: {
        Accept: 'text/html',
      },
    }),
    {
      APP_ORIGIN: 'https://ruflo.online',
    },
    {
      assetFetcher: async () =>
        new Response(seoHtmlTemplate, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
          },
        }),
    },
  )
  const html = await response.text()

  assert.equal(response.status, 200)
  assert.match(html, /<title>Ruflo AI Resources \| Hosted workspace guides<\/title>/)
  assert.match(html, /<meta name="robots" content="index,follow" \/>/)
  assert.match(html, /Ruflo AI resources and evaluation guides/)
})

test('Cloudflare worker renders pricing plans with indexable current prices', async () => {
  const response = await handleCloudflareRequest(
    new Request('https://ruflo.online/plans?plan=growth&billing=annual', {
      headers: {
        Accept: 'text/html',
      },
    }),
    {
      APP_ORIGIN: 'https://ruflo.online',
    },
    {
      assetFetcher: async (request) => {
        const url = new URL(request.url)
        if (url.pathname === '/index.html' || url.pathname === '/plans') {
          return new Response(seoHtmlTemplate, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
            },
          })
        }

        return new Response('Not found', { status: 404 })
      },
    },
  )
  const html = await response.text()

  assert.equal(response.status, 200)
  assert.match(html, /<title>Pricing Plans \| Ruflo AI<\/title>/)
  assert.match(html, /<meta name="robots" content="index,follow" \/>/)
  assert.match(html, /Ruflo pricing plans and hosted checkout/)
  assert.match(html, /"name":"Growth monthly","price":"49"/)
})

test('Cloudflare worker noindexes removed Chris Rufo lookup pages', async () => {
  const response = await handleCloudflareRequest(
    new Request('https://ruflo.online/chris-rufo-website', {
      headers: {
        Accept: 'text/html',
      },
    }),
    {
      APP_ORIGIN: 'https://ruflo.online',
    },
    {
      assetFetcher: async () =>
        new Response(seoHtmlTemplate, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
          },
        }),
    },
  )
  const html = await response.text()

  assert.equal(response.status, 404)
  assert.match(html, /<title>Page not found \| Ruflo AI<\/title>/)
  assert.match(html, /<meta name="robots" content="noindex,follow" \/>/)
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, follow')
})

test('Cloudflare worker launch checkout creates Creem hosted checkout', async () => {
  const creem = await startMockCreemServer()

  try {
    const response = await handleCloudflareRequest(
      new Request('https://my-ruflo.yangdengkui01.workers.dev/api/launch-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://my-ruflo.yangdengkui01.workers.dev',
        },
        body: JSON.stringify({
          planId: 'growth:annual',
          modelId: 'gpt-5-4',
          channelId: 'telegram',
          communicationToken: '',
        }),
      }),
      {
        APP_ORIGIN: 'https://my-ruflo.yangdengkui01.workers.dev',
        PAYMENT_PROVIDER: 'creem',
        CREEM_ENV: 'test',
        API_TEST_KEY: 'mock-creem-test-key',
        CREEM_BASE_URL: creem.baseUrl,
      },
    )
    const payload = await readJson(response)

    assert.equal(response.status, 200)
    assert.equal(payload.paymentProvider, 'creem')
    assert.equal(payload.checkoutUrl, 'https://checkout.creem.test/session/CREEM-CHECKOUT-1')
    assert.equal(payload.creemCheckoutId, 'CREEM-CHECKOUT-1')
    assert.equal(payload.planId, 'growth:annual')
    assert.equal(payload.stateless, true)

    const productRequest = creem.requests.find((request) => request.pathname === '/v1/products')
    const checkoutRequest = creem.requests.find((request) => request.pathname === '/v1/checkouts')

    assert.equal(productRequest?.headers['x-api-key'], 'mock-creem-test-key')
    assert.equal(checkoutRequest?.headers['x-api-key'], 'mock-creem-test-key')
    assert.equal(checkoutRequest?.body.metadata.stateless, true)
    assert.equal(checkoutRequest?.body.success_url, 'https://ruflo.online/?checkout=success&provider=creem')
  } finally {
    await creem.stop()
  }
})

test('Cloudflare worker launch checkout can read Creem key from Secrets Store binding', async () => {
  const creem = await startMockCreemServer()

  try {
    const response = await handleCloudflareRequest(
      new Request('https://my-ruflo.yangdengkui01.workers.dev/api/launch-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://my-ruflo.yangdengkui01.workers.dev',
        },
        body: JSON.stringify({
          planId: 'starter:monthly',
          modelId: 'gpt-5-4',
          channelId: 'telegram',
          communicationToken: '',
        }),
      }),
      {
        APP_ORIGIN: 'https://my-ruflo.yangdengkui01.workers.dev',
        PAYMENT_PROVIDER: 'creem',
        CREEM_ENV: 'live',
        CREEM_KEY: {
          async get() {
            return 'mock-creem-global-key'
          },
        },
        CREEM_BASE_URL: creem.baseUrl,
      },
    )
    const payload = await readJson(response)

    assert.equal(response.status, 200)
    assert.equal(payload.paymentProvider, 'creem')
    assert.equal(payload.checkoutUrl, 'https://checkout.creem.test/session/CREEM-CHECKOUT-1')

    const productRequest = creem.requests.find((request) => request.pathname === '/v1/products')
    const checkoutRequest = creem.requests.find((request) => request.pathname === '/v1/checkouts')

    assert.equal(productRequest?.headers['x-api-key'], 'mock-creem-global-key')
    assert.equal(checkoutRequest?.headers['x-api-key'], 'mock-creem-global-key')
  } finally {
    await creem.stop()
  }
})

test('Cloudflare worker renders route-specific SEO for HTML routes', async () => {
  const response = await handleCloudflareRequest(
    new Request('https://my-ruflo.yangdengkui01.workers.dev/plans', {
      headers: {
        Accept: 'text/html',
      },
    }),
    {
      APP_ORIGIN: 'https://my-ruflo.yangdengkui01.workers.dev',
    },
    {
      assetFetcher: async (request) => {
        const url = new URL(request.url)
        if (url.pathname === '/index.html' || url.pathname === '/plans') {
          return new Response(seoHtmlTemplate, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
            },
          })
        }

        return new Response('Not found', { status: 404 })
      },
    },
  )
  const html = await response.text()

  assert.equal(response.status, 200)
  assert.match(html, /<title>Pricing Plans \| Ruflo AI<\/title>/)
  assert.match(html, /<meta name="robots" content="index,follow" \/>/)
  assert.match(html, /Starter is \$19\/mo, Growth is \$49\/mo, and Scale is \$149\/mo/)
  assert.match(html, /Checkout and launch workspace/)
})

test('Cloudflare worker renders canonical pricing SEO with current catalog prices', async () => {
  const response = await handleCloudflareRequest(
    new Request('https://ruflo.online/plans', {
      headers: {
        Accept: 'text/html',
      },
    }),
    {
      APP_ORIGIN: 'https://ruflo.online',
    },
    {
      assetFetcher: async () =>
        new Response(seoHtmlTemplate, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
          },
        }),
    },
  )
  const html = await response.text()

  assert.equal(response.status, 200)
  assert.match(html, /<link rel="canonical" href="https:\/\/ruflo\.online\/plans" \/>/)
  assert.match(html, /Ruflo pricing plans and hosted checkout/)
  assert.match(html, /"name":"Growth monthly","price":"49"/)
  assert.doesNotMatch(html, /"price":"99"/)
})
