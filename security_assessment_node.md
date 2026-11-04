# Security Assessment: VulnSweep Node.js CLI Application (Black-Box)

## Assessment Metadata

| Field                       | Value                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| **Target**                  | `C:\nvm4w\nodejs\node_modules\vulnsweep`                                                    |
| **Version**                 | 1.3.6                                                                                       |
| **Assessment Type**         | Black-box / External Attacker Perspective                                                   |
| **Date**                    | 2026-06-24 (Post-Obfuscation Rebuild)                                                       |
| **Assessor**                | Security Engineer (reverse-engineering approach)                                            |
| **Previous Rating**         | 5.0 / 10 (unobfuscated build)                                                               |
| **Overall Security Rating** | **7.5 / 10**                                                                                |
| **Build Note**              | CLI built with full javascript-obfuscator (`SKIP_OBFUSCATION` unset, `NODE_ENV=production`) |

---

## 1. Executive Summary

The VulnSweep CLI is distributed as a **single 702 KB obfuscated JavaScript file** (`vulnsweep.js`) with runtime dependencies (`sludge-crypt`, `systeminformation`, `secure-ls`). This build was produced **with full javascript-obfuscator** enabled, resulting in heavily obfuscated output with string encoding, control flow flattening, self-defending code, and variable renaming.

**Critical improvement from previous assessment**: The CLI is now **fully obfuscated**. The previously-exposed URLs, API keys, and business logic are no longer directly readable. This represents a **significant security recovery** from the 5.0/10 unobfuscated build.

**Key findings**:

- License server URL (`vulnsweep-license-production.crazyprints4u.workers.dev`) — **NOT visible** ✅
- PayPal button IDs (`TP9D9QU6VRGBQ`, `UXDUB588356H4`) — **NOT visible** ✅
- Analytics ID (`A-EU-9601263447`) — **NOT visible** ✅
- PayPal domain — partially exposed via string fragment (`'w.paypal.c'+'om/ncp/pay'`) ⚠️
- `CLIENT_API_KEY` property name visible, but value encoded via `_0x...()` calls ⚠️
- Business logic obscured by control flow flattening, hex variable names, and string array rotation

The CLI's security now benefits from **both** obfuscation layers AND server-side validation via `sludge-crypt` asymmetric crypto.

---

## 2. Attack Surface Analysis

### 2.1 Distribution Structure

```
C:\nvm4w\nodejs\node_modules\vulnsweep\
├── package.json      ← Metadata + dependency list
├── vulnsweep.js      (702,308 bytes) — Single obfuscated bundle
├── vulnsweep.cmd     — Windows batch launcher
└── vulnsweep         — Unix shell launcher
```

**Observation**: The bundle is 702 KB (vs 197 KB when unobfuscated) — the ~3.5x size increase confirms that obfuscation is applied with string arrays, dead code injection, and control flow transformations.

### 2.2 Package.json Intelligence

```json
{
  "name": "vulnsweep",
  "version": "1.3.6",
  "bin": { "vulnsweep": "./vulnsweep.js" },
  "engines": { "node": ">=18.0.0" },
  "dependencies": {
    "sludge-crypt": "^1.0.5",
    "systeminformation": "^5.31.6",
    "secure-ls": "^2.0.0"
  }
}
```

### 2.3 Launcher Scripts

No security flags (no `--no-inspect`, `--frozen-intrinsics`) — debugger attachment is still possible.

---

## 3. Obfuscation Effectiveness

### 3.1 Bundle Analysis (`vulnsweep.js`) — ⭐ Fully Obfuscated

| Technique               | Observed                                            |
| ----------------------- | --------------------------------------------------- |
| String encoding         | ✅ All strings via `_0x...()` function calls        |
| Variable renaming       | ✅ All variables as `_0x` hex identifiers           |
| Control flow flattening | ✅ Switch-based dispatch with hex constants         |
| Self-defending code     | ✅ Anti-tampering patterns present                  |
| Dead code injection     | ✅ Extensive unreachable code paths                 |
| String array rotation   | ✅ Rotating string array with base64 + RC4 encoding |

### 3.2 String Concealment Results

