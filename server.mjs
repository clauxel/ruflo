import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createApiRouter } from './server-lib/api/index.mjs'
import { createAnalyticsHelpers } from './server-lib/analytics-helpers.mjs'
import { createAppDatabase, initializeAppDatabase } from './server-lib/app-database.mjs'
import { createCatalogHelpers } from './server-lib/catalog-helpers.mjs'
import {
  loadDeploymentConfig,
  readConfiguredMulticaRepoRef,
  resolveDefaultDeploymentConfigPath,
} from './server-lib/deployment-config.mjs'
import {
  executeConfiguredDeployment,
  listConfiguredMulticaVersions,
  stopConfiguredDeployment,
  uninstallConfiguredDeployment,
  upgradeConfiguredDeployment,
} from './server-lib/deployment-runtime.mjs'
import { createHttpHelpers } from './server-lib/http-helpers.mjs'
import { loadLocalEnvironment } from './server-lib/env-loader.mjs'
import {
  buildModelProxyInternalToken,
  isAllowedModelProxyRemoteAddress,
  isLoopbackAddress,
  normalizeModelProxyUpstreamBaseUrl,
} from './server-lib/model-proxy-helpers.mjs'
import { createPaymentHelpers } from './server-lib/payment-helpers.mjs'
import { createSecurityHelpers } from './server-lib/security-helpers.mjs'
import { createSerializationHelpers } from './server-lib/serialization-helpers.mjs'
import { createSessionHelpers } from './server-lib/session-helpers.mjs'
import {
  annualBillingMultiplier,
  channelCatalog,
  modelCatalog,
  planCatalog,
} from './shared/catalog.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = __dirname
const modeIndex = process.argv.indexOf('--mode')
const isVercelRuntime = Boolean(process.env.VERCEL || process.env.GENERICAGENT_SERVERLESS_API)
const runtimeMode =
  modeIndex >= 0
    ? process.argv[modeIndex + 1]
    : isVercelRuntime || process.env.NODE_ENV === 'production'
      ? 'production'
      : 'development'
const shouldStartHttpServer = !isVercelRuntime || process.env.GENERICAGENT_START_HTTP_SERVER === 'true'

if (isVercelRuntime && !process.env.MULTICA_DEPLOYMENT_MODE) {
  process.env.MULTICA_DEPLOYMENT_MODE = 'manual'
}

loadLocalEnvironment({
  projectRoot,
  runtimeMode,
})

const explicitEnvironmentPath = String(
  process.env.GENERICAGENT_ENV_PATH ?? process.env.MULTICA_ENV_PATH ?? '',
).toLowerCase()
const appEnvironment =
  explicitEnvironmentPath.includes('.env.development')
    ? 'development'
    : explicitEnvironmentPath.includes('.env.production')
      ? 'production'
      : runtimeMode === 'production' || process.env.NODE_ENV === 'production'
        ? 'production'
        : 'development'

const distDirectory = join(projectRoot, 'dist')
const port = Number(process.env.PORT ?? 5175)
const sessionCookieName = 'mca_session'
const guestCookieName = 'mca_guest'
const multicaConsoleSessionCookieName = 'mca_console_session'
const sessionTtlMs = 1000 * 60 * 60 * 24 * 7
const guestTtlMs = 1000 * 60 * 60 * 24 * 30
const multicaConsoleContextTtlMs = 1000 * 60 * 60 * 12
const bodyLimitBytes = 1024 * 1024
const deploymentPollIntervalMs = 2000
const isProduction = runtimeMode === 'production' || process.env.NODE_ENV === 'production'
const multicaConsoleSessions = new Map()
const {
  database,
  provider: databaseProvider,
  identity: databaseIdentity,
} = await createAppDatabase({
  projectRoot,
  runtimeMode,
  environment: process.env,
})
const tokenEncryptionKey = createHash('sha256')
  .update(process.env.MULTICA_TOKEN_SECRET ?? `${projectRoot}:${databaseIdentity}`)
  .digest()
const deploymentConfigPath = resolveDefaultDeploymentConfigPath(projectRoot, process.env)
const deploymentCommandJson = process.env.MULTICA_DEPLOY_COMMAND_JSON
  ? JSON.parse(process.env.MULTICA_DEPLOY_COMMAND_JSON)
  : null
const deploymentCommand = process.env.MULTICA_DEPLOY_COMMAND ?? ''
const deploymentTargetServer = process.env.MULTICA_DEPLOY_TARGET ?? 'simulation-cluster'
const deploymentConsoleBaseUrl =
  process.env.GENERICAGENT_CONSOLE_BASE_URL ??
  process.env.MULTICA_CONSOLE_BASE_URL ??
  'https://console.genericagent.local'
const deploymentPublicBaseUrl =
  process.env.GENERICAGENT_PUBLIC_BASE_URL ??
  process.env.MULTICA_PUBLIC_BASE_URL ??
  'https://genericagent.local'
const multicaRouterSharedToken = String(process.env.MULTICA_ROUTER_SHARED_TOKEN ?? '').trim()
const defaultMulticaRepoRef = 'main'
const allowSimulatedDeployment = process.env.MULTICA_ALLOW_SIMULATED_DEPLOYMENT !== 'false'
const guestUserEmail = 'guest@genericagent.local'
const guestUserName = 'GenericAgent Guest'
const payPalClientId = process.env.PAY_CLIENT_ID ?? process.env.PAYPAL_CLIENT_ID ?? ''
const payPalSecret = process.env.PAY_SECRET ?? process.env.PAYPAL_CLIENT_SECRET ?? ''
const payPalEnvironmentSetting = (process.env.PAYPAL_ENV ?? '').trim().toLowerCase()
const payPalEnvironment =
  payPalEnvironmentSetting === 'sandbox'
    ? 'sandbox'
    : payPalEnvironmentSetting === 'live'
      ? 'live'
      : isProduction
        ? 'live'
        : 'auto'
const payPalLiveBaseUrl = 'https://api-m.paypal.com'
const payPalSandboxBaseUrl = 'https://api-m.sandbox.paypal.com'
const payPalBaseUrlOverride = process.env.PAYPAL_BASE_URL ?? ''
const payPalBaseUrls = payPalBaseUrlOverride
  ? [payPalBaseUrlOverride]
  : payPalEnvironment === 'sandbox'
    ? [payPalSandboxBaseUrl]
    : payPalEnvironment === 'live'
      ? [payPalLiveBaseUrl]
      : [payPalLiveBaseUrl, payPalSandboxBaseUrl]
let payPalResolvedBaseUrl = payPalBaseUrls[0] ?? payPalLiveBaseUrl
const payPalWebhookId = process.env.PAYPAL_WEBHOOK_ID ?? process.env.PAY_WEBHOOK_ID ?? ''
const defaultMarketingDescription =
  'Launch a hosted GenericAgent workspace with real browser, terminal, filesystem, and memory control, then let solved work crystallize into reusable skills.'
const serverSeoPageMap = new Map([
  [
    '/',
    {
      title: 'GenericAgent - Self-Evolving Agents for Real System Work',
      description: defaultMarketingDescription,
      robots: 'index,follow',
    },
  ],
  [
    '/compare/heavy-agent-stacks',
    {
      title: 'GenericAgent vs heavyweight agent stacks | GenericAgent',
      description:
        'Compare GenericAgent with heavyweight agent stacks for architecture weight, execution power, memory continuity, and token efficiency.',
      robots: 'index,follow',
    },
  ],
  [
    '/compare/chat-only-copilots',
    {
      title: 'GenericAgent vs chat-only copilots | GenericAgent',
      description:
        'Compare GenericAgent with chat-only copilots when the real question is whether your agent should operate tools or stop at conversation.',
      robots: 'index,follow',
    },
  ],
  [
    '/solutions/system-operators',
    {
      title: 'Launch GenericAgent for operator copilots that can act | GenericAgent',
      description:
        'See when GenericAgent is the right fit for founders and operators who need real browser, terminal, filesystem, and memory control.',
      robots: 'index,follow',
    },
  ],
  [
    '/solutions/research-automation',
    {
      title: 'Launch GenericAgent for research automation and recurring briefs | GenericAgent',
      description:
        'See how GenericAgent helps teams automate recurring research, monitoring, and briefs with reusable skills and layered memory.',
      robots: 'index,follow',
    },
  ],
  [
    '/solutions/operator-frontends',
    {
      title: 'Launch GenericAgent behind messaging frontends | GenericAgent',
      description:
        'See how GenericAgent pairs real execution with Telegram, Discord, or WhatsApp touchpoints instead of another stateless chat shell.',
      robots: 'index,follow',
    },
  ],
  [
    '/resources/generic-agent-github',
    {
      title: 'GenericAgent GitHub guide for evaluating the source project | GenericAgent',
      description:
        'Use this guide to understand what to inspect in the GenericAgent repository before you launch, fork, or compare it with another agent runtime.',
      robots: 'index,follow',
    },
  ],
  [
    '/resources/generic-agent-jobs',
    {
      title: 'Generic agent jobs and the roles behind operating agents | GenericAgent',
      description:
        'Review the responsibilities, skills, and evaluation habits teams need when agents move from chat assistance to real workflow operation.',
      robots: 'index,follow',
    },
  ],
  [
    '/privacy',
    {
      title: 'Privacy Policy | GenericAgent',
      description:
        'Read how GenericAgent processes visitor, account, order, payment, provisioning, and support information.',
      robots: 'index,follow',
    },
  ],
  [
    '/terms',
    {
      title: 'Terms of Service | GenericAgent',
      description:
        'Review the GenericAgent Terms of Service for account, order, payment, provisioning, console, and support usage.',
      robots: 'index,follow',
    },
  ],
  [
    '/plans',
    {
      title: 'Pricing Plans | GenericAgent',
      description:
        'Choose a GenericAgent plan based on workspace volume, then continue into payment and console-based provisioning tracking.',
      robots: 'noindex,nofollow',
    },
  ],
  [
    '/console',
    {
      title: 'Console | GenericAgent',
      description:
        'Track GenericAgent orders, provisioning, upgrades, and account operations inside the console.',
      robots: 'noindex,nofollow',
    },
  ],
  [
    '/checkout',
    {
      title: 'Checkout | GenericAgent',
      description:
        'Continue through payment and provisioning tracking inside the GenericAgent checkout flow.',
      robots: 'noindex,nofollow',
    },
  ],
])
const creemEnvironmentSetting = (process.env.CREEM_ENV ?? process.env.CREEM_MODE ?? '').trim().toLowerCase()
const creemTestApiKey = process.env.API_TEST_KEY ?? process.env.CREEM_TEST_KEY ?? process.env.creem_test_key ?? ''
const creemLiveApiKey = process.env.API_PROD_KEY ?? process.env.CREEM_API_KEY ?? process.env.CREEM_KEY ?? ''
const creemIsTestMode =
  creemEnvironmentSetting === 'test'
    ? true
    : creemEnvironmentSetting === 'live' || creemEnvironmentSetting === 'production'
      ? false
      : !isProduction && Boolean(creemTestApiKey)
const creemApiKey = creemIsTestMode ? creemTestApiKey : creemLiveApiKey || (!isProduction ? creemTestApiKey : '')
const creemBaseUrl =
  process.env.CREEM_BASE_URL ?? (creemIsTestMode ? 'https://test-api.creem.io' : 'https://api.creem.io')
const paymentProviderSetting = (process.env.PAYMENT_PROVIDER ?? '').trim().toLowerCase()
const paymentProvider =
  paymentProviderSetting === 'paypal'
    ? 'paypal'
    : paymentProviderSetting === 'creem'
      ? 'creem'
      : creemApiKey
        ? 'creem'
        : 'paypal'

await initializeAppDatabase(database)

const createUserStatement = database.prepare(`
  INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at, last_login_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
`)

const updateUserStatement = database.prepare(`
  UPDATE users
  SET name = ?, role = ?, status = ?, updated_at = ?
  WHERE id = ?
`)

const findUserByEmailStatement = database.prepare(`
  SELECT id, email, name, password_hash, role, status, created_at, updated_at, last_login_at
  FROM users
  WHERE email = ?
`)

const findUserByIdStatement = database.prepare(`
  SELECT id, email, name, password_hash, role, status, created_at, updated_at, last_login_at
  FROM users
  WHERE id = ?
`)

const countUsersStatement = database.prepare(`
  SELECT COUNT(*) AS count
  FROM users
`)

const countRemainingAdminsStatement = database.prepare(`
  SELECT COUNT(*) AS count
  FROM users
  WHERE id != ? AND role = 'admin' AND status = 'active'
`)

const listUsersStatement = database.prepare(`
  SELECT id, email, name, role, status, created_at, updated_at, last_login_at
  FROM users
  ORDER BY created_at ASC
`)

const createSessionStatement = database.prepare(`
  INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at)
  VALUES (?, ?, ?, ?, ?, ?)
`)

const deleteSessionByHashStatement = database.prepare(`
  DELETE FROM sessions
  WHERE token_hash = ?
`)

const deleteUserSessionsStatement = database.prepare(`
  DELETE FROM sessions
  WHERE user_id = ?
`)

const deleteExpiredSessionsStatement = database.prepare(`
  DELETE FROM sessions
  WHERE expires_at <= ?
`)

const updateSessionSeenStatement = database.prepare(`
  UPDATE sessions
  SET last_seen_at = ?
  WHERE id = ?
`)

const updateUserLastLoginStatement = database.prepare(`
  UPDATE users
  SET last_login_at = ?, updated_at = ?
  WHERE id = ?
`)

