import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { loadLocalEnvironment } from '../server-lib/env-loader.mjs'

test('生产模式只自动加载 .env.production 并保留显式环境变量优先级', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'multica-env-loader-'))
  const appRoot = join(workspaceRoot, 'app')
  mkdirSync(appRoot, { recursive: true })

  writeFileSync(join(appRoot, '.env'), 'APP_ORIGIN=https://base.example.com\nFROM_ENV=base\n', 'utf8')
  writeFileSync(join(appRoot, '.env.production'), 'APP_ORIGIN=https://prod.example.com\nPROD_ONLY=1\nPAY_CLIENT_ID=prod-client\n', 'utf8')

  const environment = {
    PORT: '5199',
    PAY_SECRET: 'external-secret',
  }

  const loadedFiles = loadLocalEnvironment({
    projectRoot: appRoot,
    runtimeMode: 'production',
    environment,
  })

  assert.equal(loadedFiles.length, 1)
  assert.equal(environment.PORT, '5199')
  assert.equal(environment.APP_ORIGIN, 'https://prod.example.com')
  assert.equal(environment.FROM_ENV, undefined)
  assert.equal(environment.PROD_ONLY, '1')
  assert.equal(environment.PAY_CLIENT_ID, 'prod-client')
  assert.equal(environment.PAY_SECRET, 'external-secret')
})

test('开发模式只自动加载 .env.development', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'multica-env-loader-dev-'))
  const appRoot = join(workspaceRoot, 'app')
  mkdirSync(appRoot, { recursive: true })

  writeFileSync(join(appRoot, '.env'), 'APP_ORIGIN=http://base.local\nFROM_ENV=base\n', 'utf8')
  writeFileSync(join(appRoot, '.env.development'), 'APP_ORIGIN=http://dev.local\nDEV_ONLY=1\nPAY_CLIENT_ID=local-client\n', 'utf8')

  const environment = {}

  const loadedFiles = loadLocalEnvironment({
    projectRoot: appRoot,
    runtimeMode: 'development',
    environment,
  })

  assert.equal(loadedFiles.length, 1)
  assert.equal(environment.APP_ORIGIN, 'http://dev.local')
  assert.equal(environment.FROM_ENV, undefined)
  assert.equal(environment.DEV_ONLY, '1')
  assert.equal(environment.PAY_CLIENT_ID, 'local-client')
})

test('Vercel runtime uses deployed environment variables instead of local env files', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'multica-env-loader-vercel-'))
  const appRoot = join(workspaceRoot, 'app')
  mkdirSync(appRoot, { recursive: true })

  writeFileSync(join(appRoot, '.env.production'), 'APP_ORIGIN=https://wrong.example.com\nDATABASE_URL=postgres://local\n', 'utf8')

  const environment = {
    VERCEL: '1',
    APP_ORIGIN: 'https://www.genericagent.org',
    DATABASE_URL: 'postgres://vercel',
  }

  const loadedFiles = loadLocalEnvironment({
    projectRoot: appRoot,
    runtimeMode: 'production',
    environment,
  })

  assert.equal(loadedFiles.length, 0)
  assert.equal(environment.APP_ORIGIN, 'https://www.genericagent.org')
  assert.equal(environment.DATABASE_URL, 'postgres://vercel')
})
