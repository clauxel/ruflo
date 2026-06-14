import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
}

export type Option = {
  id: string
  name: string
  status: string
  icon: ReactNode
  description?: string
  highlights?: string[]
  discountMultiplier?: number
  discountLabel?: string
  discountTooltip?: string
}

export type Feature = {
  title: string
  description: ReactNode
}

export type Plan = {
  id: string
  name: string
  monthlyPriceLabel: string
  monthlyAmountCents: number
  currency: string
  subtitle: string
  bullets: string[]
  etaMinutes: number
  includedDeployments: number
  featured?: boolean
}

export type DeploymentRecord = {
  id: string
  instanceName: string
  status: string
  triggerMode: string
  sequenceNumber: number
  progress: number
  etaMinutes: number
  targetServer: string
  workspacePath: string | null
  consoleUrl: string | null
  publicEndpoint: string | null
  runtimeUser: string | null
  serviceName: string | null
  lastMessage: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export type AgentInstanceRecord = {
  id: string
  orderId: string
  deploymentId: string
  sequenceNumber: number
  instanceName: string
  modelId: string
  modelName: string
  channelId: string
  channelName: string
  status: string
  targetServer: string
  workspacePath: string | null
  consoleUrl: string | null
  publicEndpoint: string | null
  runtimeUser: string | null
  serviceName: string | null
  runtimeState: string | null
  multicaVersion: string
  upgradeStatus: string
  upgradeTargetVersion: string | null
  upgradeError: string | null
  createdAt: string
  updatedAt: string
}

export type OrderRecord = {
  id: string
  orderNumber: string
  planId: string
  planName: string
  amountCents: number
  amountLabel: string
  currency: string
  modelId: string
  modelName: string
  channelId: string
  channelName: string
  paymentStatus: string
  deploymentStatus: string
  statusMessage: string
  deploymentEtaMinutes: number
  includedDeployments: number
  deploymentsUsed: number
  deploymentsRemaining: number
  canTriggerDeployment: boolean
  bindingStatus: string
  tokenDisplay: string
  canAdminDeleteMultica: boolean
  multicaVersion: string
  upgradeStatus: string
  upgradeTargetVersion: string | null
  upgradeError: string | null
  createdAt: string
  updatedAt: string
  paidAt: string | null
  checkoutPath: string
  consolePath: string
  deployment: DeploymentRecord | null
  deployments: DeploymentRecord[]
  instance: AgentInstanceRecord | null
}

export type ConsoleData = {
  orders: OrderRecord[]
  claws: AgentInstanceRecord[]
}

export type BillingCycle = 'annual' | 'monthly'

export type RouteView =
  | 'home'
  | 'plans'
  | 'console'
  | 'compare'
  | 'solution'
  | 'resource'
  | 'privacy'
  | 'terms'
  | 'notFound'

export type LaunchDraft = {
  modelId: string
  channelId: string
  communicationToken: string
}

export type LaunchResponse = {
  message: string
  order: OrderRecord
}

export type CheckoutSessionResponse = {
  message: string
  order: OrderRecord
  checkoutUrl: string | null
  paymentProvider?: 'creem' | 'paypal'
  creemCheckoutId?: string | null
  paypalOrderId: string | null
  paypalClientId: string | null
}

export type StatelessCheckoutResponse = {
  message: string
  orderId: string
  orderNumber: string
  planId: string
  modelId: string
  channelId: string
  amountCents: number
  amountLabel: string
  currency: string
  checkoutUrl: string
  paymentProvider: 'creem' | 'paypal'
  creemCheckoutId: string | null
  paypalOrderId: string | null
  paypalClientId: string | null
  stateless: boolean
  order?: OrderRecord
}

export type MulticaVersionOption = {
  id: string
  name: string
}

export type MulticaVersionsResponse = {
  versions: MulticaVersionOption[]
  currentVersion: string
  configuredVersion: string
}

export type RuntimeResponse = {
  deploymentMode: 'automatic' | 'manual'
  environment: 'development' | 'production'
  isDevelopment: boolean
  publicAppOrigin: string
}

export type PayPalCheckoutSession = {
  orderId: string
  paypalOrderId: string
  paypalClientId: string
  currency: string
}

export type GuideChannel = 'telegram' | 'discord' | 'whatsapp'

export type GuideQuickAction = {
  title: string
  subtitle: string
}

export type GuideBubble = {
  text: ReactNode
  time: string
  tone: 'incoming' | 'outgoing'
}

export type GuideContent = {
  title: string
  steps: ReactNode[]
  tokenLabel: string
  tokenPlaceholder: string
  phone: {
    avatar: string
    name: string
    subtitle: string
    lead: GuideBubble
    quickActions: GuideQuickAction[]
    outgoing: GuideBubble
    reply: GuideBubble
    composer: string
  }
}

export type UserRole = 'admin' | 'operator'

export type UserStatus = 'active' | 'disabled'

export type AuthMode = 'login' | 'register'

export type UserRecord = {
  id: string
  email: string
  name: string
  role: UserRole
  status: UserStatus
  createdAt: string
  updatedAt: string
  lastLoginAt: string | null
}

export type UserDraft = {
  name: string
  role: UserRole
  status: UserStatus
}

export type AnalyticsSummary = {
  windowDays: number
  totals: {
    visitors: number
    sessions: number
    pageViews: number
    sectionViews: number
    clicks: number
    launchClicks: number
    checkoutStarts: number
    paymentCompletions: number
  }
  funnel: {
    key: string
    label: string
    sessions: number
  }[]
  dropOffs: {
    key: string
    label: string
    sessions: number
  }[]
  topCtas: {
    key: string
    section: string
    clicks: number
    sessions: number
  }[]
  referrers: {
    host: string
    sessions: number
  }[]
}

export type AnalyticsSessionRecord = {
  id: string
  visitorId: string
  userId: string | null
  landingPath: string
  referrerHost: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  deviceType: string
  browserLanguage: string | null
  eventCount: number
  clickCount: number
  sectionViewCount: number
  pageViewCount: number
  lastEventName: string | null
  lastRoutePath: string | null
  lastStage: string
  startedAt: string
  lastSeenAt: string
  createdAt: string
  updatedAt: string
}

export type AnalyticsEventRecord = {
  id: string
  visitorId: string
  sessionId: string
  userId: string | null
  orderId: string | null
  eventType: string
  eventName: string
  routePath: string
  pageKey: string | null
  sectionKey: string | null
  elementKey: string | null
  referrerHost: string | null
  metadata: Record<string, unknown>
  occurredAt: string
  createdAt: string
}

export type AnalyticsSessionDetail = {
  session: AnalyticsSessionRecord
  events: AnalyticsEventRecord[]
}

export type AuthFormState = {
  name: string
  email: string
  password: string
}

export type CreateUserFormState = {
  name: string
  email: string
  password: string
  role: UserRole
}

export type SolutionPage = {
  href: string
  label: string
  eyebrow: string
  title: string
  summary: string
  definition: string
  facts: string[]
  bestFor: string[]
  notFor: string[]
  outcomes: string[]
  workflow: string[]
  conclusion: string
  faqs: FaqItem[]
}

export type FaqItem = {
  question: string
  answer: ReactNode
}

export type ComparisonRow = {
  label: string
  launch: string
  alternative: string
}

export type ComparisonPage = {
  href: string
  label: string
  eyebrow: string
  title: string
  summary: string
  alternativeName: string
  chooseLaunch: string[]
  chooseAlternative: string[]
  rows: ComparisonRow[]
  faqs: FaqItem[]
}

export type ResourceSection = {
  title: string
  body: string
  bullets?: string[]
}

export type ResourceAction = {
  label: string
  href: string
  external?: boolean
}

export type ResourcePage = {
  href: string
  label: string
  eyebrow: string
  title: string
  summary: string
  definition: string
  keywords?: string[]
  primaryAction?: ResourceAction
  showOnHome?: boolean
  sections: ResourceSection[]
  checklist: string[]
  conclusion: string
  faqs: FaqItem[]
}

export type LegalSection = {
  title: string
  paragraphs: string[]
  bullets?: string[]
}
