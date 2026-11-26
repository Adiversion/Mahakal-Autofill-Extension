import {
  MAX_DEVOTEES,
  MAX_PERSONS_PER_BOOKING,
  loadVault,
  saveVault,
  compressImageFile,
  computeAgeFromDob,
} from '../lib/vault.js';

const PORTAL_URLS = {
  sheeghra_darshan: 'https://www.shrimahakaleshwar.mp.gov.in/services/slot-booking?type=sheeghra-darshan',
  bhasma_aarti: 'https://www.shrimahakaleshwar.mp.gov.in/services/bhasmaarti',
  advance_bhasma_aarti: 'https://www.shrimahakaleshwar.mp.gov.in/services/advance-bhasmaarti',
  sandhya_aarti: 'https://www.shrimahakaleshwar.mp.gov.in/services/sandhya-aarti',
  shayan_aarti: 'https://www.shrimahakaleshwar.mp.gov.in/services/shayan-aarti',
  dharmshala: 'https://www.shrimahakaleshwar.mp.gov.in/services/dharmshala-slot-booking',
};

const MODE_LABELS = {
  sheeghra_darshan: 'Sheeghra Darshan',
  bhasma_aarti: 'Tatkal Bhasma Aarti',
  advance_bhasma_aarti: 'Advance Bhasma Aarti',
  sandhya_aarti: 'Sandhya Aarti',
  shayan_aarti: 'Shayan Aarti',
  dharmshala: 'Dharmshala Booking',
};

const PHOTO_REQUIRED_MODES = new Set(['bhasma_aarti', 'advance_bhasma_aarti', 'sandhya_aarti', 'shayan_aarti']);

function getMaxPersonsForMode(mode) {
  return mode === 'sheeghra_darshan' || mode === 'dharmshala' ? 6 : 5;
}

// Optional remote ad/sponsor endpoint (gracefully falls back to built-in KasyHQ card)
const REMOTE_AD_URL = 'https://kasyhq.com/api/mahakal-ad.json';

let vault = null;
let draftPhoto = null;
let draftIdScan = null;
let lastInspectJson = '';
let activeTabInfo = { id: null, url: '', detectedMode: null, onPortal: false };
let cachedRestrictedDates = null;
let cachedAdvanceBhasma = null;
let cachedDharmshalaAvailability = null;
let lastLivePageStatus = null;
let countdownTimerId = null;
let autoReloadEnabled = false;
let autoFillEnabled = false;
let autoContinueEnabled = false;
let autoReloadTriggeredForTarget = '';

const TIMED_OPENING_WINDOWS = {
  bhasma_aarti: { openHour: 8, openMinute: 0, openSecond: 0, closeHour: 24, closeMinute: 0, label: '8:00 AM IST' },
  sandhya_aarti: { openHour: 12, openMinute: 0, openSecond: 0, closeHour: 18, closeMinute: 30, label: '12:00 PM IST' },
  shayan_aarti: { openHour: 16, openMinute: 0, openSecond: 0, closeHour: 22, closeMinute: 0, label: '4:00 PM IST' },
};

function getIstParts() {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return {
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
    second: ist.getUTCSeconds(),
    iso: ist.toISOString().slice(0, 10),
    ddmmyyyy: `${String(ist.getUTCDate()).padStart(2, '0')}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${ist.getUTCFullYear()}`,
  };
}

function formatIstClock(ist) {
  const ap = ist.hour >= 12 ? 'PM' : 'AM';
  const hh = String(ist.hour % 12 || 12).padStart(2, '0');
  return `IST ${hh}:${String(ist.minute).padStart(2, '0')}:${String(ist.second).padStart(2, '0')} ${ap}`;
}

function formatCountdownDuration(totalSeconds) {
  const sec = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
    : `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function getTimedWindowState(mode) {
  const win = TIMED_OPENING_WINDOWS[mode];
  if (!win) return null;
  const ist = getIstParts();
  const nowSec = ist.hour * 3600 + ist.minute * 60 + ist.second;
  const openSec = win.openHour * 3600 + win.openMinute * 60 + win.openSecond;
  const closeSec = win.closeHour * 3600 + win.closeMinute * 60;

  if (nowSec < openSec) {
    return {
      phase: 'before_open',
      remainingSec: openSec - nowSec,
      ist,
      win,
      targetKey: `${ist.iso}-${mode}-${win.openHour}`,
    };
  }
  if (nowSec < closeSec) {
    return {
      phase: 'open',
      remainingToCloseSec: closeSec - nowSec,
      ist,
      win,
      targetKey: `${ist.iso}-${mode}-${win.openHour}`,
    };
  }
  return {
    phase: 'after_close',
    remainingSec: 24 * 3600 - nowSec + openSec,
    ist,
    win,
    targetKey: `${ist.iso}-next-${mode}`,
  };
}

function stopServiceCountdown() {
  if (countdownTimerId) {
    clearInterval(countdownTimerId);
    countdownTimerId = null;
  }
  const bar = $('serviceCountdownBar');
  if (bar) bar.classList.add('hidden');
}

function syncOnPageTimerWidget(enabled, mode, extra = {}) {
  const win = TIMED_OPENING_WINDOWS[mode];
  const isTimed = Boolean(win);
  const supported = Boolean(
    isTimed || mode === 'sheeghra_darshan' || mode === 'advance_bhasma_aarti' || mode === 'dharmshala'
  );
  chrome.runtime.sendMessage(
    {
      type: 'SYNC_PAGE_TIMER',
      enabled: Boolean(enabled && supported),
      isTimed,
      hasForm: Boolean(extra.hasForm ?? (lastLivePageStatus?.mode === mode && lastLivePageStatus?.hasForm)),
      mode,
      label: MODE_LABELS[mode] || 'Booking Timer',
      targetHour: win?.openHour ?? 8,
      targetMinute: win?.openMinute ?? 0,
      targetSecond: win?.openSecond ?? 0,
      closeHour: win?.closeHour ?? 24,
      closeMinute: win?.closeMinute ?? 0,
      autoReload: isTimed ? autoReloadEnabled : false,
      autoFill: autoFillEnabled,
      autoContinue: autoContinueEnabled,
      statusBanner: extra.statusBanner || '',
      retrying: Boolean(extra.retrying),
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function syncBackgroundWatcher(armed, mode, skipImmediate = false) {
  chrome.runtime.sendMessage(
    {
      type: 'SET_AUTO_WATCHER',
      armed: Boolean(armed),
      tabId: activeTabInfo.id,
      mode,
      autoReload: autoReloadEnabled,
      autoFill: autoFillEnabled,
      autoContinue: autoContinueEnabled,
      skipImmediate,
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function syncAutomationCheckboxes({ isTimed = false } = {}) {
  const autoControls = $('automationControls');
  const autoWrap = $('lblAutoReload');
  const chkAuto = $('chkAutoReload');
  const fillWrap = $('lblAutoFill');
  const chkFill = $('chkAutoFill');
  const continueWrap = $('lblAutoContinue');
  const chkContinue = $('chkAutoContinue');
  if (autoControls) autoControls.classList.remove('hidden');
  if (autoWrap) autoWrap.classList.toggle('hidden', !isTimed);
  if (chkAuto) chkAuto.checked = autoReloadEnabled;
  if (fillWrap) fillWrap.classList.remove('hidden');
  if (chkFill) chkFill.checked = autoFillEnabled;
  if (continueWrap) continueWrap.classList.remove('hidden');
  if (chkContinue) chkContinue.checked = autoContinueEnabled;
}

function startServiceCountdown(mode, isMatched, liveStatus) {
  stopServiceCountdown();
  const win = TIMED_OPENING_WINDOWS[mode];
  const bar = $('serviceCountdownBar');
  const reloadBtn = $('btnReloadPortalTab');
  if (!win || !bar) return;

  syncAutomationCheckboxes({ isTimed: Boolean(isMatched) });

  // Keep on-page widget available with Auto Fill even when form is open
  if (isMatched && liveStatus?.hasForm) {
    bar.classList.add('hidden');
    syncOnPageTimerWidget(true, mode, { hasForm: true });
    syncBackgroundWatcher(false, mode, true);
    return;
  }

  const labelEl = $('countdownLabel');
  const digitsEl = $('countdownTimer');
  const clockEl = $('countdownIstClock');

  bar.classList.remove('hidden');
  if (reloadBtn) reloadBtn.classList.toggle('hidden', !isMatched);

  const isQuotaFull = Boolean(isMatched && liveStatus?.quotaFullAlert);

  const update = () => {
    if (vault.bookingMode !== mode) {
      stopServiceCountdown();
      return;
    }
    const state = getTimedWindowState(mode);
    if (!state) return;

    clockEl.textContent = formatIstClock(state.ist);

    if (isQuotaFull) {
      bar.classList.remove('ready');
      labelEl.textContent = autoReloadEnabled ? 'Quota Full — Retrying' : 'Quota Full on Page';
      digitsEl.textContent = autoReloadEnabled ? 'Auto-reloading (2s)' : 'Click ↻ to retry';
      return;
    }

    if (state.phase === 'before_open') {
      bar.classList.remove('ready');
      labelEl.textContent = `Opens in`;
      digitsEl.textContent = formatCountdownDuration(state.remainingSec);
    } else if (state.phase === 'after_close') {
      bar.classList.remove('ready');
      labelEl.textContent = `Next opens in`;
      digitsEl.textContent = formatCountdownDuration(state.remainingSec);
    } else {
      bar.classList.add('ready');
      if (isMatched && !liveStatus?.hasForm) {
        labelEl.textContent = 'Window OPEN —';
        digitsEl.textContent = autoReloadEnabled ? 'Auto-reloading...' : 'Reload Tab Now!';
        if (autoReloadEnabled && autoReloadTriggeredForTarget !== state.targetKey) {
          autoReloadTriggeredForTarget = state.targetKey;
          syncBackgroundWatcher(true, mode, false);
        }
      } else {
        labelEl.textContent = 'Window OPEN · Closes in';
        digitsEl.textContent = formatCountdownDuration(state.remainingToCloseSec);
      }
    }
  };

  update();
  countdownTimerId = setInterval(update, 250);

  if (isMatched) {
    const initialState = getTimedWindowState(mode);
    const shouldRetryNow = Boolean(autoReloadEnabled && (isQuotaFull || (initialState?.phase === 'open' && !liveStatus?.hasForm)));
    const shouldShowPageTimer = initialState && (initialState.phase === 'before_open' || !liveStatus?.hasForm);
    syncOnPageTimerWidget(Boolean(shouldShowPageTimer), mode, {
      statusBanner: shouldRetryNow
        ? (isQuotaFull ? '⏳ Quota full — retrying in 2s...' : '⏳ Waiting for form — reloading in 2s...')
        : '',
      retrying: shouldRetryNow,
    });
    if (autoReloadEnabled && !liveStatus?.isRestricted) {
      syncBackgroundWatcher(true, mode, !shouldRetryNow);
    }
  }
}

async function readLivePageStatus(forceRefresh = false) {
  if (!activeTabInfo.onPortal || activeTabInfo.detectedMode !== vault.bookingMode) {
    lastLivePageStatus = null;
    return null;
  }
  if (!forceRefresh && lastLivePageStatus && lastLivePageStatus.mode === vault.bookingMode) {
    return lastLivePageStatus;
  }
  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'READ_LIVE_PAGE_STATUS' }, (r) => {
      if (chrome.runtime.lastError) return resolve({ ok: false });
      resolve(r || { ok: false });
    });
  });
  lastLivePageStatus = res?.ok ? { ...res, mode: vault.bookingMode } : null;
  return lastLivePageStatus;
}

function formatCompactDates(isoList) {
  if (!isoList || isoList.length === 0) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return isoList
    .map((s) => {
      const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${Number(m[3])} ${months[Number(m[2]) - 1]}` : s;
    })
    .join(', ');
}

