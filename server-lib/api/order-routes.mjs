import { createExactRoute, createPatternRoute } from './route-utils.mjs'

const creemRedirectParamKeys = new Set([
  'checkout_id',
  'order_id',
  'customer_id',
  'subscription_id',
  'product_id',
  'request_id',
  'signature',
])

function normalizeCreemRedirectPayload(value) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const entries = Object.entries(value)
    .filter(([key]) => creemRedirectParamKeys.has(key))
    .map(([key, payloadValue]) => [
      key,
      payloadValue === null || payloadValue === undefined ? null : String(payloadValue),
    ])

  return Object.fromEntries(entries)
}

export function createOrderRoutes(deps) {
  const {
    sendJson,
    requireOrderAccessContext,
    listVisibleOrders,
    listVisibleAgentInstances,
    getAuthenticatedContext,
    readJsonBody,
    resolvePlanSelection,
    getModelById,
    getChannelById,
    getGuestToken,
    randomBytes,
    ensureGuestUser,
    validateCommunicationToken,
    encryptSecretValue,
    nowIso,
    createOrderStatement,
    buildOrderNumber,
    setGuestCookie,
    serializeOrder,
    findOrderByIdStatement,
    reconcileOrderPayment,
    assertOrderAccess,
    findLatestAgentInstanceByOrderIdStatement,
    findAgentInstanceByDeploymentIdStatement,
    findDeploymentByIdStatement,
    findDeploymentByOrderIdStatement,
    HttpError,
    getDeploymentConsoleToken,
    createMulticaConsoleSessionUrl,
    stopMulticaInstance,
    uninstallMulticaInstance,
    requireAuthenticatedUser,
    bindOrderToUserAccount,
    createCreemCheckoutForOrder,
    createPayPalOrderForOrder,
    getCreemCheckoutId,
    getCreemCheckoutUrl,
    setOrderCheckoutId,
    setOrderPayPalOrderId,
    getPayPalCheckoutUrl,
    payPalClientId,
    capturePayPalOrder,
    canTriggerDeployment,
    deletePendingOrder,
    createDeploymentForOrder,
    getDeploymentRuntimeConfig,
    listConfiguredMulticaVersions,
    getAgentMulticaVersion,
    upgradeMulticaInstance,
    verifyCreemRedirectSignature,
    getCreemCheckoutSession,
    queuePaidOrder,
    appEnvironment,
    isProduction,
    getConfiguredUserRole,
    paymentProvider,
  } = deps

  const usesManualDeploymentMode = process.env.MULTICA_DEPLOYMENT_MODE === 'manual'
  const paymentConfirmedMessage = usesManualDeploymentMode
    ? 'Payment confirmed. Your Multica is in the provisioning queue.'
    : 'Payment confirmed. Deployment queue started.'
  const payPalConfirmedMessage = usesManualDeploymentMode
    ? 'PayPal payment confirmed. Your Multica is in the provisioning queue.'
    : 'PayPal payment confirmed. Deployment queue started.'
  const creemConfirmedMessage = usesManualDeploymentMode
    ? 'Creem payment confirmed. Your Multica is in the provisioning queue.'
    : 'Creem payment confirmed. Deployment queue started.'

  function resolveOrderAmountCents(planSelection, authContext) {
    const isConfiguredAdminBuyer =
      appEnvironment === 'production' &&
      authContext?.user &&
      getConfiguredUserRole(authContext.user.email) === 'admin'

    return isConfiguredAdminBuyer ? 100 : planSelection.amountCents
  }

  async function createLaunchOrderFromRequest(request, response) {
    const authContext = await getAuthenticatedContext(request)
    const body = await readJsonBody(request)
    const model = getModelById(String(body.modelId ?? ''))
    const planSelection = resolvePlanSelection(String(body.planId ?? 'growth:monthly'), { model })
    const plan = planSelection.plan
    const channel = getChannelById(String(body.channelId ?? ''))
    const communicationToken = String(body.communicationToken ?? '').trim()
    const guestToken = authContext ? null : getGuestToken(request) ?? randomBytes(18).toString('base64url')
    const ownerUserId = authContext ? authContext.user.id : (await ensureGuestUser()).id

    validateCommunicationToken(channel.id, communicationToken)

    const encryptedToken = encryptSecretValue(communicationToken)
    const orderId = randomBytes(16).toString('hex')
    const timestamp = nowIso()
    const amountCents = resolveOrderAmountCents(planSelection, authContext)

    await createOrderStatement.run(
      orderId,
      buildOrderNumber(),
      ownerUserId,
      guestToken,
      planSelection.planId,
      model.id,
      channel.id,
      encryptedToken.cipherText,
      encryptedToken.iv,
      encryptedToken.tag,
      amountCents,
      plan.currency,
      'pending',
      'awaiting_payment',
      'Awaiting payment confirmation before deployment starts.',
      plan.etaMinutes,
      plan.includedDeployments,
      timestamp,
      timestamp,
    )

    if (guestToken) {
      setGuestCookie(response, guestToken, request)
    }

    return await findOrderByIdStatement.get(orderId)
  }

  async function createCheckoutSessionPayload(order, request) {
    if (order.payment_status === 'paid') {
      return {
        message: 'This order has already been paid.',
        order: await serializeOrder(order),
        checkoutUrl: null,
        paymentProvider,
        creemCheckoutId: order.creem_checkout_id ?? null,
        paypalOrderId: null,
        paypalClientId: null,
      }
    }

    if (paymentProvider === 'creem') {
      const checkout = await createCreemCheckoutForOrder(order, request)
      const checkoutUrl = getCreemCheckoutUrl(checkout)
      const checkoutId = getCreemCheckoutId(checkout)

      if (!checkoutUrl) {
        throw new HttpError(502, 'Creem checkout did not return a hosted checkout URL.')
      }

      let orderWithCheckout = order
      if (checkoutId) {
        try {
          orderWithCheckout = await setOrderCheckoutId(order.id, checkoutId)
        } catch (error) {
          console.warn('Creem checkout was created, but the checkout id could not be saved.', error)
        }
      }

      return {
        message: 'Creem checkout is ready.',
        order: await serializeOrder(orderWithCheckout),
        checkoutUrl,
        paymentProvider: 'creem',
        creemCheckoutId: checkoutId || null,
        paypalOrderId: null,
        paypalClientId: null,
      }
    }

    const checkout = await createPayPalOrderForOrder(order, request)
    let orderWithCheckout = order
    try {
      orderWithCheckout = await setOrderPayPalOrderId(order.id, String(checkout.id ?? ''))
    } catch (error) {
      console.warn('PayPal checkout was created, but the PayPal order id could not be saved.', error)
    }

    return {
      message: 'PayPal checkout is ready.',
      order: await serializeOrder(orderWithCheckout),
      checkoutUrl: getPayPalCheckoutUrl(checkout),
      paymentProvider: 'paypal',
      creemCheckoutId: null,
      paypalOrderId: checkout.id ?? null,
      paypalClientId: payPalClientId || null,
    }
  }

  return [
    createExactRoute('GET', '/api/console-data', async ({ request, response }) => {
      const context = await requireOrderAccessContext(request)
      const visibleOrders = await listVisibleOrders(context)

      sendJson(response, 200, {
        orders: visibleOrders,
        claws: await listVisibleAgentInstances(context),
        users:
          context.kind === 'user' && context.user.role === 'admin'
            ? (await deps.listUsersStatement.all()).map(deps.serializeUser)
          : [],
      })
    }),
    createExactRoute('POST', '/api/launch-checkout', async ({ request, response }) => {
      const order = await createLaunchOrderFromRequest(request, response)
      const checkout = await createCheckoutSessionPayload(order, request)
      const serializedOrder = checkout.order

      sendJson(response, 200, {
        message: checkout.message,
        orderId: serializedOrder.id,
        orderNumber: serializedOrder.orderNumber,
        planId: serializedOrder.planId,
        modelId: serializedOrder.modelId,
        channelId: serializedOrder.channelId,
        amountCents: serializedOrder.amountCents,
        amountLabel: serializedOrder.amountLabel,
        currency: serializedOrder.currency,
        checkoutUrl: checkout.checkoutUrl,
        paymentProvider: checkout.paymentProvider,
        creemCheckoutId: checkout.creemCheckoutId ?? null,
        paypalOrderId: checkout.paypalOrderId ?? null,
        paypalClientId: checkout.paypalClientId ?? null,
        stateless: false,
        order: serializedOrder,
      })
    }),
    createExactRoute('POST', '/api/launch-orders', async ({ request, response }) => {
      const order = await createLaunchOrderFromRequest(request, response)

      sendJson(response, 201, {
        message: 'Launch order created. Complete payment to start provisioning.',
        order: await serializeOrder(order),
      })
    }),
    createExactRoute('GET', '/api/orders', async ({ request, response }) => {
      const context = await requireOrderAccessContext(request)
      const visibleOrders = await listVisibleOrders(context)
      sendJson(response, 200, {
        orders: visibleOrders,
      })
    }),
    createPatternRoute('GET', /^\/api\/orders\/([a-f0-9]+)$/, async ({ request, response, params }) => {
      const context = await requireOrderAccessContext(request)
      const order = await reconcileOrderPayment(await findOrderByIdStatement.get(params[1]))
      await assertOrderAccess(context, order)
      sendJson(response, 200, {
        order: await serializeOrder(order),
      })
    }),
    createPatternRoute('POST', /^\/api\/orders\/([a-f0-9]+)\/multica-console$/, async ({ request, response, params }) => {
      const context = await requireOrderAccessContext(request)
      const order = await findOrderByIdStatement.get(params[1])
      await assertOrderAccess(context, order)

      const body = await readJsonBody(request)
      const requestedDeploymentId = String(body.deploymentId ?? '').trim()
      const deployment = requestedDeploymentId
        ? await findDeploymentByIdStatement.get(requestedDeploymentId)
        : await findDeploymentByOrderIdStatement.get(order.id)

      if (!deployment || deployment.order_id !== order.id) {
        throw new HttpError(404, 'Deployment not found.')
      }

      const claw = requestedDeploymentId
        ? await findAgentInstanceByDeploymentIdStatement.get(deployment.id)
        : await findLatestAgentInstanceByOrderIdStatement.get(order.id)
      if (claw?.runtime_state === 'stopped') {
        throw new HttpError(400, 'This GenericAgent workspace is stopped. Start a new provisioning run or uninstall it first.')
      }

      if (!deployment.console_url) {
        throw new HttpError(400, 'Multica console is not ready yet.')
      }

      const consoleToken = getDeploymentConsoleToken(deployment)
      const consoleUrl = createMulticaConsoleSessionUrl({
        orderId: order.id,
        deploymentId: deployment.id,
        consoleUrl: deployment.console_url,
        consoleToken,
        guestToken: context.kind === 'guest' ? order.guest_token : null,
      })

      sendJson(response, 200, {
        url: consoleUrl,
      })
    }),
    createPatternRoute('POST', /^\/api\/orders\/([a-f0-9]+)\/multica-stop$/, async ({ request, response, params }) => {
      const context = await requireOrderAccessContext(request)
      const order = await findOrderByIdStatement.get(params[1])
      await assertOrderAccess(context, order)

      const updatedOrder = await stopMulticaInstance(order)
      sendJson(response, 200, {
        message: 'GenericAgent workspace stopped successfully.',
        order: await serializeOrder(updatedOrder),
      })
    }),
    createPatternRoute('POST', /^\/api\/orders\/([a-f0-9]+)\/multica-uninstall$/, async ({ request, response, params }) => {
      const context = await requireOrderAccessContext(request)
      const order = await findOrderByIdStatement.get(params[1])
      await assertOrderAccess(context, order)

      const updatedOrder = await uninstallMulticaInstance(order)
      sendJson(response, 200, {
        message: 'GenericAgent workspace uninstalled successfully.',
        order: await serializeOrder(updatedOrder),
      })
    }),
    createPatternRoute('POST', /^\/api\/orders\/([a-f0-9]+)\/multica-delete$/, async ({ request, response, params }) => {
      const context = await requireOrderAccessContext(request)
      const order = await findOrderByIdStatement.get(params[1])
      await assertOrderAccess(context, order)

      const updatedOrder = await uninstallMulticaInstance(order)
      sendJson(response, 200, {
        message: 'GenericAgent workspace deleted successfully.',
        order: await serializeOrder(updatedOrder),
      })
    }),
    createPatternRoute('POST', /^\/api\/orders\/([a-f0-9]+)\/delete$/, async ({ request, response, params }) => {
      if (appEnvironment !== 'development') {
        throw new HttpError(403, 'Deleting unpaid orders is only available in development mode.')
      }

      const context = await requireOrderAccessContext(request)
      const order = await findOrderByIdStatement.get(params[1])
      await assertOrderAccess(context, order)

      await deletePendingOrder(order)
      sendJson(response, 200, {
        message: 'Order deleted successfully.',
      })
    }),
    createPatternRoute('POST', /^\/api\/orders\/([a-f0-9]+)\/bind-account$/, async ({ request, response, params }) => {
      const authContext = await requireAuthenticatedUser(request)
      const order = await findOrderByIdStatement.get(params[1])
      const guestToken = getGuestToken(request)

      if (!order) {
        throw new HttpError(404, 'Order not found.')
      }

      if (!order.guest_token) {
        sendJson(response, 200, {
          message: 'This order is already bound to an account.',
          order: await serializeOrder(order),
        })
        return
      }

      if (!guestToken || guestToken !== order.guest_token) {
        throw new HttpError(403, 'Guest order access denied.')
      }

      const boundOrder = await bindOrderToUserAccount(order.id, authContext.user.id)
      sendJson(response, 200, {
        message: 'Order is now bound to your account.',
        order: await serializeOrder(boundOrder),
      })
    }),
    createPatternRoute('POST', /^\/api\/orders\/([a-f0-9]+)\/checkout-session$/, async ({ request, response, params }) => {
      const context = await requireOrderAccessContext(request)
      const order = await findOrderByIdStatement.get(params[1])
      await assertOrderAccess(context, order)

      sendJson(response, 200, await createCheckoutSessionPayload(order, request))
    }),
    createPatternRoute('POST', /^\/api\/orders\/([a-f0-9]+)\/paypal-capture$/, async ({ request, response, params }) => {
      const context = await requireOrderAccessContext(request)
      const order = await findOrderByIdStatement.get(params[1])
      await assertOrderAccess(context, order)

      const body = await readJsonBody(request)
      const paidOrder = await capturePayPalOrder(order, body.paypalOrderId ?? order.paypal_order_id)

      sendJson(response, 200, {
        message: payPalConfirmedMessage,
        order: await serializeOrder(paidOrder),
      })
    }),
    createPatternRoute('POST', /^\/api\/orders\/([a-f0-9]+)\/deployments$/, async ({ request, response, params }) => {
      const context = await requireOrderAccessContext(request)
      const order = await findOrderByIdStatement.get(params[1])
      await assertOrderAccess(context, order)

      if (order.payment_status !== 'paid') {
        throw new HttpError(400, 'Pay for this order before triggering another Multica deployment.')
      }

      if (!(await canTriggerDeployment(order))) {
        throw new HttpError(400, 'This order has already used every deployable Multica slot.')
      }

      await createDeploymentForOrder(order, 'manual')

      sendJson(response, 201, {
        message: 'A new deployment trigger has been queued for this order.',
        order: await serializeOrder(await findOrderByIdStatement.get(order.id)),
      })
    }),
    createPatternRoute('GET', /^\/api\/orders\/([a-f0-9]+)\/multica-versions$/, async ({ request, response, params }) => {
      const context = await requireOrderAccessContext(request)
      const order = await findOrderByIdStatement.get(params[1])
      await assertOrderAccess(context, order)

      const claw = await findLatestAgentInstanceByOrderIdStatement.get(order.id)
      if (!claw) {
        throw new HttpError(400, 'Multica is not deployed yet.')
      }

      const config = getDeploymentRuntimeConfig()
      const versions = await listConfiguredMulticaVersions(config)

      sendJson(response, 200, {
        versions,
        currentVersion: getAgentMulticaVersion(claw),
        configuredVersion: config.multica.repoRef,
      })
    }),
    createPatternRoute('POST', /^\/api\/orders\/([a-f0-9]+)\/multica-upgrade$/, async ({ request, response, params }) => {
      const context = await requireOrderAccessContext(request)
      const order = await findOrderByIdStatement.get(params[1])
      await assertOrderAccess(context, order)

      const body = await readJsonBody(request)
      const upgradedOrder = await upgradeMulticaInstance(order, body.version)

      sendJson(response, 200, {
        message: `Multica has been upgraded to ${String(body.version ?? '').trim()}.`,
        order: await serializeOrder(upgradedOrder),
      })
    }),
    createPatternRoute('POST', /^\/api\/orders\/([a-f0-9]+)\/creem-confirm$/, async ({ request, response, params }) => {
      const context = await requireOrderAccessContext(request)
      const order = await findOrderByIdStatement.get(params[1])
      await assertOrderAccess(context, order)

      if (order.payment_status === 'paid') {
        sendJson(response, 200, {
          message: 'Payment already confirmed.',
          order: await serializeOrder(order),
        })
        return
      }

      const body = await readJsonBody(request)
      const redirectPayload =
        normalizeCreemRedirectPayload(body.redirectParams) ?? {
              checkout_id: String(body.checkoutId ?? ''),
              order_id: body.creemOrderId ? String(body.creemOrderId) : null,
              customer_id: body.customerId ? String(body.customerId) : null,
              subscription_id: body.subscriptionId ? String(body.subscriptionId) : null,
              product_id: String(body.productId ?? ''),
              request_id: body.requestId ? String(body.requestId) : null,
              signature: String(body.signature ?? ''),
            }

      if (!redirectPayload.checkout_id) {
        throw new HttpError(400, 'Creem redirect payload is incomplete.')
      }

      if (order.creem_checkout_id && redirectPayload.checkout_id !== order.creem_checkout_id) {
        throw new HttpError(400, 'Creem checkout does not belong to this order.')
      }

      const matchedOrderId = redirectPayload.request_id ?? null
      if (matchedOrderId && matchedOrderId !== order.id) {
        throw new HttpError(400, 'Creem request ID does not match this order.')
      }

      const hasVerifiedRedirectSignature =
        Boolean(redirectPayload.signature) && verifyCreemRedirectSignature(redirectPayload)

      if (!hasVerifiedRedirectSignature) {
        const checkout = await getCreemCheckoutSession(redirectPayload.checkout_id)
        const checkoutRequestId = checkout?.request_id ? String(checkout.request_id) : null
        const checkoutStatus = String(checkout?.status ?? '').toLowerCase()
        const orderStatus = String(checkout?.order?.status ?? '').toLowerCase()

        if (checkoutRequestId && checkoutRequestId !== order.id) {
          throw new HttpError(400, 'Creem checkout does not belong to this order.')
        }

        if (checkoutStatus !== 'completed' && orderStatus !== 'paid' && orderStatus !== 'completed') {
          throw new HttpError(
            redirectPayload.signature ? 401 : 400,
            redirectPayload.signature
              ? 'Creem redirect signature is invalid.'
              : 'Creem checkout is not completed yet.',
          )
        }
      }

      await queuePaidOrder(order)

      sendJson(response, 200, {
        message: creemConfirmedMessage,
        order: await serializeOrder(await findOrderByIdStatement.get(order.id)),
      })
    }),
    createPatternRoute('POST', /^\/api\/orders\/([a-f0-9]+)\/pay$/, async ({ request, response, params }) => {
      if (isProduction) {
        throw new HttpError(404, 'Not found.')
      }

      const context = await requireOrderAccessContext(request)
      const order = await findOrderByIdStatement.get(params[1])
      await assertOrderAccess(context, order)

      if (order.payment_status !== 'pending') {
        throw new HttpError(400, 'This order has already been paid or closed.')
      }
      await queuePaidOrder(order)

      sendJson(response, 200, {
        message: paymentConfirmedMessage,
        order: await serializeOrder(await findOrderByIdStatement.get(order.id)),
      })
    }),
  ]
}
