export function createCatalogHelpers({
  annualBillingMultiplier,
  channelCatalog,
  formatMoney,
  HttpError,
  modelCatalog,
  planCatalog,
}) {
  function getModelDiscount(model) {
    const multiplier = Number(model?.discountMultiplier)
    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier >= 1) {
      return null
    }

    return {
      multiplier,
      label:
        typeof model?.discountLabel === 'string' && model.discountLabel.trim()
          ? model.discountLabel.trim()
          : `${Math.round((1 - multiplier) * 100)}% off`,
    }
  }

  function resolvePricingModel(options) {
    if (options?.model) {
      return options.model
    }

    if (options?.modelId) {
      return getModelById(String(options.modelId))
    }

    return null
  }

  function resolvePlanSelection(planSelectionId, options = {}) {
    const [basePlanId, requestedCycle] = String(planSelectionId ?? 'growth:monthly').split(':')
    const billingCycle = requestedCycle === 'annual' ? 'annual' : 'monthly'
    const plan = planCatalog.find((item) => item.id === basePlanId)
    if (!plan) {
      throw new HttpError(400, 'Plan is not supported.')
    }

    const baseAmountCents =
      billingCycle === 'annual'
        ? Math.round(plan.monthlyAmountCents * 12 * annualBillingMultiplier)
        : plan.monthlyAmountCents
    const discount = getModelDiscount(resolvePricingModel(options))
    const amountCents = discount ? Math.max(1, Math.round(baseAmountCents * discount.multiplier)) : baseAmountCents

    return {
      plan,
      billingCycle,
      planId: `${plan.id}:${billingCycle}`,
      baseAmountCents,
      amountCents,
      discountAmountCents: baseAmountCents - amountCents,
      discountLabel: discount?.label ?? null,
      discountMultiplier: discount?.multiplier ?? 1,
      priceLabel: formatMoney(amountCents, plan.currency),
      cycleLabel: billingCycle === 'annual' ? '/yr' : '/mo',
    }
  }

  function getPlanById(planId) {
    return resolvePlanSelection(planId).plan
  }

  function getModelById(modelId) {
    const model = modelCatalog.find((item) => item.id === modelId)
    if (!model) {
      throw new HttpError(400, 'Model is not supported.')
    }

    return model
  }

  function getChannelById(channelId) {
    const channel = channelCatalog.find((item) => item.id === channelId)
    if (!channel) {
      throw new HttpError(400, 'Channel is not supported.')
    }

    return channel
  }

  function validateCommunicationToken(channelId, token) {
    const value = token.trim()
    if (!value) {
      return
    }
  }

  return {
    getChannelById,
    getModelById,
    getPlanById,
    resolvePlanSelection,
    validateCommunicationToken,
  }
}