const findSessionStatement = database.prepare(`
  SELECT
    sessions.id AS session_id,
    sessions.user_id,
    sessions.expires_at,
    users.id,
    users.email,
    users.name,
    users.role,
    users.status,
    users.created_at,
    users.updated_at,
    users.last_login_at
  FROM sessions
  INNER JOIN users ON users.id = sessions.user_id
  WHERE sessions.token_hash = ?
`)

const createAnalyticsSessionStatement = database.prepare(`
  INSERT INTO analytics_sessions (
    id,
    visitor_id,
    user_id,
    landing_path,
    referrer_host,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content,
    device_type,
    browser_language,
    event_count,
    click_count,
    section_view_count,
    page_view_count,
    last_event_name,
    last_route_path,
    last_stage,
    started_at,
    last_seen_at,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const updateAnalyticsSessionStatement = database.prepare(`
  UPDATE analytics_sessions
  SET
    visitor_id = ?,
    user_id = COALESCE(?, user_id),
    referrer_host = COALESCE(referrer_host, ?),
    utm_source = COALESCE(utm_source, ?),
    utm_medium = COALESCE(utm_medium, ?),
    utm_campaign = COALESCE(utm_campaign, ?),
    utm_term = COALESCE(utm_term, ?),
    utm_content = COALESCE(utm_content, ?),
    device_type = COALESCE(device_type, ?),
    browser_language = COALESCE(browser_language, ?),
    event_count = event_count + ?,
    click_count = click_count + ?,
    section_view_count = section_view_count + ?,
    page_view_count = page_view_count + ?,
    last_event_name = ?,
    last_route_path = ?,
    last_stage = ?,
    started_at = CASE WHEN started_at < ? THEN started_at ELSE ? END,
    last_seen_at = ?,
    updated_at = ?
  WHERE id = ?
`)

const createAnalyticsEventStatement = database.prepare(`
  INSERT INTO analytics_events (
    id,
    visitor_id,
    session_id,
    user_id,
    order_id,
    event_type,
    event_name,
    route_path,
    page_key,
    section_key,
    element_key,
    referrer_host,
    metadata_json,
    occurred_at,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO NOTHING
`)

const findAnalyticsSessionByIdStatement = database.prepare(`
  SELECT *
  FROM analytics_sessions
  WHERE id = ?
`)

const listAnalyticsSessionsSinceStatement = database.prepare(`
  SELECT *
  FROM analytics_sessions
  WHERE started_at >= ?
  ORDER BY last_seen_at DESC
  LIMIT ?
`)

const listAnalyticsEventsBySessionIdStatement = database.prepare(`
  SELECT *
  FROM analytics_events
  WHERE session_id = ?
  ORDER BY occurred_at ASC, created_at ASC
`)

const countDistinctAnalyticsVisitorsSinceStatement = database.prepare(`
  SELECT COUNT(DISTINCT visitor_id) AS count
  FROM analytics_sessions
  WHERE started_at >= ?
`)

const countAnalyticsSessionsSinceStatement = database.prepare(`
  SELECT COUNT(*) AS count
  FROM analytics_sessions
  WHERE started_at >= ?
`)

const sumAnalyticsSessionMetricsSinceStatement = database.prepare(`
  SELECT
    COALESCE(SUM(page_view_count), 0) AS page_views,
    COALESCE(SUM(section_view_count), 0) AS section_views,
    COALESCE(SUM(click_count), 0) AS clicks
  FROM analytics_sessions
  WHERE started_at >= ?
`)

const countDistinctAnalyticsSessionsByEventNameSinceStatement = database.prepare(`
  SELECT COUNT(DISTINCT session_id) AS count
  FROM analytics_events
  WHERE occurred_at >= ?
    AND event_name = ?
`)

const countDistinctAnalyticsSessionsByPagePathSinceStatement = database.prepare(`
  SELECT COUNT(DISTINCT session_id) AS count
  FROM analytics_events
  WHERE occurred_at >= ?
    AND event_name = 'page_view'
    AND route_path = ?
`)

const countDistinctAnalyticsSessionsBySectionSinceStatement = database.prepare(`
  SELECT COUNT(DISTINCT session_id) AS count
  FROM analytics_events
  WHERE occurred_at >= ?
    AND event_name = 'content_view'
    AND section_key = ?
`)

const listAnalyticsTopCtaClicksSinceStatement = database.prepare(`
  SELECT
    COALESCE(element_key, 'unknown') AS key,
    COALESCE(section_key, 'unknown') AS section,
    COUNT(*) AS clicks,
    COUNT(DISTINCT session_id) AS sessions
  FROM analytics_events
  WHERE occurred_at >= ?
    AND event_type = 'click'
    AND event_name = 'cta_click'
  GROUP BY COALESCE(element_key, 'unknown'), COALESCE(section_key, 'unknown')
  ORDER BY clicks DESC, sessions DESC, key ASC
  LIMIT ?
`)

const listAnalyticsTopReferrersSinceStatement = database.prepare(`
  SELECT
    COALESCE(referrer_host, '(direct)') AS host,
    COUNT(*) AS count
  FROM analytics_sessions
  WHERE started_at >= ?
  GROUP BY COALESCE(referrer_host, '(direct)')
  ORDER BY count DESC, host ASC
  LIMIT ?
`)

const listAnalyticsDropOffStagesSinceStatement = database.prepare(`
  SELECT
    COALESCE(last_stage, 'unknown') AS stage,
    COUNT(*) AS count
  FROM analytics_sessions
  WHERE started_at >= ?
    AND COALESCE(last_stage, 'unknown') != 'payment_completed'
  GROUP BY COALESCE(last_stage, 'unknown')
  ORDER BY count DESC, stage ASC
  LIMIT ?
`)

const createOrderStatement = database.prepare(`
  INSERT INTO orders (
    id,
    order_number,
    user_id,
    guest_token,
    plan_id,
    model_id,
    channel_id,
    token_cipher_text,
    token_iv,
    token_tag,
    amount_cents,
    currency,
    payment_status,
    deployment_status,
    status_message,
    deployment_eta_minutes,
    included_deployments,
    created_at,
    updated_at,
    creem_checkout_id,
    paypal_order_id,
    paid_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
`)

const updateOrderPaymentStatement = database.prepare(`
  UPDATE orders
  SET payment_status = ?, deployment_status = ?, status_message = ?, paid_at = ?, updated_at = ?
  WHERE id = ?
`)

const updateOrderCheckoutStatement = database.prepare(`
  UPDATE orders
  SET creem_checkout_id = ?, updated_at = ?
  WHERE id = ?
`)

const updateOrderPayPalOrderStatement = database.prepare(`
  UPDATE orders
  SET paypal_order_id = ?, updated_at = ?
  WHERE id = ?
`)

const bindOrderToUserStatement = database.prepare(`
  UPDATE orders
  SET user_id = ?, guest_token = NULL, updated_at = ?
  WHERE id = ?
`)

const updateOrderDeploymentStatement = database.prepare(`
  UPDATE orders
  SET deployment_status = ?, status_message = ?, updated_at = ?
  WHERE id = ?
`)

const deleteOrderByIdStatement = database.prepare(`
  DELETE FROM orders
  WHERE id = ?
`)

const findOrderByIdStatement = database.prepare(`
  SELECT *
  FROM orders
  WHERE id = ?
`)

const findOrderByPayPalOrderIdStatement = database.prepare(`
  SELECT *
  FROM orders
  WHERE paypal_order_id = ?
`)

const listOrdersByUserStatement = database.prepare(`
  SELECT *
  FROM orders
  WHERE user_id = ?
  ORDER BY created_at DESC
`)

const listOrdersByGuestTokenStatement = database.prepare(`
  SELECT *
  FROM orders
  WHERE guest_token = ?
  ORDER BY created_at DESC
`)

const listAllOrdersStatement = database.prepare(`
  SELECT *
  FROM orders
  ORDER BY created_at DESC
`)

const createDeploymentStatement = database.prepare(`
  INSERT INTO deployments (
    id,
    order_id,
    user_id,
    trigger_mode,
    sequence_number,
    instance_name,
    status,
    progress,
    eta_minutes,
    target_server,
    workspace_path,
    console_url,
    public_endpoint,
    runtime_user,
    service_name,
    console_token_cipher_text,
    console_token_iv,
    console_token_tag,
    last_message,
    run_logs,
    created_at,
    started_at,
    finished_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NULL, NULL, ?)
`)

const updateDeploymentStatement = database.prepare(`
  UPDATE deployments
  SET
    status = ?,
    progress = ?,
    workspace_path = ?,
    console_url = ?,
    public_endpoint = ?,
    runtime_user = ?,
    service_name = ?,
    console_token_cipher_text = ?,
    console_token_iv = ?,
    console_token_tag = ?,
    last_message = ?,
    run_logs = ?,
    started_at = ?,
    finished_at = ?,
    updated_at = ?
  WHERE id = ?
`)

const bindDeploymentToUserStatement = database.prepare(`
  UPDATE deployments
  SET user_id = ?, updated_at = ?
  WHERE order_id = ?
`)

const findDeploymentByOrderIdStatement = database.prepare(`
  SELECT *
  FROM deployments
  WHERE order_id = ?
  ORDER BY sequence_number DESC, created_at DESC
  LIMIT 1
`)

const listDeploymentsByOrderIdStatement = database.prepare(`
  SELECT *
  FROM deployments
  WHERE order_id = ?
  ORDER BY sequence_number DESC, created_at DESC
`)

const countDeploymentsByOrderStatement = database.prepare(`
  SELECT COUNT(*) AS count
  FROM deployments
  WHERE order_id = ?
`)

const countReservedDeploymentsByOrderStatement = database.prepare(`
  SELECT COUNT(*) AS count
  FROM deployments
  WHERE order_id = ?
    AND status IN ('queued', 'provisioning', 'deployed')
`)

const findLatestAgentInstanceByOrderIdStatement = database.prepare(`
  SELECT *
  FROM agent_instances
  WHERE order_id = ?
  ORDER BY sequence_number DESC, created_at DESC
  LIMIT 1
`)

const listAgentInstancesByOrderIdStatement = database.prepare(`
  SELECT *
  FROM agent_instances
  WHERE order_id = ?
  ORDER BY sequence_number DESC, created_at DESC
`)

const findAgentInstanceByDeploymentIdStatement = database.prepare(`
  SELECT *
  FROM agent_instances
  WHERE deployment_id = ?
`)

const findDeploymentByIdStatement = database.prepare(`
  SELECT *
  FROM deployments
  WHERE id = ?
`)

const listQueuedDeploymentsStatement = database.prepare(`
  SELECT *
  FROM deployments
  WHERE status = 'queued'
  ORDER BY created_at ASC
`)

const createAgentInstanceStatement = database.prepare(`
  INSERT INTO agent_instances (
    id,
    order_id,
    deployment_id,
    user_id,
    sequence_number,
    instance_name,
    model_id,
    channel_id,
    status,
    target_server,
    workspace_path,
    console_url,
    public_endpoint,
    runtime_user,
    service_name,
    runtime_state,
    multica_version,
    upgrade_status,
    upgrade_target_version,
    upgrade_error,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const updateAgentInstanceStatement = database.prepare(`
  UPDATE agent_instances
  SET
    status = ?,
    target_server = ?,
    workspace_path = ?,
    console_url = ?,
    public_endpoint = ?,
    runtime_user = ?,
    service_name = ?,
    runtime_state = ?,
    multica_version = ?,
    upgrade_status = ?,
    upgrade_target_version = ?,
    upgrade_error = ?,
    updated_at = ?
  WHERE deployment_id = ?
`)

const updateAgentUpgradeStatement = database.prepare(`
  UPDATE agent_instances
  SET
    multica_version = ?,
    upgrade_status = ?,
    upgrade_target_version = ?,
    upgrade_error = ?,
    updated_at = ?
  WHERE id = ?
`)

const bindAgentInstanceToUserStatement = database.prepare(`
  UPDATE agent_instances
  SET user_id = ?, updated_at = ?
  WHERE order_id = ?
`)

const findAgentInstanceByOrderIdStatement = database.prepare(`
  SELECT *
  FROM agent_instances
  WHERE order_id = ?
  ORDER BY sequence_number DESC, created_at DESC
  LIMIT 1
`)

const listAgentInstancesByUserStatement = database.prepare(`
  SELECT *
  FROM agent_instances
  WHERE user_id = ?
  ORDER BY created_at DESC
`)

const listAgentInstancesByGuestTokenStatement = database.prepare(`
  SELECT agent_instances.*
  FROM agent_instances
  INNER JOIN orders ON orders.id = agent_instances.order_id
  WHERE orders.guest_token = ?
  ORDER BY agent_instances.created_at DESC
`)

const listAllAgentInstancesStatement = database.prepare(`
  SELECT *
  FROM agent_instances
  ORDER BY created_at DESC
`)

const findAgentInstanceByIdStatement = database.prepare(`
  SELECT *
  FROM agent_instances
  WHERE id = ?
`)

const deleteAgentInstanceByIdStatement = database.prepare(`
  DELETE FROM agent_instances
  WHERE id = ?
`)

const deleteDeploymentByIdStatement = database.prepare(`
  DELETE FROM deployments
  WHERE id = ?
`)

const findCreemProductStatement = database.prepare(`
  SELECT *
  FROM creem_products
  WHERE lookup_key = ?
`)

const upsertCreemProductStatement = database.prepare(`
  INSERT INTO creem_products (lookup_key, product_id, amount_cents, currency, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(lookup_key) DO UPDATE SET
    product_id = excluded.product_id,
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    updated_at = excluded.updated_at
`)

const loginRateLimiter = createRateLimiter(10, 15 * 60 * 1000)
const registerRateLimiter = createRateLimiter(5, 60 * 60 * 1000)
const analyticsRateLimiter = createRateLimiter(240, 60 * 1000)
const activeDeploymentIds = new Set()

let viteServer = null

if (!isProduction && shouldStartHttpServer) {
  const vite = await import('vite')
  viteServer = await vite.createServer({
    server: {
      middlewareMode: true,
    },
    appType: 'spa',
  })
}

function normalizeProxyPathSegment(segment) {
  if (!segment || segment === '/') {
    return '/'
  }

  return segment.startsWith('/') ? segment : `/${segment}`
}

function joinUpstreamProxyPath(basePathname, pathSuffix) {
  const normalizedBasePath = normalizeProxyPathSegment(basePathname)
  const normalizedPathSuffix = normalizeProxyPathSegment(pathSuffix)

  if (normalizedBasePath === '/') {
    return normalizedPathSuffix
  }

  if (normalizedPathSuffix === '/') {
    return normalizedBasePath.endsWith('/') ? normalizedBasePath : `${normalizedBasePath}/`
  }

  return `${normalizedBasePath.replace(/\/+$/, '')}${normalizedPathSuffix}`
}

function getMulticaProxyMatch(requestUrl) {
  return requestUrl.pathname.match(/^\/multica-console\/session\/([a-f0-9]+)(\/.*)?$/)
}

function appendSetCookieHeader(response, value) {
  const existing = response.getHeader('Set-Cookie')
  if (!existing) {
    response.setHeader('Set-Cookie', value)
    return
  }

  if (Array.isArray(existing)) {
    response.setHeader('Set-Cookie', [...existing, value])
    return
  }

  response.setHeader('Set-Cookie', [String(existing), value])
}

function getBearerToken(value) {
  if (typeof value !== 'string') {
    return ''
  }

  const match = value.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? ''
}

function tokenEquals(expected, actual) {
  if (!expected || !actual) {
    return false
  }

  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)

  if (expectedBuffer.length !== actualBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, actualBuffer)
}

function isHopByHopHeader(name) {
  return new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]).has(String(name ?? '').toLowerCase())
}

function buildModelProxyUpstreamUrl(requestUrl, upstreamPath) {
  const upstreamBaseUrl = normalizeModelProxyUpstreamBaseUrl(process.env.MULTICA_MODEL_PROXY_BASE_URL ?? '')
  if (!upstreamBaseUrl) {
    return null
  }

  const normalizedPath = String(upstreamPath ?? '').replace(/^\/+/, '')
  const upstreamUrl = new URL(normalizedPath ? `${upstreamBaseUrl}/${normalizedPath}` : upstreamBaseUrl)
  upstreamUrl.search = requestUrl.search
  return upstreamUrl
}

function isJsonContentType(value) {
  return String(value ?? '')
    .toLowerCase()
    .split(';')[0]
    .trim()
    .match(/^(application\/json|[^/]+\/[^+]+\+json)$/)
}

function requestMethodCanHaveBody(method) {
  return !['GET', 'HEAD'].includes(String(method ?? 'GET').toUpperCase())
}

async function readModelProxyRequestBodyBuffer(request) {
  const chunks = []
  let size = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length

    if (size > bodyLimitBytes) {
      throw new HttpError(413, 'Model proxy request body is too large.')
    }

    chunks.push(buffer)
  }

  return Buffer.concat(chunks)
}

