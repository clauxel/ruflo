function createHttpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

async function resolveSecretValue(value) {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value.get === 'function') {
    const resolved = await value.get()
    return typeof resolved === 'string' ? resolved.trim() : ''
  }
  return ''
}

function stripTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function firstString(candidates) {
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (value) return value
  }
  return ''
}

function normalizePlanCatalog(plans) {
  if (Array.isArray(plans)) return plans.filter(Boolean)
  if (plans && typeof plans === 'object') return Object.values(plans).filter(Boolean)
  return []
}

function formatAmountCents(amountCents) {
  return (Math.max(0, Number(amountCents) || 0) / 100).toFixed(2)
}

function normalizeBilling(value) {
  return String(value || '').toLowerCase() === 'monthly' ? 'monthly' : 'annual'
}

function resolvePlanSelection(body, options = {}) {
  const plans = normalizePlanCatalog(options.plans)
  if (!plans.length) throw createHttpError(500, 'Wallet checkout plan catalog is not configured.')

  const rawSelection = String(body?.planId || body?.plan || body?.selectionId || options.defaultPlanId || '').trim()
  const parts = rawSelection.split(':')
  const rawPlanId = parts[0]
  const rawBilling = parts[1]
  const planId = rawPlanId || String(options.defaultPlanId || '').trim()
  const billing = normalizeBilling(body?.billing || body?.billingCycle || rawBilling || options.defaultBilling || 'annual')
  let plan = plans.find((candidate) => String(candidate?.id || '').trim() === planId)
  if (!plan && options.defaultPlanId) {
    plan = plans.find((candidate) => String(candidate?.id || '').trim() === String(options.defaultPlanId).trim())
  }
  if (!plan) plan = plans[0]
  if (!plan || plan.mode === 'contact') throw createHttpError(400, 'This plan is not available for wallet checkout.')

  const hasFixedAmount = plan.amountCents !== undefined && plan.monthlyAmountCents === undefined && plan.monthlyCents === undefined
  const baseAmountCents = Number(
    plan.monthlyAmountCents ??
      plan.monthlyCents ??
      plan.amountCents ??
      (Number.isFinite(Number(plan.monthlyUsd)) ? Number(plan.monthlyUsd) * 100 : NaN),
  )
  if (!Number.isFinite(baseAmountCents) || baseAmountCents <= 0) {
    throw createHttpError(400, 'This plan does not have a wallet-checkout amount.')
  }

  const annualMultiplier = Number(
    plan.annualDiscountMultiplier ??
      plan.annualBillingMultiplier ??
      options.annualDiscountMultiplier ??
      options.annualBillingMultiplier ??
      0.5,
  )
  const safeAnnualMultiplier = Number.isFinite(annualMultiplier) && annualMultiplier > 0 ? annualMultiplier : 1
  const amountCents = hasFixedAmount
    ? Math.round(baseAmountCents)
    : billing === 'annual'
      ? Math.round(baseAmountCents * 12 * safeAnnualMultiplier)
      : Math.round(baseAmountCents)
  const currency = String(plan.currency || options.currency || 'USD').trim().toUpperCase()

  return {
    plan,
    planId: String(plan.id || planId),
    billing,
    selectionId: String(plan.id || planId) + ':' + billing,
    amountCents,
    currency,
  }
}

function jsonResponse(payload, status = 200, request = null) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  const origin = request?.headers?.get?.('Origin')
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type')
    headers.set('Vary', 'Origin')
  }
  return new Response(JSON.stringify(payload), { status, headers })
}

async function getNowPaymentsSettings(env) {
  return {
    apiKey: await resolveSecretValue(env?.NOWPAYMENTS_API_KEY ?? env?.NOWPAYMENTS_KEY),
    baseUrl: stripTrailingSlash(env?.NOWPAYMENTS_BASE_URL || 'https://api.nowpayments.io'),
    payCurrency: String(env?.NOWPAYMENTS_PAY_CURRENCY || 'USDCMATIC').trim().toUpperCase(),
  }
}

async function createNowPaymentsInvoice(env, invoice) {
  const settings = await getNowPaymentsSettings(env)
  if (!settings.apiKey) throw createHttpError(503, 'NOWPayments is not configured on this deployment.')

  const response = await fetch(settings.baseUrl + '/v1/invoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
    },
    body: JSON.stringify(invoice),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.message || payload?.error || 'NOWPayments invoice could not be created.'
    throw createHttpError(response.status === 401 || response.status === 403 ? response.status : 502, message)
  }

  const checkoutUrl = firstString([payload?.invoice_url, payload?.invoiceUrl, payload?.url])
  const invoiceId = firstString([payload?.id, payload?.invoice_id, payload?.invoiceId])
  if (!checkoutUrl) throw createHttpError(502, 'NOWPayments invoice did not return a payment URL.')
  return { checkoutUrl, invoiceId, payCurrency: settings.payCurrency }
}

export async function handleNowPaymentsCheckout(request, env, options = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: jsonResponse({}, 200, request).headers })
  if (request.method !== 'POST') return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405, request)

  try {
    const body = await request.json().catch(() => {
      throw createHttpError(400, 'Request body must be valid JSON.')
    })
    const selection = resolvePlanSelection(body, options)
    const requestUrl = new URL(request.url)
    const origin = stripTrailingSlash(
      typeof options.resolveOrigin === 'function' ? options.resolveOrigin(request, env, body) : requestUrl.origin,
    )
    const orderId = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now()) + Math.random().toString(16).slice(2)
    const orderNumber = String(options.siteKey || options.siteName || 'SITE')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toUpperCase()
      .slice(0, 10) + '-' + Date.now().toString(36).toUpperCase() + '-' + orderId.slice(0, 6).toUpperCase()
    const successUrl = new URL(origin + '/')
    successUrl.searchParams.set('checkout', 'nowpayments_pending')
    successUrl.searchParams.set('provider', 'nowpayments')
    successUrl.searchParams.set('order', orderId)
    successUrl.searchParams.set('plan', selection.selectionId)
    const cancelUrl = new URL(origin + '/')
    cancelUrl.searchParams.set('checkout', 'cancelled')
    cancelUrl.searchParams.set('provider', 'nowpayments')
    cancelUrl.searchParams.set('order', orderId)
    cancelUrl.searchParams.set('plan', selection.selectionId)

    const invoice = await createNowPaymentsInvoice(env, {
      price_amount: formatAmountCents(selection.amountCents),
      price_currency: selection.currency.toLowerCase(),
      pay_currency: String(env?.NOWPAYMENTS_PAY_CURRENCY || 'USDCMATIC').trim().toUpperCase(),
      order_id: orderId,
      order_description: String(options.siteName || 'SaaS') + ' ' + String(selection.plan?.name || selection.planId) + ' ' + selection.billing + ' plan - ' + orderNumber,
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString(),
      is_fixed_rate: true,
      is_fee_paid_by_user: false,
    })

    return jsonResponse({
      ok: true,
      message: 'NOWPayments invoice is ready.',
      checkoutUrl: invoice.checkoutUrl,
      paymentProvider: 'nowpayments',
      provider: 'nowpayments',
      nowpaymentsInvoiceId: invoice.invoiceId || null,
      payCurrency: invoice.payCurrency,
      orderId,
      orderNumber,
      planId: selection.selectionId,
      billing: selection.billing,
      amountCents: selection.amountCents,
      currency: selection.currency,
    }, 200, request)
  } catch (error) {
    const status = error?.statusCode || 500
    const message = error instanceof Error ? error.message : 'NOWPayments checkout could not be started.'
    return jsonResponse({ ok: false, message, error: message }, status, request)
  }
}
