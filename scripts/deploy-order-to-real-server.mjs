import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppDatabase, initializeAppDatabase } from '../server-lib/app-database.mjs'
import { Client } from 'ssh2'
import { loadDeploymentConfig, resolveDefaultDeploymentConfigPath } from '../server-lib/deployment-config.mjs'
import { executeConfiguredDeployment } from '../server-lib/deployment-runtime.mjs'
import { loadLocalEnvironment } from '../server-lib/env-loader.mjs'

function resolveRuntimeMode(argv = process.argv, environment = process.env) {
  const modeIndex = argv.indexOf('--mode')
  if (modeIndex >= 0 && argv[modeIndex + 1]) {
    return argv[modeIndex + 1]
  }

  return environment.NODE_ENV === 'production' ? 'production' : 'development'
}

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
loadLocalEnvironment({
  projectRoot,
  runtimeMode: resolveRuntimeMode(process.argv, process.env),
})
const configPath = resolveDefaultDeploymentConfigPath(projectRoot, process.env)
function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function decryptSecretValue({ cipherText, iv, tag }) {
  const key = createHash('sha256').update(tokenEncryptionSecret).digest()
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(tag, 'hex'))

  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}

function encryptSecretValue(value) {
  const key = createHash('sha256').update(tokenEncryptionSecret).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])

  return {
    cipherText: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  }
}

function buildInstanceName(ownerName, modelId, channelId) {
  const base = slugify(`${ownerName}-${modelId}-${channelId}`) || 'genericagent'
  return `${base}-${randomBytes(3).toString('hex')}`
}

function derivePort(orderId) {
  return 18000 + (parseInt(orderId.slice(0, 4), 16) % 1000)
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function toBase64Json(value) {
  return Buffer.from(JSON.stringify(value, null, 2), 'utf8').toString('base64')
}

function buildSshConnectionOptions(config) {
  const options = {
    host: config.server.host,
    port: config.server.port,
    username: config.server.username,
    readyTimeout: 30000,
  }

  if (config.server.privateKey) {
    options.privateKey = config.server.privateKey
    if (config.server.privateKeyPassphrase) {
      options.passphrase = config.server.privateKeyPassphrase
    }
    return options
  }

  if (config.server.password) {
    options.password = config.server.password
  }

  return options
}

function execRemoteScript(script) {
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
                  `Remote script exited with code ${code}.\nSTDOUT:\n${stdout.trim()}\nSTDERR:\n${stderr.trim()}`,
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
      .connect(buildSshConnectionOptions(deploymentConfig))
  })
}

async function getLatestPaidOrder(database) {
  return await database.prepare(`
    SELECT *
    FROM orders
    WHERE payment_status = 'paid'
    ORDER BY created_at DESC
    LIMIT 1
  `).get()
}

async function getOrderOwner(database, order) {
  return (
    (await database.prepare(`SELECT * FROM users WHERE id = ?`).get(order.user_id)) ?? {
      id: order.user_id,
      name: 'genericagent-guest',
      email: 'guest@genericagent.local',
    }
  )
}

async function getSequenceNumber(database, orderId) {
  return Number(
    (await database.prepare(`SELECT COUNT(*) AS count FROM deployments WHERE order_id = ?`).get(orderId))?.count ?? 0,
  ) + 1
}

