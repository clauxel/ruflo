import { createExactRoute } from './route-utils.mjs'

export function createCatalogRoutes(deps) {
  const {
    appEnvironment,
    channelCatalog,
    getPaidOrderTriggerMode,
    getPublicAppOrigin,
    modelCatalog,
    planCatalog,
    sendJson,
    serializePlan,
  } = deps

  return [
    createExactRoute('GET', '/api/catalog', async ({ response }) => {
      sendJson(response, 200, {
        plans: planCatalog.map(serializePlan),
        models: modelCatalog,
        channels: channelCatalog,
      })
    }),
    createExactRoute('GET', '/api/runtime', async ({ request, response }) => {
      sendJson(response, 200, {
        deploymentMode: getPaidOrderTriggerMode(),
        environment: appEnvironment,
        isDevelopment: appEnvironment === 'development',
        publicAppOrigin: getPublicAppOrigin(request),
      })
    }),
  ]
}
