# Privacy Policy — VulnSweep

VulnSweep is free, open-source software released under the
[Apache License 2.0](LICENSE.md). This document describes what the application
does with your data. It is written so you can act on it without reading the
source code first.

**Last verified against source:** 2026-11-05.

---

## Plain-Language Summary

> VulnSweep is a **local** desktop and CLI tool. It does **not** collect, store,
> transmit, sell, or share personal data about you. There are no accounts, no
> telemetry, no analytics, and no tracking of any kind. Your code, file paths,
> and project contents never leave your machine.
>
> The only outbound network traffic is to **public vulnerability databases**
> (listed in §3). Those requests carry package names and version numbers — the
> same information `npm audit` sends when you run it yourself.

---

## 1. No Data Collection

In this version of VulnSweep:

- There is **no analytics or telemetry subsystem**. An earlier build shipped an
  opt-out flag for an "analytics" feature; that feature has been removed and the
  application deletes the leftover flag on startup. Nothing is reported to any
  server about how you use the app. The only code path named "telemetry"
  (`src/main/utils/scan-telemetry.js`) is a development-only timing profiler:
  it is inactive in production builds (`NODE_ENV === 'development'` gate) and
  writes its report as a JSON file under `./tmp` on your machine; it transmits
  nothing.
- There are **no crash reports, error logs, or usage metrics** sent anywhere.
  Errors stay in your own console/logs.
- There are **no cookies, device identifiers, accounts, or profiles**.
- There is **no license activation or license server**. VulnSweep does not phone
  home to validate a key, and it does not build a hardware fingerprint to bind a
  license to a device. Any older documentation describing those systems does not
  reflect this version.

GDPR note: because the application processes no personal data in its normal
operation, the controller obligations of Regulation (EU) 2016/679 (Articles
12–22) are not engaged for ordinary use. If a future release ever changes this,
this page will be updated — with a new effective date and an in-app notice —
before such a feature ships.

---

## 2. Data Processed Locally Only (Never Leaves Your Device)

| Data                                                       | Purpose                                                | Leaves device? |
| ---------------------------------------------------------- | ------------------------------------------------------ | -------------- |
| Filesystem paths you select                                | Locating Node.js projects to scan                      | No             |
| Contents of `package.json` / lockfiles                     | Resolving dependencies and fix strategies              | No             |
| Scan results, history, and cached vulnerability data       | Showing output and avoiding duplicate lookups          | No             |
| Application settings                                       | Persisting your configuration                          | No             |

Settings are kept in a local, AES-encrypted key/value store (`electron`/
`secure-ls`-based). The encryption key is derived on your own machine. There is
no server that can read or change this data remotely. Deleting the application's
user-data directory removes everything it stored.

---

## 3. Outbound Network Calls

When you run a scan, VulnSweep queries public vulnerability sources so it can
match your dependencies to known advisories. In every request **only package
names (and, for some sources, version numbers or CVE identifiers) are sent** —
never file contents, source code, file paths, or personal data. Which exact
fields each source receives is listed per row below; one source (CISA KEV)
receives none of your data at all, because it is a download rather than a query.

| Source                | Operator                            | Sent                                  | Their privacy policy |
| --------------------- | ----------------------------------- | ------------------------------------- | -------------------- |
| NVD                   | NIST (US Government)                | Package name (exact keyword search; no version) or CVE ID | https://www.nist.gov/privacy-policy |
| OSV                   | Google LLC                          | Package names, versions               | https://policies.google.com/privacy |
| GitHub Advisory DB    | GitHub, Inc. (Microsoft)            | Ecosystem (`npm`) + package name; also repo owner/name for a repo-level advisory lookup (version matching done locally) | https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement |
| CISA KEV              | CISA (US DHS)                       | Nothing; the public KEV catalog JSON feed is downloaded and matched locally | https://www.cisa.gov/privacy-policy |
| npm audit registry    | npm, Inc.                           | Dependency metadata (as `npm audit` does) | https://www.npmjs.com/policies/privacy |
| EPSS                  | FIRST.org                           | CVE identifiers                       | https://www.first.org/legal/privacy/ |

Because these calls carry no personal data, they do not constitute a transfer of
personal data under GDPR Chapter V.

VulnSweep calls **no VulnSweep-operated server** — there is no activation,
update-check, or analytics endpoint. You may block the hosts above at your
firewall; the trade-off is simply that live advisory lookups against those
sources will fail.

---

## 4. Contact

For questions about this policy or to exercise any data-related request, open an
issue in the issue tracker of the repository this project is published in. See
the [README](README.md) and [DISCLAIMER](DISCLAIMER.md) for links.

---

_See also: [LICENSE.md](LICENSE.md) (Apache License 2.0) and
[DISCLAIMER.md](DISCLAIMER.md)._
