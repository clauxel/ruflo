import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { Client } from 'ssh2'
import { loadLocalEnvironment } from '../server-lib/env-loader.mjs'

const scriptProjectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaultServiceName = 'multica.service'
const defaultRemoteEnvFile = '/data/multica/multica.env'
const defaultDays = 30
const defaultAnalyticsSecretPath = 'data/secrets/genericagent-analytics-db-password.dpapi'
const defaultCloudflareD1DatabaseName = 'ruflo'
const defaultAnalyticsDatabase = {
  project: 'neon-cordovan-zebra',
  host: 'ep-bitter-brook-am2gjcic-pooler.c-5.us-east-1.aws.neon.tech',
  database: 'neondb',
  user: 'neondb_owner',
  port: 5432,
  sslMode: 'require',
  enableChannelBinding: true,
}
const knownKeyCandidates = [
  '.ssh/multicaLaunch_prod_205_key',
  '.ssh/multica_prod_205_key',
  '.ssh/cw_ed25519',
  '.ssh/id_ed25519',
  '.ssh/id_rsa',
]
const directReferrerSentinel = '(direct)'
const directReferrerLabel = 'direct / no referrer'

function resolveRuntimeMode(argv = process.argv, environment = process.env) {
  const modeIndex = argv.indexOf('--mode')
  if (modeIndex >= 0 && argv[modeIndex + 1]) {
    return argv[modeIndex + 1]
  }

  return environment.NODE_ENV === 'development' ? 'development' : 'production'
}

function printUsage() {
  console.log(`Usage:
  node scripts/inspect-production-analytics.mjs [options]

Options:
  --days <n>                 Analytics window in days. Default: ${defaultDays}
  --format <text|json>       Output format. Default: text
  --output <path>            Write the report to a file
  --origin <url>             Public site origin to health-check
  --cloudflare-d1            Query the Cloudflare D1 production database via Wrangler
  --d1-database <name>       Cloudflare D1 database name. Default: ${defaultCloudflareD1DatabaseName}
  --service <name>           Systemd service name. Default: ${defaultServiceName}
  --remote-env-file <path>   Remote env file path. Default: ${defaultRemoteEnvFile}
  --local-db                 Query GenericAgent Neon/local PostgreSQL from environment instead of SSH
  --secret-file <path>       DPAPI-encrypted password file. Default: ${defaultAnalyticsSecretPath}
  --ssh-host <host>          Override SSH host
  --ssh-port <port>          Override SSH port
  --ssh-user <user>          Override SSH username
  --ssh-key-path <path>      Override SSH private key path
  --ssh-password <value>     Override SSH password
  --skip-health              Skip service and public site health checks
  --skip-analytics           Skip PostgreSQL analytics queries
  --skip-request-logs        Skip Nginx access log analysis
  --help                     Show this help
`)
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parseArguments(argv = process.argv.slice(2)) {
  const options = {
    days: defaultDays,
    format: 'text',
    outputPath: '',
    origin: '',
    cloudflareD1: false,
    d1Database: '',
    serviceName: defaultServiceName,
    remoteEnvFile: '',
    localDb: false,
    secretFile: defaultAnalyticsSecretPath,
    sshHost: '',
    sshPort: 0,
    sshUser: '',
    sshKeyPath: '',
    sshPassword: '',
    skipHealth: false,
    skipAnalytics: false,
    skipRequestLogs: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const next = argv[index + 1]

    switch (token) {
      case '--days':
        options.days = parseInteger(next, defaultDays)
        index += 1
        break
      case '--format':
        options.format = String(next ?? '').trim().toLowerCase() === 'json' ? 'json' : 'text'
        index += 1
        break
      case '--output':
        options.outputPath = String(next ?? '').trim()
        index += 1
        break
      case '--origin':
        options.origin = String(next ?? '').trim()
        index += 1
        break
      case '--cloudflare-d1':
        options.cloudflareD1 = true
        break
      case '--d1-database':
        options.d1Database = String(next ?? '').trim()
        index += 1
        break
      case '--service':
        options.serviceName = String(next ?? '').trim() || defaultServiceName
        index += 1
        break
      case '--remote-env-file':
        options.remoteEnvFile = String(next ?? '').trim()
        index += 1
        break
      case '--local-db':
        options.localDb = true
        break
      case '--secret-file':
        options.secretFile = String(next ?? '').trim() || defaultAnalyticsSecretPath
        index += 1
        break
      case '--ssh-host':
        options.sshHost = String(next ?? '').trim()
        index += 1
        break
      case '--ssh-port':
        options.sshPort = parseInteger(next, 0)
        index += 1
        break
      case '--ssh-user':
        options.sshUser = String(next ?? '').trim()
        index += 1
        break
      case '--ssh-key-path':
        options.sshKeyPath = String(next ?? '').trim()
        index += 1
        break
      case '--ssh-password':
        options.sshPassword = String(next ?? '').trim()
        index += 1
        break
      case '--skip-health':
        options.skipHealth = true
        break
      case '--skip-analytics':
        options.skipAnalytics = true
        break
      case '--skip-request-logs':
        options.skipRequestLogs = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        if (token.startsWith('--')) {
          throw new Error(`Unknown argument: ${token}`)
        }
        break
    }
  }

  if (options.cloudflareD1 && options.localDb) {
    throw new Error('Use either --cloudflare-d1 or --local-db, not both.')
  }

  return options
}

function firstDefined(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function sqlTextLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`
}

function resolveProjectPath(projectRoot, candidate) {
  if (!candidate) {
    return ''
  }

  return isAbsolute(candidate) ? candidate : resolve(projectRoot, candidate)
}

function readDpapiSecretFile(filePath) {
  if (!filePath || !existsSync(filePath) || process.platform !== 'win32') {
    return ''
  }

  try {
    const script = [
      '$raw = (Get-Content -Raw -LiteralPath $env:GENERICAGENT_ANALYTICS_SECRET_FILE).Trim()',
      '$secure = ConvertTo-SecureString $raw',
      "$credential = [pscredential]::new('secret', $secure)",
      '$credential.GetNetworkCredential().Password',
    ].join('; ')

    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          GENERICAGENT_ANALYTICS_SECRET_FILE: filePath,
        },
        windowsHide: true,
      },
    ).trim()
  } catch {
    return ''
  }
}

function resolvePublicOrigin(appOriginValue, overrideOrigin) {
  if (overrideOrigin?.trim()) {
    return overrideOrigin.trim()
  }

  const candidates = String(appOriginValue ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  for (const candidate of candidates) {
    if (/^https?:\/\//i.test(candidate)) {
      return candidate
    }
  }

  return candidates[0] ?? ''
}

function normalizeSslConfig(environment, sslModeOverride = '') {
  const sslMode = firstDefined(
    sslModeOverride,
    environment.MULTICA_POSTGRES_SSLMODE,
    environment.PGSSLMODE,
    environment.POSTGRES_SSLMODE,
  ).toLowerCase()
  if (!sslMode || sslMode === 'disable') {
    return undefined
  }

  if (sslMode === 'require' || sslMode === 'prefer') {
    return {
      rejectUnauthorized: false,
    }
  }

  return undefined
}

function buildIdentityFromUrl(parsedUrl) {
  const user = decodeURIComponent(parsedUrl.username || 'postgres')
  const database = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, '') || 'postgres')
  const port = parsedUrl.port || '5432'

  return `${user}@${parsedUrl.hostname}:${port}/${database}`
}

function parsePostgresConnectionUrl(rawUrl, environment) {
  let parsedUrl
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    throw new Error('Invalid PostgreSQL connection URL.')
  }

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
    throw new Error('PostgreSQL connection URL must use postgres:// or postgresql://.')
  }

  return {
    host: parsedUrl.hostname,
    database: decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, '') || 'postgres'),
    user: decodeURIComponent(parsedUrl.username || 'postgres'),
    password: decodeURIComponent(parsedUrl.password || ''),
    port: parseInteger(parsedUrl.port || '5432', 5432),
    ssl: normalizeSslConfig(environment, parsedUrl.searchParams.get('sslmode') ?? ''),
    enableChannelBinding: parsedUrl.searchParams.get('channel_binding') === 'require',
    identity: buildIdentityFromUrl(parsedUrl),
  }
}

function resolveLocalPostgresConfig({
  environment = process.env,
  projectRoot = scriptProjectRoot,
  secretFile = defaultAnalyticsSecretPath,
} = {}) {
  const siteSpecificUrl = firstDefined(
    environment.GENERICAGENT_ANALYTICS_DATABASE_URL,
    environment.GENERICAGENT_ANALYTICS_POSTGRES_URL,
  )
  if (siteSpecificUrl) {
    return parsePostgresConnectionUrl(siteSpecificUrl, environment)
  }

  const dpapiPassword = readDpapiSecretFile(resolveProjectPath(projectRoot, secretFile))
  const genericUrl = firstDefined(
    environment.DATABASE_URL,
    environment.POSTGRES_URL,
    environment.POSTGRES_PRISMA_URL,
    environment.MULTICA_POSTGRES_URL,
  )
  const siteSpecificDiscreteConfig = firstDefined(
    environment.GENERICAGENT_ANALYTICS_DB_HOST,
    environment.GENERICAGENT_ANALYTICS_DB_NAME,
    environment.GENERICAGENT_ANALYTICS_DB_USER,
    environment.GENERICAGENT_ANALYTICS_DB_PASSWORD,
    environment.GENERICAGENT_ANALYTICS_DB_PORT,
  )
  if (!dpapiPassword && !siteSpecificDiscreteConfig && genericUrl) {
    return parsePostgresConnectionUrl(genericUrl, environment)
  }

  const host = firstDefined(environment.GENERICAGENT_ANALYTICS_DB_HOST, defaultAnalyticsDatabase.host)
  const database = firstDefined(environment.GENERICAGENT_ANALYTICS_DB_NAME, defaultAnalyticsDatabase.database)
  const user = firstDefined(environment.GENERICAGENT_ANALYTICS_DB_USER, defaultAnalyticsDatabase.user)
  const password = firstDefined(
    environment.GENERICAGENT_ANALYTICS_DB_PASSWORD,
    dpapiPassword,
    environment.PGPASSWORD,
    environment.POSTGRES_PASSWORD,
  )
  const port = parseInteger(
    firstDefined(
      environment.GENERICAGENT_ANALYTICS_DB_PORT,
      String(defaultAnalyticsDatabase.port),
    ),
    5432,
  )

  if (!host || !database || !user || !password) {
    throw new Error(
      `Missing PostgreSQL password for ${defaultAnalyticsDatabase.project}. Set GENERICAGENT_ANALYTICS_DB_PASSWORD, PGPASSWORD, DATABASE_URL, or POSTGRES_URL.`,
    )
  }

  return {
    host,
    database,
    user,
    password,
    port,
    ssl: normalizeSslConfig(
      environment,
      firstDefined(environment.GENERICAGENT_ANALYTICS_DB_SSLMODE, defaultAnalyticsDatabase.sslMode),
    ),
    enableChannelBinding: defaultAnalyticsDatabase.enableChannelBinding,
    identity: `${user}@${host}:${port}/${database}`,
  }
}

function parseEnvironmentFileFromServiceUnit(serviceDefinition) {
  const lines = String(serviceDefinition ?? '').split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('EnvironmentFile=')) {
      continue
    }

    const rawValue = trimmed.slice('EnvironmentFile='.length).trim()
    if (!rawValue) {
      continue
    }

    return rawValue.startsWith('-') ? rawValue.slice(1) : rawValue
  }

  return ''
}

function detectDefaultSshKeyPath() {
  for (const candidate of knownKeyCandidates) {
    const resolvedPath = resolve(homedir(), candidate)
    if (existsSync(resolvedPath)) {
      return resolvedPath
    }
  }

  return ''
}

function resolveSshConfig({
  projectRoot,
  options,
  environment = process.env,
}) {
  const configuredKeyPath =
    resolveProjectPath(projectRoot, options.sshKeyPath) ||
    resolveProjectPath(projectRoot, environment.DEPLOY_KEY) ||
    resolveProjectPath(projectRoot, environment.MULTICA_DEPLOY_PRIVATE_KEY_PATH) ||
    resolveProjectPath(projectRoot, environment.GENERICAGENT_DEPLOY_PRIVATE_KEY_PATH) ||
    resolveProjectPath(projectRoot, environment.MULTICA_SSH_KEY_PATH)
  const sshPassword =
    options.sshPassword ||
    firstDefined(
      environment.MULTICA_DEPLOY_ROOT_PASSWORD,
      environment.MULTICA_DEPLOY_PASSWORD,
      environment.GENERICAGENT_DEPLOY_ROOT_PASSWORD,
      environment.MULTICA_ROOT_PASSWORD,
    )
  const sshKeyPath = configuredKeyPath && existsSync(configuredKeyPath)
    ? configuredKeyPath
    : sshPassword
      ? ''
      : detectDefaultSshKeyPath()

  const config = {
    host: firstDefined(
      options.sshHost,
      environment.DEPLOY_HOST,
      environment.MULTICA_DEPLOY_HOST,
      environment.MULTICA_SERVER_IP,
      environment.MULTICA_SERVER_HOST,
    ),
    port: parseInteger(
      options.sshPort || environment.DEPLOY_PORT || environment.MULTICA_DEPLOY_PORT || environment.MULTICA_SERVER_PORT,
      22,
    ),
    username: firstDefined(
      options.sshUser,
      environment.DEPLOY_USER,
      environment.MULTICA_DEPLOY_USERNAME,
      environment.MULTICA_SERVER_USERNAME,
      'root',
    ),
    password: sshPassword,
    privateKeyPath: sshKeyPath,
  }

  if (!config.host) {
    throw new Error('Missing SSH host. Set MULTICA_DEPLOY_HOST, MULTICA_SERVER_IP, or pass --ssh-host.')
  }

  if (!config.privateKeyPath && !config.password) {
    throw new Error(
      'Missing SSH authentication. Provide --ssh-key-path, set DEPLOY_KEY or MULTICA_SSH_KEY_PATH, or configure an SSH password.',
    )
  }

  return config
}

async function connectSsh(config) {
  const client = new Client()
  const connectOptions = {
    host: config.host,
    port: config.port,
    username: config.username,
    readyTimeout: 30_000,
  }

  if (config.privateKeyPath) {
    connectOptions.privateKey = readFileSync(config.privateKeyPath, 'utf8')
  }

  if (config.password) {
    connectOptions.password = config.password
  }

  await new Promise((resolvePromise, reject) => {
    client
      .on('ready', () => resolvePromise())
      .on('error', reject)
      .connect(connectOptions)
  })

  return client
}

async function execRemote(client, command, stdin = '') {
  return await new Promise((resolvePromise, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error)
        return
      }

      let stdout = ''
      let stderr = ''

      stream.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Remote command failed with code ${code}.\nSTDOUT:\n${stdout.trim()}\nSTDERR:\n${stderr.trim()}`))
          return
        }

        resolvePromise({ stdout, stderr })
      })
      stream.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      stream.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })

      if (stdin) {
        stream.end(stdin)
        return
      }

      stream.end()
    })
  })
}

