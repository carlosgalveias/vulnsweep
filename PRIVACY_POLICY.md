# Privacy Policy — VulnSweep

**Application:** VulnSweep v1.0.0
**Data Controller:** Carlos Galveias
**Privacy Contact:** privacy@vulnsweep.com
**Effective Date:** May 2025
**Governing Jurisdiction:** Portugal / European Union (GDPR)

---

## Plain-Language Summary

> **In plain English:** VulnSweep does not collect, store, transmit, or sell your personal data. It is a local desktop tool. Your code, your file paths, and your project data **never leave your machine**. The only external calls made by the application are identical to what `npm audit` and `npm install` send by default — fetching vulnerability data from npm's registry and GitHub's Advisory Database — plus a single license key validation call to our activation server. No accounts. No tracking. No telemetry.

---

## 1. Who We Are (Data Controller)

VulnSweep is developed and maintained by:

**Carlos Galveias**
Portugal, European Union
Email: privacy@vulnsweep.com
Application ID: `com.vulnsweep.app`

Carlos Galveias is the **Data Controller** as defined under Article 4(7) of Regulation (EU) 2016/679 ("GDPR"). For all data rights enquiries, use the contact details in Section 15.

---

## 2. Our Privacy Philosophy

VulnSweep is built on **Privacy by Design and by Default** as required by Article 25 GDPR. This is a foundational engineering decision, not a compliance checkbox. The application was designed to operate without requiring, collecting, or retaining personal data.

**The core principle:** data we do not collect cannot be breached, misused, or sanctioned. VulnSweep has no user accounts, no cloud backend, no active telemetry, and no cookies or browser-based tracking of any kind.

---

## 3. What Data VulnSweep Processes — And Where

### 3.1 Data Processed Locally (Never Leaves Your Device)

| Data Type                             | Purpose                                      | Transmitted Externally?             |
| ------------------------------------- | -------------------------------------------- | ----------------------------------- |
| Local filesystem paths you select     | Identifying Node.js projects to scan         | ❌ No                               |
| Contents of `package.json` files      | Parsing dependencies and fix strategies      | ❌ No                               |
| Contents of `package-lock.json` files | Applying automated version fixes             | ❌ No                               |
| License key (stored encrypted)        | Persisting activation state between sessions | Only during key validation (§3.2.c) |
| Trial state (start date, counters)    | Enforcing the free trial period locally      | ❌ No                               |

All local data is stored using **encrypted local storage** (via `electron-store`) with OS-level file system protections. It is not remotely accessible by VulnSweep.

### 3.2 External Network Calls

VulnSweep makes three categories of external network calls. In each case, **no personal data, source code, or filesystem paths are transmitted**.

#### (a) npm Registry API

