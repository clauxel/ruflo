import { createMulticaInstanceRouter } from './server-lib/multica-instance-router.mjs'

const router = createMulticaInstanceRouter()

await router.start()

console.log(
  JSON.stringify({
    host: router.host,
    port: router.port,
    routesDir: router.routesDir,
    status: 'listening',
  }),
)

const shutdown = async () => {
  await router.stop()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
