// Mahakal Darshan Autofill — AES-256-GCM Encrypted Local Devotee Vault
// Stores up to 20 family devotees (including compressed photos & ID proofs) + primary contact details
// strictly in local chrome.storage.local — zero data ever leaves the user's browser.

const VAULT_KEY = 'mahakalVaultEncV1';
const KEY_MATERIAL_KEY = 'mahakalVaultKeyV1';
export const MAX_DEVOTEES = 20;
export const MAX_PERSONS_PER_BOOKING = 6;

export const DEFAULT_VAULT = {
  contact: {
    mobile: '',
    email: '',
    address: '',
    city: '',
    state: 'Madhya Pradesh',
    pincode: '',
    country: 'India',
    gotra: '',
  },
  devotees: [],
  selectedIds: [],
  bookingMode: 'sheeghra_darshan', // 'sheeghra_darshan' | 'bhasma_aarti'
  bookingPrefs: {
    preferredDate: '', // YYYY-MM-DD
    preferredSlot: '', // e.g. "06:00 AM To 07:00 AM"
  },
  lang: 'en', // 'en' | 'hi'
};

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (res) => resolve(res || {}));
  });
}

function storageSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve();
    });
  });
}

async function getOrCreateAesKey() {
  const stored = await storageGet([KEY_MATERIAL_KEY]);
  let rawBytes;
  if (stored[KEY_MATERIAL_KEY]) {
    rawBytes = base64ToBytes(stored[KEY_MATERIAL_KEY]);
  } else {
    rawBytes = crypto.getRandomValues(new Uint8Array(32));
    await storageSet({ [KEY_MATERIAL_KEY]: bytesToBase64(rawBytes) });
  }
  return crypto.subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function loadVault() {
  try {
    const stored = await storageGet([VAULT_KEY]);
    const enc = stored[VAULT_KEY];
    if (!enc || !enc.iv || !enc.ct) {
      return structuredClone(DEFAULT_VAULT);
    }
    const key = await getOrCreateAesKey();
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(enc.iv) },
      key,
      base64ToBytes(enc.ct)
    );
    const parsed = JSON.parse(new TextDecoder().decode(plainBuf));
    const rawMode = parsed.bookingMode;
    const normalizedMode =
      (rawMode === 'shighra_darshan' || rawMode === 'sheeghra_darshan') ? 'sheeghra_darshan'
        : rawMode === 'advance_bhasma_aarti' ? 'advance_bhasma_aarti'
        : 'bhasma_aarti';
    return {
      contact: { ...DEFAULT_VAULT.contact, ...(parsed.contact || {}) },
      devotees: Array.isArray(parsed.devotees) ? parsed.devotees.slice(0, MAX_DEVOTEES) : [],
      selectedIds: Array.isArray(parsed.selectedIds) ? parsed.selectedIds.slice(0, MAX_PERSONS_PER_BOOKING) : [],
      bookingMode: normalizedMode,
      bookingPrefs: { ...DEFAULT_VAULT.bookingPrefs, ...(parsed.bookingPrefs || {}) },
      lang: parsed.lang === 'hi' ? 'hi' : 'en',
    };
  } catch (err) {
    console.warn('[MahakalVault] Failed to decrypt vault, initializing clean state:', err?.message);
    return structuredClone(DEFAULT_VAULT);
  }
}

export async function saveVault(vault) {
  const rawMode = vault.bookingMode;
  const normalizedMode =
    (rawMode === 'shighra_darshan' || rawMode === 'sheeghra_darshan') ? 'sheeghra_darshan'
      : rawMode === 'advance_bhasma_aarti' ? 'advance_bhasma_aarti'
      : 'bhasma_aarti';
  const clean = {
    contact: { ...DEFAULT_VAULT.contact, ...(vault.contact || {}) },
    devotees: Array.isArray(vault.devotees) ? vault.devotees.slice(0, MAX_DEVOTEES) : [],
    selectedIds: Array.isArray(vault.selectedIds) ? vault.selectedIds.slice(0, MAX_PERSONS_PER_BOOKING) : [],
    bookingMode: normalizedMode,
    bookingPrefs: { ...DEFAULT_VAULT.bookingPrefs, ...(vault.bookingPrefs || {}) },
    lang: vault.lang === 'hi' ? 'hi' : 'en',
  };
  const key = await getOrCreateAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(clean));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  await storageSet({
    [VAULT_KEY]: {
      v: 1,
      iv: bytesToBase64(iv),
      ct: bytesToBase64(new Uint8Array(cipherBuf)),
      updatedAt: Date.now(),
    },
  });
  return clean;
}

/**
 * Compresses an uploaded image File into a crisp JPEG data URL that satisfies
 * temple portal file-size limits (typically 100KB-200KB) and keeps storage lean.
 */
export async function compressImageFile(file, maxSide = 480, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read selected image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file. Please choose a JPG or PNG photo.'));
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxSide || h > maxSide) {
          const ratio = Math.min(maxSide / w, maxSide / h);
          w = Math.max(1, Math.round(w * ratio));
          h = Math.max(1, Math.round(h * ratio));
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({
          name: (file.name || 'document.jpg').replace(/\.[^.]+$/, '') + '.jpg',
          type: 'image/jpeg',
          dataUrl,
          approxKb: Math.round((dataUrl.length * 0.75) / 1024),
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function computeAgeFromDob(dobStr) {
  if (!dobStr) return '';
  const m = String(dobStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const dob = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 && age <= 120 ? String(age) : '';
}