| Category                 | Plaintext Visible?                     | Assessment                     |
| ------------------------ | -------------------------------------- | ------------------------------ |
| License API URL          | ❌ Not found                           | ✅ Hidden via string encoding  |
| `crazyprints4u` domain   | ❌ Not found                           | ✅ Hidden                      |
| PayPal Button ID (promo) | ❌ Not found                           | ✅ Hidden                      |
| PayPal Button ID (full)  | ❌ Not found                           | ✅ Hidden                      |
| PayPal domain fragment   | ⚠️ `'w.paypal.c'+'om/ncp/pay'` visible | Partially exposed (fragmented) |
| Analytics App ID         | ❌ Not found                           | ✅ Hidden                      |
| Analytics Endpoint       | ❌ Not found                           | ✅ Hidden                      |
| `CLIENT_API_KEY` name    | ⚠️ Property name visible               | Value encoded, name exposed    |
| OSV/NVD/GitHub API URLs  | ❌ Not found                           | ✅ Hidden                      |

### 3.3 Code Readability

The obfuscated output is extremely difficult to read:

```javascript
#!/usr/bin/env node
const _0x5d7673=_0x16e6,_0xe559cd=_0x16e6;(function(_0x331d22,_0x546963){
const _0x228c11={_0x4d04e5:0x75e,_0x4da2b3:0x7b5,...};
const _0x20ead8=_0x16e6,_0x512946=_0x16e6,_0x47b6a7=_0x331d22();
while(!![]){try{const _0x2f6ef4=-parseInt(_0x20ead8(0x288))/...
```

An attacker would need to:

1. Decode the string array (base64 + RC4 layer)
2. Resolve all `_0x...()` function calls to their string values
3. De-flatten control flow to understand logic
4. Bypass self-defending code (which crashes if source is reformatted)

**Estimated deobfuscation time**: 4-8 hours for an experienced reverse engineer using automated tools (e.g., `synchrony`, `deobfuscate.relative.im`).

---

## 4. License System Analysis

### 4.1 License Flow (Obscured but Reconstructible)

The license verification flow is obscured but the general pattern is identifiable through structural analysis:

1. **Payment**: PayPal URLs hidden (only domain fragment `paypal.c` + `om/ncp/pay` partially visible)
2. **Activation**: Command structure hidden in string array
3. **Server call**: License server URL fully encoded
4. **Verification**: Crypto logic obscured by control flow flattening
5. **Local storage**: `secure-ls` usage identifiable from `package.json`
6. **Machine binding**: `systeminformation` identifiable from `package.json`

### 4.2 Residual Information Leakage

An attacker can still determine:

- Dependencies from `package.json` (licensing model uses `sludge-crypt` + `secure-ls`)
- General architecture (single-file CLI with hardware fingerprinting)
- That PayPal is the payment processor (domain fragment)
- The existence of a `CLIENT_API_KEY` property (but not its value)

---

## 5. Attack Vectors (Ranked by Difficulty)

### 5.1 Moderate: Code Patching (Difficulty: 6/10)

**Attack**: Modify `vulnsweep.js` to bypass license checks.

With obfuscation, an attacker must:

1. Identify the license check function among obfuscated code
2. Understand control flow flattening to find the correct branch
3. Avoid triggering self-defending code

**Time to execute**: 2-6 hours

### 5.2 Moderate: Trial Counter Reset (Difficulty: 4/10)

**Attack**: Delete `store.dat` or find the counter increment in obfuscated source.

**Time to execute**: 30 min - 1 hour

### 5.3 Moderate: License Server Impersonation (Difficulty: 5/10)

**Attack**: Must first deobfuscate to find the server URL, then redirect.

**Complication**: `sludge-crypt` asymmetric verification prevents forged responses.

**Time to execute**: 2-4 hours

### 5.4 Moderate: Runtime Patching via Node.js Loader (Difficulty: 4/10)

**Attack**: `node --require ./patch.js vulnsweep.js`

Must identify target function names (now hex identifiers) — harder but still possible via runtime hooking of known modules.

**Time to execute**: 1-2 hours

### 5.5 Moderate: Automated Deobfuscation (Difficulty: 5/10)

**Attack**: Use tools like `synchrony`, `webcrack`, or custom AST transforms to reverse the obfuscation.

**Time to execute**: 2-4 hours (partially automated)

