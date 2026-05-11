# Disclaimer and Terms of Use — VulnSweep

**Application:** VulnSweep v1.0.0
**Author / Publisher:** Carlos Galveias
**Effective Date:** May 2025
**Governing Law:** Portugal / European Union

---

## Acceptance by Use

BY DOWNLOADING, INSTALLING, COPYING, OR USING VULNSWEEP IN ANY WAY, YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO BE LEGALLY BOUND BY ALL TERMS IN THIS DISCLAIMER. IF YOU DO NOT AGREE, DO NOT INSTALL OR USE VULNSWEEP.

---

## Plain-Language Summary

> **In plain English:** VulnSweep is a powerful automation tool. Used correctly, it saves you hours. Used carelessly, it can modify files, alter dependency trees, and push commits to remote repositories — automatically. These actions can break your software. **You are fully responsible for what happens to your codebase.** Always back up your work. Always test before pushing to production. Carlos Galveias accepts no liability for any damage caused by use of this tool.

---

## 1. Software Provided "As Is"

VulnSweep is provided **"AS IS"** and **"AS AVAILABLE"**, without warranty of any kind, express or implied, to the fullest extent permitted by applicable law.

Carlos Galveias and VulnSweep expressly disclaim all warranties, including but not limited to:

- Any implied warranty of **merchantability**
- Any implied warranty of **fitness for a particular purpose**
- Any warranty of **non-infringement**
- Any warranty that the software will be **uninterrupted, error-free, or free of defects**
- Any warranty that **vulnerabilities identified by VulnSweep are complete, accurate, or current**
- Any warranty that **fixes applied by VulnSweep will resolve all security issues** or will not introduce new ones

No oral or written information, advice, or representation given by Carlos Galveias, VulnSweep, or any representative shall create a warranty not expressly stated in this Disclaimer.

---

## 2. No Liability for Damage to Your Codebase

**THIS IS THE MOST CRITICAL SECTION. READ IT CAREFULLY.**

VulnSweep automates modifications to your software projects, including but not limited to:

- Upgrading dependency versions in `package.json`
- Regenerating `package-lock.json` files
- Running `npm install` on your behalf
- Committing changes to your local Git repository
- **Pushing commits to remote Git repositories** (when this feature is enabled)

**Carlos Galveias and VulnSweep shall NOT be liable — under any theory of law, including contract, tort, strict liability, or otherwise — for any of the following, even if advised of the possibility of such damages:**

- Broken builds, compilation failures, or deployment failures resulting from dependency changes
- Regressions, bugs, or software defects introduced by version upgrades
- Corruption or unintended modification of `package.json`, `package-lock.json`, or any other project file
- Incompatibility between upgraded packages and your existing codebase
- Data loss, data corruption, or loss of business resulting from the operation of VulnSweep
- Financial losses, revenue losses, or loss of customers arising from software failures caused by VulnSweep's changes
- Any damage to production systems caused by changes made by VulnSweep
- Loss or corruption of Git history, branches, or remote repository state
- Third-party service outages or failures triggered by changes made by VulnSweep
- Security vulnerabilities that remain in your software after VulnSweep's remediation attempt

This exclusion applies regardless of whether damage was foreseeable and regardless of whether Carlos Galveias was notified of the potential for such damage.

---

## 3. User Assumes All Risk

**You, the user, assume the entire risk** arising from the download, installation, and use of VulnSweep and all automated actions it performs on your codebase.

You acknowledge and accept that:

1. **Automated dependency upgrades can break software.** Package upgrades — even patch-level changes — can introduce breaking changes. VulnSweep cannot predict whether any given upgrade will cause regressions in your specific codebase.

2. **VulnSweep operates on your live project files.** The tool modifies real files on your filesystem. It does not operate on sandboxed copies unless you choose to run it against a copy.

3. **Git push is irreversible.** When you enable the Git push feature, commits are pushed to your configured remote repository immediately. This cannot be automatically undone by VulnSweep. Remote repository changes affect other team members, CI/CD pipelines, and potentially deployed systems.

4. **VulnSweep is a tool, not a security guarantee.** It assists with vulnerability remediation; it does not guarantee that your software is secure after use. Security requires continuous human judgment and oversight.

---

## 4. Strong Recommendation: Back Up and Test Before Use

Carlos Galveias **strongly recommends** the following practices before using VulnSweep:

- **Back up your repository** — ensure you have a current, clean commit or branch you can restore to if needed.
- **Use a feature branch** — run VulnSweep against a dedicated branch, not directly against `main` or `master`.
- **Test in a non-production environment first** — validate that your build, tests, and application function correctly after VulnSweep's changes before merging or deploying.
- **Review all changes before pushing** — inspect the modified `package.json` and `package-lock.json` before committing. Review the VulnSweep vulnerability report carefully.
- **Do not enable Git auto-push in production pipelines** without a validated testing gate in between.
- **Maintain your own CI/CD test coverage** — VulnSweep does not run your test suite. That is your responsibility.