async function discoverRemoteEnvFile(client, serviceName, explicitRemoteEnvFile) {
  if (explicitRemoteEnvFile) {
    return explicitRemoteEnvFile
  }

  const { stdout } = await execRemote(client, `systemctl cat ${shellEscape(serviceName)} || true`)
  const detected = parseEnvironmentFileFromServiceUnit(stdout)
  return detected || defaultRemoteEnvFile
}

async function checkServiceHealth(client, serviceName) {
  const serviceScript = `set -e
ACTIVE=$(systemctl is-active ${shellEscape(serviceName)} 2>/dev/null || true)
SUB_STATE=$(systemctl show ${shellEscape(serviceName)} -p SubState --value 2>/dev/null || true)
MAIN_PID=$(systemctl show ${shellEscape(serviceName)} -p MainPID --value 2>/dev/null || true)
printf '{"active":"%s","subState":"%s","mainPid":"%s"}\\n' "$ACTIVE" "$SUB_STATE" "$MAIN_PID"`
  const { stdout } = await execRemote(client, 'bash -s', serviceScript)
  return JSON.parse(stdout.trim())
}

async function readRemoteAppOrigin(client, remoteEnvFile) {
  const script = `set -euo pipefail
ENV_FILE=${shellEscape(remoteEnvFile)}
if [ ! -f "$ENV_FILE" ]; then
  exit 0
fi
set -a
source "$ENV_FILE"
set +a
printf '%s' "\${APP_ORIGIN:-}"`
  const { stdout } = await execRemote(client, 'bash -s', script)
  return stdout.trim()
}

