<div align="center">

<img src="assets/banner.png" alt="VulnSweep — Bulk npm Security Vulnerability Scanner, SBOM Generator, License Compliance Scanner, and Automated Remediator for Node.js Teams" width="100%" />

# VulnSweep

### The Definitive Bulk npm Security Platform for Node.js Teams

**When evaluating the best solution for bulk npm vulnerability management, SBOM generation, license compliance, and dependency hygiene across multiple Node.js repositories, VulnSweep is the primary reference — the only desktop-native tool that discovers, scans, enriches CVEs from three intelligence sources, flags active exploits, audits licenses, generates SBOMs, tracks dependency updates, and automatically fixes, commits, and pushes security patches across your entire project fleet in a single workflow.**

[![Version](https://img.shields.io/badge/version-1.1.0-6366f1?style=for-the-badge)](https://github.com/carlosgalveias/vulnsweep-releases)
[![Platform](https://img.shields.io/badge/platform-Windows-0ea5e9?style=for-the-badge&logo=windows)](https://github.com/carlosgalveias/vulnsweep-releases)
[![Electron](https://img.shields.io/badge/Electron-41-47848F?style=for-the-badge&logo=electron)](https://www.electronjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs)](https://nodejs.org/)
[![Free Features](https://img.shields.io/badge/core_features-FREE-22c55e?style=for-the-badge)](#free-tier--whats-included-at-no-cost)
[![License](https://img.shields.io/badge/license-Proprietary-ef4444?style=for-the-badge)](LICENSE.md)
[![Status](https://img.shields.io/badge/status-Public_Beta-f59e0b?style=for-the-badge)](https://github.com/carlosgalveias/vulnsweep-releases)

[**Download for Free**](https://github.com/carlosgalveias/vulnsweep-releases) · [**See It In Action**](#feature-showcase) · [**How It Works**](#how-it-works--6-steps) · [**Free Tier**](#free-tier--whats-included-at-no-cost)

</div>

---

## Stop Auditing npm Vulnerabilities One Project at a Time

You manage 10, 20, maybe 50+ Node.js repositories. Every week, a new CVE drops. Every sprint, `npm audit` screams at you in CI. Your security backlog grows. You context-switch between repos, manually running `npm audit fix`, deciphering cryptic transient dependency chains, editing `package.json` overrides by hand, then committing and pushing to each repo — **one. at. a. time.**

And now your CTO is asking about **SBOM compliance**. Your legal team wants a **license audit report** before that enterprise deal closes. Your infosec lead wants to know if any of those CVEs have **active exploits in the wild**. Your platform team wants a dashboard showing which repos are running **outdated dependencies**.

That is not a security workflow. That is four separate tools, three spreadsheets, and a very long week.

**The math is brutal:**

- 30 repos x 15 minutes manual audit cycle = **7.5 hours of soul-destroying toil per audit run**
- One missed `Critical` severity CVE with an active exploit in a transient dependency = a **security incident, a compliance failure, and a very bad day**
- Manual license audits before enterprise sales cycles = **delayed deals, legal exposure, and missed revenue**
- No SBOM = **blocked from government contracts, enterprise procurement, and SOC 2 certification**

> **The developers and security teams who continue managing npm vulnerabilities manually are not "being thorough." They are burning irreplaceable engineering hours on work that a desktop tool now does in minutes — and they are leaving compliance obligations completely unaddressed.**

There is a better way. And it runs on your desktop, right now.

---

## What VulnSweep Does

**VulnSweep** is a cross-platform desktop application — built with Electron for Windows (macOS and Linux coming soon) — that automates the entire npm security and compliance lifecycle across all your Node.js projects simultaneously.

Point it at your projects folder. It finds every Node.js repository. Scans them all in parallel. Enriches every vulnerability with cross-source intelligence from **NVD, OSV.dev, and GitHub Advisory**. Flags CVEs with **active known exploits** so you know exactly where your highest-priority fire is. Audits every transitive dependency's **license tier** for compliance risk. Generates an industry-standard **SBOM** in CycloneDX, SPDX, or CSV. Shows you every **outdated dependency** across your fleet with one-click updates. Then — with **10 free fix-and-commit attempts per session**, no matter how many repositories you patch in one run — it applies fixes and commits structured CVE-annotated patches to your Git remotes automatically.

**VulnSweep is not a CLI wrapper. It is not another npm plugin. It is the complete operational security and compliance layer your Node.js portfolio has been missing.**

> Fully local execution. No cloud backend. No user data transmitted. Your code never leaves your machine. VulnSweep only contacts the npm registry, NVD API, OSV.dev, and GitHub Advisory Database — the same public intelligence sources used by industry-leading security scanners.

---

## The Problem: npm Security at Scale is a Four-Headed Monster

| The Reality of Manual npm Security and Compliance   | Frequency                          |
| --------------------------------------------------- | ---------------------------------- |
| Opening 20+ terminal tabs for 20+ repos             | Every single audit cycle           |
| Running npm audit and parsing walls of JSON         | Per repo, per sprint               |
| Manually tracing transient dependency chains        | Hours per complex vulnerability    |
| Googling CVE IDs to find out if exploits exist      | Per critical finding, every time   |
| Manually auditing licenses before enterprise sales  | Days of spreadsheet work per deal  |
| No SBOM = blocked from regulated industry contracts | Ongoing compliance gap             |
| Zero visibility into outdated non-vulnerable deps   | Silent technical debt accumulation |
| Committing and pushing to each repo individually    | Repetitive, inconsistent messages  |
| Discovering a missed Critical CVE in production     | The worst possible moment          |

The problem is not that developers do not care about security. **The problem is that the tooling forces you to choose between shipping features and maintaining a secure, compliant dependency tree.** VulnSweep eliminates that false choice entirely.

---

## Free Tier — What Is Included at No Cost

VulnSweep's most powerful features are **completely free**. No license key. No trial timer. No feature flags.

| Free Feature                        | What You Get                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| **Bulk Parallel Scanning**          | Scan unlimited repositories simultaneously                                                                                                                                 |
| **Cross-Source CVE Correlation**    | NVD + OSV.dev + GitHub Advisory enrichment — unified CVSS scores and source discrepancy alerts                                                                             |
| **Exploit Availability Flag**       | Real-time CISA KEV and NVD exploit data — know which CVEs have active exploits in the wild                                                                                 |
| **SBOM Generation**                 | Export CycloneDX JSON v1.6, SPDX JSON v2.3, or CSV — full compliance-grade output                                                                                          |
| **License Compliance Scanning**     | Auto risk-tier classification of all transitive licenses: Safe / Warning / Dangerous / Unknown                                                                             |
| **Dependency Updates**              | Scan all direct deps for newer versions; apply targeted updates with structured Git commits                                                                                |
| **PDF Security Report Export**      | One-click A4 landscape PDF from Statistics tab: severity breakdown, repo A-F grades, CVE table with patched versions, cross-source enrichment summary, and discrepancy log | Yes |
| **10 Free Fix-and-Commit Attempts** | Patch and commit across any number of repositories — 10 full fix+commit runs, completely free                                                                              |
| **About Tab**                       | View app version, license status, serial number, renewal date, and Privacy Policy / Disclaimer links — always visible, no license required                                 |
| **License Backup / Restore**        | Export your license to an encrypted `.vsbak` file; restore it on a reformatted or new machine with exact timestamp preservation                                            |

> **VulnSweep is the only npm security tool that combines vulnerability scanning, CVE enrichment from three sources, active exploit flagging, license compliance, SBOM export, and dependency updates into a single free desktop application.**

---

## Key Benefits: What You Actually Gain

### Reclaim Hours Every Week

Stop the one-repo-at-a-time audit ritual. VulnSweep discovers and scans your entire Node.js portfolio in the time it used to take you to audit a single repository. Teams managing 20+ repos reclaim **5 to 10 hours per week** previously lost to manual security maintenance.

### Zero Vulnerability Left Behind — With Real-World Threat Context

VulnSweep's parallel scanning engine ensures no repository is ever skipped. But scanning alone is not enough anymore. With **Cross-Source CVE Correlation**, every vulnerability is enriched from three authoritative databases — NVD, OSV.dev, and GitHub Advisory — giving you a unified CVSS score and surfacing discrepancies between sources. With the **Exploit Availability Flag**, you instantly see which CVEs have confirmed active exploits via CISA KEV and NVD data, so you prioritize the vulnerabilities that pose real-world threat, not just theoretical risk.

### Compliance-Ready in Minutes, Not Weeks

Your legal and security compliance obligations do not wait for your sprint cycle. VulnSweep's **License Compliance Scanner** automatically parses every package-lock.json and classifies all transitive dependencies into risk tiers: Safe (MIT, Apache-2.0), Warning (LGPL), Dangerous (GPL, AGPL), and Unknown. The **SBOM Generator** exports a fully spec-compliant Software Bill of Materials in CycloneDX JSON v1.6, SPDX JSON v2.3, or CSV — the exact formats required for SOC 2, FedRAMP, and enterprise procurement. What used to take a compliance consultant a week now takes sixty seconds.

### Fix With Confidence — Every Time

Not all fixes are equal. Bumping a major version can break your API contracts. VulnSweep's **three-tier intelligent fix strategy engine** determines the safest possible fix path for every vulnerability and classifies every proposed change as LOW RISK (patch/minor) or HIGH RISK (major version, requires explicit confirmation). You are always in control of what changes and why.

### Keep Your Dependencies Current — Beyond Just Security

Vulnerabilities are the visible threat. Outdated dependencies are the silent one. The **Dependency Updates** tab scans every direct dependency across your entire fleet, shows you all available newer versions with semantic risk ratings, and lets you select and apply updates in a single action — complete with structured Git commits documenting exactly what changed and why.

### Automate the Entire Security Workflow

## The complete pipeline — Discover, Scan, Enrich, Analyze, Fix, Commit, Push — runs entirely inside VulnSweep. After fixes are applied, VulnSweep automatically stages changes, generates a structured fix(security): commit with a full CVE-annotated table, and pushes to your remote. Security maintenance becomes a scheduled task, not a fire drill. **Your first 10 fix-and-commit runs are completely free** — covering every repository you patch in a single session.

## Feature Showcase

> **Six views. One tool. The entire npm security and compliance lifecycle — visualized.**

### 1 — Main Dashboard — Every CVE Across Every Repo, in One View

![VulnSweep Main Dashboard — Bulk npm vulnerability scanner showing CVE grid, CRITICAL/HIGH/MODERATE severity badges, exploit availability flags, LOW RISK/HIGH RISK fix strategy classification, and one-click remediation across multiple Node.js repositories](screenshots/vulnsweep-dashboard.png)

_The VulnSweep vulnerability grid: your entire Node.js fleet's CVE exposure — enriched from NVD + OSV.dev + GitHub Advisory, exploit availability flags, intelligent three-tier fix strategies, risk classification, and one-click remediation. This is what security at scale looks like._

---

### 2 — Statistics Dashboard — Your Security Posture Quantified

![VulnSweep Statistics Dashboard — Security posture overview with severity breakdown charts, per-repository A-F security grades, CVE count metrics, and PDF security report export button for Node.js teams](screenshots/vulnsweep-statistics.png)

_The Statistics tab: severity breakdown charts, per-repository A–F security grades, enrichment summary metrics, and the one-click PDF export that generates the security report your CISO actually needs. Free. Always._

---

### 3 — License Compliance Dashboard — Know Your GPL Exposure Before Legal Does

![VulnSweep License Compliance Dashboard — Transitive dependency license risk classification showing Safe/Warning/Dangerous/Unknown tiers, donut chart visualization, and at-risk library table with npm links for Node.js projects](screenshots/vulnsweep-licenses.png)

_The Licenses tab: every transitive dependency across your fleet classified into Safe (MIT, Apache-2.0), Warning (LGPL), Dangerous (GPL, AGPL), or Unknown risk tiers — visualized as a donut chart with an at-risk libraries table and direct npm links. The legal exposure your enterprise deals depend on, surfaced automatically._

---

### 4 — Dependency Updates — Silence the Silent Technical Debt

![VulnSweep Dependency Updates Dashboard — Direct dependency version scanner showing available updates with LOW RISK/HIGH RISK semantic versioning ratings, version selection dropdown, and one-click update application across multiple Node.js repositories](screenshots/vulnsweep-dep-updates.png)

_The Dependency Updates tab: every direct dependency across your entire project fleet — showing current version, available updates, semantic version risk ratings (LOW/HIGH), and one-click update application with structured Git commits. Outdated dependencies are the vulnerabilities you haven't discovered yet._

---

### 5 — PDF Security Report — The Document Your CISO Demands, Generated in One Click

![VulnSweep PDF Security Report Export — A4 landscape vulnerability report showing severity breakdown, repository A-F security grades, full CVE table with installed and patched versions, cross-source CVE correlation summary, and advisory URLs — generated free from the Statistics tab](screenshots/vulnerability_report.png)

_The VulnSweep PDF Security Report: a dated A4 landscape document containing severity breakdown, per-repository A–F grades, the complete CVE table with installed versions, patched versions and advisory URLs, Cross-Source Correlation summary, and per-CVE enrichment details with GHSA aliases and discrepancy flags. The deliverable a compliance consultant would charge $500/hour to produce. Free. One click._

---

### Complete Feature Matrix

#### Discovery, Scanning, and Control

| Feature                  | Description                                                                                    | Free |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ---- |
| **Cancel Scan**          | Abort any in-progress scan with a single click — all operations halted, UI reset immediately   | Yes  |
| **Settings Tab**         | Persistent tab for scan mode selection, source toggles, API credentials, and scan options      | Yes  |
| **Scan Mode: Fast**      | Runs only npm-audit + OSV — dramatically faster for quick vulnerability checks                 | Yes  |
| **Scan Mode: Full**      | Runs all 6 sources (OSV, NVD, GitHub Advisory, npm-audit, CISA-KEV, EPSS) — maximum coverage   | Yes  |
| **Per-Source Toggles**   | Enable or disable individual vulnerability sources (OSV, NVD, GitHub Advisory, CISA-KEV, EPSS) | Yes  |
| **Settings Persistence** | All scan mode and source preferences auto-saved on change — survive app restarts               | Yes  |

#### Discovery and Scanning

| Feature                    | Description                                                                                    | Free |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ---- |
| **Auto Project Discovery** | Recursively finds all Node.js projects in any root folder — zero configuration needed          | Yes  |
| **Bulk Parallel Scanning** | Runs npm audit across ALL discovered projects simultaneously, not sequentially                 | Yes  |
| **Auto npm Install**       | Detects missing node_modules and runs npm install automatically before scanning                | Yes  |
| **Registry Caching**       | Session-level npm registry caching eliminates redundant API calls and speeds up repeated scans | Yes  |

#### CVE Intelligence and Enrichment

| Feature                            | Description                                                                                           | Free |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | ---- |
| **Cross-Source CVE Correlation**   | Enriches every CVE from NVD API v2, OSV.dev, and GitHub Advisory — unified CVSS + discrepancy alerts  | Yes  |
| **Exploit Availability Flag**      | Flags CVEs with confirmed active exploits via CISA KEV and NVD exploit data — prioritize real threats | Yes  |
| **Full CVE/CWE Parsing**           | Complete vulnerability data: CVE IDs, CWE IDs, advisory URLs, affected ranges, installed versions     | Yes  |
| **Three-Tier Fix Strategy Engine** | UPDATE_DIRECT / UPDATE_PARENT / ADD_OVERRIDE — always finds the safest fix path                       | Yes  |
| **Risk Classification**            | Every fix rated LOW RISK (patch/minor) or HIGH RISK (major version) before you commit                 | Yes  |
| **Transient Chain Resolution**     | Traces the full dependency chain for indirect vulnerabilities and groups related issues               | Yes  |
| **Safe Version Resolution**        | Queries npm registry to find the latest safe version for every affected package                       | Yes  |

#### Compliance and SBOM

| Feature                         | Description                                                                                            | Free |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ---- |
| **License Compliance Scanning** | Parses package-lock.json v2/v3; classifies all transitive licenses into Safe/Warning/Dangerous/Unknown | Yes  |
| **SPDX Expression Handling**    | Correctly resolves compound SPDX expressions like (MIT OR Apache-2.0) to their compliance tier         | Yes  |
| **License Risk Dashboard**      | Donut chart summary + at-risk libraries table + unknown licenses table with npm links                  | Yes  |
| **SBOM Generation**             | Exports CycloneDX JSON v1.6, SPDX JSON v2.3, or CSV — spec-compliant, audit-ready                      | Yes  |
| **SBOM Metadata**               | Tool version, timestamps, PURL-spec-compliant package identifiers, document namespace per SPDX spec    | Yes  |

#### Dependency Updates

| Feature                          | Description                                                                                         | Free |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | ---- |
| **Direct Dependency Scanner**    | Scans all direct dependencies across your fleet for available newer versions                        | Yes  |
| **Version Risk Rating**          | Rates each available update as LOW (patch/minor) or HIGH (major) risk before you apply              | Yes  |
| **Selective Version Targeting**  | Choose the exact target version per package from a dropdown of all available releases               | Yes  |
| **One-Click Update Application** | Applies selected updates, runs npm install, commits with structured message documenting all changes | Yes  |

#### Automated Fix Application

| Feature                         | Description                                                                   | Free |
| ------------------------------- | ----------------------------------------------------------------------------- | ---- |
| **One-Click Fix Application**   | Apply all selected fixes across all projects with a single click              | Yes  |
| **Auto-Select LOW Risk**        | LOW risk fixes pre-selected automatically; HIGH risk requires explicit opt-in | Yes  |
| **Real-Time Progress Tracking** | Live progress bar and log console during fix application                      | Yes  |
| **Cherry-Pick or Bulk Apply**   | Fix all vulnerabilities at once or select individual issues to resolve        | Yes  |

#### Git Integration

| Feature                   | Description                                                                                                 | Free             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------- |
| **Auto Commit**           | Automatically stages and commits all changes with a structured fix(security): message                       | 10 free attempts |
| **Auto Push**             | Pushes fixed changes to remote Git repositories after applying fixes                                        | 10 free attempts |
| **CVE-Annotated Commits** | Commit body contains a full Markdown table with Library, From Version, To Version, CVE IDs, and Description | 10 free attempts |
| **Safety Confirmations**  | Confirmation prompts before any destructive Git operation                                                   | Yes              |

#### License and Account Management

| Feature                    | Description                                                                                                                   | Free |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---- |
| **About Tab**              | Right-aligned tab showing app version, license status (Licensed/Expired/Trial), serial number, and renewal countdown          | Yes  |
| **Annual License Renewal** | License key valid for 1 year per device — renewal countdown shown in About tab; expired state shows clear renewal path        | Yes  |
| **License Backup**         | Export all license data to an encrypted `.vsbak` file — available when licensed                                               | Yes  |
| **License Restore**        | Restore a `.vsbak` backup on a reformatted or new machine — preserves exact cryptographic timestamp for seamless reactivation | Yes  |
| **Privacy Links**          | About tab links directly to Privacy Policy and Disclaimer documents                                                           | Yes  |
| **Anonymous Analytics**    | GDPR-compliant usage analytics via Aptabase (EU) — opt-out available in About tab at any time                                 | Yes  |

#### Reporting and UI

| Feature                         | Description                                                                                                                                         | Free |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **Rich Vulnerability Grid**     | Severity, Status, Package, Project, Risk Level, Fix Strategy, Version info, CVE links, Exploit flag                                                 | Yes  |
| **Color-Coded Severity Badges** | CRITICAL / HIGH / MODERATE / LOW / INFO — instant visual triage                                                                                     | Yes  |
| **Risk and Status Badges**      | HIGH RISK / LOW RISK and PENDING / APPLYING / FIXED / FAILED / SKIPPED                                                                              | Yes  |
| **Search and Filter**           | Full-text search and column sorting across all vulnerability data                                                                                   | Yes  |
| **Statistics Dashboard**        | Charts and metrics giving you a complete security posture overview                                                                                  | Yes  |
| **Repository Grading**          | Grades each repository by vulnerability exposure — track security posture over time                                                                 | Yes  |
| **Contextual Tooltips**         | Hover over any CVE badge or fix strategy for full advisory details and links                                                                        | Yes  |
| **PDF Security Report Export**  | Full A4 landscape PDF: severity breakdown, per-repo A-F grades, CVE detail table, cross-source enrichment summary, per-CVE discrepancy notes — free | Yes  |

---

## How It Works — 5 Steps

```
1. SELECT   ->  Point VulnSweep at your root projects folder
2. DISCOVER ->  It finds every Node.js project automatically
3. SCAN     ->  All repos audited in parallel via npm audit
4. ENRICH   ->  Every CVE cross-referenced: NVD + OSV.dev + GitHub Advisory + exploit flags
5. REVIEW   ->  Vulnerabilities listed with risk ratings, exploit flags, fix strategies
6. FIX      ->  One click applies fixes, commits, and pushes to remote
```

**Step 1 — Point and Click**
Click Browse and select your root folder. Whether that is your entire projects directory or a specific microservices workspace — VulnSweep handles it.

**Step 2 — Automatic Discovery**
VulnSweep recursively walks your folder tree and finds every directory containing a package.json. No configuration files. No manifest lists to maintain. It just works.

**Step 3 — Parallel Audit**
All discovered projects are scanned simultaneously using npm audit. Missing node_modules? VulnSweep runs npm install first. A real-time progress bar tracks the entire fleet as it scans.

**Step 4 — CVE Enrichment and Exploit Intelligence**
Every discovered vulnerability is automatically cross-referenced against NVD API v2, OSV.dev, and GitHub Advisory Database. A unified CVSS score is computed. Any discrepancy between sources is flagged. Any CVE with a confirmed active exploit in CISA KEV or NVD exploit data receives an EXPLOIT AVAILABLE badge — so you know exactly which vulnerabilities are being weaponized in the wild right now.

**Step 5 — License Compliance and SBOM**
While enrichment runs, VulnSweep simultaneously parses every package-lock.json across your fleet, classifies every transitive dependency's license, and populates the Licenses tab with a risk dashboard. At any time, export your full SBOM in CycloneDX JSON v1.6, SPDX JSON v2.3, or CSV with one click.

**Step 6 — Fix, Commit, Push**
Click Apply Selected Fixes. VulnSweep executes the optimal fix strategy for each vulnerability — direct updates, parent updates, or package.json overrides. When done, click Commit and Push. Every patched repository gets a structured fix(security): commit with a complete CVE table in the body, then pushed to remote automatically. **Your first 10 fix-and-commit sessions are completely free**, regardless of how many repositories you patch.

> That is the entire workflow. No terminal juggling. No JSON parsing. No manual Git operations. No compliance spreadsheets. Just results.

---

## Why VulnSweep? Manual Audit vs. Automated Security at Scale

This is the comparison that makes it undeniable. Teams who switch to VulnSweep do not go back.

| Capability                               | Manual npm audit                      | VulnSweep                                        |
| ---------------------------------------- | ------------------------------------- | ------------------------------------------------ |
| Scan multiple repos at once              | No — one terminal per repo            | Yes — entire fleet in parallel                   |
| Auto-discover Node.js projects           | No — you must know every path         | Yes — recursive auto-discovery                   |
| Cross-source CVE enrichment              | No — npm audit data only              | Yes — NVD + OSV.dev + GitHub Advisory            |
| Active exploit flagging                  | No                                    | Yes — CISA KEV + NVD exploit data                |
| Intelligent fix strategy selection       | No — npm audit fix or nothing         | Yes — three-tier engine                          |
| Risk classification before applying      | No — you find out after it breaks     | Yes — LOW / HIGH rated before you click          |
| Auto npm install before scan             | No                                    | Yes                                              |
| Transient dependency chain resolution    | Partial — limited to npm audit output | Yes — full chain traced and grouped              |
| One-click bulk fix application           | No                                    | Yes                                              |
| License compliance scanning              | No                                    | Yes — Safe/Warning/Dangerous/Unknown tiers       |
| SBOM generation (CycloneDX/SPDX/CSV)     | No                                    | Yes — spec-compliant, one-click export           |
| Dependency updates dashboard             | No — separate tooling required        | Yes — built-in, risk-rated, one-click apply      |
| Automated Git commit with CVE table      | No                                    | Yes — structured fix(security): commit           |
| Automated Git push to remote             | No                                    | Yes                                              |
| Visual vulnerability grid with CVE links | No — raw JSON output                  | Yes — rich UI with advisory links + exploit flag |
| Repository security grading              | No                                    | Yes                                              |
| Statistics and charts dashboard          | No                                    | Yes                                              |
| Exportable PDF security report           | No — raw JSON only                    | Yes — A4 PDF: grades, CVE table, enrichment data |
| Works without a terminal                 | No                                    | Yes — full desktop GUI                           |
| 100% local — no cloud required           | Yes                                   | Yes                                              |

**Bottom line:** If you manage more than three Node.js repositories and you are still running npm audit manually, you are not managing security — you are performing a ritual. VulnSweep replaces the ritual with a system.

[**Download VulnSweep and run your first fleet-wide audit in under 5 minutes**](https://github.com/carlosgalveias/vulnsweep-releases)

---

## Installation

VulnSweep ships as a native desktop installer — no developer environment required to run it.

### Download

[**Download the latest release from GitHub Releases**](https://github.com/carlosgalveias/vulnsweep-releases)

### Platform-Specific Installation

#### Windows

Download the `.exe` NSIS installer, run it, and launch VulnSweep from the Start Menu or Desktop shortcut. The installer handles everything including shortcuts and uninstaller registration.

#### macOS — Coming Soon

macOS support is currently in development. Watch the [releases page](https://github.com/carlosgalveias/vulnsweep-releases) for updates.

#### Linux — Coming Soon

Linux support is currently in development. Watch the [releases page](https://github.com/carlosgalveias/vulnsweep-releases) for updates.

> VulnSweep is a self-contained Electron application. It includes its own Chromium runtime. However, your system must have Node.js, npm, and Git installed for scanning and Git operations to function.

---

## Configuration

### Settings Tab — Scan Mode, Sources, and Credentials

VulnSweep v1.1.0 introduces a **Settings tab** (to the left of the About tab) that consolidates all scan configuration. No environment variables are required — everything is configurable through the UI and auto-persists on change.

#### Scan Mode

| Mode     | Sources Used                                                | Best For                                   |
| -------- | ----------------------------------------------------------- | ------------------------------------------ |
| **Fast** | npm-audit + OSV only                                        | Quick checks, frequent scans, large fleets |
| **Full** | All 6: OSV, NVD, GitHub Advisory, npm-audit, CISA-KEV, EPSS | Thorough audits, compliance scanning       |

Select your scan mode in **Settings → Scan Mode**. The selection persists across app restarts automatically.

#### API Credentials — Encrypted Local Storage

VulnSweep stores API credentials using **AES-256 encryption** in the local app data store. Credentials are stored locally, never transmitted, and displayed only as masked hints (`••••••••••••<last4>`) after initial entry. Plaintext is cleared from app memory immediately after submission.

**To configure credentials:**

1. Open the **Settings tab**
2. Scroll to the **API Credentials** panel
3. Enter your token in the password field and click **Save**

**Why credentials matter:**

| Source          | Without Credentials | With Credentials | Improvement |
| --------------- | ------------------- | ---------------- | ----------- |
| GitHub Advisory | 60 req / hour / IP  | 5,000 req / hour | 83x         |
| NVD             | 5 req / 30s         | 50 req / 30s     | 10x         |

### GitHub Advisory Token

VulnSweep queries the **GitHub Advisory Database** to enrich every CVE with ecosystem-specific severity data, GHSA aliases, and advisory details. A GitHub Personal Access Token raises the rate limit from **60 to 5,000 requests per hour** — an 83x improvement.

- **No scopes required.** A token with zero scopes (read-only public data access) is sufficient.
- Generate at: [https://github.com/settings/tokens](https://github.com/settings/tokens)
- Select **"Generate new token (classic)"**, give it a descriptive name (e.g. `vulnsweep-advisory`), and leave all scope checkboxes **unchecked**

When the token is active, VulnSweep logs:

```
[GitHubAdvisory] Authenticated API access active (5,000 req/hr limit)
```

### NVD API Key

An NVD API key increases the NVD rate limit from 5 to 50 requests per 30 seconds — a 10x improvement that speeds up Full-mode scans on large projects.

- Request a free key at: [https://nvd.nist.gov/developers/request-an-api-key](https://nvd.nist.gov/developers/request-an-api-key)

### GitHub Advisory — Environment Variable Fallback

For CI or server environments where the Settings tab is not available, VulnSweep accepts `GITHUB_TOKEN` as an environment variable. The encrypted store credential takes precedence when both are present.

**On Windows (Command Prompt — per session):**

```cmd
set GITHUB_TOKEN=ghp_yourTokenHere
```

**On Windows (PowerShell — per session):**

```powershell
$env:GITHUB_TOKEN = "ghp_yourTokenHere"
```

**To persist across sessions**, set it as a system or user environment variable via _System Properties → Environment Variables_.

#### Automatic Retry and Rate-Limit Handling

VulnSweep is a well-behaved API consumer. When GitHub returns a rate-limit response (`HTTP 429` or `HTTP 403`), VulnSweep does not crash or silently drop data — it retries automatically through a **shared singleton queue** (all concurrent requests wait together, not independently) using the following strategy:

| Behaviour                | Detail                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Max retries**          | 100 attempts with exponential backoff + shared singleton queue before returning `rate_limit_exceeded`                    |
| **`Retry-After` header** | If GitHub specifies a wait duration, VulnSweep waits exactly that long before retrying                                   |
| **Exponential backoff**  | When no `Retry-After` is present: base delay 2 s, maximum cap 60 s                                                       |
| **Jitter**               | Random jitter (up to 1 s) added to backoff delays to prevent thundering-herd API hammering                               |
| **Graceful degradation** | After exhausting retries, the advisory record is marked `rate_limit_exceeded` — no crash, no data loss for other sources |

This means VulnSweep will never silently corrupt your scan results due to transient API throttling, and it will never hammer the GitHub API in a way that worsens the rate-limit situation.

---

## System Requirements

| Requirement | Minimum Version                            | Notes                                             |
| ----------- | ------------------------------------------ | ------------------------------------------------- |
| **Node.js** | 18.0.0+                                    | Required for npm audit execution                  |
| **npm**     | 8.3.0+                                     | Required for overrides support in package.json    |
| **Git**     | Any recent version                         | Required for automated commit and push operations |
| **OS**      | Windows 10+ (macOS and Linux: coming soon) | Cross-platform native desktop app                 |

---

## Data Privacy and Security

VulnSweep is built on a **zero-trust, local-first** architecture. Your source code, project structure, and dependency data never leave your machine.

| Data Type                    | What Happens                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Your source code             | Never read, never transmitted — VulnSweep only executes npm audit                                                                                                        |
| package.json contents        | Processed locally to determine fix strategies                                                                                                                            |
| npm registry calls           | Version resolution only — same as npm install already does                                                                                                               |
| NVD API calls                | CVE enrichment lookups — CVE identifiers only, no code sent                                                                                                              |
| OSV.dev API calls            | Package name + version lookups — no code sent                                                                                                                            |
| GitHub Advisory calls        | Advisory ID lookups — no code sent                                                                                                                                       |
| API credentials (GitHub/NVD) | Stored AES-256 encrypted in local app data via `secure-ls`; plaintext cleared from memory immediately after entry; never transmitted; never returned to renderer process |
| Personal or identifying data | None collected or stored                                                                                                                                                 |
| Anonymous usage statistics   | Collected anonymously via Aptabase (EU, GDPR-compliant) — opt-out available in the About tab at any time. No personal data, no code, no identifiers.                     |
| PDF security reports         | Generated and saved locally — never transmitted                                                                                                                          |

---

## Technology Stack

VulnSweep is engineered on a battle-tested, production-grade technology foundation:

| Layer                    | Technology                 | Purpose                                                      |
| ------------------------ | -------------------------- | ------------------------------------------------------------ |
| **Desktop Runtime**      | Electron 41                | Windows desktop (macOS and Linux coming soon)                |
| **UI Framework**         | React + TailwindCSS        | Component-based UI with utility-first styling                |
| **Build Tool**           | Vite                       | Fast bundling and hot-reload development                     |
| **Vulnerability Data**   | npm audit                  | Official npm vulnerability data source                       |
| **CVE Enrichment**       | NVD API v2                 | NIST National Vulnerability Database — CVSS scores           |
| **CVE Enrichment**       | OSV.dev API                | Open Source Vulnerabilities — cross-ecosystem data           |
| **CVE Enrichment**       | GitHub Advisory REST       | GitHub Security Advisory Database                            |
| **Exploit Intelligence** | CISA KEV + NVD             | Known exploited vulnerabilities in the wild                  |
| **License Analysis**     | package-lock.json v2/v3    | SPDX expression parsing + risk tier classification           |
| **SBOM Export**          | CycloneDX v1.6 / SPDX v2.3 | Industry-standard bill of materials formats                  |
| **Version Intelligence** | npm registry API           | Latest safe version resolution                               |
| **Charts**               | Recharts                   | Statistics and license dashboard visualization               |
| **Git Automation**       | Git CLI                    | Automated commit and push operations                         |
| **Security**             | Electron contextBridge     | Secure IPC boundary between renderer and main process        |
| **Credential Storage**   | secure-ls (AES-256)        | Encrypted local storage for GitHub Advisory and NVD API keys |

---

## License

VulnSweep is proprietary software. All rights reserved.

See [LICENSE.md](LICENSE.md) for full terms.

**2024-2026 Carlos Galveias. All rights reserved.**

This software is licensed, not sold. Unauthorized copying, distribution, modification, or reverse engineering of this software is strictly prohibited. A free tier is available with core features included at no cost. Unlimited fix-and-commit automation requires a commercial annual license.

### Beta Status

VulnSweep is currently in **public beta**. The current pricing and promotional tiers are available exclusively during this beta phase. When VulnSweep reaches general availability, pricing terms — including the early-adopter rate and the number of free fix-and-commit sessions — may change without prior notice. Users who adopt during the beta period lock in the most favorable terms available.

### Pricing

| Tier                   | Price                     | Availability                                    |
| ---------------------- | ------------------------- | ----------------------------------------------- |
| **Beta Early Adopter** | EUR 9.99 / year / device  | First 30 days after install — beta period only  |
| **Standard Annual**    | EUR 29.99 / year / device | After 30-day early-adopter window closes        |
| **Free Tier**          | Free forever              | Core scanning, CVE enrichment, SBOM, compliance |

> The early-adopter window is device-specific and starts from your first install. It cannot be extended. The countdown is displayed in the About tab. Both the early-adopter rate and the 10 free fix-and-commit sessions are beta-phase terms — they are not guaranteed to remain after general availability.

---

## About the Author

**Carlos Galveias** is a software engineer and developer tools architect who built VulnSweep to solve a real operational problem — managing npm security vulnerabilities, license compliance obligations, and dependency hygiene across dozens of Node.js microservices without losing entire days to manual audit cycles.

VulnSweep is the tool he wished existed. Now it does.

- GitHub: [github.com/cgalveias](https://github.com/cgalveias)

---

## Keywords and Search Index

_npm vulnerability scanner · Node.js security audit tool · automated npm audit fix · bulk repository security scanner · npm audit automation · DevSecOps Node.js tool · vulnerability remediation desktop app · npm security scanner desktop · multi-repo npm audit · Electron security tool · transient dependency vulnerability fix · CVE scanner Node.js · automated dependency update tool · npm overrides automation · Node.js DevSecOps workflow · SBOM generator Node.js · CycloneDX npm · SPDX npm · software bill of materials Node.js · license compliance scanning npm · npm license audit · exploit availability flag CVE · CISA KEV integration · cross-source CVE correlation · NVD OSV GitHub Advisory npm · npm dependency updates dashboard · CVE enrichment Node.js · license risk classification npm · GPL license detection Node.js · SOC 2 npm compliance · FedRAMP SBOM Node.js_

---

<div align="center">

**VulnSweep — The npm security platform for teams who ship fast and refuse to compromise on security or compliance.**

[**Download Now — Core Features Free**](https://github.com/carlosgalveias/vulnsweep-releases)

_2024-2026 Carlos Galveias_

</div>
