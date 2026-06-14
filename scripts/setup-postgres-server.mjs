import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'ssh2'

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

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function sqlIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function loadPostgresSetupConfig(environment = process.env) {
  const sshHost = firstDefined(
    environment.MULTICA_DEPLOY_HOST,
    environment.MULTICA_SERVER_IP,
    environment.MULTICA_SERVER_HOST,
  )
  const sshPassword = firstDefined(
    environment.MULTICA_DEPLOY_ROOT_PASSWORD,
    environment.MULTICA_ROOT_PASSWORD,
    environment.MULTICA_DEPLOY_PASSWORD,
  )
  const databasePassword = firstDefined(environment.MULTICA_POSTGRES_PASSWORD)

  if (!sshHost) {
    throw new Error(
      'Missing server host. Set MULTICA_DEPLOY_HOST, MULTICA_SERVER_IP, or MULTICA_SERVER_HOST.',
    )
  }

  if (!sshPassword) {
    throw new Error(
      'Missing root password. Set MULTICA_DEPLOY_ROOT_PASSWORD, MULTICA_ROOT_PASSWORD, or MULTICA_DEPLOY_PASSWORD.',
    )
  }

  if (!databasePassword) {
    throw new Error('Missing database password. Set MULTICA_POSTGRES_PASSWORD.')
  }

  return {
    sshHost,
    sshPort: parseInteger(environment.MULTICA_DEPLOY_PORT, 22),
    sshUsername: firstDefined(environment.MULTICA_DEPLOY_USERNAME) || 'root',
    sshPassword,
    databaseName: firstDefined(environment.MULTICA_POSTGRES_DB) || 'multica_app',
    databaseUser: firstDefined(environment.MULTICA_POSTGRES_USER) || 'multica_app',
    databasePassword,
    databasePort: parseInteger(environment.MULTICA_POSTGRES_PORT, 5432),
    allowedCidr: firstDefined(environment.MULTICA_POSTGRES_ALLOWED_CIDR) || '0.0.0.0/0',
  }
}

