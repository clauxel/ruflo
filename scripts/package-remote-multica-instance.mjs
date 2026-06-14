import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { hostname, networkInterfaces } from 'node:os'
import { createAppDatabase, initializeAppDatabase } from '../server-lib/app-database.mjs'
import { Client } from 'ssh2'
import { loadDeploymentConfig, resolveDefaultDeploymentConfigPath } from '../server-lib/deployment-config.mjs'
import { loadLocalEnvironment } from '../server-lib/env-loader.mjs'

function resolveRuntimeMode(argv = process.argv, environment = process.env) {
  const modeIndex = argv.indexOf('--mode')
  if (modeIndex >= 0 && argv[modeIndex + 1]) {
    return argv[modeIndex + 1]
  }

  return environment.NODE_ENV === 'production' ? 'production' : 'development'
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function parseJsonLine(stdout) {
  const line = stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop()

  return line ? JSON.parse(line) : {}
}

function isLocalPackageTarget(host, environment = process.env) {
  if (String(environment.MULTICA_DEPLOY_RUN_LOCAL ?? '').trim().toLowerCase() === 'true') {
    return true
  }

  const normalizedHost = String(host ?? '').trim().toLowerCase()
  if (!normalizedHost) {
    return false
  }

  if (normalizedHost === '127.0.0.1' || normalizedHost === '::1' || normalizedHost === 'localhost') {
    return true
  }

  const localHostNames = new Set(
    [hostname(), `${hostname()}.local`]
      .map((value) => String(value ?? '').trim().toLowerCase())
      .filter(Boolean),
  )
  if (localHostNames.has(normalizedHost)) {
    return true
  }

  const interfaces = networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const address = String(entry?.address ?? '').trim().toLowerCase()
      if (address && address === normalizedHost) {
        return true
      }
    }
  }

  return false
}

function defaultTemplateArchivePath() {
  return '/data/multica/templates/multica-template.tar.gz'
}

export function normalizeInstanceQuery(value) {
  return String(value ?? '')
    .split('·')[0]
    .trim()
}

export async function findRemotePackageTarget({ database, query }) {
  const normalizedQuery = normalizeInstanceQuery(query)

  if (!normalizedQuery) {
    throw new Error('Missing workspace query. Provide an instance name such as genericagent-guest-gpt-5-4-telegram-c8894e.')
  }

  const statement = database.prepare(`
    SELECT
      c.instance_name,
      c.target_server,
      c.workspace_path,
      c.runtime_user,
      c.service_name,
      c.updated_at,
      o.order_number
    FROM agent_instances c
    JOIN orders o ON o.id = c.order_id
    WHERE c.instance_name = ?
       OR o.order_number = ?
       OR c.instance_name LIKE ?
    ORDER BY c.updated_at DESC
    LIMIT 1
  `)
  const target = await statement.get(
    normalizedQuery,
    normalizedQuery,
    `%${normalizedQuery}%`,
  )

  if (!target) {
    throw new Error(`Unable to find a deployed GenericAgent workspace matching "${normalizedQuery}".`)
  }

  return target
}

export function resolveRemotePackageRequest({
  deploymentConfig,
  instance,
  archivePath,
  environment = process.env,
}) {
  const resolvedArchivePath =
    archivePath?.trim() ||
    deploymentConfig.multica.archivePath ||
    defaultTemplateArchivePath()
  const sshHost =
    deploymentConfig.server.host && deploymentConfig.server.host !== '127.0.0.1'
      ? deploymentConfig.server.host
      : instance.target_server

  if (!sshHost) {
    throw new Error('Missing SSH host. Set MULTICA_DEPLOY_HOST or keep a target_server on the instance record.')
  }

  const runLocal = isLocalPackageTarget(sshHost, environment)

  if (!runLocal && !deploymentConfig.server.password && !deploymentConfig.server.privateKey) {
    throw new Error(
      'Missing SSH credentials. Set MULTICA_DEPLOY_ROOT_PASSWORD or MULTICA_AGENT_DEPLOY_PRIVATE_KEY_PATH before packaging.',
    )
  }

  return {
    runLocal,
    sshHost,
    sshPort: deploymentConfig.server.port,
    sshUsername: deploymentConfig.server.username,
    sshPassword: deploymentConfig.server.password,
    sshPrivateKey: deploymentConfig.server.privateKey,
    sshPrivateKeyPassphrase: deploymentConfig.server.privateKeyPassphrase,
    instanceName: instance.instance_name,
    orderNumber: instance.order_number,
    targetServer: instance.target_server,
    workspacePath: instance.workspace_path,
    appPath: `${instance.workspace_path}/app`,
    runtimeUser: instance.runtime_user,
    serviceName: instance.service_name,
    archivePath: resolvedArchivePath,
  }
}