function getMonthRange(year, monthIndex0) {
  const start = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, monthIndex0 + 1, 0).getDate();
  const end = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return { start, end, label: `${months[monthIndex0]} ${year}` };
}

async function fetchAdvanceBhasmaOpenDates(forceRefresh = false) {
  if (!forceRefresh && cachedAdvanceBhasma) return cachedAdvanceBhasma;

  const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayIso = nowIst.toISOString().slice(0, 10);
  const y = nowIst.getUTCFullYear();
  const m = nowIst.getUTCMonth();
  const m0 = getMonthRange(y, m);
  const m1 = getMonthRange(m === 11 ? y + 1 : y, (m + 1) % 12);
  const m2 = getMonthRange(m >= 10 ? y + 1 : y, (m + 2) % 12);

  const fetchRange = (range) =>
    new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'FETCH_ADVANCE_BHASMA_DATES', startDate: range.start, endDate: range.end },
        (r) => {
          if (chrome.runtime.lastError) return resolve({ ok: false, days: [] });
          resolve(r || { ok: false, days: [] });
        }
      );
    });

  const [r0, r1, r2] = await Promise.all([fetchRange(m0), fetchRange(m1), fetchRange(m2)]);
  const allDays = [...(r0.days || []), ...(r1.days || []), ...(r2.days || [])].filter(
    (d) => String(d?.date || '') >= todayIso
  );
  const openDates = allDays.filter((d) => d.limit_available && !d.is_restricted).map((d) => d.date);
  const restrictedDates = allDays.filter((d) => d.is_restricted).map((d) => d.date);

  cachedAdvanceBhasma = {
    ok: Boolean(r0.ok || r1.ok || r2.ok),
    windowLabel: `${m0.label} – ${m2.label}`,
    openDates,
    restrictedDates,
  };
  return cachedAdvanceBhasma;
}

async function fetchRestrictedDatesCached() {
  if (cachedRestrictedDates !== null) return cachedRestrictedDates;
  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'FETCH_RESTRICTED_DATES' }, (r) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, dates: [] });
      resolve(r || { ok: false, dates: [] });
    });
  });
  cachedRestrictedDates = Array.isArray(res.dates) ? res.dates : [];
  return cachedRestrictedDates;
}

