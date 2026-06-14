import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppDatabase } from '../server-lib/app-database.mjs'
import { loadLocalEnvironment } from '../server-lib/env-loader.mjs'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

// Resolve runtime mode manually
const modeIndex = process.argv.indexOf('--mode')
const runtimeMode =
  modeIndex >= 0 && process.argv[modeIndex + 1]
    ? process.argv[modeIndex + 1]
    : process.env.NODE_ENV === 'production'
      ? 'production'
      : 'development'

loadLocalEnvironment({
  projectRoot,
  runtimeMode,
})

const argvRaw = process.argv.slice(2)
const args = []
for (let i = 0; i < argvRaw.length; i++) {
  if (argvRaw[i] === '--mode') {
    i++ // Skip both flag and value
  } else {
    args.push(argvRaw[i])
  }
}

const orderId = args[0]
const consoleUrl = args[1]
const publicEndpoint = args[2] || ''

if (!orderId || !consoleUrl) {
  console.error('\n❌ Usage: node scripts/fulfill-order.mjs <order-id> <console-url> [public-endpoint]')
  console.error('Example: node scripts/fulfill-order.mjs 1234abcd "http://127.0.0.1:19281/instances/multica-guest-gpt-5-whatsapp-123/"')
  console.error('Optionally define mode: node scripts/fulfill-order.mjs <order-id> <console-url> --mode production\n')
  process.exit(1)
}

const { database } = await createAppDatabase({
  projectRoot,
  runtimeMode,
  environment: process.env,
})

async function run() {
  console.log(`\n🚀 Fulfilling order manually: ${orderId}...`)

  // 1. Fetch order and deployment
  const orderData = await database.prepare('SELECT * FROM orders WHERE id = $1 OR order_number = $1').all(orderId)
  const order = orderData[0]

  if (!order) {
    throw new Error(`Order ${orderId} not found in database.`)
  }

  const deploymentData = await database
    .prepare('SELECT * FROM deployments WHERE order_id = $1 ORDER BY sequence_number DESC LIMIT 1')
    .all(order.id)
  const deployment = deploymentData[0]

  if (!deployment) {
    throw new Error(`No deployment found for order ${order.id}. Wait for the queue to create one.`)
  }

  const timestamp = new Date().toISOString()
  const workspacePath = `/data/multica/instances/${deployment.instance_name}/app`
  const runtimeUser = `app_${deployment.instance_name.slice(-6)}`
  const serviceName = `multica-${deployment.instance_name}.service`
  const multicaVersion = 'main' // default

  // 2. Mark deployment as successful
  console.log('✅ Marking deployment as successful...')
  await database.prepare(`
    UPDATE deployments
    SET status = 'deployed',
        progress = 100,
        console_url = $1,
        public_endpoint = $2,
        workspace_path = $3,
        runtime_user = $4,
        service_name = $5,
        last_message = 'Manual provisioning complete. GenericAgent workspace is ready.',
        finished_at = $6,
        updated_at = $6
    WHERE id = $7
  `).run(consoleUrl, publicEndpoint || null, workspacePath, runtimeUser, serviceName, timestamp, deployment.id)

  // 3. Create or update agent instance
  console.log('✅ Synchronizing agent_instances database...')
  const instanceData = await database.prepare('SELECT id FROM agent_instances WHERE order_id = $1').all(order.id)
  const instance = instanceData[0]

  if (instance) {
    await database.prepare(`
      UPDATE agent_instances
      SET status = 'running',
          console_url = $1,
          public_endpoint = $2,
          runtime_state = 'running',
          updated_at = $3
      WHERE id = $4
    `).run(consoleUrl, publicEndpoint || null, timestamp, instance.id)
  } else {
    await database.prepare(`
      INSERT INTO agent_instances (
        id, order_id, deployment_id, user_id, sequence_number, instance_name,
        model_id, channel_id, status, target_server, workspace_path, 
        console_url, public_endpoint, runtime_user, service_name, 
        runtime_state, multica_version, upgrade_status, 
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19)
    `).run(
      randomBytes(16).toString('hex'),
      order.id,
      deployment.id,
      order.user_id,
      deployment.sequence_number,
      deployment.instance_name,
      order.model_id,
      order.channel_id,
      'running',
      deployment.target_server,
      workspacePath,
      consoleUrl,
      publicEndpoint || null,
      runtimeUser,
      serviceName,
      'running',
      multicaVersion,
      'idle',
      timestamp
    )
  }

  // 4. Update order global status
  console.log('✅ Updating order status...')
  await database.prepare(`
    UPDATE orders 
    SET deployment_status = 'deployed',
        status_message = 'GenericAgent workspace is successfully deployed and running.',
        updated_at = $1
    WHERE id = $2
  `).run(timestamp, order.id)

  console.log(`\n🎉 Order ${order.id} fulfilled!`)
  console.log(`🔗 Console URL: ${consoleUrl}`)

  await database.close()
}

run().catch((error) => {
  console.error('\n❌ Execution failed:')
  console.error(error.stack || error.message)
  process.exit(1)
})
