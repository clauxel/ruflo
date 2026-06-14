import { createExactRoute, createPatternRoute } from './route-utils.mjs'

export function createAnalyticsRoutes(deps) {
  const {
    getAdminAnalyticsSessionDetail,
    getAdminAnalyticsSummary,
    ingestAnalyticsEvents,
    listAdminAnalyticsSessions,
    sendJson,
    HttpError,
    requireAdminUser,
  } = deps

  return [
    createExactRoute('POST', '/api/analytics/events', async ({ request, response }) => {
      try {
        const result = await ingestAnalyticsEvents(request)
        sendJson(response, 202, {
          message: 'Analytics events accepted.',
          ...result,
        })
      } catch (error) {
        if (error instanceof HttpError) {
          throw error
        }

        throw new HttpError(400, error instanceof Error ? error.message : 'Invalid analytics request.')
      }
    }),
    createExactRoute('GET', '/api/admin/analytics/summary', async ({ request, response, requestUrl }) => {
      await requireAdminUser(request)

      sendJson(response, 200, {
        summary: await getAdminAnalyticsSummary(requestUrl.searchParams.get('days')),
      })
    }),
    createExactRoute('GET', '/api/admin/analytics/sessions', async ({ request, response, requestUrl }) => {
      await requireAdminUser(request)

      sendJson(response, 200, {
        sessions: await listAdminAnalyticsSessions({
          days: requestUrl.searchParams.get('days'),
          limit: requestUrl.searchParams.get('limit'),
        }),
      })
    }),
    createPatternRoute(
      'GET',
      /^\/api\/admin\/analytics\/sessions\/([a-z0-9-]+)$/,
      async ({ request, response, params }) => {
        await requireAdminUser(request)

        try {
          sendJson(response, 200, await getAdminAnalyticsSessionDetail(params[1]))
        } catch (error) {
          if (error instanceof HttpError) {
            throw error
          }

          throw new HttpError(404, error instanceof Error ? error.message : 'Analytics session not found.')
        }
      },
    ),
  ]
}