async function renderServiceLiveInfo(forceRefresh = false) {
  const infoBox = $('serviceLiveInfo');
  const sheeghraBox = $('sheeghraSlotControls');
  const dharmshalaBox = $('dharmshalaRoomControls');
  const refreshBtn = $('btnRefreshServiceInfo');
  const badge = $('serviceWindowBadge');
  if (!infoBox || !sheeghraBox || !badge) return;

  const mode = vault.bookingMode;
  const isSheeghra = mode === 'sheeghra_darshan';
  const isDharmshala = mode === 'dharmshala';
  const isMatched = activeTabInfo.onPortal && activeTabInfo.detectedMode === mode;

  sheeghraBox.classList.toggle('hidden', !isSheeghra);
  if (dharmshalaBox) dharmshalaBox.classList.toggle('hidden', !isDharmshala);
  infoBox.classList.toggle('hidden', isSheeghra || isDharmshala);

  if (isSheeghra) {
    stopServiceCountdown();
    if (refreshBtn) refreshBtn.classList.add('hidden');
    badge.className = 'window-badge open';
    badge.textContent = vault.lang === 'hi' ? '● 16-दिन विंडो' : '● 16-Day Rolling Window';
    syncAutomationCheckboxes({ isTimed: false });
    if (isMatched) {
      syncOnPageTimerWidget(true, 'sheeghra_darshan', {
        hasForm: Boolean(lastLivePageStatus?.hasForm),
        statusBanner: '● Sheeghra Form Ready — Click Auto Fill!',
      });
    }
    renderReadinessLine();
    return;
  }

  if (isDharmshala) {
    stopServiceCountdown();
    if (refreshBtn) refreshBtn.classList.add('hidden');
    syncAutomationCheckboxes({ isTimed: false });
    renderDharmshalaPrefs();
    fetchDharmshalaRoomsAvailability(forceRefresh);
    if (isMatched) {
      syncOnPageTimerWidget(true, 'dharmshala', {
        hasForm: Boolean(lastLivePageStatus?.hasForm),
        statusBanner: '● Dharmshala Booking — Click Auto Fill!',
      });
    }
    renderReadinessLine();
    return;
  }

  const reqEl = $('serviceReqSummary');
  const schedEl = $('serviceScheduleText');
  if (refreshBtn) refreshBtn.classList.toggle('hidden', mode !== 'advance_bhasma_aarti' && !isMatched);
  const ist = getIstParts();
  const mins = ist.hour * 60 + ist.minute;

  if (mode === 'advance_bhasma_aarti') {
    stopServiceCountdown();
    syncAutomationCheckboxes({ isTimed: false });
    if (isMatched) {
      syncOnPageTimerWidget(true, 'advance_bhasma_aarti', {
        hasForm: Boolean(lastLivePageStatus?.hasForm),
      });
    }
    badge.className = 'window-badge';
    badge.textContent = 'Checking live dates...';
    reqEl.textContent = 'Needs: Name, Photo, Relation, ID';
    schedEl.textContent = 'Checking Advance Bhasma Aarti calendar availability...';
    renderReadinessLine();
    const adv = await fetchAdvanceBhasmaOpenDates(forceRefresh);
    if (vault.bookingMode !== 'advance_bhasma_aarti') return;
    if (!adv.ok) {
      badge.className = 'window-badge';
      badge.textContent = '● Advance Calendar';
      schedEl.textContent = 'Open Advance Bhasma page and click ↻ to check live open dates (₹200/person).';
      return;
    }
    if (adv.openDates.length > 0) {
      badge.className = 'window-badge open';
      badge.textContent = `● ${adv.openDates.length} Open Date(s) (${adv.windowLabel})`;
      const preview = formatCompactDates(adv.openDates.slice(0, 8));
      const more = adv.openDates.length > 8 ? ` +${adv.openDates.length - 8} more` : '';
      schedEl.textContent = `Green available dates: ${preview}${more}. Open Advance Bhasma page to select & fill!`;
    } else {
      badge.className = 'window-badge';
      badge.textContent = `● 0 Open Dates (${adv.windowLabel})`;
      const restrPreview = adv.restrictedDates.length > 0
        ? ` Restricted: ${formatCompactDates(adv.restrictedDates.slice(0, 6))}${adv.restrictedDates.length > 6 ? ` (+${adv.restrictedDates.length - 6})` : ''}.`
        : '';
      schedEl.textContent = `All dates currently grey/full in ${adv.windowLabel}.${restrPreview} Click ↻ later to re-check.`;
    }
    renderReadinessLine();
    return;
  }

  const reqByMode = {
    bhasma_aarti: 'Needs: Name, Photo, Relation, ID',
    sandhya_aarti: 'Needs: Name, Age, Gender, Photo, ID',
    shayan_aarti: 'Needs: Name, Age, Gender, Photo, ID',
    dharmshala: 'Needs: Devotees + Contact/Address tab',
  };
  reqEl.textContent = reqByMode[mode] || '';

  // When already on the matching live portal page, read the actual rendered status banner/form state first!
  if (isMatched) {
    const live = await readLivePageStatus(forceRefresh);
    if (vault.bookingMode !== mode) return;
    renderPortalLauncher(live);
    startServiceCountdown(mode, true, live);

    if (live?.quotaFullAlert || live?.dangerAlert) {
      badge.className = 'window-badge closed';
      badge.textContent = '✕ Quota Full / Not Available on Page';
      const datePrefix = live.dateText ? `${live.dateText} · ` : '';
      const alertMsg = live.quotaFullAlert || live.dangerAlert;
      schedEl.textContent = `${datePrefix}Website says: "${alertMsg}"`;
      return;
    }
    if (live?.hasForm) {
      badge.className = 'window-badge open';
      badge.textContent = '● Booking Open — Form Ready';
      const datePrefix = live.dateText ? `${live.dateText} · ` : '';
      schedEl.textContent = live.successAlert
        ? `${datePrefix}${live.successAlert}`
        : `${datePrefix}Live booking form detected on page. Select devotees & click Set Persons & Fill.`;
      return;
    }
    if (live?.infoAlert) {
      badge.className = 'window-badge';
      badge.textContent = '⏰ Closed / Waiting on Page';
      const datePrefix = live.dateText ? `${live.dateText} · ` : '';
      schedEl.textContent = `${datePrefix}Website says: "${live.infoAlert}"`;
      return;
    }
  } else {
    startServiceCountdown(mode, false, null);
  }

  const allRestricted = await fetchRestrictedDatesCached();
  const upcomingBlocked = allRestricted
    .filter((r) => {
      const slug = String(r?.darshan_type?.slug || '').toLowerCase();
      const d = String(r?.date || '').slice(0, 10);
      if (!d || d < ist.iso) return false;
      if (mode === 'sandhya_aarti') return slug.includes('sandhya');
      if (mode === 'shayan_aarti') return slug.includes('shayan');
      if (mode === 'bhasma_aarti') return slug.includes('bhasm');
      return true;
    })
    .slice(0, 3)
    .map((r) => String(r.date).slice(0, 10));

  const blockedNote = upcomingBlocked.length > 0
    ? ` · Restricted dates: ${upcomingBlocked.join(', ')}`
    : '';

  if (mode === 'bhasma_aarti') {
    const isOpen = ist.hour >= 8;
    badge.className = 'window-badge';
    badge.textContent = isOpen ? '⏰ Window Active (8 AM+ IST)' : '⏰ Opens Today 8:00 AM IST';
    schedEl.textContent = `Daily Tatkal Bhasma Aarti opens at 8:00 AM IST for tomorrow's darshan (Free · ₹0). Open page to check live quota${blockedNote}.`;
  } else if (mode === 'sandhya_aarti') {
    const isOpen = mins >= 12 * 60 && mins < 18 * 60 + 30;
    badge.className = 'window-badge';
    badge.textContent = isOpen ? '⏰ Window Active (12:00 – 6:30 PM IST)' : '⏰ Opens Daily 12:00 PM – 6:30 PM IST';
    schedEl.textContent = `Same-day Sandhya Aarti (${ist.ddmmyyyy}). Open page to verify live quota availability${blockedNote}.`;
  } else if (mode === 'shayan_aarti') {
    const isOpen = ist.hour >= 16 && ist.hour < 22;
    badge.className = 'window-badge';
    badge.textContent = isOpen ? '⏰ Window Active (4:00 – 10:00 PM IST)' : '⏰ Opens Daily 4:00 PM – 10:00 PM IST';
    schedEl.textContent = `Same-day Shayan Aarti (${ist.ddmmyyyy}). Open page to verify live quota availability${blockedNote}.`;
  }
  renderReadinessLine();
}

const $ = (id) => document.getElementById(id);

function showStatus(message, type = 'ok') {
  const el = $('statusBanner');
  el.textContent = message;
  el.className = `status-banner ${type}`;
  clearTimeout(showStatus._timer);
  showStatus._timer = setTimeout(() => {
    el.classList.add('hidden');
  }, 6000);
}

function maskIdNumber(num) {
  const s = String(num || '').trim();
  if (s.length <= 4) return s;
  return '•••• ' + s.slice(-4);
}

function initialsOf(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || '?';
}

function getSelectedDevotees() {
  const selectedSet = new Set(vault.selectedIds || []);
  const maxAllowed = getMaxPersonsForMode(vault.bookingMode);
  return vault.devotees.filter((d) => selectedSet.has(d.id)).slice(0, maxAllowed);
}

function detectPortalModeFromUrl(urlStr) {
  if (!urlStr) return { onPortal: false, detectedMode: null };
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    const onPortal = /(^|\.)(shrimahakaleshwar\.mp\.gov\.in|mahakaleshwar\.mp\.gov\.in|mponline\.gov\.in)$/i.test(host);
    if (!onPortal) return { onPortal: false, detectedMode: null };

    const full = (u.pathname + u.search).toLowerCase();
    if (full.includes('sheeghra-darshan') || full.includes('shighra-darshan')) {
      return { onPortal: true, detectedMode: 'sheeghra_darshan' };
    }
    if (full.includes('advance-bhasmaarti') || full.includes('bhasmaarti-request')) {
      return { onPortal: true, detectedMode: 'advance_bhasma_aarti' };
    }
    if (full.includes('bhasmaarti') || full.includes('bhasm-aarti')) {
      return { onPortal: true, detectedMode: 'bhasma_aarti' };
    }
    if (full.includes('sandhya-aarti')) {
      return { onPortal: true, detectedMode: 'sandhya_aarti' };
    }
    if (full.includes('shayan-aarti')) {
      return { onPortal: true, detectedMode: 'shayan_aarti' };
    }
    if (full.includes('dharmshala')) {
      return { onPortal: true, detectedMode: 'dharmshala' };
    }
    return { onPortal: true, detectedMode: null };
  } catch (_) {
    return { onPortal: false, detectedMode: null };
  }
}

async function syncWithActivePortalTab() {
  try {
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (t) => resolve(t || []));
    });
    const tab = tabs[0];
    const url = tab?.url || '';
    const { onPortal, detectedMode } = detectPortalModeFromUrl(url);
    activeTabInfo = { id: tab?.id || null, url, detectedMode, onPortal };

    // Auto-switch the extension mode to match the open Mahakaleshwar page!
    if (detectedMode && vault.bookingMode !== detectedMode) {
      vault.bookingMode = detectedMode;
      vault = await saveVault(vault);
    }
  } catch (_) {}
}

async function openPortalModePage(mode) {
  const targetUrl = PORTAL_URLS[mode] || PORTAL_URLS.sheeghra_darshan;
  vault.bookingMode = mode;
  vault = await saveVault(vault);
  renderModeBar();

  // If already on shrimahakaleshwar.mp.gov.in, navigate in the same tab so they stay in session; otherwise open a new tab
  if (activeTabInfo.onPortal && activeTabInfo.id) {
    chrome.tabs.update(activeTabInfo.id, { url: targetUrl });
    activeTabInfo.detectedMode = mode;
    activeTabInfo.url = targetUrl;
    lastLivePageStatus = null;
    renderPortalLauncher();
    renderServiceLiveInfo(false);
    showStatus(`Switched tab to ${MODE_LABELS[mode]}...`, 'info');
  } else {
    chrome.tabs.create({ url: targetUrl });
    showStatus(`Opening ${MODE_LABELS[mode]} in new tab...`, 'info');
  }
}

