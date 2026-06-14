import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir, hostname, networkInterfaces } from 'node:os'
import { Client } from 'ssh2'
import { modelCatalog } from '../shared/catalog.mjs'
import {
  buildInternalModelProxyBaseUrl,
  buildModelProxyInternalToken,
  normalizeModelProxyUpstreamBaseUrl,
} from './model-proxy-helpers.mjs'
import {
  buildMulticaRouterConsoleUrl,
  buildMulticaRouterRouteFileName,
  buildMulticaRouterRouteRecord,
} from './multica-router-helpers.mjs'
import { buildPostgresRuntimeEnvironment } from './postgres-runtime-env.mjs'

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function sanitizeIdentifier(value, fallback, maxLength = 24) {
  const normalized = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!normalized) {
    return fallback
  }

  return normalized.slice(0, maxLength)
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

function deriveStableSuffix(seed, length = 8) {
  return createHash('sha256')
    .update(String(seed ?? ''))
    .digest('hex')
    .slice(0, length)
}

function deriveConsolePort(seed, basePort = 18000, range = 20000) {
  const normalizedSeed = String(seed ?? '').trim()
  if (!normalizedSeed) {
    return basePort
  }

  return basePort + (parseInt(deriveStableSuffix(normalizedSeed), 16) % range)
}

function deriveConfiguredConsolePort(config, seed) {
  const configuredBasePort = Number.parseInt(String(config?.deployment?.consolePortBase ?? ''), 10)
  const configuredRange = Number.parseInt(String(config?.deployment?.consolePortRange ?? ''), 10)
  const basePort = Number.isInteger(configuredBasePort) && configuredBasePort > 0 ? configuredBasePort : 18000
  const range = Number.isInteger(configuredRange) && configuredRange > 0 ? configuredRange : 20000
  return deriveConsolePort(seed, basePort, range)
}

function buildRuntimeUserName(prefix, instanceName) {
  const normalizedPrefix = sanitizeIdentifier(prefix, 'mca', 10)
  const instanceStem = sanitizeIdentifier(instanceName, 'instance', 10)
  const suffix = deriveStableSuffix(instanceName)
  return `${normalizedPrefix}_${instanceStem}-${suffix}`
}

function buildServiceName(prefix, instanceName) {
  const normalizedPrefix = sanitizeIdentifier(prefix, 'multica', 20)
  const instanceStem = sanitizeIdentifier(instanceName, 'instance', 20)
  const suffix = deriveStableSuffix(instanceName)
  return `${normalizedPrefix}-${instanceStem}-${suffix}`
}

function buildDirectConsoleUrl(config, port) {
  return `http://${config.server.host}:${port}`
}

function isRouterEnabled(config) {
  return config.provider === 'ssh' && Boolean(String(config.router?.baseUrl ?? '').trim())
}

function buildConsoleAccessUrl(config, instanceName, consolePort) {
  if (isRouterEnabled(config)) {
    return buildMulticaRouterConsoleUrl(config.router.baseUrl, instanceName)
  }

  return buildDirectConsoleUrl(config, consolePort)
}

function loadLocalAuthProfiles() {
  try {
    const authPath = join(homedir(), '.multica', 'agents', 'main', 'agent', 'auth-profiles.json')
    return readFileSync(authPath, 'utf8')
  } catch (e) {
    try {
      const globalAuthPath = join(homedir(), '.multica', 'auth-profiles.json')
      return readFileSync(globalAuthPath, 'utf8')
    } catch (err) {}
  }
  return null
}

