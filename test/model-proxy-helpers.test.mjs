import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildInternalModelProxyBaseUrl,
  isAllowedModelProxyRemoteAddress,
} from '../server-lib/model-proxy-helpers.mjs'

test('buildInternalModelProxyBaseUrl 优先使用显式 internal base url', () => {
  const baseUrl = buildInternalModelProxyBaseUrl('demo-instance', {
    MULTICA_MODEL_PROXY_INTERNAL_BASE_URL: 'http://10.128.0.2:5175/api/internal/model-proxy',
    PORT: '5175',
  })

  assert.equal(baseUrl, 'http://10.128.0.2:5175/api/internal/model-proxy/demo-instance/v1')
})

test('isAllowedModelProxyRemoteAddress 默认只允许回环，并支持显式远端白名单', () => {
  assert.equal(isAllowedModelProxyRemoteAddress('127.0.0.1', {}), true)
  assert.equal(isAllowedModelProxyRemoteAddress('::ffff:127.0.0.1', {}), true)
  assert.equal(isAllowedModelProxyRemoteAddress('10.128.0.4', {}), false)
  assert.equal(
    isAllowedModelProxyRemoteAddress('10.128.0.4', {
      MULTICA_MODEL_PROXY_ALLOWED_REMOTE_ADDRESSES: '10.128.0.4',
    }),
    true,
  )
  assert.equal(
    isAllowedModelProxyRemoteAddress('::ffff:10.128.0.4', {
      MULTICA_MODEL_PROXY_ALLOWED_REMOTE_ADDRESSES: '10.128.0.4',
    }),
    true,
  )
})