export function renderRemotePackageScript(request) {
  return `set -euo pipefail
export INSTANCE_NAME=${shellEscape(request.instanceName)}
export APP_PATH=${shellEscape(request.appPath)}
export ARCHIVE_PATH=${shellEscape(request.archivePath)}
PACKAGES_DIR="$(dirname "$ARCHIVE_PATH")"

if [ ! -d "$APP_PATH" ]; then
  echo "GenericAgent app directory not found at $APP_PATH" >&2
  exit 1
fi

install -d -m 755 "$PACKAGES_DIR"
TMP_ARCHIVE="$(mktemp "$PACKAGES_DIR/${request.instanceName}.XXXXXX.tar.gz")"
tar \
  --exclude='.git' \
  --exclude='.multica' \
  --exclude='.cache' \
  --exclude='.npm' \
  --exclude='.tmp' \
  --exclude='tmp' \
  --exclude='temp' \
  --exclude='logs' \
  --exclude='*.log' \
  --exclude='*.db' \
  --exclude='*.db-*' \
  --exclude='conversations' \
  --exclude='sessions' \
  --exclude='memory' \
  --exclude='history' \
  -C "$APP_PATH" -czf "$TMP_ARCHIVE" .
mv "$TMP_ARCHIVE" "$ARCHIVE_PATH"
export SIZE_BYTES="$(wc -c < "$ARCHIVE_PATH" | tr -d ' ')"
export SHA256="$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')"
python3 - <<'PY'
import json
import os

print(json.dumps({
  'instanceName': os.environ['INSTANCE_NAME'],
  'archivePath': os.environ['ARCHIVE_PATH'],
  'sizeBytes': int(os.environ['SIZE_BYTES']),
  'sha256': os.environ['SHA256'],
}))
PY
`
}

function runRemoteScript(request, script) {
  return new Promise((resolvePromise, reject) => {
    const client = new Client()
    let settled = false

    const settle = (callback) => {
      if (settled) {
        return
      }

      settled = true
      client.end()
      callback()
    }

    client
      .on('ready', () => {
        client.exec('bash -s', (error, stream) => {
          if (error) {
            settle(() => reject(error))
            return
          }

          let stdout = ''
          let stderr = ''
          let exitCode = 0

          const finish = () => {
            if (exitCode !== 0) {
              settle(() =>
                reject(
                  new Error(
                    `Remote packaging exited with code ${exitCode}.\nSTDOUT:\n${stdout.trim()}\nSTDERR:\n${stderr.trim()}`,
                  ),
                ),
              )
              return
            }

            settle(() => resolvePromise({ stdout, stderr }))
          }

          stream.on('close', (code) => {
            exitCode = code ?? exitCode ?? 0
            finish()
          })
          stream.on('exit', (code) => {
            exitCode = code ?? exitCode ?? 0
          })
          stream.on('data', (chunk) => {
            stdout += chunk.toString()
          })
          stream.stderr.on('data', (chunk) => {
            stderr += chunk.toString()
          })
          stream.on('error', (streamError) => {
            settle(() => reject(streamError))
          })
          stream.end(script)
        })
      })
      .on('error', (clientError) => {
        settle(() => reject(clientError))
      })
      .connect({
        host: request.sshHost,
        port: request.sshPort,
        username: request.sshUsername,
        password: request.sshPrivateKey ? undefined : request.sshPassword,
        privateKey: request.sshPrivateKey || undefined,
        passphrase: request.sshPrivateKey ? request.sshPrivateKeyPassphrase || undefined : undefined,
        readyTimeout: 30000,
      })
  })
}

function runLocalScript(script) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bash', ['-s'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      reject(error)
    })
    child.on('close', (code) => {
      if ((code ?? 0) !== 0) {
        reject(
          new Error(
            `Local packaging exited with code ${code ?? 0}.\nSTDOUT:\n${stdout.trim()}\nSTDERR:\n${stderr.trim()}`,
          ),
        )
        return
      }

      resolvePromise({ stdout, stderr })
    })

    child.stdin.end(script)
  })
}

export async function packageRemoteMulticaInstance({
  projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url))),
  query = process.argv[2],
  archivePath = process.argv[3],
  environment = process.env,
} = {}) {
  loadLocalEnvironment({
    projectRoot,
    runtimeMode: resolveRuntimeMode(process.argv, environment),
    environment,
  })

  const configPath = resolveDefaultDeploymentConfigPath(projectRoot, environment)
  const { database, identity } = await createAppDatabase({
    projectRoot,
    runtimeMode: resolveRuntimeMode(process.argv, environment),
    environment,
  })
  await initializeAppDatabase(database)
  const encryptionSecret = environment.MULTICA_CONFIG_SECRET ?? environment.MULTICA_TOKEN_SECRET ?? `${projectRoot}:${identity}`
  const deploymentConfig = loadDeploymentConfig({
    configPath,
    encryptionSecret,
  })

  try {
    const target = await findRemotePackageTarget({
      database,
      query,
    })
    const request = resolveRemotePackageRequest({
      deploymentConfig,
      instance: target,
      archivePath,
      environment,
    })
    const script = renderRemotePackageScript(request)
    const { stdout, stderr } = request.runLocal
      ? await runLocalScript(script)
      : await runRemoteScript(request, script)
    const remoteResult = parseJsonLine(stdout)

    return {
      sshHost: request.sshHost,
      sshPort: request.sshPort,
      sshUsername: request.sshUsername,
      instanceName: request.instanceName,
      orderNumber: request.orderNumber,
      workspacePath: request.workspacePath,
      archivePath: remoteResult.archivePath ?? request.archivePath,
      sizeBytes: Number(remoteResult.sizeBytes ?? 0),
      sha256: remoteResult.sha256 ?? null,
      output: `${stdout}${stderr}`.trim(),
    }
  } finally {
    database.close()
  }
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : ''
const currentFile = fileURLToPath(import.meta.url)

if (entryPoint === currentFile) {
  packageRemoteMulticaInstance()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