function renderPortalLauncher(liveStatus = null) {
  const dot = $('portalStatusDot');
  const txt = $('portalStatusText');
  const btnPortal = $('btnOpenPortal');
  if (!dot || !txt) return;

  const t = I18N[vault.lang === 'hi' ? 'hi' : 'en'];
  const isMatched = activeTabInfo.onPortal && activeTabInfo.detectedMode === vault.bookingMode;

  if (isMatched) {
    if (liveStatus?.quotaFullAlert || liveStatus?.dangerAlert) {
      dot.className = 'status-dot closed';
      txt.textContent = `${MODE_LABELS[vault.bookingMode]} — Quota Full on Page`;
    } else if (liveStatus && !liveStatus.hasForm && liveStatus.infoAlert) {
      dot.className = 'status-dot';
      txt.textContent = `${MODE_LABELS[vault.bookingMode]} — Closed on Page`;
    } else {
      dot.className = 'status-dot connected';
      txt.textContent = `${MODE_LABELS[vault.bookingMode]} — Form Ready`;
    }
    if (btnPortal) btnPortal.textContent = t.portalOk;
  } else if (activeTabInfo.onPortal && activeTabInfo.detectedMode) {
    dot.className = 'status-dot';
    txt.textContent = `Tab on ${MODE_LABELS[activeTabInfo.detectedMode]}`;
    if (btnPortal) btnPortal.textContent = t.switchPortal;
  } else {
    dot.className = 'status-dot';
    txt.textContent = `${MODE_LABELS[vault.bookingMode]} — Not on portal`;
    if (btnPortal) btnPortal.textContent = t.openPortal;
  }
}

function renderModeBar() {
  document.querySelectorAll('.mode-pill').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === vault.bookingMode);
  });
  renderPortalLauncher();
  renderServiceLiveInfo();
}

function getDefaultTomorrowIso() {
  const istTomorrow = new Date(Date.now() + (5.5 + 24) * 60 * 60 * 1000);
  return istTomorrow.toISOString().slice(0, 10);
}

function getSheeghraMaxIso() {
  const istMax = new Date(Date.now() + (5.5 + 15 * 24) * 60 * 60 * 1000);
  return istMax.toISOString().slice(0, 10);
}

function renderSlotPrefs() {
  const todayIso = getIstParts().iso;
  const maxIso = getSheeghraMaxIso();
  const dateEl = $('sDate');
  if (!dateEl) return;
  dateEl.min = todayIso;
  dateEl.max = maxIso;
  let prefDate = vault.bookingPrefs?.preferredDate || '';
  if (!prefDate || prefDate < todayIso || prefDate > maxIso) {
    prefDate = getDefaultTomorrowIso();
  }
  dateEl.value = prefDate;
}

async function fetchLiveSheeghraSlots(isoDate, silent = false) {
  const selectEl = $('sSlot');
  const metaEl = $('slotMeta');
  if (!selectEl || !isoDate) return;

  metaEl.textContent = 'loading...';
  selectEl.innerHTML = '<option value="">Loading live slots...</option>';

  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'FETCH_SHEEGHRA_SLOTS', date: isoDate }, (r) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
      resolve(r || { ok: false, error: 'No response' });
    });
  });

  if (!res.ok) {
    metaEl.textContent = 'offline';
    selectEl.innerHTML = '<option value="">-- Open portal to select slot --</option>';
    if (!silent) showStatus(`Live slot check failed: ${res.error}`, 'info');
    return;
  }

  const allSlots = res.slots || [];
  const activeSlots = allSlots.filter(
    (s) => String(s.status || '').toLowerCase() === 'active' && Number(s.remaining_limit || 0) > 0
  );

  metaEl.textContent = `${activeSlots.length}/${allSlots.length} open`;
  selectEl.innerHTML = '';

  if (activeSlots.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No active slots open on this date';
    selectEl.appendChild(opt);
    if (!silent) showStatus(`No active Sheeghra Darshan slots open on ${isoDate}. Try another date.`, 'info');
    return;
  }

  const savedSlot = vault.bookingPrefs?.preferredSlot || '';
  let matchedSaved = false;

  for (const s of activeSlots) {
    const labelTime = `${s.from_time} To ${s.to_time}`;
    const opt = document.createElement('option');
    opt.value = labelTime;
    opt.textContent = `${labelTime} (${s.remaining_limit} avail · ₹250)`;
    if (savedSlot && savedSlot.toLowerCase() === labelTime.toLowerCase()) {
      opt.selected = true;
      matchedSaved = true;
    }
    selectEl.appendChild(opt);
  }

  if (!matchedSaved && selectEl.options.length > 0) {
    vault.bookingPrefs = {
      ...(vault.bookingPrefs || {}),
      preferredDate: isoDate,
      preferredSlot: selectEl.value,
    };
    vault = await saveVault(vault);
  }
}

function addDaysIso(isoStr, days) {
  const base = Date.parse(`${isoStr}T00:00:00Z`);
  if (!Number.isFinite(base)) return getDefaultTomorrowIso();
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

function renderDharmshalaPrefs() {
  const inEl = $('dCheckIn');
  const outEl = $('dCheckOut');
  if (!inEl || !outEl) return;
  const minIn = getDefaultTomorrowIso();
  const maxDate = addDaysIso(getIstParts().iso, 31);
  inEl.min = minIn;
  inEl.max = maxDate;

  let checkIn = vault.bookingPrefs?.dCheckIn || minIn;
  if (checkIn < minIn || checkIn > maxDate) checkIn = minIn;
  inEl.value = checkIn;

  const minOut = addDaysIso(checkIn, 1);
  outEl.min = minOut;
  outEl.max = addDaysIso(minIn, 32);
  let checkOut = vault.bookingPrefs?.dCheckOut || minOut;
  if (checkOut <= checkIn) checkOut = minOut;
  outEl.value = checkOut;
}

function renderSelectedDharmshalaSummary() {
  const selectEl = $('dProperty');
  const sumEl = $('dharmshalaRoomsSummary');
  if (!selectEl || !sumEl || !cachedDharmshalaAvailability?.ok) return;
  const chosen = cachedDharmshalaAvailability.results.find((d) => String(d.id) === String(selectEl.value));
  if (!chosen) return;
  const bookable = (chosen.rooms || []).filter((r) => r.is_booking_available && Number(r.max_available_rooms || 0) > 0);
  if (bookable.length === 0) {
    sumEl.textContent = `${chosen.name}: No rooms open for ${cachedDharmshalaAvailability.checkIn} → ${cachedDharmshalaAvailability.checkOut} (${cachedDharmshalaAvailability.noOfDays}d).`;
    return;
  }
  const preview = bookable
    .slice(0, 3)
    .map((r) => `${r.room_type}: ${r.max_available_rooms} avail (₹${r.charges})`)
    .join(' · ');
  const more = bookable.length > 3 ? ` +${bookable.length - 3} more` : '';
  sumEl.textContent = `${preview}${more}`;
}

async function fetchDharmshalaRoomsAvailability(forceRefresh = false) {
  const inEl = $('dCheckIn');
  const outEl = $('dCheckOut');
  const selectEl = $('dProperty');
  const metaEl = $('roomMeta');
  const sumEl = $('dharmshalaRoomsSummary');
  const badge = $('serviceWindowBadge');
  if (!inEl || !outEl || !selectEl || !sumEl) return;

  const checkIn = inEl.value || getDefaultTomorrowIso();
  const checkOut = outEl.value && outEl.value > checkIn ? outEl.value : addDaysIso(checkIn, 1);
  const cacheKey = `${checkIn}|${checkOut}`;

  if (forceRefresh || !cachedDharmshalaAvailability || cachedDharmshalaAvailability.cacheKey !== cacheKey) {
    metaEl.textContent = 'checking...';
    selectEl.innerHTML = '<option value="">Checking live rooms...</option>';
    sumEl.textContent = `Checking live Dharmshala rooms offline (${checkIn} → ${checkOut})...`;
    if (badge) {
      badge.className = 'window-badge';
      badge.textContent = 'Checking rooms...';
    }

    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'FETCH_DHARMASHALA_AVAILABILITY', checkIn, checkOut }, (r) => {
        if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
        resolve(r || { ok: false, error: 'No response' });
      });
    });

    if (vault.bookingMode !== 'dharmshala') return;
    if (!res.ok) {
      metaEl.textContent = 'offline';
      selectEl.innerHTML = '<option value="">-- Open Dharmshala page or retry --</option>';
      sumEl.textContent = res.error || 'Could not fetch live rooms. Click ↻ to retry.';
      if (badge) {
        badge.className = 'window-badge';
        badge.textContent = '● Offline Room Check';
      }
      return;
    }
    cachedDharmshalaAvailability = { ...res, cacheKey };
  }

  const results = cachedDharmshalaAvailability.results || [];
  const totalOpenRooms = results.reduce((s, d) => s + d.totalRoomsAvailable, 0);
  const openProps = results.filter((d) => d.totalRoomsAvailable > 0).length;
  metaEl.textContent = `${totalOpenRooms} rooms`;

  if (badge) {
    badge.className = totalOpenRooms > 0 ? 'window-badge open' : 'window-badge closed';
    badge.textContent = totalOpenRooms > 0
      ? `● ${totalOpenRooms} Open Room(s) (${openProps}/${results.length})`
      : `✕ 0 Rooms Open (${checkIn})`;
  }

  const savedId = String(vault.bookingPrefs?.dPropertyId || '');
  selectEl.innerHTML = '';
  for (const dh of results) {
    const opt = document.createElement('option');
    opt.value = String(dh.id);
    const rate = dh.minCharge ? ` · ₹${dh.minCharge}+` : '';
    opt.textContent = `${dh.name} (${dh.totalRoomsAvailable} avail${rate})`;
    if (savedId && savedId === String(dh.id)) opt.selected = true;
    selectEl.appendChild(opt);
  }
  if (!savedId) {
    const firstOpen = results.find((d) => d.totalRoomsAvailable > 0);
    if (firstOpen) selectEl.value = String(firstOpen.id);
  }
  renderSelectedDharmshalaSummary();
}