Failure to follow these practices significantly increases the risk of damage. Such damage remains solely your responsibility.

---

## 5. Third-Party Data Accuracy

VulnSweep derives vulnerability data from two third-party sources:

1. **npm Registry** (operated by npm, Inc. / Microsoft)
2. **GitHub Advisory Database** (operated by GitHub, Inc. / Microsoft)

VulnSweep makes no representation, warranty, or guarantee regarding:

- The **accuracy, completeness, or timeliness** of vulnerability data from these sources
- Whether **all known vulnerabilities** in your dependencies are reported
- Whether advisory data correctly reflects the **severity or exploitability** of a vulnerability
- Whether the **recommended fix versions** are correct, safe, or suitable for your use case

Vulnerability intelligence is provided by third parties over whom VulnSweep has no control. You should independently verify critical security findings using authoritative sources such as the National Vulnerability Database (NVD) at https://nvd.nist.gov or the relevant vendor security advisories.

---

## 6. Git Operations — Explicit Warning

The Git integration feature allows VulnSweep to:

- Stage modified files (`git add`)
- Create commits in your repository (`git commit`)
- **Push commits to remote repositories (`git push`)**

**These are irreversible actions with real consequences:**

- Pushed commits are immediately visible to your team, CI/CD systems, and deployment pipelines.
- VulnSweep does not provide an "undo push" capability.
- If auto-push triggers a production deployment and thosechanges cause a failure, that constitutes a production incident for which VulnSweep and Carlos Galveias bear no responsibility.

By enabling the Git push feature, **you explicitly accept full and sole responsibility** for the consequences of those remote repository changes.

---

## 7. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, the total aggregate liability of Carlos Galveias and VulnSweep to you for any claims arising from or related to VulnSweep — regardless of the form of action — **shall not exceed the greater of:**

- **(a)** The total amount you paid for your VulnSweep license in the twelve (12) months preceding the event giving rise to the claim; or
- **(b)** EUR 10.00 (ten euros)

**If you are using VulnSweep under a free trial license, the maximum liability is EUR 0.00 (zero euros).**

IN NO EVENT SHALL CARLOS GALVEIAS OR VULNSWEEP BE LIABLE FOR ANY indirect, incidental, special, consequential, or punitive damages; loss of profits, revenue, business, goodwill, or anticipated savings; loss of data or cost of data recovery; business interruption losses; or costs of procuring substitute software — EVEN IF CARLOS GALVEIAS HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

Some jurisdictions do not allow exclusion or limitation of consequential damages. In such jurisdictions, liability shall be limited to the maximum extent permitted by law.

---

## 8. No Professional Security Advice

VulnSweep is a software tool. It is **not a substitute for professional security advice, a penetration test, a security audit, or a formal vulnerability assessment**. The output of VulnSweep should be treated as one input into a broader security programme, not as a definitive security clearance.

VulnSweep does NOT:

- Audit your application logic for security vulnerabilities
- Scan your source code for injection flaws or authentication weaknesses
- Guarantee that addressing the vulnerabilities it identifies will make your software fully secure
- Provide legal, regulatory, or compliance advice regarding security obligations

For compliance with security standards (ISO 27001, SOC 2, PCI-DSS, NIS2 Directive), engage a qualified security professional.

---

## 9. Indemnification

You agree to **indemnify, defend, and hold harmless** Carlos Galveias and VulnSweep from and against any claims, liabilities, damages, losses, costs, and expenses (including reasonable legal fees) arising out of or relating to:

- Your use of VulnSweep in violation of this Disclaimer
- Your failure to back up your data or test changes before deployment
- Any modifications to your codebase made by VulnSweep at your direction
- Your breach of any applicable law or third-party rights in connection with your use of VulnSweep
- Any claim by a third party arising from changes made by VulnSweep that you caused or permitted

---

## 10. Governing Law and Jurisdiction

This Disclaimer and any disputes arising from or related to VulnSweep shall be governed by and construed in accordance with the laws of **Portugal**, without regard to conflict of law provisions.

The parties submit to the **exclusive jurisdiction of the courts of Portugal** for the resolution of any disputes arising under or in connection with this Disclaimer.

If any provision of this Disclaimer is held invalid or unenforceable, the remaining provisions shall continue in full force and effect.

---

## 11. Entire Agreement

This Disclaimer, together with the [License Agreement](LICENSE.md) and [Privacy Policy](PRIVACY_POLICY.md), constitutes the entire agreement between you and Carlos Galveias with respect to VulnSweep and supersedes all prior communications and proposals, whether oral or written.

---

_Last reviewed: May 2025. For questions about this Disclaimer, contact: legal@vulnsweep.com_
