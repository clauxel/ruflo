import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

const legacyConfigFileName = 'multica.config.json'
const preferredConfigFileName = 'genericagent.config.json'

function isGenericAgentConfigPath(configPath) {
  const filename = basename(String(configPath ?? '')).trim().toLowerCase()
  return filename === preferredConfigFileName
}

function getAgentSectionEntry(rawConfig, configPath = '') {
  if (rawConfig?.genericagent && typeof rawConfig.genericagent === 'object') {
    return ['genericagent', rawConfig.genericagent]
  }

  if (rawConfig?.multica && typeof rawConfig.multica === 'object') {
    return ['multica', rawConfig.multica]
  }

  return [isGenericAgentConfigPath(configPath) ? 'genericagent' : 'multica', null]
}

function toPosixPath(value) {
  return value.replace(/\\/g, '/')
}

function firstDefined(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

export function resolveDefaultDeploymentConfigPath(projectRoot, environment = process.env) {
  const explicitConfigPath = firstDefined(
    environment.GENERICAGENT_CONFIG_PATH,
    environment.MULTICA_CONFIG_PATH,
  )

  if (explicitConfigPath) {
    return isAbsolute(explicitConfigPath) ? explicitConfigPath : resolve(projectRoot, explicitConfigPath)
  }

  const preferredPath = resolve(projectRoot, preferredConfigFileName)
  if (existsSync(preferredPath)) {
    return preferredPath
  }

  return resolve(projectRoot, legacyConfigFileName)
}

function normalizeConfiguredValue(value) {
  if (typeof value !== 'string') {
    return ''
  }

  let normalized = value.trim()

  while (
    normalized.length >= 2 &&
    ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")))
  ) {
    normalized = normalized.slice(1, -1).trim()
  }

  return normalized
}

function normalizePrivateKeyValue(value) {
  const normalized = normalizeConfiguredValue(value)
  if (!normalized) {
    return ''
  }

  return normalized.replace(/\\n/g, '\n')
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function buildDefaultConfig(configPath) {
  const useGenericAgentBranding = isGenericAgentConfigPath(configPath)
  const agentSectionKey = useGenericAgentBranding ? 'genericagent' : 'multica'
  const targetServer = useGenericAgentBranding ? 'genericagent-runtime-1' : 'mock-multica-server'
  const consoleBaseUrl = useGenericAgentBranding
    ? 'https://console.genericagent.local'
    : 'https://console.multica.local'
  const publicBaseUrl = useGenericAgentBranding
    ? 'https://genericagent.local'
    : 'https://multica.local'

  return {
    deployment: {
      provider: 'mock',
      targetServer,
      consoleBaseUrl,
      publicBaseUrl,
      consolePortBase: 58000,
      consolePortRange: 4000,
      mockRootDir: './data/mock-remote',
    },
    [agentSectionKey]: {
      repoUrl: 'https://github.com/multica/multica.git',
      repoRef: 'main',
      sourceType: 'archive',
      archiveUrl: '',
      archivePath: '/data/multica/templates/multica-template.tar.gz',
      baseDir: '/data/multica',
      servicePrefix: 'multica',
      runtimeUserPrefix: 'mca',
      installCommand: 'npm install --no-audit --no-fund',
      buildCommand: 'npm run build',
      startCommand: 'npm run start',
      tokenEnvName: 'COMMUNICATION_TOKEN',
      modelEnvName: 'MULTICA_MODEL_ID',
      channelEnvName: 'MULTICA_CHANNEL_ID',
      planEnvName: 'MULTICA_PLAN_ID',
    },
  }
}

function resolveConfigPath(configPath) {
  return resolve(configPath)
}

function resolveFileValue(configDirectory, value, fallback) {
  const source = typeof value === 'string' && value.trim() ? value.trim() : fallback
  if (!source) {
    return fallback
  }

  return isAbsolute(source) ? source : resolve(configDirectory, source)
}

function resolveServerPrivateKey(configDirectory) {
  const inlinePrivateKey = firstDefined(
    process.env.MULTICA_DEPLOY_PRIVATE_KEY,
    process.env.MULTICA_SERVER_PRIVATE_KEY,
  )
  if (inlinePrivateKey) {
    return {
      privateKey: normalizePrivateKeyValue(inlinePrivateKey),
      privateKeyPath: '',
      privateKeyPassphrase: firstDefined(
        process.env.MULTICA_DEPLOY_PRIVATE_KEY_PASSPHRASE,
        process.env.MULTICA_SERVER_PRIVATE_KEY_PASSPHRASE,
      ),
    }
  }

  const configuredPrivateKeyPath = firstDefined(
    process.env.MULTICA_AGENT_DEPLOY_PRIVATE_KEY_PATH,
    process.env.MULTICA_DEPLOY_PRIVATE_KEY_PATH,
    process.env.MULTICA_SERVER_PRIVATE_KEY_PATH,
  )
  if (!configuredPrivateKeyPath) {
    return {
      privateKey: '',
      privateKeyPath: '',
      privateKeyPassphrase: '',
    }
  }

  const resolvedPrivateKeyPath = resolveFileValue(configDirectory, configuredPrivateKeyPath, '')
  if (!resolvedPrivateKeyPath || !existsSync(resolvedPrivateKeyPath)) {
    return {
      privateKey: '',
      privateKeyPath: resolvedPrivateKeyPath,
      privateKeyPassphrase: '',
    }
  }

  return {
    privateKey: readFileSync(resolvedPrivateKeyPath, 'utf8'),
    privateKeyPath: resolvedPrivateKeyPath,
    privateKeyPassphrase: firstDefined(
      process.env.MULTICA_DEPLOY_PRIVATE_KEY_PASSPHRASE,
      process.env.MULTICA_SERVER_PRIVATE_KEY_PASSPHRASE,
    ),
  }
}

function sanitizeRawConfig(rawConfig, configPath = '') {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return {
      rawConfig,
      changed: false,
    }
  }

  const [agentSectionKey, agentConfig] = getAgentSectionEntry(rawConfig, configPath)

  if (!agentConfig) {
    return {
      rawConfig,
      changed: false,
    }
  }

  const defaultArchivePath = '/data/multica/templates/multica-template.tar.gz'
  const normalizedRepoUrl = normalizeConfiguredValue(agentConfig.repoUrl) || 'https://github.com/multica/multica.git'
  const normalizedRepoRef = normalizeConfiguredValue(agentConfig.repoRef) || 'main'
  const normalizedSourceType = agentConfig.sourceType === 'git' ? 'git' : 'archive'
  const normalizedArchiveUrl = normalizeConfiguredValue(agentConfig.archiveUrl)
  const normalizedArchivePath =
    normalizeConfiguredValue(agentConfig.archivePath) ||
    (normalizedSourceType === 'archive' && !normalizedArchiveUrl ? defaultArchivePath : '')
  const repoUrlChanged = typeof agentConfig.repoUrl === 'string' && agentConfig.repoUrl !== normalizedRepoUrl
  const repoRefChanged = typeof agentConfig.repoRef === 'string' && agentConfig.repoRef !== normalizedRepoRef
  const sourceTypeChanged = typeof agentConfig.sourceType === 'string' && agentConfig.sourceType !== normalizedSourceType
  const archiveUrlChanged = typeof agentConfig.archiveUrl === 'string' && agentConfig.archiveUrl !== normalizedArchiveUrl
  const archivePathChanged = typeof agentConfig.archivePath === 'string' && agentConfig.archivePath !== normalizedArchivePath

  if (!repoUrlChanged && !repoRefChanged && !sourceTypeChanged && !archiveUrlChanged && !archivePathChanged) {
    return {
      rawConfig,
      changed: false,
    }
  }

  return {
    rawConfig: {
      ...rawConfig,
      [agentSectionKey]: {
        ...agentConfig,
        repoUrl: normalizedRepoUrl,
        repoRef: normalizedRepoRef,
        sourceType: normalizedSourceType,
        archiveUrl: normalizedArchiveUrl,
        archivePath: normalizedArchivePath,
      },
    },
    changed: true,
  }
}

function ensureConfigFile(configPath) {
  if (existsSync(configPath)) {
    return
  }

  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(
    configPath,
    JSON.stringify(buildDefaultConfig(configPath), null, 2),
  )
}

function readRawConfig(configPath) {
  const resolvedConfigPath = resolveConfigPath(configPath)
  ensureConfigFile(resolvedConfigPath)
  const parsedConfig = JSON.parse(readFileSync(resolvedConfigPath, 'utf8'))
  const { rawConfig, changed } = sanitizeRawConfig(parsedConfig, resolvedConfigPath)

  if (changed) {
    writeFileSync(resolvedConfigPath, JSON.stringify(rawConfig, null, 2))
  }

  return {
    configPath: resolvedConfigPath,
    rawConfig,
  }
}

function normalizeConfig(configPath, rawConfig, encryptionSecret) {
  const configDirectory = dirname(configPath)
  const [agentSectionKey, agentConfig] = getAgentSectionEntry(rawConfig, configPath)
  const useGenericAgentBranding = agentSectionKey === 'genericagent' || isGenericAgentConfigPath(configPath)
  const defaultArchivePath = '/data/multica/templates/multica-template.tar.gz'
  const provider = rawConfig?.deployment?.provider === 'ssh' ? 'ssh' : 'mock'
  const configuredRepoUrl = normalizeConfiguredValue(agentConfig?.repoUrl)
  const configuredRepoRef = normalizeConfiguredValue(agentConfig?.repoRef)
  const configuredSourceType = agentConfig?.sourceType === 'git' ? 'git' : 'archive'
  const configuredArchiveUrl = normalizeConfiguredValue(agentConfig?.archiveUrl)
  const configuredArchivePath =
    normalizeConfiguredValue(agentConfig?.archivePath) ||
    (configuredSourceType === 'archive' && !configuredArchiveUrl ? defaultArchivePath : '')
  const serverHost = firstDefined(
    process.env.MULTICA_DEPLOY_HOST,
    process.env.MULTICA_SERVER_IP,
    process.env.MULTICA_SERVER_HOST,
  ) || '127.0.0.1'
  const serverPort = parsePositiveInteger(
    firstDefined(process.env.MULTICA_DEPLOY_PORT),
    22,
  )
  const serverUsername = firstDefined(
    process.env.MULTICA_DEPLOY_USERNAME,
    process.env.MULTICA_SERVER_USERNAME,
  ) || 'root'
  const routerBaseUrl = firstDefined(
    process.env.MULTICA_ROUTER_BASE_URL,
    rawConfig?.deployment?.routerBaseUrl,
  )
  const routerRoutesDir = resolveFileValue(
    configDirectory,
    firstDefined(
      process.env.MULTICA_ROUTER_ROUTES_DIR,
      rawConfig?.deployment?.routerRoutesDir,
    ),
    '/data/multica/router/routes',
  )
  const consolePortBase = parsePositiveInteger(
    process.env.MULTICA_CONSOLE_PORT_BASE ?? rawConfig?.deployment?.consolePortBase,
    58000,
  )
  const consolePortRange = parsePositiveInteger(
    process.env.MULTICA_CONSOLE_PORT_RANGE ?? rawConfig?.deployment?.consolePortRange,
    4000,
  )
  const serverPassword = firstDefined(
    process.env.MULTICA_DEPLOY_ROOT_PASSWORD,
    process.env.MULTICA_ROOT_PASSWORD,
    process.env.MULTICA_DEPLOY_PASSWORD,
  )
  const {
    privateKey: serverPrivateKey,
    privateKeyPath: serverPrivateKeyPath,
    privateKeyPassphrase: serverPrivateKeyPassphrase,
  } = resolveServerPrivateKey(configDirectory)
  const mockRootDir = resolveFileValue(configDirectory, rawConfig?.deployment?.mockRootDir, join(configDirectory, 'data', 'mock-remote'))

  return {
    path: configPath,
    provider,
    deployment: {
      provider,
      targetServer:
        typeof rawConfig?.deployment?.targetServer === 'string' && rawConfig.deployment.targetServer.trim()
          ? rawConfig.deployment.targetServer.trim()
          : provider === 'ssh'
            ? serverHost || 'ssh-multica-server'
            : useGenericAgentBranding
              ? 'genericagent-runtime-1'
              : 'mock-multica-server',
      consoleBaseUrl:
        typeof rawConfig?.deployment?.consoleBaseUrl === 'string' && rawConfig.deployment.consoleBaseUrl.trim()
          ? rawConfig.deployment.consoleBaseUrl.trim()
          : useGenericAgentBranding
            ? 'https://console.genericagent.local'
            : 'https://console.multica.local',
      publicBaseUrl:
        typeof rawConfig?.deployment?.publicBaseUrl === 'string' && rawConfig.deployment.publicBaseUrl.trim()
          ? rawConfig.deployment.publicBaseUrl.trim()
          : useGenericAgentBranding
            ? 'https://genericagent.local'
            : 'https://multica.local',
      consolePortBase,
      consolePortRange,
      mockRootDir,
    },
    server: {
      host: serverHost,
      port: serverPort,
      username: serverUsername,
      password: serverPassword,
      privateKey: serverPrivateKey,
      privateKeyPath: serverPrivateKeyPath,
      privateKeyPassphrase: serverPrivateKeyPassphrase,
    },
    router: {
      baseUrl: routerBaseUrl,
      routesDir: routerRoutesDir,
    },
    multica: {
      sourceType: configuredSourceType,
      archiveUrl: configuredArchiveUrl,
      archivePath: configuredArchivePath,
      repoUrl: configuredRepoUrl || 'https://github.com/multica/multica.git',
      repoRef: configuredRepoRef || 'main',
      baseDir:
        typeof agentConfig?.baseDir === 'string' && agentConfig.baseDir.trim()
          ? toPosixPath(agentConfig.baseDir.trim())
          : '/srv/multica',
      servicePrefix:
        typeof agentConfig?.servicePrefix === 'string' && agentConfig.servicePrefix.trim()
          ? agentConfig.servicePrefix.trim()
          : 'multica',
      runtimeUserPrefix:
        typeof agentConfig?.runtimeUserPrefix === 'string' && agentConfig.runtimeUserPrefix.trim()
          ? agentConfig.runtimeUserPrefix.trim()
          : 'mca',
      installCommand:
        typeof agentConfig?.installCommand === 'string'
          ? agentConfig.installCommand.trim()
          : 'npm install --no-audit --no-fund',
      buildCommand:
        typeof agentConfig?.buildCommand === 'string'
          ? agentConfig.buildCommand.trim()
          : 'npm run build',
      startCommand:
        typeof agentConfig?.startCommand === 'string'
          ? agentConfig.startCommand.trim()
          : 'npm run start',
      tokenEnvName:
        typeof agentConfig?.tokenEnvName === 'string' && agentConfig.tokenEnvName.trim()
          ? agentConfig.tokenEnvName.trim()
          : 'COMMUNICATION_TOKEN',
      modelEnvName:
        typeof agentConfig?.modelEnvName === 'string' && agentConfig.modelEnvName.trim()
          ? agentConfig.modelEnvName.trim()
          : 'MULTICA_MODEL_ID',
      channelEnvName:
        typeof agentConfig?.channelEnvName === 'string' && agentConfig.channelEnvName.trim()
          ? agentConfig.channelEnvName.trim()
          : 'MULTICA_CHANNEL_ID',
      planEnvName:
        typeof agentConfig?.planEnvName === 'string' && agentConfig.planEnvName.trim()
          ? agentConfig.planEnvName.trim()
          : 'MULTICA_PLAN_ID',
    },
  }
}

export function loadDeploymentConfig({
  configPath,
  encryptionSecret,
}) {
  const { configPath: resolvedConfigPath, rawConfig } = readRawConfig(configPath)
  return normalizeConfig(resolvedConfigPath, rawConfig, encryptionSecret)
}

export function readConfiguredMulticaRepoRef(configPath) {
  const { rawConfig } = readRawConfig(configPath)
  return normalizeConfiguredValue(getAgentSectionEntry(rawConfig, configPath)[1]?.repoRef) || 'main'
}