const I18N = {
  en: {
    brandSub: 'Encrypted Local Vault · Instant Darshan & Aarti',
    langBtn: 'हिं',
    openPortal: 'Open Portal ↗',
    switchPortal: 'Switch Tab ↗',
    portalOk: 'Portal ✓',
    autoReload: 'Auto-reload (2s)',
    autoFill: 'Auto-Fill',
    autoContinue: 'Auto-Continue',
    fillBtn: 'Fill Form',
    fillAndContinueBtn: 'Fill & Continue',
    addBtn: '+ Add',
    otpMob: '📱 Mob',
    tabDevotees: 'Devotees',
    tabContact: 'Contact & Address',
    tabTools: 'Tools & Backup',
    emptySelect: 'Select devotees below before filling.',
    missingPhoto: (n) => `${n} selected devotee(s) missing photo — required for Aarti.`,
    readyFree: (n, af, ac) => `Ready: ${n} · Free (₹0) · ${af ? 'Auto-Fill ON' : 'Manual Fill'}${ac ? ' + Continue' : ' (manual Continue)'}`,
    readyDefault: (n, af, ac) => `Ready: ${n} · ${af ? 'Auto-Fill ON' : 'Manual Fill'} · ${ac ? 'Auto-Continue ON' : 'Manual Continue'}`,
  },
  hi: {
    brandSub: 'सुरक्षित लोकल वॉल्ट · त्वरित दर्शन व आरती',
    langBtn: 'EN',
    openPortal: 'पोर्टल खोलें ↗',
    switchPortal: 'पेज बदलें ↗',
    portalOk: 'पोर्टल ✓',
    autoReload: 'ऑटो-रीलोड (2s)',
    autoFill: 'ऑटो-फ़िल',
    autoContinue: 'ऑटो-कंटिन्यू',
    fillBtn: 'फॉर्म भरें',
    fillAndContinueBtn: 'भरें व Continue',
    addBtn: '+ जोड़ें',
    otpMob: '📱 मोबाइल',
    tabDevotees: 'भक्त सूची',
    tabContact: 'संपर्क व पता',
    tabTools: 'टूल्स व बैकअप',
    emptySelect: 'फॉर्म भरने से पहले नीचे से भक्त चुनें।',
    missingPhoto: (n) => `चयनित ${n} भक्तों की फ़ोटो नहीं है — आरती के लिए आवश्यक।`,
    readyFree: (n, af, ac) => `तैयार: ${n} · निःशुल्क (₹0) · ${af ? 'ऑटो-फ़िल चालू' : 'मैन्युअल फ़िल'}${ac ? ' + Continue' : ' (मैन्युअल Continue)'}`,
    readyDefault: (n, af, ac) => `तैयार: ${n} · ${af ? 'ऑटो-फ़िल चालू' : 'मैन्युअल फ़िल'} · ${ac ? 'ऑटो-कंटिन्यू चालू' : 'मैन्युअल Continue'}`,
  },
};

function renderReadinessLine() {
  const el = $('lblSafetyNote');
  if (!el) return;
  const t = I18N[vault.lang === 'hi' ? 'hi' : 'en'];
  const selected = getSelectedDevotees();
  const needsPhoto = PHOTO_REQUIRED_MODES.has(vault.bookingMode);
  const missingPhoto = needsPhoto ? selected.filter((d) => !d.photo?.dataUrl) : [];

  if (selected.length === 0) {
    el.className = 'readiness-line warn';
    el.textContent = t.emptySelect;
  } else if (missingPhoto.length > 0) {
    el.className = 'readiness-line warn';
    el.textContent = t.missingPhoto(missingPhoto.length);
  } else {
    el.className = 'readiness-line ready';
    el.textContent = vault.bookingMode === 'bhasma_aarti'
      ? t.readyFree(selected.length, autoFillEnabled, autoContinueEnabled)
      : t.readyDefault(selected.length, autoFillEnabled, autoContinueEnabled);
  }
}

function applyLanguage() {
  const t = I18N[vault.lang === 'hi' ? 'hi' : 'en'];
  if ($('brandSub')) $('brandSub').textContent = t.brandSub;
  $('btnToggleLang').textContent = t.langBtn;
  $('lblFillBtn').textContent = autoContinueEnabled ? t.fillAndContinueBtn : t.fillBtn;
  $('btnAddDevotee').textContent = t.addBtn;
  $('btnFillMobile').textContent = t.otpMob;
  if ($('txtAutoReload')) $('txtAutoReload').textContent = t.autoReload;
  if ($('txtAutoFill')) $('txtAutoFill').textContent = t.autoFill;
  if ($('txtAutoContinue')) $('txtAutoContinue').textContent = t.autoContinue;
  const tabBtns = document.querySelectorAll('.tab-btn');
  if (tabBtns[0]) {
    tabBtns[0].childNodes[0].nodeValue = t.tabDevotees + ' ';
  }
  if (tabBtns[1]) tabBtns[1].textContent = t.tabContact;
  if (tabBtns[2]) tabBtns[2].textContent = t.tabTools;
  renderPortalLauncher(lastLivePageStatus);
  renderReadinessLine();
}

function renderContactForm() {
  const c = vault.contact || {};
  $('cMobile').value = c.mobile || '';
  $('cEmail').value = c.email || '';
  $('cAddress').value = c.address || '';
  $('cCity').value = c.city || '';
  $('cPincode').value = c.pincode || '';
  $('cState').value = c.state || 'Madhya Pradesh';
  $('cCountry').value = c.country || 'India';
  $('cGotra').value = c.gotra || '';
}

function getAutoSelectedIds(devotees, existingSelectedIds, mode) {
  const maxAllowed = getMaxPersonsForMode(mode);
  const validIds = new Set((devotees || []).map((d) => d.id));
  const cleaned = (existingSelectedIds || []).filter((id) => validIds.has(id)).slice(0, maxAllowed);
  if (cleaned.length > 0 || !devotees || devotees.length === 0) {
    return cleaned;
  }
  return devotees.slice(0, maxAllowed).map((d) => d.id);
}

