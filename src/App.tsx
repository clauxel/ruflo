import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowUpRight, Check, CheckCircle2, CreditCard, LoaderCircle, Menu, Rocket, ServerCog, UserRound, X } from 'lucide-react'

import type {
  AnalyticsSessionDetail,
  AnalyticsSessionRecord,
  AnalyticsSummary,
  AuthMode,
  BillingCycle,
  CheckoutSessionResponse,
  ConsoleData,
  CreateUserFormState,
  GuideChannel,
  LaunchDraft,
  MulticaVersionOption,
  MulticaVersionsResponse,
  OrderRecord,
  PayPalCheckoutSession,
  RuntimeResponse,
  StatelessCheckoutResponse,
  UserDraft,
  UserRecord,
  UserRole,
  UserStatus,
} from './app-types'
import {
  apiRequest,
  getErrorMessage,
  loadPayPalSdk,
  openHostedCheckout,
  openPendingHostedCheckout,
} from './lib/api'
import { flushAnalyticsEvents, initializeAnalytics, syncAnalyticsPage, trackAnalyticsEvent } from './lib/analytics'
import {
  formatCurrency,
  formatDateTime,
  formatLifecycleStatus,
  formatMulticaVersion,
  formatRole,
  formatStatus,
  getCustomerVisibleAgentStatus,
  getPlanPricing,
  getUpgradeBadgeLabel,
} from './lib/format'
import { deriveRouteView, launchDraftStorageKey, normalizePathname, scrollToHashTarget } from './lib/routing'
import { buildSeoDocument, syncSeoDocument } from './lib/seo'
import {
  buildConsoleMetrics,
  buildMulticaManagementRows,
  buildOrdersReadyForDeployment,
  buildPendingPaymentOrders,
  canMulticaManagementConsole,
  getRedeployManagementState,
} from '../shared/console-visibility'
import {
  channels,
  channelBadges,
  comparisonPages,
  faqs,
  features,
  guideContent,
  initialAuthForm,
  initialCreateUserForm,
  initialGuideInputs,
  models,
  navItems,
  plans,
  privacySections,
  resourcePages,
  solutionPages,
  supportEmailHref,
  supportEmailLabel,
  supportLinkHref,
  supportLinkLabel,
  termsSections,
} from './content/site-content'
import { DiscordLogo, MulticaLaunchLogo, TelegramLogo, WhatsAppLogo } from './components/logos'

function isDeploymentQueued(status: string | null | undefined) {
  return status === 'queued'
}

function isDeploymentRunning(status: string | null | undefined) {
  return status === 'provisioning'
}

function isDeploymentPending(status: string | null | undefined) {
  return isDeploymentQueued(status) || isDeploymentRunning(status)
}

const defaultChannelId = 'telegram'
const defaultModelId = 'gpt-5-5'
type PaymentMethod = 'credit-card' | 'usdc'

function formatDeploymentMessage(message: string | null | undefined, status: string | null | undefined) {
  if (status === 'queued') {
    return 'Payment confirmed. Your Ruflo workspace is in the provisioning queue and will appear in the console as soon as it is ready.'
  }

  const normalized = String(message ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^Deployment failed:\s*/i, '')
    .trim()

  if (!normalized) {
    return status === 'failed' ? 'Provisioning failed. Please try launching again.' : 'Provisioning is in progress.'
  }

  if (/killed/i.test(normalized) || /out of memory/i.test(normalized)) {
    return 'Deployment stopped because the server ran out of available memory.'
  }

  if (/unable to authenticate data|unsupported state/i.test(normalized)) {
    return 'Provisioning failed because the saved frontend token could not be validated.'
  }

  if (/cloning into/i.test(normalized) && /npm install/i.test(normalized)) {
    return 'Provisioning failed while installing Ruflo dependencies on the server.'
  }

  if (status === 'failed') {
    return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized
  }

  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized
}

