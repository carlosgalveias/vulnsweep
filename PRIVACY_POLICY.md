# Privacy Policy — VulnSweep

**Application:** VulnSweep  
**Author / Publisher:** Carlos Galveias  
**Effective Date:** May 2025  
**Last Reviewed:** May 2026  
**Governing Jurisdiction:** Portugal / European Union  
**Support & Enquiries:** https://github.com/carlosgalveias/vulnsweep-releases/issues

---

## Plain-Language Summary

> **In plain English:** VulnSweep does **not** collect, store, transmit, or sell your personal data. It is a local desktop tool. Your code, your file paths, and your project data **never leave your machine**. The only external calls made by the application are: (1) fetching vulnerability data from public security feeds (NVD, OSV, GitHub Advisory, CISA KEV) — transmitting package names and version numbers only, identical in scope to what `npm audit` sends by default; and (2) a license key validation call. **No accounts. No tracking. No telemetry. No personal data is collected or processed in this version of VulnSweep.**

---

## 1. Who We Are

VulnSweep is developed and maintained by:

**Carlos Galveias**  
Portugal, European Union  
Application Bundle ID: `com.vulnsweep.app`

**For all enquiries, support requests, and data rights communications, use the official project channel:**  
https://github.com/carlosgalveias/vulnsweep-releases/issues

> **Note on support:** Opening a support ticket does not guarantee a response. Support is provided on a case-by-case basis at the sole discretion of Carlos Galveias. See the [Disclaimer and Terms of Use](DISCLAIMER.md) for details.

---

## 2. GDPR Status — No Personal Data Processing in This Version

**This is a critical transparency statement.**

In this version of VulnSweep, **no personal data as defined under Article 4(1) of Regulation (EU) 2016/679 ("GDPR") is collected, processed, or stored** by the application or by Carlos Galveias in connection with its standard operation.

Accordingly, **Carlos Galveias does not act as a Data Controller under Article 4(7) GDPR in respect of application users** for this version. The GDPR's obligations on data controllers — including the obligation to respond to Data Subject Access Requests (DSARs) — are therefore **not applicable** to the standard operation of this version of VulnSweep.

The sole data interaction that could be characterised as data processing is **license key validation** (Section 3.2.e below). A license key is a pseudonymous alphanumeric token that does not, in isolation, constitute personal data under GDPR. No attempt is made to link it to a natural person's identity.

**Forward-Looking Notice:** A future version of VulnSweep may introduce optional anonymous analytics or other features that could alter this regulatory assessment. Should that occur:

- This Privacy Policy will be updated with a new Effective Date **prior to deployment** of any such feature.
- A full GDPR-compliant disclosure will be provided.
- Where applicable under Article 6(1)(a) GDPR, **explicit opt-in consent** will be obtained before any analytics data is transmitted.
- Users will be notified via in-application notice at first launch following the update.

Until that update is published, the statements in this section remain in full effect.

---

## 3. What Data VulnSweep Processes — And Where

### 3.1 Data Processed Locally Only (Never Leaves Your Device)

| Data Type                              | Purpose                                       | Transmitted Externally?             |
| -------------------------------------- | --------------------------------------------- | ----------------------------------- |
| Local filesystem paths you select      | Identifying Node.js projects to scan          | ❌ No                               |
| Contents of `package.json` files       | Parsing dependencies and fix strategies       | ❌ No                               |
| Contents of `package-lock.json` files  | Applying automated version fixes              | ❌ No                               |
| License key (stored encrypted locally) | Persisting activation state between sessions  | Only during key validation (§3.2.e) |
| Trial state (start date, counters)     | Enforcing the free trial period locally       | ❌ No                               |
| Scan results and history               | Displaying historical scan output to the user | ❌ No                               |
| Cached vulnerability data              | Reducing redundant external API calls         | ❌ No                               |
| Application settings and preferences   | Persisting user configuration                 | ❌ No                               |

All data stored locally is held using **encrypted local storage** (via `electron-store`) with OS-level file system protections. No component of VulnSweep can remotely access or exfiltrate your locally stored data.

### 3.2 External Network Calls

VulnSweep makes the following external network calls. In every case, **no personal data, source code, file contents, or filesystem paths are transmitted**.