function shouldUseGeminiSchemaCompatibility(payload) {
  return String(payload?.model ?? '').toLowerCase().includes('gemini')
}

function sanitizeGeminiJsonSchemaValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGeminiJsonSchemaValue(item))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const unsupportedKeys = new Set([
    '$id',
    '$schema',
    'additionalItems',
    'contains',
    'default',
    'definitions',
    'dependencies',
    'dependentRequired',
    'dependentSchemas',
    'examples',
    'if',
    'not',
    'patternProperties',
    'propertyNames',
    'then',
    'unevaluatedItems',
    'unevaluatedProperties',
  ])
  const compositionKeys = new Set(['allOf', 'anyOf', 'oneOf'])
  const output = {}

  for (const [key, nestedValue] of Object.entries(value)) {
    if (unsupportedKeys.has(key)) {
      continue
    }

    if (key === 'const') {
      if (!Array.isArray(output.enum)) {
        output.enum = [nestedValue]
      }
      continue
    }

    if (key === 'type' && Array.isArray(nestedValue)) {
      const normalizedType = nestedValue.find((item) => item && item !== 'null') ?? nestedValue.find(Boolean)
      if (normalizedType) {
        output.type = normalizedType
      }
      continue
    }

    if (compositionKeys.has(key)) {
      const selectedSchema = Array.isArray(nestedValue)
        ? nestedValue.find((item) => item && typeof item === 'object') ?? nestedValue[0]
        : null
      const sanitizedSchema = sanitizeGeminiJsonSchemaValue(selectedSchema)
      if (sanitizedSchema && typeof sanitizedSchema === 'object' && !Array.isArray(sanitizedSchema)) {
        for (const [schemaKey, schemaValue] of Object.entries(sanitizedSchema)) {
          if (output[schemaKey] === undefined) {
            output[schemaKey] = schemaValue
          }
        }
      }
      continue
    }

    output[key] = sanitizeGeminiJsonSchemaValue(nestedValue)
  }

  return output
}

function sanitizeGeminiToolDefinition(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGeminiToolDefinition(item))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const output = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    if (['input_schema', 'parameters', 'schema'].includes(key) && nestedValue && typeof nestedValue === 'object') {
      output[key] = sanitizeGeminiJsonSchemaValue(nestedValue)
      continue
    }

    output[key] = sanitizeGeminiToolDefinition(nestedValue)
  }

  return output
}

function sanitizeGeminiModelProxyPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload
  }

  return sanitizeGeminiToolDefinition(payload)
}

function getModelProxyChatMaxTokensCap() {
  const rawValue = String(process.env.MULTICA_MODEL_PROXY_CHAT_MAX_TOKENS_CAP ?? '').trim()
  if (!rawValue) {
    return 0
  }

  const parsedValue = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return 0
  }

  return parsedValue
}

function applyModelProxyChatTokenCap(request, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload
  }

  if (!/\/chat\/completions(?:\?|$)/i.test(String(request.url ?? ''))) {
    return payload
  }

  if (!String(payload.model ?? '').trim()) {
    return payload
  }

  const maxTokensCap = getModelProxyChatMaxTokensCap()
  if (!maxTokensCap) {
    return payload
  }

  let nextPayload = payload

  for (const key of ['max_tokens', 'max_completion_tokens']) {
    const currentValue = nextPayload[key]

    if (currentValue === undefined || currentValue === null || currentValue === '') {
      if (nextPayload === payload) {
        nextPayload = { ...payload }
      }
      nextPayload[key] = maxTokensCap
      continue
    }

    const numericValue =
      typeof currentValue === 'number' ? currentValue : Number.parseInt(String(currentValue), 10)

    if (Number.isFinite(numericValue) && numericValue > maxTokensCap) {
      if (nextPayload === payload) {
        nextPayload = { ...payload }
      }
      nextPayload[key] = maxTokensCap
    }
  }

  return nextPayload
}

function buildModelProxyRequestBodyBuffer(request, bodyBuffer) {
  if (!bodyBuffer.length || !isJsonContentType(request.headers['content-type'])) {
    return bodyBuffer
  }

  let payload
  try {
    payload = JSON.parse(bodyBuffer.toString('utf8'))
  } catch {
    return bodyBuffer
  }

  let transformedPayload = payload

  if (shouldUseGeminiSchemaCompatibility(payload)) {
    transformedPayload = sanitizeGeminiModelProxyPayload(transformedPayload)
  }

  transformedPayload = applyModelProxyChatTokenCap(request, transformedPayload)

  if (transformedPayload === payload) {
    return bodyBuffer
  }

  return Buffer.from(JSON.stringify(transformedPayload), 'utf8')
}

async function proxyModelRequest({ request, response, requestUrl, instanceName, upstreamPath }) {
  if (!isAllowedModelProxyRemoteAddress(request.socket.remoteAddress)) {
    throw new HttpError(403, 'Model proxy only accepts local server requests.')
  }

  const upstreamUrl = buildModelProxyUpstreamUrl(requestUrl, upstreamPath)
  const upstreamApiKey = String(process.env.QS_KEY ?? '').trim()
  if (!upstreamUrl || !upstreamApiKey) {
    throw new HttpError(503, 'Model proxy is not configured.')
  }

  const expectedToken = buildModelProxyInternalToken(instanceName)
  const providedToken = getBearerToken(request.headers.authorization)
  if (!tokenEquals(expectedToken, providedToken)) {
    throw new HttpError(401, 'Model proxy authentication failed.')
  }

  const proxyHeaders = {}
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || isHopByHopHeader(name) || String(name).toLowerCase() === 'host') {
      continue
    }

    if (['authorization', 'content-length'].includes(String(name).toLowerCase())) {
      continue
    }

    proxyHeaders[name] = value
  }

  proxyHeaders.authorization = `Bearer ${upstreamApiKey}`
  proxyHeaders['x-multica-instance-name'] = instanceName
  proxyHeaders['accept-encoding'] = 'identity'

  const requestFn = upstreamUrl.protocol === 'https:' ? httpsRequest : httpRequest
  const requestBody = requestMethodCanHaveBody(request.method)
    ? buildModelProxyRequestBodyBuffer(request, await readModelProxyRequestBodyBuffer(request))
    : Buffer.alloc(0)

  if (requestMethodCanHaveBody(request.method)) {
    proxyHeaders['content-length'] = String(requestBody.length)
  }

  await new Promise((resolvePromise, reject) => {
    const upstreamRequest = requestFn(
      upstreamUrl,
      {
        method: request.method,
        headers: proxyHeaders,
      },
      (upstreamResponse) => {
        response.statusCode = upstreamResponse.statusCode ?? 502

        for (const [name, value] of Object.entries(upstreamResponse.headers)) {
          if (value === undefined || isHopByHopHeader(name)) {
            continue
          }

          response.setHeader(name, value)
        }

        upstreamResponse.on('error', reject)
        upstreamResponse.on('end', resolvePromise)
        upstreamResponse.pipe(response)
      },
    )

    upstreamRequest.on('error', reject)

    if (!requestMethodCanHaveBody(request.method)) {
      upstreamRequest.end()
      return
    }

    upstreamRequest.end(requestBody)
  }).catch((error) => {
    const message = error instanceof Error ? error.message : 'Model proxy request failed.'
    throw new HttpError(502, message)
  })
}

function createMulticaConsoleSession({ orderId, deploymentId, consoleUrl, consoleToken }) {
  cleanupExpiredMulticaConsoleSessions()

  const sessionId = randomBytes(16).toString('hex')
  const expiresAt = Date.now() + multicaConsoleContextTtlMs
  const session = {
    id: sessionId,
    orderId,
    deploymentId,
    consoleUrl,
    consoleToken,
    expiresAt,
  }

  multicaConsoleSessions.set(sessionId, session)
  return session
}

function getMulticaConsoleSession(sessionId) {
  if (!sessionId) {
    return null
  }

  const session = multicaConsoleSessions.get(sessionId)
  if (!session) {
    return null
  }

  if (session.expiresAt <= Date.now()) {
    multicaConsoleSessions.delete(sessionId)
    return null
  }

  return session
}

function buildMulticaConsoleSessionUrl({ sessionId, deploymentId, consoleToken, guestToken }) {
  const url = new URL(`/multica-console/session/${sessionId}/`, 'http://localhost')
  if (deploymentId) {
    url.searchParams.set('deployment', deploymentId)
  }
  if (consoleToken) {
    url.searchParams.set('token', consoleToken)
  }
  if (guestToken) {
    url.searchParams.set('guest_token', guestToken)
  }
  return `${url.pathname}${url.search}`
}

function createMulticaConsoleSessionUrl({ orderId, deploymentId, consoleUrl, consoleToken, guestToken }) {
  const session = createMulticaConsoleSession({
    orderId,
    deploymentId,
    consoleUrl,
    consoleToken,
  })

  return buildMulticaConsoleSessionUrl({
    sessionId: session.id,
    deploymentId,
    consoleToken,
    guestToken,
  })
}

function setMulticaConsoleContextCookies(response, request, { sessionId, guestToken = null }) {
  const baseParts = [
    'Path=/multica-console',
    `Max-Age=${Math.floor(multicaConsoleContextTtlMs / 1000)}`,
    'HttpOnly',
    'SameSite=Lax',
  ]

  if (getAbsoluteRequestOrigin(request).startsWith('https://')) {
    baseParts.push('Secure')
  }

  appendSetCookieHeader(
    response,
    `${multicaConsoleSessionCookieName}=${encodeURIComponent(sessionId)}; ${baseParts.join('; ')}`,
  )

  if (guestToken) {
    const guestCookieParts = [
      `Path=/`,
      `Max-Age=${Math.floor(guestTtlMs / 1000)}`,
      'HttpOnly',
      'SameSite=Lax',
    ]

    if (getAbsoluteRequestOrigin(request).startsWith('https://')) {
      guestCookieParts.push('Secure')
    }

    appendSetCookieHeader(
      response,
      `${guestCookieName}=${encodeURIComponent(guestToken)}; ${guestCookieParts.join('; ')}`,
    )
  }
}