function renderDevotees() {
  const listEl = $('devoteeList');
  const emptyEl = $('emptyDevotees');
  const selBar = $('devoteeSelectionBar');
  const selSummary = $('selectionSummary');
  const batchBar = $('batchQuickBar');
  const btnToggleAll = $('btnToggleSelectAll');
  const devotees = vault.devotees || [];
  const selectedSet = new Set(vault.selectedIds || []);

  const maxAllowed = getMaxPersonsForMode(vault.bookingMode);
  const selectedCount = Math.min(maxAllowed, devotees.filter((d) => selectedSet.has(d.id)).length);
  $('devoteeCountBadge').textContent = String(devotees.length);
  $('selectedCountLabel').textContent = String(selectedCount);
  if ($('maxPersonsLabel')) $('maxPersonsLabel').textContent = String(maxAllowed);

  if (selBar && selSummary && btnToggleAll) {
    if (devotees.length === 0) {
      selBar.classList.add('hidden');
    } else {
      selBar.classList.remove('hidden');
      const targetMax = Math.min(maxAllowed, devotees.length);
      selSummary.textContent = `${selectedCount} of ${devotees.length} checked for autofill`;
      btnToggleAll.textContent = selectedCount >= targetMax ? '☐ Uncheck All' : `☑ Select All (${targetMax})`;

      if (batchBar) {
        batchBar.innerHTML = '';
        if (devotees.length > maxAllowed) {
          batchBar.classList.remove('hidden');
          const totalBatches = Math.ceil(devotees.length / maxAllowed);
          for (let b = 0; b < totalBatches; b++) {
            const start = b * maxAllowed;
            const slice = devotees.slice(start, start + maxAllowed);
            const isExactBatch =
              slice.length === selectedCount && slice.every((d) => selectedSet.has(d.id));
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `btn-batch${isExactBatch ? ' active' : ''}`;
            btn.textContent = `Batch ${b + 1} (${start + 1}–${start + slice.length})`;
            btn.title = `Select devotees ${start + 1} to ${start + slice.length} for this booking`;
            btn.addEventListener('click', async () => {
              vault.selectedIds = slice.map((d) => d.id);
              vault = await saveVault(vault);
              renderDevotees();
            });
            batchBar.appendChild(btn);
          }
        } else {
          batchBar.classList.add('hidden');
        }
      }
    }
  }

  listEl.innerHTML = '';
  if (devotees.length === 0) {
    emptyEl.classList.remove('hidden');
    renderReadinessLine();
    return;
  }
  emptyEl.classList.add('hidden');
  renderReadinessLine();

  for (const dev of devotees) {
    const isSel = selectedSet.has(dev.id);
    const card = document.createElement('div');
    card.className = `devotee-card${isSel ? ' selected' : ''}`;

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'devotee-check';
    chk.checked = isSel;
    chk.title = 'Include in Fill Booking Form';
    chk.addEventListener('change', async () => {
      const set = new Set(vault.selectedIds || []);
      const maxAllowed = getMaxPersonsForMode(vault.bookingMode);
      if (chk.checked) {
        if (set.size >= maxAllowed) {
          chk.checked = false;
          showStatus(`${MODE_LABELS[vault.bookingMode]} allows max ${maxAllowed} persons per booking. Uncheck another devotee to swap.`, 'info');
          return;
        }
        set.add(dev.id);
      } else {
        set.delete(dev.id);
      }
      vault.selectedIds = [...set];
      vault = await saveVault(vault);
      renderDevotees();
    });

    let avatarEl;
    if (dev.photo?.dataUrl) {
      avatarEl = document.createElement('img');
      avatarEl.className = 'devotee-avatar';
      avatarEl.src = dev.photo.dataUrl;
      avatarEl.alt = dev.name;
    } else {
      avatarEl = document.createElement('div');
      avatarEl.className = 'devotee-avatar';
      avatarEl.textContent = initialsOf(dev.name);
    }

    const meta = document.createElement('div');
    meta.className = 'devotee-meta';

    const nameEl = document.createElement('div');
    nameEl.className = 'devotee-name';
    nameEl.textContent = dev.name;

    const subEl = document.createElement('div');
    subEl.className = 'devotee-sub';
    subEl.textContent = `${dev.age || '?'}y · ${dev.gender || ''} · ${dev.idType || 'ID'} ${maskIdNumber(dev.idNumber)}`;

    const pills = document.createElement('div');
    pills.className = 'devotee-pills';

    if (dev.relation) {
      const rp = document.createElement('span');
      rp.className = 'mini-pill';
      rp.textContent = dev.relation;
      pills.appendChild(rp);
    }
    if (dev.photo?.dataUrl) {
      const pp = document.createElement('span');
      pp.className = 'mini-pill has-doc';
      pp.textContent = '📷 Photo Ready';
      pills.appendChild(pp);
    } else if (PHOTO_REQUIRED_MODES.has(vault.bookingMode)) {
      const wp = document.createElement('span');
      wp.className = 'mini-pill warn-doc';
      wp.textContent = '⚠ Add Photo for Aarti';
      pills.appendChild(wp);
    }

    meta.append(nameEl, subEl, pills);

    const actions = document.createElement('div');
    actions.className = 'devotee-actions';

    const idx = devotees.indexOf(dev);
    if (idx > 0) {
      const btnUp = document.createElement('button');
      btnUp.className = 'icon-btn';
      btnUp.textContent = '↑';
      btnUp.title = 'Move up (set order in booking form)';
      btnUp.addEventListener('click', async () => {
        const arr = [...vault.devotees];
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        vault.devotees = arr;
        vault = await saveVault(vault);
        renderDevotees();
      });
      actions.appendChild(btnUp);
    }

    const btnFillOne = document.createElement('button');
    btnFillOne.className = 'icon-btn';
    btnFillOne.textContent = 'Fill';
    btnFillOne.title = 'Fill this devotee into the next empty form row';
    btnFillOne.addEventListener('click', () => runSingleDevoteeFill(dev));

    const btnEdit = document.createElement('button');
    btnEdit.className = 'icon-btn';
    btnEdit.textContent = '✎';
    btnEdit.title = 'Edit devotee';
    btnEdit.addEventListener('click', () => openDevoteeModal(dev));

    const btnDel = document.createElement('button');
    btnDel.className = 'icon-btn danger';
    btnDel.textContent = '✕';
    btnDel.title = 'Delete devotee';
    btnDel.addEventListener('click', async () => {
      if (btnDel.dataset.confirm !== '1') {
        btnDel.dataset.confirm = '1';
        btnDel.textContent = 'Sure?';
        setTimeout(() => {
          btnDel.dataset.confirm = '';
          btnDel.textContent = '✕';
        }, 2500);
        return;
      }
      vault.devotees = vault.devotees.filter((x) => x.id !== dev.id);
      vault.selectedIds = vault.selectedIds.filter((id) => id !== dev.id);
      vault = await saveVault(vault);
      renderDevotees();
      showStatus(`Removed ${dev.name} from local vault.`, 'info');
    });

    actions.append(btnFillOne, btnEdit, btnDel);
    card.append(chk, avatarEl, meta, actions);
    listEl.appendChild(card);
  }
}

function openDevoteeModal(dev = null) {
  if (!dev && vault.devotees.length >= MAX_DEVOTEES) {
    showStatus(`Vault limit reached (${MAX_DEVOTEES} devotees max). Delete an unused profile first.`, 'err');
    return;
  }
  $('modalTitle').textContent = dev ? 'Edit Devotee' : 'Add Family Devotee';
  $('dId').value = dev?.id || '';
  $('dName').value = dev?.name || '';
  $('dAge').value = dev?.age || '';
  $('dGender').value = dev?.gender || 'Male';
  $('dRelation').value = dev?.relation || 'Self';
  $('dIdType').value = dev?.idType === 'Passport' ? 'Passport' : 'Aadhaar Card';
  $('dIdNumber').value = dev?.idNumber || '';

  draftPhoto = dev?.photo || null;
  draftIdScan = dev?.idScan || null;
  updateFileLabels();

  $('devoteeModal').classList.remove('hidden');
  $('dName').focus();
}

function closeDevoteeModal() {
  $('devoteeModal').classList.add('hidden');
  $('dPhotoFile').value = '';
  draftPhoto = null;
  draftIdScan = null;
}

function updateFileLabels() {
  if (draftPhoto?.dataUrl) {
    $('photoPreviewText').textContent = `✓ Visitor Photo Ready (~${draftPhoto.approxKb || 30} KB)`;
    $('photoThumb').src = draftPhoto.dataUrl;
    $('photoThumb').classList.remove('hidden');
    $('btnClearPhoto').classList.remove('hidden');
  } else {
    $('photoPreviewText').textContent = '📷 Upload Visitor Photo (Auto-compressed JPEG)';
    $('photoThumb').classList.add('hidden');
    $('btnClearPhoto').classList.add('hidden');
  }
}

function sendAutofillAction(payload, allowAnyPage = false) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'RUN_AUTOFILL_ACTION', payload, allowAnyPage },
      (res) => {
        if (chrome.runtime.lastError) {
          return resolve({ ok: false, error: chrome.runtime.lastError.message });
        }
        resolve(res || { ok: false, error: 'No response from extension worker.' });
      }
    );
  });
}