#### (a) NVD — National Vulnerability Database

- **Transmitted:** Package names and version numbers (e.g., `"lodash"`, `"4.17.20"`)
- **Purpose:** Query the NIST National Vulnerability Database for known CVEs matching your project's dependencies.
- **Personal data transmitted:** None.
- **Third-party operator:** National Institute of Standards and Technology (NIST), US Government.
- **Their privacy policy:** https://www.nist.gov/privacy-policy

#### (b) OSV — Open Source Vulnerabilities

- **Transmitted:** Package names and version numbers.
- **Purpose:** Query the OSV database for open source vulnerability advisories affecting your dependencies.
- **Personal data transmitted:** None.
- **Third-party operator:** Google LLC.
- **Their privacy policy:** https://policies.google.com/privacy

#### (c) GitHub Advisory Database

- **Transmitted:** Standard `npm audit` API payloads — package names and version ranges.
- **Purpose:** Identify known CVEs and security advisories in your project's dependency tree.
- **Personal data transmitted:** None.
- **Third-party operator:** GitHub, Inc. (Microsoft).
- **Their privacy policy:** https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement

#### (d) CISA KEV — Known Exploited Vulnerabilities Catalog

- **Transmitted:** Package names and CVE identifiers for cross-referencing against the catalog.
- **Purpose:** Identify vulnerabilities that are actively exploited in the wild, as catalogued by the US Cybersecurity and Infrastructure Security Agency.
- **Personal data transmitted:** None.
- **Third-party operator:** CISA, US Department of Homeland Security.
- **Their privacy policy:** https://www.cisa.gov/privacy-policy

#### (e) License Activation

- **Transmitted:** Your license key — a pseudonymous alphanumeric token generated at the time of purchase — and an anonymised device identifier derived from the hardware fingerprint.
- **Purpose:** Verify the key is genuine, active, not revoked, and has not exceeded its single-device activation limit.
- **Personal data transmitted:** None. A license key does not identify a natural person under GDPR Article 4(1). It is not linked to your name, email address, or any other directly identifying information in the activation system.
- **Server-side records retained:** Key hash, activation timestamp, device activation count — retained solely for license enforcement purposes. No IP addresses are retained for analytical purposes. Activation records are not enriched with personally identifiable information.
- **Operator:** Carlos Galveias / VulnSweep (EU-hosted infrastructure).

---

## 4. Data We Do NOT Collect

VulnSweep explicitly does **not** collect, store, or transmit:

