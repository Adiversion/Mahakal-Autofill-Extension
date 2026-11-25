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
};

const MODE_LABELS = {
  sheeghra_darshan: 'Sheeghra Darshan',
  bhasma_aarti: 'Tatkal Bhasma Aarti',
  advance_bhasma_aarti: 'Advance Bhasma Aarti',
};

// Optional remote ad/sponsor endpoint (gracefully falls back to built-in KasyHQ card)
const REMOTE_AD_URL = 'https://kasyhq.com/api/mahakal-ad.json';

let vault = null;
let draftPhoto = null;
let draftIdScan = null;
let lastInspectJson = '';
let activeTabInfo = { id: null, url: '', detectedMode: null, onPortal: false };

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
  return vault.devotees.filter((d) => selectedSet.has(d.id));
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
    renderPortalLauncher();
    showStatus(`Opening ${MODE_LABELS[mode]} in current tab...`, 'info');
  } else {
    chrome.tabs.create({ url: targetUrl });
  }
}

function renderPortalLauncher() {
  const dot = $('portalStatusDot');
  const txt = $('portalStatusText');
  const btnGo = $('btnGoSelectedPage');
  const quickGrid = $('portalQuickGrid');
  if (!dot || !txt || !btnGo || !quickGrid) return;

  const isMatched = activeTabInfo.onPortal && activeTabInfo.detectedMode === vault.bookingMode;

  if (isMatched) {
    dot.className = 'status-dot connected';
    txt.textContent = `Connected to ${MODE_LABELS[vault.bookingMode]} — Ready to Fill`;
    btnGo.classList.add('hidden');
  } else if (activeTabInfo.onPortal && activeTabInfo.detectedMode) {
    dot.className = 'status-dot';
    txt.textContent = `Tab is on ${MODE_LABELS[activeTabInfo.detectedMode]}`;
    btnGo.textContent = `Open ${MODE_LABELS[vault.bookingMode]} ↗`;
    btnGo.classList.remove('hidden');
  } else if (activeTabInfo.onPortal) {
    dot.className = 'status-dot';
    txt.textContent = 'On Mahakaleshwar Portal — Pick booking page:';
    btnGo.classList.add('hidden');
  } else {
    dot.className = 'status-dot';
    txt.textContent = 'Open a Mahakaleshwar booking page to autofill:';
    btnGo.classList.add('hidden');
  }

  // Highlight whichever page is currently open in the browser tab
  quickGrid.querySelectorAll('.portal-jump-btn').forEach((btn) => {
    btn.classList.toggle('current', btn.dataset.openMode === activeTabInfo.detectedMode);
  });
}

function renderModeBar() {
  document.querySelectorAll('.mode-pill').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === vault.bookingMode);
  });
  const slotPanel = $('slotPanel');
  if (slotPanel) {
    slotPanel.classList.toggle('hidden', vault.bookingMode !== 'sheeghra_darshan');
  }
  renderPortalLauncher();
}

function getDefaultTomorrowIso() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function renderSlotPrefs() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const dateEl = $('sDate');
  if (!dateEl) return;
  dateEl.min = todayIso;
  let prefDate = vault.bookingPrefs?.preferredDate || '';
  if (!prefDate || prefDate < todayIso) {
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
      preferredDate: isoDate,
      preferredSlot: selectEl.value,
    };
    vault = await saveVault(vault);
  }
}

const I18N = {
  en: {
    langBtn: 'हिं',
    fillBtn: 'Set Persons & Fill',
    addBtn: '+ Add',
    otpMob: '📱 OTP Mob',
    safetyNote: 'Sets Number of Persons + Slot first, then fills devotee details locally. Pauses for OTP, CAPTCHA & payment.',
    tabDevotees: 'Devotees',
    tabContact: 'Contact & Address',
    tabTools: 'Tools & Backup',
  },
  hi: {
    langBtn: 'EN',
    fillBtn: 'व्यक्ति व फॉर्म भरें',
    addBtn: '+ जोड़ें',
    otpMob: '📱 मोबाइल',
    safetyNote: 'पहले व्यक्तियों की संख्या व स्लॉट सेट करता है, फिर भक्त विवरण भरता है। OTP/CAPTCHA पर रुकता है।',
    tabDevotees: 'भक्त सूची',
    tabContact: 'संपर्क व पता',
    tabTools: 'टूल्स व बैकअप',
  },
};

