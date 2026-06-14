import { resolveApiUrl } from './api-base'

declare global {
  interface Window {
    paypal?: {
      Buttons: (options: Record<string, unknown>) => {
        render: (container: HTMLElement) => Promise<void>
        close?: () => Promise<void> | void
        isEligible?: () => boolean
      }
    }
  }
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error. Please try again.'
}

export function getGuestTokenFromPath(path: string) {
  const absoluteUrl = new URL(path, window.location.origin)
  return absoluteUrl.searchParams.get('guest_token')
}

const hostedCheckoutWindowName = 'ruflo-hosted-checkout'

function getHostedCheckoutWindowFeatures() {
  const viewportWidth = window.outerWidth || window.screen.availWidth || 1200
  const viewportHeight = window.outerHeight || window.screen.availHeight || 900
  const width = Math.min(620, Math.max(520, Math.floor(viewportWidth * 0.48)))
  const height = Math.min(780, Math.max(640, Math.floor(viewportHeight * 0.86)))
  const originLeft = window.screenX || window.screenLeft || 0
  const originTop = window.screenY || window.screenTop || 0
  const left = Math.max(0, Math.round(originLeft + (viewportWidth - width) / 2))
  const top = Math.max(0, Math.round(originTop + (viewportHeight - height) / 2))

  return `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
}

export function openPendingHostedCheckout() {
  const popup = window.open('about:blank', hostedCheckoutWindowName, getHostedCheckoutWindowFeatures())

  if (!popup) {
    return null
  }

  try {
    popup.document.write(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>Preparing Ruflo checkout</title>
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              background: #07120f;
              color: #e8fff5;
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            }
            main {
              width: min(360px, calc(100vw - 48px));
              padding: 28px;
              border: 1px solid rgba(170, 255, 88, 0.24);
              border-radius: 24px;
              background: rgba(12, 24, 20, 0.82);
              box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
            }
            p { margin: 10px 0 0; color: #a9c7ba; line-height: 1.55; }
          </style>
        </head>
        <body>
          <main>
            <strong>Preparing secure checkout...</strong>
            <p>Keep this window open. Ruflo AI is connecting to the payment provider.</p>
          </main>
        </body>
      </html>
    `)
    popup.document.close()
  } catch {
    // Some browsers block document access even for about:blank. The popup can still be reused.
  }

  popup.focus()
  return popup
}

export function openHostedCheckout(url: string) {
  const popup = window.open(
    url,
    hostedCheckoutWindowName,
    getHostedCheckoutWindowFeatures(),
  )

  if (!popup) {
    return null
  }

  popup.focus()
  return popup
}

export async function apiRequest<T>(path: string, init: RequestInit & { guestToken?: string } = {}) {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const guestToken = init.guestToken ?? new URLSearchParams(window.location.search).get('guest_token')
  if (guestToken && !headers.has('x-multica-guest-token')) {
    headers.set('x-multica-guest-token', guestToken)
  }

  const response = await fetch(resolveApiUrl(path), {
    ...init,
    headers,
    credentials: 'include',
  })

  const rawText = await response.text()
  const payload = rawText ? JSON.parse(rawText) : null

  if (!response.ok) {
    throw new Error(payload?.message ?? 'Request failed.')
  }

  return payload as T
}

export async function loadPayPalSdk(clientId: string, currency: string) {
  const scriptId = 'paypal-sdk-script'
  const normalizedCurrency = currency.toUpperCase()
  const src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(normalizedCurrency)}&intent=capture&components=buttons`
  const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null

  if (
    existingScript &&
    existingScript.dataset.clientId === clientId &&
    existingScript.dataset.currency === normalizedCurrency &&
    window.paypal
  ) {
    return window.paypal
  }

  if (existingScript) {
    existingScript.remove()
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.id = scriptId
    script.src = src
    script.async = true
    script.dataset.clientId = clientId
    script.dataset.currency = normalizedCurrency
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('PayPal SDK failed to load.'))
    document.head.appendChild(script)
  })

  if (!window.paypal) {
    throw new Error('PayPal SDK is unavailable.')
  }

  return window.paypal
}