async function runFullBookingFill() {
  const selected = getSelectedDevotees();
  if (selected.length === 0) {
    showStatus('Select at least 1 devotee checkbox to set Number of Persons & fill.', 'info');
    return;
  }
  const needsPhoto = PHOTO_REQUIRED_MODES.has(vault.bookingMode);
  const missingPhoto = needsPhoto ? selected.filter((d) => !d.photo?.dataUrl) : [];

  const preferredDate = $('sDate')?.value || vault.bookingPrefs?.preferredDate || '';
  const preferredSlot = $('sSlot')?.value || vault.bookingPrefs?.preferredSlot || '';
  showStatus(`Setting ${selected.length} person(s) & filling booking form...`, 'info');
  const res = await sendAutofillAction({
    action: 'FILL_BOOKING_FORM',
    bookingMode: vault.bookingMode,
    personCount: selected.length,
    preferredDate,
    preferredSlot,
    contact: vault.contact,
    devotees: selected,
    autoContinue: autoContinueEnabled,
  });
  if (!res.ok) {
    showStatus(res.error || 'Could not detect booking fields on this page.', 'err');
    return;
  }
  const photoNote = missingPhoto.length > 0
    ? ` (⚠ Add Visitor Photo in Edit for: ${missingPhoto.map((d) => d.name).join(', ')})`
    : '';
  showStatus((res.summary || `Filled ${res.filledCount || 0} field(s).`) + photoNote, 'ok');
}

async function runSingleDevoteeFill(devotee) {
  showStatus(`Filling ${devotee.name} into next empty row...`, 'info');
  const res = await sendAutofillAction({
    action: 'FILL_SINGLE_DEVOTEE',
    bookingMode: vault.bookingMode,
    contact: vault.contact,
    devotee,
  });
  if (!res.ok) {
    showStatus(res.error || 'No empty devotee fields found on this page.', 'err');
    return;
  }
  showStatus(res.summary || `Filled ${devotee.name} (${res.filledCount || 0} fields).`, 'ok');
}

async function runMobileOnlyFill() {
  if (!vault.contact?.mobile) {
    showStatus('Save your 10-digit Mobile Number in the Contact & Address tab first.', 'info');
    return;
  }
  const res = await sendAutofillAction({
    action: 'FILL_MOBILE_ONLY',
    contact: vault.contact,
  });
  if (!res.ok) {
    showStatus(res.error || 'No mobile input found on this page.', 'err');
    return;
  }
  showStatus(res.summary || 'Mobile filled. Request & enter OTP manually.', 'ok');
}

async function runContactFill() {
  const res = await sendAutofillAction({
    action: 'FILL_CONTACT_ONLY',
    contact: vault.contact,
  });
  if (!res.ok) {
    showStatus(res.error || 'Could not find contact fields on this page.', 'err');
    return;
  }
  showStatus(res.summary || `Filled ${res.filledCount || 0} contact/address fields.`, 'ok');
}

async function loadOptionalRemoteAd() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(REMOTE_AD_URL, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return;
    const ad = await res.json();
    if (ad && ad.enabled !== false && ad.title && ad.ctaUrl) {
      $('adTag').textContent = String(ad.tag || 'SPONSORED').slice(0, 18);
      $('adTitle').textContent = String(ad.title).slice(0, 80);
      const desc = String(ad.description || '').slice(0, 120);
      $('adDesc').textContent = desc;
      $('adDesc').classList.toggle('hidden', !desc);
      $('adCta').textContent = String(ad.ctaText || 'Visit →').slice(0, 20);
      $('adCta').href = String(ad.ctaUrl);
    }
  } catch (_) {
    // Gracefully keep default local KasyHQ spotlight card when offline or endpoint not configured yet
  }
}

