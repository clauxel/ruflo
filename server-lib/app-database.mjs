import { createServer as createNetServer } from 'node:net'
import { Pool } from 'pg'
import { Client as SshClient } from 'ssh2'

function parseBoolean(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) {
    return fallback
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }

  return fallback
}

function isLoopbackHost(host) {
  const normalized = String(host ?? '').trim().toLowerCase()
  return (
    !normalized ||
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  )
}

function assertRemovedSqliteConfig(environment) {
  const explicitProvider = String(environment.MULTICA_DB_PROVIDER ?? '').trim().toLowerCase()
  const databasePath = String(environment.MULTICA_DB_PATH ?? '').trim()

  if (explicitProvider === 'sqlite') {
    throw new Error('SQLite support has been removed. Remove MULTICA_DB_PROVIDER=sqlite and configure PostgreSQL instead.')
  }

  if (databasePath) {
    throw new Error('MULTICA_DB_PATH is no longer supported. Configure PostgreSQL with MULTICA_POSTGRES_* variables instead.')
  }
}

function normalizePostgresDriver(environment) {
  const explicitDriver = String(environment.MULTICA_POSTGRES_DRIVER ?? '').trim().toLowerCase()
  return explicitDriver === 'memory' ? 'memory' : 'tcp'
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value ?? '').trim()
    if (normalized) {
      return normalized
    }
  }

  return ''
}

function translateSqlParameters(sql) {
  let parameterIndex = 0
  return sql.replace(/\?/g, () => `$${++parameterIndex}`)
}

function normalizeSslConfig(environment, sslModeOverride = '') {
  const sslMode = firstNonEmpty(
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

function normalizeConnectionUrl(environment) {
  const rawUrl = firstNonEmpty(
    environment.MULTICA_POSTGRES_URL,
    environment.DATABASE_URL,
    environment.POSTGRES_URL,
    environment.POSTGRES_PRISMA_URL,
  )

  if (!rawUrl) {
    return null
  }

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
    rawUrl,
    parsedUrl,
  }
}

function buildIdentityFromUrl(parsedUrl) {
  const user = decodeURIComponent(parsedUrl.username || 'postgres')
  const database = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, '') || 'postgres')
  const port = parsedUrl.port || '5432'

  return `${user}@${parsedUrl.hostname}:${port}/${database}`
}

function buildPostgresConfig(environment) {
  if (normalizePostgresDriver(environment) === 'memory') {
    return {
      driver: 'memory',
      memoryId: String(environment.MULTICA_POSTGRES_MEMORY_ID ?? 'default').trim() || 'default',
    }
  }

  const connectionUrl = normalizeConnectionUrl(environment)
  if (connectionUrl) {
    const sslMode = connectionUrl.parsedUrl.searchParams.get('sslmode') ?? ''

    return {
      driver: 'tcp',
      connectionString: connectionUrl.rawUrl,
      host: connectionUrl.parsedUrl.hostname,
      database: decodeURIComponent(connectionUrl.parsedUrl.pathname.replace(/^\/+/, '') || 'postgres'),
      user: decodeURIComponent(connectionUrl.parsedUrl.username || 'postgres'),
      port: Number.parseInt(connectionUrl.parsedUrl.port || '5432', 10),
      ssl: normalizeSslConfig(environment, sslMode),
      enableChannelBinding: connectionUrl.parsedUrl.searchParams.get('channel_binding') === 'require',
      identity: buildIdentityFromUrl(connectionUrl.parsedUrl),
    }
  }

  const host = firstNonEmpty(environment.MULTICA_POSTGRES_HOST, environment.PGHOST, environment.POSTGRES_HOST)
  const database = firstNonEmpty(environment.MULTICA_POSTGRES_DB, environment.PGDATABASE, environment.POSTGRES_DATABASE)
  const user = firstNonEmpty(environment.MULTICA_POSTGRES_USER, environment.PGUSER, environment.POSTGRES_USER)
  const password = firstNonEmpty(environment.MULTICA_POSTGRES_PASSWORD, environment.PGPASSWORD, environment.POSTGRES_PASSWORD)
  const portValue = Number.parseInt(
    firstNonEmpty(environment.MULTICA_POSTGRES_PORT, environment.PGPORT, environment.POSTGRES_PORT, '5432'),
    10,
  )
  const port = Number.isInteger(portValue) && portValue > 0 ? portValue : 5432

  if (!host || !database || !user || !password) {
    throw new Error(
      'Missing PostgreSQL configuration. Set MULTICA_POSTGRES_HOST, MULTICA_POSTGRES_DB, MULTICA_POSTGRES_USER, and MULTICA_POSTGRES_PASSWORD.',
    )
  }

  return {
    driver: 'tcp',
    host,
    database,
    user,
    password,
    port,
    ssl: normalizeSslConfig(environment),
    identity: `${user}@${host}:${port}/${database}`,
  }
}

