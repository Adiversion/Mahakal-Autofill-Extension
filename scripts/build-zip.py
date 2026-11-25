import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "manifest.json"), "r", encoding="utf-8") as f:
    manifest = json.load(f)

version = manifest.get("version", "1.0.0")
out_zip = os.path.join(ROOT, f"Mahakal-Autofill-v{version}-chrome.zip")

INCLUDE_FILES = [
    "manifest.json",
    "background.js",
    os.path.join("lib", "vault.js"),
    os.path.join("content", "mahakal-autofill.js"),
    os.path.join("popup", "popup.html"),
    os.path.join("popup", "popup.css"),
    os.path.join("popup", "popup.js"),
    os.path.join("assets", "icon-16.png"),
    os.path.join("assets", "icon-48.png"),
    os.path.join("assets", "icon-128.png"),
]

with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as zf:
    for rel in INCLUDE_FILES:
        full = os.path.join(ROOT, rel)
        if not os.path.exists(full):
            raise FileNotFoundError(f"Missing required extension file: {full}")
        zf.write(full, rel.replace("\\", "/"))

size_kb = os.path.getsize(out_zip) / 1024.0
print(f"BUILT_ZIP: {out_zip} ({size_kb:.1f} KB, {len(INCLUDE_FILES)} files)")
