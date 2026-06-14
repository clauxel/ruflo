import type { AgentInstanceRecord, ConsoleData, DeploymentRecord, OrderRecord } from '../src/app-types'

export type MulticaManagementRow = {
  id: string
  order: OrderRecord
  deployment: DeploymentRecord | null
  claw: AgentInstanceRecord | null
  isLatestForOrder: boolean
}

export type ConsoleMetrics = {
  trackedOrders: number
  unpaidOrders: number
  paidOrders: number
  liveAgents: number
  createdAgents: number
  totalDeploymentsIncluded: number
  availableTriggers: number
}

export type RedeployManagementState = {
  visible: boolean
  disabled: boolean
  label: string
}

export function buildMulticaManagementRows(consoleData: ConsoleData): MulticaManagementRow[]
export function getRedeployManagementState(row: MulticaManagementRow): RedeployManagementState
export function canMulticaManagementConsole(row: MulticaManagementRow): boolean
export function canRedeployManagementRow(row: MulticaManagementRow): boolean
export function buildConsoleMetrics(consoleData: ConsoleData): ConsoleMetrics
export function buildOrdersReadyForDeployment(consoleData: ConsoleData): OrderRecord[]
export function buildPendingPaymentOrders(consoleData: ConsoleData): OrderRecord[]
export function canPayForOrder(order: OrderRecord): boolean
