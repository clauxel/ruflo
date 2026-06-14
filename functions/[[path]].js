import { handleCloudflareRequest } from '../worker/index.js'

export async function onRequest(context) {
  return await handleCloudflareRequest(context.request, context.env, {
    assetFetcher: async (request) => {
      if (context.env?.ASSETS?.fetch) {
        return await context.env.ASSETS.fetch(request)
      }

      return await context.next()
    },
  })
}