function loadLocalMulticaConfig() {
  try {
    const configPath = join(homedir(), '.multica', 'multica.json')
    const raw = readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function getConfiguredAppOrigins() {
  return String(process.env.APP_ORIGIN ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function resolveGatewayControlUiAllowedOrigins(localGatewayControlUi) {
  const configuredOrigins = Array.isArray(localGatewayControlUi?.allowedOrigins)
    ? localGatewayControlUi.allowedOrigins.map((item) => String(item ?? '').trim()).filter(Boolean)
    : []

  const mergedOrigins = [...configuredOrigins, ...getConfiguredAppOrigins()]
  return Array.from(new Set(mergedOrigins))
}

function parseJsonObject(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function normalizeModelLookup(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function resolveProviderModelSelection(localConfig, requestedModelId) {
  const providers =
    localConfig?.models && typeof localConfig.models === 'object' && localConfig.models.providers && typeof localConfig.models.providers === 'object'
      ? localConfig.models.providers
      : null

  if (!providers) {
    return ''
  }

  const normalizedRequested = normalizeModelLookup(requestedModelId)
  if (!normalizedRequested) {
    return ''
  }

  for (const [providerId, providerConfig] of Object.entries(providers)) {
    const models = Array.isArray(providerConfig?.models) ? providerConfig.models : []
    for (const model of models) {
      const modelId = typeof model?.id === 'string' ? model.id.trim() : ''
      const modelName = typeof model?.name === 'string' ? model.name.trim() : ''

      if (!modelId) {
        continue
      }

      if (
        normalizeModelLookup(modelId) === normalizedRequested ||
        normalizeModelLookup(modelName) === normalizedRequested
      ) {
        return `${providerId}/${modelId}`
      }
    }
  }

  return ''
}

function buildModelProxyModelMap() {
  const configuredMap = parseJsonObject(process.env.MULTICA_MODEL_PROXY_MODEL_MAP_JSON ?? '')
  const entries = Object.entries(
    configuredMap && !Array.isArray(configuredMap) ? configuredMap : {},
  )
  const modelMap = {
    'gemini-3-1-pro': 'gemini-3.1-pro-preview',
    'glm-5-1': 'glm-5',
    'claude-opus-4-6': 'claude-opus-4-6',
    'claude-sonnet-4-6': 'claude-sonnet-4-6',
    'gpt-5-5': 'gpt-5.5',
    'gpt-5-4': 'gpt-5.4',
    'glm-4-7': 'glm-4.7',
    'gemini-3-pro': 'gemini-3-pro-preview',
    'gpt-4-1': 'gpt-4.1',
  }

  for (const [internalModelId, providerModelId] of entries) {
    const normalizedInternalModelId = String(internalModelId ?? '').trim()
    const normalizedProviderModelId = String(providerModelId ?? '').trim()

    if (!normalizedInternalModelId || !normalizedProviderModelId) {
      continue
    }

    modelMap[normalizedInternalModelId] = normalizedProviderModelId
  }

  return modelMap
}

function buildGeneratedModelProxyProvider(plan) {
  const providerId =
    sanitizeIdentifier(process.env.MULTICA_MODEL_PROXY_PROVIDER_ID ?? 'thousand-engine', 'thousand-engine', 40) ||
    'thousand-engine'
  const keyEnvId = 'MULTICA_MODEL_PROXY_TOKEN'
  const upstreamKeyValue = String(process.env.QS_KEY ?? '').trim()
  const baseUrl = normalizeModelProxyUpstreamBaseUrl(process.env.MULTICA_MODEL_PROXY_BASE_URL ?? '')
  const modelMap = buildModelProxyModelMap()

  if (!baseUrl || !upstreamKeyValue) {
    return null
  }

  return {
    providerId,
    keyEnvId,
    providerConfig: {
      baseUrl: buildInternalModelProxyBaseUrl(plan.instanceName),
      api: String(process.env.MULTICA_MODEL_PROXY_API ?? 'openai-completions').trim() || 'openai-completions',
      models: modelCatalog.map((model) => ({
        id: modelMap[model.id] ?? model.id,
        name: model.name,
      })),
    },
  }
}

function findFirstEnvKeyRefId(value) {
  if (!value || typeof value !== 'object') {
    return ''
  }

  if (value.source === 'env' && typeof value.id === 'string' && value.id.trim()) {
    return value.id.trim()
  }

  for (const nestedValue of Object.values(value)) {
    const nestedId = findFirstEnvKeyRefId(nestedValue)
    if (nestedId) {
      return nestedId
    }
  }

  return ''
}

function buildChannelTokenEnvironment({ localConfig, channelId, communicationToken }) {
  const normalizedToken = String(communicationToken ?? '').trim()
  if (!normalizedToken) {
    return {}
  }

  const configuredChannel =
    localConfig?.channels && typeof localConfig.channels === 'object'
      ? localConfig.channels[channelId]
      : null
  const envKeyId = findFirstEnvKeyRefId(configuredChannel)

  if (!envKeyId) {
    return {}
  }

  return {
    [envKeyId]: normalizedToken,
  }
}

function resolveUrl(baseUrl, instanceName) {
  if (baseUrl.includes('{{INSTANCE_NAME}}')) {
    return baseUrl.replaceAll('{{INSTANCE_NAME}}', instanceName)
  }

  return `${stripTrailingSlash(baseUrl)}/${instanceName}`
}

function getMulticaConfigPath(workspacePath) {
  return `${workspacePath}/.multica/multica.json`
}

function getMulticaStatePath(workspacePath) {
  return `${workspacePath}/state`
}

function normalizeStartupCommand(command) {
  const normalized = String(command ?? '').trim()

  if (!normalized) {
    return 'npm run start'
  }

  if (
    /^multica\s+gateway\s+run\b/i.test(normalized) &&
    !/\s--allow-unconfigured(?:\s|$)/i.test(normalized)
  ) {
    return normalized.replace(/^multica\s+gateway\s+run\b/i, '$& --allow-unconfigured')
  }

  return normalized
}

function buildRuntimePassthroughEnvironment() {
  const additionalKeys = String(process.env.MULTICA_RUNTIME_ENV_PASSTHROUGH ?? '')
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean)
  const keys = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
    'GEMINI_API_KEY',
    'XAI_API_KEY',
    'DEEPSEEK_API_KEY',
    'OPENROUTER_API_KEY',
    ...additionalKeys,
  ]
  const environment = {}
  const blockedKeys = new Set(['QS_KEY'])

  for (const key of new Set(keys)) {
    if (blockedKeys.has(key)) {
      continue
    }

    const value = process.env[key]
    if (typeof value !== 'string' || !value.trim()) {
      continue
    }

    environment[key] = value
  }

  return environment
}

function buildPlan(config, context) {
  const localMulticaConfig = loadLocalMulticaConfig()
  const runtimeUser = buildRuntimeUserName(config.multica.runtimeUserPrefix, context.instanceName)
  const serviceName = buildServiceName(config.multica.servicePrefix, context.instanceName)
  const workspacePath = `${stripTrailingSlash(config.multica.baseDir)}/instances/${context.instanceName}`
  const appPath = `${workspacePath}/app`
  const envPath = `${workspacePath}/.env`
  const consolePort = config.provider === 'ssh' ? deriveConfiguredConsolePort(config, context.instanceName) : null
  const consoleUrl =
    consolePort !== null
      ? buildConsoleAccessUrl(config, context.instanceName, consolePort)
      : resolveUrl(config.deployment.consoleBaseUrl, context.instanceName)
  const publicEndpoint =
    consolePort !== null
      ? buildConsoleAccessUrl(config, context.instanceName, consolePort)
      : resolveUrl(config.deployment.publicBaseUrl, context.instanceName)
  const consoleToken = randomBytes(24).toString('hex')
  const hasCommunicationToken = Boolean(context.communicationToken?.trim())
  const environment = {
    NODE_ENV: 'production',
    INSTANCE_NAME: context.instanceName,
    ORDER_ID: context.order.id,
    USER_EMAIL: context.user.email,
    [config.multica.modelEnvName]: context.order.model_id,
    [config.multica.channelEnvName]: context.order.channel_id,
    [config.multica.planEnvName]: context.order.plan_id,
    MULTICA_INSTANCE_NAME: context.instanceName,
    MULTICA_INSTANCE_ROOT: workspacePath,
    MULTICA_PUBLIC_URL: publicEndpoint,
    MULTICA_CONSOLE_URL: consoleUrl,
    MULTICA_CONFIG_PATH: getMulticaConfigPath(workspacePath),
    MULTICA_STATE_DIR: getMulticaStatePath(workspacePath),
    MULTICA_GATEWAY_TOKEN: consoleToken,
    MULTICA_CHANNEL_BOUND: hasCommunicationToken ? 'true' : 'false',
  }
  const postgresEnvironment = buildPostgresRuntimeEnvironment()
  const passthroughEnvironment = buildRuntimePassthroughEnvironment()
  const generatedModelProxy = buildGeneratedModelProxyProvider({
    instanceName: context.instanceName,
  })
  const modelProxyEnvironment =
    generatedModelProxy && buildModelProxyInternalToken(context.instanceName)
      ? {
          [generatedModelProxy.keyEnvId]: buildModelProxyInternalToken(context.instanceName),
        }
      : {}
  const channelTokenEnvironment = buildChannelTokenEnvironment({
    localConfig: localMulticaConfig,
    channelId: context.order.channel_id,
    communicationToken: context.communicationToken,
  })

  if (postgresEnvironment) {
    Object.assign(environment, postgresEnvironment)
  }

  Object.assign(environment, passthroughEnvironment)
  Object.assign(environment, modelProxyEnvironment)
  Object.assign(environment, channelTokenEnvironment)

  if (consolePort !== null) {
    environment.PORT = String(consolePort)
    environment.HOST = '0.0.0.0'
  }

  return {
    instanceName: context.instanceName,
    runtimeUser,
    serviceName,
    workspacePath,
    appPath,
    envPath,
    consolePort,
    consoleToken,
    consoleUrl,
    publicEndpoint,
    targetServer: config.deployment.targetServer,
    selectedModelId: context.order.model_id,
    selectedChannelId: context.order.channel_id,
    environment,
  }
}

function buildUpgradePlan(config, context) {
  const workspacePath = context.workspacePath || `${stripTrailingSlash(config.multica.baseDir)}/instances/${context.instanceName}`
  const appPath = context.appPath || `${workspacePath}/app`

  return {
    instanceName: context.instanceName,
    runtimeUser: context.runtimeUser,
    serviceName: context.serviceName,
    workspacePath,
    appPath,
    targetServer: context.targetServer || config.deployment.targetServer,
    targetVersion: context.targetVersion,
  }
}

function buildLifecyclePlan(config, context) {
  const workspacePath = context.workspacePath || `${stripTrailingSlash(config.multica.baseDir)}/instances/${context.instanceName}`
  const appPath = context.appPath || `${workspacePath}/app`
  const runtimeUser =
    context.runtimeUser ||
    buildRuntimeUserName(config.multica.runtimeUserPrefix, context.instanceName)
  const serviceName =
    context.serviceName ||
    buildServiceName(config.multica.servicePrefix, context.instanceName)
  let consolePort = config.provider === 'ssh' ? deriveConfiguredConsolePort(config, context.instanceName) : null

  if (context.consoleUrl) {
    try {
      const parsed = new URL(context.consoleUrl)
      consolePort = parsed.port ? Number(parsed.port) : consolePort
    } catch {}
  }

  return {
    instanceName: context.instanceName,
    runtimeUser,
    serviceName,
    workspacePath,
    appPath,
    targetServer: context.targetServer || config.deployment.targetServer,
    consolePort,
  }
}

function renderEnvFile(environment) {
  return `${Object.entries(environment)
    .map(([key, value]) => `${key}=${String(value).replace(/\r?\n/g, '\\n')}`)
    .join('\n')}\n`
}

function renderRouterRouteFile(plan, runtimeState = 'running') {
  return `${JSON.stringify(
    buildMulticaRouterRouteRecord({
      instanceName: plan.instanceName,
      consolePort: plan.consolePort,
      serviceName: plan.serviceName,
      workspacePath: plan.workspacePath,
      runtimeState,
    }),
    null,
    2,
  )}\n`
}

function renderMulticaHomeConfig(plan) {
  const localConfig = loadLocalMulticaConfig()
  const localModels =
    localConfig?.models && typeof localConfig.models === 'object' ? cloneJson(localConfig.models) : undefined
  const localAgents = localConfig?.agents && typeof localConfig.agents === 'object' ? localConfig.agents : {}
  const localAgentDefaults =
    localAgents.defaults && typeof localAgents.defaults === 'object' ? localAgents.defaults : {}
  const localSelectedModelPrimary = resolveProviderModelSelection(localConfig, plan.selectedModelId)
  const generatedModelProxy = buildGeneratedModelProxyProvider(plan)
  let renderedModels = localModels && typeof localModels === 'object' ? localModels : undefined

  if (generatedModelProxy) {
    const nextModels = renderedModels ?? { mode: 'merge', providers: {} }

    if (!nextModels.mode || typeof nextModels.mode !== 'string') {
      nextModels.mode = 'merge'
    }

    if (!nextModels.providers || typeof nextModels.providers !== 'object') {
      nextModels.providers = {}
    }

    nextModels.providers[generatedModelProxy.providerId] = generatedModelProxy.providerConfig

    renderedModels = nextModels
  }

  const generatedSelectedModelPrimary = generatedModelProxy
    ? resolveProviderModelSelection(
        {
          models: {
            mode: 'merge',
            providers: {
              [generatedModelProxy.providerId]: generatedModelProxy.providerConfig,
            },
          },
        },
        plan.selectedModelId,
      )
    : ''
  const selectedModelPrimary =
    generatedSelectedModelPrimary ||
    localSelectedModelPrimary ||
    resolveProviderModelSelection({ models: renderedModels }, plan.selectedModelId)
  const selectedChannelConfig =
    localConfig?.channels &&
    typeof localConfig.channels === 'object' &&
    localConfig.channels[plan.selectedChannelId] &&
    typeof localConfig.channels[plan.selectedChannelId] === 'object'
      ? cloneJson(localConfig.channels[plan.selectedChannelId])
      : null
  const localGateway = localConfig?.gateway && typeof localConfig.gateway === 'object' ? localConfig.gateway : {}
  const localGatewayControlUi =
    localGateway.controlUi && typeof localGateway.controlUi === 'object' ? localGateway.controlUi : {}
  const resolvedControlUiAllowedOrigins = resolveGatewayControlUiAllowedOrigins(localGatewayControlUi)
  const renderedAgentDefaults = {
    workspace: `${plan.workspacePath}/.multica/workspace`,
  }

  if (localAgentDefaults.model && typeof localAgentDefaults.model === 'object') {
    renderedAgentDefaults.model = cloneJson(localAgentDefaults.model)
  }

  if (localAgentDefaults.models && typeof localAgentDefaults.models === 'object') {
    renderedAgentDefaults.models = cloneJson(localAgentDefaults.models)
  }

  if (typeof localAgentDefaults.thinkingDefault === 'string' && localAgentDefaults.thinkingDefault.trim()) {
    renderedAgentDefaults.thinkingDefault = localAgentDefaults.thinkingDefault
  }

  if (selectedModelPrimary) {
    renderedAgentDefaults.model = {
      ...(renderedAgentDefaults.model && typeof renderedAgentDefaults.model === 'object'
        ? renderedAgentDefaults.model
        : {}),
      primary: selectedModelPrimary,
    }
  }

  const renderedConfig = {
    ...(renderedModels ? { models: renderedModels } : {}),
    gateway: {
      mode: 'local',
      controlUi: {
        ...localGatewayControlUi,
        ...(resolvedControlUiAllowedOrigins.length > 0 ? { allowedOrigins: resolvedControlUiAllowedOrigins } : {}),
        dangerouslyDisableDeviceAuth: true,
        dangerouslyAllowHostHeaderOriginFallback: true,
        allowInsecureAuth: true,
      },
    },
    agents: {
      defaults: renderedAgentDefaults,
    },
    ...(selectedChannelConfig
      ? {
          channels: {
            [plan.selectedChannelId]: selectedChannelConfig,
          },
        }
      : {}),
  }

  return `${JSON.stringify(renderedConfig, null, 2)}\n`
}

function renderAuthProfilesConfig(plan) {
  const rawAuthProfiles = loadLocalAuthProfiles()
  const generatedModelProxy = buildGeneratedModelProxyProvider(plan)

  if (!generatedModelProxy) {
    return rawAuthProfiles ?? ''
  }

  const parsedAuthProfiles = parseJsonObject(rawAuthProfiles)
  const renderedAuthProfiles =
    parsedAuthProfiles && typeof parsedAuthProfiles === 'object'
      ? cloneJson(parsedAuthProfiles)
      : {
          version: 1,
          profiles: {},
        }

  if (typeof renderedAuthProfiles.version !== 'number') {
    renderedAuthProfiles.version = 1
  }

  if (!renderedAuthProfiles.profiles || typeof renderedAuthProfiles.profiles !== 'object') {
    renderedAuthProfiles.profiles = {}
  }

  const profileId = `${generatedModelProxy.providerId}:default`
  renderedAuthProfiles.profiles[profileId] = {
    type: 'api_key',
    provider: generatedModelProxy.providerId,
    keyRef: {
      source: 'env',
      provider: 'default',
      id: generatedModelProxy.keyEnvId,
    },
  }

  return `${JSON.stringify(renderedAuthProfiles, null, 2)}\n`
}

function renderSystemdService(plan, config) {
  const startCommand = normalizeStartupCommand(config.multica.startCommand)

  return `[Unit]
Description=Multica instance ${plan.serviceName}
After=network.target

[Service]
Type=simple
User=${plan.runtimeUser}
Group=${plan.runtimeUser}
WorkingDirectory=${plan.appPath}
EnvironmentFile=${plan.envPath}
Environment=HOME=${plan.workspacePath}
Environment=XDG_CACHE_HOME=${plan.workspacePath}/.cache
Environment=NPM_CONFIG_CACHE=${plan.workspacePath}/.npm
Environment=TMPDIR=${plan.workspacePath}/.tmp
ExecStart=/bin/bash -lc ${shellEscape(`PATH=/usr/local/bin:/usr/bin:/bin:$PATH ${startCommand}`)}
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectControlGroups=true
ProtectKernelModules=true
ProtectKernelTunables=true
LockPersonality=true
RestrictSUIDSGID=true
RestrictNamespaces=true
RestrictRealtime=true
SystemCallArchitectures=native
UMask=0077
ReadWritePaths=${plan.workspacePath}

[Install]
WantedBy=multi-user.target
`
}

function requireRepositoryUrl(config) {
  const repoUrl = String(config?.multica?.repoUrl ?? '').trim()
  if (!repoUrl) {
    const configPath = config?.path ? ` in ${config.path}` : ''
    throw new Error(
      `Multica repository URL is missing${configPath}. Set multica.repoUrl to a valid Git repository URL before deploying.`,
    )
  }

  return repoUrl
}

function requireArchiveUrl(config) {
  const archiveUrl = String(config?.multica?.archiveUrl ?? '').trim()
  if (!archiveUrl) {
    const configPath = config?.path ? ` in ${config.path}` : ''
    throw new Error(
      `Multica archive URL is missing${configPath}. Set multica.archiveUrl to a valid tar.gz or zip package URL before deploying.`,
    )
  }

  return archiveUrl
}

function readArchivePath(config) {
  return String(config?.multica?.archivePath ?? '').trim()
}

function resolveDeploymentSource(config) {
  const sourceType = config?.multica?.sourceType === 'git' ? 'git' : 'archive'

  if (sourceType === 'archive') {
    const archivePath = readArchivePath(config)
    return {
      type: 'archive',
      archiveUrl: archivePath ? '' : requireArchiveUrl(config),
      archivePath,
    }
  }

  return {
    type: 'git',
    repoUrl: requireRepositoryUrl(config),
    repoRef: String(config?.multica?.repoRef ?? '').trim() || 'main',
  }
}

function describeDeploymentConfig(config) {
  return [
    `configPath=${config?.path ?? '<default>'}`,
    `provider=${config?.provider ?? '<unknown>'}`,
    `sourceType=${config?.multica?.sourceType ?? 'archive'}`,
    `repoUrl=${String(config?.multica?.repoUrl ?? '').trim() || '<empty>'}`,
    `repoRef=${String(config?.multica?.repoRef ?? '').trim() || '<empty>'}`,
    `archiveUrl=${String(config?.multica?.archiveUrl ?? '').trim() || '<empty>'}`,
    `archivePath=${String(config?.multica?.archivePath ?? '').trim() || '<empty>'}`,
    `host=${String(config?.server?.host ?? '').trim() || '<empty>'}`,
    `port=${String(config?.server?.port ?? '').trim() || '<empty>'}`,
    `username=${String(config?.server?.username ?? '').trim() || '<empty>'}`,
    `hasPassword=${config?.server?.password ? 'true' : 'false'}`,
    `hasPrivateKey=${config?.server?.privateKey ? 'true' : 'false'}`,
    `privateKeyPath=${String(config?.server?.privateKeyPath ?? '').trim() || '<empty>'}`,
  ].join(', ')
}

function buildDeploymentFailureError(error, config, plan) {
  const message = error instanceof Error ? error.message : String(error)
  const failure = new Error(`${message}\n[deployment-debug] ${describeDeploymentConfig(config)}`)

  Object.assign(failure, {
    targetServer: plan?.targetServer ?? config?.deployment?.targetServer ?? null,
    workspacePath: plan?.workspacePath ?? null,
    runtimeUser: plan?.runtimeUser ?? null,
    serviceName: plan?.serviceName ?? null,
    multicaVersion: plan?.targetVersion ?? config?.multica?.repoRef ?? null,
  })

  return failure
}

function hasDeploymentServerPassword(config) {
  return Boolean(String(config?.server?.password ?? '').trim())
}

function hasDeploymentServerPrivateKey(config) {
  return Boolean(String(config?.server?.privateKey ?? '').trim())
}

function hasDeploymentServerCredentials(config) {
  return hasDeploymentServerPassword(config) || hasDeploymentServerPrivateKey(config)
}

function buildSshConnectionOptions(config, readyTimeout = 60000) {
  const options = {
    host: config.server.host,
    port: config.server.port,
    username: config.server.username,
    readyTimeout,
  }

  if (hasDeploymentServerPrivateKey(config)) {
    options.privateKey = config.server.privateKey
    if (config.server.privateKeyPassphrase) {
      options.passphrase = config.server.privateKeyPassphrase
    }
    return options
  }

  if (hasDeploymentServerPassword(config)) {
    options.password = config.server.password
  }

  return options
}

function renderAppSetupCommand(plan, source) {
  if (source.type === 'archive') {
    const stagedArchivePath = `${plan.workspacePath}/.tmp/multica-template.tar.gz`
    return `set -euo pipefail
rm -rf ${shellEscape(plan.appPath)}
EXTRACT_DIR="$(mktemp -d ${shellEscape(`${plan.workspacePath}/.tmp/multica-extract.XXXXXX`)})"
if [ -n ${shellEscape(source.archivePath ?? '')} ]; then
  ARCHIVE_FILE=${shellEscape(stagedArchivePath)}
elif command -v curl >/dev/null 2>&1; then
  ARCHIVE_URL=${shellEscape(source.archiveUrl ?? '')}
  ARCHIVE_FILE="$(mktemp ${shellEscape(`${plan.workspacePath}/.tmp/multica-src.XXXXXX`)})"
  curl -fsSL "$ARCHIVE_URL" -o "$ARCHIVE_FILE"
elif command -v wget >/dev/null 2>&1; then
  ARCHIVE_URL=${shellEscape(source.archiveUrl ?? '')}
  ARCHIVE_FILE="$(mktemp ${shellEscape(`${plan.workspacePath}/.tmp/multica-src.XXXXXX`)})"
  wget -qO "$ARCHIVE_FILE" "$ARCHIVE_URL"
else
  echo 'Neither a pre-uploaded archive path nor curl/wget download is available for the Multica archive.' >&2
  exit 1
fi
if [ ! -f "$ARCHIVE_FILE" ]; then
  echo "Multica archive not found at $ARCHIVE_FILE" >&2
  exit 1
fi
if tar -xzf "$ARCHIVE_FILE" -C "$EXTRACT_DIR" >/dev/null 2>&1; then
  :
elif command -v unzip >/dev/null 2>&1; then
  unzip -q "$ARCHIVE_FILE" -d "$EXTRACT_DIR" >/dev/null 2>&1
else
  echo 'Unable to extract the Multica archive. Install unzip or provide a tar.gz package.' >&2
  exit 1
fi
shopt -s dotglob nullglob
EXTRACT_ENTRIES=("$EXTRACT_DIR"/*)
ENTRY_COUNT="\${#EXTRACT_ENTRIES[@]}"
FIRST_ENTRY="\${EXTRACT_ENTRIES[0]:-}"
if [ "$ENTRY_COUNT" = "0" ]; then
  echo 'Multica archive was extracted, but no files were found.' >&2
  exit 1
fi
SOURCE_DIR="$EXTRACT_DIR"
if [ "$ENTRY_COUNT" = "1" ] && [ -d "$FIRST_ENTRY" ]; then
  SOURCE_DIR="$FIRST_ENTRY"
fi
install -d -m 700 ${shellEscape(plan.appPath)}
cp -a "$SOURCE_DIR"/. ${shellEscape(`${plan.appPath}/`)}
if [ "$ARCHIVE_FILE" != ${shellEscape(stagedArchivePath)} ]; then
  rm -f "$ARCHIVE_FILE"
fi
if [ -f ${shellEscape(stagedArchivePath)} ]; then
  rm -f ${shellEscape(stagedArchivePath)}
fi
rm -rf "$EXTRACT_DIR"
chmod 700 ${shellEscape(plan.workspacePath)} ${shellEscape(plan.appPath)}`
  }

  return `rm -rf ${shellEscape(plan.appPath)} && git clone --depth 1 --branch ${shellEscape(source.repoRef)} ${shellEscape(source.repoUrl)} ${shellEscape(plan.appPath)} && chmod 700 ${shellEscape(plan.workspacePath)} ${shellEscape(plan.appPath)}`
}

function renderRemoteScript(plan, config) {
  const source = resolveDeploymentSource(config)
  const envFile = Buffer.from(renderEnvFile(plan.environment), 'utf8').toString('base64')
  const serviceFile = Buffer.from(renderSystemdService(plan, config), 'utf8').toString('base64')
  const multicaHomeConfig = Buffer.from(renderMulticaHomeConfig(plan), 'utf8').toString('base64')
  const authProfilesContent = renderAuthProfilesConfig(plan)
  const authProfilesB64 = authProfilesContent ? Buffer.from(authProfilesContent, 'utf8').toString('base64') : ''
  const routeFileContent =
    isRouterEnabled(config) && plan.consolePort !== null ? Buffer.from(renderRouterRouteFile(plan), 'utf8').toString('base64') : ''
  const routeFilePath =
    isRouterEnabled(config) && plan.consolePort !== null
      ? `${stripTrailingSlash(config.router.routesDir)}/${buildMulticaRouterRouteFileName(plan.instanceName)}`
      : ''

  const installCommand = config.multica.installCommand || 'true'
  const buildCommand = config.multica.buildCommand || 'true'

  return `set -euo pipefail
RUNTIME_USER=${shellEscape(plan.runtimeUser)}
SERVICE_NAME=${shellEscape(plan.serviceName)}
WORKSPACE_PATH=${shellEscape(plan.workspacePath)}
APP_PATH=${shellEscape(plan.appPath)}
ENV_PATH=${shellEscape(plan.envPath)}
CONSOLE_URL=${shellEscape(plan.consoleUrl)}
PUBLIC_ENDPOINT=${shellEscape(plan.publicEndpoint)}
CONSOLE_PORT=${shellEscape(plan.consolePort ?? '')}
INSTALL_COMMAND=${shellEscape(installCommand)}
BUILD_COMMAND=${shellEscape(buildCommand)}
ENV_B64=${shellEscape(envFile)}
SERVICE_B64=${shellEscape(serviceFile)}
MULTICA_HOME_CONFIG_B64=${shellEscape(multicaHomeConfig)}
AUTH_PROFILES_B64=${shellEscape(authProfilesB64)}
ROUTER_ROUTE_FILE_PATH=${shellEscape(routeFilePath)}
ROUTER_ROUTE_FILE_B64=${shellEscape(routeFileContent)}
DEPLOY_ENV_PREFIX='export CI=true npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false npm_config_loglevel=warn npm_config_jobs=1;'

if ! id "$RUNTIME_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$WORKSPACE_PATH" --shell /usr/sbin/nologin "$RUNTIME_USER"
fi

install -d -m 700 -o "$RUNTIME_USER" -g "$RUNTIME_USER" "$WORKSPACE_PATH"
install -d -m 700 -o "$RUNTIME_USER" -g "$RUNTIME_USER" "$WORKSPACE_PATH/.multica"
install -d -m 700 -o "$RUNTIME_USER" -g "$RUNTIME_USER" "$WORKSPACE_PATH/.multica/workspace"
install -d -m 700 -o "$RUNTIME_USER" -g "$RUNTIME_USER" "$WORKSPACE_PATH/.multica/agents"
install -d -m 700 -o "$RUNTIME_USER" -g "$RUNTIME_USER" "$WORKSPACE_PATH/.multica/agents/main"
install -d -m 700 -o "$RUNTIME_USER" -g "$RUNTIME_USER" "$WORKSPACE_PATH/.multica/agents/main/agent"
install -d -m 700 -o "$RUNTIME_USER" -g "$RUNTIME_USER" ${shellEscape(getMulticaStatePath(plan.workspacePath))}
install -d -m 700 -o "$RUNTIME_USER" -g "$RUNTIME_USER" ${shellEscape(`${getMulticaStatePath(plan.workspacePath)}/agents`)}
install -d -m 700 -o "$RUNTIME_USER" -g "$RUNTIME_USER" ${shellEscape(`${getMulticaStatePath(plan.workspacePath)}/agents/main`)}
install -d -m 700 -o "$RUNTIME_USER" -g "$RUNTIME_USER" ${shellEscape(`${getMulticaStatePath(plan.workspacePath)}/agents/main/agent`)}
install -d -m 700 -o "$RUNTIME_USER" -g "$RUNTIME_USER" "$WORKSPACE_PATH/.cache"
install -d -m 700 -o "$RUNTIME_USER" -g "$RUNTIME_USER" "$WORKSPACE_PATH/.npm"
install -d -m 700 -o "$RUNTIME_USER" -g "$RUNTIME_USER" "$WORKSPACE_PATH/.tmp"
${source.type === 'archive' && source.archivePath
  ? `ARCHIVE_SOURCE_PATH=${shellEscape(source.archivePath)}
ARCHIVE_STAGE_PATH=${shellEscape(`${plan.workspacePath}/.tmp/multica-template.tar.gz`)}
if [ ! -f "$ARCHIVE_SOURCE_PATH" ]; then
  echo "Multica template archive not found at $ARCHIVE_SOURCE_PATH" >&2
  exit 1
fi
install -m 600 -o "$RUNTIME_USER" -g "$RUNTIME_USER" "$ARCHIVE_SOURCE_PATH" "$ARCHIVE_STAGE_PATH"`
  : ''}
su -s /bin/bash "$RUNTIME_USER" -c ${shellEscape(`cd ${shellEscape(plan.workspacePath)} && ${renderAppSetupCommand(plan, source)}`)}
su -s /bin/bash "$RUNTIME_USER" -c "cd ${shellEscape(plan.workspacePath)} && chmod 700 ${shellEscape(plan.workspacePath)} ${shellEscape(plan.appPath)}"
su -s /bin/bash "$RUNTIME_USER" -c "cd ${shellEscape(plan.workspacePath)} && printf '%s' \\\"$ENV_B64\\\" | base64 -d > ${shellEscape(plan.envPath)} && chmod 600 ${shellEscape(plan.envPath)}"
su -s /bin/bash "$RUNTIME_USER" -c "cd ${shellEscape(plan.workspacePath)} && printf '%s' \\\"$MULTICA_HOME_CONFIG_B64\\\" | base64 -d > ${shellEscape(`${plan.workspacePath}/.multica/multica.json`)} && chmod 600 ${shellEscape(`${plan.workspacePath}/.multica/multica.json`)}"
if [ -n "$AUTH_PROFILES_B64" ]; then
  su -s /bin/bash "$RUNTIME_USER" -c "cd ${shellEscape(plan.workspacePath)} && printf '%s' \\\"$AUTH_PROFILES_B64\\\" | base64 -d > ${shellEscape(`${plan.workspacePath}/.multica/agents/main/agent/auth-profiles.json`)} && chmod 600 ${shellEscape(`${plan.workspacePath}/.multica/agents/main/agent/auth-profiles.json`)}"
  su -s /bin/bash "$RUNTIME_USER" -c "cd ${shellEscape(plan.workspacePath)} && printf '%s' \\\"$AUTH_PROFILES_B64\\\" | base64 -d > ${shellEscape(`${getMulticaStatePath(plan.workspacePath)}/agents/main/agent/auth-profiles.json`)} && chmod 600 ${shellEscape(`${getMulticaStatePath(plan.workspacePath)}/agents/main/agent/auth-profiles.json`)}"
fi
su -s /bin/bash "$RUNTIME_USER" -c "$DEPLOY_ENV_PREFIX cd ${shellEscape(plan.appPath)} && $INSTALL_COMMAND"
su -s /bin/bash "$RUNTIME_USER" -c "$DEPLOY_ENV_PREFIX cd ${shellEscape(plan.appPath)} && $BUILD_COMMAND"
printf '%s' "$SERVICE_B64" | base64 -d > "/etc/systemd/system/$SERVICE_NAME.service"
chmod 644 "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME" || systemctl start "$SERVICE_NAME"
ACTIVE_STATE=activating
for _ in $(seq 1 15); do
  ACTIVE_STATE=$(systemctl is-active "$SERVICE_NAME" || true)
  if [ "$ACTIVE_STATE" = "active" ] || [ "$ACTIVE_STATE" = "failed" ]; then
    break
  fi
  sleep 2
done
if [ "$ACTIVE_STATE" != "active" ]; then
  echo "GenericAgent service $SERVICE_NAME did not become active (state: $ACTIVE_STATE)." >&2
  journalctl -u "$SERVICE_NAME" -n 60 --no-pager >&2 || true
  exit 1
fi
if [ -n "$CONSOLE_PORT" ] && [ -z "$ROUTER_ROUTE_FILE_PATH" ]; then
  if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active firewalld >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port="$CONSOLE_PORT/tcp" >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
  elif command -v ufw >/dev/null 2>&1; then
    ufw allow "$CONSOLE_PORT/tcp" >/dev/null 2>&1 || true
  elif command -v iptables >/dev/null 2>&1; then
    iptables -C INPUT -p tcp --dport "$CONSOLE_PORT" -j ACCEPT >/dev/null 2>&1 ||
      iptables -I INPUT -p tcp --dport "$CONSOLE_PORT" -j ACCEPT >/dev/null 2>&1 || true
  fi
fi
if [ -n "$CONSOLE_PORT" ] && command -v curl >/dev/null 2>&1; then
  CONSOLE_READY=0
  for _ in $(seq 1 15); do
    if curl -fsS "http://127.0.0.1:$CONSOLE_PORT" >/dev/null 2>&1; then
      CONSOLE_READY=1
      break
    fi
    ACTIVE_STATE=$(systemctl is-active "$SERVICE_NAME" || true)
    if [ "$ACTIVE_STATE" = "failed" ]; then
      break
    fi
    sleep 2
  done
  if [ "$CONSOLE_READY" != "1" ]; then
    echo "GenericAgent console on port $CONSOLE_PORT did not become reachable." >&2
    journalctl -u "$SERVICE_NAME" -n 60 --no-pager >&2 || true
    exit 1
  fi
fi
if [ -n "$ROUTER_ROUTE_FILE_PATH" ]; then
  install -d -m 755 "$(dirname "$ROUTER_ROUTE_FILE_PATH")"
  printf '%s' "$ROUTER_ROUTE_FILE_B64" | base64 -d > "$ROUTER_ROUTE_FILE_PATH"
  chmod 644 "$ROUTER_ROUTE_FILE_PATH"
fi
export CONSOLE_URL PUBLIC_ENDPOINT
python3 - <<'PY'
import json
import os

print(json.dumps({
  'workspacePath': ${JSON.stringify(plan.workspacePath)},
  'consoleUrl': os.environ['CONSOLE_URL'],
  'publicEndpoint': os.environ['PUBLIC_ENDPOINT'],
  'targetServer': ${JSON.stringify(plan.targetServer)},
  'runtimeUser': ${JSON.stringify(plan.runtimeUser)},
  'serviceName': ${JSON.stringify(plan.serviceName)},
}))
PY
`
}

function renderRemoteUpgradeScript(plan, config) {
  const installCommand = config.multica.installCommand || 'true'
  const buildCommand = config.multica.buildCommand || 'true'
  const runtimeCommand = [
    `cd ${shellEscape(plan.appPath)}`,
    'git fetch --tags --force origin',
    `git checkout --force ${shellEscape(plan.targetVersion)}`,
    `git reset --hard ${shellEscape(plan.targetVersion)}`,
    'git clean -fd',
    installCommand,
    buildCommand,
  ].join(' && ')

  return `set -euo pipefail
RUNTIME_USER=${shellEscape(plan.runtimeUser)}
SERVICE_NAME=${shellEscape(plan.serviceName)}
APP_PATH=${shellEscape(plan.appPath)}
TARGET_VERSION=${shellEscape(plan.targetVersion)}

if [ ! -d "$APP_PATH/.git" ]; then
  echo "Multica app repository not found at $APP_PATH" >&2
  exit 1
fi

su -s /bin/bash "$RUNTIME_USER" -c ${shellEscape(runtimeCommand)}
systemctl restart "$SERVICE_NAME"
printf '%s\\n' ${shellEscape(
    JSON.stringify({
      workspacePath: plan.workspacePath,
      targetServer: plan.targetServer,
      runtimeUser: plan.runtimeUser,
      serviceName: plan.serviceName,
      multicaVersion: plan.targetVersion,
    }),
  )}
`
}

function renderRemoteStopScript(plan, config) {
  const routeFileContent =
    isRouterEnabled(config) && plan.consolePort !== null ? Buffer.from(renderRouterRouteFile(plan, 'stopped'), 'utf8').toString('base64') : ''
  const routeFilePath =
    isRouterEnabled(config) && plan.consolePort !== null
      ? `${stripTrailingSlash(config.router.routesDir)}/${buildMulticaRouterRouteFileName(plan.instanceName)}`
      : ''

  return `set -euo pipefail
SERVICE_NAME=${shellEscape(plan.serviceName)}
ROUTER_ROUTE_FILE_PATH=${shellEscape(routeFilePath)}
ROUTER_ROUTE_FILE_B64=${shellEscape(routeFileContent)}

if systemctl list-unit-files "$SERVICE_NAME.service" >/dev/null 2>&1; then
  systemctl stop "$SERVICE_NAME" || true
fi

if [ -n "$ROUTER_ROUTE_FILE_PATH" ]; then
  install -d -m 755 "$(dirname "$ROUTER_ROUTE_FILE_PATH")"
  printf '%s' "$ROUTER_ROUTE_FILE_B64" | base64 -d > "$ROUTER_ROUTE_FILE_PATH"
  chmod 644 "$ROUTER_ROUTE_FILE_PATH"
fi

printf '%s\\n' ${shellEscape(
    JSON.stringify({
      targetServer: plan.targetServer,
      serviceName: plan.serviceName,
      runtimeUser: plan.runtimeUser,
      workspacePath: plan.workspacePath,
      runtimeState: 'stopped',
    }),
  )}
`
}

function renderRemoteUninstallScript(plan, config) {
  const routeFilePath =
    isRouterEnabled(config) && plan.consolePort !== null
      ? `${stripTrailingSlash(config.router.routesDir)}/${buildMulticaRouterRouteFileName(plan.instanceName)}`
      : ''

  return `set -euo pipefail
RUNTIME_USER=${shellEscape(plan.runtimeUser)}
SERVICE_NAME=${shellEscape(plan.serviceName)}
WORKSPACE_PATH=${shellEscape(plan.workspacePath)}
CONSOLE_PORT=${shellEscape(plan.consolePort ?? '')}
ROUTER_ROUTE_FILE_PATH=${shellEscape(routeFilePath)}

systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
rm -f "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload

if [ -n "$CONSOLE_PORT" ] && [ -z "$ROUTER_ROUTE_FILE_PATH" ]; then
  if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active firewalld >/dev/null 2>&1; then
    firewall-cmd --permanent --remove-port="$CONSOLE_PORT/tcp" >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
  elif command -v ufw >/dev/null 2>&1; then
    ufw --force delete allow "$CONSOLE_PORT/tcp" >/dev/null 2>&1 || true
  elif command -v iptables >/dev/null 2>&1; then
    iptables -C INPUT -p tcp --dport "$CONSOLE_PORT" -j ACCEPT >/dev/null 2>&1 &&
      iptables -D INPUT -p tcp --dport "$CONSOLE_PORT" -j ACCEPT >/dev/null 2>&1 || true
  fi
fi

if [ -n "$ROUTER_ROUTE_FILE_PATH" ]; then
  rm -f "$ROUTER_ROUTE_FILE_PATH"
fi

rm -rf "$WORKSPACE_PATH"

if id "$RUNTIME_USER" >/dev/null 2>&1; then
  userdel "$RUNTIME_USER" >/dev/null 2>&1 || true
fi

printf '%s\\n' ${shellEscape(
    JSON.stringify({
      targetServer: plan.targetServer,
      serviceName: plan.serviceName,
      runtimeUser: plan.runtimeUser,
      workspacePath: plan.workspacePath,
      removed: true,
    }),
  )}
`
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetrySshCommand(error) {
  const message = String(error instanceof Error ? error.message : error ?? '').toLowerCase()
  return (
    message.includes('timed out while waiting for handshake') ||
    message.includes('etimedout') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('connection reset') ||
    message.includes('client-timeout')
  )
}

function runSshCommandOnce(config, script) {
  return new Promise((resolvePromise, reject) => {
    const client = new Client()
    let settled = false

    const settle = (callback) => {
      if (settled) return
      settled = true
      client.end()
      callback()
    }

    client
      .on('ready', () => {
        client.exec('bash -s', (error, stream) => {
          if (error) {
            settle(() => reject(error))
            return
          }

          let stdout = ''
          let stderr = ''
          let exitCode = null

          const complete = (code) => {
            const normalizedCode = code ?? exitCode ?? 0
            if (normalizedCode !== 0) {
              settle(() => reject(new Error(stderr.trim() || `Remote deployment exited with code ${normalizedCode}.`)))
              return
            }

            settle(() => resolvePromise({ stdout, stderr }))
          }

          stream.on('close', (code) => {
            complete(code)
          })
          stream.on('exit', (code) => {
            exitCode = code ?? 0
            setTimeout(() => {
              complete(exitCode)
            }, 250)
          })
          stream.on('data', (chunk) => {
            stdout += chunk.toString()
          })
          stream.stderr.on('data', (chunk) => {
            stderr += chunk.toString()
          })
          stream.on('error', (streamError) => {
            settle(() => reject(streamError))
          })
          stream.end(script)
        })
      })
      .on('error', (clientError) => {
        settle(() => reject(clientError))
      })
      .connect(buildSshConnectionOptions(config))
  })
}

async function runSshCommand(config, script) {
  const retryDelays = [0, 3000, 7000]
  let lastError = null

  for (const delayMs of retryDelays) {
    if (delayMs > 0) {
      await delay(delayMs)
    }

    try {
      return await runSshCommandOnce(config, script)
    } catch (error) {
      lastError = error
      if (!shouldRetrySshCommand(error) || delayMs === retryDelays[retryDelays.length - 1]) {
        throw error
      }
    }
  }

  throw lastError ?? new Error('SSH command failed.')
}

function isLocalDeploymentTarget(config) {
  if (String(process.env.MULTICA_DEPLOY_RUN_LOCAL ?? '').trim().toLowerCase() === 'true') {
    return true
  }

  const normalizedHost = String(config?.server?.host ?? '').trim().toLowerCase()
  if (!normalizedHost) {
    return false
  }

  const localHosts = new Set([
    '127.0.0.1',
    '::1',
    '[::1]',
    'localhost',
    hostname().toLowerCase(),
  ])

  for (const addressList of Object.values(networkInterfaces())) {
    for (const address of addressList ?? []) {
      if (typeof address?.address !== 'string' || !address.address.trim()) {
        continue
      }

      localHosts.add(address.address.trim().toLowerCase())
      if (address.family === 'IPv6') {
        localHosts.add(`[${address.address.trim().toLowerCase()}]`)
      }
    }
  }

  return localHosts.has(normalizedHost)
}

function runLocalCommand(script) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bash', ['-s'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if ((code ?? 0) !== 0) {
        reject(new Error(stderr.trim() || `Local deployment exited with code ${code}.`))
        return
      }

      resolvePromise({ stdout, stderr })
    })

    child.stdin.end(script)
  })
}