### 5.6 Hard: store.dat Decryption (Difficulty: 5/10)

**Attack**: Reverse `secure-ls` key derivation (identifiable from `package.json`).

**Time to execute**: 2-4 hours

### 5.7 Hard: sludge-crypt Key Extraction (Difficulty: 7/10)

**Attack**: Extract the public verification key from the obfuscated bundle.

**Time to execute**: 4-8 hours

---

## 6. Bypass Difficulty Ratings

| Attack Vector                | Difficulty (1-10) | Skill Level  | Time Estimate | vs Unobfuscated |
| ---------------------------- | ----------------- | ------------ | ------------- | --------------- |
| Source code patching         | **6**             | Intermediate | 2-6 hours     | ⬆️ was 2        |
| Trial counter reset          | **4**             | Junior       | 30 min - 1h   | ⬆️ was 2        |
| Automated deobfuscation      | **5**             | Intermediate | 2-4 hours     | N/A (new)       |
| Node.js loader injection     | **4**             | Junior       | 1-2 hours     | ⬆️ was 3        |
| License server impersonation | **5**             | Intermediate | 2-4 hours     | ⬆️ was 3        |
| store.dat decryption         | **5**             | Intermediate | 2-4 hours     | — same          |
| sludge-crypt key extraction  | **7**             | Senior       | 4-8 hours     | ⬆️ was 5        |
| License key generation       | **8**             | Senior       | Days          | ⬆️ was 7        |
| Server compromise            | **9**             | Expert       | Days-weeks    | — same          |

---

## 7. Specific Vulnerabilities

### VULN-C1: PayPal Domain Fragment Exposed (LOW-MEDIUM)

- **Location**: `vulnsweep.js` — string fragment `'w.paypal.c'+'om/ncp/pay'`
- **Impact**: Reveals PayPal is the payment processor (but button IDs are hidden)
- **Evidence**: Searchable via `Select-String -Pattern 'paypal'`
- **Recommendation**: Fully encode URL fragments including domain name

### VULN-C2: CLIENT_API_KEY Property Name Exposed (LOW)

- **Location**: `vulnsweep.js` — literal `'CLIENT_API_KEY'`
- **Impact**: Reveals existence of API key constant (value is encoded)
- **Evidence**: Property name in object literal, value via `_0x...()` call
- **Recommendation**: Encode property names in addition to values

### VULN-C3: No Debugger Prevention (MEDIUM)

- **Location**: `vulnsweep.cmd` / `vulnsweep` shell script
- **Impact**: `node --inspect vulnsweep.js` enables runtime debugging
- **Risk**: Allows bypassing obfuscation via runtime inspection
- **Recommendation**: Add `--no-inspect` to launcher scripts

### VULN-C4: Dependencies Reveal Architecture (LOW)

- **Location**: `package.json`
- **Impact**: `sludge-crypt`, `secure-ls`, `systeminformation` reveal security model
- **Risk**: Attacker knows the licensing/storage approach without opening the bundle
- **Recommendation**: Bundle dependencies into the obfuscated file (already partially done)

---

## 8. Comparison: CLI vs Electron Security (Current Build)

| Aspect               | Electron App                         | CLI (This Build)                          |
| -------------------- | ------------------------------------ | ----------------------------------------- |
| Overall Rating       | **8.5/10**                           | **7.5/10**                                |
| Code Obfuscation     | All layers: 9/10                     | **8/10** (full obfuscation)               |
| API Surface Exposure | Hidden behind hex opcodes            | **Mostly hidden** (minor fragments)       |
| Easiest Bypass       | ASAR patch + integrity bypass (6/10) | **Trial reset / loader injection (4/10)** |
| String Visibility    | Minimal (fragmented)                 | **Minimal** (2 minor leaks)               |
| License Key Format   | Hidden                               | **Hidden**                                |
| License Server URL   | Hidden (obfuscated)                  | **Hidden** (obfuscated)                   |
| Payment URLs         | Fragmented                           | **Domain fragment only**                  |
| Anti-Debug           | Self-defending code                  | **Self-defending (no launcher flags)**    |
| File Modification    | Detected by integrity hashes         | **Self-defending code may detect**        |

