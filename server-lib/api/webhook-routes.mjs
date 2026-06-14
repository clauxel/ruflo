import { createExactRoute } from './route-utils.mjs'

export function createWebhookRoutes(deps) {
  const {
    readTextBody,
    verifyCreemWebhookSignature,
    getCreemWebhookEventType,
    getCreemWebhookOrderId,
    findOrderByIdStatement,
    queuePaidOrder,
    sendJson,
    verifyPayPalWebhookSignature,
    handlePayPalWebhook,
    HttpError,
  } = deps

  return [
    createExactRoute('POST', '/api/webhooks/creem', async ({ request, response }) => {
      const rawPayload = await readTextBody(request)
      const signatureHeader = request.headers['creem-signature']
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader

      if (!verifyCreemWebhookSignature(rawPayload, String(signature ?? ''))) {
        throw new HttpError(401, 'Creem webhook signature is invalid.')
      }

      const payload = rawPayload ? JSON.parse(rawPayload) : {}
      const eventType = getCreemWebhookEventType(payload)

      if (eventType === 'checkout.completed') {
        const orderId = getCreemWebhookOrderId(payload)
        const order = orderId ? await findOrderByIdStatement.get(orderId) : null

        if (order) {
          await queuePaidOrder(order)
        }
      }

      sendJson(response, 200, { received: true })
    }),
    createExactRoute('POST', '/api/webhooks/paypal', async ({ request, response }) => {
      const rawPayload = await readTextBody(request)

      if (!(await verifyPayPalWebhookSignature(rawPayload, request.headers))) {
        throw new HttpError(401, 'PayPal webhook signature is invalid.')
      }

      const payload = rawPayload ? JSON.parse(rawPayload) : {}
      await handlePayPalWebhook(payload)

      sendJson(response, 200, { received: true })
    }),
  ]
}
