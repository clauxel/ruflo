import { createExactRoute, createPatternRoute } from './route-utils.mjs'

export function createAdminRoutes(deps) {
  const {
    requireAdminUser,
    sendJson,
    listUsersStatement,
    serializeUser,
    serializeOrder,
    readJsonBody,
    createUserRecord,
    findUserByIdStatement,
    findOrderByIdStatement,
    sanitizeName,
    validateName,
    countRemainingAdminsStatement,
    updateUserStatement,
    uninstallMulticaInstance,
    nowIso,
    deleteUserSessionsStatement,
    HttpError,
  } = deps

  return [
    createExactRoute('GET', '/api/admin/users', async ({ request, response }) => {
      await requireAdminUser(request)

      sendJson(response, 200, {
        users: (await listUsersStatement.all()).map(serializeUser),
      })
    }),
    createExactRoute('POST', '/api/admin/users', async ({ request, response }) => {
      await requireAdminUser(request)

      const body = await readJsonBody(request)
      const role = body.role === 'admin' ? 'admin' : 'operator'
      const user = await createUserRecord({
        email: body.email ?? '',
        name: body.name ?? '',
        password: String(body.password ?? ''),
        role,
      })

      sendJson(response, 201, {
        message: 'User created successfully.',
        user: serializeUser(user),
      })
    }),
    createPatternRoute('PATCH', /^\/api\/admin\/users\/([a-f0-9]+)$/, async ({ request, response, params }) => {
      const context = await requireAdminUser(request)
      const body = await readJsonBody(request)
      const targetUserId = params[1]
      const user = await findUserByIdStatement.get(targetUserId)

      if (!user) {
        throw new HttpError(404, 'User not found.')
      }

      if (targetUserId === context.user.id) {
        throw new HttpError(400, 'Update your own admin account through a dedicated profile flow.')
      }

      const name = sanitizeName(String(body.name ?? user.name))
      const role = body.role === 'admin' ? 'admin' : 'operator'
      const status = body.status === 'disabled' ? 'disabled' : 'active'

      validateName(name)

      if ((role !== user.role || status !== user.status) && user.role === 'admin' && user.status === 'active') {
        const remainingAdmins = Number((await countRemainingAdminsStatement.get(user.id)).count)
        if (remainingAdmins === 0) {
          throw new HttpError(400, 'At least one active admin must remain.')
        }
      }

      await updateUserStatement.run(name, role, status, nowIso(), user.id)

      if (status === 'disabled') {
        await deleteUserSessionsStatement.run(user.id)
      }

      sendJson(response, 200, {
        message: 'User updated successfully.',
        user: serializeUser(await findUserByIdStatement.get(user.id)),
      })
    }),
    createPatternRoute('POST', /^\/api\/admin\/orders\/([a-f0-9]+)\/multica-delete$/, async ({ request, response, params }) => {
      const context = await requireAdminUser(request)
      const order = await findOrderByIdStatement.get(params[1])

      if (!order) {
        throw new HttpError(404, 'Order not found.')
      }

      const updatedOrder = await uninstallMulticaInstance(order)
      sendJson(response, 200, {
        message: 'GenericAgent workspace deleted successfully.',
        order: await serializeOrder(updatedOrder, { viewerContext: context }),
      })
    }),
  ]
}