async function runConfiguredCommand(config, script) {
  if (isLocalDeploymentTarget(config)) {
    return await runLocalCommand(script)
  }

  return await runSshCommand(config, script)
}

function parseStructuredOutput(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index])
    } catch {}
  }

  return {}
}

async function runMockDeployment(config, context, plan) {
  const mockRoot = resolve(config.deployment.mockRootDir)
  const workspacePath = resolve(mockRoot, 'instances', context.instanceName)
  const appPath = join(workspacePath, 'app')
  const serviceDirectory = join(mockRoot, 'systemd')

  mkdirSync(appPath, { recursive: true })
  mkdirSync(join(workspacePath, 'state'), { recursive: true })
  mkdirSync(serviceDirectory, { recursive: true })
  writeFileSync(join(workspacePath, '.env'), renderEnvFile(plan.environment))
  writeFileSync(join(serviceDirectory, `${plan.serviceName}.service`), renderSystemdService(plan, config))
  writeFileSync(
    join(appPath, 'deployment.json'),
    JSON.stringify(
      {
        instanceName: context.instanceName,
        orderId: context.order.id,
        communicationToken: context.communicationToken,
        modelId: context.order.model_id,
        channelId: context.order.channel_id,
        runtimeUser: plan.runtimeUser,
        multicaVersion: config.multica.repoRef,
      },
      null,
      2,
    ),
  )

  return {
    targetServer: plan.targetServer,
    workspacePath: workspacePath.replace(/\\/g, '/'),
    consoleUrl: plan.consoleUrl,
    publicEndpoint: plan.publicEndpoint,
    consoleToken: plan.consoleToken,
    runtimeUser: plan.runtimeUser,
    serviceName: plan.serviceName,
    multicaVersion: config.multica.repoRef,
    runLogs: `Mock deployment completed for ${context.instanceName}.`,
  }
}