function applyLanguage() {
  const t = I18N[vault.lang === 'hi' ? 'hi' : 'en'];
  $('btnToggleLang').textContent = t.langBtn;
  $('lblFillBtn').textContent = t.fillBtn;
  $('btnAddDevotee').textContent = t.addBtn;
  $('btnFillMobile').textContent = t.otpMob;
  $('lblSafetyNote').textContent = t.safetyNote;
  const tabBtns = document.querySelectorAll('.tab-btn');
  if (tabBtns[0]) {
    tabBtns[0].childNodes[0].nodeValue = t.tabDevotees + ' ';
  }
  if (tabBtns[1]) tabBtns[1].textContent = t.tabContact;
  if (tabBtns[2]) tabBtns[2].textContent = t.tabTools;
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

function renderDevotees() {
  const listEl = $('devoteeList');
  const emptyEl = $('emptyDevotees');
  const devotees = vault.devotees || [];
  const selectedSet = new Set(vault.selectedIds || []);

  $('devoteeCountBadge').textContent = String(devotees.length);
  $('selectedCountLabel').textContent = String(
    devotees.filter((d) => selectedSet.has(d.id)).length
  );

  listEl.innerHTML = '';
  if (devotees.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

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
      if (chk.checked) {
        if (set.size >= MAX_PERSONS_PER_BOOKING) {
          chk.checked = false;
          showStatus(`Mahakaleshwar portal allows max ${MAX_PERSONS_PER_BOOKING} persons per booking. Uncheck another devotee to swap.`, 'info');
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
      pp.textContent = '📷 Photo';
      pills.appendChild(pp);
    }
    if (dev.idScan?.dataUrl) {
      const ip = document.createElement('span');
      ip.className = 'mini-pill has-doc';
      ip.textContent = '🪪 ID Scan';
      pills.appendChild(ip);
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

  const extras = $('bhasmaExtras');
  if (extras) {
    extras.open = Boolean(dev?.photo?.dataUrl || dev?.idScan?.dataUrl);
  }

  $('devoteeModal').classList.remove('hidden');
  $('dName').focus();
}

function closeDevoteeModal() {
  $('devoteeModal').classList.add('hidden');
  $('dPhotoFile').value = '';
  $('dIdFile').value = '';
  draftPhoto = null;
  draftIdScan = null;
}

function updateFileLabels() {
  if (draftPhoto?.dataUrl) {
    $('photoPreviewText').textContent = `✓ Photo (~${draftPhoto.approxKb || 30} KB)`;
    $('photoThumb').src = draftPhoto.dataUrl;
    $('photoThumb').classList.remove('hidden');
    $('btnClearPhoto').classList.remove('hidden');
  } else {
    $('photoPreviewText').textContent = '📷 Upload Photo';
    $('photoThumb').classList.add('hidden');
    $('btnClearPhoto').classList.add('hidden');
  }

  if (draftIdScan?.dataUrl) {
    $('idPreviewText').textContent = `✓ ID Scan (~${draftIdScan.approxKb || 45} KB)`;
    $('idThumb').src = draftIdScan.dataUrl;
    $('idThumb').classList.remove('hidden');
    $('btnClearIdFile').classList.remove('hidden');
  } else {
    $('idPreviewText').textContent = '🪪 Upload ID Scan';
    $('idThumb').classList.add('hidden');
    $('btnClearIdFile').classList.add('hidden');
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
  const isBhasma = vault.bookingMode === 'bhasma_aarti' || vault.bookingMode === 'advance_bhasma_aarti';
  const missingPhoto = isBhasma ? selected.filter((d) => !d.photo?.dataUrl) : [];

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
  });
  if (!res.ok) {
    showStatus(res.error || 'Could not detect booking fields on this page.', 'err');
    return;
  }
  const photoNote = missingPhoto.length > 0
    ? ` (Note: Bhasma Aarti requires a Photo — upload in Edit → Optional Bhasma Extras for ${missingPhoto.map((d) => d.name).join(', ')})`
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
      $('adDesc').textContent = String(ad.description || '').slice(0, 120);
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

  // Booking mode
  document.querySelectorAll('.mode-pill').forEach((btn) => {
    btn.addEventListener('click', async () => {
      vault.bookingMode = btn.dataset.mode;
      vault = await saveVault(vault);
      renderModeBar();
      if (vault.bookingMode === 'sheeghra_darshan' && $('sDate')?.value) {
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

  $('btnToggleLang').addEventListener('click', async () => {
    vault.lang = vault.lang === 'hi' ? 'en' : 'hi';
    vault = await saveVault(vault);
    applyLanguage();
  });

  $('btnOpenPortal').addEventListener('click', () => {
    openPortalModePage(vault.bookingMode);
  });

  $('btnGoSelectedPage')?.addEventListener('click', () => {
    openPortalModePage(vault.bookingMode);
  });

  document.querySelectorAll('.portal-jump-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      openPortalModePage(btn.dataset.openMode);
    });
  });

  $('btnFillAll').addEventListener('click', runFullBookingFill);
  $('btnFillMobile').addEventListener('click', runMobileOnlyFill);
  $('btnAddDevotee').addEventListener('click', () => openDevoteeModal(null));
  $('btnEmptyAdd').addEventListener('click', () => openDevoteeModal(null));
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

  $('dIdFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      draftIdScan = await compressImageFile(file, 720, 0.76);
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

  $('btnClearIdFile').addEventListener('click', () => {
    draftIdScan = null;
    $('dIdFile').value = '';
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
      if (vault.selectedIds.length < MAX_PERSONS_PER_BOOKING) {
        vault.selectedIds.push(record.id);
      }
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
      vault = await saveVault({
        contact: { ...vault.contact, ...(parsed.contact || {}) },
        devotees: parsed.devotees.slice(0, MAX_DEVOTEES),
        selectedIds: Array.isArray(parsed.selectedIds)
          ? parsed.selectedIds
          : parsed.devotees.slice(0, 4).map((d) => d.id),
        bookingMode: parsed.bookingMode || vault.bookingMode,
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
  vault = await loadVault();
  await syncWithActivePortalTab();
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
