// Mahakal Darshan Autofill — Smart Content Script Engine
// Designed for shrimahakaleshwar.mp.gov.in (Bhasma Aarti & Shighra / Protocol Darshan)
// ETHICAL & SAFE: Strictly fills devotee & contact form fields only.
// NEVER touches CAPTCHA, OTP, or payment/submit buttons.

(() => {
  if (window.__mahakalAutofillLoaded) return;
  window.__mahakalAutofillLoaded = true;

  // Fields we MUST NEVER touch (security & compliance invariant)
  const FORBIDDEN_PATTERN = /\b(captcha|capcha|otp|verification.?code|security.?code|cvv|card.?no|upi|pin.?number|password|passwd)\b/i;

  const FIELD_RULES = {
    // Devotee fields
    name: {
      attrs: [/devotee.?name|bhakt.?name|yatri.?name|visitor.?name|pilgrim.?name|member.?name|full.?name|applicant.?name|txtname|person.?name|^name$|name_?\d/i],
      labels: [/devotee\s*name|full\s*name|pilgrim\s*name|visitor\s*name|applicant\s*name|bhakt|name\s*as\s*per|(^|\|\s*)name(\s*\||$)/i],
      exclude: [/father|husband|guardian|mother|city|state|bank|temple|file|photo|id\s*proof/i],
    },
    fatherName: {
      attrs: [/father|husband|guardian|parent.?name|care.?of|s_o|w_o/i],
      labels: [/father|husband|guardian|s\/o|w\/o|d\/o/i],
      exclude: [],
    },
    dob: {
      attrs: [/dob|date.?of.?birth|birth.?date|bdate/i],
      labels: [/date\s*of\s*birth|d\.?o\.?b|birth\s*date/i],
      exclude: [/visit|booking|darshan|aarti/i],
    },
    age: {
      attrs: [/\bage\b|txtage|devotee.?age|member.?age|visitor.?age|yrs|years/i],
      labels: [/\bage\b|age\s*\(in\s*years\)|years/i],
      exclude: [/image|page|stage|message|village|package/i],
    },
    gender: {
      attrs: [/gender|sex|ddl.?gender|cmb.?gender/i],
      labels: [/\bgender\b|\bsex\b/i],
      exclude: [],
    },
    relation: {
      attrs: [/relation|relationship|rel_?type/i],
      labels: [/relation|relationship/i],
      exclude: [],
    },
    idType: {
      attrs: [/id.?proof.?type.?id|id.?type|id.?proof.?type|photo.?id.?type|proof.?type|document.?type|doc.?type|identity.?type|ddl.?id|proofs|selectedproof/i],
      labels: [/id\s*proof\s*type|id\s*type|identity\s*(proof|type)|document\s*type|select\s*id|govt\.?\s*id/i],
      exclude: [/number|no\.|num|file|upload|image|photo/i],
    },
    idNumber: {
      attrs: [/id.?proof.?number|idproofnum|aadhaar|aadhar|uidai|photo.?id.?number|id.?no|id.?num|id.?number|id.?proof.?no|proof.?no|proof.?id|document.?no|doc.?no|identity.?no|card.?no/i],
      labels: [/aadhaar|aadhar|id\s*(proof\s*)?(number|no)|document\s*(number|no)|identity\s*(number|no)|govt\.?\s*id\s*no/i],
      exclude: [/mobile|phone|pin|type|file|upload|image|photo/i],
    },
    photoFile: {
      attrs: [/devotee.?photo|pilgrim.?photo|profile.?photo|passport.?photo|user.?photo|selfie|img.?photo|file.?photo|photo/i],
      labels: [/devotee\s*photo|passport\s*photo|photograph|your\s*photo|upload\s*photo|profile\s*pic/i],
      exclude: [/id\s*proof|aadhaar|aadhar|document|card|identity/i],
    },
    idScanFile: {
      attrs: [/id.?file|id.?proof.?file|id.?upload|id.?image|id.?photo|aadhaar.?file|aadhar.?file|doc.?file|document.?upload|proof.?upload/i],
      labels: [/id\s*proof|upload\s*id|aadhaar|aadhar|document\s*(upload|copy|image|photo)|identity\s*card/i],
      exclude: [],
    },

    // Contact / Address fields
    mobile: {
      attrs: [/mobile|mob.?no|phone|contact.?no|whatsapp|tel/i],
      labels: [/mobile|phone|contact\s*no|whatsapp/i],
      exclude: [/otp|alternate.?email/i],
    },
    email: {
      attrs: [/email|e_?mail|mail.?id/i],
      labels: [/e-?mail/i],
      exclude: [],
    },
    address: {
      attrs: [/address|addr|street|locality|house.?no|residential/i],
      labels: [/address|street|locality|residential/i],
      exclude: [/email|ip|mac/i],
    },
    city: {
      attrs: [/city|district|town|taluka|tehsil/i],
      labels: [/city|district|town/i],
      exclude: [],
    },
    state: {
      attrs: [/\bstate\b|ddl.?state|province/i],
      labels: [/\bstate\b/i],
      exclude: [/statement|status/i],
    },
    pincode: {
      attrs: [/pin.?code|postal|zip|txtpin/i],
      labels: [/pin\s*code|pincode|postal|zip/i],
      exclude: [/\b(upi|atm|mpin|tpin)\b/i],
    },
    country: {
      attrs: [/country|nation/i],
      labels: [/country|nationality/i],
      exclude: [],
    },
    gotra: {
      attrs: [/gotra|gothram/i],
      labels: [/gotra|gothram|गोत्र/i],
      exclude: [],
    },
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) {
    if (!el || el.disabled) return false;
    if (el.type === 'hidden') return false;
    // Reject any control inside a hidden ancestor container (e.g. Advance Bhasma Aarti's display:none visitor_row)
    let anc = el.parentElement;
    while (anc && anc !== document.body) {
      const as = window.getComputedStyle(anc);
      if (as.display === 'none' || as.visibility === 'hidden') return false;
      anc = anc.parentElement;
    }
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      // Bhasma Aarti photo upload uses <input type="file" hidden accept="image/*"> inside visible .photo-upload-box
      if (el.type === 'file') {
        return Boolean(el.closest('.photo-upload-box, label, .visitor_row, form'));
      }
      return false;
    }
    return true;
  }

  function cleanText(s) {
    return String(s || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  }

  function getFieldLabelText(el) {
    const parts = [];
    const id = el.getAttribute('id');
    if (id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lbl) parts.push(cleanText(lbl.textContent));
    }
    const closestLabel = el.closest('label');
    if (closestLabel) parts.push(cleanText(closestLabel.textContent));

    if (el.getAttribute('aria-label')) parts.push(cleanText(el.getAttribute('aria-label')));
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const refId of labelledBy.split(/\s+/)) {
        const refEl = document.getElementById(refId);
        if (refEl) parts.push(cleanText(refEl.textContent));
      }
    }
    if (el.getAttribute('placeholder')) parts.push(cleanText(el.getAttribute('placeholder')));
    if (el.getAttribute('title')) parts.push(cleanText(el.getAttribute('title')));

    // Angular Material <mat-form-field> / Bootstrap .form-group floating label lookup
    const matField = el.closest('mat-form-field, .mat-mdc-form-field, .mat-form-field');
    if (matField) {
      const matLbl = matField.querySelector('mat-label, .mdc-floating-label, label');
      if (matLbl) parts.push(cleanText(matLbl.textContent));
    }

    // Check parent wrapper label ONLY when parent wraps a single form control (avoids leaking sibling labels in flat <section>/<form>)
    const parent = el.parentElement;
    if (parent) {
      const siblingControls = parent.querySelectorAll('input:not([type="hidden"]), select, textarea');
      if (siblingControls.length === 1) {
        const directLabel = parent.querySelector('label, .form-label, .control-label, span.label');
        if (directLabel && !directLabel.contains(el)) {
          parts.push(cleanText(directLabel.textContent));
        }
      }
      const prev = el.previousElementSibling;
      if (prev && ['LABEL', 'SPAN', 'P', 'DIV', 'TH', 'TD'].includes(prev.tagName) && prev.textContent.length < 60) {
        parts.push(cleanText(prev.textContent));
      }
    }

    // Table header match (very common on Indian govt booking tables)
    const td = el.closest('td');
    if (td) {
      const tr = td.closest('tr');
      const table = td.closest('table');
      if (tr && table) {
        const colIdx = Array.from(tr.children).indexOf(td);
        const ths = table.querySelectorAll('thead th, tr:first-child th');
        if (ths[colIdx]) parts.push(cleanText(ths[colIdx].textContent));
      }
    }

    return [...new Set(parts.filter(Boolean))].join(' | ');
  }

  function getFieldAttrSignature(el) {
    return [
      el.getAttribute('name'),
      el.getAttribute('id'),
      el.getAttribute('ng-model'),
      el.getAttribute('formcontrolname'),
      el.getAttribute('data-field'),
      el.getAttribute('autocomplete'),
    ]
      .filter(Boolean)
      .join(' ');
  }

  function classifyField(el) {
    const attrs = getFieldAttrSignature(el);
    const label = getFieldLabelText(el);
    const combined = `${attrs} ${label}`;

    if (FORBIDDEN_PATTERN.test(combined)) return null;

    if (el.type === 'file') {
      if (FIELD_RULES.idScanFile.attrs.some((r) => r.test(attrs)) || FIELD_RULES.idScanFile.labels.some((r) => r.test(label))) {
        return 'idScanFile';
      }
      if (FIELD_RULES.photoFile.attrs.some((r) => r.test(attrs)) || FIELD_RULES.photoFile.labels.some((r) => r.test(label))) {
        return 'photoFile';
      }
      // Generic image upload defaults to devotee photo
      return 'photoFile';
    }

    if (el.type === 'date') {
      if (FIELD_RULES.dob.exclude.some((r) => r.test(combined))) return null;
      return 'dob';
    }

    const order = [
      'fatherName', 'dob', 'idType', 'idNumber', 'gender', 'relation', 'age', 'name',
      'mobile', 'email', 'pincode', 'state', 'city', 'country', 'gotra', 'address',
    ];
    // Pass 1: Explicit attribute match (name / id / ng-model / formcontrolname)
    for (const key of order) {
      const rule = FIELD_RULES[key];
      if (rule.exclude.some((r) => r.test(attrs))) continue;
      if (rule.attrs.some((r) => r.test(attrs))) {
        return key;
      }
    }
    // Pass 2: Label / placeholder / table header fallback
    for (const key of order) {
      const rule = FIELD_RULES[key];
      if (rule.exclude.some((r) => r.test(combined))) continue;
      if (rule.labels.some((r) => r.test(label))) {
        return key;
      }
    }
    return null;
  }

  /**
   * Builds a unique CSS selector so background.js can also dispatch a MAIN-world
   * framework update when React/AngularJS controls the input.
   */
  function getUniqueSelector(el) {
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }
    const marker = `rp-mk-${Math.random().toString(36).slice(2, 9)}`;
    el.setAttribute('data-mahakal-fill-id', marker);
    return `[data-mahakal-fill-id="${marker}"]`;
  }

  function matchSelectOption(selectEl, desiredValue, fieldKey) {
    const target = String(desiredValue || '').trim().toLowerCase();
    if (!target) return null;

    const aliases = {
      gender: {
        male: ['male', 'm', 'purush', 'mr'],
        female: ['female', 'f', 'mahila', 'ms', 'mrs'],
        other: ['other', 'transgender', 't', 'o'],
      },
      idType: {
        'aadhaar card': ['aadhaar', 'aadhar', 'adhar', 'uid', 'uidai'],
        'voter id': ['voter', 'epic', 'election'],
        passport: ['passport'],
        'driving license': ['driving', 'dl', 'licence', 'license'],
        'pan card': ['pan'],
      },
      relation: {
        spouse: ['wife', 'husband', 'spouse'],
        wife: ['wife', 'spouse'],
        husband: ['husband', 'spouse'],
        other: ['friends', 'other'],
        friends: ['friends', 'friend'],
      },
    };

    const opts = Array.from(selectEl.options).filter((o) => o.value !== '' && !/select|choose|--/i.test(o.text));
    // 1. Exact text or value match
    for (const o of opts) {
      if (o.text.trim().toLowerCase() === target || o.value.trim().toLowerCase() === target) return o.value;
    }
    // 2. Alias match (e.g. "Aadhaar Card" -> "Aadhar" or "UID")
    const aliasList = aliases[fieldKey]?.[target] || [target];
    for (const o of opts) {
      const txt = o.text.trim().toLowerCase();
      const val = o.value.trim().toLowerCase();
      if (aliasList.some((a) => txt.includes(a) || val === a)) return o.value;
    }
    // 3. Substring match
    for (const o of opts) {
      const txt = o.text.trim().toLowerCase();
      if (txt.includes(target) || target.includes(txt)) return o.value;
    }
    return null;
  }

  function formatDateForInput(isoDob, el) {
    if (!isoDob) return '';
    if (el.type === 'date') return isoDob; // YYYY-MM-DD
    const m = isoDob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return isoDob;
    const ph = (el.getAttribute('placeholder') || '').toLowerCase();
    if (ph.includes('dd-mm-yyyy')) return `${m[3]}-${m[2]}-${m[1]}`;
    return `${m[3]}/${m[2]}/${m[1]}`; // DD/MM/YYYY default for Indian govt portals
  }

  async function setFileInputFromDataUrl(fileInput, docObj) {
    if (!docObj?.dataUrl) return false;
    try {
      const res = await fetch(docObj.dataUrl);
      const blob = await res.blob();
      const file = new File([blob], docObj.name || 'document.jpg', {
        type: docObj.type || 'image/jpeg',
        lastModified: Date.now(),
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      highlightElement(fileInput);
      return true;
    } catch (err) {
      console.warn('[MahakalAutofill] File attach failed:', err?.message);
      return false;
    }
  }

  function highlightElement(el) {
    try {
      const prev = el.style.boxShadow;
      el.style.boxShadow = '0 0 0 2px #10b981';
      el.style.transition = 'box-shadow 0.25s ease';
      setTimeout(() => {
        el.style.boxShadow = prev || '';
      }, 2400);
    } catch (_) {}
  }

  function isCustomCombobox(el) {
    const tag = (el.tagName || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const popup = (el.getAttribute('aria-haspopup') || '').toLowerCase();
    return tag === 'mat-select' || role === 'combobox' || popup === 'listbox' || el.classList.contains('select2-selection');
  }

  async function setCustomDropdownValue(el, desiredValue, fieldKey) {
    const target = String(desiredValue || '').trim().toLowerCase();
    if (!target) return false;
    const aliasMap = {
      gender: { male: ['male', 'purush'], female: ['female', 'mahila'], other: ['other', 'transgender'] },
      idType: {
        'aadhaar card': ['aadhaar', 'aadhar', 'adhar', 'uid'],
        'voter id': ['voter', 'epic'],
        passport: ['passport'],
        'driving license': ['driving', 'licence', 'license', 'dl'],
        'pan card': ['pan'],
      },
      relation: {
        spouse: ['wife', 'husband', 'spouse'],
        wife: ['wife', 'spouse'],
        husband: ['husband', 'spouse'],
        other: ['friends', 'other'],
        friends: ['friends', 'friend'],
      },
    };
    const needles = aliasMap[fieldKey]?.[target] || [target];

    try {
      el.focus();
      el.click();
      await sleep(180);
      const optionNodes = Array.from(
        document.querySelectorAll('mat-option, [role="option"], [role="listbox"] li, .dropdown-menu .dropdown-item, .select2-results__option')
      ).filter(isVisible);

      let chosen = optionNodes.find((n) => cleanText(n.textContent).toLowerCase() === target);
      if (!chosen) {
        chosen = optionNodes.find((n) => {
          const txt = cleanText(n.textContent).toLowerCase();
          return needles.some((needle) => txt.includes(needle));
        });
      }
      if (chosen) {
        chosen.click();
        await sleep(120);
        highlightElement(el);
        return true;
      }
    } catch (_) {}
    return false;
  }

  async function setControlValue(el, value, fieldKey) {
    if (value === undefined || value === null || value === '') return false;

    if (el.type === 'file') {
      return setFileInputFromDataUrl(el, value);
    }

    if (isCustomCombobox(el)) {
      return setCustomDropdownValue(el, value, fieldKey);
    }

    if (el.type === 'radio') {
      const target = String(value).trim().toLowerCase();
      const lbl = getFieldLabelText(el).toLowerCase();
      const val = (el.value || '').toLowerCase();
      if (val === target || lbl.includes(target) || (target === 'male' && val === 'm') || (target === 'female' && val === 'f')) {
        el.click();
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        highlightElement(el);
        return true;
      }
      return false;
    }

    let finalVal = String(value);
    let isSelect = false;

    if (el.tagName === 'SELECT') {
      isSelect = true;
      const matched = matchSelectOption(el, finalVal, fieldKey);
      if (matched === null) return false;
      finalVal = matched;
    } else if (fieldKey === 'dob') {
      finalVal = formatDateForInput(finalVal, el);
    }

    // Fast path for Angular 19 (shrimahakaleshwar.mp.gov.in): native prototype setter + InputEvent/change/blur
    // reaches Zone.js & Reactive Forms synchronously in <1ms with ZERO chrome.scripting.executeScript IPC round-trips!
    const isModernAngular = Boolean(document.querySelector('app-root, [ng-version]'));
    let mainApplied = false;
    if (!isModernAngular) {
      const selector = getUniqueSelector(el);
      try {
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'MAIN_WORLD_SET_FIELD', selector, value: finalVal, isSelect },
            (r) => resolve(r || null)
          );
        });
        mainApplied = Boolean(res?.applied);
      } catch (_) {}
      el.removeAttribute('data-mahakal-fill-id');
    }

    if (!mainApplied) {
      try {
        el.focus();
        const proto = el.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : el.tagName === 'SELECT'
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, finalVal);
        else el.value = finalVal;
        try {
          el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: String(finalVal) }));
        } catch (_) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      } catch (_) {}
    }

    highlightElement(el);
    return true;
  }

  function queryAllInteractiveControls(root) {
    return Array.from(
      root.querySelectorAll('input, select, textarea, mat-select, [role="combobox"], [aria-haspopup="listbox"]')
    ).filter((el) => isVisible(el) && !String(el.id || '').startsWith('rp-'));
  }

  /**
   * Detects repeating devotee rows (table rows, Bootstrap/Angular Material .row / [formarrayname] rows,
   * cards, or flat indexed inputs like name_0 / name_1).
   */
  function detectDevoteeControlGroups() {
    const devoteeFieldKeys = new Set(['name', 'age', 'dob', 'gender', 'idType', 'idNumber', 'photoFile', 'idScanFile', 'relation', 'fatherName']);

    const candidateSelectors = [
      '.visitor_row',
      '[formarrayname] > div',
      '[formarrayname] .row',
      'tbody tr',
      '.devotee-row',
      '.member-row',
      '.pilgrim-row',
      '.visitor-row',
      '.passenger-row',
      '[class*="visitor"]',
      '[class*="devotee"]',
      '[class*="member"]',
      '[class*="pilgrim"]',
      'form .row',
      'fieldset',
      '.card',
    ];

    for (const sel of candidateSelectors) {
      const nodes = Array.from(document.querySelectorAll(sel));
      const matched = nodes.filter((node) => {
        const inputs = queryAllInteractiveControls(node);
        if (inputs.length < 2) return false;
        let devHits = 0;
        for (const inp of inputs) {
          if (devoteeFieldKeys.has(classifyField(inp))) devHits++;
        }
        return devHits >= 2;
      });
      const leafMatched = matched.filter((n) => !matched.some((other) => other !== n && n.contains(other)));
      if (leafMatched.length >= 2) {
        return leafMatched.map((node) => queryAllInteractiveControls(node));
      }
    }

    // Fallback: Flat indexed form inputs without row wrappers (e.g. name_0, age_0, name_1, age_1)
    const allControls = queryAllInteractiveControls(document.body);
    const byIndex = new Map();
    for (const el of allControls) {
      const key = classifyField(el);
      if (!devoteeFieldKeys.has(key)) continue;
      const sig = `${el.name || ''} ${el.id || ''}`;
      const idxMatch = sig.match(/(?:[_\[\-.]|^)([0-9]{1,2})(?:\]|$)/);
      if (idxMatch) {
        const idx = idxMatch[1];
        if (!byIndex.has(idx)) byIndex.set(idx, []);
        byIndex.get(idx).push(el);
      }
    }
    const indexedGroups = [...byIndex.entries()]
      .filter(([, ctrls]) => ctrls.length >= 2)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, ctrls]) => ctrls);
    if (indexedGroups.length >= 2) {
      return indexedGroups;
    }

    // Fallback 2 (Angular 19 AOT production builds where id="" and name="" on all repeating rows):
    // Split controls sequentially whenever multiple "name" inputs appear in DOM order!
    const nameIndices = [];
    for (let i = 0; i < allControls.length; i++) {
      if (classifyField(allControls[i]) === 'name') nameIndices.push(i);
    }
    if (nameIndices.length >= 2) {
      const seqGroups = [];
      for (let g = 0; g < nameIndices.length; g++) {
        const start = nameIndices[g];
        const end = g + 1 < nameIndices.length ? nameIndices[g + 1] : allControls.length;
        seqGroups.push(allControls.slice(start, end));
      }
      return seqGroups;
    }

    return [allControls];
  }

  function isControlGroupEmpty(controls) {
    for (const inp of controls) {
      const key = classifyField(inp);
      if (key === 'name' || key === 'idNumber') {
        if (String(inp.value || '').trim().length > 0) return false;
      }
    }
    return true;
  }

  async function fillDevoteeIntoControls(controls, devotee) {
    const map = {
      name: devotee.name,
      fatherName: devotee.fatherName,
      dob: devotee.dob,
      age: devotee.age,
      gender: devotee.gender,
      relation: devotee.relation,
      idType: devotee.idType,
      idNumber: devotee.idNumber,
      photoFile: devotee.photo,
      idScanFile: devotee.idScan,
    };

    // Order photoFile FIRST (so /add_image HTTP uploads fly immediately in parallel at t=0ms!),
    // then idType BEFORE idNumber (so Angular's idType change reset runs before idNumber is populated).
    const fieldRank = (el) => {
      const k = classifyField(el);
      if (k === 'photoFile') return 0;
      if (k === 'idType') return 1;
      if (k === 'idNumber') return 3;
      return 2;
    };
    const ordered = [...controls].sort((a, b) => fieldRank(a) - fieldRank(b));

    let count = 0;
    let uploadedPhotos = 0;
    const filledRadioNames = new Set();

    for (const el of ordered) {
      const key = classifyField(el);
      if (!key || !(key in map) || !map[key]) continue;
      if (el.type === 'radio' && el.name && filledRadioNames.has(el.name)) continue;

      // On Tatkal/Advance Bhasma, Sandhya & Shayan Aarti, /id_proof_types and /relations load asynchronously in ngOnInit.
      // Wait briefly if options haven't populated yet during 8 AM / 12 PM / 4 PM rush!
      if ((key === 'idType' || key === 'relation') && el.tagName === 'SELECT') {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline && matchSelectOption(el, map[key], key) === null) {
          await sleep(50);
        }
      }

      const ok = await setControlValue(el, map[key], key);
      if (ok) {
        count++;
        if (key === 'photoFile') uploadedPhotos++;
        if (el.type === 'radio' && el.name) filledRadioNames.add(el.name);
        if (key === 'idType' && !document.querySelector('app-root, [ng-version]')) await sleep(30);
      }
    }
    return { count, uploadedPhotos };
  }

  async function fillContactDetails(contact, mobileOnly = false) {
    if (!contact) return 0;
    const map = mobileOnly
      ? { mobile: contact.mobile }
      : {
          mobile: contact.mobile,
          email: contact.email,
          address: contact.address,
          city: contact.city,
          state: contact.state,
          pincode: contact.pincode,
          country: contact.country,
          gotra: contact.gotra,
        };

    const controls = queryAllInteractiveControls(document.body);
    let count = 0;
    let countryChanged = false;
    let stateChanged = false;
    const deferredStateSelects = [];
    const deferredCitySelects = [];

    // Pass 1: Fill country first, then non-cascading fields (deferring cascading Country->State & State->City selects)
    const priority = { country: 1, state: 2, mobile: 3, email: 4, gotra: 5, address: 6, pincode: 7, city: 8 };
    const ordered = [...controls].sort((a, b) => (priority[classifyField(a)] || 99) - (priority[classifyField(b)] || 99));

    for (const el of ordered) {
      const key = classifyField(el);
      if (!key || !(key in map) || !map[key]) continue;

      if (key === 'country' && el.tagName === 'SELECT') {
        // Dharmshala loads /countries asynchronously on ngOnInit
        const deadline = Date.now() + 1000;
        while (Date.now() < deadline && matchSelectOption(el, map.country, 'country') === null) {
          await sleep(100);
        }
        if (await setControlValue(el, map.country, 'country')) {
          count++;
          countryChanged = true;
        }
        continue;
      }

      if (key === 'state' && el.tagName === 'SELECT') {
        if (countryChanged || matchSelectOption(el, map.state, 'state') === null) {
          deferredStateSelects.push(el);
          continue;
        }
      }

      if (key === 'city' && el.tagName === 'SELECT' && (stateChanged || deferredStateSelects.length > 0)) {
        deferredCitySelects.push(el);
        continue;
      }

      const ok = await setControlValue(el, map[key], key);
      if (ok) {
        count++;
        if (key === 'state') stateChanged = true;
      }
    }

    // Pass 2: Wait up to 1500ms for cascading Country -> State dropdown options to populate (e.g. Dharmshala /states?country_id=1)
    for (const stateEl of deferredStateSelects) {
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        if (matchSelectOption(stateEl, map.state, 'state') !== null) break;
        await sleep(120);
      }
      if (await setControlValue(stateEl, map.state, 'state')) {
        count++;
        stateChanged = true;
      }
    }

    // Pass 3: Wait up to 1200ms for cascading State -> District/City dropdown options to populate via AJAX
    for (const cityEl of deferredCitySelects) {
      const deadline = Date.now() + 1200;
      while (Date.now() < deadline) {
        if (matchSelectOption(cityEl, map.city, 'city') !== null) break;
        await sleep(120);
      }
      if (await setControlValue(cityEl, map.city, 'city')) {
        count++;
      }
    }
    return count;
  }

  /**
   * Step 1 on Shri Mahakaleshwar Sheeghra Darshan (/services/slot-booking?type=sheeghra-darshan):
   * Sets "Number of Persons" (Angular 19 `no_of_persons` -> `generateVisitorsRows()`) FIRST
   * so the portal generates the exact matching number of visitor FormGroup rows!
   */
  async function setNumberOfPersonsOnPage(personCount) {
    const count = Math.min(6, Math.max(1, parseInt(personCount, 10) || 1));
    const controls = queryAllInteractiveControls(document.body);
    let targetEl = null;

    for (const el of controls) {
      if (el.type === 'file' || el.type === 'radio' || el.type === 'checkbox') continue;
      const attrs = getFieldAttrSignature(el);
      const label = getFieldLabelText(el);
      const combined = `${attrs} ${label}`;
      if (FORBIDDEN_PATTERN.test(combined)) continue;
      if (
        /no_?of_?persons|number_?of_?persons|person.?count|total.?persons|visitors?.?count|noOfPersons|\btickets\b/i.test(attrs) ||
        /number\s*of\s*persons|no\.?\s*of\s*persons|total\s*persons|number\s*of\s*devotees|select\s*persons/i.test(label)
      ) {
        targetEl = el;
        break;
      }
    }

    if (!targetEl) return false;
    // Dynamically clamp to the portal <select>'s real max option (e.g. 5 on Tatkal/Sandhya/Shayan, 6 on Sheeghra)
    let effectiveCount = count;
    if (targetEl.tagName === 'SELECT') {
      const numericOpts = Array.from(targetEl.options)
        .map((o) => parseInt(o.text.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0);
      if (numericOpts.length > 0) {
        const portalMax = Math.max(...numericOpts);
        effectiveCount = Math.min(effectiveCount, portalMax);
      }
    }
    const ok = await setControlValue(targetEl, String(effectiveCount), 'persons');
    if (ok) {
      // Poll briefly until Angular 19 renders all expected visitor rows (typically 16-40ms)
      const deadline = Date.now() + 450;
      while (Date.now() < deadline) {
        if (detectDevoteeControlGroups().length >= effectiveCount) break;
        await sleep(20);
      }
    }
    return ok ? effectiveCount : false;
  }

  /**
   * Selects a matching AVAILABLE Sheeghra Darshan slot card (e.g. "Slot 06:00 AM To 07:00 AM")
   * ONLY when the card shows AVAILABLE (never clicks Inactive / Full / 0 Available / Not Available / .disabled slots).
   */
  async function selectAvailableSlotCardOnPage(preferredSlot, allowFirstFallback = false) {
    const targetNorm = cleanText(preferredSlot).toLowerCase().replace(/^slot\s+/i, '');
    if (!targetNorm && !allowFirstFallback) return null;

    const isBookableCard = (el) => {
      if (!isVisible(el)) return false;
      if (el.classList.contains('disabled') || el.hasAttribute('disabled')) return false;
      const txt = cleanText(el.textContent);
      if (txt.length < 15 || txt.length > 260) return false;
      const lower = txt.toLowerCase();
      if (!lower.includes('available')) return false;
      return !/\b0\s*available\b|\bnot\s*available\b|inactive|sold\s*out|unavailable/i.test(lower);
    };

    // Prioritize exact portal .slot-card containers first (avoids picking inner .slot-available when count >= 10000)
    const directSlotCards = Array.from(document.querySelectorAll('.slot-card')).filter(isBookableCard);
    let leafAll = directSlotCards;
    if (leafAll.length === 0) {
      const availableCards = Array.from(
        document.querySelectorAll('button, [role="button"], .card, div, li')
      ).filter(isBookableCard);
      leafAll = availableCards.filter((el) => !availableCards.some((other) => other !== el && el.contains(other)));
    }
    if (leafAll.length === 0) return null;

    let chosen = targetNorm
      ? leafAll.find((el) => cleanText(el.textContent).toLowerCase().includes(targetNorm))
      : null;
    if (!chosen && allowFirstFallback) {
      chosen = leafAll[0];
    }
    if (!chosen) return null;

    try {
      chosen.scrollIntoView({ behavior: 'smooth', block: 'center' });
      chosen.click();
      highlightElement(chosen);
      await sleep(160);
      return preferredSlot || cleanText(chosen.textContent).slice(0, 40);
    } catch (_) {
      return null;
    }
  }

  function showPageToast(text) {
    try {
      const existing = document.getElementById('mahakal-autofill-toast');
      if (existing) existing.remove();
      const div = document.createElement('div');
      div.id = 'mahakal-autofill-toast';
      div.textContent = `🔱 Mahakal Autofill: ${text}`;
      Object.assign(div.style, {
        position: 'fixed',
        bottom: '18px',
        right: '18px',
        zIndex: '2147483647',
        background: '#461016',
        color: '#fef3c7',
        border: '1.5px solid #f59e0b',
        borderRadius: '10px',
        padding: '10px 14px',
        fontSize: '13px',
        fontWeight: '700',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
      });
      document.body.appendChild(div);
      setTimeout(() => div.remove(), 5500);
    } catch (_) {}
  }

  async function waitForUploadsAndClickContinue(timeoutMs = 15000, expectedPhotoCount = 0) {
    // Minimal initial pause (80ms) for Angular FileReader + /add_image requests to fire; then poll every 50ms!
    await sleep(expectedPhotoCount > 0 ? 80 : 40);
    const deadline = Date.now() + timeoutMs;

    const findContinueBtn = () =>
      Array.from(
        document.querySelectorAll('button[type="submit"][name="send"], form button[type="submit"], button.btn-primary, button.btn-continue')
      ).find((b) => {
        if (!isVisible(b)) return false;
        const txt = cleanText(b.textContent).toLowerCase();
        return txt === 'continue' || txt.includes('continue');
      });

    const areAllPhotosReady = () => {
      const previewImgs = Array.from(document.querySelectorAll('.visitor_row .preview img')).filter(isVisible);
      if (expectedPhotoCount > 0 && previewImgs.length < expectedPhotoCount) return false;
      return previewImgs.every((img) => {
        const src = String(img.getAttribute('src') || img.src || '').trim();
        return src.length > 0 && !src.startsWith('data:');
      });
    };

    const areRequiredSelectsFilled = () => {
      // Tatkal Bhasma initializes relationship_id to 0 with Validators.required (which Angular treats as truthy/valid!),
      // so verify no visible required visitor <select> is still sitting on "Select" / 0 / empty before clicking Continue!
      const selects = Array.from(
        document.querySelectorAll('.visitor_row select[formcontrolname="relationship_id"], .visitor_row select[formcontrolname="id_proof_type_id"], .visitor_row select[formcontrolname="gender"]')
      ).filter(isVisible);
      return selects.every((sel) => {
        const val = String(sel.value || '').trim();
        const txt = cleanText(sel.selectedOptions?.[0]?.textContent || '').toLowerCase();
        if (!val || val === '0' || /^0:\s*0$/.test(val) || /^0:\s*['"]?['"]?$/.test(val)) return false;
        if (/^select\b|--/i.test(txt)) return false;
        return true;
      });
    };

    const detectQuotaDropBanner = () => {
      if (document.querySelector('form')) return '';
      for (const el of document.querySelectorAll('.alert-danger, .global-alert.alert-error')) {
        if (!isVisible(el)) continue;
        const t = cleanText(el.textContent);
        if (/quota\s+not\s+available|slots\s+are\s+full|not\s+available/i.test(t)) return t;
      }
      return '';
    };

    while (Date.now() < deadline) {
      const quotaDrop = detectQuotaDropBanner();
      if (quotaDrop) {
        return { clicked: false, reason: `Portal quota check failed: "${quotaDrop}" — try fewer devotees.` };
      }
      const loaderActive = Boolean(document.querySelector('.global-loader-overlay'));
      const allImagesUploaded = areAllPhotosReady();
      const selectsOk = areRequiredSelectsFilled();
      const submitBtn = findContinueBtn();

      if (!loaderActive && allImagesUploaded && selectsOk && submitBtn && !submitBtn.disabled) {
        submitBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
        await sleep(30);
        // Re-check once after brief settle in case a parallel /add_image or /check_aarti_quota toggled state
        if (!document.querySelector('.global-loader-overlay') && areAllPhotosReady() && areRequiredSelectsFilled() && !submitBtn.disabled) {
          submitBtn.click();
          return { clicked: true };
        }
      }

      await sleep(50);
    }

    // Never click Continue if photos are still uploading or required selects are unselected
    const finalBtn = findContinueBtn();
    if (!document.querySelector('.global-loader-overlay') && areAllPhotosReady() && areRequiredSelectsFilled() && finalBtn && !finalBtn.disabled) {
      finalBtn.click();
      return { clicked: true };
    }
    return {
      clicked: false,
      reason: expectedPhotoCount > 0 && !areAllPhotosReady()
        ? 'Photo upload did not complete in time — verify previews & click Continue manually.'
        : !areRequiredSelectsFilled()
          ? 'A required dropdown (Relation / ID Proof Type / Gender) is still unselected — verify & click Continue.'
          : 'Continue button stayed disabled — verify required fields & click Continue manually.',
    };
  }

  function inspectCurrentPage() {
    const controls = queryAllInteractiveControls(document.body);
    const groups = detectDevoteeControlGroups();
    const fields = controls.slice(0, 60).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || el.getAttribute('role') || '',
      id: el.id || '',
      name: el.name || '',
      label: getFieldLabelText(el).slice(0, 60),
      detectedAs: classifyField(el) || 'unmapped',
    }));
    return {
      url: location.href,
      title: document.title,
      totalFields: controls.length,
      detectedRows: groups.length,
      fields,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (!msg || !msg.action) {
          return sendResponse({ ok: false, error: 'Unknown action.' });
        }

        if (msg.action === 'INSPECT_PAGE') {
          return sendResponse({ ok: true, report: inspectCurrentPage() });
        }

        if (msg.action === 'FILL_MOBILE_ONLY') {
          const filledCount = await fillContactDetails(msg.contact, true);
          if (filledCount === 0) {
            return sendResponse({ ok: false, error: 'No mobile number input found on this screen.' });
          }
          showPageToast('Mobile number filled. Request & enter OTP manually.');
          return sendResponse({
            ok: true,
            filledCount,
            summary: 'Mobile number filled. Complete OTP manually.',
          });
        }

        if (msg.action === 'FILL_CONTACT_ONLY') {
          const filledCount = await fillContactDetails(msg.contact, false);
          if (filledCount === 0) {
            return sendResponse({ ok: false, error: 'No contact/address fields detected on this page.' });
          }
          showPageToast(`Filled ${filledCount} contact/address field(s).`);
          return sendResponse({
            ok: true,
            filledCount,
            summary: `Filled ${filledCount} contact/address field(s).`,
          });
        }

        if (msg.action === 'FILL_SINGLE_DEVOTEE') {
          const groups = detectDevoteeControlGroups();
          const target = groups.find(isControlGroupEmpty) || groups[0];
          const devRes = await fillDevoteeIntoControls(target, msg.devotee);
          const contactFilled = await fillContactDetails(msg.contact, false);
          const total = devRes.count + contactFilled;
          if (total === 0) {
            return sendResponse({ ok: false, error: 'No matching devotee form fields found on this page.' });
          }
          showPageToast(`Filled ${msg.devotee.name} (${total} fields). Complete OTP/CAPTCHA manually.`);
          return sendResponse({
            ok: true,
            filledCount: total,
            summary: `Filled ${msg.devotee.name} (${total} fields). Verify details & complete OTP/CAPTCHA.`,
          });
        }

        if (msg.action === 'FILL_BOOKING_FORM') {
          const devotees = Array.isArray(msg.devotees) ? msg.devotees : [];
          const personCount = msg.personCount || devotees.length || 1;

          // STEP 1 (Sheeghra Darshan / Slot Booking): Set Number of Persons FIRST so Angular generates N visitor rows
          const personsSet = await setNumberOfPersonsOnPage(personCount);

          // On Sandhya/Shayan Aarti, changing no_of_persons triggers POST /check_aarti_quota; if quota is insufficient,
          // Angular destroys <form> and renders .alert-danger ("Quota not available..."). Detect this immediately!
          if (!document.querySelector('form')) {
            for (const el of document.querySelectorAll('.alert-danger, .global-alert.alert-error')) {
              if (!isVisible(el)) continue;
              const t = cleanText(el.textContent);
              if (/quota\s+not\s+available|slots\s+are\s+full|not\s+available/i.test(t)) {
                const msgText = `Portal quota check failed: "${t}" — try fewer devotees.`;
                showPageToast(msgText);
                return sendResponse({ ok: false, personsSet, error: msgText });
              }
            }
          }

          // STEP 2: Only select a Sheeghra time slot card on Sheeghra / slot-booking screens (never leak cached slot to Aarti/Dharmshala)
          const isSheeghraSlotScreen =
            msg.bookingMode === 'sheeghra_darshan' || /slot-booking/i.test(location.pathname);
          const selectedSlot = isSheeghraSlotScreen
            ? await selectAvailableSlotCardOnPage(msg.preferredSlot || '', msg.bookingMode === 'sheeghra_darshan')
            : null;

          // STEP 3: Fill generated visitor rows + contact/address details
          const groups = detectDevoteeControlGroups();
          let filledCount = 0;
          let filledDevotees = 0;
          let expectedPhotoCount = 0;

          const countToFill = Math.min(devotees.length, groups.length);
          const hasCombobox = groups.slice(0, countToFill).some((g) => g.some(isCustomCombobox));
          if (hasCombobox) {
            for (let i = 0; i < countToFill; i++) {
              const res = await fillDevoteeIntoControls(groups[i], devotees[i]);
              if (res.count > 0) {
                filledCount += res.count;
                filledDevotees++;
                expectedPhotoCount += res.uploadedPhotos;
              }
            }
          } else {
            const results = await Promise.all(
              Array.from({ length: countToFill }, (_, i) => fillDevoteeIntoControls(groups[i], devotees[i]))
            );
            for (const res of results) {
              if (res.count > 0) {
                filledCount += res.count;
                filledDevotees++;
                expectedPhotoCount += res.uploadedPhotos;
              }
            }
          }

          const contactFilled = await fillContactDetails(msg.contact, false);
          filledCount += contactFilled;

          const preParts = [];
          if (personsSet) preParts.push(`Persons=${typeof personsSet === 'number' ? personsSet : personCount}`);
          if (selectedSlot) preParts.push(`Slot ${selectedSlot}`);

          if (filledCount === 0 && preParts.length === 0) {
            const isDharmshalaStep1 = msg.bookingMode === 'dharmshala' || /dharmshala-slot-booking/i.test(location.pathname);
            return sendResponse({
              ok: false,
              error: isDharmshalaStep1
                ? 'On Dharmshala Step 1: pick Check-in/Check-out dates on the calendar, select a room card below & click Continue — then click Fill on the guest details page.'
                : 'No slot or booking fields found yet. Open the Sheeghra Darshan / Bhasma Aarti booking page and try again.',
            });
          }

          if (filledCount === 0 && preParts.length > 0) {
            let continueResult = null;
            if (msg.autoContinue) {
              continueResult = await waitForUploadsAndClickContinue(4500, 0);
            }
            const slotSummary = continueResult?.clicked
              ? `Set ${preParts.join(' & ')} → Clicked Continue!`
              : `Set ${preParts.join(' & ')}! Proceed to the devotee details step, then click Fill again.`;
            showPageToast(slotSummary);
            return sendResponse({
              ok: true,
              personsSet,
              selectedSlot,
              filledCount: 0,
              filledDevotees: 0,
              continueClicked: Boolean(continueResult?.clicked),
              summary: slotSummary,
            });
          }

          const prefix = preParts.length > 0 ? `${preParts.join(' + ')} → ` : '';
          const skipped = devotees.length - countToFill;
          const hasExtraBedBtn = Boolean(document.querySelector('button.extra-bed-btn:not([disabled])'));
          const skippedNote = skipped > 0
            ? (hasExtraBedBtn
              ? ` (${skipped} skipped — click + Extra Bed for 1 more guest if needed)`
              : ` (${skipped} skipped — add more rows on the portal first)`)
            : '';

          let continueResult = null;
          if (msg.autoContinue && filledCount > 0) {
            showPageToast(`${prefix}Filled ${filledDevotees} devotee(s) — waiting for photo uploads to click Continue...`);
            const uploadTimeoutMs = expectedPhotoCount > 1 ? 30000 : expectedPhotoCount === 1 ? 20000 : 15000;
            continueResult = await waitForUploadsAndClickContinue(uploadTimeoutMs, expectedPhotoCount);
          }

          const continueNote = continueResult
            ? (continueResult.clicked ? ' → Clicked Continue!' : ` (${continueResult.reason})`)
            : ' Verify & click Continue.';
          const summary = `${prefix}Filled ${filledDevotees} devotee(s) + ${contactFilled} contact field(s)${skippedNote}.${continueNote}`;
          showPageToast(summary);
          return sendResponse({
            ok: true,
            personsSet,
            selectedSlot,
            filledCount,
            filledDevotees,
            continueClicked: Boolean(continueResult?.clicked),
            summary,
          });
        }

        sendResponse({ ok: false, error: `Unsupported action: ${msg.action}` });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Autofill encountered an error.' });
      }
    })();
    return true;
  });
})();
