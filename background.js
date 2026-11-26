// Mahakal Darshan Autofill — MV3 Service Worker
import { loadVault, saveVault } from './lib/vault.js';

const PORTAL_HOST_PATTERN = /(^|\.)(shrimahakaleshwar\.mp\.gov\.in|mponline\.gov\.in|mahakaleshwar\.mp\.gov\.in)$/i;
const WATCHER_KEY = 'mahakalAutoWatcherV1';
const pendingReloadTimers = new Map();
const tabLoadSeq = new Map();
const autoFilledLoadKeys = new Map();
const autoFilledBanners = new Map();

const TIMED_WINDOWS = {
  bhasma_aarti: { openHour: 8, openMinute: 0, openSecond: 0, closeHour: 24, closeMinute: 0 },
  sandhya_aarti: { openHour: 12, openMinute: 0, openSecond: 0, closeHour: 18, closeMinute: 30 },
  shayan_aarti: { openHour: 16, openMinute: 0, openSecond: 0, closeHour: 22, closeMinute: 0 },
};

function getWindowStateIst(mode) {
  const win = TIMED_WINDOWS[mode] || TIMED_WINDOWS.bhasma_aarti;
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const secsOfDay = ist.getUTCHours() * 3600 + ist.getUTCMinutes() * 60 + ist.getUTCSeconds();
  const openSecs = win.openHour * 3600 + win.openMinute * 60;
  const closeSecs = win.closeHour * 3600 + win.closeMinute * 60;
  return {
    ...win,
    isOpen: secsOfDay >= openSecs && secsOfDay < closeSecs,
    isOpeningRush: secsOfDay >= openSecs && secsOfDay < Math.min(closeSecs, openSecs + 120),
    isBeforeOpen: secsOfDay < openSecs,
  };
}

function getMaxPersonsForMode(mode) {
  return mode === 'sheeghra_darshan' || mode === 'dharmshala' ? 6 : 5;
}

function detectPortalServiceFromUrl(urlStr) {
  try {
    const u = new URL(urlStr || '');
    if (!PORTAL_HOST_PATTERN.test(u.hostname)) return null;
    const full = (u.pathname + u.search).toLowerCase();
    if (full.includes('sheeghra-darshan') || full.includes('shighra-darshan')) return 'sheeghra_darshan';
    if (full.includes('advance-bhasmaarti') || full.includes('bhasmaarti-request')) return 'advance_bhasma_aarti';
    if (full.includes('bhasmaarti') || full.includes('bhasm-aarti')) return 'bhasma_aarti';
    if (full.includes('sandhya-aarti')) return 'sandhya_aarti';
    if (full.includes('shayan-aarti')) return 'shayan_aarti';
    if (full.includes('dharmshala')) return 'dharmshala';
    return null;
  } catch (_) {
    return null;
  }
}

function isTimedService(mode) {
  return mode === 'bhasma_aarti' || mode === 'sandhya_aarti' || mode === 'shayan_aarti';
}

function isReloadableBookingRoute(urlStr) {
  return isTimedService(detectPortalServiceFromUrl(urlStr));
}

function isWidgetSupportedRoute(urlStr) {
  return detectPortalServiceFromUrl(urlStr) !== null;
}

const MODE_LABELS = {
  sheeghra_darshan: 'Sheeghra Darshan',
  bhasma_aarti: 'Tatkal Bhasma Aarti',
  advance_bhasma_aarti: 'Advance Bhasma Aarti',
  sandhya_aarti: 'Sandhya Aarti',
  shayan_aarti: 'Shayan Aarti',
  dharmshala: 'Dharmshala Booking',
};

async function runFillFromVault(tabId, { mode = 'bhasma_aarti', batchIndex = null, autoContinue = false } = {}) {
  const vault = await loadVault();
  const devotees = vault.devotees || [];
  if (devotees.length === 0) {
    return { ok: false, error: 'No devotees saved in extension vault yet.' };
  }
  const maxAllowed = getMaxPersonsForMode(mode);
  let selected;
  if (typeof batchIndex === 'number' && batchIndex >= 0) {
    selected = devotees.slice(batchIndex * maxAllowed, (batchIndex + 1) * maxAllowed);
  } else {
    const selectedSet = new Set(vault.selectedIds || []);
    selected = devotees.filter((d) => selectedSet.has(d.id)).slice(0, maxAllowed);
    if (selected.length === 0) {
      selected = devotees.slice(0, maxAllowed);
    }
  }
  if (selected.length === 0) {
    return { ok: false, error: 'No devotees in selected batch.' };
  }
  return injectAndRun(tabId, {
    action: 'FILL_BOOKING_FORM',
    bookingMode: mode,
    personCount: selected.length,
    preferredDate: vault.bookingPrefs?.preferredDate || '',
    preferredSlot: vault.bookingPrefs?.preferredSlot || '',
    contact: vault.contact,
    devotees: selected,
    autoContinue: Boolean(autoContinue),
  });
}

function getWatcher() {
  return new Promise((resolve) => {
    chrome.storage.local.get([WATCHER_KEY], (res) => {
      const raw = res?.[WATCHER_KEY] || {};
      const legacyCombined = Boolean(raw.autoFillAndContinue);
      resolve({
        armed: false,
        tabId: null,
        mode: 'bhasma_aarti',
        autoReload: false,
        retryMs: 2000,
        ...raw,
        autoFill: typeof raw.autoFill === 'boolean' ? raw.autoFill : legacyCombined,
        autoContinue: typeof raw.autoContinue === 'boolean' ? raw.autoContinue : legacyCombined,
      });
    });
  });
}