async function fetchHealthEndpoint(url) {
  if (!url) {
    return {
      url,
      ok: false,
      status: null,
      message: 'URL is missing.',
    }
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
      },
    })
    const contentType = response.headers.get('content-type') || ''
    const text = await response.text()
    let json = null

    if (contentType.includes('application/json')) {
      try {
        json = text ? JSON.parse(text) : null
      } catch {}
    }

    return {
      url,
      ok: response.ok,
      status: response.status,
      contentType,
      json,
      preview: text.slice(0, 240),
    }
  } catch (error) {
    return {
      url,
      ok: false,
      status: null,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function buildAnalyticsSummarySql(days) {
  return `WITH since_value AS (
  SELECT NOW() - INTERVAL '${Number(days)} days' AS since
),
payment_groups AS (
  SELECT
    COALESCE(NULLIF(order_id, ''), session_id) AS payment_key,
    session_id,
    visitor_id,
    MIN(occurred_at::timestamptz) AS first_payment_at,
    MAX(occurred_at::timestamptz) AS last_payment_at,
    COUNT(*) AS event_count
  FROM analytics_events
  WHERE event_name = 'payment_completed'
  GROUP BY 1, 2, 3
),
failure_sessions AS (
  SELECT
    s.id AS session_id,
    s.visitor_id,
    s.started_at::timestamptz AS started_at,
    COALESCE(NULLIF(s.referrer_host, ''), '(direct)') AS referrer_host,
    s.landing_path,
    s.device_type,
    s.last_stage,
    COUNT(*) FILTER (WHERE e.event_name = 'checkout_start_failed') AS failed_count,
    MIN(e.occurred_at::timestamptz) FILTER (WHERE e.event_name = 'checkout_start_failed') AS first_failed_at,
    MAX(e.occurred_at::timestamptz) FILTER (WHERE e.event_name = 'checkout_start_failed') AS last_failed_at
  FROM analytics_sessions s
  JOIN analytics_events e ON e.session_id = s.id
  JOIN since_value sv ON TRUE
  WHERE e.event_name = 'checkout_start_failed'
    AND e.occurred_at::timestamptz >= sv.since
  GROUP BY s.id, s.visitor_id, s.started_at, s.referrer_host, s.landing_path, s.device_type, s.last_stage
),
failure_followups AS (
  SELECT
    f.session_id,
    COUNT(*) FILTER (WHERE p.payment_key IS NOT NULL) AS later_payment_groups
  FROM failure_sessions f
  LEFT JOIN payment_groups p
    ON p.visitor_id = f.visitor_id
   AND p.first_payment_at > f.last_failed_at
  GROUP BY f.session_id
)
SELECT json_build_object(
  'windowDays', ${Number(days)},
  'overall', (
    SELECT json_build_object(
      'sessions', COUNT(*),
      'visitors', COUNT(DISTINCT visitor_id),
      'firstSession', MIN(started_at),
      'lastSession', MAX(started_at),
      'pageViews', COALESCE(SUM(page_view_count), 0),
      'sectionViews', COALESCE(SUM(section_view_count), 0),
      'clicks', COALESCE(SUM(click_count), 0)
    )
    FROM analytics_sessions
  ),
  'window', (
    SELECT json_build_object(
      'sessions', COUNT(*),
      'visitors', COUNT(DISTINCT visitor_id),
      'pageViews', COALESCE(SUM(page_view_count), 0),
      'sectionViews', COALESCE(SUM(section_view_count), 0),
      'clicks', COALESCE(SUM(click_count), 0)
    )
    FROM analytics_sessions s
    JOIN since_value sv ON TRUE
    WHERE s.started_at::timestamptz >= sv.since
  ),
  'daily', (
    SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.day), '[]'::json)
    FROM (
      SELECT
        to_char(date_trunc('day', s.started_at::timestamptz), 'YYYY-MM-DD') AS day,
        COUNT(*) AS sessions,
        COUNT(DISTINCT s.visitor_id) AS visitors,
        COALESCE(SUM(s.page_view_count), 0) AS "pageViews",
        COALESCE(SUM(s.section_view_count), 0) AS "sectionViews",
        COALESCE(SUM(s.click_count), 0) AS clicks
      FROM analytics_sessions s
      JOIN since_value sv ON TRUE
      WHERE s.started_at::timestamptz >= sv.since
      GROUP BY 1
      ORDER BY 1
    ) t
  ),
  'topReferrers', (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        COALESCE(NULLIF(s.referrer_host, ''), '(direct)') AS host,
        COUNT(*) AS sessions
      FROM analytics_sessions s
      JOIN since_value sv ON TRUE
      WHERE s.started_at::timestamptz >= sv.since
      GROUP BY 1
      ORDER BY sessions DESC, host ASC
      LIMIT 12
    ) t
  ),
  'topLandingPaths', (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        s.landing_path,
        COUNT(*) AS sessions
      FROM analytics_sessions s
      JOIN since_value sv ON TRUE
      WHERE s.started_at::timestamptz >= sv.since
      GROUP BY 1
      ORDER BY sessions DESC, landing_path ASC
      LIMIT 12
    ) t
  ),
  'pageRoutes', (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        split_part(e.route_path, '?', 1) AS "pagePath",
        COUNT(*) AS "pageViews",
        COUNT(DISTINCT e.session_id) AS sessions
      FROM analytics_events e
      JOIN since_value sv ON TRUE
      WHERE e.occurred_at::timestamptz >= sv.since
        AND e.event_name = 'page_view'
      GROUP BY 1
      ORDER BY "pageViews" DESC, "pagePath" ASC
    ) t
  ),
  'deviceMix', (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        s.device_type,
        COUNT(*) AS sessions
      FROM analytics_sessions s
      JOIN since_value sv ON TRUE
      WHERE s.started_at::timestamptz >= sv.since
      GROUP BY 1
      ORDER BY sessions DESC, device_type ASC
    ) t
  ),
  'utmSources', (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        s.utm_source,
        COUNT(*) AS sessions
      FROM analytics_sessions s
      JOIN since_value sv ON TRUE
      WHERE s.started_at::timestamptz >= sv.since
        AND COALESCE(s.utm_source, '') <> ''
      GROUP BY 1
      ORDER BY sessions DESC, utm_source ASC
      LIMIT 12
    ) t
  ),
  'stages', (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        s.last_stage,
        COUNT(*) AS sessions
      FROM analytics_sessions s
      JOIN since_value sv ON TRUE
      WHERE s.started_at::timestamptz >= sv.since
      GROUP BY 1
      ORDER BY sessions DESC, last_stage ASC
    ) t
  ),
  'funnel', (
    SELECT json_build_object(
      'landingViewed', COALESCE((
        SELECT COUNT(DISTINCT e.session_id)
        FROM analytics_events e
        JOIN since_value sv ON TRUE
        WHERE e.occurred_at::timestamptz >= sv.since
          AND e.event_name = 'page_view'
          AND e.route_path = '/'
      ), 0),
      'pricingViewed', COALESCE((
        SELECT COUNT(DISTINCT e.session_id)
        FROM analytics_events e
        JOIN since_value sv ON TRUE
        WHERE e.occurred_at::timestamptz >= sv.since
          AND e.event_name = 'content_view'
          AND e.section_key = 'pricing'
      ), 0),
      'launchClicked', COALESCE((
        SELECT COUNT(DISTINCT e.session_id)
        FROM analytics_events e
        JOIN since_value sv ON TRUE
        WHERE e.occurred_at::timestamptz >= sv.since
          AND e.event_name = 'launch_clicked'
      ), 0),
      'planSelected', COALESCE((
        SELECT COUNT(DISTINCT e.session_id)
        FROM analytics_events e
        JOIN since_value sv ON TRUE
        WHERE e.occurred_at::timestamptz >= sv.since
          AND e.event_name = 'plan_selected'
      ), 0),
      'checkoutStarted', COALESCE((
        SELECT COUNT(DISTINCT e.session_id)
        FROM analytics_events e
        JOIN since_value sv ON TRUE
        WHERE e.occurred_at::timestamptz >= sv.since
          AND e.event_name = 'checkout_started'
      ), 0),
      'checkoutRedirected', COALESCE((
        SELECT COUNT(DISTINCT e.session_id)
        FROM analytics_events e
        JOIN since_value sv ON TRUE
        WHERE e.occurred_at::timestamptz >= sv.since
          AND e.event_name = 'checkout_redirected'
      ), 0),
      'paymentCompletedSessions', COALESCE((
        SELECT COUNT(DISTINCT e.session_id)
        FROM analytics_events e
        JOIN since_value sv ON TRUE
        WHERE e.occurred_at::timestamptz >= sv.since
          AND e.event_name = 'payment_completed'
      ), 0),
      'paymentCompletedDedup', COALESCE((
        SELECT COUNT(DISTINCT COALESCE(NULLIF(e.order_id, ''), e.session_id))
        FROM analytics_events e
        JOIN since_value sv ON TRUE
        WHERE e.occurred_at::timestamptz >= sv.since
          AND e.event_name = 'payment_completed'
      ), 0),
      'consoleViewed', COALESCE((
        SELECT COUNT(DISTINCT e.session_id)
        FROM analytics_events e
        JOIN since_value sv ON TRUE
        WHERE e.occurred_at::timestamptz >= sv.since
          AND e.event_name = 'page_view'
          AND e.route_path LIKE '/console%'
      ), 0)
    )
  ),
  'paymentSummary', (
    SELECT json_build_object(
      'events', COALESCE((SELECT COUNT(*) FROM analytics_events e JOIN since_value sv ON TRUE WHERE e.occurred_at::timestamptz >= sv.since AND e.event_name = 'payment_completed'), 0),
      'sessions', COALESCE((SELECT COUNT(DISTINCT e.session_id) FROM analytics_events e JOIN since_value sv ON TRUE WHERE e.occurred_at::timestamptz >= sv.since AND e.event_name = 'payment_completed'), 0),
      'dedupGroups', COALESCE((SELECT COUNT(*) FROM payment_groups p JOIN since_value sv ON TRUE WHERE p.first_payment_at >= sv.since), 0)
    )
  ),
  'checkoutFailures', (
    SELECT json_build_object(
      'events', COALESCE((SELECT COUNT(*) FROM analytics_events e JOIN since_value sv ON TRUE WHERE e.occurred_at::timestamptz >= sv.since AND e.event_name = 'checkout_start_failed'), 0),
      'sessions', COALESCE((SELECT COUNT(*) FROM failure_sessions), 0),
      'visitors', COALESCE((SELECT COUNT(DISTINCT visitor_id) FROM failure_sessions), 0),
      'visitorsWithLaterPayments', COALESCE((
        SELECT COUNT(DISTINCT f.visitor_id)
        FROM failure_sessions f
        JOIN payment_groups p
          ON p.visitor_id = f.visitor_id
         AND p.first_payment_at > f.last_failed_at
      ), 0),
      'sessionsWithLaterPayments', COALESCE((
        SELECT COUNT(*)
        FROM failure_followups ff
        WHERE ff.later_payment_groups > 0
      ), 0)
    )
  ),
  'checkoutFailureSessions', (
    SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t."firstFailedAt"), '[]'::json)
    FROM (
      SELECT
        f.session_id AS "sessionId",
        f.visitor_id AS "visitorId",
        to_char(f.started_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startedAt",
        f.referrer_host AS "referrerHost",
        f.landing_path AS "landingPath",
        f.device_type AS "deviceType",
        f.last_stage AS "lastStage",
        f.failed_count AS "failedCount",
        to_char(f.first_failed_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "firstFailedAt",
        to_char(f.last_failed_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastFailedAt",
        COALESCE(ff.later_payment_groups, 0) AS "laterPaymentGroups"
      FROM failure_sessions f
      LEFT JOIN failure_followups ff ON ff.session_id = f.session_id
      ORDER BY f.first_failed_at
    ) t
  ),
  'recentFailureEvents', (
    SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t."occurredAt"), '[]'::json)
    FROM (
      SELECT
        to_char(e.occurred_at::timestamptz, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "occurredAt",
        e.session_id AS "sessionId",
        e.visitor_id AS "visitorId",
        COALESCE(NULLIF(e.order_id, ''), '') AS "orderId",
        e.route_path AS "routePath",
        e.metadata_json AS "metadataJson"
      FROM analytics_events e
      JOIN since_value sv ON TRUE
      WHERE e.occurred_at::timestamptz >= sv.since
        AND e.event_name = 'checkout_start_failed'
      ORDER BY e.occurred_at
      LIMIT 50
    ) t
  ),
  'topCtaClicks', (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        COALESCE(NULLIF(e.element_key, ''), 'unknown') AS key,
        COALESCE(NULLIF(e.section_key, ''), 'unknown') AS section,
        COUNT(*) AS clicks,
        COUNT(DISTINCT e.session_id) AS sessions
      FROM analytics_events e
      JOIN since_value sv ON TRUE
      WHERE e.occurred_at::timestamptz >= sv.since
        AND e.event_type = 'click'
        AND e.event_name = 'cta_click'
      GROUP BY 1, 2
      ORDER BY clicks DESC, sessions DESC, key ASC
      LIMIT 12
    ) t
  ),
  'paymentGroups', (
    SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t."firstPaymentAt"), '[]'::json)
    FROM (
      SELECT
        p.payment_key AS "paymentKey",
        p.session_id AS "sessionId",
        p.visitor_id AS "visitorId",
        to_char(p.first_payment_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "firstPaymentAt",
        to_char(p.last_payment_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastPaymentAt",
        p.event_count AS "eventCount"
      FROM payment_groups p
      JOIN since_value sv ON TRUE
      WHERE p.first_payment_at >= sv.since
      ORDER BY p.first_payment_at
    ) t
  )
)`
}

async function runRemotePsqlJson(client, remoteEnvFile, sql) {
  const sqlBase64 = Buffer.from(sql, 'utf8').toString('base64')
  const script = `set -euo pipefail
ENV_FILE=${shellEscape(remoteEnvFile)}
SQL_B64=${shellEscape(sqlBase64)}
if [ ! -f "$ENV_FILE" ]; then
  echo "Remote env file was not found: $ENV_FILE" >&2
  exit 1
fi
set -a
source "$ENV_FILE"
set +a
TMP_SQL=$(mktemp)
trap 'rm -f "$TMP_SQL"' EXIT
printf '%s' "$SQL_B64" | base64 -d > "$TMP_SQL"
CONNECTION_URL="\${GENERICAGENT_ANALYTICS_DATABASE_URL:-\${GENERICAGENT_ANALYTICS_POSTGRES_URL:-}}"
SITE_SPECIFIC_HOST="\${GENERICAGENT_ANALYTICS_DB_HOST:-}"
SITE_SPECIFIC_DB="\${GENERICAGENT_ANALYTICS_DB_NAME:-}"
SITE_SPECIFIC_USER="\${GENERICAGENT_ANALYTICS_DB_USER:-}"
SITE_SPECIFIC_PASSWORD="\${GENERICAGENT_ANALYTICS_DB_PASSWORD:-}"
SITE_SPECIFIC_PORT="\${GENERICAGENT_ANALYTICS_DB_PORT:-}"
if [ -n "$CONNECTION_URL" ]; then
  psql -X -v ON_ERROR_STOP=1 -A -t "$CONNECTION_URL" -f "$TMP_SQL"
  exit 0
fi
if [ -n "$SITE_SPECIFIC_HOST" ] || [ -n "$SITE_SPECIFIC_DB" ] || [ -n "$SITE_SPECIFIC_USER" ] || [ -n "$SITE_SPECIFIC_PASSWORD" ] || [ -n "$SITE_SPECIFIC_PORT" ]; then
  PGHOST_VALUE="\${GENERICAGENT_ANALYTICS_DB_HOST:-}"
  PGDATABASE_VALUE="\${GENERICAGENT_ANALYTICS_DB_NAME:-}"
  PGUSER_VALUE="\${GENERICAGENT_ANALYTICS_DB_USER:-}"
  PGPASSWORD_VALUE="\${GENERICAGENT_ANALYTICS_DB_PASSWORD:-}"
  PGPORT_VALUE="\${GENERICAGENT_ANALYTICS_DB_PORT:-5432}"
  PGSSLMODE_VALUE="\${GENERICAGENT_ANALYTICS_DB_SSLMODE:-${defaultAnalyticsDatabase.sslMode}}"
else
  CONNECTION_URL="\${DATABASE_URL:-\${POSTGRES_URL:-\${POSTGRES_PRISMA_URL:-\${MULTICA_POSTGRES_URL:-}}}}"
  if [ -n "$CONNECTION_URL" ]; then
    psql -X -v ON_ERROR_STOP=1 -A -t "$CONNECTION_URL" -f "$TMP_SQL"
    exit 0
  fi
  PGHOST_VALUE="\${MULTICA_POSTGRES_HOST:-\${PGHOST:-\${POSTGRES_HOST:-}}}"
  PGDATABASE_VALUE="\${MULTICA_POSTGRES_DB:-\${PGDATABASE:-\${POSTGRES_DATABASE:-}}}"
  PGUSER_VALUE="\${MULTICA_POSTGRES_USER:-\${PGUSER:-\${POSTGRES_USER:-}}}"
  PGPASSWORD_VALUE="\${MULTICA_POSTGRES_PASSWORD:-\${PGPASSWORD:-\${POSTGRES_PASSWORD:-}}}"
  PGPORT_VALUE="\${MULTICA_POSTGRES_PORT:-\${PGPORT:-\${POSTGRES_PORT:-5432}}}"
  PGSSLMODE_VALUE="\${MULTICA_POSTGRES_SSLMODE:-\${PGSSLMODE:-\${POSTGRES_SSLMODE:-}}}"
fi
if [ -z "$PGHOST_VALUE" ] || [ -z "$PGDATABASE_VALUE" ] || [ -z "$PGUSER_VALUE" ] || [ -z "$PGPASSWORD_VALUE" ]; then
  echo "PostgreSQL variables are missing from $ENV_FILE. Set GENERICAGENT_ANALYTICS_DATABASE_URL or GENERICAGENT_ANALYTICS_DB_HOST, GENERICAGENT_ANALYTICS_DB_NAME, GENERICAGENT_ANALYTICS_DB_USER, and GENERICAGENT_ANALYTICS_DB_PASSWORD." >&2
  exit 1
fi
export PGPASSWORD="$PGPASSWORD_VALUE"
if [ -n "$PGSSLMODE_VALUE" ]; then
  export PGSSLMODE="$PGSSLMODE_VALUE"
fi
psql -X -v ON_ERROR_STOP=1 -A -t -h "$PGHOST_VALUE" -p "$PGPORT_VALUE" -U "$PGUSER_VALUE" -d "$PGDATABASE_VALUE" -f "$TMP_SQL"`
  const { stdout } = await execRemote(client, 'bash -s', script)
  return JSON.parse(stdout.trim())
}

async function runLocalPsqlJson({ environment, projectRoot, secretFile }, sql) {
  const postgresConfig = resolveLocalPostgresConfig({ environment, projectRoot, secretFile })
  const pool = new Pool({
    host: postgresConfig.host,
    port: postgresConfig.port,
    database: postgresConfig.database,
    user: postgresConfig.user,
    password: postgresConfig.password,
    ssl: postgresConfig.ssl,
    ...(postgresConfig.enableChannelBinding ? { enableChannelBinding: true } : {}),
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  })

  try {
    const result = await pool.query(sql)
    const row = result.rows[0] ?? {}
    return row.json_build_object ?? Object.values(row)[0] ?? null
  } finally {
    await pool.end()
  }
}

function readWindowsPersistentEnvironmentVariable(name) {
  if (process.platform !== 'win32' || !name) {
    return ''
  }

  try {
    const script = [
      `$value = [Environment]::GetEnvironmentVariable('${name}', 'Process')`,
      `if (-not $value) { $value = [Environment]::GetEnvironmentVariable('${name}', 'User') }`,
      `if (-not $value) { $value = [Environment]::GetEnvironmentVariable('${name}', 'Machine') }`,
      `if ($value) { Write-Output $value }`,
    ].join('; ')

    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        windowsHide: true,
      },
    ).trim()
  } catch {
    return ''
  }
}

