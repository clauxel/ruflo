process.env.GENERICAGENT_SERVERLESS_API = 'true'

const routedPathQueryParam = '__genericagent_api_path'

export const config = {
  maxDuration: 60,
}

export function rewriteVercelRoutedApiPath(request) {
  const requestUrl = new URL(request.url ?? '/', 'http://genericagent.local')
  const routedPath = requestUrl.searchParams.get(routedPathQueryParam)

  if (!routedPath) {
    return
  }

  requestUrl.searchParams.delete(routedPathQueryParam)
  const normalizedPath = routedPath.replace(/^\/+/, '')
  request.url = `/api/${normalizedPath}${requestUrl.search}`
}

export default async function handler(request, response) {
  rewriteVercelRoutedApiPath(request)
  const { handleGenericAgentApiRequest } = await import('../server.mjs')
  await handleGenericAgentApiRequest(request, response)
}