export function renderPostgresRemoteScript(config) {
  const createRoleSql = [
    'DO $$',
    'BEGIN',
    `  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(config.databaseUser)}) THEN`,
    `    CREATE ROLE ${sqlIdentifier(config.databaseUser)} LOGIN PASSWORD ${sqlLiteral(config.databasePassword)};`,
    '  ELSE',
    `    ALTER ROLE ${sqlIdentifier(config.databaseUser)} WITH LOGIN PASSWORD ${sqlLiteral(config.databasePassword)};`,
    '  END IF;',
    'END',
    '$$;',
  ].join('\n')
  const createDatabaseSql = `CREATE DATABASE ${sqlIdentifier(config.databaseName)} OWNER ${sqlIdentifier(config.databaseUser)};`
  const alterDatabaseOwnerSql = `ALTER DATABASE ${sqlIdentifier(config.databaseName)} OWNER TO ${sqlIdentifier(config.databaseUser)};`
  const grantDatabaseSql = [
    `REVOKE ALL ON DATABASE ${sqlIdentifier(config.databaseName)} FROM PUBLIC;`,
    `GRANT ALL PRIVILEGES ON DATABASE ${sqlIdentifier(config.databaseName)} TO ${sqlIdentifier(config.databaseUser)};`,
  ].join('\n')
  const grantSchemaSql = [
    `ALTER SCHEMA public OWNER TO ${sqlIdentifier(config.databaseUser)};`,
    `GRANT ALL ON SCHEMA public TO ${sqlIdentifier(config.databaseUser)};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${sqlIdentifier(config.databaseUser)};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${sqlIdentifier(config.databaseUser)};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO ${sqlIdentifier(config.databaseUser)};`,
  ].join('\n')
  const roleExistsSql = `SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(config.databaseUser)};`
  const databaseExistsSql = `SELECT 1 FROM pg_database WHERE datname = ${sqlLiteral(config.databaseName)};`
  const roleExistsSqlBase64 = Buffer.from(roleExistsSql, 'utf8').toString('base64')
  const databaseExistsSqlBase64 = Buffer.from(databaseExistsSql, 'utf8').toString('base64')
  const createRoleSqlBase64 = Buffer.from(createRoleSql, 'utf8').toString('base64')
  const createDatabaseSqlBase64 = Buffer.from(createDatabaseSql, 'utf8').toString('base64')
  const alterDatabaseOwnerSqlBase64 = Buffer.from(alterDatabaseOwnerSql, 'utf8').toString('base64')
  const grantDatabaseSqlBase64 = Buffer.from(grantDatabaseSql, 'utf8').toString('base64')
  const grantSchemaSqlBase64 = Buffer.from(grantSchemaSql, 'utf8').toString('base64')

  return `set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
DB_NAME=${shellEscape(config.databaseName)}
DB_USER=${shellEscape(config.databaseUser)}
DB_PASSWORD=${shellEscape(config.databasePassword)}
DB_PORT=${shellEscape(String(config.databasePort))}
ALLOWED_CIDR=${shellEscape(config.allowedCidr)}
ROLE_EXISTS_SQL_B64=${shellEscape(roleExistsSqlBase64)}
DATABASE_EXISTS_SQL_B64=${shellEscape(databaseExistsSqlBase64)}
CREATE_ROLE_SQL_B64=${shellEscape(createRoleSqlBase64)}
CREATE_DATABASE_SQL_B64=${shellEscape(createDatabaseSqlBase64)}
ALTER_DATABASE_OWNER_SQL_B64=${shellEscape(alterDatabaseOwnerSqlBase64)}
GRANT_DATABASE_SQL_B64=${shellEscape(grantDatabaseSqlBase64)}
GRANT_SCHEMA_SQL_B64=${shellEscape(grantSchemaSqlBase64)}

if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y postgresql postgresql-contrib
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y postgresql-server postgresql-contrib
  if [ ! -f /var/lib/pgsql/data/PG_VERSION ]; then
    postgresql-setup --initdb
  fi
elif command -v yum >/dev/null 2>&1; then
  yum install -y postgresql-server postgresql-contrib
  if [ ! -f /var/lib/pgsql/data/PG_VERSION ]; then
    postgresql-setup initdb
  fi
else
  echo "Unsupported package manager. Expected apt-get, dnf, or yum." >&2
  exit 1
fi

PG_SERVICE=$(systemctl list-unit-files 'postgresql*.service' --no-legend 2>/dev/null | awk 'NR==1 {print $1}')
PG_SERVICE=${'$'}{PG_SERVICE%.service}
if [ -z "$PG_SERVICE" ]; then
  PG_SERVICE=postgresql
fi

systemctl enable "$PG_SERVICE"
systemctl restart "$PG_SERVICE" || systemctl start "$PG_SERVICE"

postgres_exec() {
  su - postgres -c "$1"
}

SQL_DIR=$(mktemp -d)
trap 'rm -rf "$SQL_DIR"' EXIT
printf '%s' "$ROLE_EXISTS_SQL_B64" | base64 -d > "$SQL_DIR/role-exists.sql"
printf '%s' "$DATABASE_EXISTS_SQL_B64" | base64 -d > "$SQL_DIR/database-exists.sql"
printf '%s' "$CREATE_ROLE_SQL_B64" | base64 -d > "$SQL_DIR/create-role.sql"
printf '%s' "$CREATE_DATABASE_SQL_B64" | base64 -d > "$SQL_DIR/create-database.sql"
printf '%s' "$ALTER_DATABASE_OWNER_SQL_B64" | base64 -d > "$SQL_DIR/alter-database-owner.sql"
printf '%s' "$GRANT_DATABASE_SQL_B64" | base64 -d > "$SQL_DIR/grant-database.sql"
printf '%s' "$GRANT_SCHEMA_SQL_B64" | base64 -d > "$SQL_DIR/grant-schema.sql"

PG_CONFIG_FILE=$(postgres_exec "psql -Atqc \"SHOW config_file\"" | tr -d '\\r')
if [ -z "$PG_CONFIG_FILE" ] || [ ! -f "$PG_CONFIG_FILE" ]; then
  PG_CONFIG_FILE=$(find /etc/postgresql /var/lib/pgsql -name postgresql.conf 2>/dev/null | head -n 1)
fi
if [ -z "$PG_CONFIG_FILE" ] || [ ! -f "$PG_CONFIG_FILE" ]; then
  echo "Unable to locate postgresql.conf." >&2
  exit 1
fi

PG_HBA_FILE="$(dirname "$PG_CONFIG_FILE")/pg_hba.conf"
if [ ! -f "$PG_HBA_FILE" ]; then
  echo "Unable to locate pg_hba.conf." >&2
  exit 1
fi

if grep -Eq "^[#[:space:]]*listen_addresses[[:space:]]*=" "$PG_CONFIG_FILE"; then
  sed -i -E "s|^[#[:space:]]*listen_addresses[[:space:]]*=.*$|listen_addresses = '*'|" "$PG_CONFIG_FILE"
else
  printf "\\nlisten_addresses = '*'\\n" >> "$PG_CONFIG_FILE"
fi

if grep -Eq "^[#[:space:]]*port[[:space:]]*=" "$PG_CONFIG_FILE"; then
  sed -i -E "s|^[#[:space:]]*port[[:space:]]*=.*$|port = $DB_PORT|" "$PG_CONFIG_FILE"
else
  printf "\\nport = %s\\n" "$DB_PORT" >> "$PG_CONFIG_FILE"
fi

if grep -Eq "^[#[:space:]]*password_encryption[[:space:]]*=" "$PG_CONFIG_FILE"; then
  sed -i -E "s|^[#[:space:]]*password_encryption[[:space:]]*=.*$|password_encryption = scram-sha-256|" "$PG_CONFIG_FILE"
else
  printf "\\npassword_encryption = scram-sha-256\\n" >> "$PG_CONFIG_FILE"
fi

HBA_LINE="host    $DB_NAME    $DB_USER    $ALLOWED_CIDR    scram-sha-256"
if ! grep -Fq "$HBA_LINE" "$PG_HBA_FILE"; then
  printf "\\n%s\\n" "$HBA_LINE" >> "$PG_HBA_FILE"
fi

systemctl restart "$PG_SERVICE"

ROLE_EXISTS=$(postgres_exec "psql -Atqf $SQL_DIR/role-exists.sql" | tr -d '[:space:]')
postgres_exec "psql -v ON_ERROR_STOP=1 -f $SQL_DIR/create-role.sql"

DATABASE_EXISTS=$(postgres_exec "psql -Atqf $SQL_DIR/database-exists.sql" | tr -d '[:space:]')
if [ "$DATABASE_EXISTS" = "1" ]; then
  postgres_exec "psql -v ON_ERROR_STOP=1 -f $SQL_DIR/alter-database-owner.sql"
else
  postgres_exec "psql -v ON_ERROR_STOP=1 -f $SQL_DIR/create-database.sql"
fi

postgres_exec "psql -v ON_ERROR_STOP=1 -f $SQL_DIR/grant-database.sql"
postgres_exec "psql -v ON_ERROR_STOP=1 -d $DB_NAME -f $SQL_DIR/grant-schema.sql"

if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active firewalld >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="$DB_PORT/tcp" >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
elif command -v ufw >/dev/null 2>&1; then
  ufw allow "$DB_PORT/tcp" >/dev/null 2>&1 || true
elif command -v iptables >/dev/null 2>&1; then
  iptables -C INPUT -p tcp --dport "$DB_PORT" -j ACCEPT >/dev/null 2>&1 ||
    iptables -I INPUT -p tcp --dport "$DB_PORT" -j ACCEPT >/dev/null 2>&1 || true
fi

pg_isready -h 127.0.0.1 -p "$DB_PORT" -d "$DB_NAME" >/dev/null 2>&1

printf '{"serviceName":"%s","configFile":"%s","pgHbaFile":"%s","databasePort":%s,"databaseName":"%s","databaseUser":"%s","allowedCidr":"%s"}\\n' \
  "$PG_SERVICE" \
  "$PG_CONFIG_FILE" \
  "$PG_HBA_FILE" \
  "$DB_PORT" \
  "$DB_NAME" \
  "$DB_USER" \
  "$ALLOWED_CIDR"
`
}

