import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppDatabase, initializeAppDatabase } from '../server-lib/app-database.mjs'
import { loadLocalEnvironment } from '../server-lib/env-loader.mjs'
import { loadDeploymentConfig, resolveDefaultDeploymentConfigPath } from '../server-lib/deployment-config.mjs'
import { uninstallConfiguredDeployment } from '../server-lib/deployment-runtime.mjs'

function resolveRuntimeMode(argv = process.argv, environment = process.env) {
  const modeIndex = argv.indexOf('--mode')
  if (modeIndex >= 0 && argv[modeIndex + 1]) {
    return argv[modeIndex + 1]
  }

  return environment.NODE_ENV === 'production' ? 'production' : 'development'
}

function resolveProjectPath(projectRoot, filePath) {
  if (!filePath) {
    return null
  }

  return isAbsolute(filePath) ? filePath : resolve(projectRoot, filePath)
}

async function listTrackedInstances(database) {
  return await database.prepare(`
    SELECT
      instance_name,
      target_server,
      workspace_path,
      runtime_user,
      service_name,
      console_url,
      updated_at
    FROM agent_instances
    ORDER BY updated_at DESC, created_at DESC
  `).all()
}

async function clearAllTables(database) {
  const tableNames = [
    'analytics_events',
    'analytics_sessions',
    'agent_instances',
    'deployments',
    'sessions',
    'orders',
    'creem_products',
    'users',
  ]

  await database.exec(`TRUNCATE TABLE ${tableNames.join(', ')} RESTART IDENTITY CASCADE`)
  return tableNames
}

export async function resetDevEnvironment({
  projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url))),
  environment = process.env,
} = {}) {
  loadLocalEnvironment({
    projectRoot,
    runtimeMode: resolveRuntimeMode(process.argv, environment),
    environment,
  })

  const configPath =
    resolveProjectPath(projectRoot, environment.GENERICAGENT_CONFIG_PATH ?? environment.MULTICA_CONFIG_PATH) ??
    resolveDefaultDeploymentConfigPath(projectRoot, environment)
  const runtimeMode = resolveRuntimeMode(process.argv, environment)
  const { database, identity: databaseIdentity } = await createAppDatabase({
    projectRoot,
    runtimeMode,
    environment,
  })
  await initializeAppDatabase(database)
  const encryptionSecret =
    environment.MULTICA_CONFIG_SECRET ??
    environment.MULTICA_TOKEN_SECRET ??
    `${projectRoot}:${databaseIdentity}`
  const config = loadDeploymentConfig({
    configPath,
    encryptionSecret,
  })
  const trackedInstances = await listTrackedInstances(database)
  const uniqueInstances = Array.from(new Map(trackedInstances.map((item) => [item.instance_name, item])).values())
  const remoteCleanup = []

  try {
    for (const instance of uniqueInstances) {
      try {
        const result = await uninstallConfiguredDeployment(config, {
          instanceName: instance.instance_name,
          targetServer: instance.target_server,
          workspacePath: instance.workspace_path,
          runtimeUser: instance.runtime_user,
          serviceName: instance.service_name,
          consoleUrl: instance.console_url,
        })

        remoteCleanup.push({
          instanceName: instance.instance_name,
          removed: true,
          targetServer: result.targetServer ?? instance.target_server,
          workspacePath: result.workspacePath ?? instance.workspace_path,
          runtimeUser: result.runtimeUser ?? instance.runtime_user,
          serviceName: result.serviceName ?? instance.service_name,
        })
      } catch (error) {
        remoteCleanup.push({
          instanceName: instance.instance_name,
          removed: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const clearedTables = await clearAllTables(database)

    return {
      databaseIdentity,
      configPath,
      trackedInstances: uniqueInstances.length,
      remoteCleanup,
      clearedTables,
    }
  } finally {
    database.close()
  }
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : ''
const currentFile = fileURLToPath(import.meta.url)

if (entryPoint === currentFile) {
  resetDevEnvironment()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
