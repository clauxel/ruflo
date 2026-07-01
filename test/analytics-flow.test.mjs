import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startTestServer } from './helpers/server-test-support.mjs'

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

function createTestConfig(configPath) {
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        deployment: {
          provider: 'mock',
          targetServer: 'mock-node',
          consoleBaseUrl: 'https://console.example.test',
          publicBaseUrl: 'https://public.example.test',
          mockRootDir: './mock-remote',
        },
        server: {
          host: '127.0.0.1',
          port: 22,
          username: 'root',
          password: '',
        },
        multica: {
          repoUrl: 'https://github.com/multica/multica.git',
          repoRef: 'main',
          baseDir: '/srv/multica',
          servicePrefix: 'multica',
          runtimeUserPrefix: 'mca',
          installCommand: 'npm install --no-audit --no-fund',
          buildCommand: 'echo build',
          startCommand: 'echo start',
          tokenEnvName: 'COMMUNICATION_TOKEN',
          modelEnvName: 'MULTICA_MODEL_ID',
          channelEnvName: 'MULTICA_CHANNEL_ID',
          planEnvName: 'MULTICA_PLAN_ID',
        },
      },
      null,
      2,
    ),
  )
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init)
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  return {
    response,
    payload,
  }
}

test('访客行为追踪支持批量写入、管理员摘要与敏感 URL 脱敏', async () => {
  const tempDir = createTempDirectory('multica-analytics-')
  const configPath = join(tempDir, 'multica.config.json')
  createTestConfig(configPath)

  const port = 4317
  const server = await startTestServer({
    port,
    configPath,
    env: {
      MULTICA_TOKEN_SECRET: 'analytics-test-secret',
      APP_ORIGIN: 'http://localhost:4317',
    },
  })

  try {
    const register = await fetchJson(`http://localhost:${port}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://localhost:${port}`,
      },
      body: JSON.stringify({
        name: 'Admin User',
        email: 'admin@example.com',
        password: 'VerySecure1234',
      }),
    })

    assert.equal(register.response.status, 201)
    const cookie = register.response.headers.get('set-cookie')?.split(';')[0] ?? null
    assert.ok(cookie)
    const pool = server.createPool()
    await pool.query('UPDATE users SET role = $1 WHERE email = $2', ['admin', 'admin@example.com'])
    await pool.end()

    const analytics = await fetchJson(`http://localhost:${port}/api/analytics/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: `http://localhost:${port}`,
      },
      body: JSON.stringify({
        events: [
          {
            id: 'event-page-view',
            visitorId: 'visitor-123',
            sessionId: 'session-123',
            sessionStartedAt: '2026-06-30T00:00:00.000Z',
            occurredAt: '2026-06-30T00:00:01.000Z',
            eventType: 'page',
            eventName: 'page_view',
            routePath: '/?utm_source=ad&guest_token=secret',
            metadata: {
              title: 'Home',
            },
          },
          {
            id: 'event-pricing',
            visitorId: 'visitor-123',
            sessionId: 'session-123',
            sessionStartedAt: '2026-06-30T00:00:00.000Z',
            occurredAt: '2026-06-30T00:00:03.000Z',
            eventType: 'section',
            eventName: 'content_view',
            routePath: '/?utm_source=ad&token=paypal-secret',
            sectionKey: 'pricing',
          },
          {
            id: 'event-launch',
            visitorId: 'visitor-123',
            sessionId: 'session-123',
            sessionStartedAt: '2026-06-30T00:00:00.000Z',
            occurredAt: '2026-06-30T00:00:05.000Z',
            eventType: 'business',
            eventName: 'launch_clicked',
            routePath: '/',
          },
          {
            id: 'event-cta',
            visitorId: 'visitor-123',
            sessionId: 'session-123',
            sessionStartedAt: '2026-06-30T00:00:00.000Z',
            occurredAt: '2026-06-30T00:00:05.500Z',
            eventType: 'click',
            eventName: 'cta_click',
            routePath: '/',
            sectionKey: 'hero',
            elementKey: 'hero_launch_workspace',
            metadata: {
              label: 'Launch Ruflo',
              isCta: true,
            },
          },
          {
            id: 'event-checkout',
            visitorId: 'visitor-123',
            sessionId: 'session-123',
            sessionStartedAt: '2026-06-30T00:00:00.000Z',
            occurredAt: '2026-06-30T00:00:06.000Z',
            eventType: 'business',
            eventName: 'checkout_started',
            routePath: '/plans',
          },
          {
            id: 'event-payment',
            visitorId: 'visitor-123',
            sessionId: 'session-123',
            sessionStartedAt: '2026-06-30T00:00:00.000Z',
            occurredAt: '2026-06-30T00:00:09.000Z',
            eventType: 'business',
            eventName: 'payment_completed',
            routePath: '/checkout?PayerID=hidden',
          },
        ],
      }),
    })

    assert.equal(analytics.response.status, 202, JSON.stringify(analytics.payload))
    assert.equal(analytics.payload.ingested, 6)

    const summary = await fetchJson(`http://localhost:${port}/api/admin/analytics/summary?days=30`, {
      headers: {
        Cookie: cookie,
      },
    })

    assert.equal(summary.response.status, 200)
    assert.equal(summary.payload.summary.totals.visitors, 1)
    assert.equal(summary.payload.summary.totals.sessions, 1)
    assert.equal(summary.payload.summary.totals.launchClicks, 1)
    assert.equal(summary.payload.summary.totals.checkoutStarts, 1)
    assert.equal(summary.payload.summary.totals.paymentCompletions, 1)
    assert.deepEqual(summary.payload.summary.topCtas[0], {
      key: 'hero_launch_workspace',
      section: 'hero',
      clicks: 1,
      sessions: 1,
    })

    const sessions = await fetchJson(`http://localhost:${port}/api/admin/analytics/sessions?days=30&limit=10`, {
      headers: {
        Cookie: cookie,
      },
    })

    assert.equal(sessions.response.status, 200)
    assert.equal(sessions.payload.sessions.length, 1)
    assert.equal(sessions.payload.sessions[0].landingPath, '/?utm_source=ad')
    assert.equal(sessions.payload.sessions[0].lastStage, 'payment_completed')

    const detail = await fetchJson(
      `http://localhost:${port}/api/admin/analytics/sessions/${sessions.payload.sessions[0].id}`,
      {
        headers: {
          Cookie: cookie,
        },
      },
    )

    assert.equal(detail.response.status, 200)
    assert.equal(detail.payload.events[0].routePath, '/?utm_source=ad')
    assert.equal(detail.payload.events[1].routePath, '/?utm_source=ad')
    assert.ok(detail.payload.events.every((event) => !String(event.routePath).includes('guest_token')))
    assert.ok(detail.payload.events.every((event) => !String(event.routePath).includes('PayerID')))
  } finally {
    await server.stop()
  }
})