async function runMockUpgrade(config, context, plan) {
  const deploymentFilePath = join(resolve(config.deployment.mockRootDir), 'instances', context.instanceName, 'app', 'deployment.json')
  const current = JSON.parse(readFileSync(deploymentFilePath, 'utf8'))
  writeFileSync(
    deploymentFilePath,
    JSON.stringify(
      {
        ...current,
        multicaVersion: plan.targetVersion,
      },
      null,
      2,
    ),
  )

  return {
    targetServer: plan.targetServer,
    workspacePath: plan.workspacePath.replace(/\\/g, '/'),
    runtimeUser: plan.runtimeUser,
    serviceName: plan.serviceName,
    multicaVersion: plan.targetVersion,
    runLogs: `Mock upgrade completed for ${context.instanceName} -> ${plan.targetVersion}.`,
  }
}

async function runMockStop(config, context, plan) {
  const deploymentFilePath = join(resolve(config.deployment.mockRootDir), 'instances', context.instanceName, 'app', 'deployment.json')
  try {
    const current = JSON.parse(readFileSync(deploymentFilePath, 'utf8'))
    writeFileSync(
      deploymentFilePath,
      JSON.stringify(
        {
          ...current,
          runtimeState: 'stopped',
        },
        null,
        2,
      ),
    )
  } catch {}

  return {
    targetServer: plan.targetServer,
    workspacePath: plan.workspacePath.replace(/\\/g, '/'),
    runtimeUser: plan.runtimeUser,
    serviceName: plan.serviceName,
    runtimeState: 'stopped',
    runLogs: `Mock stop completed for ${context.instanceName}.`,
  }
}

