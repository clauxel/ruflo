export function createExactRoute(method, pathname, handle) {
  return {
    method,
    match(requestMethod, requestPathname) {
      if (requestMethod !== method || requestPathname !== pathname) {
        return null
      }

      return { handle, params: [] }
    },
  }
}

export function createPatternRoute(method, pattern, handle) {
  return {
    method,
    match(requestMethod, requestPathname) {
      if (requestMethod !== method) {
        return null
      }

      const params = requestPathname.match(pattern)
      if (!params) {
        return null
      }

      return { handle, params }
    },
  }
}

export function matchRoute(routes, method, pathname) {
  for (const route of routes) {
    const match = route.match(method, pathname)
    if (match) {
      return match
    }
  }

  return null
}