function resolveWranglerEnvironment(environment = process.env) {
  const resolved = { ...environment }

  for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CLOUDFLARE_ACCOUNT_ID']) {
    if (!firstDefined(resolved[name])) {
      const persistedValue = readWindowsPersistentEnvironmentVariable(name)
      if (persistedValue) {
        resolved[name] = persistedValue
      }
    }
  }

  return resolved
}

function resolveCloudflareD1DatabaseName({ projectRoot = scriptProjectRoot, explicitName = '' } = {}) {
  if (explicitName.trim()) {
    return explicitName.trim()
  }

  const wranglerConfigPath = resolve(projectRoot, 'wrangler.toml')
  if (existsSync(wranglerConfigPath)) {
    const match = readFileSync(wranglerConfigPath, 'utf8').match(/database_name\s*=\s*"([^"]+)"/)
    if (match?.[1]?.trim()) {
      return match[1].trim()
    }
  }

  return defaultCloudflareD1DatabaseName
}

function buildCloudflareD1AnalyticsStatements(days) {
  const safeDays = parseInteger(days, defaultDays)
  const sinceIso = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString()
  const sinceLiteral = sqlTextLiteral(sinceIso)
  const normalizedRoutePathSql = `CASE
    WHEN instr(route_path, '?') > 0 THEN substr(route_path, 1, instr(route_path, '?') - 1)
    ELSE route_path
  END`

  return {
    sinceIso,
    statements: [
      {
        key: 'overall',
        sql: `SELECT
          COUNT(*) AS sessions,
          COUNT(DISTINCT visitor_id) AS visitors,
          MIN(started_at) AS firstSession,
          MAX(started_at) AS lastSession,
          COALESCE(SUM(page_view_count), 0) AS pageViews,
          COALESCE(SUM(section_view_count), 0) AS sectionViews,
          COALESCE(SUM(click_count), 0) AS clicks
        FROM analytics_sessions`,
      },
      {
        key: 'window',
        sql: `SELECT
          COUNT(*) AS sessions,
          COUNT(DISTINCT visitor_id) AS visitors,
          COALESCE(SUM(page_view_count), 0) AS pageViews,
          COALESCE(SUM(section_view_count), 0) AS sectionViews,
          COALESCE(SUM(click_count), 0) AS clicks
        FROM analytics_sessions
        WHERE started_at >= ${sinceLiteral}`,
      },
      {
        key: 'daily',
        sql: `SELECT
          substr(started_at, 1, 10) AS day,
          COUNT(*) AS sessions,
          COUNT(DISTINCT visitor_id) AS visitors,
          COALESCE(SUM(page_view_count), 0) AS pageViews,
          COALESCE(SUM(section_view_count), 0) AS sectionViews,
          COALESCE(SUM(click_count), 0) AS clicks
        FROM analytics_sessions
        WHERE started_at >= ${sinceLiteral}
        GROUP BY substr(started_at, 1, 10)
        ORDER BY day ASC`,
      },
      {
        key: 'topReferrers',
        sql: `SELECT
          COALESCE(NULLIF(referrer_host, ''), '(direct)') AS host,
          COUNT(*) AS sessions
        FROM analytics_sessions
        WHERE started_at >= ${sinceLiteral}
        GROUP BY COALESCE(NULLIF(referrer_host, ''), '(direct)')
        ORDER BY sessions DESC, host ASC
        LIMIT 12`,
      },
      {
        key: 'topLandingPaths',
        sql: `SELECT
          landing_path,
          COUNT(*) AS sessions
        FROM analytics_sessions
        WHERE started_at >= ${sinceLiteral}
        GROUP BY landing_path
        ORDER BY sessions DESC, landing_path ASC
        LIMIT 12`,
      },
      {
        key: 'pageRoutes',
        sql: `SELECT
          ${normalizedRoutePathSql} AS "pagePath",
          COUNT(*) AS "pageViews",
          COUNT(DISTINCT session_id) AS sessions
        FROM analytics_events
        WHERE occurred_at >= ${sinceLiteral}
          AND event_name = 'page_view'
        GROUP BY ${normalizedRoutePathSql}
        ORDER BY "pageViews" DESC, "pagePath" ASC`,
      },
      {
        key: 'deviceMix',
        sql: `SELECT
          device_type,
          COUNT(*) AS sessions
        FROM analytics_sessions
        WHERE started_at >= ${sinceLiteral}
        GROUP BY device_type
        ORDER BY sessions DESC, device_type ASC`,
      },
      {
        key: 'utmSources',
        sql: `SELECT
          utm_source,
          COUNT(*) AS sessions
        FROM analytics_sessions
        WHERE started_at >= ${sinceLiteral}
          AND COALESCE(utm_source, '') <> ''
        GROUP BY utm_source
        ORDER BY sessions DESC, utm_source ASC
        LIMIT 12`,
      },
      {
        key: 'stages',
        sql: `SELECT
          COALESCE(NULLIF(last_stage, ''), 'unknown') AS last_stage,
          COUNT(*) AS sessions
        FROM analytics_sessions
        WHERE started_at >= ${sinceLiteral}
        GROUP BY COALESCE(NULLIF(last_stage, ''), 'unknown')
        ORDER BY sessions DESC, last_stage ASC`,
      },
      {
        key: 'funnel',
        sql: `SELECT
          COALESCE(COUNT(DISTINCT CASE WHEN event_name = 'page_view' AND route_path = '/' THEN session_id END), 0) AS landingViewed,
          COALESCE(COUNT(DISTINCT CASE WHEN event_name = 'content_view' AND section_key = 'pricing' THEN session_id END), 0) AS pricingViewed,
          COALESCE(COUNT(DISTINCT CASE WHEN event_name = 'launch_clicked' THEN session_id END), 0) AS launchClicked,
          COALESCE(COUNT(DISTINCT CASE WHEN event_name = 'plan_selected' THEN session_id END), 0) AS planSelected,
          COALESCE(COUNT(DISTINCT CASE WHEN event_name = 'checkout_started' THEN session_id END), 0) AS checkoutStarted,
          COALESCE(COUNT(DISTINCT CASE WHEN event_name = 'checkout_redirected' THEN session_id END), 0) AS checkoutRedirected,
          COALESCE(COUNT(DISTINCT CASE WHEN event_name = 'payment_completed' THEN session_id END), 0) AS paymentCompletedSessions,
          COALESCE(COUNT(DISTINCT CASE WHEN event_name = 'payment_completed' THEN COALESCE(NULLIF(order_id, ''), session_id) END), 0) AS paymentCompletedDedup,
          COALESCE(COUNT(DISTINCT CASE WHEN event_name = 'page_view' AND route_path LIKE '/console%' THEN session_id END), 0) AS consoleViewed
        FROM analytics_events
        WHERE occurred_at >= ${sinceLiteral}`,
      },
      {
        key: 'paymentSummary',
        sql: `SELECT
          COUNT(*) AS events,
          COUNT(DISTINCT session_id) AS sessions,
          COUNT(DISTINCT COALESCE(NULLIF(order_id, ''), session_id)) AS dedupGroups
        FROM analytics_events
        WHERE occurred_at >= ${sinceLiteral}
          AND event_name = 'payment_completed'`,
      },
      {
        key: 'checkoutFailureEvents',
        sql: `SELECT COUNT(*) AS events
        FROM analytics_events
        WHERE occurred_at >= ${sinceLiteral}
          AND event_name = 'checkout_start_failed'`,
      },
      {
        key: 'checkoutFailureSessions',
        sql: `WITH failure_sessions AS (
          SELECT
            s.id AS sessionId,
            s.visitor_id AS visitorId,
            s.started_at AS startedAt,
            COALESCE(NULLIF(s.referrer_host, ''), '(direct)') AS referrerHost,
            s.landing_path AS landingPath,
            s.device_type AS deviceType,
            s.last_stage AS lastStage,
            COUNT(*) AS failedCount,
            MIN(e.occurred_at) AS firstFailedAt,
            MAX(e.occurred_at) AS lastFailedAt
          FROM analytics_sessions s
          JOIN analytics_events e ON e.session_id = s.id
          WHERE e.event_name = 'checkout_start_failed'
            AND e.occurred_at >= ${sinceLiteral}
          GROUP BY s.id, s.visitor_id, s.started_at, s.referrer_host, s.landing_path, s.device_type, s.last_stage
        ),
        payment_groups AS (
          SELECT
            COALESCE(NULLIF(order_id, ''), session_id) AS paymentKey,
            visitor_id,
            MIN(occurred_at) AS firstPaymentAt
          FROM analytics_events
          WHERE event_name = 'payment_completed'
          GROUP BY COALESCE(NULLIF(order_id, ''), session_id), visitor_id
        )
        SELECT
          f.sessionId,
          f.visitorId,
          f.startedAt,
          f.referrerHost,
          f.landingPath,
          f.deviceType,
          f.lastStage,
          f.failedCount,
          f.firstFailedAt,
          f.lastFailedAt,
          COALESCE(COUNT(DISTINCT p.paymentKey), 0) AS laterPaymentGroups
        FROM failure_sessions f
        LEFT JOIN payment_groups p
          ON p.visitor_id = f.visitorId
         AND p.firstPaymentAt > f.lastFailedAt
        GROUP BY
          f.sessionId,
          f.visitorId,
          f.startedAt,
          f.referrerHost,
          f.landingPath,
          f.deviceType,
          f.lastStage,
          f.failedCount,
          f.firstFailedAt,
          f.lastFailedAt
        ORDER BY f.firstFailedAt ASC`,
      },
      {
        key: 'recentFailureEvents',
        sql: `SELECT
          occurred_at AS occurredAt,
          session_id AS sessionId,
          visitor_id AS visitorId,
          COALESCE(NULLIF(order_id, ''), '') AS orderId,
          route_path AS routePath,
          metadata_json AS metadataJson
        FROM analytics_events
        WHERE occurred_at >= ${sinceLiteral}
          AND event_name = 'checkout_start_failed'
        ORDER BY occurred_at ASC
        LIMIT 50`,
      },
      {
        key: 'topCtaClicks',
        sql: `SELECT
          COALESCE(NULLIF(element_key, ''), 'unknown') AS key,
          COALESCE(NULLIF(section_key, ''), 'unknown') AS section,
          COUNT(*) AS clicks,
          COUNT(DISTINCT session_id) AS sessions
        FROM analytics_events
        WHERE occurred_at >= ${sinceLiteral}
          AND event_type = 'click'
          AND event_name = 'cta_click'
        GROUP BY COALESCE(NULLIF(element_key, ''), 'unknown'), COALESCE(NULLIF(section_key, ''), 'unknown')
        ORDER BY clicks DESC, sessions DESC, key ASC
        LIMIT 12`,
      },
      {
        key: 'paymentGroups',
        sql: `SELECT
          COALESCE(NULLIF(order_id, ''), session_id) AS paymentKey,
          session_id AS sessionId,
          visitor_id AS visitorId,
          MIN(occurred_at) AS firstPaymentAt,
          MAX(occurred_at) AS lastPaymentAt,
          COUNT(*) AS eventCount
        FROM analytics_events
        WHERE event_name = 'payment_completed'
          AND occurred_at >= ${sinceLiteral}
        GROUP BY COALESCE(NULLIF(order_id, ''), session_id), session_id, visitor_id
        ORDER BY firstPaymentAt ASC`,
      },
    ],
  }
}

