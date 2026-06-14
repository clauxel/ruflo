import { createPatternRoute } from './route-utils.mjs'

export function createModelProxyRoutes(deps) {
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']

  return methods.map((method) =>
    createPatternRoute(
      method,
      /^\/api\/internal\/model-proxy\/([^/]+)\/v1(?:\/(.*))?$/,
      async ({ request, response, requestUrl, params }) => {
        await deps.proxyModelRequest({
          request,
          response,
          requestUrl,
          instanceName: decodeURIComponent(params[1] ?? ''),
          upstreamPath: params[2] ?? '',
        })
      },
    ),
  )
}
