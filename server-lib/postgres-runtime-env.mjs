function readRuntimeDatabaseValue(environment, instanceKey, fallbackKey, fallbackValue = '') {
  const instanceValue = environment[instanceKey]
  if (instanceValue !== undefined && String(instanceValue).trim()) {
    return String(instanceValue).trim()
  }

  const fallbackEnvironmentValue = environment[fallbackKey]
  if (fallbackEnvironmentValue !== undefined && String(fallbackEnvironmentValue).trim()) {
    return String(fallbackEnvironmentValue).trim()
  }

  return fallbackValue
}

export function buildPostgresRuntimeEnvironment(environment = process.env) {
  const databasePassword = readRuntimeDatabaseValue(
    environment,
    'MULTICA_INSTANCE_POSTGRES_PASSWORD',
    'MULTICA_POSTGRES_PASSWORD',
  )
  if (!databasePassword) {
    return null
  }

  const databaseHost = readRuntimeDatabaseValue(
    environment,
    'MULTICA_INSTANCE_POSTGRES_HOST',
    'MULTICA_POSTGRES_HOST',
    '127.0.0.1',
  )
  const databasePortValue = Number.parseInt(
    readRuntimeDatabaseValue(
      environment,
      'MULTICA_INSTANCE_POSTGRES_PORT',
      'MULTICA_POSTGRES_PORT',
      '5432',
    ),
    10,
  )
  const databasePort = Number.isFinite(databasePortValue) && databasePortValue > 0 ? databasePortValue : 5432
  const databaseName = readRuntimeDatabaseValue(
    environment,
    'MULTICA_INSTANCE_POSTGRES_DB',
    'MULTICA_POSTGRES_DB',
    'multica_app',
  )
  const databaseUser = readRuntimeDatabaseValue(
    environment,
    'MULTICA_INSTANCE_POSTGRES_USER',
    'MULTICA_POSTGRES_USER',
    'multica_app',
  )
  const databaseSslMode = readRuntimeDatabaseValue(
    environment,
    'MULTICA_INSTANCE_POSTGRES_SSLMODE',
    'MULTICA_POSTGRES_SSLMODE',
  )
  const databaseUrl = new URL(
    `postgresql://${encodeURIComponent(databaseUser)}:${encodeURIComponent(databasePassword)}@${databaseHost}:${databasePort}/${encodeURIComponent(databaseName)}`,
  )

  if (databaseSslMode) {
    databaseUrl.searchParams.set('sslmode', databaseSslMode)
  }

  return {
    MULTICA_POSTGRES_HOST: databaseHost,
    MULTICA_POSTGRES_PORT: String(databasePort),
    MULTICA_POSTGRES_DB: databaseName,
    MULTICA_POSTGRES_USER: databaseUser,
    MULTICA_POSTGRES_PASSWORD: databasePassword,
    ...(databaseSslMode ? { MULTICA_POSTGRES_SSLMODE: databaseSslMode } : {}),
    DATABASE_PROVIDER: 'postgresql',
    DATABASE_URL: databaseUrl.toString(),
    DB_SINGLETON_ENABLED: 'true',
    DB_MAX_CONNECTIONS: '1',
    DB_SCHEMA: 'public',
    DB_MIGRATIONS_SCHEMA: 'drizzle',
    DB_MIGRATIONS_TABLE: '__drizzle_migrations',
    DB_MIGRATIONS_OUT: './src/config/db/migrations',
  }
}
