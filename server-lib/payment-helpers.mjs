import { createHmac, timingSafeEqual } from 'node:crypto'

export function createPaymentHelpers({
  canUseCreemHostedReturnUrl,
  creemApiKey,
  creemBaseUrl,
  creemIsTestMode,
  findCreemProductStatement,
  findOrderByIdStatement,
  findOrderByPayPalOrderIdStatement,
  findUserByIdStatement,
  formatMoney,
  getCreemReturnOrigin,
  getPublicAppOrigin,
  guestUserEmail,
  HttpError,
  nowIso,
  payPalBaseUrls,
  payPalBaseUrlOverride,
  payPalClientId,
  payPalEnvironment,
  payPalResolvedBaseUrl,
  payPalSecret,
  payPalWebhookId,
  queuePaidOrder,
  resolvePlanSelection,
  setOrderPayPalOrderId,
  upsertCreemProductStatement,
}) {
  let resolvedPayPalBaseUrl = payPalResolvedBaseUrl

  function requireCreemApiKey() {
    if (!creemApiKey) {
      throw new HttpError(503, 'Creem payment is not configured.')
    }
  }

  function requirePayPalCredentials() {
    if (!payPalClientId || !payPalSecret) {
      throw new HttpError(503, 'PayPal payment is not configured. Set PAY_CLIENT_ID and PAY_SECRET.')
    }
  }

  function formatPayPalAmount(amountCents) {
    return (amountCents / 100).toFixed(2)
  }

  function getPayPalBaseUrlCandidates() {
    return [...new Set([resolvedPayPalBaseUrl, ...payPalBaseUrls].filter(Boolean))]
  }

  async function requestPayPalAccessToken(baseUrl) {
    const credentials = Buffer.from(`${payPalClientId}:${payPalSecret}`, 'utf8').toString('base64')
    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
      }),
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.access_token) {
      const rawMessage = payload?.error_description ?? payload?.error ?? 'PayPal access token request failed.'
      const normalizedMessage =
        String(rawMessage).toLowerCase().includes('client authentication failed')
          ? 'PayPal payment credentials are invalid. Check PAY_CLIENT_ID and PAY_SECRET.'
          : rawMessage
      throw new HttpError(502, normalizedMessage)
    }

    return payload.access_token
  }

  async function getPayPalAccessToken() {
    requirePayPalCredentials()

    let lastError = null

    for (const baseUrl of getPayPalBaseUrlCandidates()) {
      try {
        const accessToken = await requestPayPalAccessToken(baseUrl)
        resolvedPayPalBaseUrl = baseUrl
        return accessToken
      } catch (error) {
        lastError = error
        if (payPalBaseUrlOverride || payPalEnvironment !== 'auto') {
          throw error
        }
      }
    }

    if (lastError instanceof Error) {
      throw lastError
    }

    throw new HttpError(502, 'PayPal access token request failed.')
  }

  async function payPalRequest(path, { method = 'GET', body } = {}) {
    const accessToken = await getPayPalAccessToken()
    const response = await fetch(`${resolvedPayPalBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const message =
        payload?.message ??
        payload?.error_description ??
        payload?.details?.[0]?.description ??
        `PayPal request failed with status ${response.status}.`
      throw new HttpError(502, message)
    }

    return payload
  }

  function hasCompletedPayPalCapture(payload) {
    const captures = Array.isArray(payload?.purchase_units)
      ? payload.purchase_units.flatMap((unit) => unit?.payments?.captures ?? [])
      : []
    return captures.some((capture) => String(capture?.status ?? '').toUpperCase() === 'COMPLETED')
  }

  function getPayPalCheckoutUrl(payload) {
    const links = Array.isArray(payload?.links) ? payload.links : []
    const checkoutLink = links.find((link) => {
      const rel = String(link?.rel ?? '').toLowerCase()
      return rel === 'payer-action' || rel === 'approve'
    })

    return typeof checkoutLink?.href === 'string' && checkoutLink.href.trim() ? checkoutLink.href.trim() : null
  }

  async function getPayPalOrder(payPalOrderId) {
    return await payPalRequest(`/v2/checkout/orders/${encodeURIComponent(payPalOrderId)}`)
  }

  function buildPayPalOrderRequestBody(order, planSelection, returnOrigin, guestTokenQuery, useHostedCheckoutContext = true) {
    const purchaseUnit = {
      reference_id: order.id,
      custom_id: order.id,
      description: `GenericAgent ${planSelection.plan.name} ${planSelection.billingCycle === 'annual' ? 'Yearly' : 'Monthly'}`,
      amount: {
        currency_code: order.currency,
        value: formatPayPalAmount(order.amount_cents),
      },
    }

    if (useHostedCheckoutContext) {
      purchaseUnit.invoice_id = order.order_number
    }

    return {
      intent: 'CAPTURE',
      purchase_units: [purchaseUnit],
      ...(useHostedCheckoutContext
        ? {
            payment_source: {
              paypal: {
                experience_context: {
                  brand_name: 'GenericAgent',
                  landing_page: 'LOGIN',
                  user_action: 'PAY_NOW',
                  return_url: `${returnOrigin}/console?order=${order.id}${guestTokenQuery}`,
                  cancel_url: `${returnOrigin}/console?order=${order.id}${guestTokenQuery}`,
                },
              },
            },
          }
        : {}),
    }
  }

  function shouldRetryPayPalOrderCreation(error) {
    if (!(error instanceof HttpError) || error.statusCode !== 502) {
      return false
    }

    const message = String(error.message ?? '').toLowerCase()
    return (
      message.includes('semantically incorrect') ||
      message.includes('business validation') ||
      message.includes('unprocessable')
    )
  }

  async function createPayPalOrderForOrder(order, request) {
    const planSelection = resolvePlanSelection(order.plan_id, { modelId: order.model_id })
    const returnOrigin = getPublicAppOrigin(request)
    const guestTokenQuery = order.guest_token ? `&guest_token=${encodeURIComponent(order.guest_token)}` : ''

    try {
      return await payPalRequest('/v2/checkout/orders', {
        method: 'POST',
        body: buildPayPalOrderRequestBody(order, planSelection, returnOrigin, guestTokenQuery, true),
      })
    } catch (error) {
      if (!shouldRetryPayPalOrderCreation(error)) {
        throw error
      }

      return await payPalRequest('/v2/checkout/orders', {
        method: 'POST',
        body: buildPayPalOrderRequestBody(order, planSelection, returnOrigin, guestTokenQuery, false),
      })
    }
  }

  async function creemRequest(path, { method = 'GET', body } = {}) {
    requireCreemApiKey()

    const response = await fetch(`${creemBaseUrl}${path}`, {
      method,
      headers: {
        'x-api-key': creemApiKey,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new HttpError(
          502,
          'Creem rejected the API key. Use a valid Test Mode API key from the Creem Developers section while Test Mode is enabled.',
        )
      }

      const errorMessage =
        payload?.message ??
        payload?.error ??
        payload?.details?.message ??
        `Creem request failed with status ${response.status}.`
      throw new HttpError(502, errorMessage)
    }

    return payload
  }

  async function getCreemCheckoutSession(checkoutId) {
    return await creemRequest(`/v1/checkouts?checkout_id=${encodeURIComponent(checkoutId)}`)
  }

  function getCreemCheckoutId(payload) {
    const candidates = [payload?.id, payload?.checkout_id, payload?.checkoutId]

    for (const candidate of candidates) {
      if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
        return String(candidate).trim()
      }
    }

    return ''
  }

  function getCreemCheckoutUrl(payload) {
    const candidates = [payload?.checkout_url, payload?.checkoutUrl, payload?.url]

    for (const candidate of candidates) {
      if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
        return String(candidate).trim()
      }
    }

    const links = Array.isArray(payload?.links) ? payload.links : []
    const checkoutLink = links.find((link) => {
      const rel = String(link?.rel ?? '').toLowerCase()
      return rel === 'checkout' || rel === 'payment' || rel === 'payer-action'
    })

    return typeof checkoutLink?.href === 'string' && checkoutLink.href.trim() ? checkoutLink.href.trim() : null
  }

  function resolveOrderPricing(order) {
    const planSelection = resolvePlanSelection(order.plan_id, { modelId: order.model_id })
    const parsedAmountCents = Number(order.amount_cents)
    const amountCents =
      Number.isFinite(parsedAmountCents) && parsedAmountCents > 0
        ? Math.round(parsedAmountCents)
        : planSelection.amountCents
    const currency = String(order.currency ?? planSelection.plan.currency).trim() || planSelection.plan.currency

    return {
      ...planSelection,
      amountCents,
      currency,
      priceLabel: formatMoney(amountCents, currency),
    }
  }

  function getCreemProductLookupKey(orderPricing, order) {
    return `${creemIsTestMode ? 'test' : 'live'}:${orderPricing.planId}:${order.model_id}:${orderPricing.amountCents}:${orderPricing.currency}`
  }

  async function createCreemProductForOrder(order, request, orderPricing) {
    const resolvedOrderPricing = orderPricing ?? resolveOrderPricing(order)
    const lookupKey = getCreemProductLookupKey(resolvedOrderPricing, order)
    const productName = `GenericAgent ${resolvedOrderPricing.plan.name} ${resolvedOrderPricing.billingCycle === 'annual' ? 'Annual' : 'Monthly'}`
    const returnOrigin = getCreemReturnOrigin(request)
    const createdProduct = await creemRequest('/v1/products', {
      method: 'POST',
      body: {
        name: productName,
        description: `${resolvedOrderPricing.plan.subtitle} · ${resolvedOrderPricing.priceLabel}`,
        price: resolvedOrderPricing.amountCents,
        currency: resolvedOrderPricing.currency,
        billing_type: 'onetime',
        tax_mode: 'inclusive',
        tax_category: 'saas',
        ...(canUseCreemHostedReturnUrl(returnOrigin)
          ? {
              default_success_url: `${returnOrigin}/checkout`,
            }
          : {}),
      },
    })

    const timestamp = nowIso()
    await upsertCreemProductStatement.run(
      lookupKey,
      createdProduct.id,
      resolvedOrderPricing.amountCents,
      resolvedOrderPricing.currency,
      timestamp,
      timestamp,
    )

    return createdProduct.id
  }

  async function ensureCreemProductForOrder(order, request, { forceRefresh = false } = {}) {
    const orderPricing = resolveOrderPricing(order)
    const lookupKey = getCreemProductLookupKey(orderPricing, order)
    const existingProduct = forceRefresh ? null : await findCreemProductStatement.get(lookupKey)
    if (existingProduct?.product_id) {
      return existingProduct.product_id
    }

    return await createCreemProductForOrder(order, request, orderPricing)
  }

  function isCreemProductNotFoundError(error) {
    if (!(error instanceof HttpError) || error.statusCode !== 502) {
      return false
    }

    return String(error.message ?? '').toLowerCase().includes('product not found')
  }

  async function createCreemCheckoutForOrder(order, request) {
    let productId = await ensureCreemProductForOrder(order, request)
    const orderOwner = await findUserByIdStatement.get(order.user_id)
    const returnOrigin = getCreemReturnOrigin(request)
    const guestTokenQuery = order.guest_token ? `&guest_token=${encodeURIComponent(order.guest_token)}` : ''

    const buildCheckoutRequestBody = () => ({
      product_id: productId,
      request_id: order.id,
      success_url: `${returnOrigin}/console?order=${order.id}${guestTokenQuery}`,
      customer:
        orderOwner && orderOwner.email !== guestUserEmail
          ? {
              email: orderOwner.email,
            }
          : undefined,
      metadata: {
        orderId: order.id,
        orderNumber: order.order_number,
        planId: order.plan_id,
      },
    })

    try {
      return await creemRequest('/v1/checkouts', {
        method: 'POST',
        body: buildCheckoutRequestBody(),
      })
    } catch (error) {
      if (!isCreemProductNotFoundError(error)) {
        throw error
      }

      productId = await ensureCreemProductForOrder(order, request, { forceRefresh: true })

      return await creemRequest('/v1/checkouts', {
        method: 'POST',
        body: buildCheckoutRequestBody(),
      })
    }
  }

  function verifyCreemRedirectSignature(params) {
    requireCreemApiKey()

    const signature = params.signature
    if (!signature) {
      return false
    }

    const sortedParams = Object.keys(params)
      .filter((key) => key !== 'signature')
      .filter((key) => params[key] !== null && params[key] !== undefined && params[key] !== '' && params[key] !== 'null')
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&')

    const expectedSignature = createHmac('sha256', creemApiKey).update(sortedParams).digest('hex')

    if (expectedSignature.length !== signature.length) {
      return false
    }

    return timingSafeEqual(Buffer.from(expectedSignature, 'utf8'), Buffer.from(signature, 'utf8'))
  }

  function verifyCreemWebhookSignature(rawPayload, signature) {
    const webhookSecret = process.env.CREEM_WEBHOOK_SECRET ?? ''
    if (!webhookSecret || !signature) {
      return false
    }

    const expectedSignature = createHmac('sha256', webhookSecret).update(rawPayload).digest('hex')
    if (expectedSignature.length !== signature.length) {
      return false
    }

    return timingSafeEqual(Buffer.from(expectedSignature, 'utf8'), Buffer.from(signature, 'utf8'))
  }

  function getCreemWebhookEventType(payload) {
    return String(payload?.eventType ?? payload?.type ?? '').trim()
  }

  function getCreemWebhookObject(payload) {
    return payload?.object ?? payload?.data ?? payload?.checkout ?? payload
  }

  function getCreemWebhookOrderId(payload) {
    const object = getCreemWebhookObject(payload)
    const candidates = [
      object?.request_id,
      object?.requestId,
      object?.metadata?.orderId,
      object?.metadata?.order_id,
      object?.order?.request_id,
      object?.order?.requestId,
      payload?.request_id,
      payload?.requestId,
    ]

    for (const candidate of candidates) {
      if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
        return String(candidate).trim()
      }
    }

    return null
  }

  async function capturePayPalOrder(order, payPalOrderId) {
    if (!order) {
      throw new HttpError(404, 'Order not found.')
    }

    if (order.payment_status === 'paid') {
      return order
    }

    const normalizedOrderId = String(payPalOrderId ?? '').trim()
    if (!normalizedOrderId) {
      throw new HttpError(400, 'PayPal order ID is required.')
    }

    if (order.paypal_order_id && order.paypal_order_id !== normalizedOrderId) {
      throw new HttpError(400, 'PayPal order ID does not match this checkout.')
    }

    let capture

    try {
      capture = await payPalRequest(`/v2/checkout/orders/${encodeURIComponent(normalizedOrderId)}/capture`, {
        method: 'POST',
        body: {},
      })
    } catch (error) {
      try {
        const payPalOrder = await getPayPalOrder(normalizedOrderId)
        const status = String(payPalOrder?.status ?? '').toUpperCase()

        if (status === 'COMPLETED' || hasCompletedPayPalCapture(payPalOrder)) {
          await queuePaidOrder(order)
          return await findOrderByIdStatement.get(order.id)
        }
      } catch {}

      throw error
    }

    if (
      String(capture?.status ?? '').toUpperCase() !== 'COMPLETED' &&
      !hasCompletedPayPalCapture(capture)
    ) {
      throw new HttpError(400, 'PayPal payment has not been completed yet.')
    }

    await queuePaidOrder(order)
    return await findOrderByIdStatement.get(order.id)
  }

  function getPayPalWebhookOrderId(payload) {
    const resource = payload?.resource ?? {}
    const purchaseUnit = Array.isArray(resource?.purchase_units) ? resource.purchase_units[0] : null
    const candidates = [
      resource?.custom_id,
      purchaseUnit?.custom_id,
      purchaseUnit?.reference_id,
      resource?.invoice_id,
    ]

    for (const candidate of candidates) {
      if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
        return String(candidate).trim()
      }
    }

    return null
  }

  function getPayPalWebhookOrderReference(payload) {
    const resource = payload?.resource ?? {}
    const candidates = [
      resource?.id,
      resource?.supplementary_data?.related_ids?.order_id,
    ]

    for (const candidate of candidates) {
      if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
        return String(candidate).trim()
      }
    }

    return null
  }

  async function verifyPayPalWebhookSignature(rawPayload, headers) {
    requirePayPalCredentials()

    if (!payPalWebhookId) {
      return false
    }

    const transmissionId = Array.isArray(headers['paypal-transmission-id'])
      ? headers['paypal-transmission-id'][0]
      : headers['paypal-transmission-id']
    const transmissionTime = Array.isArray(headers['paypal-transmission-time'])
      ? headers['paypal-transmission-time'][0]
      : headers['paypal-transmission-time']
    const transmissionSig = Array.isArray(headers['paypal-transmission-sig'])
      ? headers['paypal-transmission-sig'][0]
      : headers['paypal-transmission-sig']
    const certUrl = Array.isArray(headers['paypal-cert-url'])
      ? headers['paypal-cert-url'][0]
      : headers['paypal-cert-url']
    const authAlgo = Array.isArray(headers['paypal-auth-algo'])
      ? headers['paypal-auth-algo'][0]
      : headers['paypal-auth-algo']

    if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
      return false
    }

    const verification = await payPalRequest('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: {
        transmission_id: String(transmissionId),
        transmission_time: String(transmissionTime),
        transmission_sig: String(transmissionSig),
        cert_url: String(certUrl),
        auth_algo: String(authAlgo),
        webhook_id: payPalWebhookId,
        webhook_event: rawPayload ? JSON.parse(rawPayload) : {},
      },
    })

    return String(verification?.verification_status ?? '').toUpperCase() === 'SUCCESS'
  }

  async function handlePayPalWebhook(payload) {
    const eventType = String(payload?.event_type ?? '').toUpperCase()
    const localOrderId = getPayPalWebhookOrderId(payload)
    const payPalOrderId = getPayPalWebhookOrderReference(payload)
    const order =
      (localOrderId ? await findOrderByIdStatement.get(localOrderId) : null) ||
      (payPalOrderId ? await findOrderByPayPalOrderIdStatement.get(payPalOrderId) : null)

    if (!order || order.payment_status === 'paid') {
      return
    }

    if (payPalOrderId && !order.paypal_order_id) {
      await setOrderPayPalOrderId(order.id, payPalOrderId)
    }

    if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      await capturePayPalOrder(order, payPalOrderId ?? order.paypal_order_id)
      return
    }

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      await queuePaidOrder(order)
    }
  }

  async function reconcileOrderPayment(order) {
    if (!order || order.payment_status !== 'pending') {
      return order
    }

    if (order.paypal_order_id) {
      try {
        const payPalOrder = await getPayPalOrder(order.paypal_order_id)
        const status = String(payPalOrder?.status ?? '').toUpperCase()

        if (status === 'APPROVED') {
          await capturePayPalOrder(order, order.paypal_order_id)
          return await findOrderByIdStatement.get(order.id)
        }

        if (status === 'COMPLETED' || hasCompletedPayPalCapture(payPalOrder)) {
          await queuePaidOrder(order)
          return await findOrderByIdStatement.get(order.id)
        }
      } catch {}
    }

    if (!order.creem_checkout_id) {
      return order
    }

    try {
      const checkout = await getCreemCheckoutSession(order.creem_checkout_id)
      const checkoutStatus = String(checkout?.status ?? '').toLowerCase()
      const orderStatus = String(checkout?.order?.status ?? '').toLowerCase()
      const checkoutRequestId = checkout?.request_id ? String(checkout.request_id) : null

      if (checkoutRequestId && checkoutRequestId !== order.id) {
        return order
      }

      if (checkoutStatus !== 'completed' && orderStatus !== 'paid' && orderStatus !== 'completed') {
        return order
      }

      await queuePaidOrder(order)
      return await findOrderByIdStatement.get(order.id)
    } catch {
      return order
    }
  }

  return {
    capturePayPalOrder,
    createCreemCheckoutForOrder,
    createPayPalOrderForOrder,
    getCreemCheckoutId,
    getCreemCheckoutSession,
    getCreemCheckoutUrl,
    getCreemWebhookEventType,
    getCreemWebhookOrderId,
    getPayPalCheckoutUrl,
    handlePayPalWebhook,
    reconcileOrderPayment,
    verifyCreemRedirectSignature,
    verifyCreemWebhookSignature,
    verifyPayPalWebhookSignature,
  }
}