async function resolveMulticaProxyTarget(request, overrideSessionId, overridePathSuffix) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const match = getMulticaProxyMatch(requestUrl)
  const sessionId = overrideSessionId ?? match?.[1] ?? null
  const pathSuffix = normalizeProxyPathSegment(overridePathSuffix ?? match?.[2] ?? '/')

  if (!sessionId) {
    return null
  }

  const session = getMulticaConsoleSession(sessionId)
  if (!session) {
    throw new HttpError(410, 'GenericAgent console session expired. Reopen it from the dashboard.')
  }

  const context = await requireOrderAccessContext(request)
  const order = await findOrderByIdStatement.get(session.orderId)
  await assertOrderAccess(context, order)

  const deployment = await findDeploymentByIdStatement.get(session.deploymentId)
  if (!deployment || deployment.order_id !== order.id || !session.consoleUrl) {
    throw new HttpError(400, 'GenericAgent console is not ready yet.')
  }

  const claw = await findAgentInstanceByDeploymentIdStatement.get(deployment.id)
  if (claw?.runtime_state === 'stopped') {
    throw new HttpError(400, 'This GenericAgent workspace is stopped. Start a new provisioning run or uninstall it first.')
  }

  const upstreamUrl = new URL(session.consoleUrl)
  upstreamUrl.pathname = joinUpstreamProxyPath(upstreamUrl.pathname, pathSuffix)
  upstreamUrl.search = requestUrl.search
  upstreamUrl.searchParams.delete('guest_token')

  upstreamUrl.searchParams.set('deployment', session.deploymentId)

  if (session.consoleToken) {
    upstreamUrl.searchParams.set('token', session.consoleToken)
  } else {
    upstreamUrl.searchParams.delete('token')
  }

  return {
    basePath: `/multica-console/session/${session.id}`,
    consoleToken: session.consoleToken,
    deploymentId: session.deploymentId,
    orderId: order.id,
    sessionId: session.id,
    upstreamUrl,
    pathSuffix,
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
        'origin',
        'referer',
        'if-none-match',
        'if-modified-since',
        'accept-encoding',
      ].includes(key.toLowerCase())
    ) {
      continue
    }

    nextHeaders[key] = value
  }

  nextHeaders.host = upstreamUrl.host
  const originalOrigin = headers.origin
  if (typeof originalOrigin === 'string' && originalOrigin.trim()) {
    nextHeaders.origin = originalOrigin
  }

  const originalReferer = headers.referer
  if (typeof originalReferer === 'string' && originalReferer.trim()) {
    nextHeaders.referer = originalReferer
  }

  if (multicaRouterSharedToken) {
    nextHeaders['x-multica-router-token'] = multicaRouterSharedToken
  }

  return nextHeaders
}

function injectMulticaConsoleTokenPersistence(html, consoleToken, basePath, deploymentId) {
  if (!consoleToken || !html.includes('</head>')) {
    return html
  }

  const bootstrap = [
    '<script>(function(){',
    `const token=${JSON.stringify(consoleToken)};`,
    `const basePath=${JSON.stringify(basePath)};`,
    `const deploymentId=${JSON.stringify(deploymentId ?? '')};`,
    "const settingsPrefix='multica.control.settings.v1';",
    "const deploymentPrefix='multica.control.deployment.v1:';",
    "const normalizeGatewayUrl=(value)=>{let nextValue=String(value||'').trim();while(nextValue.endsWith('/')){nextValue=nextValue.slice(0,-1)}return nextValue};",
    "const getConsoleUrl=(value)=>{try{return value instanceof URL?new URL(value.toString()):new URL(String(value||window.location.href),window.location.href)}catch{return new URL(window.location.href)}};",
    "const resolveGatewayPath=(value)=>{const currentPath=String(getConsoleUrl(value).pathname||'');return currentPath===basePath||currentPath.startsWith(basePath+'/')?currentPath:basePath;};",
    "const resolveGatewayUrl=(value)=>{const currentUrl=getConsoleUrl(value);const nextGatewayUrl=new URL((window.location.protocol==='https:'?'wss:':'ws:')+'//'+window.location.host+resolveGatewayPath(currentUrl));currentUrl.searchParams.forEach((paramValue,key)=>{nextGatewayUrl.searchParams.set(key,paramValue)});return normalizeGatewayUrl(nextGatewayUrl.toString());};",
    "const getStorageGatewayUrl=(value)=>normalizeGatewayUrl(resolveGatewayUrl(value).replace(/[?#].*$/,''));",
    "const sameConsolePath=(value)=>{const url=getConsoleUrl(value);return url.host===window.location.host&&url.pathname.startsWith(basePath);};",
    "const extractConsoleSuffix=(value)=>{const pathname=String(getConsoleUrl(value).pathname||'');const match=pathname.match(/^\\/multica-console\\/session\\/[a-f0-9]+(\\/.*)?$/);return match?match[1]||'':null;};",
    "const isAnyConsolePath=(value)=>{const url=getConsoleUrl(value);return url.host===window.location.host&&extractConsoleSuffix(url)!==null;};",
    "const removeMatchingKeys=(storage,predicate)=>{try{const removals=[];for(let index=0;index<storage.length;index+=1){const key=storage.key(index);if(key&&predicate(key)){removals.push(key)}}for(const key of removals){storage.removeItem(key)}}catch{}};",
    "const clearStaleConsoleState=()=>{removeMatchingKeys(window.sessionStorage,(key)=>key==='multica.control.settings.v1'||key.startsWith('multica.control.token.v1:')||key.startsWith('multica.control.deployment.v1:'));removeMatchingKeys(window.localStorage,(key)=>key==='multica.control.settings.v1'||key.startsWith('multica.control.settings.v1:')||key.startsWith('multica.control.deployment.v1:'));};",
    "const readSettings=(storageKey)=>{try{return JSON.parse(window.localStorage.getItem(storageKey)||window.localStorage.getItem(settingsPrefix)||'null')||{}}catch{return {}}};",
    "const readStoredToken=(storageGatewayUrl)=>{try{const directKey='multica.control.token.v1:'+storageGatewayUrl;const directValue=window.sessionStorage.getItem(directKey);if(directValue)return directValue;for(let index=0;index<window.sessionStorage.length;index+=1){const key=window.sessionStorage.key(index);if(key&&key.startsWith('multica.control.token.v1:')){const storedValue=window.sessionStorage.getItem(key);if(storedValue)return storedValue}}return window.__MULTICA_PROXY_TOKEN||token}catch{return window.__MULTICA_PROXY_TOKEN||token}};",
    "const readGuestToken=(value)=>{try{return getConsoleUrl(value).searchParams.get('guest_token')||''}catch{return ''}};",
    "const persistConsoleState=(value)=>{const nextGatewayUrl=resolveGatewayUrl(value);const nextStorageGatewayUrl=normalizeGatewayUrl(nextGatewayUrl.replace(/[?#].*$/,''));const nextSettingsStorageKey=settingsPrefix+':'+nextStorageGatewayUrl;const nextTokenStorageKey='multica.control.token.v1:'+nextStorageGatewayUrl;const nextDeploymentStorageKey=deploymentPrefix+nextStorageGatewayUrl;const activeToken=readStoredToken(nextStorageGatewayUrl);try{const nextSettings={...readSettings(nextSettingsStorageKey),gatewayUrl:nextGatewayUrl};window.localStorage.setItem(settingsPrefix,JSON.stringify(nextSettings));window.localStorage.setItem(nextSettingsStorageKey,JSON.stringify(nextSettings))}catch{}if(activeToken){try{window.sessionStorage.setItem(nextTokenStorageKey,activeToken)}catch{}}if(deploymentId){try{window.sessionStorage.setItem(nextDeploymentStorageKey,deploymentId);window.localStorage.setItem(nextDeploymentStorageKey,deploymentId)}catch{}}window.__MULTICA_PROXY_TOKEN=activeToken;return {gatewayUrl:nextGatewayUrl,storageGatewayUrl:nextStorageGatewayUrl};};",
    "const appendAuthState=(value)=>{if(!value)return value;try{const url=value instanceof URL?new URL(value.toString()):new URL(String(value),window.location.href);if(isAnyConsolePath(url)&&!sameConsolePath(url)){const suffix=extractConsoleSuffix(url)||'';url.pathname=basePath+suffix}if(!sameConsolePath(url))return value;const activeToken=readStoredToken(getStorageGatewayUrl(url));const activeGuestToken=url.searchParams.get('guest_token')||readGuestToken(window.location.href);if(activeToken&&url.searchParams.get('token')!==activeToken)url.searchParams.set('token',activeToken);if(activeGuestToken&&url.searchParams.get('guest_token')!==activeGuestToken)url.searchParams.set('guest_token',activeGuestToken);if(deploymentId&&url.searchParams.get('deployment')!==deploymentId)url.searchParams.set('deployment',deploymentId);return value instanceof URL?url:url.pathname+url.search+url.hash}catch{return value}};",
    "let consoleState={gatewayUrl:resolveGatewayUrl(window.location.href),storageGatewayUrl:getStorageGatewayUrl(window.location.href)};",
    "const syncConsoleRouteState=(value)=>{const nextUrl=appendAuthState(value||window.location.href);const normalizedUrl=nextUrl instanceof URL?nextUrl:new URL(String(nextUrl),window.location.href);consoleState=persistConsoleState(normalizedUrl);return normalizedUrl;};",
    "window.__MULTICA_CONTROL_UI_BASE_PATH__=basePath;",
    "clearStaleConsoleState();",
    "consoleState=persistConsoleState(window.location.href);",
    "try{const current=syncConsoleRouteState(window.location.href);window.history.replaceState(window.history.state,'',current.pathname+current.search+current.hash)}catch{}",
    "for(const method of ['pushState','replaceState']){const original=window.history[method];window.history[method]=function(state,title,url){if(typeof url==='string'||url instanceof URL){const nextUrl=syncConsoleRouteState(url);return original.call(this,state,title,nextUrl.pathname+nextUrl.search+nextUrl.hash)}return original.call(this,state,title,url)}}",
    "if(typeof window.addEventListener==='function'){window.addEventListener('popstate',()=>{syncConsoleRouteState(window.location.href)});window.addEventListener('hashchange',()=>{syncConsoleRouteState(window.location.href)})}",
    "document.addEventListener('click',(event)=>{const anchor=event.target instanceof Element?event.target.closest('a[href]'):null;if(!anchor)return;const href=anchor.getAttribute('href');if(!href)return;const nextHref=appendAuthState(href);if(typeof nextHref==='string'&&nextHref!==href){anchor.setAttribute('href',nextHref)}});",
    "if(typeof window.WebSocket==='function'){const OriginalWebSocket=window.WebSocket;const PatchedWebSocket=function(url,protocols){const current=syncConsoleRouteState(window.location.href);try{const nextUrl=url instanceof URL?new URL(url.toString()):new URL(String(url),current.toString());if(sameConsolePath(nextUrl)||isAnyConsolePath(nextUrl)){nextUrl.pathname=current.pathname;current.searchParams.forEach((paramValue,key)=>{nextUrl.searchParams.set(key,paramValue)});const activeToken=readStoredToken(getStorageGatewayUrl(nextUrl));const activeGuestToken=nextUrl.searchParams.get('guest_token')||readGuestToken(current);if(activeToken&&nextUrl.searchParams.get('token')!==activeToken)nextUrl.searchParams.set('token',activeToken);if(activeGuestToken&&nextUrl.searchParams.get('guest_token')!==activeGuestToken)nextUrl.searchParams.set('guest_token',activeGuestToken);if(deploymentId&&nextUrl.searchParams.get('deployment')!==deploymentId)nextUrl.searchParams.set('deployment',deploymentId);url=url instanceof URL?nextUrl:nextUrl.toString()}}catch{}return protocols===undefined?new OriginalWebSocket(url):new OriginalWebSocket(url,protocols)};PatchedWebSocket.prototype=OriginalWebSocket.prototype;window.WebSocket=PatchedWebSocket;}",
    'window.__MULTICA_PROXY_TOKEN=readStoredToken(consoleState.storageGatewayUrl);',
    '})();</script>',
  ].join('')
  return html.replace('</head>', `${bootstrap}</head>`)
}

function getMulticaProxyRetryDelays(method) {
  if (!['GET', 'HEAD'].includes(String(method ?? 'GET').toUpperCase())) {
    return [0]
  }

  return [0, 250, 500, 1000]
}

