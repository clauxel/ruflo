import { annualBillingMultiplier } from '../content/catalog'
import type { BillingCycle, Plan, UserRole, UserStatus } from '../app-types'

type PricingModel = {
  discountMultiplier?: number
  discountLabel?: string
} | null | undefined

export function formatDateTime(value: string | null) {
  if (!value) return 'Never'

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function formatRole(role: UserRole) {
  return role === 'admin' ? 'Admin' : 'Operator'
}

export function formatStatus(status: UserStatus) {
  return status === 'active' ? 'Active' : 'Disabled'
}

export function formatCurrency(amountCents: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100)
}

function getModelDiscount(model: PricingModel) {
  const multiplier = Number(model?.discountMultiplier)
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier >= 1) {
    return null
  }

  return {
    multiplier,
    label: model?.discountLabel?.trim() || `${Math.round((1 - multiplier) * 100)}% off`,
  }
}

function applyDiscount(amountCents: number, multiplier: number) {
  return Math.max(1, Math.round(amountCents * multiplier))
}

export function getPlanPricing(plan: Plan, billingCycle: BillingCycle, model?: PricingModel) {
  const discount = getModelDiscount(model)

  if (billingCycle === 'monthly') {
    const amountCents = discount
      ? applyDiscount(plan.monthlyAmountCents, discount.multiplier)
      : plan.monthlyAmountCents

    return {
      amountCents,
      originalAmountCents: plan.monthlyAmountCents,
      priceLabel: formatCurrency(amountCents, plan.currency),
      originalPriceLabel: discount ? plan.monthlyPriceLabel : null,
      cycleLabel: '/mo',
      subtitle: discount ? `${discount.label} with selected model` : 'Billed monthly',
      billingDetail: discount
        ? `${formatCurrency(amountCents, plan.currency)} charged every month after ${discount.label}`
        : `${formatCurrency(plan.monthlyAmountCents, plan.currency)} charged every month`,
      discountApplied: Boolean(discount),
      discountLabel: discount?.label ?? null,
    }
  }

  const baseAnnualAmountCents = Math.round(plan.monthlyAmountCents * 12 * annualBillingMultiplier)
  const baseMonthlyEquivalentCents = Math.round(plan.monthlyAmountCents * annualBillingMultiplier)
  const annualAmountCents = discount
    ? applyDiscount(baseAnnualAmountCents, discount.multiplier)
    : baseAnnualAmountCents
  const monthlyEquivalentCents = discount
    ? applyDiscount(baseMonthlyEquivalentCents, discount.multiplier)
    : baseMonthlyEquivalentCents

  return {
    amountCents: annualAmountCents,
    originalAmountCents: baseAnnualAmountCents,
    priceLabel: formatCurrency(monthlyEquivalentCents, plan.currency),
    originalPriceLabel: discount ? formatCurrency(baseMonthlyEquivalentCents, plan.currency) : null,
    cycleLabel: '/mo',
    subtitle: discount ? `Annual billing + ${discount.label}` : 'Annual billing',
    billingDetail: discount
      ? `${formatCurrency(annualAmountCents, plan.currency)} charged yearly after ${discount.label}`
      : `${formatCurrency(annualAmountCents, plan.currency)} charged yearly`,
    discountApplied: Boolean(discount),
    discountLabel: discount?.label ?? null,
  }
}

export function formatLifecycleStatus(status: string) {
  if (status === 'deployed') {
    return 'Running'
  }

  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (value) => value.toUpperCase())
}

export function getCustomerVisibleAgentStatus(
  status: string | null | undefined,
  hasConsoleUrl: boolean,
  tokenDisplay?: string | null,
) {
  const tokenBound = Boolean(tokenDisplay && tokenDisplay !== 'Not bound')

  if (hasConsoleUrl && !tokenBound) {
    return 'Console ready'
  }

  if (status === 'stopped') {
    return 'Stopped'
  }

  if (hasConsoleUrl || status === 'running' || status === 'deployed') {
    return 'Running'
  }

  if (status === 'failed') {
    return 'Issue'
  }

  return null
}

export function getChannelBindingLabel(tokenDisplay: string | null | undefined) {
  if (!tokenDisplay || tokenDisplay === 'Not bound') {
    return 'Channel not bound'
  }

  return `Token saved ${tokenDisplay}`
}

export function formatMulticaVersion(version: string | null | undefined) {
  return `Ruflo ${version?.trim() || 'Unknown'}`
}

export function getUpgradeBadgeLabel(upgradeStatus: string, upgradeTargetVersion: string | null) {
  if (upgradeStatus === 'in_progress') {
    return upgradeTargetVersion ? `Upgrading → ${upgradeTargetVersion}` : 'Upgrading'
  }

  if (upgradeStatus === 'failed') {
    return 'Upgrade issue'
  }

  return null
}

export function getIncludedDeployments(value: number | undefined, usedCount = 0) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  return Math.max(usedCount, 1)
}

export function getRemainingDeployments(remaining: number | undefined, included: number, usedCount = 0) {
  if (typeof remaining === 'number' && Number.isFinite(remaining) && remaining >= 0) {
    return remaining
  }

  return Math.max(included - usedCount, 0)
}