export function parseStructuredOutput(stdout) {
  const lines = String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index])
    } catch {}
  }

  throw new Error('Remote PostgreSQL setup did not return structured output.')
}

export function buildDatabaseUrl(config, remoteResult) {
  const username = encodeURIComponent(remoteResult.databaseUser ?? config.databaseUser)
  const password = encodeURIComponent(config.databasePassword)
  const databaseName = encodeURIComponent(remoteResult.databaseName ?? config.databaseName)
  const databasePort = Number(remoteResult.databasePort ?? config.databasePort)
  return `postgresql://${username}:${password}@${config.sshHost}:${databasePort}/${databaseName}`
}

export function buildVercelEnv(config, remoteResult) {
  return {
    DATABASE_URL: buildDatabaseUrl(config, remoteResult),
    DATABASE_PROVIDER: 'postgresql',
    DB_SINGLETON_ENABLED: 'true',
    DB_MAX_CONNECTIONS: '1',
    DB_SCHEMA: 'public',
    DB_MIGRATIONS_SCHEMA: 'drizzle',
    DB_MIGRATIONS_TABLE: '__drizzle_migrations',
    DB_MIGRATIONS_OUT: './src/config/db/migrations',
  }
}

export function renderHelpText() {
  return [
    'Required environment variables:',
    'MULTICA_DEPLOY_HOST or MULTICA_SERVER_IP',
    'MULTICA_DEPLOY_ROOT_PASSWORD or MULTICA_ROOT_PASSWORD',
    'MULTICA_POSTGRES_PASSWORD',
    '',
    'Optional environment variables:',
    'MULTICA_DEPLOY_PORT=22',
    'MULTICA_DEPLOY_USERNAME=root',
    'MULTICA_POSTGRES_DB=multica_app',
    'MULTICA_POSTGRES_USER=multica_app',
    'MULTICA_POSTGRES_PORT=5432',
    'MULTICA_POSTGRES_ALLOWED_CIDR=0.0.0.0/0',
  ].join('\n')
}