async function createSshTunnel({
  sshHost,
  sshPort,
  sshUsername,
  sshPassword,
  remoteHost,
  remotePort,
}) {
  const sshClient = new SshClient()

  await new Promise((resolve, reject) => {
    let settled = false
    const fail = (error) => {
      if (settled) {
        return
      }

      settled = true
      reject(error)
    }

    sshClient
      .on('ready', () => {
        if (settled) {
          return
        }

        settled = true
        resolve()
      })
      .on('error', fail)
      .connect({
        host: sshHost,
        port: sshPort,
        username: sshUsername,
        password: sshPassword,
        readyTimeout: 15_000,
      })
  })

  const tunnelServer = createNetServer((socket) => {
    sshClient.forwardOut(
      socket.remoteAddress || '127.0.0.1',
      socket.remotePort || 0,
      remoteHost,
      remotePort,
      (error, stream) => {
        if (error) {
          socket.destroy(error)
          return
        }

        socket.pipe(stream)
        stream.pipe(socket)
        stream.on('error', () => socket.destroy())
        socket.on('error', () => stream.destroy())
      },
    )
  })

  await new Promise((resolve, reject) => {
    tunnelServer.once('error', reject)
    tunnelServer.listen(0, '127.0.0.1', () => {
      tunnelServer.removeListener('error', reject)
      resolve()
    })
  })

  const address = tunnelServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to determine PostgreSQL SSH tunnel address.')
  }

  return {
    host: '127.0.0.1',
    port: address.port,
    close: async () => {
      await new Promise((resolve) => tunnelServer.close(() => resolve()))
      sshClient.end()
    },
  }
}

class AsyncPostgresStatement {
  constructor(pool, sql) {
    this.pool = pool
    this.sql = translateSqlParameters(sql)
  }

  async get(...params) {
    const result = await this.pool.query(this.sql, params)
    return result.rows[0] ?? undefined
  }

  async all(...params) {
    const result = await this.pool.query(this.sql, params)
    return result.rows
  }

  async run(...params) {
    const result = await this.pool.query(this.sql, params)
    return {
      changes: result.rowCount ?? 0,
      lastInsertRowid: null,
    }
  }
}

class AsyncPostgresDatabase {
  constructor(pool, tunnel = null) {
    this.pool = pool
    this.provider = 'postgres'
    this.tunnel = tunnel
  }

  prepare(sql) {
    return new AsyncPostgresStatement(this.pool, sql)
  }

  async exec(sql) {
    await this.pool.query(sql)
  }

  async close() {
    await this.pool.end()
    if (this.tunnel?.close) {
      await this.tunnel.close()
    }
  }
}