- **Transmitted:** Package names and version ranges (e.g., `"lodash"`, `"^4.17.0"`) — identical to what `npm install` and `npm audit` send.
- **Purpose:** Fetch package version metadata to resolve upgrade paths for vulnerability remediation.
- **Personal ** None.
- **Third-party controller:** npm, Inc. (GitHub / Microsoft). Their privacy policy: [https://docs.npmjs.com/policies/privacy](https://docs.npmjs.com/policies/privacy)

#### (b) GitHub Advisory Database

- **Transmitted:** Standard `npm audit` API payloads — package names and version ranges to query vulnerability advisories.
- **Purpose:** Identify known CVEs in your project's dependency tree.
- **Personal ** None.
- **Third-party controller:** GitHub, Inc. (Microsoft). Their privacy policy: [https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement)

#### (c) VulnSweep License Activation Server

- **Transmitted:** Your license key — an alphanumeric pseudonymous token.
- **Purpose:** Verify the key is genuine, active, and within permitted activation limits.
- **Personal ** None. A license key does not identify a natural person under GDPR Article 4(1). It is not linked to your name or email address in the activation system.
- **Server-side records:** Key hash, timestamp, and activation count — strictly for license enforcement. No IP addresses are retained for analytical purposes. Activation records are not enriched with personally identifiable information.
- **Controller:** Carlos Galveias / VulnSweep.

---

## 4. Data We Do NOT Collect

VulnSweep explicitly does **not** collect, store, or transmit:

- Your name, email address, phone number, or any identity data
- Your IP address (for VulnSweep's own analytical purposes)
- Your source code, repository contents, or file contents
- Your filesystem paths or directory structures
- Behavioural analytics, session recordings, or usage telemetry (currently)
- Crash reports or error logs sent to external servers
- Any data from your Git repository contents or commit history
- Cookies or any browser-based tracking identifiers

---

## 5. Future Data Collection (Transparency Notice)

A future version of VulnSweep **may** introduce optional, **anonymous usage statistics**. If implemented, it will strictly adhere to:

- Full **anonymisation** — incapable of identifying any individual or project.
- Potential metrics: number of scans per session, platform type (Windows/macOS/Linux), aggregate vulnerability counts. Never: paths, code, or identity data.
- **Opt-in consent** — you will be explicitly asked before any data is transmitted, constituting freely given consent under GDPR Article 6(1)(a).
- This Privacy Policy will be updated with a new Effective Date before deployment of any such feature.

**Until that time: no usage statistics of any kind are collected.**

---

## 6. Legal Basis for Processing

| Processing Activity                          | Legal Basis (GDPR Art. 6)                                        |
| -------------------------------------------- | ---------------------------------------------------------------- |
| License key validation                       | Art. 6(1)(b) — Necessary for performance of the license contract |
| npm Registry API calls                       | Art. 6(1)(b) — Necessary to deliver the contracted functionality |
| GitHub Advisory Database calls               | Art. 6(1)(b) — Necessary to deliver the contracted functionality |
| Future anonymous statistics (if implemented) | Art. 6(1)(a) — Freely given, specific, informed consent          |

No special categories of personal data (Article 9 GDPR) are processed.

---

## 7. Data Retention

| Data                                               | Location                    | Retention Period                                                              |
| -------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| Local encrypted storage (license key, trial state) | Your device                 | Until you uninstall VulnSweep or delete app data                              |
| License activation records (key hash, timestamp)   | VulnSweep activation server | Duration of the license term + 3 years for legal/audit purposes, then deleted |

VulnSweep does not retain any other user data because no other user data is collected.

---

## 8. Third-Party Services and Data Controllers

VulnSweep integrates with the following third-party services as independent data controllers. VulnSweep is not responsible for the data practices of these third parties:

| Service                  | Provider                 | Role                        | Privacy Policy                                  |
| ------------------------ | ------------------------ | --------------------------- | ----------------------------------------------- |
| npm Registry             | npm, Inc. (Microsoft)    | Independent Data Controller | [Link](https://docs.npmjs.com/policies/privacy) |
| GitHub Advisory Database | GitHub, Inc. (Microsoft) | Independent Data Controller | [Link](https://docs                             |

| GitHub Advisory Database | GitHub, Inc. (Microsoft) | Independent Data Controller | [Link](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement) |

VulnSweep does not share your data with any other third party. We do not sell, rent, or trade personal data to or with any third party under any circumstances.

---

## 9. International Data Transfers

VulnSweep is developed in Portugal (EU). The npm Registry and GitHub Advisory Database are operated by US-based entities (Microsoft subsidiaries). When VulnSweep makes standard `npm audit` or `npm install` API calls — which transmit no personal data — these requests are routed to US-based servers.

Because no personal data is transmitted in these calls, the international data transfer provisions of GDPR Chapter V (Articles 44-49) are not triggered by these interactions. The license activation server operates within the EU/EEA.

Should this change in future versions, this Policy will be updated and appropriate transfer safeguards (Standard Contractual Clauses or equivalent) will be documented.

---

## 10. Security Measures

Although VulnSweep does not collect personal data, we apply the following Technical and Organisational Measures (TOMs) to protect the integrity of the software and any data it handles locally:

- **Encryption at rest:** License keys and trial state are stored using `electron-store` with OS-level encryption support.
- **No remote access:** No component of VulnSweep can remotely access, read, or exfiltrate your local project files.
- **Minimal network surface:** The application connects only to the three endpoints described in Section 3.2 and no others.
- **Signed releases:** Application binaries are code-signed to prevent tampering and ensure authenticity.
- **Principle of least privilege:** The application requests only the minimum OS permissions required for its stated functionality.

Users are responsible for securing their own devices and ensuring OS-level protections (e.g., full-disk encryption, user account controls) are in place.

---

## 11. Your Rights Under GDPR

If you are located in the European Economic Area (EEA), you have the following rights under the GDPR in relation to any personal data we hold about you:

| Right                                      | GDPR Article | How to Exercise                                                                                       |
| ------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------- |
| Right of Access                            | Art. 15      | Email privacy@vulnsweep.com                                                                           |
| Right to Rectification                     | Art. 16      | Email privacy@vulnsweep.com                                                                           |
| Right to Erasure ("Right to be Forgotten") | Art. 17      | Email privacy@vulnsweep.com                                                                           |
| Right to Restrict Processing               | Art. 18      | Email privacy@vulnsweep.com                                                                           |
| Right to Data Portability                  | Art. 20      | Email privacy@vulnsweep.com — data provided in JSON format                                            |
| Right to Object                            | Art. 21      | Email privacy@vulnsweep.com                                                                           |
| Right to Withdraw Consent                  | Art. 7(3)    | Applicable if future consent-based statistics are enabled; withdrawal ceases transmission immediately |

We will respond within **30 days** of a verified request. Because we hold minimal data, most requests can be fulfilled promptly.

---

## 12. Rights Under Other Jurisdictions

VulnSweep is distributed globally. While governed primarily by the GDPR, we respect data rights in all jurisdictions:

**California, USA (CCPA/CPRA):** VulnSweep does not sell personal information. California residents may exercise equivalent rights to those in Section 11 by contacting privacy@vulnsweep.com.

**Brazil (LGPD):** Brazilian data subjects hold equivalent rights under Lei Geral de Protecao de Dados (Lei n.o 13.709/2018). Contact privacy@vulnsweep.com to exercise any LGPD rights.

**United Kingdom (UK GDPR):** UK users hold equivalent rights to EEA users under the UK GDPR as retained following Brexit. The ICO is the relevant supervisory authority: https://ico.org.uk

---

## 13. Children's Privacy

VulnSweep is a professional developer tool designed for adult software engineers and DevOps/DevSecOps professionals. It is not directed at, and is not intended for use by, persons under the age of 16 (or the applicable minimum age of digital consent in your jurisdiction). We do not knowingly collect personal data from minors. If you believe a minor has used VulnSweep in a context that may implicate personal data, please contact privacy@vulnsweep.com.

---

## 14. Changes to This Policy

We may update this Privacy Policy to reflect changes in the application's functionality, legal requirements, or our data practices. When we do:

- The **Effective Date** at the top of this document will be updated.
- For material changes (e.g., introduction of new data collection), we will provide **in-application notice** at first launch after the update.
- The updated Policy will be published with the application and in the project repository.

Continued use of VulnSweep after the updated Effective Date constitutes acceptance of the revised Policy. If you do not agree with material changes, you should discontinue use of VulnSweep.

---

## 15. Contact and Complaints

**Privacy enquiries and data subject rights requests:**
privacy@vulnsweep.com

**Legal and licensing enquiries:**
legal@vulnsweep.com

**Supervisory Authority — Portugal:**
Comissao Nacional de Protecao de Dados (CNPD)
https://www.cnpd.pt

**EU supervisory authorities (all Member States):**
https://edpb.europa.eu/about-edpb/about-edpb/members_en

We encourage you to contact us directly before approaching a supervisory authority so we may address your concerns promptly and in good faith.

---

## Appendix: Record of Processing Activities (RoPA)

_Abbreviated RoPA maintained per GDPR Article 30(1) by Carlos Galveias as Data Controller. Full RoPA available upon request to privacy@vulnsweep.com._

| Processing Activity                          | Data Categories                                 | Legal Basis             | Recipients                              | Third-Country Transfer                                    | Retention                            |
| -------------------------------------------- | ----------------------------------------------- | ----------------------- | --------------------------------------- | --------------------------------------------------------- | ------------------------------------ |
| License key validation                       | Pseudonymous alphanumeric key token             | Art. 6(1)(b) — Contract | VulnSweep activation server (EU-hosted) | None                                                      | License term + 3 years, then deleted |
| npm Registry API calls                       | Package names and version ranges (non-personal) | Art. 6(1)(b) — Contract | npm, Inc. (US)                          | Not applicable — no personal data transmitted             | Not retained by VulnSweep            |
| GitHub Advisory DB calls                     | Package names and version ranges (non-personal) | Art. 6(1)(b) — Contract | GitHub, Inc. (US)                       | Not applicable — no personal data transmitted             | Not retained by VulnSweep            |
| Future anonymous statistics (if implemented) | Anonymised aggregate usage metrics              | Art. 6(1)(a) — Consent  | TBD                                     | TBD — this Policy will be updated prior to implementation | TBD — this Policy will be updated    |

---

_This Privacy Policy was drafted in accordance with Regulation (EU) 2016/679 (GDPR), the Portuguese Lei n.o 58/2019 de 8 de agosto (implementing the GDPR in Portugal), and applicable guidance issued by the European Data Protection Board (EDPB)._

_VulnSweep is committed to maintaining this document as a living instrument, updated to reflect the evolving legal landscape and the application's technical development._

_Last reviewed: May 2025_
