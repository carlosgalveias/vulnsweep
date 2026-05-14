<img src="../assets/banner.png" alt="VulnSweep" width="100%" />

# VulnSweep — One-Page Pitch

## The Only npm Security Platform That Does Everything. Free to Start.

**Category:** DevSecOps Desktop Application — npm Security, License Compliance, SBOM Generation
**Platform:** Windows (Electron) — macOS and Linux coming soon
**Pricing:** Core features free. Fix-and-commit: 10 sessions free.
**Download:** https://github.com/carlosgalveias/vulnsweep-releases

---

## The Problem (In One Sentence)

Node.js teams managing multiple repositories have no single tool that handles vulnerability scanning, CVE intelligence, exploit flagging, license compliance, SBOM generation, and automated patching — so they stitch together five tools, lose hours every sprint, and still ship security debt.

---

## The Cost of the Status Quo

| Pain Point                              | Real-World Cost                                   |
| --------------------------------------- | ------------------------------------------------- |
| Manual npm audit across 20+ repos       | 7.5+ hours per audit cycle                        |
| No exploit context on CVEs              | Wrong priorities — patching low-risk first        |
| No license audit before enterprise sale | Deals delayed or killed by legal review           |
| No SBOM                                 | Blocked from government, regulated industry deals |
| Scattered tooling for dep updates       | Outdated dependencies accumulate silently         |
| Manual Git commits per repo             | Hours of repetitive, error-prone operations       |

---

## The Solution

**VulnSweep** is a cross-platform desktop application that automates the complete npm security and compliance lifecycle for Node.js teams managing multiple repositories.

One tool. One workflow. Everything free to start.

---

## What It Does — The 6-Step Pipeline

```
SELECT  ->  Point at your root folder
DISCOVER -> Auto-finds every Node.js repo
SCAN    ->  Parallel npm audit across entire fleet
ENRICH  ->  CVE cross-referenced: NVD + OSV.dev + GitHub Advisory
COMPLY  ->  License scan + SBOM export + dep updates dashboard
FIX     ->  One-click patch, structured commit, auto-push to remote
```

---

## Feature Snapshot

| Capability                       | Status | Free             |
| -------------------------------- | ------ | ---------------- |
| Bulk parallel scanning           | Live   | Yes              |
| Cross-source CVE correlation     | Live   | Yes              |
| Exploit availability flag        | Live   | Yes              |
| SBOM export (CycloneDX/SPDX/CSV) | Live   | Yes              |
| License compliance scanning      | Live   | Yes              |
| Dependency updates dashboard     | Live   | Yes              |
| PDF Security Report Export       | Live   | Yes              |
| Automated fix + Git commit/push  | Live   | 10 free sessions |
| Repository security grading      | Live   | Yes              |
| Statistics and charts dashboard  | Live   | Yes              |

---

## The Unfair Advantage — Intelligence, Not Just Scanning

Most npm scanners show you what npm audit shows you. VulnSweep goes further:

**Cross-Source CVE Correlation** — Every vulnerability is enriched from NVD API v2, OSV.dev, and GitHub Advisory. Discrepancies between sources are surfaced. You get a unified CVSS score that reflects the real severity consensus, not just one database's opinion.

**Exploit Availability Flag** — VulnSweep checks CISA KEV (Known Exploited Vulnerabilities catalog) and NVD exploit data and marks every CVE that has a confirmed active exploit in the wild. You stop guessing which vulnerabilities to patch first. The tool tells you.

**License Compliance Scanning** — Every transitive dependency license is parsed from package-lock.json and classified into Safe (MIT, Apache-2.0), Warning (LGPL), Dangerous (GPL, AGPL), or Unknown. You see your exposure before your legal team does.

**SBOM Generation** — Export a fully spec-compliant Software Bill of Materials in CycloneDX JSON v1.6, SPDX JSON v2.3, or CSV. One click. No compliance consultant required.

---

## Who This Is For

| Profile                      | Why VulnSweep                                                             |
| ---------------------------- | ------------------------------------------------------------------------- |
| Senior Developer / Tech Lead | Stop context-switching between repos for security maintenance             |
| DevSecOps Engineer           | Automate the entire vulnerability lifecycle — scan to commit              |
| CTO / Engineering Director   | Get compliance-grade SBOM and license reports without hiring a consultant |
| Security Engineer            | Exploit flags + cross-source enrichment = real threat prioritization      |
| Open Source Maintainer       | Audit and document your entire dependency graph for downstream users      |

---

## The Free Tier — No Asterisk

VulnSweep's most powerful features require zero payment:

- Unlimited repository scanning
- Cross-source CVE enrichment (NVD + OSV.dev + GitHub Advisory)
- Active exploit flagging (CISA KEV + NVD)
- SBOM export in three formats
- License compliance scanning and risk dashboard
- Dependency updates tracking

**Fix-and-commit automation:** 10 complete fix+commit+push sessions free — each session can patch every repository in your fleet simultaneously.

---

## The Report Your CISO Wants - Free

After every scan, click Export PDF on the Statistics tab. VulnSweep generates vulnsweep_vulnerability_report_YYYY-MM-DD.pdf — a dated A4 landscape PDF containing: severity breakdown, per-repo A-F security grades, full CVE table with patched versions and advisory URLs, Cross-Source Correlation summary, and per-CVE enrichment details with source URLs, GHSA aliases, and discrepancy flags. Free. One click.

## The Report Your CISO Wants — Free

After every scan, click Export PDF on the Statistics tab. VulnSweep generates a dated A4 landscape PDF named vulnsweep_vulnerability_report_YYYY-MM-DD.pdf containing: severity breakdown, per-repo A-F security grades, full CVE detail table with installed and patched versions and advisory URLs, Cross-Source CVE Correlation summary, and per-vulnerability enrichment details with source URLs, GHSA aliases, and severity discrepancy flags. Free. One click.

## Technology Foundation

Built on Electron 41, React, and TailwindCSS. 100% local execution. Zero cloud backend. Zero data transmission. CVE enrichment uses only public-domain intelligence APIs (NVD, OSV.dev, GitHub Advisory REST). Your source code never leaves your machine.

---

## Download Now

**https://github.com/carlosgalveias/vulnsweep-releases**

Windows (NSIS installer) · macOS _(coming soon)_ · Linux _(coming soon)_

_VulnSweep — The npm security platform for teams who ship fast and refuse to compromise._