async function fetchMulticaProxyUpstream(target, request, method, body) {
  const retryDelays = getMulticaProxyRetryDelays(method)
  let lastError = null

  for (const delayMs of retryDelays) {
    if (delayMs > 0) {
      await delay(delayMs)
    }

    try {
      return await fetch(target.upstreamUrl, {
        method,
        headers: filterProxyRequestHeaders(request.headers, target.upstreamUrl),
        body,
        redirect: 'manual',
      })
    } catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error('GenericAgent console upstream request failed.')
}

function getMulticaProxyUpgradeRetryDelays() {
  return [0, 250, 500, 1000]
}

async function handleMulticaConsoleProxyRequest(request, response) {
  let target

  try {
    target = await resolveMulticaProxyTarget(request)
  } catch (error) {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    const acceptsHtml = String(request.headers.accept ?? '').includes('text/html')
    if (acceptsHtml && error instanceof HttpError && error.statusCode === 401) {
      response.statusCode = 302
      response.setHeader('Location', `/?redirect=${encodeURIComponent(`${requestUrl.pathname}${requestUrl.search}`)}`)
      response.end()
      return true
    }

    throw error
  }

  if (!target) {
    return false
  }

  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  if (!requestUrl.pathname.endsWith('/') && target.pathSuffix === '/') {
    setMulticaConsoleContextCookies(response, request, {
      sessionId: target.sessionId,
      guestToken: getGuestToken(request),
    })
    response.statusCode = 302
    response.setHeader('Location', `${requestUrl.pathname}/${requestUrl.search}`)
    response.end()
    return true
  }

  const acceptsHtml = String(request.headers.accept ?? '').includes('text/html')
  if (
    request.method === 'GET' &&
    acceptsHtml &&
    ((target.consoleToken && !requestUrl.searchParams.has('token')) ||
      (target.deploymentId && requestUrl.searchParams.get('deployment') !== target.deploymentId)) &&
    !requestUrl.pathname.includes('/assets/')
  ) {
    const redirectUrl = new URL(requestUrl.toString())
    if (target.consoleToken) {
      redirectUrl.searchParams.set('token', target.consoleToken)
    }
    if (target.deploymentId) {
      redirectUrl.searchParams.set('deployment', target.deploymentId)
    }
    setMulticaConsoleContextCookies(response, request, {
      sessionId: target.sessionId,
      guestToken: getGuestToken(request),
    })
    response.statusCode = 302
    response.setHeader('Location', `${redirectUrl.pathname}${redirectUrl.search}`)
    response.end()
    return true
  }

  const method = request.method ?? 'GET'
  const hasBody = !['GET', 'HEAD'].includes(method)
  const bodyChunks = []

  if (hasBody) {
    for await (const chunk of request) {
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
  }

  let upstreamResponse

  try {
    upstreamResponse = await fetchMulticaProxyUpstream(
      target,
      request,
      method,
      hasBody ? Buffer.concat(bodyChunks) : undefined,
    )
  } catch {
    throw new HttpError(502, 'GenericAgent console is temporarily unreachable.')
  }

  response.statusCode = upstreamResponse.status

  for (const [key, value] of upstreamResponse.headers.entries()) {
    if (['connection', 'content-length', 'transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) {
      continue
    }

    response.setHeader(key, value)
  }

  setMulticaConsoleContextCookies(response, request, {
    sessionId: target.sessionId,
    guestToken: getGuestToken(request),
  })
  response.setHeader('Cache-Control', 'no-store')
  const contentType = upstreamResponse.headers.get('content-type') ?? ''
  let payload = Buffer.from(await upstreamResponse.arrayBuffer())

  if (contentType.includes('text/html')) {
    const html = payload.toString('utf8')
    payload = Buffer.from(
      injectMulticaConsoleTokenPersistence(html, target.consoleToken, target.basePath, target.deploymentId),
      'utf8',
    )
  }

  response.setHeader('Content-Length', String(payload.length))
  response.end(payload)
  return true
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

async function handleMulticaConsoleProxyUpgrade(request, socket, head) {
  let target

  // Expired console tabs may disconnect while we're still resolving the proxy target.
  // Swallow low-level socket errors so one stale websocket does not crash the whole dev server.
  socket.on('error', () => {})

  try {
    const urlObj = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    const match = getMulticaProxyMatch(urlObj)
    const cookies = parseCookies(request)

    try {
      target = await resolveMulticaProxyTarget(request)
      if (!target) {
        throw new HttpError(404, 'GenericAgent console session route not found.')
      }
    } catch (error) {
      let overrideSessionId = null
      let overridePathSuffix = match?.[2] ?? '/'
      let refererUrl = null

      try {
        refererUrl = request.headers.referer ? new URL(request.headers.referer) : null
      } catch {
        refererUrl = null
      }

      if (refererUrl) {
        const refererMatch = getMulticaProxyMatch(refererUrl)
        if (refererMatch) {
          overrideSessionId = refererMatch[1]
          overridePathSuffix = refererMatch[2] ?? overridePathSuffix
          console.log('[Proxy WS] Falling back to referer console session ID:', overrideSessionId)
        }
      }

      if (!overrideSessionId) {
        const contextSessionId = cookies[multicaConsoleSessionCookieName]
        if (contextSessionId) {
          overrideSessionId = contextSessionId
          console.log('[Proxy WS] Falling back to console session cookie ID:', overrideSessionId)
        }
      }

      if (!overrideSessionId) {
        throw error
      }

      target = await resolveMulticaProxyTarget(request, overrideSessionId, overridePathSuffix)
    }

    console.log('[Proxy WS] request URL:', request.url, 'Target:', target?.upstreamUrl?.href)
  } catch (error) {
      console.error('[Proxy WS] Resolve error for url:', request.url, error.message)
      const statusCode = error instanceof HttpError ? error.statusCode : 500
      const statusMessage = error instanceof Error ? error.message : 'Internal server error.'
      writeUpgradeHeaders(socket, statusCode, 'Proxy Error', {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(statusMessage),
        Connection: 'close',
      })
      socket.end(statusMessage)
      return
    }

  if (!target) {
          return
        }

  const upstreamUrl = new URL(target.upstreamUrl)
  const upstreamTransportProtocol = upstreamUrl.protocol === 'https:' ? 'https:' : 'http:'
  const upstreamSocketProtocol = upstreamTransportProtocol === 'https:' ? 'wss:' : 'ws:'
  const requestFactory = upstreamTransportProtocol === 'https:' ? httpsRequest : httpRequest
  const retryDelays = getMulticaProxyUpgradeRetryDelays()
  let settled = false

  const fail = () => {
    if (settled || socket.destroyed) {
      return
    }

    settled = true
    writeUpgradeHeaders(socket, 502, 'Bad Gateway', {
      Connection: 'close',
    })
    socket.end()
  }

  const startAttempt = (attemptIndex) => {
    if (settled || socket.destroyed) {
      return
    }

    let upstreamRequest

    try {
      upstreamRequest = requestFactory({
        protocol: upstreamTransportProtocol,
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port || (upstreamTransportProtocol === 'https:' ? 443 : 80),
        method: 'GET',
        path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
        headers: {
          ...filterProxyRequestHeaders(request.headers, upstreamUrl),
          upgrade: 'websocket',
          connection: 'Upgrade',
        },
      })
    } catch {
      fail()
      return
    }

    upstreamRequest.setTimeout(5000, () => {
      upstreamRequest.destroy(new Error('GenericAgent websocket upstream timed out.'))
    })

    upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      if (settled || socket.destroyed) {
        upstreamSocket.destroy()
        return
      }

      console.log('[Proxy WS] Connected 101 to', target.upstreamUrl)
      settled = true
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
      if (settled || socket.destroyed) {
        upstreamResponse.resume()
        return
      }

      console.log('[Proxy WS] Received HTTP', upstreamResponse.statusCode)
      settled = true
      writeUpgradeHeaders(socket, upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage ?? 'Bad Gateway', {
        Connection: 'close',
      })
      upstreamResponse.pipe(socket)
    })

    upstreamRequest.on('error', (error) => {
      if (settled || socket.destroyed) {
        return
      }

      console.log('[Proxy WS] Error:', error.message)

      const nextDelay = retryDelays[attemptIndex + 1]
      if (nextDelay === undefined) {
        fail()
        return
      }

      setTimeout(() => {
        startAttempt(attemptIndex + 1)
      }, nextDelay)
    })

    upstreamRequest.end()
  }

  startAttempt(0)
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

async function ensureGuestUser() {
  const existingUser = await findUserByEmailStatement.get(guestUserEmail)
  if (existingUser) {
    return existingUser
  }

  return await createUserRecord({
    email: guestUserEmail,
    name: guestUserName,
    password: `Guest${randomBytes(12).toString('hex')}9A`,
    role: 'operator',
  })
}

function createRateLimiter(limit, windowMs) {
  const hits = new Map()

  return (key) => {
    const now = Date.now()
    const current = hits.get(key)

    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
      return { allowed: true, retryAfterMs: 0 }
    }

    if (current.count >= limit) {
      return { allowed: false, retryAfterMs: current.resetAt - now }
    }

    current.count += 1
    hits.set(key, current)
    return { allowed: true, retryAfterMs: 0 }
  }
}

async function cleanupExpiredSessions() {
  await deleteExpiredSessionsStatement.run(nowIso())
}

function cleanupExpiredMulticaConsoleSessions() {
  const now = Date.now()

  for (const [sessionId, session] of multicaConsoleSessions.entries()) {
    if (session.expiresAt <= now) {
      multicaConsoleSessions.delete(sessionId)
    }
  }
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeEmail(value) {
  return value.trim().toLowerCase()
}

function parseConfiguredAdminAllowedEmails(value) {
  return new Set(
    String(value ?? '')
      .split(/[,\n;\s]+/)
      .map((item) => normalizeEmail(item))
      .filter(Boolean),
  )
}

const configuredAdminAllowedEmails = parseConfiguredAdminAllowedEmails(
  process.env.ADMIN_ALLOWED_EMAILS ?? process.env.ADMIN_ALLOWED_EMAIL ?? '',
)

function isConfiguredAdminEmail(email) {
  const normalizedEmail = normalizeEmail(String(email ?? ''))
  return Boolean(normalizedEmail) && configuredAdminAllowedEmails.has(normalizedEmail)
}

function getConfiguredUserRole(email, fallbackRole = 'operator') {
  return isConfiguredAdminEmail(email) ? 'admin' : fallbackRole
}

function sanitizeName(value) {
  return value.trim().replace(/\s+/g, ' ')
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function validatePassword(password) {
  const trimmed = password.trim()
  const hasLowercase = /[a-z]/.test(trimmed)
  const hasUppercase = /[A-Z]/.test(trimmed)
  const hasDigit = /\d/.test(trimmed)

  if (trimmed.length < 12 || trimmed.length > 128) {
    throw new HttpError(400, 'Password must be between 12 and 128 characters.')
  }

  if (!hasLowercase || !hasUppercase || !hasDigit) {
    throw new HttpError(400, 'Password must include uppercase, lowercase, and numeric characters.')
  }
}

function validateName(name) {
  if (name.length < 2 || name.length > 80) {
    throw new HttpError(400, 'Name must be between 2 and 80 characters.')
  }
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':')
  if (!salt || !hash) {
    return false
  }

  const derived = scryptSync(password, salt, 64)
  const stored = Buffer.from(hash, 'hex')

  if (derived.length !== stored.length) {
    return false
  }

  return timingSafeEqual(derived, stored)
}

function serializeUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  }
}

async function createUserRecord({ email, name, password, role }) {
  const normalizedEmail = normalizeEmail(email)
  const normalizedName = sanitizeName(name)

  validateName(normalizedName)
  validatePassword(password)

  if (!validateEmail(normalizedEmail)) {
    throw new HttpError(400, 'Enter a valid email address.')
  }

  if (await findUserByEmailStatement.get(normalizedEmail)) {
    throw new HttpError(409, 'An account with this email already exists.')
  }

  const timestamp = nowIso()
  const userId = randomBytes(16).toString('hex')

  await createUserStatement.run(
    userId,
    normalizedEmail,
    normalizedName,
    hashPassword(password),
    role,
    'active',
    timestamp,
    timestamp,
  )

  return await findUserByIdStatement.get(userId)
}

async function syncUserRoleWithAdminConfig(user) {
  if (!user) {
    return user
  }

  const configuredRole = getConfiguredUserRole(user.email, 'operator')
  if (configuredRole === user.role) {
    return user
  }

  await updateUserStatement.run(user.name, configuredRole, user.status, nowIso(), user.id)
  return await findUserByIdStatement.get(user.id)
}

await ensureGuestUser()

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
}

function formatMoney(amountCents, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100)
}

const {
  getChannelById,
  getModelById,
  getPlanById,
  resolvePlanSelection,
  validateCommunicationToken,
} = createCatalogHelpers({
  annualBillingMultiplier,
  channelCatalog,
  formatMoney,
  HttpError,
  modelCatalog,
  planCatalog,
})

function encryptSecretValue(value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', tokenEncryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    cipherText: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: authTag.toString('hex'),
  }
}

function decryptSecretValue({ cipherText, iv, tag }) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    tokenEncryptionKey,
    Buffer.from(iv, 'hex'),
  )
  decipher.setAuthTag(Buffer.from(tag, 'hex'))

  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}

function buildMaskedTokenDisplay(token) {
  const normalizedToken = token.trim()
  if (!normalizedToken) {
    return 'Not bound'
  }

  if (normalizedToken.length <= 8) {
    return normalizedToken
  }

  return `${normalizedToken.slice(0, 4)}••••${normalizedToken.slice(-4)}`
}

function getDeploymentRuntimeConfig() {
  return loadDeploymentConfig({
    configPath: deploymentConfigPath,
    encryptionSecret:
      process.env.MULTICA_CONFIG_SECRET ??
      process.env.MULTICA_TOKEN_SECRET ??
      `${projectRoot}:${databaseIdentity}`,
  })
}

function getConfiguredMulticaVersion() {
  try {
    return readConfiguredMulticaRepoRef(deploymentConfigPath) || defaultMulticaRepoRef
  } catch {
    return defaultMulticaRepoRef
  }
}

function getAgentMulticaVersion(row) {
  if (typeof row?.multica_version === 'string' && row.multica_version.trim()) {
    return row.multica_version.trim()
  }

  return getConfiguredMulticaVersion()
}

function getAgentUpgradeStatus(row) {
  return row?.upgrade_status === 'in_progress' || row?.upgrade_status === 'failed'
    ? row.upgrade_status
    : 'idle'
}

function buildOrderNumber() {
  return `mca-${Date.now().toString().slice(-8)}`
}

function buildInstanceName(user, modelId, channelId) {
  const base = slugify(`${user.name}-${modelId}-${channelId}`) || 'multica'
  return `${base}-${randomBytes(3).toString('hex')}`
}

