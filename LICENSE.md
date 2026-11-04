# End User License Agreement (EULA) — VulnSweep

**Application:** VulnSweep
**Copyright Holder / Licensor:** Carlos Galveias
**Effective Date:** May 2025
**Last Reviewed:** June 2026
**Governing Law:** Portugal / European Union
**Support Channel:** https://github.com/carlosgalveias/vulnsweep-releases/issues

---

## IMPORTANT — READ BEFORE INSTALLING OR USING VULNSWEEP

This End User License Agreement ("Agreement" or "EULA") is a legally binding contract between **you** (an individual or legal entity, hereinafter "Licensee" or "you") and **Carlos Galveias** ("Licensor"), the sole author and copyright holder of VulnSweep.

BY CLICKING "I AGREE", BY INSTALLING, COPYING, OR OTHERWISE USING VULNSWEEP, YOU AGREE TO BE BOUND BY THE TERMS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT INSTALL OR USE VULNSWEEP AND DELETE ALL COPIES IN YOUR POSSESSION.

---

## 1. Copyright and Intellectual Property

**Copyright (c) 2025 Carlos Galveias. All Rights Reserved.**

VulnSweep — including but not limited to its source code, object code, compiled binaries, algorithms, user interface designs, documentation, trademarks, trade names, logos, and the "VulnSweep" name and brand identity — is the **exclusive intellectual property of Carlos Galveias** and is protected by:

- The copyright laws of Portugal and the European Union
- The Berne Convention for the Protection of Literary and Artistic Works
- All applicable national and international intellectual property laws and treaties

This Agreement does not convey title or ownership of VulnSweep to you. You acquire only the limited right to use VulnSweep as expressly set forth herein. All rights not expressly granted are reserved by Carlos Galveias.

---

## 2. License Grant

Subject to your full compliance with all terms of this Agreement, Carlos Galveias grants you a:

**Non-exclusive, non-transferable, non-sublicensable, revocable, limited license**

to install and use VulnSweep solely for your own **personal or internal commercial use**, on the **single device** to which your license key is bound (see Section 4), for the duration of your valid license term.

This license is personal to you. It may not be assigned, transferred, sublicensed, or shared with any other individual or entity without the prior written consent of Carlos Galveias.

---

## 3. Trial / Free Tier License

If you are using VulnSweep under the **free tier** (without a paid license key), the following terms apply:

### 3.1 Scanning & Compliance — Free and Unlimited

The following capabilities are granted to all users — including free-tier users — **at no cost, without limitation, and in all environments** (local desktop, CLI, and CI/CD pipelines):

- **Vulnerability Scanning:** Unlimited scanning of any number of repositories, at any frequency, using all available vulnerability intelligence sources (npm-audit, OSV, NVD, GitHub Advisory, CISA KEV, EPSS).
- **CVE Enrichment:** Full cross-source CVE correlation, CVSS score unification, and discrepancy alerts.
- **SBOM Generation:** Export of Software Bills of Materials in CycloneDX JSON v1.6, SPDX JSON v2.3, or CSV format.
- **License Compliance:** Transitive dependency license classification into Safe / Warning / Dangerous / Unknown risk tiers.
- **Reporting:** HTML reports with charts, JSON output, PDF security reports, and threshold-based exit codes for CI/CD pipeline integration.
- **Security Gate:** Use of VulnSweep as a CI/CD security gate (exit code 0 = pass, exit code 1 = fail) is explicitly permitted and free in all environments, including headless and ephemeral environments.

These scanning and compliance features are not time-limited. They do not expire. They require no license key.

### 3.2 Automated Fix Limitation (Fix-and-Commit)

Automated Git fixing, committing, and pushing ("Fix-and-Commit") is subject to the following restrictions:

- **Quota:** Fix-and-Commit is strictly limited to the number of free sessions stipulated in the version you are installing. See the project [README.md](README.md) for the current limit applicable to your version (currently 100 automated fixes per unique, persistent device installation at time of writing).
- **Device Binding:** The free fix quota is bound to the unique, persistent device on which VulnSweep is first installed and activated. The device is identified by a hardware fingerprint. The quota is not transferable between devices.
- **Quota Exhaustion:** Once the free fix quota is exhausted, continued Fix-and-Commit functionality requires purchase of a paid license key.
- **Scope:** Each individual automated fix operation (application of a vulnerability patch or dependency update followed by a Git commit) constitutes one (1) session against the quota.

### 3.3 Headless / CI/CD Environment Restriction — Technical Enforcement

