export function createSerializationHelpers({
  annualBillingMultiplier,
  buildMaskedTokenDisplay,
  decryptSecretValue,
  findDeploymentByOrderIdStatement,
  findLatestAgentInstanceByOrderIdStatement,
  formatMoney,
  getChannelById,
  getAgentMulticaVersion,
  getAgentUpgradeStatus,
  getConfiguredMulticaVersion,
  getModelById,
  getOrderIncludedDeployments,
  getReservedDeploymentCount,
  listDeploymentsByOrderIdStatement,
  resolvePlanSelection,
}) {
  function serializePlan(plan) {
    return {
      id: plan.id,
      name: plan.name,
      monthlyPriceLabel: plan.monthlyPriceLabel,
      monthlyAmountCents: plan.monthlyAmountCents,
      annualAmountCents: Math.round(plan.monthlyAmountCents * 12 * annualBillingMultiplier),
      annualPriceLabel: formatMoney(
        Math.round(plan.monthlyAmountCents * 12 * annualBillingMultiplier),
        plan.currency,
      ),
      currency: plan.currency,
      subtitle: plan.subtitle,
      etaMinutes: plan.etaMinutes,
      includedDeployments: plan.includedDeployments,
      bullets: plan.bullets,
      featured: plan.featured,
    }
  }

  function serializeDeployment(row) {
    if (!row) {
      return null
    }

    return {
      id: row.id,
      instanceName: row.instance_name,
      status: row.status,
      triggerMode: row.trigger_mode,
      sequenceNumber: row.sequence_number,
      progress: row.progress,
      etaMinutes: row.eta_minutes,
      targetServer: row.target_server,
      workspacePath: row.workspace_path,
      consoleUrl: row.console_url,
      publicEndpoint: row.public_endpoint,
      runtimeUser: row.runtime_user,
      serviceName: row.service_name,
      lastMessage: row.last_message,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      updatedAt: row.updated_at,
    }
  }

  function serializeAgentInstance(row) {
    if (!row) {
      return null
    }

    const model = getModelById(row.model_id)
    const channel = getChannelById(row.channel_id)

    return {
      id: row.id,
      orderId: row.order_id,
      deploymentId: row.deployment_id,
      sequenceNumber: row.sequence_number,
      instanceName: row.instance_name,
      modelId: row.model_id,
      modelName: model.name,
      channelId: row.channel_id,
      channelName: channel.name,
      status: row.status,
      targetServer: row.target_server,
      workspacePath: row.workspace_path,
      consoleUrl: row.console_url,
      publicEndpoint: row.public_endpoint,
      runtimeUser: row.runtime_user,
      serviceName: row.service_name,
      runtimeState: row.runtime_state ?? (row.status === 'running' ? 'running' : null),
      multicaVersion: getAgentMulticaVersion(row),
      upgradeStatus: getAgentUpgradeStatus(row),
      upgradeTargetVersion: row.upgrade_target_version,
      upgradeError: row.upgrade_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  function getOrderTokenDisplay(row) {
    try {
      const communicationToken = decryptSecretValue({
        cipherText: row.token_cipher_text,
        iv: row.token_iv,
        tag: row.token_tag,
      })
      return buildMaskedTokenDisplay(communicationToken)
    } catch {
      return 'Token unavailable'
    }
  }

  async function serializeOrder(row, { viewerContext = null } = {}) {
    const planSelection = resolvePlanSelection(row.plan_id)
    const plan = planSelection.plan
    const model = getModelById(row.model_id)
    const channel = getChannelById(row.channel_id)
    const deployment = serializeDeployment(await findDeploymentByOrderIdStatement.get(row.id))
    const deployments = (await listDeploymentsByOrderIdStatement.all(row.id)).map(serializeDeployment)
    const instance = serializeAgentInstance(await findLatestAgentInstanceByOrderIdStatement.get(row.id))
    const guestTokenQuery = row.guest_token ? `&guest_token=${encodeURIComponent(row.guest_token)}` : ''
    const tokenDisplay = getOrderTokenDisplay(row)
    const includedDeployments = getOrderIncludedDeployments(row)
    const reservedDeployments = await getReservedDeploymentCount(row.id)
    const configuredMulticaVersion = getConfiguredMulticaVersion()
    const multicaVersion = instance?.multicaVersion ?? configuredMulticaVersion
    const upgradeStatus = instance?.upgradeStatus ?? 'idle'
    const upgradeTargetVersion = instance?.upgradeTargetVersion ?? null
    const upgradeError = instance?.upgradeError ?? null
    const deploymentStatus = deployment?.status ?? row.deployment_status
    const statusMessage = deployment?.lastMessage ?? row.status_message
    const canAdminDeleteMultica =
      viewerContext?.kind === 'user' &&
      viewerContext.user?.role === 'admin' &&
      Boolean(instance)

    return {
      id: row.id,
      orderNumber: row.order_number,
      planId: row.plan_id,
      planName: `${plan.name} · ${planSelection.billingCycle === 'annual' ? 'Yearly' : 'Monthly'}`,
      amountCents: row.amount_cents,
      amountLabel: formatMoney(row.amount_cents, row.currency),
      currency: row.currency,
      modelId: row.model_id,
      modelName: model.name,
      channelId: row.channel_id,
      channelName: channel.name,
      paymentStatus: row.payment_status,
      deploymentStatus,
      statusMessage,
      deploymentEtaMinutes: row.deployment_eta_minutes,
      includedDeployments,
      deploymentsUsed: reservedDeployments,
      deploymentsRemaining: Math.max(includedDeployments - reservedDeployments, 0),
      canTriggerDeployment: row.payment_status === 'paid' && reservedDeployments < includedDeployments,
      bindingStatus: row.guest_token ? 'unbound' : 'bound',
      tokenDisplay,
      canAdminDeleteMultica,
      multicaVersion,
      upgradeStatus,
      upgradeTargetVersion,
      upgradeError,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      paidAt: row.paid_at,
      checkoutPath: `/checkout?order=${row.id}${guestTokenQuery}`,
      consolePath: `/console?order=${row.id}${guestTokenQuery}`,
      deployment,
      deployments,
      instance,
    }
  }

  return {
    serializeAgentInstance,
    serializeDeployment,
    serializeOrder,
    serializePlan,
  }
}