function setWatcher(patch) {
  return new Promise(async (resolve) => {
    const prev = await getWatcher();
    const next = { ...prev, ...patch };
    chrome.storage.local.set({ [WATCHER_KEY]: next }, () => resolve(next));
  });
}

function clearPendingReload(tabId) {
  const existing = pendingReloadTimers.get(tabId);
  if (existing) {
    clearTimeout(existing);
    pendingReloadTimers.delete(tabId);
  }
}

async function inspectTabLiveStatus(tabId) {
  const exec = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: () => {
      const isVis = (el) => {
        if (!el) return false;
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const cleanText = (el) => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
      const firstVisibleText = (selector) => {
        for (const el of document.querySelectorAll(selector)) {
          if (!isVis(el)) continue;
          const t = cleanText(el);
          if (t) return t;
        }
        return '';
      };

      const isLoading = Boolean(document.querySelector('.global-loader-overlay'));
      const dangerAlert = firstVisibleText('.alert-danger, .alert.alert-danger, [class*="alert-danger"]');
      const rawSuccess = firstVisibleText('.alert-success, .alert.alert-success');
      let infoAlert = firstVisibleText('.alert-warning, .alert-info');
      let quotaFullAlert = '';
      let isRestricted = false;

      for (const el of document.querySelectorAll('.alert-danger, .alert-success, .global-alert, p, strong, h5, h6')) {
        if (!isVis(el)) continue;
        const t = cleanText(el);
        if (!t || t.length > 260) continue;
        if (/quota\s+(?:for\s+.*?)?is\s+now\s+full|booking\s+slots\s+are\s+full|quota\s+not\s+available/i.test(t)) {
          quotaFullAlert = t;
          break;
        }
        if (/restricted\s+for\s+booking|date\s+is\s+restricted/i.test(t)) {
          isRestricted = true;
        }
      }

      // Tatkal Bhasma Aarti renders "Bhasmaarti Booking Quota for ... is now full." inside .alert-success!
      const successAlert = quotaFullAlert && rawSuccess && rawSuccess.toLowerCase().includes('is now full')
        ? ''
        : rawSuccess;

      if (!infoAlert) {
        for (const p of document.querySelectorAll('p, h5, h6, div.alert')) {
          if (!isVis(p)) continue;
          const t = cleanText(p);
          if (t.length >= 15 && t.length <= 220 && /(will be open on|booking is closed|booking is not allowed|slots are full|restricted for booking|booking opens at|booking window)/i.test(t)) {
            infoAlert = t;
            break;
          }
        }
      }

      let dateText = '';
      for (const el of document.querySelectorAll('h5, h6, p, div, span')) {
        if (!isVis(el)) continue;
        const t = cleanText(el);
        if (/^date of visit\s*:/i.test(t) && t.length <= 60) {
          dateText = t;
          break;
        }
      }

      const hasForm = Array.from(
        document.querySelectorAll('select[formcontrolname="no_of_persons"], .visitor_row, form select, form input:not([type="hidden"])')
      ).some(isVis);

      const combinedAlert = `${quotaFullAlert} ${infoAlert} ${dangerAlert}`;
      const soldOutForDay = Boolean(
        !hasForm &&
        /(will be open on .*? at \d+\s*(?:am|pm)|today's booking is now closed|booking is now closed)/i.test(combinedAlert)
      );

      return {
        ok: true,
        hasForm,
        isLoading,
        quotaFullAlert,
        soldOutForDay,
        isRestricted,
        dangerAlert,
        successAlert,
        infoAlert,
        dateText,
      };
    },
  });
  return exec?.[0]?.result || { ok: false };
}

