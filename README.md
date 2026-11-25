# Mahakal Darshan Autofill (MV3 Chrome Extension)

100% Free, ad-supported Chrome extension for **Shri Mahakaleshwar Temple, Ujjain** (`shrimahakaleshwar.mp.gov.in`) supporting **Bhasma Aarti** and **Shighra / Protocol Darshan** booking forms.

## Features
- **Encrypted Local Family Vault (AES-256-GCM):** Save up to **20 family devotees** (Full Name, DOB/Age, Gender, Relation, Father's/Husband's Name, Govt ID Type & Number, Passport Photo, and ID Proof Scan) plus primary contact/address — encrypted strictly in `chrome.storage.local`. Zero personal data ever leaves the browser.
- **Auto Image Compression:** Automatically resizes and compresses devotee photos & ID scans into portal-friendly JPEGs and attaches them directly to `<input type="file">` controls via `DataTransfer`.
- **Multi-Row & Single-Row Smart Fill:** Detects both multi-devotee booking tables and single-devotee forms, syncing React, AngularJS, jQuery, and standard HTML5 controls cleanly.
- **Ethical & Compliant:** Strictly **never** touches CAPTCHA, OTP, or payment/submit buttons — always pauses for the devotee to review and complete verification manually.
- **Minimal CWS Permissions:** Uses only `storage`, `activeTab`, and `scripting` (zero broad host permissions for fast Chrome Web Store review).
- **Ad-Supported Footer Slot:** Displays a clean spotlight card at the bottom of the popup and optionally pulls live sponsor details from `https://kasyhq.com/api/mahakal-ad.json`.

## Load Unpacked & Test Locally
1. Open `chrome://extensions` in Chrome or Edge.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select `D:\Mahakal-Autofill-Extension`.
4. Open `https://www.shrimahakaleshwar.mp.gov.in/`, add your family devotees in the popup, navigate to the devotee details step, and click **Fill Booking Form**.
5. If any portal field isn't matched automatically, open **Tools & Backup → Inspect Open Page → Copy Field Map** and share the JSON to add exact portal selectors.

## Optional Remote Ad / Sponsor JSON (`kasyhq.com/api/mahakal-ad.json`)
```json
{
  "enabled": true,
  "tag": "SPONSORED",
  "title": "Your Sponsor or KasyHQ Product Headline",
  "description": "Short 1-line description shown at the bottom of the popup.",
  "ctaText": "Explore →",
  "ctaUrl": "https://kasyhq.com"
}
```

## Build Chrome Web Store Zip
```bash
python scripts/build-zip.py
```
Generates `Mahakal-Autofill-v1.0.0-chrome.zip`.
