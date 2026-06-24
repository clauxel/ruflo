(() => {
  if (window.__polarCheckoutFallbackInstalled) return;
  window.__polarCheckoutFallbackInstalled = true;
  const POLAR_CHECKOUT_URL = 'https://buy.polar.sh/polar_cl_v0pIgEl6B8RotVGu1kG9QXClW2sPOqdlxe2VV4WXhhI';

  function centeredFeatures(width, height) {
    const screenRef = window.screen || { availWidth: width, availHeight: height };
    const popupWidth = Math.min(width, Math.max(360, (screenRef.availWidth || width) - 80));
    const popupHeight = Math.min(height, Math.max(520, (screenRef.availHeight || height) - 80));
    const left = Math.max(0, Math.round(((screenRef.availWidth || popupWidth) - popupWidth) / 2));
    const top = Math.max(0, Math.round(((screenRef.availHeight || popupHeight) - popupHeight) / 2));
    return 'popup=yes,width=' + popupWidth + ',height=' + popupHeight + ',left=' + left + ',top=' + top + ',noopener=no,noreferrer=no';
  }

  function ensureUi() {
    if (!document.getElementById('polar-checkout-fallback-style')) {
      const style = document.createElement('style');
      style.id = 'polar-checkout-fallback-style';
      style.textContent = 'body.polar-checkout-open > *:not(.polar-checkout-fallback-overlay){filter:blur(6px);transition:filter .18s ease} .polar-checkout-fallback-overlay{position:fixed;inset:0;z-index:2147483646;display:none;place-items:center;background:rgba(10,16,28,.38);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)} body.polar-checkout-open .polar-checkout-fallback-overlay{display:grid}.polar-checkout-fallback-card{width:min(360px,calc(100vw - 40px));border:1px solid rgba(255,255,255,.22);border-radius:8px;background:rgba(10,16,28,.88);box-shadow:0 24px 80px rgba(0,0,0,.36);color:#fff;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:20px}.polar-checkout-fallback-card h2{font-size:18px;line-height:1.2;margin:0 0 8px}.polar-checkout-fallback-card p{font-size:14px;line-height:1.5;color:rgba(255,255,255,.78);margin:0 0 16px}.polar-checkout-fallback-actions{display:flex;gap:10px;flex-wrap:wrap}.polar-checkout-fallback-actions button{border:0;border-radius:8px;padding:10px 14px;font:600 14px/1 Inter,ui-sans-serif,system-ui;background:#fff;color:#101828;cursor:pointer}.polar-checkout-fallback-actions button.secondary{background:rgba(255,255,255,.12);color:#fff}.polar-checkout-floating-button{position:fixed;right:18px;bottom:18px;z-index:2147483645;width:44px;height:44px;border:0;border-radius:999px;background:#111827;color:#fff;box-shadow:0 12px 32px rgba(0,0,0,.28);font:700 20px/1 Inter,ui-sans-serif,system-ui;cursor:pointer}.polar-checkout-floating-button:focus-visible{outline:3px solid rgba(56,189,248,.7);outline-offset:3px}';
      style.textContent += '.polar-checkout-fallback-actions a{border:0;border-radius:8px;padding:10px 14px;font:600 14px/1 Inter,ui-sans-serif,system-ui;background:#fff;color:#101828;cursor:pointer;text-decoration:none}.polar-checkout-floating-button{line-height:44px;text-align:center;text-decoration:none}';
      document.head.appendChild(style);
    }
    if (!document.querySelector('.polar-checkout-fallback-overlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'polar-checkout-fallback-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = '<section class="polar-checkout-fallback-card" aria-labelledby="polar-checkout-fallback-title"><h2 id="polar-checkout-fallback-title">Polar checkout is open.</h2><p>Complete checkout in the secure Polar window.</p><div class="polar-checkout-fallback-actions"><a data-polar-reopen href="' + POLAR_CHECKOUT_URL + '" target="_blank" rel="noopener">Open</a><button type="button" class="secondary" data-polar-close>Close</button></div></section>';
      document.body.appendChild(overlay);
      overlay.querySelector('[data-polar-close]')?.addEventListener('click', () => document.body.classList.remove('polar-checkout-open'));
      overlay.querySelector('[data-polar-reopen]')?.addEventListener('click', () => document.body.classList.add('polar-checkout-open'));
    }
    if (!document.querySelector('[data-polar-floating-checkout]')) {
      const button = document.createElement('a');
      button.href = POLAR_CHECKOUT_URL;
      button.target = '_blank';
      button.rel = 'noopener';
      button.className = 'polar-checkout-floating-button';
      button.setAttribute('data-polar-floating-checkout', '');
      button.setAttribute('aria-label', 'Open Polar checkout');
      button.title = 'Polar checkout';
      button.textContent = '$';
      button.addEventListener('click', () => {
        ensureUi();
        document.body.classList.add('polar-checkout-open');
      });
      document.body.appendChild(button);
    }
  }

  function openPolarCheckout(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }
    ensureUi();
    document.body.classList.add('polar-checkout-open');
    window.open(POLAR_CHECKOUT_URL, 'polar_checkout', centeredFeatures(760, 900));
  }

  function isCheckoutTrigger(element) {
    if (!element || element.closest?.('[data-polar-floating-checkout], .polar-checkout-fallback-overlay')) return false;
    if (element.matches?.('[data-checkout], [data-open-checkout], [data-polar-checkout], [data-plan-id], [data-plan]')) return true;
    const href = String(element.getAttribute?.('href') || '').toLowerCase();
    if (href.includes('/checkout') || href.includes('checkout=')) return true;
    const text = String(element.textContent || element.getAttribute?.('aria-label') || element.getAttribute?.('title') || '').toLowerCase();
    return /checkout|subscribe|upgrade|buy now|pay now|start annual|start monthly|unlock/.test(text);
  }

  document.addEventListener('click', (event) => {
    const target = event.target?.closest?.('a,button,[role="button"],[data-checkout],[data-open-checkout],[data-plan-id],[data-plan]');
    if (isCheckoutTrigger(target)) openPolarCheckout(event);
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureUi, { once: true });
  } else {
    ensureUi();
  }
})();