async function injectTimerWidget(tabId, cfg) {
  let totalDevotees = 0;
  let maxAllowed = getMaxPersonsForMode(cfg.mode || 'bhasma_aarti');
  let selectedCount = 0;
  let initialBatch = -1;
  if (cfg.enabled) {
    try {
      const vault = await loadVault();
      const devotees = vault.devotees || [];
      totalDevotees = devotees.length;
      const selSet = new Set(vault.selectedIds || []);
      const validSel = devotees.filter((d) => selSet.has(d.id)).slice(0, maxAllowed);
      selectedCount = validSel.length > 0 ? validSel.length : Math.min(maxAllowed, totalDevotees);
      if (totalDevotees > maxAllowed && validSel.length > 0) {
        const firstIdx = devotees.findIndex((d) => d.id === validSel[0].id);
        if (firstIdx >= 0) initialBatch = Math.floor(firstIdx / maxAllowed);
      } else if (totalDevotees > maxAllowed) {
        initialBatch = 0;
      }
    } catch (_) {}
  }

  return chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    args: [{
      enabled: Boolean(cfg.enabled),
      forceShow: Boolean(cfg.forceShow),
      hasForm: Boolean(cfg.hasForm),
      isTimed: cfg.isTimed !== false,
      mode: String(cfg.mode || 'bhasma_aarti'),
      label: String(cfg.label || MODE_LABELS[cfg.mode] || 'Tatkal Bhasma Aarti'),
      targetHour: Number(cfg.targetHour ?? 8),
      targetMinute: Number(cfg.targetMinute ?? 0),
      targetSecond: Number(cfg.targetSecond ?? 0),
      closeHour: Number(cfg.closeHour ?? 24),
      closeMinute: Number(cfg.closeMinute ?? 0),
      autoReload: Boolean(cfg.autoReload),
      autoFill: Boolean(cfg.autoFill ?? cfg.autoFillAndContinue),
      autoContinue: Boolean(cfg.autoContinue ?? cfg.autoFillAndContinue),
      statusBanner: String(cfg.statusBanner || ''),
      retrying: Boolean(cfg.retrying),
      totalDevotees,
      maxAllowed,
      selectedCount,
      initialBatch,
    }],
    func: (cfg) => {
      const WIDGET_ID = 'mahakal-opening-timer';
      const existing = document.getElementById(WIDGET_ID);
      if (window.__mahakalTimerInterval) {
        clearInterval(window.__mahakalTimerInterval);
        window.__mahakalTimerInterval = null;
      }
      if (!cfg.enabled) {
        if (existing) existing.remove();
        return;
      }
      if (cfg.forceShow || (window.__mahakalWidgetDismissedMode && window.__mahakalWidgetDismissedMode !== cfg.mode)) {
        window.__mahakalWidgetDismissedMode = null;
      }
      if (!cfg.forceShow && window.__mahakalWidgetDismissedMode === cfg.mode) {
        return;
      }

      const getIstNow = () => {
        const nowMs = Date.now();
        const ist = new Date(nowMs + 5.5 * 3600 * 1000);
        return {
          h: ist.getUTCHours(),
          m: ist.getUTCMinutes(),
          s: ist.getUTCSeconds(),
          secsOfDay: ist.getUTCHours() * 3600 + ist.getUTCMinutes() * 60 + ist.getUTCSeconds(),
        };
      };

      const fmtClock = (h, m, s) => {
        const ap = h >= 12 ? 'PM' : 'AM';
        const hh = String(h % 12 || 12).padStart(2, '0');
        return `${hh}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} ${ap} IST`;
      };

      const fmtRemaining = (remSec) => {
        const total = Math.max(0, Math.ceil(remSec));
        const hh = Math.floor(total / 3600);
        const mm = Math.floor((total % 3600) / 60);
        const ss = total % 60;
        return hh > 0
          ? `${String(hh).padStart(2, '0')}h ${String(mm).padStart(2, '0')}m ${String(ss).padStart(2, '0')}s`
          : `${String(mm).padStart(2, '0')}m ${String(ss).padStart(2, '0')}s`;
      };

      const widget = existing || document.createElement('div');
      widget.id = WIDGET_ID;
      Object.assign(widget.style, {
        position: 'fixed',
        bottom: '18px',
        right: '18px',
        zIndex: '2147483647',
        background: '#2b090d',
        color: '#fef3c7',
        border: `2px solid ${cfg.hasForm ? '#10b981' : cfg.retrying ? '#fb923c' : '#f59e0b'}`,
        borderRadius: '12px',
        padding: '10px 12px',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
        minWidth: '280px',
        maxWidth: '335px',
      });

      let batchHtml = '';
      if (cfg.totalDevotees > cfg.maxAllowed) {
        const totalBatches = Math.ceil(cfg.totalDevotees / cfg.maxAllowed);
        const btns = [];
        for (let b = 0; b < totalBatches; b++) {
          const start = b * cfg.maxAllowed + 1;
          const end = Math.min(cfg.totalDevotees, (b + 1) * cfg.maxAllowed);
          const isAct = b === (cfg.initialBatch >= 0 ? cfg.initialBatch : 0);
          btns.push(
            `<button type="button" class="mk-batch-btn" data-batch="${b}" style="background:${isAct ? '#f59e0b' : '#461016'};color:${isAct ? '#1c1917' : '#fde68a'};border:1px solid #f59e0b;border-radius:6px;padding:2px 7px;font-size:10.5px;font-weight:800;cursor:pointer;">B${b + 1} (${start}-${end})</button>`
          );
        }
        batchHtml = `<div id="mkBatchRow" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:7px;">${btns.join('')}</div>`;
      }

      const fillCountLabel = cfg.selectedCount > 0 ? ` (${cfg.selectedCount})` : '';

      widget.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">
          <span style="font-size:11.5px;font-weight:800;color:#fde68a;">🔱 ${cfg.label}</span>
          <button id="mkTimerClose" type="button" aria-label="Close timer" style="background:none;border:none;color:#fde68a;font-size:13px;cursor:pointer;padding:0 2px;">✕</button>
        </div>
        <div id="mkTimerValue" style="font-size:15.5px;font-weight:800;font-variant-numeric:tabular-nums;color:${cfg.hasForm ? '#6ee7b7' : '#ffffff'};margin-bottom:2px;">--m --s</div>
        <div id="mkTimerSub" style="font-size:10.5px;color:#fcd34d;font-variant-numeric:tabular-nums;margin-bottom:7px;">IST --:--:--</div>
        ${batchHtml}
        <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;">
          <label style="display:${cfg.isTimed ? 'inline-flex' : 'none'};align-items:center;gap:5px;font-size:11px;font-weight:600;color:#fef3c7;cursor:pointer;">
            <input id="mkTimerAutoReload" type="checkbox" ${cfg.autoReload ? 'checked' : ''} style="accent-color:#f59e0b;cursor:pointer;" />
            <span>Auto-reload (Open Time &amp; Quota Full)</span>
          </label>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <label style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#fef3c7;cursor:pointer;" title="Auto-fill form automatically when it opens">
              <input id="mkTimerAutoFill" type="checkbox" ${cfg.autoFill ? 'checked' : ''} style="accent-color:#10b981;cursor:pointer;" />
              <span>Auto-Fill</span>
            </label>
            <label style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#fef3c7;cursor:pointer;" title="Click Continue automatically after filling &amp; photo upload">
              <input id="mkTimerAutoContinue" type="checkbox" ${cfg.autoContinue ? 'checked' : ''} style="accent-color:#f59e0b;cursor:pointer;" />
              <span>Auto-Continue</span>
            </label>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;">
          <button id="mkTimerStopBtn" type="button" style="background:#7f1d1d;color:#fecaca;border:1px solid #ef4444;border-radius:7px;padding:5px 9px;font-size:11px;font-weight:700;cursor:pointer;display:${cfg.retrying ? 'inline-block' : 'none'};">■ Stop</button>
          <button id="mkTimerReloadBtn" type="button" style="background:#f59e0b;color:#1c1917;border:none;border-radius:7px;padding:5px 9px;font-size:11px;font-weight:800;cursor:pointer;">↻ Reload</button>
          <button id="mkTimerFillBtn" type="button" style="background:#10b981;color:#052e16;border:none;border-radius:7px;padding:5px 11px;font-size:11.5px;font-weight:800;cursor:pointer;">⚡ Auto Fill${fillCountLabel}</button>
        </div>
      `;

      if (!existing) document.body.appendChild(widget);

      const valEl = widget.querySelector('#mkTimerValue');
      const subEl = widget.querySelector('#mkTimerSub');
      const chkReload = widget.querySelector('#mkTimerAutoReload');
      const chkAutoFill = widget.querySelector('#mkTimerAutoFill');
      const chkContinue = widget.querySelector('#mkTimerAutoContinue');
      const stopBtn = widget.querySelector('#mkTimerStopBtn');
      const reloadBtn = widget.querySelector('#mkTimerReloadBtn');
      const fillBtn = widget.querySelector('#mkTimerFillBtn');
      const closeBtn = widget.querySelector('#mkTimerClose');

      let activeBatchIdx = cfg.initialBatch >= 0 ? cfg.initialBatch : null;
      const updateFillBtnText = () => {
        const suffix = chkContinue.checked ? ' + Continue' : '';
        if (activeBatchIdx === null) {
          fillBtn.textContent = `⚡ Auto Fill${fillCountLabel}${suffix}`;
        } else {
          const start = activeBatchIdx * cfg.maxAllowed + 1;
          const end = Math.min(cfg.totalDevotees, (activeBatchIdx + 1) * cfg.maxAllowed);
          fillBtn.textContent = `⚡ Auto Fill (${end - start + 1})${suffix}`;
        }
      };
      updateFillBtnText();

      widget.querySelectorAll('.mk-batch-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeBatchIdx = Number(btn.dataset.batch);
          widget.querySelectorAll('.mk-batch-btn').forEach((b) => {
            const act = Number(b.dataset.batch) === activeBatchIdx;
            b.style.background = act ? '#f59e0b' : '#461016';
            b.style.color = act ? '#1c1917' : '#fde68a';
          });
          updateFillBtnText();
          chrome.runtime.sendMessage(
            { type: 'SET_ACTIVE_BATCH', mode: cfg.mode, batchIndex: activeBatchIdx },
            () => {
              void chrome.runtime.lastError;
            }
          );
        });
      });

      const pushWatcherUpdate = (armed) => {
        chrome.runtime.sendMessage({
          type: 'SET_AUTO_WATCHER',
          armed,
          mode: cfg.mode,
          autoReload: chkReload.checked,
          autoFill: chkAutoFill.checked,
          autoContinue: chkContinue.checked,
          skipImmediate: true,
        }, () => { void chrome.runtime.lastError; });
      };

      chkReload.addEventListener('change', () => pushWatcherUpdate(chkReload.checked));
      chkAutoFill.addEventListener('change', () => pushWatcherUpdate(chkReload.checked));
      chkContinue.addEventListener('change', () => {
        updateFillBtnText();
        pushWatcherUpdate(chkReload.checked);
      });
      stopBtn.addEventListener('click', () => {
        chkReload.checked = false;
        pushWatcherUpdate(false);
        stopBtn.style.display = 'none';
        valEl.textContent = 'Auto-reload paused';
        valEl.style.color = '#fde68a';
      });
      reloadBtn.addEventListener('click', () => window.location.reload());

      let customFeedback = '';
      fillBtn.addEventListener('click', () => {
        fillBtn.disabled = true;
        fillBtn.textContent = '⚡ Filling...';
        chrome.runtime.sendMessage(
          {
            type: 'FILL_FROM_WIDGET',
            mode: cfg.mode,
            batchIndex: activeBatchIdx,
            autoContinue: chkContinue.checked,
          },
          (res) => {
            fillBtn.disabled = false;
            updateFillBtnText();
            if (chrome.runtime.lastError || !res?.ok) {
              customFeedback = `⚠ ${res?.error || chrome.runtime.lastError?.message || 'Fill failed'}`;
              valEl.textContent = customFeedback;
              valEl.style.color = '#fca5a5';
            } else {
              customFeedback = res.continueClicked
                ? `✅ Filled ${res.filledDevotees || ''} & Clicked Continue!`
                : `✅ Filled ${res.filledDevotees || 0} devotee(s)!`;
              valEl.textContent = customFeedback;
              valEl.style.color = '#6ee7b7';
            }
          }
        );
      });

      closeBtn.addEventListener('click', () => {
        window.__mahakalWidgetDismissedMode = cfg.mode;
        if (window.__mahakalTimerInterval) clearInterval(window.__mahakalTimerInterval);
        pushWatcherUpdate(false);
        widget.remove();
      });

      const targetSecs = cfg.targetHour * 3600 + cfg.targetMinute * 60 + cfg.targetSecond;
      const closeSecs = cfg.closeHour * 3600 + cfg.closeMinute * 60;
      let triggeredOpenReload = false;

      const tick = () => {
        const now = getIstNow();
        const diff = targetSecs - now.secsOfDay;
        subEl.textContent = cfg.isTimed
          ? `${fmtClock(now.h, now.m, now.s)} · Opens ${fmtClock(cfg.targetHour, cfg.targetMinute, cfg.targetSecond).replace(' IST', '')}`
          : `${fmtClock(now.h, now.m, now.s)} · Max ${cfg.maxAllowed} persons`;
        if (customFeedback) return;
        if (cfg.statusBanner) {
          valEl.textContent = cfg.statusBanner;
          valEl.style.color = cfg.hasForm ? '#6ee7b7' : cfg.retrying ? '#fdba74' : '#ffffff';
          return;
        }
        if (cfg.hasForm) {
          valEl.textContent = '● Form Open — Ready to Fill!';
          valEl.style.color = '#6ee7b7';
          return;
        }
        if (diff > 0) {
          valEl.textContent = `Opens in ${fmtRemaining(diff)}`;
          valEl.style.color = '#ffffff';
        } else if (now.secsOfDay >= closeSecs) {
          const nextDiff = 24 * 3600 - now.secsOfDay + targetSecs;
          valEl.textContent = `Next opens in ${fmtRemaining(nextDiff)}`;
          valEl.style.color = '#ffffff';
        } else {
          valEl.textContent = '● OPEN NOW — Reload Page!';
          valEl.style.color = '#6ee7b7';
          widget.style.borderColor = '#10b981';
          if (chkReload.checked && !triggeredOpenReload && diff <= 0 && diff > -15) {
            triggeredOpenReload = true;
            pushWatcherUpdate(true);
            window.location.reload();
          }
        }
      };
      tick();
      window.__mahakalTimerInterval = setInterval(tick, 250);
    },
  });
}

async function evaluateAndHandleArmedTab(tabId) {
  clearPendingReload(tabId);
  const watcher = await getWatcher();

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_) {
    if (watcher.tabId === tabId) await setWatcher({ armed: false, tabId: null });
    return;
  }
  const url = tab?.url || '';
  if (!isWidgetSupportedRoute(url)) {
    if (watcher.armed && watcher.tabId === tabId) {
      await setWatcher({ armed: false });
    }
    await injectTimerWidget(tabId, { enabled: false }).catch(() => {});
    return;
  }

  const routeMode = detectPortalServiceFromUrl(url) || watcher.mode || 'bhasma_aarti';
  const isTimed = isTimedService(routeMode);
  const isArmedHere = Boolean(watcher.armed && watcher.tabId === tabId);
  const currentLoadKey = `${url}#${tabLoadSeq.get(tabId) || 0}`;

  // Wait up to ~2.4s for Angular loader to settle after reload/navigation
  let status = await inspectTabLiveStatus(tabId);
  for (let i = 0; i < 8 && status?.isLoading && !status?.hasForm; i++) {
    await new Promise((r) => setTimeout(r, 300));
    status = await inspectTabLiveStatus(tabId);
  }

  const latest = await getWatcher();
  const stillArmed = Boolean(isArmedHere && latest.armed && latest.tabId === tabId);
  const alreadyFilledThisLoad = autoFilledLoadKeys.get(tabId) === currentLoadKey;
  const shouldAutoFillNow = Boolean(latest.autoFill && !alreadyFilledThisLoad);

  if (!isTimed) {
    if (stillArmed) await setWatcher({ armed: false });
    let banner = alreadyFilledThisLoad
      ? (autoFilledBanners.get(tabId) || `✅ Auto-Filled!`)
      : (status?.hasForm
        ? `● ${MODE_LABELS[routeMode] || 'Form'} Ready — Click ⚡ Auto Fill!`
        : `● Pick Date / Slot → ⚡ Auto Fill`);
    if (status?.hasForm && shouldAutoFillNow) {
      autoFilledLoadKeys.set(tabId, currentLoadKey);
      const fillRes = await runFillFromVault(tabId, { mode: routeMode, autoContinue: Boolean(latest.autoContinue) });
      if (fillRes?.ok) {
        banner = fillRes.continueClicked
          ? `✅ Filled ${fillRes.filledDevotees || ''} & Clicked Continue!`
          : `✅ Auto-Filled ${fillRes.filledDevotees || 0} devotee(s)! Click Continue.`;
        autoFilledBanners.set(tabId, banner);
      }
    }
    await injectTimerWidget(tabId, {
      enabled: true,
      isTimed: false,
      hasForm: Boolean(status?.hasForm),
      mode: routeMode,
      autoReload: false,
      autoFill: latest.autoFill,
      autoContinue: latest.autoContinue,
      statusBanner: banner,
      retrying: false,
    });
    return;
  }

  const win = getWindowStateIst(routeMode);

  if (status?.hasForm && !status?.quotaFullAlert) {
    if (stillArmed) await setWatcher({ armed: false });
    let banner = alreadyFilledThisLoad
      ? (autoFilledBanners.get(tabId) || '✅ Auto-Filled!')
      : '● Form Open — Click ⚡ Auto Fill!';
    if (shouldAutoFillNow) {
      autoFilledLoadKeys.set(tabId, currentLoadKey);
      const fillRes = await runFillFromVault(tabId, { mode: routeMode, autoContinue: Boolean(latest.autoContinue) });
      if (fillRes?.ok) {
        banner = fillRes.continueClicked
          ? `✅ Filled ${fillRes.filledDevotees || ''} & Clicked Continue!`
          : `✅ Auto-Filled ${fillRes.filledDevotees || 0} devotee(s)! Click Continue.`;
        autoFilledBanners.set(tabId, banner);
      }
    }
    await injectTimerWidget(tabId, {
      enabled: true,
      hasForm: true,
      mode: routeMode,
      targetHour: win.openHour,
      targetMinute: win.openMinute,
      closeHour: win.closeHour,
      closeMinute: win.closeMinute,
      autoReload: false,
      autoFill: latest.autoFill,
      autoContinue: latest.autoContinue,
      statusBanner: banner,
      retrying: false,
    });
    return;
  }

  if (!stillArmed) {
    await injectTimerWidget(tabId, {
      enabled: true,
      mode: routeMode,
      targetHour: win.openHour,
      targetMinute: win.openMinute,
      closeHour: win.closeHour,
      closeMinute: win.closeMinute,
      autoReload: false,
      autoFill: latest.autoFill,
      autoContinue: latest.autoContinue,
      statusBanner: status?.quotaFullAlert ? '✕ Quota full on page — check Auto-reload' : '',
      retrying: false,
    });
    return;
  }

  if (status?.isRestricted || status?.soldOutForDay) {
    await setWatcher({ armed: false });
    await injectTimerWidget(tabId, {
      enabled: true,
      mode: routeMode,
      targetHour: win.openHour,
      targetMinute: win.openMinute,
      closeHour: win.closeHour,
      closeMinute: win.closeMinute,
      autoReload: false,
      autoFill: latest.autoFill,
      autoContinue: latest.autoContinue,
      statusBanner: status?.isRestricted
        ? '✕ Date restricted on portal'
        : '✕ Quota full for today · Opens tomorrow',
      retrying: false,
    });
    return;
  }

  const shouldRetry = Boolean(latest.autoReload && win.isOpeningRush && !status?.hasForm);

  if (shouldRetry) {
    const banner = status?.quotaFullAlert
      ? '⏳ Quota full — retrying in 2s...'
      : '⏳ Waiting for form — reloading in 2s...';
    await injectTimerWidget(tabId, {
      enabled: true,
      mode: routeMode,
      targetHour: win.openHour,
      targetMinute: win.openMinute,
      closeHour: win.closeHour,
      closeMinute: win.closeMinute,
      autoReload: true,
      autoFill: latest.autoFill,
      autoContinue: latest.autoContinue,
      statusBanner: banner,
      retrying: true,
    });

    const timer = setTimeout(async () => {
      pendingReloadTimers.delete(tabId);
      const curr = await getWatcher();
      if (!curr.armed || curr.tabId !== tabId || !curr.autoReload) return;
      try {
        const currTab = await chrome.tabs.get(tabId);
        if (isReloadableBookingRoute(currTab?.url)) {
          await chrome.tabs.reload(tabId);
        } else {
          await setWatcher({ armed: false });
        }
      } catch (_) {}
    }, latest.retryMs || 2000);
    pendingReloadTimers.set(tabId, timer);
  } else {
    const waitingOutsideRush = Boolean(latest.autoReload && win.isOpen && !win.isOpeningRush);
    if (waitingOutsideRush) {
      await setWatcher({ armed: false });
    }
    await injectTimerWidget(tabId, {
      enabled: true,
      mode: routeMode,
      targetHour: win.openHour,
      targetMinute: win.openMinute,
      closeHour: win.closeHour,
      closeMinute: win.closeMinute,
      autoReload: win.isBeforeOpen ? latest.autoReload : false,
      autoFill: latest.autoFill,
      autoContinue: latest.autoContinue,
      statusBanner: waitingOutsideRush ? '✕ Opening rush ended · Next opens tomorrow' : '',
      retrying: false,
    });
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabLoadSeq.set(tabId, (tabLoadSeq.get(tabId) || 0) + 1);
  }
  if (changeInfo.url) {
    tabLoadSeq.set(tabId, (tabLoadSeq.get(tabId) || 0) + 1);
    if (!isReloadableBookingRoute(changeInfo.url)) {
      clearPendingReload(tabId);
      getWatcher().then((w) => {
        if (w.armed && w.tabId === tabId) setWatcher({ armed: false });
      });
    }
    if (isWidgetSupportedRoute(changeInfo.url)) {
      setTimeout(() => evaluateAndHandleArmedTab(tabId).catch(() => {}), 320);
      setTimeout(() => evaluateAndHandleArmedTab(tabId).catch(() => {}), 1100);
    } else {
      injectTimerWidget(tabId, { enabled: false }).catch(() => {});
    }
    return;
  }
  if (changeInfo.status === 'complete') {
    evaluateAndHandleArmedTab(tabId).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  clearPendingReload(tabId);
  tabLoadSeq.delete(tabId);
  autoFilledLoadKeys.delete(tabId);
  autoFilledBanners.delete(tabId);
  const watcher = await getWatcher();
  if (watcher.tabId === tabId) {
    await setWatcher({ armed: false, tabId: null });
  }
});

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

  if (msg.type === 'FETCH_RESTRICTED_DATES') {
    (async () => {
      const apiUrl = 'https://prod-api.mahakal.brainabove.net/public/api/v1/restricted_dates';
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7000);
        const res = await fetch(apiUrl, { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (res.ok) {
          const json = await res.json();
          return sendResponse({ ok: true, dates: Array.isArray(json?.data) ? json.data : [] });
        }
      } catch (_) {}

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id && /shrimahakaleshwar\.mp\.gov\.in/i.test(tab.url || '')) {
          const exec = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            args: [apiUrl],
            func: async (u) => {
              const r = await fetch(u, { cache: 'no-store' });
              if (!r.ok) return { ok: false };
              const j = await r.json();
              return { ok: true, dates: Array.isArray(j?.data) ? j.data : [] };
            },
          });
          const out = exec?.[0]?.result;
          if (out?.ok) return sendResponse({ ok: true, dates: out.dates });
        }
      } catch (_) {}

      return sendResponse({ ok: false, dates: [] });
    })();
    return true;
  }

  if (msg.type === 'FETCH_ADVANCE_BHASMA_DATES') {
    (async () => {
      const startDate = String(msg.startDate || '').trim();
      const endDate = String(msg.endDate || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return sendResponse({ ok: false, error: 'Invalid date range.' });
      }
      const apiUrl = `https://prod-api.mahakal.brainabove.net/public/api/v1/bhasmarti_general_limit_check?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(apiUrl, { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (res.ok) {
          const json = await res.json();
          return sendResponse({ ok: true, days: Array.isArray(json?.data) ? json.data : [] });
        }
      } catch (_) {}

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id && /shrimahakaleshwar\.mp\.gov\.in/i.test(tab.url || '')) {
          const exec = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            args: [apiUrl],
            func: async (u) => {
              const r = await fetch(u, { cache: 'no-store' });
              if (!r.ok) return { ok: false };
              const j = await r.json();
              return { ok: true, days: Array.isArray(j?.data) ? j.data : [] };
            },
          });
          const out = exec?.[0]?.result;
          if (out?.ok) return sendResponse({ ok: true, days: out.days });
        }
      } catch (_) {}

      return sendResponse({ ok: false, days: [] });
    })();
    return true;
  }

  if (msg.type === 'FETCH_DHARMASHALA_AVAILABILITY') {
    (async () => {
      const checkIn = String(msg.checkIn || '').trim();
      const checkOut = String(msg.checkOut || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
        return sendResponse({ ok: false, error: 'Please select valid Check-in and Check-out dates.' });
      }
      const noOfDays = Math.max(1, Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000));
      const base = 'https://prod-api.mahakal.brainabove.net/public/api/v1';

      const fetchPublicJson = async (url) => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
          clearTimeout(timer);
          if (res.ok) return await res.json();
        } catch (_) {}
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id && /shrimahakaleshwar\.mp\.gov\.in/i.test(tab.url || '')) {
            const exec = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              args: [url],
              func: async (u) => {
                const r = await fetch(u, { cache: 'no-store' });
                return r.ok ? await r.json() : null;
              },
            });
            return exec?.[0]?.result || null;
          }
        } catch (_) {}
        return null;
      };

      const listJson = await fetchPublicJson(`${base}/dharmashala_list`);
      const dharmshalas = Array.isArray(listJson?.data) ? listJson.data : [];
      if (dharmshalas.length === 0) {
        return sendResponse({ ok: false, error: 'Could not reach Dharmshala list endpoint.' });
      }

      const results = await Promise.all(
        dharmshalas.slice(0, 8).map(async (dh) => {
          const roomJson = await fetchPublicJson(
            `${base}/available_rooms?dharmshala_id=${encodeURIComponent(dh.id)}&from_date=${encodeURIComponent(checkIn)}&to_date=${encodeURIComponent(checkOut)}&no_of_days=${noOfDays}`
          );
          const rooms = Array.isArray(roomJson?.data) ? roomJson.data : [];
          const bookable = rooms.filter((r) => r.is_booking_available && Number(r.max_available_rooms || 0) > 0);
          const minCharge = bookable.length > 0
            ? Math.min(...bookable.map((r) => Number(r.charges || 0)).filter((n) => n > 0))
            : null;
          return {
            id: dh.id,
            name: dh.dharmshala_name || dh.name || `Dharmshala #${dh.id}`,
            rooms,
            bookableCount: bookable.length,
            totalRoomsAvailable: bookable.reduce((s, r) => s + Number(r.max_available_rooms || 0), 0),
            minCharge: Number.isFinite(minCharge) ? minCharge : null,
          };
        })
      );

      return sendResponse({ ok: true, checkIn, checkOut, noOfDays, results });
    })();
    return true;
  }

  if (msg.type === 'RELOAD_ACTIVE_PORTAL_TAB') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !PORTAL_HOST_PATTERN.test(new URL(tab.url || 'https://invalid').hostname)) {
          return sendResponse({ ok: false, error: 'Active tab is not a Mahakaleshwar portal page.' });
        }
        await chrome.tabs.reload(tab.id);
        return sendResponse({ ok: true });
      } catch (err) {
        return sendResponse({ ok: false, error: err?.message || 'Failed to reload tab.' });
      }
    })();
    return true;
  }

  if (msg.type === 'GET_AUTO_WATCHER') {
    (async () => {
      const w = await getWatcher();
      sendResponse({ ok: true, watcher: w });
    })();
    return true;
  }

  if (msg.type === 'SET_AUTO_WATCHER') {
    (async () => {
      try {
        const tabId = msg.tabId || sender?.tab?.id || (await chrome.tabs.query({ active: true, currentWindow: true }))?.[0]?.id || null;
        if (tabId) clearPendingReload(tabId);
        const next = await setWatcher({
          armed: Boolean(msg.armed && tabId),
          tabId,
          mode: msg.mode || 'bhasma_aarti',
          autoReload: Boolean(msg.autoReload),
          autoFill: Boolean(msg.autoFill ?? msg.autoFillAndContinue),
          autoContinue: Boolean(msg.autoContinue ?? msg.autoFillAndContinue),
        });
        if (!msg.skipImmediate && next.armed && tabId) {
          evaluateAndHandleArmedTab(tabId).catch(() => {});
        }
        sendResponse({ ok: true, watcher: next });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Failed to update watcher.' });
      }
    })();
    return true;
  }

  if (msg.type === 'FILL_FROM_WIDGET') {
    (async () => {
      try {
        const tabId = sender?.tab?.id || (await chrome.tabs.query({ active: true, currentWindow: true }))?.[0]?.id;
        if (!tabId) return sendResponse({ ok: false, error: 'No active portal tab.' });
        const result = await runFillFromVault(tabId, {
          mode: msg.mode || 'bhasma_aarti',
          batchIndex: typeof msg.batchIndex === 'number' ? msg.batchIndex : null,
          autoContinue: Boolean(msg.autoContinue),
        });
        sendResponse(result || { ok: false, error: 'No response from page.' });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Fill failed.' });
      }
    })();
    return true;
  }

  if (msg.type === 'SET_ACTIVE_BATCH') {
    (async () => {
      try {
        let vault = await loadVault();
        const mode = msg.mode || vault.bookingMode || 'bhasma_aarti';
        const maxAllowed = mode === 'sheeghra_darshan' || mode === 'dharmshala' ? 6 : 5;
        const devotees = vault.devotees || [];
        const totalBatches = Math.max(1, Math.ceil(devotees.length / maxAllowed));
        const batchIdx = Math.max(0, Math.min(totalBatches - 1, Number(msg.batchIndex || 0)));
        const slice = devotees.slice(batchIdx * maxAllowed, (batchIdx + 1) * maxAllowed);
        vault.selectedIds = slice.map((d) => d.id);
        vault = await saveVault(vault);
        sendResponse({ ok: true, batchIndex: batchIdx, selectedIds: vault.selectedIds });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Failed to sync batch.' });
      }
    })();
    return true;
  }

  if (msg.type === 'SYNC_PAGE_TIMER') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !PORTAL_HOST_PATTERN.test(new URL(tab.url || 'https://invalid').hostname)) {
          return sendResponse({ ok: false });
        }
        await injectTimerWidget(tab.id, {
          enabled: Boolean(msg.enabled),
          forceShow: true,
          isTimed: msg.isTimed !== false,
          hasForm: Boolean(msg.hasForm),
          mode: msg.mode || 'bhasma_aarti',
          label: msg.label || 'Tatkal Bhasma Aarti',
          targetHour: msg.targetHour ?? 8,
          targetMinute: msg.targetMinute ?? 0,
          targetSecond: msg.targetSecond ?? 0,
          closeHour: msg.closeHour ?? 24,
          closeMinute: msg.closeMinute ?? 0,
          autoReload: Boolean(msg.autoReload),
          autoFill: Boolean(msg.autoFill ?? msg.autoFillAndContinue),
          autoContinue: Boolean(msg.autoContinue ?? msg.autoFillAndContinue),
          statusBanner: msg.statusBanner || '',
          retrying: Boolean(msg.retrying),
        });
        return sendResponse({ ok: true });
      } catch (_) {
        return sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (msg.type === 'READ_LIVE_PAGE_STATUS') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !PORTAL_HOST_PATTERN.test(new URL(tab.url || 'https://invalid').hostname)) {
          return sendResponse({ ok: false });
        }
        const status = await inspectTabLiveStatus(tab.id);
        return sendResponse(status);
      } catch (_) {
        return sendResponse({ ok: false });
      }
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