function normalizeCount(value) {
  const normalized = Number(value ?? 0)
  return Number.isFinite(normalized) ? normalized : 0
}

function stripAnsi(text) {
  return String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '')
}

function parseWranglerJsonOutput(stdout) {
  const sanitized = stripAnsi(stdout).trim()
  const candidateStarts = []
  const trailingArrayIndex = sanitized.lastIndexOf('\n[')

  if (trailingArrayIndex >= 0) {
    candidateStarts.push(trailingArrayIndex + 1)
  }

  const firstArrayIndex = sanitized.indexOf('[')
  if (firstArrayIndex >= 0 && !candidateStarts.includes(firstArrayIndex)) {
    candidateStarts.push(firstArrayIndex)
  }

  for (const startIndex of candidateStarts) {
    const candidate = sanitized.slice(startIndex).trim()
    try {
      return JSON.parse(candidate)
    } catch {
      continue
    }
  }

  throw new Error(`Could not parse Wrangler JSON output: ${sanitized.slice(0, 200)}`)
}

function buildCloudflareD1AnalyticsFromResults({ days, statementResults }) {
  const rowsByKey = Object.fromEntries(statementResults.map((statementResult) => [statementResult.key, statementResult.rows]))
  const getRows = (key) => rowsByKey[key] ?? []
  const getRow = (key) => getRows(key)[0] ?? {}
  const checkoutFailureSessions = getRows('checkoutFailureSessions').map((entry) => ({
    sessionId: entry.sessionId,
    visitorId: entry.visitorId,
    startedAt: entry.startedAt,
    referrerHost: entry.referrerHost,
    landingPath: entry.landingPath,
    deviceType: entry.deviceType,
    lastStage: entry.lastStage,
    failedCount: normalizeCount(entry.failedCount),
    firstFailedAt: entry.firstFailedAt,
    lastFailedAt: entry.lastFailedAt,
    laterPaymentGroups: normalizeCount(entry.laterPaymentGroups),
  }))
  const failureVisitors = new Set(checkoutFailureSessions.map((entry) => entry.visitorId).filter(Boolean))
  const laterPaymentVisitorIds = new Set(
    checkoutFailureSessions.filter((entry) => entry.laterPaymentGroups > 0).map((entry) => entry.visitorId).filter(Boolean),
  )
  const paymentGroups = getRows('paymentGroups').map((entry) => ({
    paymentKey: entry.paymentKey,
    sessionId: entry.sessionId,
    visitorId: entry.visitorId,
    firstPaymentAt: entry.firstPaymentAt,
    lastPaymentAt: entry.lastPaymentAt,
    eventCount: normalizeCount(entry.eventCount),
  }))

  return {
    windowDays: parseInteger(days, defaultDays),
    overall: {
      sessions: normalizeCount(getRow('overall').sessions),
      visitors: normalizeCount(getRow('overall').visitors),
      firstSession: getRow('overall').firstSession ?? null,
      lastSession: getRow('overall').lastSession ?? null,
      pageViews: normalizeCount(getRow('overall').pageViews),
      sectionViews: normalizeCount(getRow('overall').sectionViews),
      clicks: normalizeCount(getRow('overall').clicks),
    },
    window: {
      sessions: normalizeCount(getRow('window').sessions),
      visitors: normalizeCount(getRow('window').visitors),
      pageViews: normalizeCount(getRow('window').pageViews),
      sectionViews: normalizeCount(getRow('window').sectionViews),
      clicks: normalizeCount(getRow('window').clicks),
    },
    daily: getRows('daily').map((entry) => ({
      day: entry.day,
      sessions: normalizeCount(entry.sessions),
      visitors: normalizeCount(entry.visitors),
      pageViews: normalizeCount(entry.pageViews),
      sectionViews: normalizeCount(entry.sectionViews),
      clicks: normalizeCount(entry.clicks),
    })),
    topReferrers: getRows('topReferrers').map((entry) => ({
      host: entry.host,
      sessions: normalizeCount(entry.sessions),
    })),
    topLandingPaths: getRows('topLandingPaths').map((entry) => ({
      landing_path: entry.landing_path ?? entry.landingPath ?? '',
      sessions: normalizeCount(entry.sessions),
    })),
    pageRoutes: getRows('pageRoutes').map((entry) => ({
      pagePath: entry.pagePath,
      pageViews: normalizeCount(entry.pageViews),
      sessions: normalizeCount(entry.sessions),
    })),
    deviceMix: getRows('deviceMix').map((entry) => ({
      device_type: entry.device_type ?? '',
      sessions: normalizeCount(entry.sessions),
    })),
    utmSources: getRows('utmSources').map((entry) => ({
      utm_source: entry.utm_source ?? '',
      sessions: normalizeCount(entry.sessions),
    })),
    stages: getRows('stages').map((entry) => ({
      last_stage: entry.last_stage ?? 'unknown',
      sessions: normalizeCount(entry.sessions),
    })),
    funnel: {
      landingViewed: normalizeCount(getRow('funnel').landingViewed),
      pricingViewed: normalizeCount(getRow('funnel').pricingViewed),
      launchClicked: normalizeCount(getRow('funnel').launchClicked),
      planSelected: normalizeCount(getRow('funnel').planSelected),
      checkoutStarted: normalizeCount(getRow('funnel').checkoutStarted),
      checkoutRedirected: normalizeCount(getRow('funnel').checkoutRedirected),
      paymentCompletedSessions: normalizeCount(getRow('funnel').paymentCompletedSessions),
      paymentCompletedDedup: normalizeCount(getRow('funnel').paymentCompletedDedup),
      consoleViewed: normalizeCount(getRow('funnel').consoleViewed),
    },
    paymentSummary: {
      events: normalizeCount(getRow('paymentSummary').events),
      sessions: normalizeCount(getRow('paymentSummary').sessions),
      dedupGroups: normalizeCount(getRow('paymentSummary').dedupGroups),
    },
    checkoutFailures: {
      events: normalizeCount(getRow('checkoutFailureEvents').events),
      sessions: checkoutFailureSessions.length,
      visitors: failureVisitors.size,
      visitorsWithLaterPayments: laterPaymentVisitorIds.size,
      sessionsWithLaterPayments: checkoutFailureSessions.filter((entry) => entry.laterPaymentGroups > 0).length,
    },
    checkoutFailureSessions,
    recentFailureEvents: getRows('recentFailureEvents').map((entry) => ({
      occurredAt: entry.occurredAt,
      sessionId: entry.sessionId,
      visitorId: entry.visitorId,
      orderId: entry.orderId,
      routePath: entry.routePath,
      metadataJson: entry.metadataJson,
    })),
    topCtaClicks: getRows('topCtaClicks').map((entry) => ({
      key: entry.key,
      section: entry.section,
      clicks: normalizeCount(entry.clicks),
      sessions: normalizeCount(entry.sessions),
    })),
    paymentGroups,
  }
}