async function runMockUninstall(config, context, plan) {
  const mockRoot = resolve(config.deployment.mockRootDir)
  rmSync(join(mockRoot, 'instances', context.instanceName), { recursive: true, force: true })
  rmSync(join(mockRoot, 'systemd', `${plan.serviceName}.service`), { force: true })

  return {
    targetServer: plan.targetServer,
    workspacePath: plan.workspacePath.replace(/\\/g, '/'),
    runtimeUser: plan.runtimeUser,
    serviceName: plan.serviceName,
    removed: true,
    runLogs: `Mock uninstall completed for ${context.instanceName}.`,
  }
}

function parseGithubRepository(repoUrl) {
  const normalizedUrl = repoUrl.trim().replace(/\.git$/, '')
  const sshMatch = normalizedUrl.match(/^git@github\.com:([^/]+)\/(.+)$/i)
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2],
    }
  }

  try {
    const parsed = new URL(normalizedUrl)
    if (parsed.hostname !== 'github.com') {
      return null
    }

    const [owner, repo] = parsed.pathname.replace(/^\/+/, '').split('/')
    if (!owner || !repo) {
      return null
    }

    return {
      owner,
      repo,
    }
  } catch {
    return null
  }
}

export async function listConfiguredMulticaVersions(config) {
  const repository = parseGithubRepository(config.multica.repoUrl)
  if (!repository) {
    throw new Error('Multica repository must be hosted on GitHub to browse available versions.')
  }

  const versions = []
  const seen = new Set()
  let page = 1

  while (page <= 10) {
    const response = await fetch(
      `https://api.github.com/repos/${repository.owner}/${repository.repo}/tags?per_page=100&page=${page}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Multica-Launch',
        },
      },
    )

    if (!response.ok) {
      throw new Error(`Unable to load Multica versions from GitHub (${response.status}).`)
    }

    const pageItems = await response.json()
    if (!Array.isArray(pageItems) || pageItems.length === 0) {
      break
    }

    for (const item of pageItems) {
      const name = typeof item?.name === 'string' ? item.name.trim() : ''
      if (!name || seen.has(name)) {
        continue
      }

      seen.add(name)
      versions.push({
        id: name,
        name,
      })
    }

    if (pageItems.length < 100) {
      break
    }

    page += 1
  }

  const configuredRef = config.multica.repoRef.trim()
  if (configuredRef && !seen.has(configuredRef)) {
    versions.unshift({
      id: configuredRef,
      name: configuredRef,
    })
  }

  return versions
}

export async function executeConfiguredDeployment(config, context) {
  const plan = buildPlan(config, context)

  if (config.provider === 'mock') {
    return await runMockDeployment(config, context, plan)
  }

  try {
    if (!hasDeploymentServerCredentials(config)) {
      throw new Error(
        'Deployment server credentials are missing in the active environment file. Set MULTICA_DEPLOY_ROOT_PASSWORD or MULTICA_AGENT_DEPLOY_PRIVATE_KEY_PATH.',
      )
    }

    const script = renderRemoteScript(plan, config)
    const result = await runConfiguredCommand(config, script)
    const parsed = parseStructuredOutput(result.stdout)

    return {
      targetServer: parsed.targetServer ?? plan.targetServer,
      workspacePath: parsed.workspacePath ?? plan.workspacePath,
      consoleUrl: parsed.consoleUrl ?? plan.consoleUrl,
      publicEndpoint: parsed.publicEndpoint ?? plan.publicEndpoint,
      consoleToken: plan.consoleToken,
      runtimeUser: parsed.runtimeUser ?? plan.runtimeUser,
      serviceName: parsed.serviceName ?? plan.serviceName,
      multicaVersion: parsed.multicaVersion ?? config.multica.repoRef,
      runLogs: `${result.stdout}${result.stderr}`.trim(),
    }
  } catch (error) {
    throw buildDeploymentFailureError(error, config, plan)
  }
}

export async function upgradeConfiguredDeployment(config, context) {
  const plan = buildUpgradePlan(config, context)

  if (!plan.runtimeUser || !plan.serviceName || !plan.workspacePath) {
    throw new Error('Multica instance is missing runtime deployment metadata.')
  }

  if (config.provider === 'mock') {
    return await runMockUpgrade(config, context, plan)
  }

  if (!hasDeploymentServerCredentials(config)) {
    throw new Error(
      'Deployment server credentials are missing in the active environment file. Set MULTICA_DEPLOY_ROOT_PASSWORD or MULTICA_AGENT_DEPLOY_PRIVATE_KEY_PATH.',
    )
  }

  const script = renderRemoteUpgradeScript(plan, config)
  let result

  try {
    result = await runConfiguredCommand(config, script)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}\n[deployment-debug] ${describeDeploymentConfig(config)}`)
  }

  const parsed = parseStructuredOutput(result.stdout)

  return {
    targetServer: parsed.targetServer ?? plan.targetServer,
    workspacePath: parsed.workspacePath ?? plan.workspacePath,
    runtimeUser: parsed.runtimeUser ?? plan.runtimeUser,
    serviceName: parsed.serviceName ?? plan.serviceName,
    multicaVersion: parsed.multicaVersion ?? plan.targetVersion,
    runLogs: `${result.stdout}${result.stderr}`.trim(),
  }
}