function bindEvents() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // Booking mode — direct open/switch on portal when clicked
  document.querySelectorAll('.mode-pill').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetMode = btn.dataset.mode;
      const alreadyMatched = activeTabInfo.onPortal && activeTabInfo.detectedMode === targetMode;
      vault.bookingMode = targetMode;
      const maxAllowed = getMaxPersonsForMode(targetMode);
      if ((vault.selectedIds || []).length > maxAllowed) {
        vault.selectedIds = vault.selectedIds.slice(0, maxAllowed);
      }
      vault = await saveVault(vault);
      renderDevotees();
      if (!alreadyMatched) {
        await openPortalModePage(targetMode);
      } else {
        renderModeBar();
      }
      if (targetMode === 'sheeghra_darshan' && $('sDate')?.value) {
        fetchLiveSheeghraSlots($('sDate').value, true);
      }
    });
  });

  // Live Date & Slot selectors
  $('sDate')?.addEventListener('change', async () => {
    const newDate = $('sDate').value;
    vault.bookingPrefs = { ...(vault.bookingPrefs || {}), preferredDate: newDate };
    vault = await saveVault(vault);
    if (newDate) fetchLiveSheeghraSlots(newDate, false);
  });

  $('sSlot')?.addEventListener('change', async () => {
    vault.bookingPrefs = {
      ...(vault.bookingPrefs || {}),
      preferredDate: $('sDate')?.value || '',
      preferredSlot: $('sSlot').value,
    };
    vault = await saveVault(vault);
  });

  $('btnFetchSlots')?.addEventListener('click', () => {
    const d = $('sDate')?.value || getDefaultTomorrowIso();
    $('sDate').value = d;
    fetchLiveSheeghraSlots(d, false);
  });

  // Dharmshala Offline Room Availability controls
  $('dCheckIn')?.addEventListener('change', async () => {
    const inDate = $('dCheckIn').value || getDefaultTomorrowIso();
    let outDate = $('dCheckOut')?.value || '';
    if (!outDate || outDate <= inDate) {
      outDate = addDaysIso(inDate, 1);
      if ($('dCheckOut')) $('dCheckOut').value = outDate;
    }
    if ($('dCheckOut')) $('dCheckOut').min = addDaysIso(inDate, 1);
    vault.bookingPrefs = { ...(vault.bookingPrefs || {}), dCheckIn: inDate, dCheckOut: outDate };
    vault = await saveVault(vault);
    fetchDharmshalaRoomsAvailability(true);
  });

  $('dCheckOut')?.addEventListener('change', async () => {
    const inDate = $('dCheckIn')?.value || getDefaultTomorrowIso();
    let outDate = $('dCheckOut').value;
    if (!outDate || outDate <= inDate) {
      outDate = addDaysIso(inDate, 1);
      $('dCheckOut').value = outDate;
    }
    vault.bookingPrefs = { ...(vault.bookingPrefs || {}), dCheckIn: inDate, dCheckOut: outDate };
    vault = await saveVault(vault);
    fetchDharmshalaRoomsAvailability(true);
  });

  $('dProperty')?.addEventListener('change', async () => {
    vault.bookingPrefs = { ...(vault.bookingPrefs || {}), dPropertyId: $('dProperty').value };
    vault = await saveVault(vault);
    renderSelectedDharmshalaSummary();
  });

  $('btnFetchRooms')?.addEventListener('click', () => {
    fetchDharmshalaRoomsAvailability(true);
  });

  $('btnRefreshServiceInfo')?.addEventListener('click', () => {
    renderServiceLiveInfo(true);
  });

  $('btnReloadPortalTab')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RELOAD_ACTIVE_PORTAL_TAB' }, (r) => {
      if (!chrome.runtime.lastError && r?.ok) {
        showStatus('Reloading portal page...', 'info');
        setTimeout(() => renderServiceLiveInfo(true), 1400);
      } else {
        showStatus(r?.error || 'Could not reload portal tab.', 'err');
      }
    });
  });

  $('chkAutoReload')?.addEventListener('change', (e) => {
    autoReloadEnabled = Boolean(e.target.checked);
    try {
      localStorage.setItem('mahakalAutoReload', autoReloadEnabled ? '1' : '0');
    } catch (_) {}
    const isMatched = activeTabInfo.onPortal && activeTabInfo.detectedMode === vault.bookingMode;
    if (isMatched) {
      syncBackgroundWatcher(autoReloadEnabled, vault.bookingMode, false);
      renderServiceLiveInfo(false);
    }
    showStatus(
      autoReloadEnabled
        ? 'Auto-reload armed: reloads at 8:00 AM and keeps retrying every 2s while Quota Full until form opens.'
        : 'Auto-reload stopped.',
      'info'
    );
  });

  $('chkAutoFill')?.addEventListener('change', (e) => {
    autoFillEnabled = Boolean(e.target.checked);
    try {
      localStorage.setItem('mahakalAutoFill', autoFillEnabled ? '1' : '0');
    } catch (_) {}
    applyLanguage();
    const isMatched = activeTabInfo.onPortal && activeTabInfo.detectedMode === vault.bookingMode;
    syncBackgroundWatcher(autoReloadEnabled && isMatched, vault.bookingMode, true);
    if (isMatched) {
      syncOnPageTimerWidget(true, vault.bookingMode);
    }
    showStatus(
      autoFillEnabled
        ? 'Auto-Fill enabled: fills form automatically when opened (without clicking Continue unless Auto-Continue is checked).'
        : 'Auto-Fill disabled (click ⚡ Auto Fill manually).',
      'info'
    );
  });

  $('chkAutoContinue')?.addEventListener('change', (e) => {
    autoContinueEnabled = Boolean(e.target.checked);
    try {
      localStorage.setItem('mahakalAutoContinue', autoContinueEnabled ? '1' : '0');
    } catch (_) {}
    applyLanguage();
    const isMatched = activeTabInfo.onPortal && activeTabInfo.detectedMode === vault.bookingMode;
    syncBackgroundWatcher(autoReloadEnabled && isMatched, vault.bookingMode, true);
    if (isMatched) {
      syncOnPageTimerWidget(true, vault.bookingMode);
    }
    showStatus(
      autoContinueEnabled
        ? 'Auto-Continue enabled: clicks Continue automatically after fill & photo upload.'
        : 'Auto-Continue disabled (stops after filling so you click Continue manually).',
      'info'
    );
  });

  $('btnToggleLang').addEventListener('click', async () => {
    vault.lang = vault.lang === 'hi' ? 'en' : 'hi';
    vault = await saveVault(vault);
    applyLanguage();
  });

  $('btnOpenPortal').addEventListener('click', () => {
    openPortalModePage(vault.bookingMode);
  });

  $('btnFillAll').addEventListener('click', runFullBookingFill);
  $('btnFillMobile').addEventListener('click', runMobileOnlyFill);
  $('btnAddDevotee').addEventListener('click', () => openDevoteeModal(null));
  $('btnEmptyAdd').addEventListener('click', () => openDevoteeModal(null));
  $('btnToggleSelectAll')?.addEventListener('click', async () => {
    const devotees = vault.devotees || [];
    const maxAllowed = getMaxPersonsForMode(vault.bookingMode);
    const validSet = new Set(devotees.map((d) => d.id));
    const currentCount = (vault.selectedIds || []).filter((id) => validSet.has(id)).length;
    const targetMax = Math.min(maxAllowed, devotees.length);
    vault.selectedIds = currentCount >= targetMax
      ? []
      : devotees.slice(0, maxAllowed).map((d) => d.id);
    vault = await saveVault(vault);
    renderDevotees();
  });
  $('btnCloseModal').addEventListener('click', closeDevoteeModal);
  $('btnCancelModal').addEventListener('click', closeDevoteeModal);

  $('dPhotoFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      draftPhoto = await compressImageFile(file, 420, 0.78);
      updateFileLabels();
    } catch (err) {
      showStatus(err.message, 'err');
    }
  });

  $('btnClearPhoto').addEventListener('click', () => {
    draftPhoto = null;
    $('dPhotoFile').value = '';
    updateFileLabels();
  });

  // Save Devotee
  $('devoteeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const existingId = $('dId').value.trim();
    const record = {
      id: existingId || crypto.randomUUID(),
      name: $('dName').value.trim(),
      age: $('dAge').value.trim(),
      gender: $('dGender').value,
      relation: $('dRelation').value,
      idType: $('dIdType').value,
      idNumber: $('dIdNumber').value.trim(),
      photo: draftPhoto,
      idScan: draftIdScan,
    };

    if (!record.name || !record.idNumber) {
      showStatus('Full Name and ID Proof Number are required.', 'err');
      return;
    }

    if (existingId) {
      vault.devotees = vault.devotees.map((d) => (d.id === existingId ? record : d));
    } else {
      vault.devotees.push(record);
      const validIds = new Set(vault.devotees.map((d) => d.id));
      const cleanSelected = (vault.selectedIds || []).filter((id) => validIds.has(id));
      const maxAllowed = getMaxPersonsForMode(vault.bookingMode);
      if (cleanSelected.length < maxAllowed) {
        cleanSelected.push(record.id);
      }
      vault.selectedIds = cleanSelected;
    }

    vault = await saveVault(vault);
    closeDevoteeModal();
    renderDevotees();
    showStatus(`Saved ${record.name} in encrypted local vault.`, 'ok');
  });

  // Contact form
  $('contactForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    vault.contact = {
      mobile: $('cMobile').value.replace(/\D/g, '').slice(0, 10),
      email: $('cEmail').value.trim(),
      address: $('cAddress').value.trim(),
      city: $('cCity').value.trim(),
      pincode: $('cPincode').value.replace(/\D/g, '').slice(0, 6),
      state: $('cState').value,
      country: $('cCountry').value.trim() || 'India',
      gotra: $('cGotra').value.trim(),
    };
    vault = await saveVault(vault);
    renderContactForm();
    showStatus('Contact & address details saved securely on this device.', 'ok');
  });

  $('btnFillContact').addEventListener('click', async () => {
    vault.contact = {
      mobile: $('cMobile').value.replace(/\D/g, '').slice(0, 10),
      email: $('cEmail').value.trim(),
      address: $('cAddress').value.trim(),
      city: $('cCity').value.trim(),
      pincode: $('cPincode').value.replace(/\D/g, '').slice(0, 6),
      state: $('cState').value,
      country: $('cCountry').value.trim() || 'India',
      gotra: $('cGotra').value.trim(),
    };
    vault = await saveVault(vault);
    await runContactFill();
  });

  // Inspect Portal Form
  $('btnInspectPage').addEventListener('click', async () => {
    const res = await sendAutofillAction({ action: 'INSPECT_PAGE' }, true);
    if (!res.ok) {
      showStatus(res.error || 'Could not inspect this page.', 'err');
      return;
    }
    lastInspectJson = JSON.stringify(res.report, null, 2);
    $('inspectOutput').textContent = lastInspectJson;
    $('inspectOutput').classList.remove('hidden');
    $('btnCopyInspect').classList.remove('hidden');
    showStatus(`Found ${res.report.totalFields} visible form fields (${res.report.detectedRows} devotee row groups).`, 'ok');
  });

  $('btnCopyInspect').addEventListener('click', async () => {
    if (!lastInspectJson) return;
    try {
      await navigator.clipboard.writeText(lastInspectJson);
      showStatus('Copied form field map to clipboard!', 'ok');
    } catch (_) {
      showStatus('Could not copy automatically — select text from box below.', 'info');
    }
  });

  // Export / Import Vault Backup
  $('btnExportVault').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(vault, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mahakal-devotees-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showStatus('Exported devotee backup JSON.', 'ok');
  });

  $('inputImportVault').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.devotees)) {
        throw new Error('Invalid Mahakal Autofill backup JSON.');
      }
      const importedDevotees = parsed.devotees.slice(0, MAX_DEVOTEES);
      const targetMode = parsed.bookingMode || vault.bookingMode;
      vault = await saveVault({
        contact: { ...vault.contact, ...(parsed.contact || {}) },
        devotees: importedDevotees,
        selectedIds: getAutoSelectedIds(importedDevotees, parsed.selectedIds, targetMode),
        bookingMode: targetMode,
      });
      renderModeBar();
      renderContactForm();
      renderDevotees();
      showStatus(`Imported ${vault.devotees.length} devotee(s) successfully.`, 'ok');
    } catch (err) {
      showStatus(err.message || 'Failed to import backup.', 'err');
    } finally {
      e.target.value = '';
    }
  });
}

(async function init() {
  try {
    autoReloadEnabled = localStorage.getItem('mahakalAutoReload') === '1';
    autoFillEnabled = localStorage.getItem('mahakalAutoFill') === '1';
    autoContinueEnabled = localStorage.getItem('mahakalAutoContinue') === '1';
  } catch (_) {}
  try {
    const wRes = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_AUTO_WATCHER' }, (r) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(r);
      });
    });
    if (wRes?.ok && wRes.watcher) {
      if (typeof wRes.watcher.autoReload === 'boolean') autoReloadEnabled = wRes.watcher.autoReload;
      if (typeof wRes.watcher.autoFill === 'boolean') autoFillEnabled = wRes.watcher.autoFill;
      if (typeof wRes.watcher.autoContinue === 'boolean') autoContinueEnabled = wRes.watcher.autoContinue;
    }
  } catch (_) {}
  vault = await loadVault();
  await syncWithActivePortalTab();
  const autoIds = getAutoSelectedIds(vault.devotees, vault.selectedIds, vault.bookingMode);
  if (JSON.stringify(autoIds) !== JSON.stringify(vault.selectedIds || [])) {
    vault.selectedIds = autoIds;
    vault = await saveVault(vault);
  }
  applyLanguage();
  renderModeBar();
  renderSlotPrefs();
  renderContactForm();
  renderDevotees();
  bindEvents();
  if (vault.bookingMode === 'sheeghra_darshan' && $('sDate')?.value) {
    fetchLiveSheeghraSlots($('sDate').value, true);
  }
  loadOptionalRemoteAd();
})();