function formatAnalyticsStageLabel(stage: string | null | undefined) {
  const normalized = String(stage ?? '').trim()
  if (!normalized) {
    return 'Unknown'
  }

  return normalized
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function buildAnalyticsKey(prefix: string, value: string | null | undefined) {
  const normalized = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalized ? `${prefix}_${normalized}` : prefix
}

function App() {
  const [currentPathname, setCurrentPathname] = useState(() => window.location.pathname)
  const [currentSearch, setCurrentSearch] = useState(() => window.location.search)
  const [currentHash, setCurrentHash] = useState(() => window.location.hash)
  const [appEnvironment, setAppEnvironment] = useState<'development' | 'production'>('production')
  const [deploymentMode, setDeploymentMode] = useState<'automatic' | 'manual'>('automatic')
  const [publicAppOrigin, setPublicAppOrigin] = useState(() => window.location.origin)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [headerCompact, setHeaderCompact] = useState(() => window.scrollY > 18)
  const [activeNavHref, setActiveNavHref] = useState('')
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('annual')
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>('credit-card')
  const [selectedPlanId, setSelectedPlanId] = useState('growth')
  const [selectedModelId, setSelectedModelId] = useState(defaultModelId)
  const [selectedChannelId, setSelectedChannelId] = useState(defaultChannelId)
  const [communicationCode, setCommunicationCode] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [consoleFlashMessage, setConsoleFlashMessage] = useState('')
  const [activeGuide, setActiveGuide] = useState<GuideChannel | null>(null)
  const [guideInputs, setGuideInputs] = useState(initialGuideInputs)
  const [currentUser, setCurrentUser] = useState<UserRecord | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode | null>(null)
  const [authError, setAuthError] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [authForm, setAuthForm] = useState(initialAuthForm)
  const [managedUsers, setManagedUsers] = useState<UserRecord[]>([])
  const [userDrafts, setUserDrafts] = useState<Record<string, UserDraft>>({})
  const [adminError, setAdminError] = useState('')
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminSavingUserId, setAdminSavingUserId] = useState<string | null>(null)
  const [createUserForm, setCreateUserForm] = useState(initialCreateUserForm)
  const [createUserSubmitting, setCreateUserSubmitting] = useState(false)
  const [launchSubmitting, setLaunchSubmitting] = useState(false)
  const [consoleData, setConsoleData] = useState<ConsoleData>({ orders: [], claws: [] })
  const [consoleLoadedOnce, setConsoleLoadedOnce] = useState(false)
  const [consoleError, setConsoleError] = useState('')
  const [checkoutOrder, setCheckoutOrder] = useState<OrderRecord | null>(null)
  const [payPalSession, setPayPalSession] = useState<PayPalCheckoutSession | null>(null)
  const [payPalError, setPayPalError] = useState('')
  const [payPalButtonsReady, setPayPalButtonsReady] = useState(false)
  const [paymentSubmittingOrderId, setPaymentSubmittingOrderId] = useState<string | null>(null)
  const [checkoutBackdropOpen, setCheckoutBackdropOpen] = useState(false)
  const [bindingOrderId, setBindingOrderId] = useState<string | null>(null)
  const [deploymentTriggeringKey, setDeploymentTriggeringKey] = useState<string | null>(null)
  const [openingConsoleKey, setOpeningConsoleKey] = useState<string | null>(null)
  const [stoppingMulticaOrderId, setStoppingMulticaOrderId] = useState<string | null>(null)
  const [adminDeletingMulticaOrderId, setAdminDeletingMulticaOrderId] = useState<string | null>(null)
  const [deletingPendingOrderId, setDeletingPendingOrderId] = useState<string | null>(null)
  const [consoleAutoRefreshUntil, setConsoleAutoRefreshUntil] = useState(0)
  const [upgradeDialogOrder, setUpgradeDialogOrder] = useState<OrderRecord | null>(null)
  const [upgradeVersions, setUpgradeVersions] = useState<MulticaVersionOption[]>([])
  const [upgradeVersionsLoading, setUpgradeVersionsLoading] = useState(false)
  const [upgradeVersionsError, setUpgradeVersionsError] = useState('')
  const [selectedUpgradeVersion, setSelectedUpgradeVersion] = useState('')
  const [upgradeSubmittingOrderId, setUpgradeSubmittingOrderId] = useState<string | null>(null)
  const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummary | null>(null)
  const [analyticsSessions, setAnalyticsSessions] = useState<AnalyticsSessionRecord[]>([])
  const [analyticsDetail, setAnalyticsDetail] = useState<AnalyticsSessionDetail | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsDetailLoading, setAnalyticsDetailLoading] = useState(false)
  const [analyticsError, setAnalyticsError] = useState('')
  const payPalButtonsRef = useRef<HTMLDivElement | null>(null)
  const payPalButtonsInstanceRef = useRef<{ close?: () => Promise<void> | void } | null>(null)
  const checkoutPopupPollRef = useRef<number | null>(null)

  const signedIn = currentUser !== null
  const canManageUsers = currentUser?.role === 'admin'
  const routeView = useMemo(() => deriveRouteView(currentPathname), [currentPathname])
  const normalizedPathname = useMemo(() => normalizePathname(currentPathname), [currentPathname])
  const checkoutSearchParams = useMemo(() => new URLSearchParams(currentSearch), [currentSearch])
  const redirectAfterLogin = useMemo(() => {
    const rawRedirect = checkoutSearchParams.get('redirect') ?? ''
    if (!rawRedirect.startsWith('/')) {
      return ''
    }

    return rawRedirect
  }, [checkoutSearchParams])
  const selectedOrderId = useMemo(() => checkoutSearchParams.get('order'), [checkoutSearchParams])
  const hasCreemRedirectParams = useMemo(
    () => Boolean(checkoutSearchParams.get('checkout_id')),
    [checkoutSearchParams],
  )
  const payPalRedirectOrderId = useMemo(() => checkoutSearchParams.get('token'), [checkoutSearchParams])
  const payPalRedirectPayerId = useMemo(
    () => checkoutSearchParams.get('PayerID') ?? checkoutSearchParams.get('payerId'),
    [checkoutSearchParams],
  )
  const hasPayPalRedirectParams = useMemo(
    () => Boolean(payPalRedirectOrderId && payPalRedirectPayerId),
    [payPalRedirectOrderId, payPalRedirectPayerId],
  )
  const hasHostedCheckoutRedirect = hasCreemRedirectParams || hasPayPalRedirectParams

  const selectedModel = useMemo(
    () => models.find((item) => item.id === selectedModelId) ?? models.find((item) => item.id === defaultModelId) ?? models[0],
    [selectedModelId],
  )
  const featuredModels = models.slice(0, 3)
  const additionalModels = models.slice(3)

  const selectedPlan = useMemo(
    () => plans.find((item) => item.id === selectedPlanId) ?? plans[1],
    [selectedPlanId],
  )

  const defaultChannel = useMemo(
    () => channels.find((item) => item.id === defaultChannelId) ?? channels[0] ?? null,
    [],
  )

  const selectedChannel = useMemo(
    () => channels.find((item) => item.id === selectedChannelId) ?? defaultChannel,
    [defaultChannel, selectedChannelId],
  )

  const isAdminLaunchPriceOverride = appEnvironment === 'production' && currentUser?.role === 'admin'

  const selectedPlanPricing = useMemo(() => {
    const pricing = getPlanPricing(selectedPlan, billingCycle, selectedModel)
    const overrideAmountCents = isAdminLaunchPriceOverride ? 100 : pricing.amountCents

    return {
      ...pricing,
      amountCents: overrideAmountCents,
      totalLabel: formatCurrency(overrideAmountCents, selectedPlan.currency),
    }
  }, [billingCycle, isAdminLaunchPriceOverride, selectedModel, selectedPlan])

  const selectedPaymentProvider = selectedPaymentMethod === 'usdc' ? 'nowpayments' : 'creem'
  const launchButtonLabel = launchSubmitting
    ? selectedPaymentMethod === 'usdc'
      ? 'Preparing wallet...'
      : 'Preparing checkout...'
    : 'Checkout and launch workspace'

  const activeSolutionPage = useMemo(
    () => solutionPages.find((page) => page.href === normalizedPathname) ?? null,
    [normalizedPathname],
  )

  const activeComparisonPage = useMemo(
    () => comparisonPages.find((page) => page.href === normalizedPathname) ?? null,
    [normalizedPathname],
  )

  const activeResourcePage = useMemo(
    () => resourcePages.find((page) => page.href === normalizedPathname) ?? null,
    [normalizedPathname],
  )

  const multicaManagementRows = useMemo(
    () => buildMulticaManagementRows(consoleData),
    [consoleData],
  )

  const consoleMetrics = useMemo(
    () => buildConsoleMetrics(consoleData),
    [consoleData],
  )

  const ordersReadyForDeployment = useMemo(
    () => buildOrdersReadyForDeployment(consoleData),
    [consoleData],
  )
  const pendingPaymentOrders = useMemo(
    () => buildPendingPaymentOrders(consoleData),
    [consoleData],
  )
  const showConsoleInitialLoading = !consoleLoadedOnce && !consoleError
  const showPendingOrdersLoading = showConsoleInitialLoading && pendingPaymentOrders.length === 0
  const showMulticaManagementLoading = showConsoleInitialLoading && multicaManagementRows.length === 0

  const currentGuide = activeGuide ? guideContent[activeGuide] : null
  const hasLaunchDraft = selectedModelId.trim().length > 0

  const scheduleConsoleAutoRefresh = () => {
    setConsoleAutoRefreshUntil(Date.now() + 120_000)
  }
  const canSaveGuide = activeGuide ? guideInputs[activeGuide].trim().length > 0 : false

  const resetPayPalCheckout = () => {
    if (payPalButtonsInstanceRef.current?.close) {
      void payPalButtonsInstanceRef.current.close()
    }
    payPalButtonsInstanceRef.current = null
    if (payPalButtonsRef.current) {
      payPalButtonsRef.current.innerHTML = ''
    }
    setPayPalSession(null)
    setPayPalError('')
    setPayPalButtonsReady(false)
  }

  const stopCheckoutBackdropWatcher = () => {
    if (checkoutPopupPollRef.current !== null) {
      window.clearInterval(checkoutPopupPollRef.current)
      checkoutPopupPollRef.current = null
    }
  }

  const closeCheckoutBackdrop = () => {
    stopCheckoutBackdropWatcher()
    setCheckoutBackdropOpen(false)
  }

  const watchCheckoutPopup = (popup: Window | null) => {
    stopCheckoutBackdropWatcher()

    if (!popup || popup.closed) {
      setCheckoutBackdropOpen(false)
      return
    }

    setCheckoutBackdropOpen(true)
    checkoutPopupPollRef.current = window.setInterval(() => {
      if (popup.closed) {
        closeCheckoutBackdrop()
      }
    }, 600)
  }

  useEffect(() => {
    return () => {
      stopCheckoutBackdropWatcher()
    }
  }, [])

  useEffect(() => {
    void apiRequest<RuntimeResponse>('/api/runtime')
      .then((payload) => {
        setAppEnvironment(payload.environment)
        setDeploymentMode(payload.deploymentMode)
        setPublicAppOrigin(payload.publicAppOrigin || window.location.origin)
      })
      .catch(() => {
        setAppEnvironment('production')
        setDeploymentMode('automatic')
        setPublicAppOrigin(window.location.origin)
      })
  }, [])

  useEffect(() => {
    const seo = buildSeoDocument({
      pathname: normalizedPathname,
      routeView,
      publicAppOrigin,
      solutionPage: activeSolutionPage,
      comparisonPage: activeComparisonPage,
      resourcePage: activeResourcePage,
    })

    syncSeoDocument(seo)
  }, [activeComparisonPage, activeResourcePage, activeSolutionPage, normalizedPathname, publicAppOrigin, routeView])

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPathname(window.location.pathname)
      setCurrentSearch(window.location.search)
      setCurrentHash(window.location.hash)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      setHeaderCompact(window.scrollY > 18)
    }

    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (routeView !== 'home') {
      return
    }

    if (!currentHash) {
      return
    }

    window.requestAnimationFrame(() => {
      scrollToHashTarget(currentHash)
    })
  }, [currentHash, routeView])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [currentPathname, currentHash, currentSearch])

  useEffect(() => {
    const sectionHrefs = ['#features', '#solutions', '#compare', '#pricing', '#faq']

    if (routeView === 'console') {
      setActiveNavHref('/console')
      return
    }

    if (routeView === 'compare') {
      setActiveNavHref('#compare')
      return
    }

    if (routeView === 'solution') {
      setActiveNavHref('#solutions')
      return
    }

    if (routeView === 'resource') {
      setActiveNavHref('')
      return
    }

    if (routeView === 'plans') {
      setActiveNavHref('/plans')
      return
    }

    if (routeView !== 'home') {
      setActiveNavHref('')
      return
    }

    const syncActiveNav = () => {
      const anchorLine = window.scrollY + 120
      let matchedHref = ''

      for (const href of sectionHrefs) {
        const element = document.querySelector(href)
        if (element instanceof HTMLElement && element.offsetTop <= anchorLine) {
          matchedHref = href
        }
      }

      if (!matchedHref && sectionHrefs.includes(currentHash)) {
        matchedHref = currentHash
      }

      setActiveNavHref(matchedHref === '#pricing' ? '/plans' : matchedHref)
    }

    syncActiveNav()
    window.addEventListener('scroll', syncActiveNav, { passive: true })
    window.addEventListener('resize', syncActiveNav)
    return () => {
      window.removeEventListener('scroll', syncActiveNav)
      window.removeEventListener('resize', syncActiveNav)
    }
  }, [currentHash, routeView])

  const navigate = (path: string) => {
    window.history.pushState({}, '', path)
    setCurrentPathname(window.location.pathname)
    setCurrentSearch(window.location.search)
    setCurrentHash(window.location.hash)

    if (window.location.hash) {
      window.requestAnimationFrame(() => {
        scrollToHashTarget(window.location.hash)
      })
      return
    }

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const persistLaunchDraft = (draft: LaunchDraft) => {
    window.sessionStorage.setItem(launchDraftStorageKey, JSON.stringify(draft))
  }

  const clearLaunchDraft = () => {
    window.sessionStorage.removeItem(launchDraftStorageKey)
  }

  const restoreLaunchDraft = () => {
    const rawDraft = window.sessionStorage.getItem(launchDraftStorageKey)
    if (!rawDraft) return false

    try {
      const draft = JSON.parse(rawDraft) as LaunchDraft
      const restoredChannelId =
        typeof draft.channelId === 'string' && channels.some((item) => item.id === draft.channelId)
          ? draft.channelId
          : defaultChannelId
      if (draft.modelId) setSelectedModelId(draft.modelId)
      setSelectedChannelId(restoredChannelId)
      setCommunicationCode(draft.communicationToken ?? '')
      return Boolean(draft.modelId)
    } catch {
      return false
    }
  }

  useEffect(() => {
    let cancelled = false

    const loadSession = async () => {
      try {
        const response = await apiRequest<{ user: UserRecord | null }>('/api/auth/me')
        if (!cancelled) {
          setCurrentUser(response.user)
        }
      } catch {
        if (!cancelled) {
          setCurrentUser(null)
        }
      } finally {
        if (!cancelled) {
          setAuthReady(true)
        }
      }
    }

    void loadSession()

    return () => {
      cancelled = true
    }
  }, [])

  const loadManagedUsers = async () => {
    if (!currentUser || currentUser.role !== 'admin') {
      setManagedUsers([])
      setUserDrafts({})
      return
    }

    setAdminLoading(true)
    setAdminError('')

    try {
      const response = await apiRequest<{ users: UserRecord[] }>('/api/admin/users')
      setManagedUsers(response.users)
      setUserDrafts(
        Object.fromEntries(
          response.users.map((user) => [
            user.id,
            {
              name: user.name,
              role: user.role,
              status: user.status,
            },
          ]),
        ),
      )
    } catch (error) {
      setAdminError(getErrorMessage(error))
    } finally {
      setAdminLoading(false)
    }
  }

  useEffect(() => {
    if (!canManageUsers) {
      setManagedUsers([])
      setUserDrafts({})
      setAdminError('')
      return
    }

    void loadManagedUsers()
  }, [canManageUsers])

  const loadAdminAnalytics = async () => {
    if (!currentUser || currentUser.role !== 'admin') {
      setAnalyticsSummary(null)
      setAnalyticsSessions([])
      setAnalyticsDetail(null)
      setAnalyticsError('')
      return
    }

    setAnalyticsLoading(true)
    setAnalyticsError('')

    try {
      const [summaryResponse, sessionsResponse] = await Promise.all([
        apiRequest<{ summary: AnalyticsSummary }>('/api/admin/analytics/summary?days=14'),
        apiRequest<{ sessions: AnalyticsSessionRecord[] }>('/api/admin/analytics/sessions?days=14&limit=20'),
      ])

      setAnalyticsSummary(summaryResponse.summary)
      setAnalyticsSessions(sessionsResponse.sessions)
    } catch (error) {
      setAnalyticsError(getErrorMessage(error))
    } finally {
      setAnalyticsLoading(false)
    }
  }

  const loadAnalyticsSessionDetail = async (sessionId: string) => {
    setAnalyticsDetailLoading(true)
    setAnalyticsError('')

    try {
      const response = await apiRequest<AnalyticsSessionDetail>(`/api/admin/analytics/sessions/${sessionId}`)
      setAnalyticsDetail(response)
    } catch (error) {
      setAnalyticsError(getErrorMessage(error))
    } finally {
      setAnalyticsDetailLoading(false)
    }
  }

  useEffect(() => {
    if (!canManageUsers) {
      setAnalyticsSummary(null)
      setAnalyticsSessions([])
      setAnalyticsDetail(null)
      setAnalyticsError('')
      return
    }

    void loadAdminAnalytics()
  }, [canManageUsers])

  const loadConsoleData = async ({ showLoadingState: _showLoadingState }: { showLoadingState?: boolean } = {}) => {
    try {
      const response = await apiRequest<ConsoleData>('/api/console-data')
      setConsoleData(response)
      setConsoleLoadedOnce(true)
      setConsoleError('')
    } catch (error) {
      setConsoleError(getErrorMessage(error))
    }
  }

  useEffect(() => {
    if (normalizePathname(currentPathname) !== '/checkout') {
      return
    }

    window.history.replaceState({}, '', `/console${currentSearch}`)
    setCurrentPathname(window.location.pathname)
    setCurrentSearch(window.location.search)
    setCurrentHash(window.location.hash)
  }, [currentPathname, currentSearch])

  useEffect(() => {
    initializeAnalytics()
  }, [])

  useEffect(() => {
    syncAnalyticsPage(currentPathname, currentSearch)
  }, [currentPathname, currentSearch])

  useEffect(() => {
    if (!authReady) {
      return
    }

    if (routeView === 'console' && !hasHostedCheckoutRedirect) {
      void loadConsoleData({ showLoadingState: !consoleLoadedOnce })
    }

    if (routeView === 'plans' && !hasLaunchDraft) {
      const restored = restoreLaunchDraft()
      if (!restored) {
        setStatusMessage('Complete your launch details first, then continue to plan selection.')
        navigate('/')
      }
    }

  }, [authReady, hasHostedCheckoutRedirect, hasLaunchDraft, routeView])

  useEffect(() => {
    if (!authReady || signedIn || !redirectAfterLogin || authMode) {
      return
    }

    openAuthModal('login')
  }, [authMode, authReady, redirectAfterLogin, signedIn])

  useEffect(() => {
    if (!consoleFlashMessage) {
      return
    }

    if (routeView !== 'console') {
      setConsoleFlashMessage('')
      return
    }

    const timeoutId = window.setTimeout(() => {
      setConsoleFlashMessage('')
    }, 6000)

    return () => window.clearTimeout(timeoutId)
  }, [consoleFlashMessage, routeView])

  useEffect(() => {
    if (!checkoutOrder || checkoutOrder.paymentStatus === 'paid') {
      resetPayPalCheckout()
      return
    }

    if (payPalSession && payPalSession.orderId !== checkoutOrder.id) {
      resetPayPalCheckout()
    }
  }, [checkoutOrder?.id, checkoutOrder?.paymentStatus])

  useEffect(() => {
    if (routeView !== 'console') return

    const hasActiveOrder = consoleData.orders.some(
      (order) => ['queued', 'provisioning'].includes(order.deploymentStatus) || order.upgradeStatus === 'in_progress',
    )

    if (!hasActiveOrder && consoleAutoRefreshUntil <= Date.now()) return

    const timer = window.setInterval(() => {
      void loadConsoleData({ showLoadingState: false })
    }, 2000)

    return () => window.clearInterval(timer)
  }, [consoleAutoRefreshUntil, consoleData.orders, routeView])

  const handleDeploy = async () => {
    trackAnalyticsEvent({
      eventType: 'business',
      eventName: 'launch_clicked',
      metadata: {
        modelId: selectedModel.id,
        channelId: selectedChannel?.id ?? 'selected_on_plans',
      },
    })
    persistLaunchDraft({
      modelId: selectedModel.id,
      channelId: selectedChannel?.id ?? '',
      communicationToken: communicationCode.trim(),
    })
    navigate('/plans')
  }

  const createCheckoutSession = async (orderId: string, guestToken?: string | null) => {
    return await apiRequest<CheckoutSessionResponse>(`/api/orders/${orderId}/checkout-session`, {
      method: 'POST',
      guestToken: guestToken ?? undefined,
    })
  }

  const createStatelessCheckoutSession = async (
    planId: string,
    endpoint = '/api/launch-checkout',
    cycle: BillingCycle = billingCycle,
  ) => {
    if (!selectedChannel) {
      throw new Error('Choose the first live touchpoint for this workspace before checkout.')
    }

    return await apiRequest<StatelessCheckoutResponse>(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        planId: `${planId}:${cycle}`,
        modelId: selectedModel.id,
        channelId: selectedChannel.id,
        communicationToken: communicationCode,
      }),
    })
  }

  const handlePlanSelect = (planId: string) => {
    trackAnalyticsEvent({
      eventType: 'business',
      eventName: 'plan_selected',
      metadata: {
        planId,
        billingCycle,
      },
    })
    setSelectedPlanId(planId)
  }

  const handlePaymentMethodSelect = (paymentMethod: PaymentMethod) => {
    if (paymentMethod === selectedPaymentMethod) {
      return
    }

    trackAnalyticsEvent({
      eventType: 'business',
      eventName: 'payment_method_selected',
      metadata: {
        paymentMethod,
        planId: selectedPlan.id,
        billingCycle,
      },
    })
    setSelectedPaymentMethod(paymentMethod)
  }

  const startHostedPlanCheckout = async (
    planId: string,
    provider: 'creem' | 'nowpayments' = 'creem',
    cycle: BillingCycle = billingCycle,
  ) => {
    if (!selectedChannel) {
      setStatusMessage('Choose the first live touchpoint for this workspace before checkout.')
      return
    }
    setSelectedPlanId(planId)
    setBillingCycle(cycle)

    const checkoutWindow = openPendingHostedCheckout()
    if (!checkoutWindow) {
      setStatusMessage('Your browser blocked the checkout popup. Please allow popups for Ruflo AI and click Checkout and launch workspace again.')
      return
    }
    watchCheckoutPopup(checkoutWindow)

    setLaunchSubmitting(true)
    setStatusMessage('')

    try {
      resetPayPalCheckout()
      const checkoutResponse = await createStatelessCheckoutSession(
        planId,
        provider === 'nowpayments' ? '/api/nowpayments-checkout' : '/api/launch-checkout',
        cycle,
      )

      if (checkoutResponse.order) {
        trackAnalyticsEvent({
          eventType: 'business',
          eventName: 'launch_order_created',
          orderId: checkoutResponse.order.id,
          metadata: {
            planId: checkoutResponse.order.planId,
            billingCycle: cycle,
          },
        })
        setCheckoutOrder(checkoutResponse.order)
      }

      trackAnalyticsEvent({
        eventType: 'business',
        eventName: 'checkout_started',
        orderId: checkoutResponse.order?.id ?? checkoutResponse.orderId,
        metadata: {
          provider: checkoutResponse.paymentProvider,
          stateless: checkoutResponse.stateless,
          paymentStatus: checkoutResponse.order?.paymentStatus,
          billingCycle: cycle,
        },
      })

      if (checkoutResponse.order?.paymentStatus === 'paid') {
        if (!checkoutWindow.closed) {
          checkoutWindow.close()
        }
        closeCheckoutBackdrop()
        setConsoleFlashMessage(checkoutResponse.message)
        await loadConsoleData()
        navigate(checkoutResponse.order.consolePath)
        return
      }

      clearLaunchDraft()
      continueWithStatelessHostedCheckout(checkoutResponse, checkoutWindow)
    } catch (error) {
      if (!checkoutWindow.closed) {
        checkoutWindow.close()
      }
      closeCheckoutBackdrop()
      trackAnalyticsEvent({
        eventType: 'error',
        eventName: 'checkout_start_failed',
        metadata: {
          message: getErrorMessage(error),
        },
      })
      setStatusMessage(getErrorMessage(error))
    } finally {
      setLaunchSubmitting(false)
    }
  }

  const handlePlanLaunch = async (provider: 'creem' | 'nowpayments' = 'creem') => {
    await startHostedPlanCheckout(selectedPlan.id, provider, billingCycle)
  }

  const handleModelSelect = (modelId: string) => {
    trackAnalyticsEvent({
      eventType: 'business',
      eventName: 'model_selected',
      metadata: {
        modelId,
      },
    })
    setSelectedModelId(modelId)
  }

  const handleGuideInputChange = (value: string) => {
    if (!activeGuide) return
    setGuideInputs((current) => ({ ...current, [activeGuide]: value }))
    setCommunicationCode(value)
  }


  const handleGuideSave = () => {
    if (!activeGuide) return

    const token = guideInputs[activeGuide].trim()
    setSelectedChannelId(activeGuide)

    if (!token) {
      setCommunicationCode('')
      setActiveGuide(null)
      setStatusMessage('Touchpoint saved. You can skip the token for now and bind it later in the console.')
      return
    }

    setCommunicationCode(token)
    trackAnalyticsEvent({
      eventType: 'business',
      eventName: 'guide_token_saved',
      metadata: {
        channelId: activeGuide,
      },
    })
    setStatusMessage('Your frontend token is now ready for launch.')
    setActiveGuide(null)
  }

  const handlePayOrder = async (orderId: string) => {
    setPaymentSubmittingOrderId(orderId)
    setConsoleError('')
    setPayPalError('')

    try {
      trackAnalyticsEvent({
        eventType: 'business',
        eventName: 'payment_resume_clicked',
        orderId,
      })
      const response = await createCheckoutSession(orderId)
      trackAnalyticsEvent({
        eventType: 'business',
        eventName: 'checkout_started',
        orderId: response.order.id,
        metadata: {
          paymentStatus: response.order.paymentStatus,
        },
      })
      setCheckoutOrder(response.order)
      if (response.order.paymentStatus === 'paid') {
        setConsoleFlashMessage(response.message)
        resetPayPalCheckout()
        scheduleConsoleAutoRefresh()
        await loadConsoleData()
        navigate(response.order.consolePath)
        return
      }

      if (continueWithHostedCheckout(response)) {
        return
      }

      if (!response.paypalOrderId || !response.paypalClientId) {
        throw new Error('PayPal checkout is unavailable.')
      }

      setConsoleFlashMessage(response.message)

      if (response.checkoutUrl) {
        setConsoleFlashMessage('Your browser blocked the PayPal window, so checkout is ready inside this page instead.')
      }

      if (!response.paypalOrderId || !response.paypalClientId) {
        throw new Error('Payment checkout is unavailable.')
      }

      setPayPalSession({
        orderId: response.order.id,
        paypalOrderId: response.paypalOrderId,
        paypalClientId: response.paypalClientId,
        currency: response.order.currency,
      })
    } catch (error) {
      trackAnalyticsEvent({
        eventType: 'error',
        eventName: 'checkout_resume_failed',
        orderId,
        metadata: {
          message: getErrorMessage(error),
        },
      })
      setConsoleError(getErrorMessage(error))
    } finally {
      setPaymentSubmittingOrderId(null)
    }
  }

  const handleBindOrderToAccount = async (orderId: string) => {
    setBindingOrderId(orderId)
    setConsoleError('')

    try {
      const response = await apiRequest<{ message: string; order: OrderRecord }>(`/api/orders/${orderId}/bind-account`, {
        method: 'POST',
      })
      setStatusMessage(response.message)
      await loadConsoleData()
      if (checkoutOrder?.id === orderId) {
        setCheckoutOrder(response.order)
      }
    } catch (error) {
      setConsoleError(getErrorMessage(error))
    } finally {
      setBindingOrderId(null)
    }
  }

  const handleTriggerDeployment = async (orderId: string, triggeringKey: string = orderId) => {
    setDeploymentTriggeringKey(triggeringKey)
    setConsoleError('')

    try {
      const response = await apiRequest<{ message: string; order: OrderRecord }>(`/api/orders/${orderId}/deployments`, {
        method: 'POST',
      })
      setStatusMessage(response.message)
      scheduleConsoleAutoRefresh()
      await loadConsoleData()
      if (checkoutOrder?.id === orderId) {
        setCheckoutOrder(response.order)
      }
    } catch (error) {
      setConsoleError(getErrorMessage(error))
    } finally {
      setDeploymentTriggeringKey(null)
    }
  }

  const handleMulticaConsole = async (orderId: string, deploymentId?: string | null, rowKey?: string) => {
    setOpeningConsoleKey(rowKey ?? orderId)
    setConsoleError('')
    const openedWindow = window.open('about:blank', '_blank')

    try {
      const response = await apiRequest<{ url: string }>(`/api/orders/${orderId}/multica-console`, {
        method: 'POST',
        body: JSON.stringify(deploymentId ? { deploymentId } : {}),
      })
      const consoleUrl = new URL(response.url, window.location.origin).toString()
      if (!openedWindow) {
        setConsoleError('Please allow popups to open the Ruflo console in a new tab.')
        return
      }

      openedWindow.opener = null
      openedWindow.location.href = consoleUrl
    } catch (error) {
      if (openedWindow && !openedWindow.closed) {
        openedWindow.close()
      }
      setConsoleError(getErrorMessage(error))
    } finally {
      setOpeningConsoleKey(null)
    }
  }

  const handleStopMultica = async (orderId: string) => {
    setStoppingMulticaOrderId(orderId)
    setConsoleError('')

    try {
      const response = await apiRequest<{ message: string; order: OrderRecord }>(`/api/orders/${orderId}/multica-stop`, {
        method: 'POST',
      })
      setStatusMessage(response.message)
      await loadConsoleData()
      if (checkoutOrder?.id === orderId) {
        setCheckoutOrder(response.order)
      }
    } catch (error) {
      setConsoleError(getErrorMessage(error))
    } finally {
      setStoppingMulticaOrderId(null)
    }
  }

  const handleDeletePendingOrder = async (orderId: string) => {
    setDeletingPendingOrderId(orderId)
    setConsoleError('')

    try {
      const response = await apiRequest<{ message: string }>(`/api/orders/${orderId}/delete`, {
        method: 'POST',
      })
      setStatusMessage(response.message)
      await loadConsoleData()
      if (checkoutOrder?.id === orderId) {
        setCheckoutOrder(null)
        resetPayPalCheckout()
      }
    } catch (error) {
      setConsoleError(getErrorMessage(error))
    } finally {
      setDeletingPendingOrderId(null)
    }
  }

  const handleAdminDeleteMultica = async (orderId: string) => {
    if (!window.confirm('Delete this Ruflo workspace? This action cannot be undone.')) {
      return
    }

    setAdminDeletingMulticaOrderId(orderId)
    setConsoleError('')

    try {
      const response = await apiRequest<{ message: string; order: OrderRecord }>(
        `/api/admin/orders/${orderId}/multica-delete`,
        {
          method: 'POST',
        },
      )
      setStatusMessage(response.message)
      await loadConsoleData()
      if (checkoutOrder?.id === orderId) {
        setCheckoutOrder(response.order)
      }
      if (upgradeDialogOrder?.id === orderId) {
        closeUpgradeDialog()
      }
    } catch (error) {
      setConsoleError(getErrorMessage(error))
    } finally {
      setAdminDeletingMulticaOrderId(null)
    }
  }

  const closeUpgradeDialog = () => {
    setUpgradeDialogOrder(null)
    setUpgradeVersions([])
    setUpgradeVersionsLoading(false)
    setUpgradeVersionsError('')
    setSelectedUpgradeVersion('')
  }

  const closePlanPayPalDialog = () => {
    resetPayPalCheckout()
  }

  const continueWithHostedCheckout = (checkoutResponse: CheckoutSessionResponse) => {
    if (!checkoutResponse.checkoutUrl) {
      return false
    }

    const checkoutWindow = openHostedCheckout(checkoutResponse.checkoutUrl)
    if (checkoutWindow) {
      watchCheckoutPopup(checkoutWindow)
      trackAnalyticsEvent({
        eventType: 'business',
        eventName: 'checkout_redirected',
        orderId: checkoutResponse.order.id,
        metadata: {
          provider: checkoutResponse.paymentProvider ?? 'hosted',
          mode: 'popup',
        },
      })
      setConsoleFlashMessage('Checkout opened in a new window. Complete payment there while this page stays on your site.')
      scheduleConsoleAutoRefresh()
      navigate(checkoutResponse.order.consolePath)
      return true
    }

    trackAnalyticsEvent({
      eventType: 'business',
      eventName: 'checkout_redirected',
      orderId: checkoutResponse.order.id,
      metadata: {
        provider: checkoutResponse.paymentProvider ?? 'hosted',
        mode: 'current_tab',
      },
    })
    window.location.assign(checkoutResponse.checkoutUrl)
    return true
  }

  const continueWithStatelessHostedCheckout = (
    checkoutResponse: StatelessCheckoutResponse,
    checkoutWindow: Window | null,
  ) => {
    if (!checkoutWindow || checkoutWindow.closed) {
      closeCheckoutBackdrop()
      trackAnalyticsEvent({
        eventType: 'error',
        eventName: 'checkout_popup_blocked',
        orderId: checkoutResponse.orderId,
        metadata: {
          provider: checkoutResponse.paymentProvider,
          stateless: checkoutResponse.stateless,
        },
      })
      setStatusMessage('The checkout window was closed before payment opened. Click Checkout and launch workspace again to continue.')
      return
    }

    trackAnalyticsEvent({
      eventType: 'business',
      eventName: 'checkout_redirected',
      orderId: checkoutResponse.orderId,
      metadata: {
        provider: checkoutResponse.paymentProvider,
        mode: 'popup',
        stateless: checkoutResponse.stateless,
      },
    })

    checkoutWindow.location.href = checkoutResponse.checkoutUrl
    checkoutWindow.focus()
    watchCheckoutPopup(checkoutWindow)
    setStatusMessage('Checkout opened in a separate payment window. Complete payment there when you are ready.')
  }

  const handleOpenUpgradeDialog = async (order: OrderRecord) => {
    setUpgradeDialogOrder(order)
    setUpgradeVersions([])
    setUpgradeVersionsError('')
    setSelectedUpgradeVersion(order.multicaVersion)
    setUpgradeVersionsLoading(true)

    try {
      const response = await apiRequest<MulticaVersionsResponse>(`/api/orders/${order.id}/multica-versions`)
      setUpgradeVersions(response.versions)
      setSelectedUpgradeVersion(response.currentVersion || response.versions[0]?.name || '')
    } catch (error) {
      setUpgradeVersionsError(getErrorMessage(error))
    } finally {
      setUpgradeVersionsLoading(false)
    }
  }

  const handleConfirmUpgrade = async () => {
    if (!upgradeDialogOrder || !selectedUpgradeVersion) {
      return
    }

    setUpgradeSubmittingOrderId(upgradeDialogOrder.id)
    setUpgradeVersionsError('')
    setConsoleError('')

    try {
      const response = await apiRequest<{ message: string; order: OrderRecord }>(
        `/api/orders/${upgradeDialogOrder.id}/multica-upgrade`,
        {
          method: 'POST',
          body: JSON.stringify({
            version: selectedUpgradeVersion,
          }),
        },
      )
      setStatusMessage(response.message)
      await loadConsoleData()
      if (checkoutOrder?.id === upgradeDialogOrder.id) {
        setCheckoutOrder(response.order)
      }
      closeUpgradeDialog()
    } catch (error) {
      setUpgradeVersionsError(getErrorMessage(error))
    } finally {
      setUpgradeSubmittingOrderId(null)
    }
  }

  useEffect(() => {
    if (!authReady || routeView !== 'console' || !selectedOrderId || !hasCreemRedirectParams) return

    const confirmCreemRedirect = async () => {
      setPaymentSubmittingOrderId(selectedOrderId)
      setConsoleError('')

      try {
        const response = await apiRequest<{ message: string; order: OrderRecord }>(
          `/api/orders/${selectedOrderId}/creem-confirm`,
          {
            method: 'POST',
            body: JSON.stringify({
              redirectParams: Object.fromEntries(checkoutSearchParams.entries()),
            }),
          },
        )

        trackAnalyticsEvent({
          eventType: 'business',
          eventName: 'payment_completed',
          orderId: response.order.id,
          metadata: {
            provider: 'creem',
            flow: 'redirect',
          },
        })
        await flushAnalyticsEvents()
        setCheckoutOrder(response.order)
        setConsoleFlashMessage(response.message)
        scheduleConsoleAutoRefresh()
        await loadConsoleData()
        navigate(response.order.consolePath)
      } catch (error) {
        setConsoleError(getErrorMessage(error))
      } finally {
        setPaymentSubmittingOrderId(null)
      }
    }

    void confirmCreemRedirect()
  }, [authReady, checkoutSearchParams, hasCreemRedirectParams, routeView, selectedOrderId])

  useEffect(() => {
    if (!authReady || routeView !== 'console' || !selectedOrderId || !hasPayPalRedirectParams || !payPalRedirectOrderId) return

    const confirmPayPalRedirect = async () => {
      setPaymentSubmittingOrderId(selectedOrderId)
      setConsoleError('')

      try {
        const response = await apiRequest<{ message: string; order: OrderRecord }>(
          `/api/orders/${selectedOrderId}/paypal-capture`,
          {
            method: 'POST',
            body: JSON.stringify({
              paypalOrderId: payPalRedirectOrderId,
            }),
          },
        )

        trackAnalyticsEvent({
          eventType: 'business',
          eventName: 'payment_completed',
          orderId: response.order.id,
          metadata: {
            provider: 'paypal',
            flow: 'redirect',
          },
        })
        resetPayPalCheckout()
        setCheckoutOrder(response.order)
        setConsoleFlashMessage(response.message)
        scheduleConsoleAutoRefresh()
        await loadConsoleData()
        navigate(response.order.consolePath)
      } catch (error) {
        trackAnalyticsEvent({
          eventType: 'error',
          eventName: 'payment_capture_failed',
          orderId: selectedOrderId,
          metadata: {
            provider: 'paypal',
            flow: 'redirect',
            message: getErrorMessage(error),
          },
        })
        setConsoleError(getErrorMessage(error))
      } finally {
        setPaymentSubmittingOrderId(null)
      }
    }

    void confirmPayPalRedirect()
  }, [authReady, hasPayPalRedirectParams, navigate, payPalRedirectOrderId, routeView, selectedOrderId])

  useEffect(() => {
    if (
      (routeView !== 'plans' && routeView !== 'console') ||
      !checkoutOrder ||
      checkoutOrder.paymentStatus !== 'pending' ||
      !payPalSession ||
      payPalSession.orderId !== checkoutOrder.id ||
      !payPalButtonsRef.current
    ) {
      return
    }

    let cancelled = false
    setPayPalError('')
    setPayPalButtonsReady(false)

    const renderButtons = async () => {
      const paypal = await loadPayPalSdk(payPalSession.paypalClientId, payPalSession.currency)
      if (cancelled || !payPalButtonsRef.current) {
        return
      }

      payPalButtonsRef.current.innerHTML = ''
      const buttons = paypal.Buttons({
        style: {
          layout: 'vertical',
          shape: 'rect',
          label: 'paypal',
        },
        createOrder: async () => payPalSession.paypalOrderId,
        onApprove: async (data: { orderID?: string }) => {
          const response = await apiRequest<{ message: string; order: OrderRecord }>(
            `/api/orders/${checkoutOrder.id}/paypal-capture`,
            {
              method: 'POST',
              body: JSON.stringify({
                paypalOrderId: data.orderID ?? payPalSession.paypalOrderId,
              }),
            },
          )

          trackAnalyticsEvent({
            eventType: 'business',
            eventName: 'payment_completed',
            orderId: response.order.id,
            metadata: {
              provider: 'paypal',
              flow: 'sdk',
            },
          })
          resetPayPalCheckout()
          setCheckoutOrder(response.order)
          setStatusMessage(response.message)
          await loadConsoleData()
          navigate(response.order.consolePath)
        },
        onCancel: () => {
          trackAnalyticsEvent({
            eventType: 'business',
            eventName: 'checkout_canceled',
            orderId: checkoutOrder.id,
            metadata: {
              provider: 'paypal',
            },
          })
          setPayPalError('PayPal payment was canceled before completion.')
        },
        onError: (error: unknown) => {
          trackAnalyticsEvent({
            eventType: 'error',
            eventName: 'payment_capture_failed',
            orderId: checkoutOrder.id,
            metadata: {
              provider: 'paypal',
              flow: 'sdk',
              message: getErrorMessage(error),
            },
          })
          setPayPalError(getErrorMessage(error))
        },
      })

      if (buttons.isEligible && !buttons.isEligible()) {
        throw new Error('PayPal checkout is not available for this browser.')
      }

      payPalButtonsInstanceRef.current = buttons
      await buttons.render(payPalButtonsRef.current)

      if (!cancelled) {
        setPayPalButtonsReady(true)
      }
    }

    void renderButtons().catch((error) => {
      if (!cancelled) {
        setPayPalError(getErrorMessage(error))
        setPayPalButtonsReady(false)
      }
    })

    return () => {
      cancelled = true
      if (payPalButtonsInstanceRef.current?.close) {
        void payPalButtonsInstanceRef.current.close()
      }
      payPalButtonsInstanceRef.current = null
      if (payPalButtonsRef.current) {
        payPalButtonsRef.current.innerHTML = ''
      }
    }
  }, [checkoutOrder, payPalSession, routeView])

  const openAuthModal = (mode: AuthMode) => {
    trackAnalyticsEvent({
      eventType: 'business',
      eventName: 'auth_modal_opened',
      metadata: {
        mode,
      },
    })
    setAuthMode(mode)
    setAuthError('')
    setAuthForm(initialAuthForm)
  }

  const closeAuthModal = () => {
    setAuthMode(null)
    setAuthError('')
    setAuthForm(initialAuthForm)
  }

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!authMode) return

    setAuthSubmitting(true)
    setAuthError('')

    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login'
      const body =
        authMode === 'register'
          ? {
              name: authForm.name,
              email: authForm.email,
              password: authForm.password,
            }
          : {
              email: authForm.email,
              password: authForm.password,
            }

      const response = await apiRequest<{ message: string; user: UserRecord }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      })

      trackAnalyticsEvent({
        eventType: 'business',
        eventName: authMode === 'register' ? 'auth_registered' : 'auth_logged_in',
      })
      setCurrentUser(response.user)
      setStatusMessage(response.message)
      if (redirectAfterLogin) {
        window.location.assign(redirectAfterLogin)
        return
      }
      closeAuthModal()
    } catch (error) {
      trackAnalyticsEvent({
        eventType: 'error',
        eventName: authMode === 'register' ? 'auth_register_failed' : 'auth_login_failed',
        metadata: {
          message: getErrorMessage(error),
        },
      })
      setAuthError(getErrorMessage(error))
    } finally {
      setAuthSubmitting(false)
    }
  }

  const handleSignOut = async () => {
    try {
      const response = await apiRequest<{ message: string }>('/api/auth/logout', {
        method: 'POST',
      })
      setCurrentUser(null)
      setManagedUsers([])
      setUserDrafts({})
      setStatusMessage(response.message)
    } catch (error) {
      setStatusMessage(getErrorMessage(error))
    }
  }

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setCreateUserSubmitting(true)
    setAdminError('')

    try {
      const response = await apiRequest<{ message: string }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(createUserForm),
      })
      setCreateUserForm(initialCreateUserForm)
      setStatusMessage(response.message)
      await loadManagedUsers()
    } catch (error) {
      setAdminError(getErrorMessage(error))
    } finally {
      setCreateUserSubmitting(false)
    }
  }

  const handleUserSave = async (userId: string) => {
    const draft = userDrafts[userId]
    if (!draft) return

    setAdminSavingUserId(userId)
    setAdminError('')

    try {
      const response = await apiRequest<{ message: string; user: UserRecord }>(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(draft),
      })

      setManagedUsers((current) =>
        current.map((user) => (user.id === response.user.id ? response.user : user)),
      )
      setUserDrafts((current) => ({
        ...current,
        [userId]: {
          name: response.user.name,
          role: response.user.role,
          status: response.user.status,
        },
      }))
      if (currentUser?.id === response.user.id) {
        setCurrentUser(response.user)
      }
      setStatusMessage(response.message)
    } catch (error) {
      setAdminError(getErrorMessage(error))
    } finally {
      setAdminSavingUserId(null)
    }
  }


  return (

    <div className="app-shell" id="top">
      <div className="background-grid" />
      <div className="background-glow glow-left" />
      <div className="background-glow glow-right" />

      <header className={`site-header ${headerCompact ? 'site-header-compact' : ''}`}>
        <div className="header-inner">
          <a
            className="brand"
            href="/"
            data-analytics-click="nav_brand_home"
            onClick={(event) => {
              event.preventDefault()
              navigate('/')
            }}
          >
            <span className="brand-mark" aria-hidden="true">
              <MulticaLaunchLogo />
            </span>
            <span className="brand-text">
              <span className="brand-name">Ruflo AI</span>
              <span className="brand-sub">Hosted swarms for Codex and Claude Code</span>
            </span>
            {appEnvironment === 'development' ? <span className="brand-environment-badge">DEV MODE</span> : null}
          </a>

          <button
            type="button"
            className="header-menu-toggle"
            aria-expanded={mobileNavOpen}
            aria-controls="site-navigation"
            data-analytics-click="nav_mobile_menu_toggle"
            onClick={() => setMobileNavOpen((value) => !value)}
          >
            {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
            <span>{mobileNavOpen ? 'Close' : 'Menu'}</span>
          </button>

          <nav
            id="site-navigation"
            className={`nav-links ${mobileNavOpen ? 'nav-links-open' : ''}`}
            aria-label="Primary"
          >
            {navItems.map((item) => {
              const Icon = item.icon
              const active = item.href === activeNavHref
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={active ? 'nav-link-active' : ''}
                  data-analytics-click={buildAnalyticsKey('nav', item.href)}
                  onClick={(event) => {
                    if (item.href.startsWith('#')) {
                      event.preventDefault()
                      navigate(routeView === 'home' ? item.href : `/${item.href}`)
                      return
                    }

                    if (item.href.startsWith('/')) {
                      event.preventDefault()
                      navigate(item.href)
                      return
                    }

                    if (routeView !== 'home') {
                      event.preventDefault()
                      navigate(`/${item.href}`)
                    }
                  }}
                >
                  <Icon size={14} />
                  <span>{item.label}</span>
                </a>
              )
            })}
          </nav>

          <div className={`header-actions ${mobileNavOpen ? 'header-actions-open' : ''}`}>
            {!authReady ? (
              <div className="header-user-text">Checking session...</div>
            ) : signedIn && currentUser ? (
              <>
                <div className="header-user-text">{currentUser.email}</div>
                {canManageUsers ? (
                  <a
                    className="header-auth-text"
                    href="/console"
                    data-analytics-click="header_manage_users"
                    onClick={(event) => {
                      event.preventDefault()
                      navigate('/console')
                    }}
                  >
                    Manage users
                  </a>
                ) : null}
                <a
                  className="header-auth-text"
                  href="/"
                  data-analytics-click="header_sign_out"
                  onClick={(event) => {
                    event.preventDefault()
                    void handleSignOut()
                  }}
                >
                  Sign out
                </a>
              </>
            ) : (
              <>
                <a
                  className="header-auth-text"
                  href="/console"
                  data-analytics-click="header_login"
                  data-analytics-cta="true"
                  onClick={(event) => {
                    event.preventDefault()
                    openAuthModal('login')
                  }}
                >
                  Log in
                </a>
                <a
                  className="header-auth-text"
                  href="/console"
                  data-analytics-click="header_create_account"
                  data-analytics-cta="true"
                  onClick={(event) => {
                    event.preventDefault()
                    openAuthModal('register')
                  }}
                >
                  Create account
                </a>
              </>
            )}
          </div>


        </div>
      </header>

      <main className={`container ${routeView === 'home' ? 'container-home' : ''} ${routeView === 'plans' ? 'container-plans' : ''}`}>
        {routeView === 'home' ? (
          <>
            <section className="hero-section" data-analytics-section="hero">
              <div className="hero-copy">
                <h1>Hosted AI Agent Swarms for Codex and Claude Code</h1>
                <p>
                  <strong>Turn Codex and Claude Code into a coordinated delivery swarm.</strong> Ruflo gives your team a
                  hosted command layer for planning goals, delegating work, preserving project memory, retrieving the
                  right context, and reviewing agent output before it reaches production.
                </p>
                <p className="hero-proof-line">
                  Start with the Growth yearly plan selected by default, save 50%, and launch the first workspace in a
                  flow built for buyers who want results now, not another weekend of orchestration setup.
                  Hosted SaaS: pay here, then use the managed workspace; no self-hosting needed.
                </p>
              </div>
              <section className="launch-panel" aria-label="Launch builder" data-analytics-section="launch-builder">
                <div className="panel-block">
                  <p className="panel-label">Choose the first model route for your Ruflo swarm</p>
                  <p className="panel-note">
                    GPT-5.5 is selected as the latest OpenAI route by default. You can switch models later from this
                    selector or the workspace setup.
                  </p>
                  <div className="option-grid option-grid-3">
                    {featuredModels.map((option) => {
                      const active = option.id === selectedModelId
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`option-card option-card-rich option-card-home-compact model-card-home-compact ${active ? 'option-card-active' : ''}`}
                          data-analytics-click={buildAnalyticsKey('home_model', option.id)}
                          onClick={() => handleModelSelect(option.id)}
                          aria-pressed={active}
                        >
                          <span className={`brand-option-icon ${option.id}`}>{option.icon}</span>
                          <span className="option-copy">
                            <span className="option-title">{option.name}</span>
                          </span>
                          {active ? <span className="selected-pill">Selected</span> : null}
                        </button>
                      )
                    })}
                  </div>
                  {additionalModels.length ? (
                    <div className="support-strip">
                      <span className="support-strip-label">More models</span>
                      <div className="model-chip-row">
                        {additionalModels.map((option) => {
                          const active = option.id === selectedModelId
                          const hasDiscount = Boolean(option.discountMultiplier && option.discountMultiplier > 0 && option.discountMultiplier < 1)
                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={`model-chip-button ${active ? 'model-chip-button-active' : ''} ${hasDiscount ? 'model-discount-target' : ''}`}
                              data-analytics-click={buildAnalyticsKey('home_model_chip', option.id)}
                              onClick={() => handleModelSelect(option.id)}
                              aria-pressed={active}
                              title={option.discountTooltip}
                              data-discount-tooltip={option.discountTooltip}
                            >
                              <span>{option.name}</span>
                              {option.discountLabel ? <span className="model-chip-discount">{option.discountLabel}</span> : null}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="panel-block panel-block-last">
                  <div className="code-row code-row-compact">
                    <button
                      type="button"
                      className="deploy-button"
                      data-analytics-click="hero_launch_workspace"
                      data-analytics-cta="true"
                      onClick={() => void handleDeploy()}
                      disabled={launchSubmitting}
                    >
                      {launchSubmitting ? 'Loading plans...' : 'Launch Ruflo'}
                    </button>
                  </div>
                </div>

                {statusMessage ? (
                  <div className="status-banner">
                    <CheckCircle2 size={16} />
                    <span>{statusMessage}</span>
                  </div>
                ) : null}

              </section>
            </section>


            <section className="content-section" id="features" data-analytics-section="features">
              <div className="section-heading">
                <span>Capabilities</span>
                <h2>Built for coordinated agent work, not scattered model sessions</h2>
              </div>
              <div className="feature-grid">
                {features.map((feature) => (
                  <article className="glass-card" key={feature.title}>
                    <h3>{feature.title}</h3>
                    <p>{feature.description}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="content-section" id="solutions" data-analytics-section="solutions">
              <div className="section-heading">
                <span>Use Cases</span>
                <h2>Start from the workload you want an agent to actually own</h2>
              </div>
              <div className="marketing-card-grid">
                {solutionPages.map((page) => (
                  <article className="glass-card marketing-card" key={page.href}>
                    <span className="marketing-card-label">{page.label}</span>
                    <h3>{page.title}</h3>
                    <p>{page.summary}</p>
                    <ul>
                      {page.outcomes.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <div className="console-actions-row">
                      <a
                        className="secondary-button marketing-link-button"
                        href={page.href}
                        data-analytics-click={buildAnalyticsKey('home_solution', page.href)}
                        data-analytics-cta="true"
                        onClick={(event) => {
                          event.preventDefault()
                          navigate(page.href)
                        }}
                      >
                        See use case
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="content-section" id="compare" data-analytics-section="compare">
              <div className="section-heading">
                <span>Compare</span>
                <h2>Evaluate Ruflo against single-agent tools and self-hosting</h2>
              </div>

              <div className="marketing-card-grid marketing-card-grid-2">
                {comparisonPages.map((page) => (
                  <article className="glass-card marketing-card" key={page.href}>
                    <span className="marketing-card-label">{page.label}</span>
                    <h3>{page.title}</h3>
                    <p>{page.summary}</p>
                    <ul>
                      {page.chooseLaunch.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <div className="console-actions-row">
                      <a
                        className="secondary-button marketing-link-button"
                        href={page.href}
                        data-analytics-click={buildAnalyticsKey('home_compare', page.href)}
                        data-analytics-cta="true"
                        onClick={(event) => {
                          event.preventDefault()
                          navigate(page.href)
                        }}
                      >
                        See when to choose it
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="content-section" id="resources" data-analytics-section="resources">
              <div className="section-heading">
                <span>Resources</span>
                <h2>Read the source, roles, and operating model before you commit</h2>
              </div>

              <div className="marketing-card-grid marketing-card-grid-2">
                {resourcePages
                  .filter((page) => page.showOnHome !== false)
                  .map((page) => (
                  <article className="glass-card marketing-card" key={page.href}>
                    <span className="marketing-card-label">{page.label}</span>
                    <h3>{page.title}</h3>
                    <p>{page.summary}</p>
                    <ul>
                      {page.checklist.slice(0, 3).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <div className="console-actions-row">
                      <a
                        className="secondary-button marketing-link-button"
                        href={page.href}
                        data-analytics-click={buildAnalyticsKey('home_resource', page.href)}
                        data-analytics-cta="true"
                        onClick={(event) => {
                          event.preventDefault()
                          navigate(page.href)
                        }}
                      >
                        Read guide
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="content-section" id="pricing" data-analytics-section="pricing">
              <div className="section-heading">
                <span>Pricing</span>
                <h2>Hosted launch plans for Ruflo workspaces</h2>
              </div>
              <div className="pricing-grid">
                {plans.map((plan) => {
                  const monthlyPricing = getPlanPricing(plan, 'monthly', selectedModel)

                  return (
                    <article className={`glass-card pricing-card ${plan.featured ? 'pricing-featured' : ''}`} key={plan.id}>
                      {plan.featured ? <div className="pricing-badge">Most popular</div> : null}
                      <h3>{plan.name}</h3>
                      <div className="price-line">
                        {monthlyPricing.originalPriceLabel ? (
                          <span className="price-original">{monthlyPricing.originalPriceLabel}</span>
                        ) : null}
                        <span>{monthlyPricing.priceLabel}</span>
                        <span className="price-cycle">/mo</span>
                      </div>
                      <p className="pricing-billing-note">Annual checkout applies 50% off yearly billing.</p>
                      <p className="plan-subtitle">{plan.subtitle}</p>
                      <ul>
                        {plan.bullets.map((bullet) => (
                          <li key={bullet}>{bullet}</li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        className="deploy-button pricing-checkout-button"
                        data-analytics-click={buildAnalyticsKey('home_pricing_checkout_annual', plan.id)}
                        data-analytics-cta="true"
                        onClick={() => void startHostedPlanCheckout(plan.id, 'creem', 'annual')}
                        disabled={launchSubmitting}
                      >
                        <CreditCard size={17} />
                        <span>Checkout {plan.name} annual</span>
                      </button>
                    </article>
                  )
                })}
              </div>
              {statusMessage ? (
                <div className="status-banner pricing-status-banner">
                  <CheckCircle2 size={16} />
                  <span>{statusMessage}</span>
                </div>
              ) : null}
            </section>

            <section className="content-section faq-layout" id="faq" data-analytics-section="faq">
              <div className="section-heading section-heading-left">
                <span>FAQ</span>
                <h2>Questions teams ask before they launch Ruflo</h2>
              </div>
              <div className="faq-grid">
                {faqs.map((faq) => (
                  <article className="glass-card" key={faq.question}>
                    <h3>{faq.question}</h3>
                    <p>{faq.answer}</p>
                  </article>
                ))}
              </div>
            </section>

          </>
        ) : null}

        {routeView === 'solution' ? (
          <section className="content-section page-shell marketing-page-shell" data-analytics-section="solution-page">
            {activeSolutionPage ? (
              <>
                <div className="section-heading">
                  <span>{activeSolutionPage.eyebrow}</span>
                  <h1>{activeSolutionPage.title}</h1>
                </div>

                <article className="glass-card marketing-hero-card">
                  <p className="marketing-summary">{activeSolutionPage.summary}</p>
                  <div className="console-actions-row marketing-action-row">
                    <button
                      type="button"
                      className="deploy-button"
                      data-analytics-click={buildAnalyticsKey('solution_hero_start', activeSolutionPage.href)}
                      data-analytics-cta="true"
                      onClick={() => navigate('/')}
                    >
                      Start workspace launch
                    </button>
                    <button
                      type="button"
                      className="secondary-button marketing-inline-button"
                      data-analytics-click={buildAnalyticsKey('solution_hero_view_plans', activeSolutionPage.href)}
                      data-analytics-cta="true"
                      onClick={() => navigate('/plans')}
                    >
                      View plans
                    </button>
                  </div>
                </article>

                <article className="glass-card marketing-hero-card marketing-definition-card">
                  <span className="marketing-card-label">Definition</span>
                  <p className="marketing-summary">{activeSolutionPage.definition}</p>
                </article>

                <div className="marketing-detail-grid">
                  <article className="glass-card">
                    <h3>Best for</h3>
                    <ul>
                      {activeSolutionPage.bestFor.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>

                  <article className="glass-card">
                    <h3>Not the best fit if</h3>
                    <ul>
                      {activeSolutionPage.notFor.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>

                  <article className="glass-card marketing-detail-card-wide">
                    <h3>Facts AI can quote directly</h3>
                    <ul className="marketing-fact-list">
                      {activeSolutionPage.facts.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>

                  <article className="glass-card">
                    <h3>What you get</h3>
                    <ul>
                      {activeSolutionPage.outcomes.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>

                  <article className="glass-card marketing-detail-card-wide">
                    <h3>Fastest path to a live Ruflo workspace</h3>
                    <ol className="marketing-step-list">
                      {activeSolutionPage.workflow.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  </article>
                </div>

                <section className="marketing-faq-section" data-analytics-section="solution-faq">
                  <div className="section-heading section-heading-left compare-subheading">
                    <span>FAQ</span>
                    <h2>Questions teams ask before launching this workflow</h2>
                  </div>
                  <div className="faq-grid">
                    {activeSolutionPage.faqs.map((faq) => (
                      <article className="glass-card" key={faq.question}>
                        <h3>{faq.question}</h3>
                        <p>{faq.answer}</p>
                      </article>
                    ))}
                  </div>
                </section>

                <article className="glass-card marketing-hero-card marketing-conclusion-card" data-analytics-section="solution-conclusion">
                  <span className="marketing-card-label">Conclusion</span>
                  <p className="marketing-summary">{activeSolutionPage.conclusion}</p>
                  <div className="console-actions-row marketing-action-row">
                    <button
                      type="button"
                      className="deploy-button"
                      data-analytics-click={buildAnalyticsKey('solution_conclusion_start', activeSolutionPage.href)}
                      data-analytics-cta="true"
                      onClick={() => navigate('/')}
                    >
                      Start workspace launch
                    </button>
                    <button
                      type="button"
                      className="secondary-button marketing-inline-button"
                      data-analytics-click={buildAnalyticsKey('solution_conclusion_view_plans', activeSolutionPage.href)}
                      data-analytics-cta="true"
                      onClick={() => navigate('/plans')}
                    >
                      View plans
                    </button>
                  </div>
                </article>
              </>
            ) : (
              <div className="glass-card empty-console-state">
                <h3>Solution page not found</h3>
                <p>Choose a use case from the homepage and start the workspace launch there.</p>
                <div className="console-actions-row">
                  <button
                    type="button"
                    className="deploy-button"
                    data-analytics-click="solution_not_found_back_home"
                    data-analytics-cta="true"
                    onClick={() => navigate('/')}
                  >
                    Back to homepage
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {routeView === 'compare' ? (
          <section className="content-section page-shell marketing-page-shell" data-analytics-section="compare-page">
            {activeComparisonPage ? (
              <>
                <div className="section-heading">
                  <span>{activeComparisonPage.eyebrow}</span>
                  <h1>{activeComparisonPage.title}</h1>
                </div>

                <article className="glass-card marketing-hero-card">
                  <span className="marketing-card-label">Decision summary</span>
                  <p className="marketing-summary">{activeComparisonPage.summary}</p>
                  <div className="console-actions-row marketing-action-row">
                    <button
                      type="button"
                      className="deploy-button"
                      data-analytics-click={buildAnalyticsKey('compare_hero_start', activeComparisonPage.href)}
                      data-analytics-cta="true"
                      onClick={() => navigate('/')}
                    >
                      Start workspace launch
                    </button>
                    <button
                      type="button"
                      className="secondary-button marketing-inline-button"
                      data-analytics-click={buildAnalyticsKey('compare_hero_view_plans', activeComparisonPage.href)}
                      data-analytics-cta="true"
                      onClick={() => navigate('/plans')}
                    >
                      View plans first
                    </button>
                  </div>
                </article>

                <div className="marketing-detail-grid">
                  <article className="glass-card">
                    <h3>Choose Ruflo if</h3>
                    <ul>
                      {activeComparisonPage.chooseLaunch.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>

                  <article className="glass-card">
                    <h3>Stay with {activeComparisonPage.alternativeName} if</h3>
                    <ul>
                      {activeComparisonPage.chooseAlternative.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                </div>

                <div className="comparison-matrix">
                  {activeComparisonPage.rows.map((row) => (
                    <article className="glass-card comparison-row" key={row.label}>
                      <div className="comparison-row-label">{row.label}</div>
                      <div className="comparison-row-values">
                        <div className="comparison-value">
                          <strong>Ruflo</strong>
                          <p>{row.launch}</p>
                        </div>
                        <div className="comparison-value">
                          <strong>{activeComparisonPage.alternativeName}</strong>
                          <p>{row.alternative}</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                <section className="compare-faq-section" data-analytics-section="compare-faq">
                  <div className="section-heading section-heading-left compare-subheading">
                    <span>FAQ</span>
                    <h2>Common questions before you choose a deployment path</h2>
                  </div>
                  <div className="faq-grid">
                    {activeComparisonPage.faqs.map((faq) => (
                      <article className="glass-card" key={faq.question}>
                        <h3>{faq.question}</h3>
                        <p>{faq.answer}</p>
                      </article>
                    ))}
                  </div>
                </section>

                <article className="glass-card marketing-hero-card compare-cta-card">
                  <span className="marketing-card-label">Next step</span>
                  <p className="marketing-summary">
                    If the real problem is repeated manual setup and stateless prompts every time you need another
                    operator workspace, start the launch flow now or review plans before you decide.
                  </p>
                  <div className="console-actions-row marketing-action-row">
                    <button
                      type="button"
                      className="deploy-button"
                      data-analytics-click={buildAnalyticsKey('compare_next_step_start', activeComparisonPage.href)}
                      data-analytics-cta="true"
                      onClick={() => navigate('/')}
                    >
                      Start workspace launch
                    </button>
                    <button
                      type="button"
                      className="secondary-button marketing-inline-button"
                      data-analytics-click={buildAnalyticsKey('compare_next_step_view_plans', activeComparisonPage.href)}
                      data-analytics-cta="true"
                      onClick={() => navigate('/plans')}
                    >
                      View plans first
                    </button>
                  </div>
                </article>
              </>

            ) : (
              <div className="glass-card empty-console-state">
                <h3>Comparison page not found</h3>
                <p>Go back to the homepage to review the main launch flow and available comparisons.</p>
                <div className="console-actions-row">
                  <button
                    type="button"
                    className="deploy-button"
                    data-analytics-click="compare_not_found_back_home"
                    data-analytics-cta="true"
                    onClick={() => navigate('/')}
                  >
                    Back to homepage
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {routeView === 'resource' ? (
          <section className="content-section page-shell marketing-page-shell" data-analytics-section="resource-page">
            {activeResourcePage ? (
              <>
                <div className="section-heading">
                  <span>{activeResourcePage.eyebrow}</span>
                  <h1>{activeResourcePage.title}</h1>
                </div>

                <article className="glass-card marketing-hero-card">
                  <p className="marketing-summary">{activeResourcePage.summary}</p>
                  <div className="console-actions-row marketing-action-row">
                    {activeResourcePage.primaryAction ? (
                      <a
                        className="deploy-button marketing-link-button"
                        href={activeResourcePage.primaryAction.href}
                        target={activeResourcePage.primaryAction.external ? '_blank' : undefined}
                        rel={activeResourcePage.primaryAction.external ? 'noreferrer' : undefined}
                        data-analytics-click={buildAnalyticsKey('resource_primary', activeResourcePage.href)}
                        data-analytics-cta="true"
                        onClick={(event) => {
                          if (activeResourcePage.primaryAction?.external) {
                            return
                          }

                          event.preventDefault()
                          navigate(activeResourcePage.primaryAction?.href ?? '/')
                        }}
                      >
                        {activeResourcePage.primaryAction.label}
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="deploy-button"
                        data-analytics-click={buildAnalyticsKey('resource_start', activeResourcePage.href)}
                        data-analytics-cta="true"
                        onClick={() => navigate('/')}
                      >
                        Start workspace launch
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary-button marketing-inline-button"
                      data-analytics-click={buildAnalyticsKey('resource_view_plans', activeResourcePage.href)}
                      data-analytics-cta="true"
                      onClick={() => navigate('/plans')}
                    >
                      View plans
                    </button>
                  </div>
                </article>

                <article className="glass-card marketing-hero-card marketing-definition-card">
                  <span className="marketing-card-label">Context</span>
                  <p className="marketing-summary">{activeResourcePage.definition}</p>
                </article>

                <div className="marketing-detail-grid">
                  {activeResourcePage.sections.map((section) => (
                    <article
                      className={`glass-card ${section.bullets && section.bullets.length > 2 ? 'marketing-detail-card-wide' : ''}`}
                      key={section.title}
                    >
                      <h3>{section.title}</h3>
                      <p>{section.body}</p>
                      {section.bullets ? (
                        <ul className="marketing-fact-list">
                          {section.bullets.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))}

                  <article className="glass-card marketing-detail-card-wide">
                    <h3>Evaluation checklist</h3>
                    <ul className="marketing-fact-list">
                      {activeResourcePage.checklist.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                </div>

                <section className="marketing-faq-section" data-analytics-section="resource-faq">
                  <div className="section-heading section-heading-left compare-subheading">
                    <span>FAQ</span>
                    <h2>Useful questions before you act on this guide</h2>
                  </div>
                  <div className="faq-grid">
                    {activeResourcePage.faqs.map((faq) => (
                      <article className="glass-card" key={faq.question}>
                        <h3>{faq.question}</h3>
                        <p>{faq.answer}</p>
                      </article>
                    ))}
                  </div>
                </section>

                <article className="glass-card marketing-hero-card marketing-conclusion-card" data-analytics-section="resource-conclusion">
                  <span className="marketing-card-label">Next step</span>
                  <p className="marketing-summary">{activeResourcePage.conclusion}</p>
                  <div className="console-actions-row marketing-action-row">
                    <button
                      type="button"
                      className="deploy-button"
                      data-analytics-click={buildAnalyticsKey('resource_conclusion_start', activeResourcePage.href)}
                      data-analytics-cta="true"
                      onClick={() => navigate('/')}
                    >
                      Start workspace launch
                    </button>
                    <button
                      type="button"
                      className="secondary-button marketing-inline-button"
                      data-analytics-click={buildAnalyticsKey('resource_conclusion_plans', activeResourcePage.href)}
                      data-analytics-cta="true"
                      onClick={() => navigate('/plans')}
                    >
                      View plans
                    </button>
                  </div>
                </article>
              </>
            ) : (
              <div className="glass-card empty-console-state">
                <h3>Resource page not found</h3>
                <p>Go back to the homepage to review the main launch flow and supporting guides.</p>
                <div className="console-actions-row">
                  <button
                    type="button"
                    className="deploy-button"
                    data-analytics-click="resource_not_found_back_home"
                    data-analytics-cta="true"
                    onClick={() => navigate('/')}
                  >
                    Back to homepage
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {routeView === 'plans' ? (
          <section className="content-section page-shell plans-page-shell" data-analytics-section="plans-page">
            <div className="section-heading">
              <h2>Pick the plan and launch your Ruflo workspace</h2>
            </div>

            <div className="checkout-grid">
              <article className="glass-card checkout-summary-card">
                <div className="subsection-heading">
                  <h3>Order summary</h3>
                </div>
                <div className="console-list">
                  <div className="console-row-item">
                    <span>Plan</span>
                    <strong>{selectedPlan.name}</strong>
                  </div>
                  <div className="console-row-item">
                    <span>Model</span>
                    <strong>{selectedModel.name}</strong>
                  </div>
                  <div className="console-row-item">
                    <span>Billing cycle</span>
                    <strong>{billingCycle === 'annual' ? 'Annual billing' : 'Monthly billing'}</strong>
                  </div>
                  <div className="console-row-item console-row-item-total">
                    <span>Total</span>
                    <strong>{selectedPlanPricing.totalLabel}</strong>
                  </div>
                </div>
                <div className="payment-method-block" role="radiogroup" aria-label="Payment method">
                  <div className="payment-method-heading">Payment method</div>
                  <div className="payment-method-options">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selectedPaymentMethod === 'credit-card'}
                      className={`payment-method-option ${
                        selectedPaymentMethod === 'credit-card' ? 'payment-method-option-active' : ''
                      }`}
                      data-analytics-click="plans_payment_credit_card"
                      onClick={() => handlePaymentMethodSelect('credit-card')}
                      disabled={launchSubmitting}
                    >
                      <span>Credit card</span>
                      <small>Default</small>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selectedPaymentMethod === 'usdc'}
                      className={`payment-method-option ${
                        selectedPaymentMethod === 'usdc' ? 'payment-method-option-active' : ''
                      }`}
                      data-analytics-click="plans_payment_usdc"
                      onClick={() => handlePaymentMethodSelect('usdc')}
                      disabled={launchSubmitting}
                    >
                      <span>USDC Wallet</span>
                    </button>
                  </div>
                </div>
                <div className="console-actions-row">
                  <button
                    type="button"
                    className="deploy-button"
                    data-analytics-click={
                      selectedPaymentMethod === 'usdc' ? 'plans_launch_wallet' : 'plans_launch_workspace'
                    }
                    data-analytics-cta="true"
                    onClick={() => void handlePlanLaunch(selectedPaymentProvider)}
                    disabled={launchSubmitting}
                  >
                    {launchButtonLabel}
                  </button>
                </div>
                {statusMessage ? (
                  <div className="status-banner plans-status-banner">
                    <CheckCircle2 size={16} />
                    <span>{statusMessage}</span>
                  </div>
                ) : null}
              </article>

              <article className="glass-card checkout-progress-card">
                <div className="subsection-heading">
                  <h3>Available packages</h3>
                </div>
                <div className="billing-toggle-header">
                  <div className="billing-toggle-row">
                    <button
                      type="button"
                      className={`billing-toggle-button ${billingCycle === 'annual' ? 'billing-toggle-button-active' : ''}`}
                      data-analytics-click="plans_billing_annual"
                      onClick={() => setBillingCycle('annual')}
                    >
                      <span>Yearly</span>
                      <span className="billing-saving-badge">50% off</span>
                    </button>
                    <button
                      type="button"
                      className={`billing-toggle-button ${billingCycle === 'monthly' ? 'billing-toggle-button-active' : ''}`}
                      data-analytics-click="plans_billing_monthly"
                      onClick={() => setBillingCycle('monthly')}
                    >
                      <span>Monthly</span>
                    </button>
                  </div>
                  <div className="billing-toggle-note">Limited-time annual discount</div>
                </div>
                <div className="pricing-grid compact-pricing-grid">
                  {plans.map((plan) => {
                    const pricing = getPlanPricing(plan, billingCycle, selectedModel)
                    const displayedPriceLabel = isAdminLaunchPriceOverride
                      ? formatCurrency(100, plan.currency)
                      : pricing.priceLabel

                    return (
                      <article
                        className={`glass-card pricing-card selectable-plan ${plan.featured ? 'pricing-featured' : ''}`}
                        key={plan.id}
                      >
                        {plan.featured ? <div className="pricing-badge">Most popular</div> : null}
                        <h3>{plan.name}</h3>
                        <div className="price-line">
                          {!isAdminLaunchPriceOverride && pricing.originalPriceLabel ? (
                            <span className="price-original">{pricing.originalPriceLabel}</span>
                          ) : null}
                          <span>{displayedPriceLabel}</span>
                          {!isAdminLaunchPriceOverride ? <span className="price-cycle">{pricing.cycleLabel}</span> : null}
                        </div>
                        <p className="plan-subtitle">{plan.subtitle}</p>
                        <ul>
                          {plan.bullets.map((bullet) => (
                            <li key={bullet}>{bullet}</li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className={`secondary-button ${selectedPlanId === plan.id ? 'selected-plan-button' : ''}`}
                          data-analytics-click={buildAnalyticsKey('plans_select', plan.id)}
                          data-analytics-cta="true"
                          onClick={() => handlePlanSelect(plan.id)}
                          disabled={launchSubmitting}
                        >
                          {selectedPlanId === plan.id ? `Selected ${plan.name}` : `Select ${plan.name}`}
                        </button>
                      </article>
                    )
                  })}
                </div>
              </article>
            </div>
          </section>
        ) : null}

        {routeView === 'console' ? (
          <section className="content-section page-shell" id="console" data-analytics-section="console-page">
            {!authReady ? <div className="glass-card empty-console-state">Checking session...</div> : null}

            {authReady ? (
              <>
                {consoleError ? <div className="admin-error-banner">{consoleError}</div> : null}
                {consoleFlashMessage ? (
                  <div className="status-banner console-flash-banner" role="status" aria-live="polite">
                    <CheckCircle2 size={16} />
                    <span>{consoleFlashMessage}</span>
                  </div>
                ) : null}

                <div className="management-stack">
                  <article className="glass-card">
                    <div className="subsection-heading">
                      <h3>Pending Orders</h3>
                      <p>Complete payment here before the order enters deployment tracking.</p>
                    </div>
                    <div className="admin-user-list">
                      {showPendingOrdersLoading ? (
                        <div className="admin-empty-state admin-loading-state" aria-live="polite">
                          <LoaderCircle size={18} className="loading-spinner-icon" />
                          <span>Loading pending orders...</span>
                        </div>
                      ) : !consoleLoadedOnce && consoleError ? (
                        <div className="admin-empty-state">Pending orders are unavailable right now.</div>
                      ) : consoleLoadedOnce && pendingPaymentOrders.length === 0 ? (
                        <div className="admin-empty-state">No pending orders.</div>
                      ) : (
                        pendingPaymentOrders.map((order) => (
                          <div className="admin-user-row compact-claw-row" key={order.id}>
                            <div className="compact-claw-main">
                              <div className="admin-user-summary">
                                <strong className="claw-summary-title">
                                  <span>{order.orderNumber}</span>
                                </strong>
                                <span>
                                  {order.planName} / {order.modelName} / {order.channelName} / Created{' '}
                                  {formatDateTime(order.createdAt)}
                                </span>
                              </div>
                              <div className="compact-claw-meta">
                                <span className="status-badge">{formatLifecycleStatus(order.paymentStatus)}</span>
                                <span className="status-badge">{order.amountLabel}</span>
                                <span className="status-badge">{formatLifecycleStatus(order.bindingStatus)}</span>
                              </div>
                              <div className="management-progress-card">
                                <div className="management-progress-header">
                                  <strong>Payment pending</strong>
                                  <span>Awaiting checkout</span>
                                </div>
                                <span className="management-progress-copy">
                                    {order.statusMessage || 'Finish payment to start provisioning automatically.'}
                                </span>
                              </div>
                            </div>
                            <div className="console-actions-row tight-actions compact-claw-actions">
                              <button
                                type="button"
                                className="secondary-button"
                                data-analytics-click="console_pay_now"
                                data-analytics-cta="true"
                                onClick={() => void handlePayOrder(order.id)}
                                disabled={paymentSubmittingOrderId === order.id}
                              >
                                {paymentSubmittingOrderId === order.id ? 'Opening checkout...' : 'Pay now'}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </article>

                  <article className="glass-card">
                    <div className="subsection-heading">
                      <h3>Ruflo Workspaces</h3>
                    </div>
                    <div className="admin-user-list">
                      {showMulticaManagementLoading ? (
                        <div className="admin-empty-state admin-loading-state" aria-live="polite">
                          <LoaderCircle size={18} className="loading-spinner-icon" />
                          <span>Loading workspaces...</span>
                        </div>
                      ) : !consoleLoadedOnce && consoleError ? (
                        <div className="admin-empty-state">Workspace data is unavailable right now.</div>
                      ) : consoleLoadedOnce && multicaManagementRows.length === 0 ? (
                        <div className="admin-empty-state">No Ruflo workspaces yet.</div>
                      ) : (
                        multicaManagementRows.map(({ id, order, deployment, claw, isLatestForOrder }) => {
                          const deploymentStatus = deployment?.status ?? claw?.status ?? order.deploymentStatus
                          const clawLifecycleStatus =
                            claw?.runtimeState === 'stopped' ? 'stopped' : claw?.status ?? deploymentStatus
                          const multicaConsoleUrl = claw?.consoleUrl ?? deployment?.consoleUrl ?? null
                          const baseAgentName =
                            claw?.instanceName ?? deployment?.instanceName ?? `${order.modelName} · ${order.channelName}`
                          const clawDisplayName =
                            order.tokenDisplay && order.tokenDisplay !== 'Not bound'
                              ? `${baseAgentName} · ${order.tokenDisplay}`
                              : baseAgentName
                          const upgradeBadgeLabel = claw
                            ? getUpgradeBadgeLabel(claw.upgradeStatus, claw.upgradeTargetVersion)
                            : null
                          const deploymentQueued = isDeploymentQueued(deploymentStatus)
                          const deploymentRunning = isDeploymentRunning(deploymentStatus)
                          const deploymentInProgress = isDeploymentPending(deploymentStatus)
                          const deploymentFailed = deploymentStatus === 'failed'
                          const redeployState = getRedeployManagementState({
                            id,
                            order,
                            deployment,
                            claw,
                            isLatestForOrder,
                          })
                          const canMulticaConsole = canMulticaManagementConsole({
                            id,
                            order,
                            deployment,
                            claw,
                            isLatestForOrder,
                          })
                          const visibleStatus = getCustomerVisibleAgentStatus(
                            claw ? clawLifecycleStatus : deploymentStatus,
                            canMulticaConsole,
                            order.tokenDisplay,
                          )
                          const shouldShowBindAccount =
                            isLatestForOrder && signedIn && order.bindingStatus === 'unbound' && (claw || deployment)
                          const canAdminDeleteMultica =
                            canManageUsers && order.canAdminDeleteMultica && isLatestForOrder && Boolean(claw)
                          const shouldShowDeploymentProgress =
                            Boolean(deployment) && (deploymentInProgress || deploymentFailed)
                          const shouldShowDeploymentProgressBar = !deploymentQueued
                          const deploymentProgressValue = Math.max(
                            deploymentRunning ? 18 : 0,
                            Math.min(100, deployment?.progress ?? 0),
                          )
                          const deploymentProgressLabel = deploymentQueued
                            ? 'Queued for provisioning'
                            : deploymentRunning
                              ? 'Deployment running'
                              : `${deployment?.triggerMode === 'manual' ? 'Manual' : 'Automatic'} deployment failed`
                          const deploymentProgressMessage = formatDeploymentMessage(
                            deployment?.lastMessage || order.statusMessage,
                            deploymentStatus,
                          )
                          const deploymentBadgeLabel = deployment
                            ? deploymentQueued
                              ? 'Queued for provisioning'
                              : deploymentRunning
                                ? 'Deployment running'
                                : deployment.triggerMode === 'manual'
                                  ? 'Manual trigger'
                                  : 'Automatic trigger'
                            : null
                          const deploymentSequence = deployment?.sequenceNumber ?? claw?.sequenceNumber ?? 1
                          const rowCreatedAt = claw?.createdAt ?? deployment?.updatedAt ?? order.createdAt
                          const openConsoleDeploymentId = deployment?.id ?? claw?.deploymentId ?? null
                          const summaryLine = `${order.orderNumber} / ${order.planName} / Deployment #${deploymentSequence} / Created ${formatDateTime(rowCreatedAt)}`
                          return (
                          <div className="admin-user-row compact-claw-row" key={id}>
                            <div className="compact-claw-main">
                              <div className="admin-user-summary">
                                <strong className="claw-summary-title">
                                  {deploymentRunning ? (
                                    <span className="deploying-claw-indicator" aria-label="Deployment in progress">
                                      <ServerCog size={15} />
                                    </span>
                                  ) : null}
                                  <span>{clawDisplayName}</span>
                                </strong>
                                <span>{summaryLine}</span>
                              </div>
                              <div className="compact-claw-meta">
                                {visibleStatus ? <span className="status-badge">{visibleStatus}</span> : null}
                                {deploymentBadgeLabel ? <span className="status-badge">{deploymentBadgeLabel}</span> : null}
                                {upgradeBadgeLabel ? <span className="status-badge">{upgradeBadgeLabel}</span> : null}
                                <span className="status-badge">{formatLifecycleStatus(order.paymentStatus)}</span>
                                <span className="status-badge">{formatLifecycleStatus(order.bindingStatus)}</span>
                              </div>
                              {shouldShowDeploymentProgress ? (
                                <div
                                  className={`management-progress-card ${
                                    deploymentFailed ? 'management-progress-card-failed' : ''
                                  }`}
                                >
                                  <div className="management-progress-header">
                                    <strong>{deploymentProgressLabel}</strong>
                                    {shouldShowDeploymentProgressBar ? <span>{deploymentProgressValue}%</span> : null}
                                  </div>
                                  <span className="management-progress-copy">{deploymentProgressMessage}</span>
                                  {shouldShowDeploymentProgressBar ? (
                                    <div className="deployment-progress-line management-progress-line">
                                      <div
                                        className="deployment-progress-bar"
                                        style={{ width: `${deploymentProgressValue}%` }}
                                      />
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                            <div className="console-actions-row tight-actions compact-claw-actions">
                              {redeployState.visible ? (
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => void handleTriggerDeployment(order.id, `management:${id}`)}
                                  disabled={deploymentTriggeringKey === `management:${id}` || redeployState.disabled}
                                >
                                  {deploymentTriggeringKey === `management:${id}`
                                    ? 'Starting deploy...'
                                    : redeployState.label}
                                </button>
                              ) : null}
                              {shouldShowBindAccount ? (
                                <button
                                  type="button"
                                  className="secondary-button"
                                  data-analytics-click="console_bind_account"
                                  onClick={() => void handleBindOrderToAccount(order.id)}
                                  disabled={bindingOrderId === order.id}
                                >
                                  {bindingOrderId === order.id ? 'Binding account...' : 'Bind to my account'}
                                </button>
                              ) : null}
                              {canMulticaConsole ? (
                                <button
                                  type="button"
                                  className="secondary-button external-link-button"
                                  data-analytics-click="console_open_workspace"
                                  data-analytics-cta="true"
                                  onClick={() => void handleMulticaConsole(order.id, openConsoleDeploymentId, id)}
                                  disabled={openingConsoleKey === id}
                                >
                                  {openingConsoleKey === id ? 'Opening...' : 'Open console'}
                                </button>
                              ) : null}
                              {canAdminDeleteMultica ? (
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => void handleAdminDeleteMultica(order.id)}
                                  disabled={adminDeletingMulticaOrderId === order.id}
                                >
                                  {adminDeletingMulticaOrderId === order.id ? 'Deleting...' : 'Delete workspace'}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        )})
                      )}
                    </div>
                  </article>
                </div>

                <div className="console-grid console-grid-top">
                  <article className="glass-card console-card">
                    <div className="console-card-top">
                      <div className="console-icon-wrap">
                        <UserRound size={18} />
                      </div>
                      <div>
                        <h3>User Center</h3>
                        <p>
                          {signedIn
                            ? 'Identity, access, and binding overview for your Ruflo workspace.'
                            : 'Guest launch is active. Sign in when you want persistent ownership and token management.'}
                        </p>
                      </div>
                    </div>
                    <div className="console-list">
                      <div className="console-row-item">
                        <span>Email</span>
                        <strong>{currentUser?.email ?? 'Guest mode'}</strong>
                      </div>
                      <div className="console-row-item">
                        <span>Role</span>
                        <strong>{currentUser ? formatRole(currentUser.role) : 'Guest'}</strong>
                      </div>
                      <div className="console-row-item">
                        <span>Status</span>
                        <strong>{currentUser ? formatStatus(currentUser.status) : 'Login required'}</strong>
                      </div>
                      <div className="console-row-item">
                        <span>Orders tracked</span>
                        <strong>{consoleMetrics.trackedOrders}</strong>
                      </div>
                      <div className="console-row-item">
                        <span>Last sign-in</span>
                        <strong>{currentUser ? formatDateTime(currentUser.lastLoginAt) : 'Guest session'}</strong>
                      </div>
                    </div>
                    <div className="console-actions-row">
                      {signedIn ? (
                        <button type="button" className="secondary-button" onClick={() => void handleSignOut()}>
                          Sign out
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="secondary-button"
                            data-analytics-click="console_login"
                            data-analytics-cta="true"
                            onClick={() => openAuthModal('login')}
                          >
                            Log in
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            data-analytics-click="console_create_account"
                            data-analytics-cta="true"
                            onClick={() => openAuthModal('register')}
                          >
                            Create account
                          </button>
                        </>
                      )}
                    </div>
                  </article>

                  <article className="glass-card console-card">
                    <div className="console-card-top">
                      <div className="console-icon-wrap">
                        <Rocket size={18} />
                      </div>
                      <div>
                        <h3>Orders</h3>
                        <p>
                          {!consoleLoadedOnce && !consoleError
                            ? 'Loading orders, payments, and workspace status.'
                            : `${consoleData.orders.length} order(s) tracked across payment, provisioning, and live workspace operations.`}
                        </p>
                      </div>
                    </div>
                    <div className="console-list">
                      <div className="console-row-item">
                        <span>Pending payment</span>
                        <strong>{consoleMetrics.unpaidOrders}</strong>
                      </div>
                      <div className="console-row-item">
                        <span>Paid orders</span>
                        <strong>{consoleMetrics.paidOrders}</strong>
                      </div>
                      <div className="console-row-item">
                        <span>Live workspaces</span>
                        <strong>{consoleMetrics.liveAgents}</strong>
                      </div>
                      <div className="console-row-item">
                        <span>Created workspaces</span>
                        <strong>{consoleMetrics.createdAgents} / {consoleMetrics.totalDeploymentsIncluded}</strong>
                      </div>
                      <div className="console-row-item">
                        <span>Available triggers</span>
                        <strong>{consoleMetrics.availableTriggers}</strong>
                      </div>
                    </div>
                    {ordersReadyForDeployment.length > 0 ? (
                      <div className="console-list">
                        {ordersReadyForDeployment.map((order) => (
                          <div className="console-row-item" key={order.id}>
                            <span>{order.orderNumber} · {order.planName}</span>
                            <strong>{order.deploymentsRemaining} deployment(s) available</strong>
                            <button
                              type="button"
                              className="secondary-button orders-create-button"
                              data-analytics-click="console_create_workspace"
                              data-analytics-cta="true"
                              onClick={() => void handleTriggerDeployment(order.id, `orders-ready:${order.id}`)}
                              disabled={
                                deploymentMode === 'manual' ||
                                deploymentTriggeringKey === `orders-ready:${order.id}`
                              }
                            >
                              {deploymentTriggeringKey === `orders-ready:${order.id}` ? 'Creating workspace...' : 'Create workspace'}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="console-actions-row">
                      <button
                        type="button"
                        className="secondary-button"
                        data-analytics-click="console_new_workspace_order"
                        data-analytics-cta="true"
                        onClick={() => navigate('/')}
                      >
                        New workspace order
                      </button>
                    </div>
                  </article>
                </div>

                <div className="management-stack">
                  {canManageUsers ? (
                    <article className="glass-card admin-card" id="user-admin">
                      <div className="console-card-top">
                        <div className="console-icon-wrap">
                          <UserRound size={18} />
                        </div>
                        <div>
                          <h3>User Management</h3>
                          <p>Create operators, promote admins, and disable access with audited server-backed state.</p>
                        </div>
                      </div>

                      <form className="admin-create-grid" onSubmit={handleCreateUser}>
                        <label className="form-field">
                          <span>Full name</span>
                          <input
                            value={createUserForm.name}
                            onChange={(event) =>
                              setCreateUserForm((current) => ({ ...current, name: event.target.value }))
                            }
                            placeholder="Operator name"
                          />
                        </label>
                        <label className="form-field">
                          <span>Email</span>
                          <input
                            value={createUserForm.email}
                            onChange={(event) =>
                              setCreateUserForm((current) => ({ ...current, email: event.target.value }))
                            }
                            placeholder="name@company.com"
                            type="email"
                          />
                        </label>
                        <label className="form-field">
                          <span>Temporary password</span>
                          <input
                            value={createUserForm.password}
                            onChange={(event) =>
                              setCreateUserForm((current) => ({ ...current, password: event.target.value }))
                            }
                            placeholder="At least 12 characters"
                            type="password"
                          />
                        </label>
                        <label className="form-field">
                          <span>Role</span>
                          <select
                            value={createUserForm.role}
                            onChange={(event) =>
                              setCreateUserForm((current) => ({
                                ...current,
                                role: event.target.value as UserRole,
                              }))
                            }
                          >
                            <option value="operator">Operator</option>
                            <option value="admin">Admin</option>
                          </select>
                        </label>
                        <button type="submit" className="deploy-button" disabled={createUserSubmitting}>
                          {createUserSubmitting ? 'Creating user...' : 'Create user'}
                        </button>
                      </form>

                      {adminError ? <div className="admin-error-banner">{adminError}</div> : null}

                      <div className="admin-user-list">
                        {adminLoading ? <div className="admin-empty-state">Loading users...</div> : null}
                        {!adminLoading && managedUsers.length === 0 ? (
                          <div className="admin-empty-state">No users found yet.</div>
                        ) : null}
                        {!adminLoading
                          ? managedUsers.map((user) => {
                              const draft = userDrafts[user.id] ?? {
                                name: user.name,
                                role: user.role,
                                status: user.status,
                              }
                              const isSelf = user.id === currentUser?.id

                              return (
                                <div className="admin-user-row" key={user.id}>
                                  <div className="admin-user-summary">
                                    <strong>{user.email}</strong>
                                    <span>
                                      {user.name} · Created {formatDateTime(user.createdAt)} · Last sign-in{' '}
                                      {formatDateTime(user.lastLoginAt)}
                                    </span>
                                  </div>
                                  <label className="form-field">
                                    <span>Name</span>
                                    <input
                                      value={draft.name}
                                      onChange={(event) =>
                                        setUserDrafts((current) => ({
                                          ...current,
                                          [user.id]: {
                                            ...draft,
                                            name: event.target.value,
                                          },
                                        }))
                                      }
                                      disabled={isSelf}
                                    />
                                  </label>
                                  <label className="form-field">
                                    <span>Role</span>
                                    <select
                                      value={draft.role}
                                      onChange={(event) =>
                                        setUserDrafts((current) => ({
                                          ...current,
                                          [user.id]: {
                                            ...draft,
                                            role: event.target.value as UserRole,
                                          },
                                        }))
                                      }
                                      disabled={isSelf}
                                    >
                                      <option value="operator">Operator</option>
                                      <option value="admin">Admin</option>
                                    </select>
                                  </label>
                                  <label className="form-field">
                                    <span>Status</span>
                                    <select
                                      value={draft.status}
                                      onChange={(event) =>
                                        setUserDrafts((current) => ({
                                          ...current,
                                          [user.id]: {
                                            ...draft,
                                            status: event.target.value as UserStatus,
                                          },
                                        }))
                                      }
                                      disabled={isSelf}
                                    >
                                      <option value="active">Active</option>
                                      <option value="disabled">Disabled</option>
                                    </select>
                                  </label>
                                  <button
                                    type="button"
                                    className="secondary-button admin-save-button"
                                    onClick={() => void handleUserSave(user.id)}
                                    disabled={isSelf || adminSavingUserId === user.id}
                                  >
                                    {isSelf
                                      ? 'Current admin'
                                      : adminSavingUserId === user.id
                                        ? 'Saving...'
                                        : 'Save changes'}
                                  </button>
                                </div>
                              )
                            })
                          : null}
                      </div>
                    </article>
                  ) : null}
                  {canManageUsers ? (
                    <article className="glass-card admin-card" id="visitor-analytics">
                      <div className="console-card-top">
                        <div className="console-icon-wrap">
                          <Rocket size={18} />
                        </div>
                        <div>
                          <h3>Visitor Analytics</h3>
                          <p>
                            Track visitor journeys, page checkpoints, key button clicks, and payment drop-offs for
                            conversion analysis.
                          </p>
                        </div>
                      </div>

                      <div className="console-actions-row">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => void loadAdminAnalytics()}
                          disabled={analyticsLoading}
                        >
                          {analyticsLoading ? 'Refreshing analytics...' : 'Refresh analytics'}
                        </button>
                      </div>

                      {analyticsError ? <div className="admin-error-banner">{analyticsError}</div> : null}

                      {analyticsSummary ? (
                        <>
                          <div className="analytics-metric-grid">
                            <div className="analytics-metric-card">
                              <strong>{analyticsSummary.totals.visitors}</strong>
                              <span>Visitors / {analyticsSummary.windowDays}d</span>
                            </div>
                            <div className="analytics-metric-card">
                              <strong>{analyticsSummary.totals.sessions}</strong>
                              <span>Sessions</span>
                            </div>
                            <div className="analytics-metric-card">
                              <strong>{analyticsSummary.totals.launchClicks}</strong>
                              <span>Launch clicks</span>
                            </div>
                            <div className="analytics-metric-card">
                              <strong>{analyticsSummary.totals.checkoutStarts}</strong>
                              <span>Checkout starts</span>
                            </div>
                            <div className="analytics-metric-card">
                              <strong>{analyticsSummary.totals.paymentCompletions}</strong>
                              <span>Payments completed</span>
                            </div>
                            <div className="analytics-metric-card">
                              <strong>{analyticsSummary.totals.sectionViews}</strong>
                              <span>Tracked content views</span>
                            </div>
                          </div>

                          <div className="analytics-summary-grid">
                            <div className="analytics-summary-card">
                              <h4>Funnel</h4>
                              <div className="analytics-summary-list">
                                {analyticsSummary.funnel.map((stage) => (
                                  <div className="analytics-summary-row" key={stage.key}>
                                    <span>{stage.label}</span>
                                    <strong>{stage.sessions}</strong>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="analytics-summary-card">
                              <h4>Drop-off stages</h4>
                              <div className="analytics-summary-list">
                                {analyticsSummary.dropOffs.length === 0 ? (
                                  <div className="analytics-summary-row">
                                    <span>No drop-offs recorded.</span>
                                  </div>
                                ) : (
                                  analyticsSummary.dropOffs.map((stage) => (
                                    <div className="analytics-summary-row" key={stage.key}>
                                      <span>{stage.label}</span>
                                      <strong>{stage.sessions}</strong>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                            <div className="analytics-summary-card">
                              <h4>Top CTA clicks</h4>
                              <div className="analytics-summary-list">
                                {analyticsSummary.topCtas.length === 0 ? (
                                  <div className="analytics-summary-row">
                                    <span>No CTA clicks yet.</span>
                                  </div>
                                ) : (
                                  analyticsSummary.topCtas.map((cta) => (
                                    <div className="analytics-summary-row" key={`${cta.key}:${cta.section}`}>
                                      <span>
                                        {formatAnalyticsStageLabel(cta.key)}
                                        {cta.section !== 'unknown' ? ` / ${formatAnalyticsStageLabel(cta.section)}` : ''}
                                      </span>
                                      <strong>
                                        {cta.clicks} / {cta.sessions}
                                      </strong>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                            <div className="analytics-summary-card">
                              <h4>Top referrers</h4>
                              <div className="analytics-summary-list">
                                {analyticsSummary.referrers.length === 0 ? (
                                  <div className="analytics-summary-row">
                                    <span>No referrer data yet.</span>
                                  </div>
                                ) : (
                                  analyticsSummary.referrers.map((referrer) => (
                                    <div className="analytics-summary-row" key={referrer.host}>
                                      <span>{referrer.host}</span>
                                      <strong>{referrer.sessions}</strong>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>
                        </>
                      ) : analyticsLoading ? (
                        <div className="admin-empty-state admin-loading-state">
                          <LoaderCircle size={18} className="loading-spinner-icon" />
                          <span>Loading visitor analytics...</span>
                        </div>
                      ) : null}

                      <div className="analytics-session-card">
                        <div className="subsection-heading">
                          <h4>Recent visitor journeys</h4>
                        </div>
                        {analyticsSessions.length === 0 && !analyticsLoading ? (
                          <div className="admin-empty-state">No tracked sessions yet.</div>
                        ) : (
                          <div className="analytics-session-list">
                            {analyticsSessions.map((session) => (
                              <button
                                type="button"
                                key={session.id}
                                className={`analytics-session-row ${
                                  analyticsDetail?.session.id === session.id ? 'analytics-session-row-active' : ''
                                }`}
                                onClick={() => void loadAnalyticsSessionDetail(session.id)}
                              >
                                <div>
                                  <strong>{session.landingPath}</strong>
                                  <span>
                                    {session.referrerHost ?? '(direct)'} · {formatAnalyticsStageLabel(session.lastStage)}
                                  </span>
                                </div>
                                <div>
                                  <strong>{session.eventCount} events</strong>
                                  <span>{formatDateTime(session.lastSeenAt)}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {analyticsDetailLoading ? (
                        <div className="admin-empty-state admin-loading-state">
                          <LoaderCircle size={18} className="loading-spinner-icon" />
                          <span>Loading visitor journey...</span>
                        </div>
                      ) : analyticsDetail ? (
                        <div className="analytics-detail-card">
                          <div className="subsection-heading">
                            <h4>Journey detail</h4>
                          </div>
                          <div className="analytics-detail-meta">
                            <span>Visitor {analyticsDetail.session.visitorId}</span>
                            <span>{analyticsDetail.session.deviceType}</span>
                            <span>{formatDateTime(analyticsDetail.session.startedAt)}</span>
                          </div>
                          <div className="analytics-event-list">
                            {analyticsDetail.events.map((event) => (
                              <div className="analytics-event-row" key={event.id}>
                                <div>
                                  <strong>{formatAnalyticsStageLabel(event.eventName)}</strong>
                                  <span>
                                    {event.routePath}
                                    {event.sectionKey ? ` · ${event.sectionKey}` : ''}
                                    {event.elementKey ? ` · ${event.elementKey}` : ''}
                                  </span>
                                </div>
                                <time>{formatDateTime(event.occurredAt)}</time>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ) : null}
                </div>
              </>
            ) : null}
          </section>
        ) : null}
        {routeView === 'privacy' ? (
          <section className="content-section page-shell legal-page-shell" data-analytics-section="privacy-page">
            <div className="section-heading legal-page-heading">
              <span className="section-eyebrow">Privacy Policy</span>
              <h2>Privacy Policy</h2>
              <p>
                This Privacy Policy applies to Ruflo AI and explains how visitor, account, order, payment,
                provisioning, and support information may be processed when you use the website and related services.
              </p>
            </div>

            <div className="legal-page-stack">
              {privacySections.map((section) => (
                <article className="glass-card legal-card" key={section.title}>
                  <h3>{section.title}</h3>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {section.bullets ? (
                    <ul className="legal-list">
                      {section.bullets.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {routeView === 'terms' ? (
          <section className="content-section page-shell legal-page-shell" data-analytics-section="terms-page">
            <div className="section-heading legal-page-heading">
              <span className="section-eyebrow">Terms of Service</span>
              <h2>Terms of Service</h2>
              <p>
                These Terms of Service govern access to and use of Ruflo AI, including account, order, checkout,
                provisioning, console, upgrade, and support-related functionality made available through the website.
              </p>
            </div>

            <div className="legal-page-stack">
              {termsSections.map((section) => (
                <article className="glass-card legal-card" key={section.title}>
                  <h3>{section.title}</h3>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {section.bullets ? (
                    <ul className="legal-list">
                      {section.bullets.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {routeView === 'notFound' ? (
          <section className="content-section page-shell marketing-page-shell" data-analytics-section="not-found-page">
            <div className="glass-card empty-console-state">
              <h1>Page not found</h1>
              <p>
                This Ruflo AI page is not part of the public site. Return to the homepage to review the launch flow and
                supporting guides.
              </p>
              <div className="console-actions-row">
                <button
                  type="button"
                  className="deploy-button"
                  data-analytics-click="not_found_back_home"
                  data-analytics-cta="true"
                  onClick={() => navigate('/')}
                >
                  Back to homepage
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-support-row">
          <span>Need help with Ruflo?</span>
          <a
            href={supportLinkHref}
            className="inline-link"
            target="_blank"
            rel="noreferrer"
            data-analytics-click="footer_github_support"
            data-analytics-cta="true"
          >
            {supportLinkLabel}
          </a>
          <span className="footer-divider">•</span>
          <a
            href={supportEmailHref}
            className="inline-link"
            data-analytics-click="footer_email_support"
            data-analytics-cta="true"
          >
            {supportEmailLabel}
          </a>
          <span className="footer-divider">•</span>
          <a
            href="/privacy"
            className="inline-link"
            data-analytics-click="footer_privacy"
            onClick={(event) => {
              event.preventDefault()
              navigate('/privacy')
            }}
          >
            Privacy Policy
          </a>
          <span className="footer-divider">•</span>
          <a
            href="/terms"
            className="inline-link"
            data-analytics-click="footer_terms"
            onClick={(event) => {
              event.preventDefault()
              navigate('/terms')
            }}
          >
            Terms of Service
          </a>
          </div>
        </div>
      </footer>

      {checkoutBackdropOpen ? <div className="hosted-checkout-backdrop" aria-hidden="true" /> : null}

      {checkoutOrder && payPalSession && payPalSession.orderId === checkoutOrder.id ? (
        <div
          className="guide-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(event) => event.target === event.currentTarget && closePlanPayPalDialog()}
        >
          <div className="upgrade-modal">
            <button type="button" className="guide-close" onClick={closePlanPayPalDialog} aria-label="Close PayPal checkout">
              <X size={18} />
            </button>

            <div className="upgrade-modal-layout">
              <div className="auth-copy-block">
                <span className="auth-eyebrow">PayPal checkout</span>
                <h2>Complete payment for Ruflo AI</h2>
                <p>
                  This order is already created. Finish the PayPal payment here and we will start provisioning immediately
                  after the server confirms the capture.
                </p>
              </div>

              <div className="upgrade-summary-grid">
                <div className="console-row-item">
                  <span>Order</span>
                  <strong>{checkoutOrder.orderNumber}</strong>
                </div>
                <div className="console-row-item">
                  <span>Total</span>
                  <strong>{checkoutOrder.amountLabel}</strong>
                </div>
                <div className="console-row-item">
                  <span>Plan</span>
                  <strong>{checkoutOrder.planName}</strong>
                </div>
                <div className="console-row-item">
                  <span>Channel</span>
                  <strong>{checkoutOrder.channelName}</strong>
                </div>
              </div>

              <div className="paypal-checkout-panel plan-paypal-panel">
                {payPalError ? <div className="admin-error-banner">{payPalError}</div> : null}
                {!payPalButtonsReady ? <div className="admin-empty-state">Loading PayPal checkout...</div> : null}
                <div ref={payPalButtonsRef} className="paypal-buttons-host" />
              </div>

              <div className="console-actions-row upgrade-actions-row">
                <button type="button" className="secondary-button" onClick={closePlanPayPalDialog}>
                  Close
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  data-analytics-click="paypal_modal_open_console"
                  data-analytics-cta="true"
                  onClick={() => navigate(checkoutOrder.consolePath)}
                >
                  Open console
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {upgradeDialogOrder ? (
        <div
          className="guide-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(event) => event.target === event.currentTarget && closeUpgradeDialog()}
        >
          <div className="upgrade-modal">
            <button type="button" className="guide-close" onClick={closeUpgradeDialog} aria-label="Close upgrade dialog">
              <X size={18} />
            </button>

            <div className="upgrade-modal-layout">
              <div className="auth-copy-block">
                <span className="auth-eyebrow">Ruflo upgrade</span>
                <h2>Switch this Ruflo version</h2>
                <p>
                  Pick any GitHub version, then confirm the upgrade. The server updates this Ruflo workspace on its deployment
                  host and refreshes the visible version after completion.
                </p>
              </div>

              <div className="upgrade-summary-grid">
                <div className="console-row-item">
                  <span>Workspace</span>
                  <strong>{upgradeDialogOrder.instance?.instanceName ?? `${upgradeDialogOrder.modelName} · ${upgradeDialogOrder.channelName}`}</strong>
                </div>
                <div className="console-row-item">
                  <span>Current version</span>
                  <strong>{formatMulticaVersion(upgradeDialogOrder.multicaVersion)}</strong>
                </div>
              </div>

              {upgradeVersionsError ? <div className="admin-error-banner">{upgradeVersionsError}</div> : null}

              <div className="upgrade-version-panel">
                {upgradeVersionsLoading ? (
                  <div className="admin-empty-state">Loading GitHub versions...</div>
                ) : upgradeVersions.length === 0 ? (
                  <div className="admin-empty-state">No Ruflo versions are available right now.</div>
                ) : (
                  <div className="upgrade-version-list">
                    {upgradeVersions.map((version) => (
                      <label className="upgrade-version-option" key={version.id}>
                        <input
                          type="radio"
                          name="multica-version"
                          value={version.name}
                          checked={selectedUpgradeVersion === version.name}
                          onChange={(event) => setSelectedUpgradeVersion(event.target.value)}
                        />
                        <span>{version.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="console-actions-row upgrade-actions-row">
                <button type="button" className="secondary-button" onClick={closeUpgradeDialog}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="deploy-button"
                  data-analytics-click="upgrade_confirm"
                  onClick={() => void handleConfirmUpgrade()}
                  disabled={
                    upgradeVersionsLoading ||
                    !selectedUpgradeVersion ||
                    selectedUpgradeVersion === upgradeDialogOrder.multicaVersion ||
                    upgradeSubmittingOrderId === upgradeDialogOrder.id
                  }
                >
                  {upgradeSubmittingOrderId === upgradeDialogOrder.id ? 'Upgrading Ruflo...' : 'Confirm upgrade'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {authMode ? (
        <div
          className="guide-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(event) => event.target === event.currentTarget && closeAuthModal()}
        >
          <div className="auth-modal">
            <button type="button" className="guide-close" onClick={closeAuthModal} aria-label="Close authentication form">
              <X size={18} />
            </button>

            <div className="auth-modal-layout">
              <div className="auth-copy-block">
                <span className="auth-eyebrow">{authMode === 'login' ? 'Secure login' : 'Account setup'}</span>
                <h2>{authMode === 'login' ? 'Sign in to your Ruflo workspace' : 'Create an operator account'}</h2>
                <p>
                  {authMode === 'login'
                    ? 'Session cookies are stored server-side, passwords are verified with strong hashing, and disabled users are blocked automatically.'
                    : 'The first registered account becomes admin automatically, then you can manage roles and status from the console.'}
                </p>
              </div>

              <form className="auth-form" onSubmit={handleAuthSubmit}>
                {authMode === 'register' ? (
                  <label className="form-field">
                    <span>Full name</span>
                    <input
                      value={authForm.name}
                      onChange={(event) =>
                        setAuthForm((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder="Jane Operator"
                    />
                  </label>
                ) : null}
                <label className="form-field">
                  <span>Email</span>
                  <input
                    value={authForm.email}
                    onChange={(event) =>
                      setAuthForm((current) => ({ ...current, email: event.target.value }))
                    }
                    placeholder="name@company.com"
                    type="email"
                  />
                </label>
                <label className="form-field">
                  <span>Password</span>
                  <input
                    value={authForm.password}
                    onChange={(event) =>
                      setAuthForm((current) => ({ ...current, password: event.target.value }))
                    }
                    placeholder="Use at least 12 characters"
                    type="password"
                  />
                </label>

                {authError ? <div className="admin-error-banner">{authError}</div> : null}

                <button
                  type="submit"
                  className="deploy-button"
                  data-analytics-click={authMode === 'login' ? 'auth_submit_login' : 'auth_submit_register'}
                  data-analytics-cta="true"
                  disabled={authSubmitting}
                >
                  {authSubmitting
                    ? authMode === 'login'
                      ? 'Signing in...'
                      : 'Creating account...'
                    : authMode === 'login'
                      ? 'Sign in'
                      : 'Create account'}
                </button>

                <div className="auth-switch-row">
                  <span>
                    {authMode === 'login' ? 'Need an account?' : 'Already have an account?'}
                  </span>
                  <button
                    type="button"
                    className="auth-inline-button"
                    data-analytics-click={authMode === 'login' ? 'auth_switch_register' : 'auth_switch_login'}
                    data-analytics-cta="true"
                    onClick={() => openAuthModal(authMode === 'login' ? 'register' : 'login')}
                  >
                    {authMode === 'login' ? 'Create account' : 'Log in'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {currentGuide ? (
        <div className="guide-overlay" role="dialog" aria-modal="true" onClick={(event) => event.target === event.currentTarget && setActiveGuide(null)}>
          <div className="guide-modal">
            <button type="button" className="guide-close" onClick={() => setActiveGuide(null)} aria-label="Close guide">
              <X size={18} />
            </button>

            <div className="guide-layout">
              <section className="guide-pane guide-pane-left">
                <div className="guide-title-row">
                  <span className={`guide-channel-icon ${activeGuide}`}>
                    {activeGuide === 'telegram' ? (
                      <TelegramLogo />
                    ) : activeGuide === 'discord' ? (
                      <DiscordLogo />
                    ) : (
                      <WhatsAppLogo />
                    )}
                  </span>
                  <h2>{currentGuide.title}</h2>
                </div>

                <div className="guide-copy-block">
                  <p className="guide-subtitle">How to connect this frontend?</p>
                  <ol className="guide-steps">
                    {currentGuide.steps.map((step, index) => (
                      <li key={index}>
                        <span className="guide-step-index">{index + 1}.</span>
                        <span className="guide-step-copy">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="guide-divider" />

                <div className="guide-form-block">
                  <label className="guide-field-label">{currentGuide.tokenLabel}</label>
                  <input
                    className="guide-token-input"
                    value={activeGuide ? guideInputs[activeGuide] : ''}
                    onChange={(event) => handleGuideInputChange(event.target.value)}
                    placeholder={currentGuide.tokenPlaceholder}
                  />
                  <button
                    type="button"
                    className={`guide-save-button ${
                      canSaveGuide ? 'guide-save-button-ready' : ''
                    }`}
                    data-analytics-click={buildAnalyticsKey('guide_save', activeGuide)}
                    onClick={handleGuideSave}
                  >
                    <span>Save</span>
                    <Check size={15} />
                  </button>
                </div>
              </section>

              <section className="guide-pane guide-pane-right">
                <div className="phone-frame">
                  <div className="phone-topbar">
                    <span>9:41</span>
                    <div className="phone-top-icons">
                      <span />
                      <span />
                    </div>
                  </div>

                  <div className="phone-profile">
                    <div className="phone-avatar">{currentGuide.phone.avatar}</div>
                    <div>
                      <div className="phone-profile-name">{currentGuide.phone.name}</div>
                      <div className="phone-profile-subtitle">{currentGuide.phone.subtitle}</div>
                    </div>
                  </div>

                  <div className="phone-chat-body">
                    <div className="chat-bubble chat-bubble-incoming">
                      <div className="chat-bubble-text">{currentGuide.phone.lead.text}</div>
                      <div className="chat-bubble-time">{currentGuide.phone.lead.time}</div>
                    </div>

                    <div className="phone-quick-actions">
                      {currentGuide.phone.quickActions.map((action) => (
                        <div key={action.title} className="quick-action-card">
                          <div className="quick-action-title">{action.title}</div>
                          {action.subtitle ? <div className="quick-action-subtitle">{action.subtitle}</div> : null}
                        </div>
                      ))}
                    </div>

                    <div className="chat-row chat-row-outgoing">
                      <div className="chat-bubble chat-bubble-outgoing">
                        <div className="chat-bubble-text">{currentGuide.phone.outgoing.text}</div>
                        <div className="chat-bubble-time">{currentGuide.phone.outgoing.time}</div>
                      </div>
                    </div>

                    <div className="chat-bubble chat-bubble-incoming">
                      <div className="chat-bubble-text">{currentGuide.phone.reply.text}</div>
                      <div className="chat-bubble-time">{currentGuide.phone.reply.time}</div>
                    </div>
                  </div>

                  <div className="phone-composer">
                    <div className="composer-dot" />
                    <span>{currentGuide.phone.composer}</span>
                    <button type="button" className="composer-send" aria-label="Send">
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