async function upsertDeploymentRecords(database, {
  order,
  owner,
  instanceName,
  sequenceNumber,
  status,
  statusMessage,
  targetServer,
  workspacePath,
  consoleUrl,
  publicEndpoint,
  runtimeUser,
  serviceName,
  consoleToken,
}) {
  const timestamp = new Date().toISOString()
  const encryptedConsoleToken = consoleToken ? encryptSecretValue(consoleToken) : null
  const existingDeployment = await database
    .prepare(`SELECT * FROM deployments WHERE order_id = ? AND sequence_number = ?`)
    .get(order.id, sequenceNumber)
  const deploymentId = existingDeployment?.id ?? randomBytes(16).toString('hex')

  if (existingDeployment) {
    await database.prepare(`
      UPDATE deployments
      SET
        status = 'deployed',
        progress = 100,
        target_server = ?,
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
        started_at = COALESCE(started_at, ?),
        finished_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      status,
      targetServer,
      workspacePath,
      consoleUrl,
      publicEndpoint,
      runtimeUser,
      serviceName,
      encryptedConsoleToken?.cipherText ?? null,
      encryptedConsoleToken?.iv ?? null,
      encryptedConsoleToken?.tag ?? null,
      statusMessage,
      'Real server deployment completed.',
      timestamp,
      timestamp,
      timestamp,
      deploymentId,
    )
  } else {
    await database.prepare(`
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
      VALUES (?, ?, ?, 'automatic', ?, ?, ?, 100, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      deploymentId,
      order.id,
      order.user_id,
      sequenceNumber,
      instanceName,
      status,
      order.deployment_eta_minutes,
      targetServer,
      workspacePath,
      consoleUrl,
      publicEndpoint,
      runtimeUser,
      serviceName,
      encryptedConsoleToken?.cipherText ?? null,
      encryptedConsoleToken?.iv ?? null,
      encryptedConsoleToken?.tag ?? null,
      statusMessage,
      'Real server deployment completed.',
      timestamp,
      timestamp,
      timestamp,
      timestamp,
    )
  }

  const existingInstance = await database.prepare(`SELECT * FROM agent_instances WHERE deployment_id = ?`).get(deploymentId)

  if (existingInstance) {
    await database.prepare(`
      UPDATE agent_instances
      SET
        status = ?,
        target_server = ?,
        workspace_path = ?,
        console_url = ?,
        public_endpoint = ?,
        runtime_user = ?,
        service_name = ?,
        updated_at = ?
      WHERE deployment_id = ?
    `).run(
      status === 'deployed' ? 'running' : 'failed',
      targetServer,
      workspacePath,
      consoleUrl,
      publicEndpoint,
      runtimeUser,
      serviceName,
      timestamp,
      deploymentId,
    )
  } else {
    await database.prepare(`
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
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomBytes(16).toString('hex'),
      order.id,
      deploymentId,
      order.user_id,
      sequenceNumber,
      instanceName,
      order.model_id,
      order.channel_id,
      status === 'deployed' ? 'running' : 'failed',
      targetServer,
      workspacePath,
      consoleUrl,
      publicEndpoint,
      runtimeUser,
      serviceName,
      timestamp,
      timestamp,
    )
  }

  await database.prepare(`
    UPDATE orders
    SET
      payment_status = 'paid',
      deployment_status = ?,
      status_message = ?,
      updated_at = ?
    WHERE id = ?
  `).run(status, statusMessage, timestamp, order.id)

  return deploymentId
}

function parseJsonLine(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index])
    } catch {}
  }

  throw new Error('Remote deployment did not return structured output.')
}

const runtimeMode = resolveRuntimeMode(process.argv, process.env)
const { database, identity: databaseIdentity } = await createAppDatabase({
  projectRoot,
  runtimeMode,
  environment: process.env,
})
await initializeAppDatabase(database)
const tokenEncryptionSecret = process.env.MULTICA_TOKEN_SECRET ?? `${projectRoot}:${databaseIdentity}`
const configEncryptionSecret = process.env.MULTICA_CONFIG_SECRET ?? tokenEncryptionSecret
const deploymentConfig = loadDeploymentConfig({
  configPath,
  encryptionSecret: configEncryptionSecret,
})

try {
  const orderId = process.argv[2] ?? null
  const order =
    (orderId ? await database.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) : null) ??
    (await getLatestPaidOrder(database))

  if (!order) {
    throw new Error('No paid order was found.')
  }

  const owner = await getOrderOwner(database, order)
  const communicationToken = decryptSecretValue({
    cipherText: order.token_cipher_text,
    iv: order.token_iv,
    tag: order.token_tag,
  })
  const hasSavedToken = Boolean(communicationToken.trim())
  const sequenceNumber = await getSequenceNumber(database, order.id)
  const instanceName = buildInstanceName(owner.name ?? 'genericagent-guest', order.model_id, order.channel_id)
  const deploymentResult = await executeConfiguredDeployment(deploymentConfig, {
    instanceName,
    communicationToken,
    user: owner,
    order,
  })
  const deploymentStatus = 'deployed'
  const statusMessage = hasSavedToken
    ? 'GenericAgent workspace is ready. The saved channel token and model preset were written into the instance.'
    : 'GenericAgent workspace is ready. The model preset was written into the instance; bind a channel token later when you are ready.'

  const deploymentId = await upsertDeploymentRecords(database, {
    order,
    owner,
    instanceName,
    sequenceNumber,
    status: deploymentStatus,
    statusMessage,
    targetServer: deploymentResult.targetServer,
    workspacePath: deploymentResult.workspacePath,
    consoleUrl: deploymentResult.consoleUrl,
    publicEndpoint: deploymentResult.publicEndpoint,
    runtimeUser: deploymentResult.runtimeUser,
    serviceName: deploymentResult.serviceName,
    consoleToken: deploymentResult.consoleToken,
  })

  console.log(
    JSON.stringify(
      {
        orderId: order.id,
        orderNumber: order.order_number,
        deploymentId,
        instanceName,
        serviceName: deploymentResult.serviceName,
        runtimeUser: deploymentResult.runtimeUser,
        workspacePath: deploymentResult.workspacePath,
        consoleUrl: deploymentResult.consoleUrl,
        publicEndpoint: deploymentResult.publicEndpoint,
        deploymentStatus,
        statusMessage,
        hasSavedToken,
        multicaVersion: deploymentResult.multicaVersion,
        runLogs: deploymentResult.runLogs,
      },
      null,
      2,
    ),
  )
} finally {
  await database.close()
}
