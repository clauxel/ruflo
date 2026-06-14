import { newDb } from 'pg-mem'

const registryKey = '__MULTICA_POSTGRES_MEMORY_REGISTRY__'

function getRegistry() {
  if (!(globalThis[registryKey] instanceof Map)) {
    globalThis[registryKey] = new Map()
  }

  return globalThis[registryKey]
}

export function getOrCreateMemoryPostgresAdapter(id = 'default') {
  const normalizedId = String(id ?? 'default').trim() || 'default'
  const registry = getRegistry()
  const existing = registry.get(normalizedId)

  if (existing) {
    return existing
  }

  const db = newDb({
    autoCreateForeignKeyIndices: true,
  })
  const adapter = db.adapters.createPg()
  const entry = {
    id: normalizedId,
    db,
    Pool: adapter.Pool,
    Client: adapter.Client,
    schemaInitialized: false,
  }

  registry.set(normalizedId, entry)
  return entry
}

export function getMemoryPostgresDatabase(id = 'default') {
  return getOrCreateMemoryPostgresAdapter(id).db
}

export function isMemoryPostgresSchemaInitialized(id = 'default') {
  return Boolean(getOrCreateMemoryPostgresAdapter(id).schemaInitialized)
}

export function markMemoryPostgresSchemaInitialized(id = 'default') {
  getOrCreateMemoryPostgresAdapter(id).schemaInitialized = true
}

export function resetMemoryPostgresAdapter(id = 'default') {
  getRegistry().delete(String(id ?? 'default').trim() || 'default')
}
