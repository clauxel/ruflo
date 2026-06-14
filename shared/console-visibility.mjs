function getIncludedDeployments(value, usedCount = 0) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  return Math.max(usedCount, 1)
}

function getRemainingDeployments(remaining, included, usedCount = 0) {
  if (typeof remaining === 'number' && Number.isFinite(remaining) && remaining >= 0) {
    return remaining
  }

  return Math.max(included - usedCount, 0)
}

function isDeploymentPending(status) {
  return status === 'queued' || status === 'provisioning'
}

function isDeploymentRunning(status) {
  return status === 'provisioning'
}

export function getRedeployManagementState(row) {
  const latestDeploymentStatus = row.order.deployment?.status ?? row.order.deploymentStatus
  const latestDeploymentInProgress = isDeploymentPending(latestDeploymentStatus)
  const rowDeploymentStatus = row.deployment?.status ?? null
  const rowDeploymentInProgress = isDeploymentPending(rowDeploymentStatus)
  const rowDeploymentRunning = isDeploymentRunning(rowDeploymentStatus)
  const rowDeploymentFailed = rowDeploymentStatus === 'failed'
  const visible =
    Boolean(row.deployment) &&
    (rowDeploymentInProgress || (rowDeploymentFailed && (row.order.canTriggerDeployment || latestDeploymentInProgress)))
  const disabled = visible && (rowDeploymentInProgress || latestDeploymentInProgress)

  return {
    visible,
    disabled,
    label: rowDeploymentStatus === 'queued' ? 'Queued for provisioning' : rowDeploymentRunning ? 'Deployment running...' : 'Deploy',
  }
}

export function canMulticaManagementConsole(row) {
  const multicaConsoleUrl = row.claw?.consoleUrl ?? row.deployment?.consoleUrl ?? null
  const clawRuntimeAvailable =
    Boolean(row.claw) && row.claw?.status === 'running' && row.claw?.runtimeState !== 'stopped'
  const deploymentReady = row.deployment?.status === 'deployed'

  return Boolean(multicaConsoleUrl) && (clawRuntimeAvailable || deploymentReady)
}

export function buildMulticaManagementRows(consoleData) {
  return consoleData.orders.flatMap((order) => {
    const claws = Array.from(
      new Map(
        [...consoleData.claws.filter((item) => item.orderId === order.id), order.instance].filter(Boolean).map((item) => [item.id, item]),
      ).values(),
    ).sort((left, right) => right.sequenceNumber - left.sequenceNumber)
    const deployments = Array.from(
      new Map([...order.deployments, order.deployment].filter(Boolean).map((item) => [item.id, item])).values(),
    ).sort((left, right) => right.sequenceNumber - left.sequenceNumber)
    const matchedAgentIds = new Set()
    const rows = deployments.map((deployment) => {
      const claw = claws.find((item) => item.deploymentId === deployment.id) ?? null
      if (claw) {
        matchedAgentIds.add(claw.id)
      }

      return {
        id: `deployment:${deployment.id}`,
        order,
        deployment,
        claw,
        isLatestForOrder: order.deployment?.id === deployment.id,
      }
    })

    for (const claw of claws) {
      if (matchedAgentIds.has(claw.id)) {
        continue
      }

      rows.push({
        id: `claw:${claw.id}`,
        order,
        deployment: null,
        claw,
        isLatestForOrder: order.instance?.id === claw.id && !order.deployment,
      })
    }

    return rows
  })
}

export function canRedeployManagementRow(row) {
  return getRedeployManagementState(row).visible
}

export function buildConsoleMetrics(consoleData) {
  const paidOrders = consoleData.orders.filter((order) => order.paymentStatus === 'paid')

  return {
    trackedOrders: consoleData.orders.length,
    unpaidOrders: consoleData.orders.filter((order) => order.paymentStatus === 'pending').length,
    paidOrders: paidOrders.length,
    liveAgents: consoleData.claws.filter((claw) => claw.status === 'running').length,
    createdAgents: consoleData.claws.length,
    totalDeploymentsIncluded: paidOrders.reduce(
      (sum, order) => sum + getIncludedDeployments(order.includedDeployments),
      0,
    ),
    availableTriggers: paidOrders.reduce(
      (sum, order) =>
        sum +
        getRemainingDeployments(
          order.deploymentsRemaining,
          getIncludedDeployments(order.includedDeployments),
          0,
        ),
      0,
    ),
  }
}

export function buildOrdersReadyForDeployment(consoleData) {
  return consoleData.orders.filter((order) => order.paymentStatus === 'paid' && order.canTriggerDeployment)
}

export function buildPendingPaymentOrders(consoleData) {
  return consoleData.orders
    .filter((order) => order.paymentStatus === 'pending')
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
}

export function canPayForOrder(order) {
  return order.paymentStatus !== 'paid'
}