async function initializePostgresDatabase(database) {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      guest_token TEXT,
      plan_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      token_cipher_text TEXT NOT NULL,
      token_iv TEXT NOT NULL,
      token_tag TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      deployment_status TEXT NOT NULL,
      status_message TEXT NOT NULL,
      deployment_eta_minutes INTEGER NOT NULL,
      included_deployments INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      creem_checkout_id TEXT,
      paypal_order_id TEXT,
      paid_at TEXT
    );

    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trigger_mode TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      instance_name TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL,
      eta_minutes INTEGER NOT NULL,
      target_server TEXT NOT NULL,
      workspace_path TEXT,
      console_url TEXT,
      public_endpoint TEXT,
      runtime_user TEXT,
      service_name TEXT,
      console_token_cipher_text TEXT,
      console_token_iv TEXT,
      console_token_tag TEXT,
      last_message TEXT NOT NULL,
      run_logs TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_instances (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      deployment_id TEXT NOT NULL UNIQUE REFERENCES deployments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sequence_number INTEGER NOT NULL,
      instance_name TEXT NOT NULL UNIQUE,
      model_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      status TEXT NOT NULL,
      target_server TEXT NOT NULL,
      workspace_path TEXT,
      console_url TEXT,
      public_endpoint TEXT,
      runtime_user TEXT,
      service_name TEXT,
      runtime_state TEXT,
      multica_version TEXT,
      upgrade_status TEXT NOT NULL DEFAULT 'idle',
      upgrade_target_version TEXT,
      upgrade_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS creem_products (
      lookup_key TEXT PRIMARY KEY,
      product_id TEXT NOT NULL UNIQUE,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analytics_sessions (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      user_id TEXT,
      landing_path TEXT NOT NULL,
      referrer_host TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_term TEXT,
      utm_content TEXT,
      device_type TEXT NOT NULL,
      browser_language TEXT,
      event_count INTEGER NOT NULL DEFAULT 0,
      click_count INTEGER NOT NULL DEFAULT 0,
      section_view_count INTEGER NOT NULL DEFAULT 0,
      page_view_count INTEGER NOT NULL DEFAULT 0,
      last_event_name TEXT,
      last_route_path TEXT,
      last_stage TEXT NOT NULL DEFAULT 'unknown',
      started_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      user_id TEXT,
      order_id TEXT,
      event_type TEXT NOT NULL,
      event_name TEXT NOT NULL,
      route_path TEXT NOT NULL,
      page_key TEXT,
      section_key TEXT,
      element_key TEXT,
      referrer_host TEXT,
      metadata_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)

  await database.exec(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_token TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS creem_checkout_id TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_order_id TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS included_deployments INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE deployments ADD COLUMN IF NOT EXISTS sequence_number INTEGER;
    ALTER TABLE deployments ADD COLUMN IF NOT EXISTS runtime_user TEXT;
    ALTER TABLE deployments ADD COLUMN IF NOT EXISTS service_name TEXT;
    ALTER TABLE deployments ADD COLUMN IF NOT EXISTS console_token_cipher_text TEXT;
    ALTER TABLE deployments ADD COLUMN IF NOT EXISTS console_token_iv TEXT;
    ALTER TABLE deployments ADD COLUMN IF NOT EXISTS console_token_tag TEXT;
    ALTER TABLE deployments ADD COLUMN IF NOT EXISTS run_logs TEXT NOT NULL DEFAULT '';
    ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS sequence_number INTEGER;
    ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS runtime_state TEXT;
    ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS multica_version TEXT;
    ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS upgrade_status TEXT NOT NULL DEFAULT 'idle';
    ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS upgrade_target_version TEXT;
    ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS upgrade_error TEXT;
  `)

  await database.exec(`
    UPDATE orders
    SET included_deployments = CASE
      WHEN plan_id LIKE 'scale:%' THEN 20
      WHEN plan_id LIKE 'growth:%' THEN 5
      ELSE 1
    END
    WHERE included_deployments IS NULL OR included_deployments <= 0;

    UPDATE deployments
    SET sequence_number = 1
    WHERE sequence_number IS NULL;

    UPDATE agent_instances
    SET sequence_number = COALESCE(deployments.sequence_number, 1)
    FROM deployments
    WHERE agent_instances.sequence_number IS NULL
      AND deployments.id = agent_instances.deployment_id;

    UPDATE agent_instances
    SET sequence_number = 1
    WHERE sequence_number IS NULL;

    UPDATE agent_instances
    SET runtime_state = CASE
      WHEN status = 'running' THEN 'running'
      ELSE NULL
    END
    WHERE runtime_state IS NULL;

    UPDATE agent_instances
    SET upgrade_status = 'idle'
    WHERE upgrade_status IS NULL OR upgrade_status = '';
  `)

  await database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS deployments_order_sequence_idx ON deployments(order_id, sequence_number);
    CREATE INDEX IF NOT EXISTS analytics_sessions_started_at_idx ON analytics_sessions(started_at);
    CREATE INDEX IF NOT EXISTS analytics_sessions_last_seen_at_idx ON analytics_sessions(last_seen_at);
    CREATE INDEX IF NOT EXISTS analytics_sessions_visitor_id_idx ON analytics_sessions(visitor_id);
    CREATE INDEX IF NOT EXISTS analytics_events_session_id_idx ON analytics_events(session_id);
    CREATE INDEX IF NOT EXISTS analytics_events_occurred_at_idx ON analytics_events(occurred_at);
    CREATE INDEX IF NOT EXISTS analytics_events_event_name_idx ON analytics_events(event_name);
    CREATE INDEX IF NOT EXISTS analytics_events_route_path_idx ON analytics_events(route_path);
    CREATE INDEX IF NOT EXISTS analytics_events_element_key_idx ON analytics_events(element_key);
  `)
}

export async function initializeAppDatabase(database) {
  if (database.memoryPostgresId) {
    const {
      isMemoryPostgresSchemaInitialized,
      markMemoryPostgresSchemaInitialized,
    } = await import('./postgres-memory-adapter.mjs')

    if (isMemoryPostgresSchemaInitialized(database.memoryPostgresId)) {
      return
    }

    await initializePostgresDatabase(database)
    markMemoryPostgresSchemaInitialized(database.memoryPostgresId)
    return
  }

  await initializePostgresDatabase(database)
}

export async function createAppDatabase({
  projectRoot,
  runtimeMode = 'development',
  environment = process.env,
}) {
  void projectRoot
  assertRemovedSqliteConfig(environment)
  const postgresConfig = buildPostgresConfig(environment)

  if (postgresConfig.driver === 'memory') {
    const { getOrCreateMemoryPostgresAdapter } = await import('./postgres-memory-adapter.mjs')
    const adapter = getOrCreateMemoryPostgresAdapter(postgresConfig.memoryId)
    const pool = new adapter.Pool()
    const database = new AsyncPostgresDatabase(pool)
    database.memoryPostgresId = postgresConfig.memoryId
    await pool.query('SELECT 1')

    return {
      database,
      provider: 'postgres',
      identity: `pg-memory:${postgresConfig.memoryId}`,
    }
  }

  const explicitTunnel = String(environment.MULTICA_POSTGRES_USE_SSH_TUNNEL ?? '').trim()
  const shouldUseTunnel =
    explicitTunnel
      ? parseBoolean(explicitTunnel, false)
      : !postgresConfig.connectionString &&
        runtimeMode === 'development' &&
        !isLoopbackHost(postgresConfig.host) &&
        Boolean(String(environment.MULTICA_DEPLOY_HOST ?? '').trim())

  let tunnel = null
  let connectionHost = postgresConfig.host
  let connectionPort = postgresConfig.port

  if (shouldUseTunnel) {
    const sshHost = String(environment.MULTICA_DEPLOY_HOST ?? '').trim()
    const sshUsername = String(environment.MULTICA_DEPLOY_USERNAME ?? 'root').trim() || 'root'
    const sshPassword = String(environment.MULTICA_DEPLOY_ROOT_PASSWORD ?? '').trim()
    const sshPortValue = Number.parseInt(String(environment.MULTICA_DEPLOY_PORT ?? '22').trim(), 10)
    const sshPort = Number.isInteger(sshPortValue) && sshPortValue > 0 ? sshPortValue : 22

    if (!sshHost || !sshPassword) {
      throw new Error(
        'PostgreSQL SSH tunnel requires MULTICA_DEPLOY_HOST and MULTICA_DEPLOY_ROOT_PASSWORD.',
      )
    }

    tunnel = await createSshTunnel({
      sshHost,
      sshPort,
      sshUsername,
      sshPassword,
      remoteHost: postgresConfig.host === sshHost ? '127.0.0.1' : postgresConfig.host,
      remotePort: postgresConfig.port,
    })
    connectionHost = tunnel.host
    connectionPort = tunnel.port
  }

  const pool = new Pool({
    ...(postgresConfig.connectionString
      ? {
          connectionString: postgresConfig.connectionString,
          ...(postgresConfig.ssl ? { ssl: postgresConfig.ssl } : {}),
          ...(postgresConfig.enableChannelBinding ? { enableChannelBinding: true } : {}),
        }
      : {
          host: connectionHost,
          port: connectionPort,
          database: postgresConfig.database,
          user: postgresConfig.user,
          password: postgresConfig.password,
          ssl: postgresConfig.ssl,
        }),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  })

  const database = new AsyncPostgresDatabase(pool, tunnel)
  await pool.query('SELECT 1')

  return {
    database,
    provider: 'postgres',
    identity: postgresConfig.identity,
  }
}
