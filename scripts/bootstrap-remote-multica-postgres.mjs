import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'ssh2'

function parseEnvFile(filePath) {
  const environment = {}

  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    environment[key] = value
  }

  return environment
}

function getConfig(projectRoot) {
  const devEnvironment = parseEnvFile(resolve(projectRoot, '.env.development'))
  const prodEnvironment = parseEnvFile(resolve(projectRoot, '.env.production'))

  if (devEnvironment.MULTICA_DEPLOY_HOST !== prodEnvironment.MULTICA_DEPLOY_HOST) {
    throw new Error('Development and production deploy hosts differ. This bootstrap script only supports one shared PostgreSQL server.')
  }

  return {
    sshHost: devEnvironment.MULTICA_DEPLOY_HOST,
    sshPort: Number.parseInt(devEnvironment.MULTICA_DEPLOY_PORT ?? '22', 10) || 22,
    sshUsername: devEnvironment.MULTICA_DEPLOY_USERNAME || 'root',
    sshPassword: devEnvironment.MULTICA_DEPLOY_ROOT_PASSWORD || '',
    dev: {
      host: devEnvironment.MULTICA_POSTGRES_HOST || '127.0.0.1',
      database: devEnvironment.MULTICA_POSTGRES_DB || 'multica_dev',
      user: devEnvironment.MULTICA_POSTGRES_USER || 'multica_dev',
      password: devEnvironment.MULTICA_POSTGRES_PASSWORD || '',
      port: Number.parseInt(devEnvironment.MULTICA_POSTGRES_PORT ?? '5432', 10) || 5432,
    },
    prod: {
      host: prodEnvironment.MULTICA_POSTGRES_HOST || '127.0.0.1',
      database: prodEnvironment.MULTICA_POSTGRES_DB || 'multica_prod',
      user: prodEnvironment.MULTICA_POSTGRES_USER || 'multica_prod',
      password: prodEnvironment.MULTICA_POSTGRES_PASSWORD || '',
      port: Number.parseInt(prodEnvironment.MULTICA_POSTGRES_PORT ?? '5432', 10) || 5432,
    },
  }
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function renderBootstrapSql(config) {
  return `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${config.dev.user}') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${config.dev.user}', '${config.dev.password}');
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', '${config.dev.user}', '${config.dev.password}');
  END IF;
END
$$;

SELECT format('CREATE DATABASE %I OWNER %I', '${config.dev.database}', '${config.dev.user}')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${config.dev.database}')
\\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', '${config.dev.database}', '${config.dev.user}')
\\gexec

\\connect ${config.dev.database}

CREATE TABLE IF NOT EXISTS app_connection_check (
  id bigserial PRIMARY KEY,
  environment text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_connection_check OWNER TO ${config.dev.user};
GRANT ALL PRIVILEGES ON TABLE app_connection_check TO ${config.dev.user};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${config.dev.user};
INSERT INTO app_connection_check (environment) VALUES ('dev');

ALTER SCHEMA public OWNER TO ${config.dev.user};
GRANT ALL ON SCHEMA public TO ${config.dev.user};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${config.dev.user};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${config.dev.user};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO ${config.dev.user};

\\connect postgres

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${config.prod.user}') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${config.prod.user}', '${config.prod.password}');
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', '${config.prod.user}', '${config.prod.password}');
  END IF;
END
$$;

SELECT format('CREATE DATABASE %I OWNER %I', '${config.prod.database}', '${config.prod.user}')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${config.prod.database}')
\\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', '${config.prod.database}', '${config.prod.user}')
\\gexec

\\connect ${config.prod.database}

CREATE TABLE IF NOT EXISTS app_connection_check (
  id bigserial PRIMARY KEY,
  environment text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_connection_check OWNER TO ${config.prod.user};
GRANT ALL PRIVILEGES ON TABLE app_connection_check TO ${config.prod.user};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${config.prod.user};
INSERT INTO app_connection_check (environment) VALUES ('prod');

ALTER SCHEMA public OWNER TO ${config.prod.user};
GRANT ALL ON SCHEMA public TO ${config.prod.user};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${config.prod.user};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${config.prod.user};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO ${config.prod.user};
`
}

function renderRemoteScript(config) {
  const sql = Buffer.from(renderBootstrapSql(config), 'utf8').toString('base64')

  return `set -euo pipefail
SQL_B64=${shellEscape(sql)}
DEV_PASSWORD=${shellEscape(config.dev.password)}
DEV_HOST=${shellEscape(config.dev.host)}
DEV_PORT=${shellEscape(String(config.dev.port))}
DEV_USER=${shellEscape(config.dev.user)}
DEV_DB=${shellEscape(config.dev.database)}
PROD_PASSWORD=${shellEscape(config.prod.password)}
PROD_HOST=${shellEscape(config.prod.host)}
PROD_PORT=${shellEscape(String(config.prod.port))}
PROD_USER=${shellEscape(config.prod.user)}
PROD_DB=${shellEscape(config.prod.database)}
TMP_SQL=/tmp/multica-dev-prod-bootstrap.sql
PG_DATA_DIR=/var/lib/pgsql/data
PG_CONF="$PG_DATA_DIR/postgresql.conf"
PG_HBA="$PG_DATA_DIR/pg_hba.conf"
if [ ! -f "$PG_DATA_DIR/PG_VERSION" ]; then
  postgresql-setup --initdb
fi
if grep -qE "^#?listen_addresses\\s*=" "$PG_CONF"; then
  sed -i "s/^#\\?listen_addresses\\s*=.*/listen_addresses = '127.0.0.1'/" "$PG_CONF"
else
  printf "\\nlisten_addresses = '127.0.0.1'\\n" >> "$PG_CONF"
fi
sed -i "/host all all 127.0.0.1\\/32 scram-sha-256/d" "$PG_HBA"
if ! grep -q "host all all 127.0.0.1/32 md5" "$PG_HBA"; then
  printf "host all all 127.0.0.1/32 md5\\n" | cat - "$PG_HBA" > "$PG_HBA.tmp"
  mv "$PG_HBA.tmp" "$PG_HBA"
  chown postgres:postgres "$PG_HBA"
fi
if ! su - postgres -c "pg_ctl -D $PG_DATA_DIR status" >/dev/null 2>&1; then
  su - postgres -c "pg_ctl -D $PG_DATA_DIR -l $PG_DATA_DIR/server.log start"
else
  su - postgres -c "pg_ctl -D $PG_DATA_DIR restart -m fast -l $PG_DATA_DIR/server.log"
fi
for _ in $(seq 1 15); do
  if su - postgres -c "psql -d postgres -Atqc 'select 1'" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
printf '%s' "$SQL_B64" | base64 -d > "$TMP_SQL"
su - postgres -c "psql -v ON_ERROR_STOP=1 -f $TMP_SQL"
DEV_RESULT=$(PGPASSWORD="$DEV_PASSWORD" psql -h "$DEV_HOST" -U "$DEV_USER" -d "$DEV_DB" -Atqc "select current_user || ':' || current_database() || ':' || count(*) from app_connection_check")
PROD_RESULT=$(PGPASSWORD="$PROD_PASSWORD" psql -h "$PROD_HOST" -U "$PROD_USER" -d "$PROD_DB" -Atqc "select current_user || ':' || current_database() || ':' || count(*) from app_connection_check")
rm -f "$TMP_SQL"
printf '{"dev":"%s","prod":"%s"}\n' "$DEV_RESULT" "$PROD_RESULT"
`
}

function runRemoteScript(config, script) {
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
              reject(new Error(`Remote bootstrap failed with code ${code}.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`))
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

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const config = getConfig(projectRoot)

if (!config.sshPassword) {
  throw new Error('Missing MULTICA_DEPLOY_ROOT_PASSWORD in .env.development/.env.production.')
}

if (!config.dev.password || !config.prod.password) {
  throw new Error('Missing MULTICA_POSTGRES_PASSWORD in .env.development or .env.production.')
}

const result = await runRemoteScript(config, renderRemoteScript(config))
const summary = JSON.parse(result.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? '{}')

console.log(
  JSON.stringify(
    {
      server: config.sshHost,
      dev: summary.dev ?? null,
      prod: summary.prod ?? null,
    },
    null,
    2,
  ),
)