export async function stopConfiguredDeployment(config, context) {
  const plan = buildLifecyclePlan(config, context)

  if (!plan.runtimeUser || !plan.serviceName || !plan.workspacePath) {
    throw new Error('Multica instance is missing runtime deployment metadata.')
  }

  if (config.provider === 'mock') {
    return await runMockStop(config, context, plan)
  }

  if (!hasDeploymentServerCredentials(config)) {
    throw new Error(
      'Deployment server credentials are missing in the active environment file. Set MULTICA_DEPLOY_ROOT_PASSWORD or MULTICA_AGENT_DEPLOY_PRIVATE_KEY_PATH.',
    )
  }

  const script = renderRemoteStopScript(plan, config)
  const result = await runConfiguredCommand(config, script)
  const parsed = parseStructuredOutput(result.stdout)

  return {
    targetServer: parsed.targetServer ?? plan.targetServer,
    workspacePath: parsed.workspacePath ?? plan.workspacePath,
    runtimeUser: parsed.runtimeUser ?? plan.runtimeUser,
    serviceName: parsed.serviceName ?? plan.serviceName,
    runtimeState: parsed.runtimeState ?? 'stopped',
    runLogs: `${result.stdout}${result.stderr}`.trim(),
  }
}

export async function uninstallConfiguredDeployment(config, context) {
  const plan = buildLifecyclePlan(config, context)

  if (!plan.runtimeUser || !plan.serviceName || !plan.workspacePath) {
    throw new Error('Multica instance is missing runtime deployment metadata.')
  }

  if (config.provider === 'mock') {
    return await runMockUninstall(config, context, plan)
  }

  if (!hasDeploymentServerCredentials(config)) {
    throw new Error(
      'Deployment server credentials are missing in the active environment file. Set MULTICA_DEPLOY_ROOT_PASSWORD or MULTICA_AGENT_DEPLOY_PRIVATE_KEY_PATH.',
    )
  }

  const script = renderRemoteUninstallScript(plan, config)
  const result = await runConfiguredCommand(config, script)
  const parsed = parseStructuredOutput(result.stdout)

  return {
    targetServer: parsed.targetServer ?? plan.targetServer,
    workspacePath: parsed.workspacePath ?? plan.workspacePath,
    runtimeUser: parsed.runtimeUser ?? plan.runtimeUser,
    serviceName: parsed.serviceName ?? plan.serviceName,
    removed: parsed.removed ?? true,
    runLogs: `${result.stdout}${result.stderr}`.trim(),
  }
}

export function createDeploymentPlanPreview(config, context) {
  const plan = buildPlan(config, context)
  return {
    plan,
    service: renderSystemdService(plan, config),
    script: renderRemoteScript(plan, config),
  }
}
