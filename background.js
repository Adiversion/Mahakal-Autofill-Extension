// Mahakal Darshan Autofill — MV3 Service Worker
// Minimal permissions (storage, activeTab, scripting) — 100% local, zero tracking.

const PORTAL_HOST_PATTERN = /(^|\.)(shrimahakaleshwar\.mp\.gov\.in|mponline\.gov\.in|mahakaleshwar\.mp\.gov\.in)$/i;

chrome.runtime.onUpdateAvailable.addListener((details) => {
  console.log('[MahakalAutofill] Update available:', details?.version);
});

/**
 * Injects the autofill engine into the active tab on demand (via activeTab + scripting,
 * requiring ZERO broad host_permissions) and executes the requested action.
 */
async function injectAndRun(tabId, message) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: ['content/mahakal-autofill.js'],
  });
  return chrome.tabs.sendMessage(tabId, message);
}

/**
 * MAIN-world framework-safe input & select dispatcher.
 * Handles React (__reactProps$), AngularJS (angular.element().triggerHandler),
 * jQuery, and standard HTML5/ASP.NET inputs reliably.
 */
function mainWorldSetField(selector, value, isSelect) {
  try {
    const el = document.querySelector(selector);
    if (!el) return { ok: false, reason: 'not_found' };

    el.focus();

    if (isSelect && el.tagName === 'SELECT') {
      el.value = value;
    } else {
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement?.prototype
        : window.HTMLInputElement?.prototype;
      const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    }

    // Standard DOM + Angular 17/19 InputEvent sync
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: String(value) }));
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));

    // React controlled-input sync
    const reactPropsKey = Object.getOwnPropertyNames(el).find((k) => k.startsWith('__reactProps$'));
    if (reactPropsKey && el[reactPropsKey]) {
      const rp = el[reactPropsKey];
      const synth = {
        target: el,
        currentTarget: el,
        bubbles: true,
        cancelable: true,
        preventDefault() {},
        stopPropagation() {},
        persist() {},
      };
      if (typeof rp.onChange === 'function') rp.onChange(synth);
      if (typeof rp.onBlur === 'function') rp.onBlur(synth);
    }

    // AngularJS / jQuery sync (common on MP govt portals)
    if (window.angular && typeof window.angular.element === 'function') {
      try {
        const ngEl = window.angular.element(el);
        ngEl.triggerHandler('input');
        ngEl.triggerHandler('change');
        const scope = ngEl.scope && ngEl.scope();
        if (scope && !scope.$$phase && scope.$root && !scope.$root.$$phase) {
          scope.$apply();
        }
      } catch (_) {}
    } else if (window.jQuery) {
      try {
        window.jQuery(el).trigger('input').trigger('change');
      } catch (_) {}
    }

    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return { ok: true, valueAfter: el.value };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'RUN_AUTOFILL_ACTION') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          return sendResponse({ ok: false, error: 'No active browser tab found.' });
        }
        const urlStr = tab.url || '';
        let hostname = '';
        try {
          hostname = new URL(urlStr).hostname;
        } catch (_) {}

        if (
          !msg.allowAnyPage &&
          hostname &&
          !PORTAL_HOST_PATTERN.test(hostname) &&
          hostname !== 'localhost' &&
          hostname !== '127.0.0.1'
        ) {
          return sendResponse({
            ok: false,
            wrongSite: true,
            error: 'Please open shrimahakaleshwar.mp.gov.in booking form first.',
          });
        }

        const result = await injectAndRun(tab.id, msg.payload);
        sendResponse(result || { ok: false, error: 'No response from booking page.' });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Could not access this page. Reload the tab and try again.' });
      }
    })();
    return true;
  }

  if (msg.type === 'FETCH_SHEEGHRA_SLOTS') {
    (async () => {
      const isoDate = String(msg.date || '').trim(); // YYYY-MM-DD
      const slashDate = isoDate.replace(/-/g, '/');
      if (!/^\d{4}\/\d{2}\/\d{2}$/.test(slashDate)) {
        return sendResponse({ ok: false, error: 'Please choose a valid date.' });
      }
      const apiUrl = `https://prod-api.mahakal.brainabove.net/public/api/v1/general_darshan_slots?date=${encodeURIComponent(slashDate)}`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(apiUrl, { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (res.ok) {
          const json = await res.json();
          return sendResponse({ ok: true, date: isoDate, slots: Array.isArray(json?.data) ? json.data : [] });
        }
      } catch (_) {}

      // Fallback: execute fetch from the active shrimahakaleshwar.mp.gov.in tab if strict origin CORS applies
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id && /shrimahakaleshwar\.mp\.gov\.in/i.test(tab.url || '')) {
          const exec = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            args: [apiUrl],
            func: async (u) => {
              const r = await fetch(u, { cache: 'no-store' });
              if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
              const j = await r.json();
              return { ok: true, slots: Array.isArray(j?.data) ? j.data : [] };
            },
          });
          const out = exec?.[0]?.result;
          if (out?.ok) return sendResponse({ ok: true, date: isoDate, slots: out.slots });
        }
      } catch (_) {}

      return sendResponse({ ok: false, error: 'Open shrimahakaleshwar.mp.gov.in and click Refresh to load live slots.' });
    })();
    return true;
  }

  if (msg.type === 'MAIN_WORLD_SET_FIELD') {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, reason: 'no_tab' });
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: mainWorldSetField,
      args: [msg.selector, msg.value ?? '', Boolean(msg.isSelect)],
    })
      .then((res) => sendResponse(res?.[0]?.result || { ok: false, reason: 'empty_result' }))
      .catch((err) => sendResponse({ ok: false, reason: String(err) }));
    return true;
  }
});