**CRITICAL: Automated remediation features are completely disabled in headless, ephemeral, or CI/CD environments. This is a technical enforcement mechanism, not merely a policy statement.**

The following operations are **unconditionally disabled** when VulnSweep detects execution in a headless, non-interactive, ephemeral, or CI/CD environment:

- Automated fix application (autofix)
- Git staging, committing, and pushing of code changes
- Version bumping operations
- Any operation that modifies source code or repository state in an unattended context

**Environment detection** is performed automatically via, including but not limited to:

- Standard CI/CD environment variables (e.g., `CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `JENKINS_URL`, `CIRCLECI`, `TRAVIS`, `TF_BUILD`)
- Container indicators (e.g., cgroup-based Docker detection)
- Non-interactive terminal detection (non-TTY sessions)

**This restriction exists for the following reasons:**

1. **Safety:** Automated code modification in unattended environments bypasses human review and creates supply-chain risk.
2. **Compliance:** Audit trails in regulated environments require human-in-the-loop approval for code changes.
3. **Determinism:** CI/CD pipelines should observe code state, not mutate it.

In headless environments, VulnSweep functions exclusively as a **security scanner and reporting tool** — scanning, CVE enrichment, SBOM generation, HTML/JSON reporting, and exit-code-based security gating remain fully operational.

### 3.4 Anti-Circumvention — License Violation

**Any attempt to circumvent, disable, spoof, or bypass the headless environment detection mechanism constitutes a material breach of this Agreement and an immediate, automatic termination of your license.**

Without limitation, the following are prohibited:

- Spoofing, unsetting, or manipulating environment variables to disguise a CI/CD or headless environment as a local desktop session
- Injecting false TTY indicators or container detection bypass mechanisms
- Using proxy tools, virtual displays, or terminal emulators solely for the purpose of defeating headless detection
- Modifying, patching, or instrumenting VulnSweep's runtime to bypass environment checks

Violation of this subsection also constitutes a violation of Section 6.3 (Reverse Engineering) of this Agreement.

### 3.5 General Free Tier Terms

- **No Warranty:** Free tier use is provided entirely without warranty. See [DISCLAIMER.md](DISCLAIMER.md) for the full warranty disclaimer, which applies with equal force to free-tier users.
- **No Support:** Free-tier users are not entitled to any form of support. See Section 11 of this Agreement.
- **Liability Cap:** As stated in [DISCLAIMER.md](DISCLAIMER.md), the maximum liability of Carlos Galveias to free-tier users is EUR 0.00.
- **Conversion:** Continued Fix-and-Commit functionality beyond the free quota requires purchase of a paid license key.

---

## 4. Paid License — Single Device Only

**CRITICAL: Each paid license key is bound to a single device.**

If you have purchased a **paid license key** from Carlos Galveias / VulnSweep, the following terms apply:

### 4.1 Single-Device Scope

- **Each license key is valid for exactly ONE (1) device.** A license key activates against a hardware fingerprint generated from the device on which it is first activated.
- **The license will not function on any other device.** Attempting to use the same license key on a different device will fail. This is enforced by the hardware-bound activation system and is not a bug.
- **If your hardware changes significantly** (e.g., replacement of the primary storage device, motherboard, or other core hardware components that alter the device fingerprint), your license may cease to validate on that device. In such an event, you may need to **purchase a new license key**. No refund is provided for hardware-change invalidation unless required by applicable mandatory consumer protection law.
- **There are no multi-device licenses, family licenses, or floating licenses in this version.** Each device requires its own separately purchased license key.

### 4.2 License Key Terms

- Each license key is unique and issued for your use only.
- **You must not share your license key** with any other person or entity. Sharing a key constitutes a material breach of this Agreement.
- **You must not publish, post, or distribute your license key** in any public or private forum, repository, or communication channel.
- Carlos Galveias reserves the right to revoke a license key that has been shared, compromised, or used in violation of this Agreement, without refund.
- License keys are validated against the VulnSweep activation server at the time of activation. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for details of what is transmitted during key validation.

### 4.3 Duration and Updates

- Unless otherwise specified at the time of purchase, a paid license is perpetual for the version purchased, subject to the termination provisions in Section 9.
- Entitlement to future version updates, if any, is as specified at the time of purchase.

---

## 5. No Multi-Seat or Organisational Licenses in This Version

**No company-wide, team, or multi-seat licenses are available in this version of VulnSweep.**

Each individual within an organisation who requires use of VulnSweep must hold their own separately purchased single-device license.

If your organisation requires multiple licenses, volume pricing, OEM licensing, or a custom licensing arrangement, you must open a request at the official project channel:

**https://github.com/carlosgalveias/vulnsweep-releases/issues**

Use the label `[License Enquiry]` in your issue title. **Opening such a ticket does not guarantee a response or the availability of any alternative licensing arrangement.** Future licensing tiers may be introduced at Carlos Galveias' sole discretion.

---

## 6. Restrictions — What You May NOT Do

You are expressly **prohibited** from the following actions. Any of these actions constitutes a material breach of this Agreement and automatically terminates your license:

### 6.1 Distribution and Copying

- Copy, reproduce, redistribute, publish, or make available VulnSweep or any part of it to any third party, whether for free or for payment
- Bundle, package, or include VulnSweep in any other software distribution or product offering
- Mirror or host VulnSweep on any platform, server, or distribution channel not authorised by Carlos Galveias

### 6.2 Commercial Exploitation

- Sell, resell, rent, lease, lend, or sublicense VulnSweep or any rights therein to any third party
- Use VulnSweep as a component of a service you offer to third parties (SaaS, managed service, or otherwise) without a specific commercial licence agreement from Carlos Galveias
- Use VulnSweep to build, develop, or assist in the development of any software product that is competitive with VulnSweep

### 6.3 Reverse Engineering

- Reverse engineer, decompile, disassemble, or otherwise attempt to derive the source code, algorithms, or trade secrets of VulnSweep
- Attempt to circumvent, disable, or bypass any copy protection, license enforcement, activation mechanism, or **environment detection mechanism** in VulnSweep — including but not limited to the headless/CI/CD detection system described in Section 3.4
- Use any automated tool, script, or method to extract, analyse, or replicate the logic of VulnSweep
- Spoof, unset, or manipulate environment variables, TTY indicators, or container detection signals for the purpose of defeating VulnSweep's operational environment restrictions

### 6.4 Modification and Derivative Works

- Modify, adapt, translate, or create derivative works based on VulnSweep
- Merge VulnSweep with other software in a way that obscures its origin or circumvents the terms of this Agreement

### 6.5 Intellectual Property Integrity

- Remove, alter, obscure, or deface any copyright notice, trademark, watermark, or proprietary legend in VulnSweep
- Use the "VulnSweep" name, logo, or brand in any manner implying endorsement or partnership with Carlos Galveias without prior written consent

---

## 7. Ownership and Reservation of Rights

Carlos Galveias retains sole and exclusive ownership of:

- All copies of VulnSweep, in whole or in part, in any form
- All intellectual property rights in VulnSweep, including patents, copyrights, trademarks, and trade secrets
- All derivative works of VulnSweep, regardless of who contributed to their creation
- The "VulnSweep" name, brand identity, and associated goodwill

No rights are granted to you in VulnSweep except as expressly set forth in this Agreement.

---

## 8. No Warranty — Reference to Disclaimer

VULNSWEEP IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND. CARLOS GALVEIAS EXPRESSLY DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

The full warranty disclaimer, limitation of liability, and indemnification terms are set forth in [DISCLAIMER.md](DISCLAIMER.md), which is incorporated into this Agreement by reference and forms an integral part of it.

By accepting this Agreement, you acknowledge that you have read and accepted [DISCLAIMER.md](DISCLAIMER.md) in its entirety.

---

## 9. Term and Termination

### 9.1 Term

This Agreement is effective from the date you first install or use VulnSweep and continues until terminated.

### 9.2 Termination by You

You may terminate this Agreement at any time by uninstalling all copies of VulnSweep and destroying all copies in your possession. For paid licenses, no refund is provided for early termination unless required by applicable mandatory consumer protection law.

### 9.3 Termination by Carlos Galveias

Carlos Galveias may terminate this Agreement and your license immediately and without notice if:

- You breach any term of this Agreement
- You share, publish, or transfer your license key in violation of Section 4.2
- You attempt to reverse engineer, copy, or redistribute VulnSweep in violation of Section 6
- You attempt to circumvent, disable, or bypass the headless/CI/CD environment detection mechanism in violation of Section 3.4
- You use VulnSweep in any way that infringes the intellectual property rights of Carlos Galveias
- You use VulnSweep to build a competing product in violation of Section 6.2

### 9.4 Effect of Termination

Upon termination:

- All license rights granted under this Agreement immediately cease
- You must uninstall VulnSweep from all devices and destroy all copies in your possession
- Sections 1, 3.4, 6, 7, 8, 12, and 13 shall survive termination
- Carlos Galveias is not liable to you for any damages resulting from termination for cause

---

## 10. Updates and New Versions

- Carlos Galveias may release updates, patches, or new versions at its sole discretion.
- Unless otherwise stated at time of purchase, a paid license covers the version purchased. Entitlement to major new versions is as specified at time of purchase.
- Any update or new version you install is subject to the then-current version of this Agreement.
- Carlos Galveias has **no obligation** to provide updates, support, or maintenance unless separately agreed in writing.

---

## 11. Support — No Entitlement

**Purchasing a license does not entitle you to any form of technical support, maintenance, bug fixes, updates, or responses of any kind.**

Support may be provided at the sole discretion of Carlos Galveias, on a case-by-case basis, and may be declined without explanation or notice.

The sole channel for any support request or licence-related enquiry is:

**https://github.com/carlosgalveias/vulnsweep-releases/issues**

Opening a ticket does **not** guarantee a response, a resolution, or any acknowledgement. There is no service level agreement (SLA) applicable to any license tier. There is no email address for support or licensing enquiries. All contact is conducted exclusively through the GitHub issues channel.

---

## 12. Governing Law and Jurisdiction

This Agreement shall be governed by and construed in accordance with the laws of **Portugal**, without regard to conflict of law principles.

Any dispute arising out of or in connection with this Agreement that cannot be resolved amicably within thirty (30) days shall be submitted to the **exclusive jurisdiction of the courts of Portugal**.

**Consumer rights:** If you are a consumer resident in the European Union, nothing in this Agreement affects your statutory rights under applicable EU consumer protection law, including Directive 2019/770/EU on contracts for the supply of digital content and services.

---

## 13. General Provisions

### 13.1 Entire Agreement

This Agreement, together with [DISCLAIMER.md](DISCLAIMER.md) and [PRIVACY_POLICY.md](PRIVACY_POLICY.md), constitutes the entire agreement between you and Carlos Galveias with respect to VulnSweep. It supersedes all prior agreements, representations, and understandings, whether oral or written.

### 13.2 Severability

If any provision of this Agreement is found to be invalid, illegal, or unenforceable, that provision shall be modified to the minimum extent necessary to make it valid and enforceable. All other provisions shall remain in full force and effect.

### 13.3 No Waiver

Failure by Carlos Galveias to enforce any provision of this Agreement shall not constitute a waiver of the right to enforce that provision in the future.

### 13.4 Amendments

Carlos Galveias reserves the right to update the terms of this Agreement for future versions of VulnSweep. The terms applicable to your current installation are those accepted at the time of installation. Material changes will be disclosed with an updated Last Reviewed date.

### 13.5 Contact and Enquiries

All licensing enquiries — including requests for commercial, volume, or OEM licenses — must be submitted through the official project channel:

**https://github.com/carlosgalveias/vulnsweep-releases/issues**

Use the label `[License Enquiry]` in your issue title. There is no email address for licensing contact.

---

## Summary of Key Terms

| Topic                         | Summary                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| What you get                  | A personal, non-transferable right to use VulnSweep on ONE single licensed device                                       |
| Scanning (free tier)          | Unlimited scanning, CVE enrichment, SBOM, license compliance, and reporting — always free, all environments             |
| Autofix (free tier)           | Limited to the free quota per device (see README.md for current limits) — local machines only                           |
| Headless / CI/CD              | Autofix, commit, and push are **technically disabled** in headless/CI/CD environments; scanning is unrestricted         |
| Anti-circumvention            | Bypassing headless detection = immediate license termination (Section 3.4)                                              |
| Device scope                  | Single device only — the license will not function on any other device                                                  |
| Hardware changes              | Significant hardware changes may invalidate your license; a new purchase may be required                                |
| Multi-seat / company licenses | Not available in this version — open a ticket to enquire about future options                                           |
| What you cannot do            | Copy, redistribute, reverse engineer, resell, share keys, circumvent environment detection, or build competing products |
| Support                       | Not guaranteed — provided case-by-case at sole discretion; no SLA                                                       |
| Warranty                      | None. Software is provided AS IS. See DISCLAIMER.md.                                                                    |
| Liability                     | Capped at license fee paid (EUR 0 for free-tier users). See DISCLAIMER.md.                                              |
| Ownership                     | Carlos Galveias retains all IP rights. You own only the right to use on one device.                                     |
| Termination                   | Immediate upon breach. Uninstall all copies upon termination.                                                           |
| Governing Law                 | Portugal / European Union                                                                                               |

---

_Copyright (c) 2025 Carlos Galveias. All Rights Reserved._
_VulnSweep is proprietary software. This is not an open-source license._
_Last reviewed: June 2026_
