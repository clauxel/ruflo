import { createAdminRoutes } from './admin-routes.mjs'
import { createAnalyticsRoutes } from './analytics-routes.mjs'
import { createAuthRoutes } from './auth-routes.mjs'
import { createCatalogRoutes } from './catalog-routes.mjs'
import { createModelProxyRoutes } from './model-proxy-routes.mjs'
import { createOrderRoutes } from './order-routes.mjs'
import { matchRoute } from './route-utils.mjs'
import { createWebhookRoutes } from './webhook-routes.mjs'

export function createApiRouter(deps) {
  const routes = [
    ...createModelProxyRoutes(deps),
    ...createAuthRoutes(deps),
    ...createCatalogRoutes(deps),
    ...createWebhookRoutes(deps),
    ...createAnalyticsRoutes(deps),
    ...createOrderRoutes(deps),
    ...createAdminRoutes(deps),
  ]

  return {
    async handle({ request, response, requestUrl }) {
      const match = matchRoute(routes, request.method, requestUrl.pathname)
      if (!match) {
        deps.sendJson(response, 404, { message: 'Not found.' })
        return true
      }

      await match.handle({
        request,
        response,
        requestUrl,
        params: match.params,
      })

      return true
    },
  }
}
