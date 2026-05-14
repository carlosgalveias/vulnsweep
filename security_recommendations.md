# VulnSweep — Pre-Shipping Security Audit: Consolidated Report

**Audit Date:** 2026-05-14 | **Auditors:** Cybersecurity Expert · Security Engineer · Code Pathologist
**Verdict: ⛔ NOT READY TO SHIP — 5 Critical blockers (now resolved — see Implementation Status)**

---

## Three-Reviewer Summary

| Reviewer             | Domain                                               | Critical | High | Medium | Low |
| -------------------- | ---------------------------------------------------- | -------- | ---- | ------ | --- |
| Cybersecurity Expert | Runtime security, Electron hardening, attack surface | 3        | 2    | 2      | 1   |
| Security Engineer    | Build pipeline, supply chain, code hardening         | 2        | 4    | 5      | 4   |
| Code Pathologist     | IP protection, obfuscation, secrets in code          | 1        | 4    | 3      | 2   |

**Total unique findings: ~35 across all domains**

---

## Implementation Status of Critical Findings

| ID  | Finding                                            | Status                       |
| --- | -------------------------------------------------- | ---------------------------- |
| C-1 | XOR backup encryption → AES-256-GCM hardware-bound | ✅ Fixed                     |
| C-2 | Anti-forensic OS system dir camouflage             | ✅ Fixed                     |
| C-3 | CSP fully disabled                                 | ✅ Fixed (environment-aware) |
| C-4 | PowerShell command injection                       | ✅ Fixed                     |
| C-5 | Renderer source maps in production                 | ✅ Fixed                     |

---

## 🔴 CRITICAL Findings

### C-1 · License Backup XOR "Encryption" Is Trivially Reversible

**File:** `src/main/modules/license.js` (lines 12–13, 203–218)
**Reviewer:** Cybersecurity Expert | **Status:** ✅ Fixed

The backup used a 4-byte hardcoded XOR key `"VSWE"` to "encrypt" the license backup file. Any user with a `.vsbak` file could recover the full license payload, private key, and device marker timestamp in seconds.

**Fix Applied:** Replaced with AES-256-GCM. Key derived from `PBKDF2(hwString, appSalt, 200_000, 32, 'sha256')` where `hwString` = motherboard serial + BIOS UUID + CPU brand+cores (static across OS reinstalls). Backup format: `[4B magic][1B version][12B IV][16B authTag][ciphertext]`. Public key excluded from payload. Cross-device restore fails gracefully with user message.

---

### C-2 · Deliberate Anti-Forensic File Path Camouflage in OS System Directories

**Files:** `src/main/modules/license.js:66` · `src/main/utils/trial-store.js:62`
**Reviewer:** Cybersecurity Expert | **Status:** ✅ Fixed

Application data was hidden inside Microsoft OneDrive log trees (Windows), Apple helpd caches (macOS), and fontconfig directories (Linux) — explicitly to evade AV heuristics. This triggered EDR false positives and violated store policies and GDPR Art. 5.

**Fix Applied:** Paths replaced with AV-safe locations that survive app uninstall:

- Windows: `%PROGRAMDATA%\VulnSweep\{hash}`
- macOS: `~/Library/Application Support/VulnSweep/{hash}.dat`
- Linux: `~/.local/share/vulnsweep/{hash}.dat`

Anti-forensic design admission removed from `ARCHITECTURE.md`.

---

### C-3 · Content Security Policy Completely Neutralised

**File:** `src/main/main.js:1201`
**Reviewer:** Cybersecurity Expert | **Status:** ✅ Fixed (environment-aware)

CSP included `'unsafe-inline'`, `'unsafe-eval'`, and wildcard `https://*` on all windows — a leftover from a PayPal SDK that is no longer used.

**Fix Applied:** Environment-aware dual CSP:

- **Production:** `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'`
- **Development:** `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self' ws://localhost:* http://localhost:*; frame-src 'none'; object-src 'none'; base-uri 'self'`
- Payment window uses isolated session allowlisted to `paypal.com` and `paypalobjects.com` only.

---

### C-4 · PowerShell Command Injection via Path Interpolation

**File:** `src/main/modules/license.js:43-46`
**Reviewer:** Security Engineer | **Status:** ✅ Fixed

`os.homedir()` (from `USERPROFILE` env var) was interpolated into a PowerShell `-EncodedCommand` script via `execSync`. Enabled arbitrary command execution at user privilege level.

**Fix Applied:** Static pre-written `src/main/scripts/set-birthtime.ps1` receives path as typed `-ArgumentList` parameter — no string interpolation. `execSync` replaced with `spawnSync(..., { shell: false })`.

---

### C-5 · Renderer Source Maps Shipped in Production

**File:** `vite.config.js:56`
**Reviewer:** Security Engineer + Code Pathologist | **Status:** ✅ Fixed

`sourcemap: true` (despite a comment saying to disable it) emitted full `.js.map` files into production builds, reconstructing complete original React source and defeating all minification.

**Fix Applied:** `sourcemap: false` in production.