async function runCloudflareD1AnalyticsSummary({
  days,
  d1DatabaseName,
  environment = process.env,
  projectRoot = scriptProjectRoot,
}) {
  const { statements } = buildCloudflareD1AnalyticsStatements(days)
  const sql = `${statements.map((statement) => statement.sql.trim()).join(';\n\n')};\n`
  const wranglerCliPath = resolve(projectRoot, 'node_modules/wrangler/bin/wrangler.js')

  const stdout = execFileSync(
    process.execPath,
    [wranglerCliPath, 'd1', 'execute', d1DatabaseName, '--remote', '--command', sql, '--json'],
    {
      cwd: projectRoot,
      env: {
        ...resolveWranglerEnvironment(environment),
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  )

  const rawResults = parseWranglerJsonOutput(stdout)
  const statementResults = statements.map((statement, index) => {
    const result = rawResults[index] ?? {}
    if (result.success === false) {
      throw new Error(`Cloudflare D1 query failed for "${statement.key}".`)
    }

    return {
      key: statement.key,
      rows: Array.isArray(result.results) ? result.results : [],
    }
  })

  return buildCloudflareD1AnalyticsFromResults({
    days,
    statementResults,
  })
}

function buildRequestLogPython(days) {
  return `import gzip
import json
import os
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from glob import glob
from urllib.parse import urlsplit

cutoff = datetime.now(timezone.utc) - timedelta(days=${Number(days)})
paths = sorted(glob('/var/log/nginx/access.log*'))
pattern = re.compile(r'^(?P<ip>\\S+) \\S+ \\S+ \\[(?P<timestamp>[^\\]]+)\\] "(?P<method>\\S+) (?P<target>\\S+) (?P<protocol>[^"]+)" (?P<status>\\d{3}) (?P<size>\\S+) "(?P<referrer>[^"]*)" "(?P<ua>[^"]*)"')
static_suffixes = (
    '.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.map', '.xml', '.txt', '.webmanifest'
)
suspicious_prefixes = (
    '/wp-', '/wordpress', '/xmlrpc', '/.env', '/phpmyadmin', '/adminer',
    '/boaform', '/autodiscover', '/cgi-bin', '/vendor', '/hudson'
)
suspicious_markers = (
    '.php', '.env', '.git', 'passwd', '/@fs/', 'setup-config', 'xmlrpc',
    '/cgi-bin/', 'boaform', '/vendor/', 'phpmyadmin', 'wlwmanifest'
)
known_page_prefixes = ('/compare/', '/solutions/', '/resources/')
known_pages = {'/', '/plans', '/console', '/checkout', '/privacy', '/terms', '/index.html'}

def open_log(path):
    return gzip.open(path, 'rt', encoding='utf-8', errors='replace') if path.endswith('.gz') else open(path, 'r', encoding='utf-8', errors='replace')

def classify(method, target):
    path = urlsplit(target).path.lower()
    last_segment = path.rsplit('/', 1)[-1]
    if any(marker in path for marker in suspicious_markers) or path.startswith(suspicious_prefixes):
        return 'suspiciousScan'
    if path.startswith('/api/'):
        return 'api'
    if path.startswith('/multica-console/'):
        return 'consoleProxy'
    if path.startswith('/assets/') or path.endswith(static_suffixes):
        return 'staticAsset'
    if method in ('GET', 'HEAD'):
        if path in known_pages or any(path.startswith(prefix) for prefix in known_page_prefixes):
            return 'page'
        if '.' in last_segment and not path.endswith('.html'):
            return 'other'
        return 'other'
    return 'other'

type_counts = Counter()
status_counts = Counter()
top_page_paths = Counter()
top_api_paths = Counter()
top_scan_paths = Counter()
unique_ips = {'all': set(), 'page': set(), 'api': set()}
earliest = None
latest = None
parsed = 0

for path in paths:
    try:
        with open_log(path) as handle:
            for raw_line in handle:
                match = pattern.match(raw_line.rstrip('\\n'))
                if not match:
                    continue
                parsed_at = datetime.strptime(match.group('timestamp'), '%d/%b/%Y:%H:%M:%S %z')
                if parsed_at < cutoff:
                    continue
                parsed += 1
                earliest = parsed_at if earliest is None or parsed_at < earliest else earliest
                latest = parsed_at if latest is None or parsed_at > latest else latest
                ip = match.group('ip')
                method = match.group('method')
                target = match.group('target')
                path_only = urlsplit(target).path or '/'
                status = int(match.group('status'))
                category = classify(method, target)
                type_counts[category] += 1
                unique_ips['all'].add(ip)
                if category == 'page':
                    top_page_paths[path_only] += 1
                    unique_ips['page'].add(ip)
                elif category == 'api':
                    top_api_paths[path_only] += 1
                    unique_ips['api'].add(ip)
                elif category == 'suspiciousScan':
                    top_scan_paths[path_only] += 1

                if 200 <= status <= 299:
                    status_counts['2xx'] += 1
                elif 300 <= status <= 399:
                    status_counts['3xx'] += 1
                elif 400 <= status <= 499:
                    status_counts['4xx'] += 1
                elif 500 <= status <= 599:
                    status_counts['5xx'] += 1
    except FileNotFoundError:
        continue

report = {
    'windowDays': ${Number(days)},
    'logFiles': paths,
    'parsedRequests': parsed,
    'firstRequestAt': earliest.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z') if earliest else None,
    'lastRequestAt': latest.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z') if latest else None,
    'typeCounts': {
        'page': type_counts.get('page', 0),
        'api': type_counts.get('api', 0),
        'staticAsset': type_counts.get('staticAsset', 0),
        'consoleProxy': type_counts.get('consoleProxy', 0),
        'suspiciousScan': type_counts.get('suspiciousScan', 0),
        'other': type_counts.get('other', 0),
    },
    'statusCounts': {
        '2xx': status_counts.get('2xx', 0),
        '3xx': status_counts.get('3xx', 0),
        '4xx': status_counts.get('4xx', 0),
        '5xx': status_counts.get('5xx', 0),
    },
    'uniqueIps': {
        'all': len(unique_ips['all']),
        'page': len(unique_ips['page']),
        'api': len(unique_ips['api']),
    },
    'topPagePaths': [{'path': path, 'requests': count} for path, count in top_page_paths.most_common()],
    'topApiPaths': [{'path': path, 'requests': count} for path, count in top_api_paths.most_common(12)],
    'topScanPaths': [{'path': path, 'requests': count} for path, count in top_scan_paths.most_common(12)],
}

print(json.dumps(report, ensure_ascii=False))`
}

async function runRemoteRequestLogSummary(client, days) {
  const pythonBase64 = Buffer.from(buildRequestLogPython(days), 'utf8').toString('base64')
  const script = `set -euo pipefail
PYTHON_B64=${shellEscape(pythonBase64)}
TMP_PY=$(mktemp)
trap 'rm -f "$TMP_PY"' EXIT
printf '%s' "$PYTHON_B64" | base64 -d > "$TMP_PY"
python3 "$TMP_PY"`
  const { stdout } = await execRemote(client, 'bash -s', script)
  return JSON.parse(stdout.trim())
}

function formatPercent(numerator, denominator) {
  if (!denominator) {
    return '0.0%'
  }

  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

function formatIsoForTimeZone(isoValue, timeZone = 'Asia/Shanghai') {
  if (!isoValue) {
    return 'n/a'
  }

  const date = new Date(isoValue)
  if (Number.isNaN(date.getTime())) {
    return String(isoValue)
  }

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function isDirectReferrer(host) {
  return String(host ?? '').trim() === directReferrerSentinel
}

function formatReferrerLabel(host) {
  return isDirectReferrer(host) ? directReferrerLabel : String(host ?? '').trim()
}

function formatStageLabel(stage) {
  const labels = {
    unknown: 'unknown',
    landing_viewed: 'landing viewed',
    pricing_viewed: 'pricing viewed',
    launch_clicked: 'launch clicked',
    plan_selected: 'plan selected',
    checkout_started: 'checkout started',
    checkout_redirected: 'checkout redirected',
    payment_completed: 'payment completed',
    console_viewed: 'console viewed',
  }

  const normalizedStage = String(stage ?? '').trim()
  return labels[normalizedStage] ?? (normalizedStage || 'unknown')
}

function getPrimaryStopStage(analytics) {
  const stages = Array.isArray(analytics?.stages) ? analytics.stages : []
  if (stages.length === 0) {
    return null
  }

  const topStage = stages[0]
  return {
    key: topStage.last_stage,
    label: formatStageLabel(topStage.last_stage),
    sessions: Number(topStage.sessions ?? 0),
  }
}

function buildInsights(report) {
  const insights = []
  const analytics = report.analytics
  const requestLogs = report.requestLogs

  if (!analytics) {
    if (requestLogs) {
      const pageRequests = Number(requestLogs.typeCounts?.page ?? 0)
      const apiRequests = Number(requestLogs.typeCounts?.api ?? 0)
      insights.push(`Nginx logs in the current window show ${pageRequests} page requests and ${apiRequests} API requests.`)
    }
    return insights
  }

  const totalSessions = Number(analytics.window?.sessions ?? 0)
  const directSessions = Number(analytics.topReferrers?.find((entry) => isDirectReferrer(entry.host))?.sessions ?? 0)
  const failureSessions = Number(analytics.checkoutFailures?.sessions ?? 0)
  const laterPaymentVisitors = Number(analytics.checkoutFailures?.visitorsWithLaterPayments ?? 0)
  const externalReferrers = (analytics.topReferrers ?? []).filter((entry) => entry.host && !isDirectReferrer(entry.host))
  const utmTrackedSessions = (analytics.utmSources ?? []).reduce((sum, entry) => sum + Number(entry.sessions ?? 0), 0)
  const paymentEvents = Number(analytics.paymentSummary?.events ?? 0)
  const paymentDedup = Number(analytics.paymentSummary?.dedupGroups ?? 0)
  const topCta = Array.isArray(analytics.topCtaClicks) ? analytics.topCtaClicks[0] : null

  if (totalSessions > 0) {
    insights.push(
      `${formatPercent(directSessions, totalSessions)} of sessions in the last ${analytics.windowDays} days had no referrer and were labeled as "${directReferrerLabel}".`,
    )
  }

  if (externalReferrers.length > 0) {
    insights.push(
      `Detected ${externalReferrers.length} non-direct referrer hosts: ${externalReferrers
        .map((entry) => `${entry.host} (${entry.sessions})`)
        .join(', ')}.`,
    )
  } else if (totalSessions > 0) {
    insights.push(`No referrer hosts besides "${directReferrerLabel}" were detected in the current analytics window.`)
  }

  if (utmTrackedSessions === 0 && totalSessions > 0) {
    insights.push('No UTM-tagged sessions were recorded, so attribution is still mostly opaque.')
  }

  if (failureSessions > 0) {
    insights.push(
      `${failureSessions} sessions hit checkout_start_failed, and ${laterPaymentVisitors} visitors later completed payment in newer sessions.`,
    )
  }

  if (paymentEvents > paymentDedup && paymentDedup > 0) {
    insights.push(`payment_completed contains duplicate events; deduplicated payment groups in the current window: ${paymentDedup}.`)
  }

  if (topCta) {
    insights.push(
      `The top CTA in the current window is ${topCta.key} in ${topCta.section}, with ${topCta.clicks} clicks across ${topCta.sessions} sessions.`,
    )
  }

  if (requestLogs) {
    const pageRequests = Number(requestLogs.typeCounts?.page ?? 0)
    const apiRequests = Number(requestLogs.typeCounts?.api ?? 0)
    const scanRequests = Number(requestLogs.typeCounts?.suspiciousScan ?? 0)
    insights.push(`Nginx logs in the current window show ${pageRequests} page requests, ${apiRequests} API requests, and ${scanRequests} suspicious scan requests.`)
  }

  return insights
}

function renderTextReport(report) {
  const lines = []

  if (report.analytics) {
    const analytics = report.analytics
    const primaryStopStage = getPrimaryStopStage(analytics)

    lines.push(`Overall Scale (${analytics.windowDays}d)`)
    lines.push(
      `- sessions / visitors: ${analytics.window.sessions} / ${analytics.window.visitors}`,
    )
    lines.push(
      `- page views / section views / clicks: ${analytics.window.pageViews} / ${analytics.window.sectionViews} / ${analytics.window.clicks}`,
    )
    lines.push(
      `- payments / checkout failures: ${analytics.paymentSummary.dedupGroups} dedup payments / ${analytics.checkoutFailures.sessions} failed sessions`,
    )
    if (primaryStopStage) {
      lines.push(
        `- main session stop stage: ${primaryStopStage.label} (${primaryStopStage.sessions} sessions, ${formatPercent(primaryStopStage.sessions, analytics.window.sessions)})`,
      )
    }
    lines.push('')
  }

  lines.push('Production Runtime')
  if (report.ssh) {
    lines.push(`- SSH target: ${report.ssh.host}:${report.ssh.port} as ${report.ssh.username}`)
    lines.push(`- Service: ${report.serviceName}`)
    lines.push(`- Remote env file: ${report.remoteEnvFile}`)
  }
  if (report.database) {
    lines.push(`- Database: ${report.database.identity}`)
  }

  if (report.health) {
    lines.push('')
    lines.push('Health')
    if (report.health.service) {
      lines.push(`- systemd: ${report.health.service.active || 'unknown'}${report.health.service.subState ? ` (${report.health.service.subState})` : ''}`)
    }
    lines.push(`- origin: ${report.health.origin.url || 'n/a'} -> ${report.health.origin.status ?? 'error'}`)
    lines.push(`- /api/runtime: ${report.health.runtime.url || 'n/a'} -> ${report.health.runtime.status ?? 'error'}`)
    if (report.health.runtime.json?.environment) {
      lines.push(`- runtime environment: ${report.health.runtime.json.environment}`)
    }
    lines.push(`- /api/auth/me: ${report.health.authMe.url || 'n/a'} -> ${report.health.authMe.status ?? 'error'}`)
  }

  if (report.analytics) {
    const analytics = report.analytics

    lines.push('')
    lines.push(`Analytics (${analytics.windowDays}d)`)
    lines.push(
      `- overall: ${analytics.overall.sessions} sessions / ${analytics.overall.visitors} visitors from ${analytics.overall.firstSession || 'n/a'} to ${analytics.overall.lastSession || 'n/a'}`,
    )
    lines.push(
      `- window: ${analytics.window.sessions} sessions / ${analytics.window.visitors} visitors / ${analytics.window.pageViews} page views / ${analytics.window.sectionViews} section views / ${analytics.window.clicks} clicks`,
    )
    lines.push(
      `- payments: ${analytics.paymentSummary.events} payment_completed events / ${analytics.paymentSummary.sessions} sessions / ${analytics.paymentSummary.dedupGroups} dedup groups`,
    )
    lines.push(
      `- checkout failures: ${analytics.checkoutFailures.events} events across ${analytics.checkoutFailures.sessions} sessions`,
    )
    if (analytics.stages?.length) {
      lines.push(
        `- top stop stages: ${analytics.stages.map((entry) => `${formatStageLabel(entry.last_stage)} (${entry.sessions})`).join(', ')}`,
      )
    }

    if (analytics.topReferrers?.length) {
      lines.push(
        `- top referrers: ${analytics.topReferrers.map((entry) => `${formatReferrerLabel(entry.host)} (${entry.sessions})`).join(', ')}`,
      )
    }

    if (analytics.topLandingPaths?.length) {
      lines.push(`- top landing paths: ${analytics.topLandingPaths.map((entry) => `${entry.landing_path} (${entry.sessions})`).join(', ')}`)
    }

    if (analytics.pageRoutes?.length) {
      lines.push('')
      lines.push('Page Visits (Analytics page_view)')
      for (const pageRoute of analytics.pageRoutes) {
        lines.push(`- ${pageRoute.pagePath}: ${pageRoute.pageViews} page views / ${pageRoute.sessions} sessions`)
      }
    }

    if (analytics.topCtaClicks?.length) {
      lines.push('')
      lines.push('Top CTA Clicks')
      for (const cta of analytics.topCtaClicks) {
        lines.push(`- ${cta.key} / ${cta.section}: ${cta.clicks} clicks / ${cta.sessions} sessions`)
      }
    }

    if (analytics.utmSources?.length) {
      lines.push(`- utm sources: ${analytics.utmSources.map((entry) => `${entry.utm_source} (${entry.sessions})`).join(', ')}`)
    } else {
      lines.push('- utm sources: none recorded')
    }

    lines.push(
      `- funnel: landing ${analytics.funnel.landingViewed}, pricing ${analytics.funnel.pricingViewed}, launch ${analytics.funnel.launchClicked}, plan ${analytics.funnel.planSelected}, checkout ${analytics.funnel.checkoutStarted}, redirect ${analytics.funnel.checkoutRedirected}, payment sessions ${analytics.funnel.paymentCompletedSessions}, payment dedup ${analytics.funnel.paymentCompletedDedup}, console ${analytics.funnel.consoleViewed}`,
    )

    if (analytics.checkoutFailureSessions?.length) {
      lines.push('')
      lines.push('Checkout Failure Sessions')
      for (const failure of analytics.checkoutFailureSessions) {
        lines.push(
          `- ${formatIsoForTimeZone(failure.firstFailedAt)} to ${formatIsoForTimeZone(failure.lastFailedAt)} | visitor ${failure.visitorId} | session ${failure.sessionId} | ${failure.failedCount} failures | later payments ${failure.laterPaymentGroups} | ${failure.landingPath}`,
        )
      }
    }

    if (analytics.paymentGroups?.length) {
      lines.push('')
      lines.push('Payment Groups')
      for (const paymentGroup of analytics.paymentGroups) {
        lines.push(
          `- ${formatIsoForTimeZone(paymentGroup.firstPaymentAt)} | visitor ${paymentGroup.visitorId} | session ${paymentGroup.sessionId} | key ${paymentGroup.paymentKey} | events ${paymentGroup.eventCount}`,
        )
      }
    }
  }

  if (report.requestLogs) {
    const requestLogs = report.requestLogs
    lines.push('')
    lines.push(`Request Logs (${requestLogs.windowDays}d)`)
    lines.push(
      `- parsed nginx requests: ${requestLogs.parsedRequests} from ${requestLogs.firstRequestAt || 'n/a'} to ${requestLogs.lastRequestAt || 'n/a'}`,
    )
    lines.push(
      `- request types: page ${requestLogs.typeCounts.page}, api ${requestLogs.typeCounts.api}, static ${requestLogs.typeCounts.staticAsset}, console proxy ${requestLogs.typeCounts.consoleProxy}, suspicious scan ${requestLogs.typeCounts.suspiciousScan}, other ${requestLogs.typeCounts.other}`,
    )
    lines.push(
      `- unique IPs: all ${requestLogs.uniqueIps.all}, page ${requestLogs.uniqueIps.page}, api ${requestLogs.uniqueIps.api}`,
    )
    lines.push(
      `- status buckets: 2xx ${requestLogs.statusCounts['2xx']}, 3xx ${requestLogs.statusCounts['3xx']}, 4xx ${requestLogs.statusCounts['4xx']}, 5xx ${requestLogs.statusCounts['5xx']}`,
    )

    if (requestLogs.topPagePaths?.length) {
      lines.push('')
      lines.push('Page Requests (Nginx)')
      for (const entry of requestLogs.topPagePaths) {
        lines.push(`- ${entry.path}: ${entry.requests} requests`)
      }
    }

    if (requestLogs.topApiPaths?.length) {
      lines.push(`- top api paths: ${requestLogs.topApiPaths.map((entry) => `${entry.path} (${entry.requests})`).join(', ')}`)
    }

    if (requestLogs.topScanPaths?.length) {
      lines.push(`- top suspicious paths: ${requestLogs.topScanPaths.map((entry) => `${entry.path} (${entry.requests})`).join(', ')}`)
    }
  }

  if (report.insights?.length) {
    lines.push('')
    lines.push('Insights')
    for (const insight of report.insights) {
      lines.push(`- ${insight}`)
    }
  }

  return `${lines.join('\n')}\n`
}

async function buildReport({
  projectRoot = scriptProjectRoot,
  environment = process.env,
  options = parseArguments(process.argv.slice(2)),
} = {}) {
  const runtimeMode = resolveRuntimeMode(process.argv, environment)

  loadLocalEnvironment({
    projectRoot,
    runtimeMode,
    environment,
  })

  if (options.cloudflareD1) {
    const origin = resolvePublicOrigin(environment.APP_ORIGIN, options.origin)
    const d1DatabaseName = resolveCloudflareD1DatabaseName({
      projectRoot,
      explicitName: options.d1Database,
    })
    const report = {
      generatedAt: new Date().toISOString(),
      serviceName: 'cloudflare-d1',
      remoteEnvFile: null,
      siteOrigin: origin,
      ssh: null,
      database: {
        identity: `Cloudflare D1 ${d1DatabaseName} (remote)`,
      },
      health: null,
      analytics: null,
      requestLogs: null,
      insights: [],
    }

    if (!options.skipHealth && origin) {
      const normalizedOrigin = origin.replace(/\/+$/, '')
      report.health = {
        service: null,
        origin: await fetchHealthEndpoint(normalizedOrigin),
        runtime: await fetchHealthEndpoint(normalizedOrigin ? `${normalizedOrigin}/api/runtime` : ''),
        authMe: await fetchHealthEndpoint(normalizedOrigin ? `${normalizedOrigin}/api/auth/me` : ''),
      }
    }

    if (!options.skipAnalytics) {
      report.analytics = await runCloudflareD1AnalyticsSummary({
        days: options.days,
        d1DatabaseName,
        environment,
        projectRoot,
      })
    }

    report.insights = buildInsights(report)
    return report
  }

  if (options.localDb) {
    const origin = resolvePublicOrigin(environment.APP_ORIGIN, options.origin)
    const postgresConfig = resolveLocalPostgresConfig({
      environment,
      projectRoot,
      secretFile: options.secretFile,
    })
    const report = {
      generatedAt: new Date().toISOString(),
      serviceName: 'local-db',
      remoteEnvFile: null,
      siteOrigin: origin,
      ssh: null,
      database: {
        identity: postgresConfig.identity,
      },
      health: null,
      analytics: null,
      requestLogs: null,
      insights: [],
    }

    if (!options.skipHealth && origin) {
      const normalizedOrigin = origin.replace(/\/+$/, '')
      report.health = {
        service: null,
        origin: await fetchHealthEndpoint(normalizedOrigin),
        runtime: await fetchHealthEndpoint(normalizedOrigin ? `${normalizedOrigin}/api/runtime` : ''),
        authMe: await fetchHealthEndpoint(normalizedOrigin ? `${normalizedOrigin}/api/auth/me` : ''),
      }
    }

    if (!options.skipAnalytics) {
      report.analytics = await runLocalPsqlJson(
        {
          environment,
          projectRoot,
          secretFile: options.secretFile,
        },
        buildAnalyticsSummarySql(options.days),
      )
    }

    report.insights = buildInsights(report)
    return report
  }

  const ssh = resolveSshConfig({ projectRoot, options, environment })
  const client = await connectSsh(ssh)

  try {
    const remoteEnvFile = await discoverRemoteEnvFile(client, options.serviceName, options.remoteEnvFile)
    const remoteAppOrigin = options.origin ? '' : await readRemoteAppOrigin(client, remoteEnvFile)
    const origin = resolvePublicOrigin(remoteAppOrigin || environment.APP_ORIGIN, options.origin)
    const report = {
      generatedAt: new Date().toISOString(),
      serviceName: options.serviceName,
      remoteEnvFile,
      siteOrigin: origin,
      ssh: {
        host: ssh.host,
        port: ssh.port,
        username: ssh.username,
        auth: ssh.privateKeyPath ? `key:${ssh.privateKeyPath}` : 'password',
      },
      health: null,
      analytics: null,
      requestLogs: null,
      insights: [],
    }

    if (!options.skipHealth) {
      const service = await checkServiceHealth(client, options.serviceName)
      const normalizedOrigin = origin.replace(/\/+$/, '')
      report.health = {
        service,
        origin: await fetchHealthEndpoint(normalizedOrigin),
        runtime: await fetchHealthEndpoint(normalizedOrigin ? `${normalizedOrigin}/api/runtime` : ''),
        authMe: await fetchHealthEndpoint(normalizedOrigin ? `${normalizedOrigin}/api/auth/me` : ''),
      }
    }

    if (!options.skipAnalytics) {
      report.analytics = await runRemotePsqlJson(client, remoteEnvFile, buildAnalyticsSummarySql(options.days))
    }

    if (!options.skipRequestLogs) {
      report.requestLogs = await runRemoteRequestLogSummary(client, options.days)
    }

    report.insights = buildInsights(report)

    return report
  } finally {
    client.end()
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    printUsage()
    return
  }

  const report = await buildReport({ options })
  const output = options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderTextReport(report)

  if (options.outputPath) {
    writeFileSync(resolve(process.cwd(), options.outputPath), output, 'utf8')
  }

  process.stdout.write(output)
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : ''
const currentFile = fileURLToPath(import.meta.url)

if (entryPoint === currentFile) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exitCode = 1
  })
}

export {
  buildInsights,
  buildReport,
  parseArguments,
  parseEnvironmentFileFromServiceUnit,
  renderTextReport,
  resolvePublicOrigin,
  resolveSshConfig,
}