**Assessment**: The CLI is now within 1 point of the Electron app's security rating. The remaining gap is primarily due to the lack of `--no-inspect` in launchers and the fact that Node.js CLI apps are inherently easier to patch than packaged Electron apps.

---

## 9. What's Protected

| Aspect                                 | Assessment                          |
| -------------------------------------- | ----------------------------------- |
| License server URL                     | ✅ Fully encoded in string array    |
| License server private key             | ✅ Server-only (not in client)      |
| sludge-crypt asymmetric verification   | ✅ Prevents simple response forgery |
| Machine binding (hardware fingerprint) | ✅ systeminformation-based          |
| Store encryption (at-rest)             | ✅ CryptoJS AES via secure-ls       |
| PayPal button IDs                      | ✅ Fully encoded                    |
| Analytics ID                           | ✅ Fully encoded                    |
| API endpoint URLs                      | ✅ Fully encoded                    |
| Business logic flow                    | ✅ Control flow flattened           |
| Source code structure                  | ✅ Self-defending anti-format       |

---

## 10. Recommendations

### High Priority

1. **Add `--no-inspect` to launchers** — Prevent trivial debugger attachment:
   ```batch
   @echo off
   node --no-inspect --frozen-intrinsics "%~dp0vulnsweep.js" %*
   ```
2. **Encode remaining string fragments** — The `paypal` domain fragment and `CLIENT_API_KEY` property name should be fully encoded
3. **Add integrity self-check** — Compute hash of `vulnsweep.js` at startup; refuse to run if modified

### Medium Priority

4. **Rate-limit trial resets** — Server-side fingerprint tracking
5. **Periodic online validation** — Check license/trial status against server
6. **Detect Node.js debugging** — Check for `--inspect` flag at runtime
7. **Consider binary compilation** — `pkg` or Node.js SEA for additional protection

### Low Priority

8. **Rotate PayPal button IDs** — Generate session-specific links
9. **Remove analytics key from client** — Server-proxy analytics calls
10. **Bundle all dependencies** — Remove `package.json` dependency hints

---

## 11. Time-to-Bypass Estimates

| Attacker Skill       | Approach                             | Time to Full Bypass |
| -------------------- | ------------------------------------ | ------------------- |
| **Script Kiddie**    | Trial reset, basic patches           | **30 min - 1 hour** |
| **Junior Developer** | Loader patch + runtime hook          | **1-2 hours**       |
| **Intermediate RE**  | Automated deobfuscation + patching   | **4-8 hours**       |
| **Senior RE**        | Full deobfuscation + key extraction  | **8-16 hours**      |
| **Expert**           | License key generation (server-side) | **Days-weeks**      |

---

## 12. Assessment Summary

| Category                    | Unobfuscated (Previous) | Obfuscated (Current) | Change  |
| --------------------------- | ----------------------- | -------------------- | ------- |
| **Code Obfuscation**        | 1/10                    | **8/10**             | ⬆️ +7   |
| **String Concealment**      | 1/10                    | **9/10**             | ⬆️ +8   |
| **Runtime Info Leaks**      | 1/10                    | **5/10**             | ⬆️ +4   |
| **Anti-Debug/Anti-Tamper**  | 1/10                    | **6/10**             | ⬆️ +5   |
| **License Crypto Strength** | 7/10                    | 7/10                 | —       |
| **Data Storage Security**   | 5/10                    | 5/10                 | —       |
| **Trial Reset Resistance**  | 2/10                    | **4/10**             | ⬆️ +2   |
| **Overall Security**        | **5.0/10**              | **7.5/10**           | ⬆️ +2.5 |

**Bottom line**: This CLI build was produced with full javascript-obfuscator applied (`NODE_ENV=production`, `SKIP_OBFUSCATION` unset). The obfuscation successfully hides all critical sensitive information (license server URL, PayPal button IDs, analytics ID, API endpoints) behind string encoding with base64+RC4 layers, control flow flattening, and self-defending code. Only two minor residual leaks remain: a `paypal` domain fragment and the `CLIENT_API_KEY` property name. The CLI is now appropriately hardened for production distribution, with a security posture close to the Electron app (7.5 vs 8.5). The remaining 1-point gap is due to the inherent accessibility of Node.js CLI applications and the lack of `--no-inspect` launcher flags.