function getAbsoluteRequestOrigin(request) {
  const host = request.headers.host ?? `localhost:${port}`
  const isLocalHost =
    host.includes('localhost') || host.includes('127.0.0.1') || host.includes('[::1]') || host.includes('::1')
  const forwardedProto = request.headers['x-forwarded-proto']
  const protocol =
    typeof forwardedProto === 'string'
      ? forwardedProto.split(',')[0].trim()
      : isProduction && !isLocalHost
        ? 'https'
        : 'http'

  return `${protocol}://${host}`
}

function getOrderIncludedDeployments(order) {
  return Number(order.included_deployments ?? resolvePlanSelection(order.plan_id).plan.includedDeployments ?? 1)
}

async function getReservedDeploymentCount(orderId) {
  return Number((await countReservedDeploymentsByOrderStatement.get(orderId))?.count ?? 0)
}

async function getDeploymentCount(orderId) {
  return Number((await countDeploymentsByOrderStatement.get(orderId))?.count ?? 0)
}

function getPaidOrderTriggerMode() {
  return process.env.MULTICA_DEPLOYMENT_MODE === 'manual' ? 'manual' : 'automatic'
}

async function canTriggerDeployment(order) {
  if (!order || order.payment_status !== 'paid') {
    return false
  }

  return (await getReservedDeploymentCount(order.id)) < getOrderIncludedDeployments(order)
}

async function createDeploymentForOrder(order, triggerMode) {
  const orderOwner = (await findUserByIdStatement.get(order.user_id)) ?? (await ensureGuestUser())
  const instanceName = buildInstanceName(orderOwner, order.model_id, order.channel_id)
  const timestamp = nowIso()
  const nextSequence = (await getDeploymentCount(order.id)) + 1

  await createDeploymentStatement.run(
    randomBytes(16).toString('hex'),
    order.id,
    order.user_id,
    triggerMode,
    nextSequence,
    instanceName,
    'queued',
    10,
    order.deployment_eta_minutes,
    deploymentTargetServer,
    'Payment confirmed. Waiting for deployment runner.',
    '',
    timestamp,
    timestamp,
  )

  await updateOrderDeploymentStatus(
    order.id,
    'queued',
    triggerMode === 'manual'
      ? 'Manual provisioning trigger accepted. A new GenericAgent workspace is queued.'
      : 'Payment confirmed. Provisioning is queued and will begin shortly.',
  )

  runBackgroundTask(() => pumpDeploymentQueue(), `pumpDeploymentQueue:queuePaidOrder:${order.id}`)
  return await findDeploymentByOrderIdStatement.get(order.id)
}

async function queuePaidOrder(order) {
  const timestamp = nowIso()
  const triggerMode = getPaidOrderTriggerMode()

  if (order.payment_status !== 'paid') {
    await updateOrderPaymentStatement.run(
      'paid',
      order.deployment_status === 'awaiting_payment' ? 'awaiting_payment' : order.deployment_status,
      triggerMode === 'manual'
        ? 'Payment confirmed. Your GenericAgent workspace is waiting in the provisioning queue.'
        : 'Payment confirmed. Preparing provisioning trigger.',
      timestamp,
      timestamp,
      order.id,
    )
  }

  const freshOrder = await findOrderByIdStatement.get(order.id)
  if (!(await canTriggerDeployment(freshOrder))) {
    return freshOrder
  }

  if ((await getDeploymentCount(order.id)) > 0) {
    return freshOrder
  }

  await createDeploymentForOrder(freshOrder, triggerMode)
  return await findOrderByIdStatement.get(order.id)
}

function setOrderCheckoutId(orderId, checkoutId) {
  return updateOrderCheckoutStatement
    .run(checkoutId, nowIso(), orderId)
    .then(() => findOrderByIdStatement.get(orderId))
}

async function setOrderPayPalOrderId(orderId, payPalOrderId) {
  await updateOrderPayPalOrderStatement.run(payPalOrderId, nowIso(), orderId)
  return await findOrderByIdStatement.get(orderId)
}

async function bindOrderToUserAccount(orderId, userId) {
  const timestamp = nowIso()
  await bindOrderToUserStatement.run(userId, timestamp, orderId)
  await bindDeploymentToUserStatement.run(userId, timestamp, orderId)
  await bindAgentInstanceToUserStatement.run(userId, timestamp, orderId)
  return await findOrderByIdStatement.get(orderId)
}

const { serializeAgentInstance, serializeDeployment, serializeOrder, serializePlan } =
  createSerializationHelpers({
    annualBillingMultiplier,
    buildMaskedTokenDisplay,
    decryptSecretValue,
    findDeploymentByOrderIdStatement,
    findLatestAgentInstanceByOrderIdStatement,
    formatMoney,
    getChannelById,
    getAgentMulticaVersion,
    getAgentUpgradeStatus,
    getConfiguredMulticaVersion,
    getModelById,
    getOrderIncludedDeployments,
    getReservedDeploymentCount,
    listDeploymentsByOrderIdStatement,
    resolvePlanSelection,
  })

function getDeploymentConsoleToken(row) {
  if (!row?.console_token_cipher_text || !row?.console_token_iv || !row?.console_token_tag) {
    return null
  }

  return decryptSecretValue({
    cipherText: row.console_token_cipher_text,
    iv: row.console_token_iv,
    tag: row.console_token_tag,
  })
}

async function updateDeploymentRecord(deploymentId, patch) {
  const current = await findDeploymentByIdStatement.get(deploymentId)
  if (!current) {
    throw new HttpError(404, 'Deployment not found.')
  }

  const nextConsoleToken =
    patch.consoleToken === undefined ? getDeploymentConsoleToken(current) : patch.consoleToken
  const encryptedConsoleToken = nextConsoleToken ? encryptSecretValue(nextConsoleToken) : null

  await updateDeploymentStatement.run(
    patch.status ?? current.status,
    patch.progress ?? current.progress,
    patch.workspacePath ?? current.workspace_path ?? null,
    patch.consoleUrl ?? current.console_url ?? null,
    patch.publicEndpoint ?? current.public_endpoint ?? null,
    patch.runtimeUser ?? current.runtime_user ?? null,
    patch.serviceName ?? current.service_name ?? null,
    encryptedConsoleToken?.cipherText ?? null,
    encryptedConsoleToken?.iv ?? null,
    encryptedConsoleToken?.tag ?? null,
    patch.lastMessage ?? current.last_message,
    patch.runLogs ?? current.run_logs,
    patch.startedAt ?? current.started_at ?? null,
    patch.finishedAt ?? current.finished_at ?? null,
    patch.updatedAt ?? nowIso(),
    deploymentId,
  )

  return await findDeploymentByIdStatement.get(deploymentId)
}

async function updateOrderDeploymentStatus(orderId, deploymentStatus, statusMessage) {
  await updateOrderDeploymentStatement.run(deploymentStatus, statusMessage, nowIso(), orderId)
  return await findOrderByIdStatement.get(orderId)
}

async function updateAgentUpgradeState(clawId, patch) {
  const current = await findAgentInstanceByIdStatement.get(clawId)
  if (!current) {
    throw new HttpError(404, 'GenericAgent workspace not found.')
  }

  await updateAgentUpgradeStatement.run(
    patch.multicaVersion ?? current.multica_version ?? null,
    patch.upgradeStatus ?? current.upgrade_status ?? 'idle',
    patch.upgradeTargetVersion ?? current.upgrade_target_version ?? null,
    patch.upgradeError ?? current.upgrade_error ?? null,
    patch.updatedAt ?? nowIso(),
    clawId,
  )

  return await findAgentInstanceByIdStatement.get(clawId)
}

async function updateAgentRuntimeState(clawId, runtimeState) {
  const current = await findAgentInstanceByIdStatement.get(clawId)
  if (!current) {
    throw new HttpError(404, 'GenericAgent workspace not found.')
  }

  await database.prepare(`
    UPDATE agent_instances
    SET runtime_state = ?, updated_at = ?
    WHERE id = ?
  `).run(runtimeState, nowIso(), clawId)

  return await findAgentInstanceByIdStatement.get(clawId)
}

async function upsertAgentInstance({
  orderId,
  deploymentId,
  userId,
  sequenceNumber,
  instanceName,
  modelId,
  channelId,
  status,
  targetServer,
  workspacePath,
  consoleUrl,
  publicEndpoint,
  runtimeUser,
  serviceName,
  runtimeState,
  multicaVersion,
}) {
  const existing = await database.prepare(`SELECT * FROM agent_instances WHERE deployment_id = ?`).get(deploymentId)
  const timestamp = nowIso()

  if (existing) {
    await updateAgentInstanceStatement.run(
      status,
      targetServer,
      workspacePath ?? null,
      consoleUrl ?? null,
      publicEndpoint ?? null,
      runtimeUser ?? null,
      serviceName ?? null,
      runtimeState ?? existing.runtime_state ?? (status === 'running' ? 'running' : null),
      multicaVersion ?? existing.multica_version ?? null,
      'idle',
      null,
      null,
      timestamp,
      deploymentId,
    )
    return await database.prepare(`SELECT * FROM agent_instances WHERE deployment_id = ?`).get(deploymentId)
  }

  await createAgentInstanceStatement.run(
    randomBytes(16).toString('hex'),
    orderId,
    deploymentId,
    userId,
    sequenceNumber,
    instanceName,
    modelId,
    channelId,
    status,
    targetServer,
    workspacePath ?? null,
    consoleUrl ?? null,
    publicEndpoint ?? null,
    runtimeUser ?? null,
    serviceName ?? null,
    runtimeState ?? (status === 'running' ? 'running' : null),
    multicaVersion ?? null,
    'idle',
    null,
    null,
    timestamp,
    timestamp,
  )

  return await database.prepare(`SELECT * FROM agent_instances WHERE deployment_id = ?`).get(deploymentId)
}

async function assertOrderAccess(context, order) {
  if (!order) {
    throw new HttpError(404, 'Order not found.')
  }

  if (context.kind === 'guest') {
    if (order.guest_token !== context.guestToken) {
      throw new HttpError(403, 'Order access denied.')
    }
    return
  }

  if (
    context.user.role !== 'admin' &&
    order.user_id !== context.user.id &&
    (!context.guestToken || order.guest_token !== context.guestToken)
  ) {
    throw new HttpError(403, 'Order access denied.')
  }
}

async function listVisibleOrders(context) {
  const rows =
    context.kind === 'guest'
      ? await listOrdersByGuestTokenStatement.all(context.guestToken)
      : context.user.role === 'admin'
        ? await listAllOrdersStatement.all()
        : [
            ...(await listOrdersByUserStatement.all(context.user.id)),
            ...(context.guestToken ? await listOrdersByGuestTokenStatement.all(context.guestToken) : []),
          ]

  const dedupedRows = Array.from(new Map(rows.map((row) => [row.id, row])).values())
  const reconciledRows = await Promise.all(dedupedRows.map((row) => reconcileOrderPayment(row)))
  return await Promise.all(reconciledRows.map((row) => serializeOrder(row, { viewerContext: context })))
}

async function listVisibleAgentInstances(context) {
  const rows =
    context.kind === 'guest'
      ? await listAgentInstancesByGuestTokenStatement.all(context.guestToken)
      : context.user.role === 'admin'
        ? await listAllAgentInstancesStatement.all()
        : [
            ...(await listAgentInstancesByUserStatement.all(context.user.id)),
            ...(context.guestToken ? await listAgentInstancesByGuestTokenStatement.all(context.guestToken) : []),
          ]

  return Array.from(new Map(rows.map((row) => [row.id, row])).values()).map(serializeAgentInstance)
}

function interpolateTemplate(template, values) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/gi, (_, key) => values[key] ?? '')
}

function parseStructuredDeploymentOutput(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index])
    } catch {
      continue
    }
  }

  return {}
}