export function runRemoteScript(config, script) {
  return new Promise((resolvePromise, reject) => {
    const client = new Client()

    client
      .on('ready', () => {
        client.exec('bash -s', (error, stream) => {
          if (error) {
            client.end()
            reject(error)
            return
          }

          let stdout = ''
          let stderr = ''

          stream.on('close', (code) => {
            client.end()

            if (code !== 0) {
              reject(
                new Error(
                  `Remote PostgreSQL setup exited with code ${code}.\nSTDOUT:\n${stdout.trim()}\nSTDERR:\n${stderr.trim()}`,
                ),
              )
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
          stream.end(script)
        })
      })
      .on('error', reject)
      .connect({
        host: config.sshHost,
        port: config.sshPort,
        username: config.sshUsername,
        password: config.sshPassword,
        readyTimeout: 30000,
      })
  })
}

export async function setupPostgres(environment = process.env) {
  const config = loadPostgresSetupConfig(environment)
  const script = renderPostgresRemoteScript(config)
  const { stdout, stderr } = await runRemoteScript(config, script)
  const remoteResult = parseStructuredOutput(stdout)

  return {
    sshHost: config.sshHost,
    sshPort: config.sshPort,
    sshUsername: config.sshUsername,
    serviceName: remoteResult.serviceName,
    configFile: remoteResult.configFile,
    pgHbaFile: remoteResult.pgHbaFile,
    databaseName: remoteResult.databaseName ?? config.databaseName,
    databaseUser: remoteResult.databaseUser ?? config.databaseUser,
    databasePort: Number(remoteResult.databasePort ?? config.databasePort),
    allowedCidr: remoteResult.allowedCidr ?? config.allowedCidr,
    databaseUrl: buildDatabaseUrl(config, remoteResult),
    vercelEnv: buildVercelEnv(config, remoteResult),
    output: `${stdout}${stderr}`.trim(),
  }
}

function isMainModule() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(renderHelpText())
    return
  }

  const result = await setupPostgres(process.env)
  console.log(JSON.stringify(result, null, 2))
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