- Your name, email address, phone number, or any identity data
- Your IP address (for VulnSweep's own analytical or tracking purposes)
- Your source code, repository contents, or any file contents
- Your filesystem paths or directory structures
- Behavioural analytics, session recordings, or usage telemetry (in this version)
- Crash reports or error logs sent to any external server
- Any data from your Git repository contents or commit history
- Cookies or any browser-based tracking identifiers
- Device hardware identifiers beyond what is strictly necessary for the hardware-bound license check (Section 3.2.e)

---

## 5. Hardware-Bound Licensing — Device Fingerprint

VulnSweep uses a **hardware-bound licensing system**. When you activate a license, the application generates a **device fingerprint** derived from hardware characteristics of your device. This fingerprint enforces the **single-device-per-license** restriction.

**Critical disclosures regarding the device fingerprint:**

- The raw fingerprint is **not transmitted** to any external server. Only an anonymised, one-way hashed derivative is used during license activation.
- **If your hardware changes significantly** (e.g., replacement of primary storage, motherboard, or other core components), the fingerprint may change, causing your license to fail validation. In that event, you may need to **purchase a new license**. No refund is provided for hardware-change invalidation unless required by applicable mandatory consumer protection law.
- The hardware-bound mechanism is a technical enforcement measure, not a surveillance or tracking mechanism.

---

## 6. Security Measures (Technical and Organisational Measures)

Although VulnSweep does not collect personal data, the following Technical and Organisational Measures (TOMs) are applied to protect the integrity of the software and any data it handles locally:

| Measure                               | Description                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Encryption at rest**                | License keys and trial state are stored using `electron-store` with OS-level encryption             |
| **No remote access**                  | No component of VulnSweep can remotely access, read, or exfiltrate local project files              |
| **Minimal network surface**           | The application connects only to the five endpoints described in Section 3.2                        |
| **Signed releases**                   | Application binaries are code-signed to prevent tampering and ensure authenticity                   |
| **Principle of least privilege**      | The application requests only the minimum OS permissions required for its stated functionality      |
| **Cryptographic license enforcement** | License keys are validated using industry-standard cryptographic hashing; never stored in plaintext |

Users are responsible for securing their own devices and ensuring OS-level protections (e.g., full-disk encryption, user account controls) are in place.

---

## 7. Third-Party Services — Independent Data Controllers

VulnSweep integrates with the following third-party services. Each operates as an **independent data controller**. VulnSweep is not responsible for the data practices of these third parties:

| Service                  | Provider                            | Data Transmitted by VulnSweep     | Their Privacy Policy                                                             |
| ------------------------ | ----------------------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| NVD                      | NIST, US Government                 | Package names and version numbers | https://www.nist.gov/privacy-policy                                              |
| OSV                      | Google LLC                          | Package names and version numbers | https://policies.google.com/privacy                                              |
| GitHub Advisory Database | GitHub, Inc. (Microsoft)            | Package names and version ranges  | https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement |
| CISA KEV                 | CISA, US Dept. of Homeland Security | Package names and CVE identifiers | https://www.cisa.gov/privacy-policy                                              |

VulnSweep does not share personal data with any third party because no personal data is collected. We do not sell, rent, or trade personal data under any circumstances.

---

## 8. International Data Transfers

VulnSweep is developed in Portugal (EU). The NVD, OSV, GitHub Advisory Database, and CISA KEV are operated by US-based entities. When VulnSweep makes API calls to these services, requests are routed to US-based servers.

Because **no personal data is transmitted** in these calls, the international data transfer provisions of GDPR Chapter V (Articles 44-49) are **not triggered** by these interactions.

The license activation infrastructure operates within the EU/EEA. Should this change in a future version, this Policy will be updated and appropriate transfer safeguards (Standard Contractual Clauses or equivalent) will be documented.

---

## 9. Data Retention

| Data                                                                       | Location                                | Retention Period                                                                   |
| -------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| Local encrypted storage (license key, trial state, scan history, settings) | Your device                             | Until you uninstall VulnSweep or manually delete application data                  |
| License activation records (key hash, timestamp, device activation count)  | VulnSweep activation server (EU-hosted) | Duration of license term + 3 years for legal/audit purposes, then securely deleted |

VulnSweep does not retain any other user data because no other user data is collected.

---

## 10. Your Rights

Since **no personal data is collected or processed** in this version, GDPR data subject rights (Articles 15-22) are generally not applicable to the standard operation of VulnSweep.

If you believe the application has inadvertently processed personal data, or if you have a rights request relating to license activation records, submit your request via the official project channel:

**https://github.com/carlosgalveias/vulnsweep-releases/issues**

Please include the label `[Privacy Request]` in your issue title and describe your request clearly. We will respond within **30 days** of a verified request.

If you are located in the European Economic Area, the following rights remain available to you in relation to any personal data we may hold:

| Right                                      | GDPR Article | How to Exercise                                              |
| ------------------------------------------ | ------------ | ------------------------------------------------------------ |
| Right of Access                            | Art. 15      | Open a ticket at the project issues page                     |
| Right to Rectification                     | Art. 16      | Open a ticket at the project issues page                     |
| Right to Erasure ("Right to be Forgotten") | Art. 17      | Open a ticket at the project issues page                     |
| Right to Restrict Processing               | Art. 18      | Open a ticket at the project issues page                     |
| Right to Data Portability                  | Art. 20      | Open a ticket at the project issues page                     |
| Right to Object                            | Art. 21      | Open a ticket at the project issues page                     |
| Right to Withdraw Consent                  | Art. 7(3)    | Applicable only if future consent-based features are enabled |

**Supervisory Authority — Portugal:**
Comissao Nacional de Protecao de Dados (CNPD)
https://www.cnpd.pt

**All EU supervisory authorities:**
https://edpb.europa.eu/about-edpb/about-edpb/members_en

We encourage you to contact us directly before approaching a supervisory authority so we may address your concerns promptly and in good faith.

---

## 11. Rights Under Other Jurisdictions

VulnSweep is distributed globally. While governed primarily by GDPR, we respect data rights across all jurisdictions:

**California, USA (CCPA/CPRA):** VulnSweep does not sell personal information. California residents may exercise equivalent rights to those in Section 10 by opening a ticket at https://github.com/carlosgalveias/vulnsweep-releases/issues.

**Brazil (LGPD):** Brazilian data subjects hold equivalent rights under Lei Geral de Protecao de Dados (Lei n.o 13.709/2018). Open a ticket at the project issues page to exercise any LGPD rights.

**United Kingdom (UK GDPR):** UK users hold equivalent rights to EEA users under the UK GDPR as retained following Brexit. The ICO is the relevant supervisory authority: https://ico.org.uk

---

## 12. Children

VulnSweep is a professional developer tool designed for adult software engineers and DevOps/DevSecOps professionals. It is not directed at, and is not intended for use by, persons under the age of 16 (or the applicable minimum age of digital consent in your jurisdiction). We do not knowingly collect personal data from minors. If you believe a minor has used VulnSweep in a context that may implicate personal data, please open a ticket at the project issues page.

---

## 13. Changes to This Policy

We may update this Privacy Policy to reflect changes in the application's functionality, legal requirements, or our data practices. When we do:

- The **Last Reviewed** date at the top of this document will be updated.
- For material changes (e.g., introduction of new data collection), we will provide **in-application notice** at first launch after the update.
- The updated Policy will be published with the application and in the project repository.

Continued use of VulnSweep after the updated Effective Date constitutes acceptance of the revised Policy. If you do not agree with material changes, you should discontinue use of VulnSweep.

---

## 14. Contact

All privacy enquiries, data subject rights requests, and communications regarding this Policy must be submitted through the official project channel:

**https://github.com/carlosgalveias/vulnsweep-releases/issues**

Please use the label `[Privacy]` in your issue title. There is no email address for privacy contact. All communications are handled through the GitHub issues channel.

---

## Appendix: Abbreviated Record of Processing Activities (RoPA)

_Maintained per GDPR Article 30(1) by Carlos Galveias. Full RoPA available upon request via the project issues page._

| Processing Activity                          | Data Categories                                           | Legal Basis             | Recipients                              | Third-Country Transfer                               | Retention                    |
| -------------------------------------------- | --------------------------------------------------------- | ----------------------- | --------------------------------------- | ---------------------------------------------------- | ---------------------------- |
| License key validation                       | Pseudonymous alphanumeric key token, anonymised device ID | Art. 6(1)(b) — Contract | VulnSweep activation server (EU-hosted) | None                                                 | License term + 3 years       |
| NVD API calls                                | Package names and version numbers (non-personal)          | Art. 6(1)(b) — Contract | NIST (US)                               | Not applicable — no personal data transmitted        | Not retained by VulnSweep    |
| OSV API calls                                | Package names and version numbers (non-personal)          | Art. 6(1)(b) — Contract | Google LLC (US)                         | Not applicable — no personal data transmitted        | Not retained by VulnSweep    |
| GitHub Advisory DB calls                     | Package names and version ranges (non-personal)           | Art. 6(1)(b) — Contract | GitHub, Inc. (US)                       | Not applicable — no personal data transmitted        | Not retained by VulnSweep    |
| CISA KEV API calls                           | Package names and CVE identifiers (non-personal)          | Art. 6(1)(b) — Contract | CISA (US)                               | Not applicable — no personal data transmitted        | Not retained by VulnSweep    |
| Future anonymous statistics (if implemented) | Anonymised aggregate usage metrics                        | Art. 6(1)(a) — Consent  | TBD                                     | TBD — Policy will be updated prior to implementation | TBD — Policy will be updated |

---

_This Privacy Policy was drafted in accordance with Regulation (EU) 2016/679 (GDPR), the Portuguese Lei n.o 58/2019 de 8 de agosto (implementing the GDPR in Portugal), and applicable guidance issued by the European Data Protection Board (EDPB)._

_VulnSweep is committed to maintaining this document as a living instrument, updated to reflect the evolving legal landscape and the application's technical development._

_Last reviewed: May 2026_