async function runCommand(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, options)
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Workspace launch command exited with code ${code}.`))
        return
      }

      resolve({ stdout, stderr })
    })
  })
}

async function executeDeployment(context) {
  const configuredDeployment = getDeploymentRuntimeConfig()

  if (configuredDeployment.provider === 'mock' || configuredDeployment.provider === 'ssh') {
    return await executeConfiguredDeployment(configuredDeployment, context)
  }

  const templateValues = {
    INSTANCE_NAME: context.instanceName,
    MODEL_ID: context.order.model_id,
    CHANNEL_ID: context.order.channel_id,
    PLAN_ID: context.order.plan_id,
    USER_EMAIL: context.user.email,
    COMMUNICATION_TOKEN: context.communicationToken,
    ORDER_ID: context.order.id,
  }

  if (Array.isArray(deploymentCommandJson) && deploymentCommandJson.length > 0) {
    const [command, ...args] = deploymentCommandJson.map((value) =>
      interpolateTemplate(String(value), templateValues),
    )
    const result = await runCommand(command, args, {
      cwd: projectRoot,
      env: { ...process.env, ...templateValues },
      shell: false,
    })
    const parsed = parseStructuredDeploymentOutput(result.stdout)

    return {
      targetServer: parsed.targetServer ?? deploymentTargetServer,
      workspacePath:
        parsed.workspacePath ?? `/srv/multica/${context.instanceName}`,
      consoleUrl:
        parsed.consoleUrl ??
        `${deploymentConsoleBaseUrl.replace(/\/$/, '')}/${context.instanceName}`,
      publicEndpoint:
        parsed.publicEndpoint ??
        `${deploymentPublicBaseUrl.replace(/\/$/, '')}/${context.instanceName}`,
      runLogs: `${result.stdout}${result.stderr}`.trim(),
    }
  }

  if (deploymentCommand) {
    const commandText = interpolateTemplate(deploymentCommand, templateValues)
    const result = await runCommand(commandText, [], {
      cwd: projectRoot,
      env: { ...process.env, ...templateValues },
      shell: true,
    })
    const parsed = parseStructuredDeploymentOutput(result.stdout)

    return {
      targetServer: parsed.targetServer ?? deploymentTargetServer,
      workspacePath:
        parsed.workspacePath ?? `/srv/multica/${context.instanceName}`,
      consoleUrl:
        parsed.consoleUrl ??
        `${deploymentConsoleBaseUrl.replace(/\/$/, '')}/${context.instanceName}`,
      publicEndpoint:
        parsed.publicEndpoint ??
        `${deploymentPublicBaseUrl.replace(/\/$/, '')}/${context.instanceName}`,
      runLogs: `${result.stdout}${result.stderr}`.trim(),
    }
  }

  if (!allowSimulatedDeployment) {
    throw new HttpError(503, 'Workspace launch runner is not configured.')
  }

  await delay(2500)

  return {
    targetServer: deploymentTargetServer,
    workspacePath: `/srv/multica/${context.instanceName}`,
    consoleUrl: `${deploymentConsoleBaseUrl.replace(/\/$/, '')}/${context.instanceName}`,
    publicEndpoint: `${deploymentPublicBaseUrl.replace(/\/$/, '')}/${context.instanceName}`,
    runLogs: 'Simulated deployment completed successfully.',
  }
}

async function processDeployment(deploymentId) {
  if (activeDeploymentIds.has(deploymentId)) {
    return
  }

  activeDeploymentIds.add(deploymentId)

  try {
    const deployment = await findDeploymentByIdStatement.get(deploymentId)
    if (!deployment || deployment.status !== 'queued') {
      return
    }

    const order = await findOrderByIdStatement.get(deployment.order_id)
    const user = await findUserByIdStatement.get(deployment.user_id)
    if (!order || !user) {
      throw new HttpError(404, 'Deployment context is incomplete.')
    }

    await updateDeploymentRecord(deploymentId, {
      status: 'provisioning',
      progress: 20,
      lastMessage: 'Payment captured. Preparing GenericAgent workspace.',
      startedAt: nowIso(),
      updatedAt: nowIso(),
    })
    await updateOrderDeploymentStatus(order.id, 'provisioning', 'Provisioning started. Preparing your GenericAgent workspace.')

    const communicationToken = decryptSecretValue({
      cipherText: order.token_cipher_text,
      iv: order.token_iv,
      tag: order.token_tag,
    })

    await updateDeploymentRecord(deploymentId, {
      progress: 55,
      lastMessage: 'Connecting to the deployment target and applying GenericAgent config.',
      updatedAt: nowIso(),
    })

    const deploymentResult = await executeDeployment({
      order,
      user,
      instanceName: deployment.instance_name,
      communicationToken,
    })

    const completedAt = nowIso()

    await updateDeploymentRecord(deploymentId, {
      status: 'deployed',
      progress: 100,
      workspacePath: deploymentResult.workspacePath,
      consoleUrl: deploymentResult.consoleUrl,
      publicEndpoint: deploymentResult.publicEndpoint,
      consoleToken: deploymentResult.consoleToken,
      runtimeUser: deploymentResult.runtimeUser,
      serviceName: deploymentResult.serviceName,
      lastMessage: 'Provisioning completed. GenericAgent is ready in the console.',
      runLogs: deploymentResult.runLogs,
      finishedAt: completedAt,
      updatedAt: completedAt,
    })

    await upsertAgentInstance({
      orderId: order.id,
      deploymentId,
      userId: user.id,
      sequenceNumber: deployment.sequence_number,
      instanceName: deployment.instance_name,
      modelId: order.model_id,
      channelId: order.channel_id,
      status: 'running',
      targetServer: deploymentResult.targetServer,
      workspacePath: deploymentResult.workspacePath,
      consoleUrl: deploymentResult.consoleUrl,
      publicEndpoint: deploymentResult.publicEndpoint,
      runtimeUser: deploymentResult.runtimeUser,
      serviceName: deploymentResult.serviceName,
      multicaVersion: deploymentResult.multicaVersion,
    })

    await updateOrderDeploymentStatus(
      order.id,
      'deployed',
      'Provisioning finished. GenericAgent is live and visible in the console.',
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provisioning failed.'
    const current = await findDeploymentByIdStatement.get(deploymentId)
    if (current) {
      const errorDetails = error && typeof error === 'object' ? error : null
      const workspacePath = errorDetails?.workspacePath ?? current.workspace_path
      const runtimeUser = errorDetails?.runtimeUser ?? current.runtime_user
      const serviceName = errorDetails?.serviceName ?? current.service_name
      const multicaVersion = errorDetails?.multicaVersion ?? current.multica_version
      await updateDeploymentRecord(deploymentId, {
        status: 'failed',
        progress: current.progress,
        workspacePath,
        consoleUrl: null,
        publicEndpoint: null,
        runtimeUser,
        serviceName,
        lastMessage: message,
        runLogs: `${current.run_logs}\n${message}`.trim(),
        finishedAt: nowIso(),
        updatedAt: nowIso(),
      })
      await updateOrderDeploymentStatus(
        current.order_id,
        'failed',
        `Deployment failed: ${message}`,
      )
      const orderForFailure = await findOrderByIdStatement.get(current.order_id)
      await upsertAgentInstance({
        orderId: current.order_id,
        deploymentId,
        userId: current.user_id,
        sequenceNumber: current.sequence_number,
        instanceName: current.instance_name,
        modelId: orderForFailure.model_id,
        channelId: orderForFailure.channel_id,
        status: 'failed',
        targetServer: current.target_server,
        workspacePath,
        consoleUrl: null,
        publicEndpoint: null,
        runtimeUser,
        serviceName,
        runtimeState: 'failed',
        multicaVersion,
      })
    }
  } finally {
    activeDeploymentIds.delete(deploymentId)
  }
}

async function upgradeMulticaInstance(order, targetVersion) {
  if (order.payment_status !== 'paid') {
    throw new HttpError(400, 'Pay for this order before upgrading GenericAgent.')
  }

  const claw = await findLatestAgentInstanceByOrderIdStatement.get(order.id)
  if (!claw) {
    throw new HttpError(400, 'GenericAgent is not provisioned yet.')
  }

  if (!claw.workspace_path || !claw.runtime_user || !claw.service_name) {
    throw new HttpError(400, 'GenericAgent runtime metadata is incomplete. Re-provision the workspace first.')
  }

  if (getAgentUpgradeStatus(claw) === 'in_progress') {
    throw new HttpError(409, 'GenericAgent upgrade is already in progress.')
  }

  const normalizedVersion = String(targetVersion ?? '').trim()
  if (!normalizedVersion) {
    throw new HttpError(400, 'Choose a target GenericAgent version first.')
  }

  const config = getDeploymentRuntimeConfig()
  await updateAgentUpgradeState(claw.id, {
    upgradeStatus: 'in_progress',
    upgradeTargetVersion: normalizedVersion,
    upgradeError: null,
    updatedAt: nowIso(),
  })
  await updateOrderDeploymentStatus(order.id, order.deployment_status, `Upgrading GenericAgent to ${normalizedVersion}.`)

  try {
    const result = await upgradeConfiguredDeployment(config, {
      instanceName: claw.instance_name,
      workspacePath: claw.workspace_path,
      runtimeUser: claw.runtime_user,
      serviceName: claw.service_name,
      targetServer: claw.target_server,
      targetVersion: normalizedVersion,
    })

    await upsertAgentInstance({
      orderId: claw.order_id,
      deploymentId: claw.deployment_id,
      userId: claw.user_id,
      sequenceNumber: claw.sequence_number,
      instanceName: claw.instance_name,
      modelId: claw.model_id,
      channelId: claw.channel_id,
      status: 'running',
      targetServer: result.targetServer ?? claw.target_server,
      workspacePath: result.workspacePath ?? claw.workspace_path,
      consoleUrl: claw.console_url,
      publicEndpoint: claw.public_endpoint,
      runtimeUser: result.runtimeUser ?? claw.runtime_user,
      serviceName: result.serviceName ?? claw.service_name,
      multicaVersion: result.multicaVersion ?? normalizedVersion,
    })

    await updateAgentUpgradeState(claw.id, {
      multicaVersion: result.multicaVersion ?? normalizedVersion,
      upgradeStatus: 'idle',
      upgradeTargetVersion: null,
      upgradeError: null,
      updatedAt: nowIso(),
    })
    await updateOrderDeploymentStatus(order.id, order.deployment_status, `GenericAgent upgraded to ${normalizedVersion}.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GenericAgent upgrade failed.'
    await updateAgentUpgradeState(claw.id, {
      upgradeStatus: 'failed',
      upgradeTargetVersion: normalizedVersion,
      upgradeError: message,
      updatedAt: nowIso(),
    })
    await updateOrderDeploymentStatus(order.id, order.deployment_status, `GenericAgent upgrade failed: ${message}`)
    throw error
  }

  return await findOrderByIdStatement.get(order.id)
}

async function refreshOrderDeploymentAfterInstanceRemoval(order) {
  const latestDeployment = await findDeploymentByOrderIdStatement.get(order.id)

  if (latestDeployment) {
    await updateOrderDeploymentStatus(
      order.id,
      latestDeployment.status,
      latestDeployment.last_message || 'Latest GenericAgent record is available in the console.',
    )
    return
  }

  if (order.payment_status === 'paid') {
    await updateOrderDeploymentStatus(order.id, 'failed', 'GenericAgent was uninstalled. Create a new workspace to provision again.')
    return
  }

  await updateOrderDeploymentStatus(order.id, 'pending_payment', 'Waiting for payment before GenericAgent can be launched.')
}

async function stopMulticaInstance(order) {
  if (order.payment_status !== 'paid') {
    throw new HttpError(400, 'Pay for this order before managing GenericAgent.')
  }

  const claw = await findLatestAgentInstanceByOrderIdStatement.get(order.id)
  if (!claw) {
    throw new HttpError(400, 'GenericAgent is not provisioned yet.')
  }

  if (!claw.runtime_user || !claw.service_name || !claw.workspace_path) {
    throw new HttpError(400, 'GenericAgent runtime metadata is incomplete. Re-provision the workspace first.')
  }

  if ((claw.runtime_state ?? (claw.status === 'running' ? 'running' : null)) === 'stopped') {
    return await findOrderByIdStatement.get(order.id)
  }

  const config = getDeploymentRuntimeConfig()
  const result = await stopConfiguredDeployment(config, {
    instanceName: claw.instance_name,
    workspacePath: claw.workspace_path,
    runtimeUser: claw.runtime_user,
    serviceName: claw.service_name,
    targetServer: claw.target_server,
    consoleUrl: claw.console_url,
  })

  await updateAgentRuntimeState(claw.id, result.runtimeState ?? 'stopped')
  await updateOrderDeploymentStatus(order.id, order.deployment_status, 'GenericAgent stopped. You can still uninstall or re-provision it later.')

  return await findOrderByIdStatement.get(order.id)
}

async function uninstallMulticaInstance(order) {
  if (order.payment_status !== 'paid') {
    throw new HttpError(400, 'Pay for this order before managing GenericAgent.')
  }

  const claw = await findLatestAgentInstanceByOrderIdStatement.get(order.id)
  if (!claw) {
    throw new HttpError(400, 'GenericAgent is not provisioned yet.')
  }

  const config = getDeploymentRuntimeConfig()
  const clawsToRemove =
    claw.status === 'failed'
      ? await listAgentInstancesByOrderIdStatement.all(order.id)
      : [claw]

  for (const item of clawsToRemove) {
    await uninstallConfiguredDeployment(config, {
      instanceName: item.instance_name,
      workspacePath: item.workspace_path,
      runtimeUser: item.runtime_user,
      serviceName: item.service_name,
      targetServer: item.target_server,
      consoleUrl: item.console_url,
    })

    await deleteAgentInstanceByIdStatement.run(item.id)
    await deleteDeploymentByIdStatement.run(item.deployment_id)
  }

  await refreshOrderDeploymentAfterInstanceRemoval(order)

  return await findOrderByIdStatement.get(order.id)
}

async function deletePendingOrder(order) {
  if (order.payment_status !== 'pending') {
    throw new HttpError(400, 'Only unpaid orders can be deleted.')
  }

  if ((await findDeploymentByOrderIdStatement.get(order.id)) || (await findLatestAgentInstanceByOrderIdStatement.get(order.id))) {
    throw new HttpError(400, 'This order already has deployment records and cannot be deleted.')
  }

  await deleteOrderByIdStatement.run(order.id)
}

function runBackgroundTask(task, label) {
  void task().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(`[background:${label}] ${message}`)
  })
}

async function pumpDeploymentQueue() {
  if (process.env.MULTICA_DEPLOYMENT_MODE === 'manual') {
    return
  }

  const queuedDeployments = await listQueuedDeploymentsStatement.all()

  for (const deployment of queuedDeployments) {
    if (activeDeploymentIds.size >= 2) {
      break
    }

    if (!activeDeploymentIds.has(deployment.id)) {
      runBackgroundTask(() => processDeployment(deployment.id), `processDeployment:${deployment.id}`)
    }
  }
}

const { enforceRateLimit, readJsonBody, readTextBody, sendJson } = createHttpHelpers({
  bodyLimitBytes,
  HttpError,
})

