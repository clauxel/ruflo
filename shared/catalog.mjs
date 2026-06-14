export const annualBillingMultiplier = 0.5
export const modelDiscountMultiplier = 0.5
export const modelDiscountLabel = '50% off'
export const modelDiscountTooltip = 'Choose this model and get 50% off the package price.'

export const planCatalog = [
  {
    id: 'starter',
    name: 'Starter',
    monthlyPriceLabel: '$19',
    monthlyAmountCents: 1900,
    currency: 'USD',
    subtitle: 'For a first hosted Ruflo workspace',
    etaMinutes: 12,
    includedDeployments: 1,
    bullets: ['1 hosted Ruflo workspace', 'Claude Code or Codex entrypoint', 'Memory and tool orchestration basics'],
    featured: false,
  },
  {
    id: 'growth',
    name: 'Growth',
    monthlyPriceLabel: '$49',
    monthlyAmountCents: 4900,
    currency: 'USD',
    subtitle: 'Best value for active teams',
    etaMinutes: 8,
    includedDeployments: 5,
    bullets: ['5 hosted Ruflo workspaces', 'Swarm planning and review flows', 'Reusable memory for recurring work'],
    featured: true,
  },
  {
    id: 'scale',
    name: 'Scale',
    monthlyPriceLabel: '$149',
    monthlyAmountCents: 14900,
    currency: 'USD',
    subtitle: 'For organizations running agent programs',
    etaMinutes: 5,
    includedDeployments: 20,
    bullets: ['20 hosted Ruflo workspaces', 'Federated agent rollout planning', 'Priority provisioning and launch support'],
    featured: false,
  },
]

export const modelCatalog = [
  {
    id: 'gpt-5-5',
    name: 'GPT-5.5',
    status: 'Latest OpenAI route',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    status: 'Claude Code',
  },
  {
    id: 'gemini-3-1-pro',
    name: 'Gemini 3.1 Pro',
    status: 'Planner',
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    status: 'Deep review',
    discountMultiplier: modelDiscountMultiplier,
    discountLabel: modelDiscountLabel,
    discountTooltip: modelDiscountTooltip,
  },
  {
    id: 'glm-4-7',
    name: 'GLM-4.7',
    status: 'Budget route',
    discountMultiplier: modelDiscountMultiplier,
    discountLabel: modelDiscountLabel,
    discountTooltip: modelDiscountTooltip,
  },
  {
    id: 'glm-5-1',
    name: 'GLM-5.1',
    status: 'Reasoning route',
    discountMultiplier: modelDiscountMultiplier,
    discountLabel: modelDiscountLabel,
    discountTooltip: modelDiscountTooltip,
  },
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    status: 'Research route',
    discountMultiplier: modelDiscountMultiplier,
    discountLabel: modelDiscountLabel,
    discountTooltip: modelDiscountTooltip,
  },
  {
    id: 'gpt-5-4',
    name: 'GPT-5.4',
    status: 'Previous OpenAI route',
  },
  {
    id: 'gpt-4-1',
    name: 'GPT-4.1',
    status: 'Stable route',
    discountMultiplier: modelDiscountMultiplier,
    discountLabel: modelDiscountLabel,
    discountTooltip: modelDiscountTooltip,
  },
]

export const channelCatalog = [
  { id: 'telegram', name: 'Claude Code', status: 'Available' },
  { id: 'discord', name: 'Codex', status: 'Available' },
  { id: 'whatsapp', name: 'Ruflo UI', status: 'Available' },
]