const {
  applyCorsHeaders,
  applySecurityHeaders,
  canUseCreemHostedReturnUrl,
  getConfiguredAppOrigins,
  getCreemReturnOrigin,
  getPublicAppOrigin,
  verifyOrigin,
} = createSecurityHelpers({
  appOriginValue: process.env.APP_ORIGIN ?? '',
  getAbsoluteRequestOrigin,
  HttpError,
})

const {
  capturePayPalOrder,
  createCreemCheckoutForOrder,
  createPayPalOrderForOrder,
  getCreemCheckoutId,
  getCreemCheckoutSession,
  getCreemCheckoutUrl,
  getCreemWebhookEventType,
  getCreemWebhookOrderId,
  getPayPalCheckoutUrl,
  handlePayPalWebhook,
  reconcileOrderPayment,
  verifyCreemRedirectSignature,
  verifyCreemWebhookSignature,
  verifyPayPalWebhookSignature,
} = createPaymentHelpers({
  canUseCreemHostedReturnUrl,
  creemApiKey,
  creemBaseUrl,
  creemIsTestMode,
  findCreemProductStatement,
  findOrderByIdStatement,
  findOrderByPayPalOrderIdStatement,
  findUserByIdStatement,
  formatMoney,
  getCreemReturnOrigin,
  getPublicAppOrigin,
  guestUserEmail,
  HttpError,
  nowIso,
  payPalBaseUrls,
  payPalBaseUrlOverride,
  payPalClientId,
  payPalEnvironment,
  payPalResolvedBaseUrl,
  payPalSecret,
  payPalWebhookId,
  queuePaidOrder,
  resolvePlanSelection,
  setOrderCheckoutId,
  setOrderPayPalOrderId,
  upsertCreemProductStatement,
})

const {
  clearSessionCookie,
  createSessionForUser,
  getAuthenticatedContext,
  getGuestToken,
  parseCookies,
  hashSessionToken,
  requireAdminUser,
  requireAuthenticatedUser,
  requireOrderAccessContext,
  setGuestCookie,
  setSessionCookie,
} = createSessionHelpers({
  createSessionStatement,
  deleteSessionByHashStatement,
  deleteUserSessionsStatement,
  findSessionStatement,
  guestCookieName,
  guestTtlMs,
  HttpError,
  isProduction,
  nowIso,
  randomBytes,
  serializeUser,
  sessionCookieName,
  sessionTtlMs,
  updateSessionSeenStatement,
})

const { getAdminAnalyticsSessionDetail, getAdminAnalyticsSummary, ingestAnalyticsEvents, listAdminAnalyticsSessions } =
  createAnalyticsHelpers({
    analyticsRateLimiter,
    assertOrderAccess,
    countAnalyticsSessionsSinceStatement,
    countDistinctAnalyticsSessionsByEventNameSinceStatement,
    countDistinctAnalyticsSessionsByPagePathSinceStatement,
    countDistinctAnalyticsSessionsBySectionSinceStatement,
    countDistinctAnalyticsVisitorsSinceStatement,
    createAnalyticsEventStatement,
    enforceRateLimit,
    findAnalyticsSessionByIdStatement,
    findOrderByIdStatement,
    getAuthenticatedContext,
    getGuestToken,
    listAnalyticsDropOffStagesSinceStatement,
    listAnalyticsEventsBySessionIdStatement,
    listAnalyticsSessionsSinceStatement,
    listAnalyticsTopCtaClicksSinceStatement,
    listAnalyticsTopReferrersSinceStatement,
    nowIso,
    readJsonBody,
    requireAdminUser,
    sumAnalyticsSessionMetricsSinceStatement,
    createAnalyticsSessionStatement,
    updateAnalyticsSessionStatement,
  })

const apiRouter = createApiRouter({
  HttpError,
  appEnvironment,
  annualBillingMultiplier,
  assertOrderAccess,
  bindOrderToUserAccount,
  buildOrderNumber,
  createMulticaConsoleSessionUrl,
  canTriggerDeployment,
  capturePayPalOrder,
  channelCatalog,
  clearSessionCookie,
  deletePendingOrder,
  countRemainingAdminsStatement,
  countUsersStatement,
  createDeploymentForOrder,
  createCreemCheckoutForOrder,
  createOrderStatement,
  createPayPalOrderForOrder,
  createSessionForUser,
  createUserRecord,
  deleteSessionByHashStatement,
  deleteUserSessionsStatement,
  encryptSecretValue,
  enforceRateLimit,
  ensureGuestUser,
  getAdminAnalyticsSessionDetail,
  getAdminAnalyticsSummary,
  findAgentInstanceByDeploymentIdStatement,
  findDeploymentByIdStatement,
  findDeploymentByOrderIdStatement,
  findAnalyticsSessionByIdStatement,
  findLatestAgentInstanceByOrderIdStatement,
  findOrderByIdStatement,
  findUserByEmailStatement,
  findUserByIdStatement,
  getAuthenticatedContext,
  getChannelById,
  getAgentMulticaVersion,
  getConfiguredUserRole,
  getCreemCheckoutId,
  getCreemCheckoutSession,
  getCreemCheckoutUrl,
  getCreemWebhookEventType,
  getCreemWebhookOrderId,
  getDeploymentConsoleToken,
  getDeploymentRuntimeConfig,
  getPaidOrderTriggerMode,
  getGuestToken,
  getModelById,
  getPayPalCheckoutUrl,
  getPublicAppOrigin,
  handlePayPalWebhook,
  hashSessionToken,
  ingestAnalyticsEvents,
  isProduction,
  listConfiguredMulticaVersions,
  listAdminAnalyticsSessions,
  listUsersStatement,
  listVisibleAgentInstances,
  listVisibleOrders,
  loginRateLimiter,
  modelCatalog,
  normalizeEmail,
  nowIso,
  paymentProvider,
  payPalClientId,
  planCatalog,
  proxyModelRequest,
  queuePaidOrder,
  randomBytes,
  readJsonBody,
  readTextBody,
  reconcileOrderPayment,
  registerRateLimiter,
  requireAdminUser,
  requireAuthenticatedUser,
  requireOrderAccessContext,
  resolvePlanSelection,
  sanitizeName,
  sendJson,
  serializeOrder,
  serializePlan,
  serializeUser,
  setGuestCookie,
  setOrderCheckoutId,
  setOrderPayPalOrderId,
  setSessionCookie,
  stopMulticaInstance,
  syncUserRoleWithAdminConfig,
  uninstallMulticaInstance,
  updateUserLastLoginStatement,
  updateUserStatement,
  upgradeMulticaInstance,
  validateCommunicationToken,
  validateName,
  verifyCreemRedirectSignature,
  verifyCreemWebhookSignature,
  verifyOrigin,
  verifyPassword,
  verifyPayPalWebhookSignature,
})

async function handleApiRequest(request, response) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (!requestUrl.pathname.startsWith('/api/')) {
    return false
  }

  if (request.method === 'OPTIONS') {
    response.statusCode = 204
    response.end()
    return true
  }

  verifyOrigin(request)
  return await apiRouter.handle({ request, response, requestUrl })
}

async function handleGenericAgentNodeRequest(request, response) {
  applySecurityHeaders(response)
  applyCorsHeaders(request, response)
  void cleanupExpiredSessions()
  cleanupExpiredMulticaConsoleSessions()

  try {
    if (await handleMulticaConsoleProxyRequest(request, response)) {
      return
    }

    if (await handleApiRequest(request, response)) {
      return
    }

    if (viteServer) {
      viteServer.middlewares(request, response, () => {
        sendJson(response, 404, { message: 'Not found.' })
      })
      return
    }

    serveProductionAsset(request, response)
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.statusCode, { message: error.message })
      return
    }

    console.error(error)
    sendJson(response, 500, { message: 'Internal server error.' })
  }
}

export async function handleGenericAgentApiRequest(request, response) {
  applySecurityHeaders(response)
  applyCorsHeaders(request, response)
  void cleanupExpiredSessions()
  cleanupExpiredMulticaConsoleSessions()

  try {
    if (await handleApiRequest(request, response)) {
      return
    }

    sendJson(response, 404, { message: 'Not found.' })
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.statusCode, { message: error.message })
      return
    }

    console.error(error)
    sendJson(response, 500, { message: 'Internal server error.' })
  }
}

const server = shouldStartHttpServer ? createServer(handleGenericAgentNodeRequest) : null

if (server) {
  server.on('upgrade', (request, socket, head) => {
    void handleMulticaConsoleProxyUpgrade(request, socket, head)
  })
}

export const serverReady = shouldStartHttpServer
  ? new Promise((resolve) => {
      server.listen(port, () => {
        console.log(
          `GenericAgent server running on http://localhost:${port} using ${databaseProvider} database ${databaseIdentity}`,
        )
        resolve()
      })
    })
  : Promise.resolve()

const deploymentPumpInterval = shouldStartHttpServer
  ? setInterval(() => {
      runBackgroundTask(() => pumpDeploymentQueue(), 'pumpDeploymentQueue:interval')
    }, deploymentPollIntervalMs)
  : null

if (shouldStartHttpServer) {
  runBackgroundTask(() => pumpDeploymentQueue(), 'pumpDeploymentQueue:startup')
}

let didStopServer = false

export async function stopMulticaLaunchServer() {
  if (didStopServer) {
    return
  }

  didStopServer = true
  if (deploymentPumpInterval) {
    clearInterval(deploymentPumpInterval)
  }

  if (server) {
    await new Promise((resolve) => server.close(() => resolve()))
  }
  await database.close()

  if (viteServer?.close) {
    await viteServer.close()
  }
}

function getMimeType(filePath) {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.ico':
      return 'image/x-icon'
    case '.png':
      return 'image/png'
    default:
      return 'application/octet-stream'
  }
}

function normalizeSeoPathname(pathname) {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function replaceHeadTag(html, pattern, replacement) {
  if (pattern.test(html)) {
    return html.replace(pattern, replacement)
  }

  return html.replace('</head>', `    ${replacement}\n  </head>`)
}

function getServerSeoConfig(request, pathname) {
  const normalizedPath = normalizeSeoPathname(pathname)
  const origin = getPublicAppOrigin(request)
  const canonicalUrl = new URL(normalizedPath, `${origin}/`).toString()
  const page = serverSeoPageMap.get(normalizedPath)

  if (page) {
    return {
      ...page,
      canonicalUrl,
    }
  }

  return {
    title: 'Page not found | GenericAgent',
    description:
      'This GenericAgent page could not be matched to a public marketing route. Return to the homepage to continue.',
    robots: 'noindex,nofollow',
    canonicalUrl,
  }
}

function renderSeoHtml(request, pathname, templateHtml) {
  const seo = getServerSeoConfig(request, pathname)

  let html = templateHtml
  html = replaceHeadTag(html, /<title>[\s\S]*?<\/title>/i, `<title>${escapeHtmlAttribute(seo.title)}</title>`)
  html = replaceHeadTag(
    html,
    /<meta\s+name="description"[^>]*>/i,
    `<meta name="description" content="${escapeHtmlAttribute(seo.description)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+name="robots"[^>]*>/i,
    `<meta name="robots" content="${escapeHtmlAttribute(seo.robots)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<link\s+rel="canonical"[^>]*>/i,
    `<link rel="canonical" href="${escapeHtmlAttribute(seo.canonicalUrl)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+property="og:title"[^>]*>/i,
    `<meta property="og:title" content="${escapeHtmlAttribute(seo.title)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+property="og:description"[^>]*>/i,
    `<meta property="og:description" content="${escapeHtmlAttribute(seo.description)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+property="og:url"[^>]*>/i,
    `<meta property="og:url" content="${escapeHtmlAttribute(seo.canonicalUrl)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+name="twitter:title"[^>]*>/i,
    `<meta name="twitter:title" content="${escapeHtmlAttribute(seo.title)}" />`,
  )
  html = replaceHeadTag(
    html,
    /<meta\s+name="twitter:description"[^>]*>/i,
    `<meta name="twitter:description" content="${escapeHtmlAttribute(seo.description)}" />`,
  )

  return html
}

function isHtmlPageRequest(request, requestUrl) {
  if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
    return false
  }

  if (extname(requestUrl.pathname)) {
    return false
  }

  return String(request.headers.accept ?? '').includes('text/html')
}

function sendFile(response, filePath) {
  const body = readFileSync(filePath)
  response.statusCode = 200
  response.setHeader('Content-Type', getMimeType(filePath))
  response.setHeader('Content-Length', body.length)
  response.setHeader('Cache-Control', filePath.endsWith('index.html') ? 'no-store' : 'no-cache')
  response.end(body)
}

function serveProductionAsset(request, response) {
  if (!existsSync(distDirectory)) {
    throw new HttpError(503, 'Build output is missing. Run npm run build first.')
  }

  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (isHtmlPageRequest(request, requestUrl)) {
    const templateHtml = readFileSync(join(distDirectory, 'index.html'), 'utf8')
    const body = renderSeoHtml(request, requestUrl.pathname, templateHtml)
    response.statusCode = 200
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.setHeader('Content-Length', Buffer.byteLength(body))
    response.setHeader('Cache-Control', 'no-store')

    if (request.method === 'HEAD') {
      response.end()
      return
    }

    response.end(body)
    return
  }

  const relativePath = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.replace(/^\/+/, '')
  const resolvedPath = normalize(join(distDirectory, relativePath))
  const normalizedDistDirectory = normalize(distDirectory)

  if (!resolvedPath.startsWith(normalizedDistDirectory)) {
    throw new HttpError(403, 'Invalid asset path.')
  }

  if (existsSync(resolvedPath) && statSync(resolvedPath).isFile()) {
    sendFile(response, resolvedPath)
    return
  }

  sendFile(response, join(distDirectory, 'index.html'))
}
