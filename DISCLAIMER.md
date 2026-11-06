# Disclaimer — VulnSweep

VulnSweep is free, open-source software distributed under the
[Apache License 2.0](LICENSE.md). This disclaimer restates, in plain language,
the warranty and liability position that Apache License 2.0 §7 and §8 already set
out. It does not add commercial terms — there is no paid license, no trial, and
no support contract to agree to.

**Last verified against source:** 2026-11-05.

---

## Use at Your Own Risk

VulnSweep can **modify your projects automatically**, including:

- editing `package.json` (version bumps),
- regenerating lockfiles and running `npm install`,
- staging files, creating Git commits, and — when you enable it —
  `git push` to your remote.

These are real, sometimes irreversible actions on real files and repositories.
**You are solely responsible for their consequences.**

---

## No Warranty ("As Is")

Per Apache License 2.0 §7, the Work is provided **"AS IS" AND "AS AVAILABLE",
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND**, either express or implied,
including without limitation the warranties of merchantability, fitness for a
particular purpose, and non-infringement.

In practical terms, no author or contributor of VulnSweep warrants that:

- the software is uninterrupted or error-free;
- the vulnerabilities it reports are **complete, accurate, or current** (it
  relies on third-party databases such as NVD, OSV, GitHub Advisory, CISA KEV,
  EPSS and npm);
- the fixes it applies actually resolve a given issue, or won't introduce new
  ones;
- a chosen fix version is compatible with your specific codebase or environment.

---

## Limitation of Liability

Per Apache License 2.0 §8, in no event shall the copyright owners or contributors
be liable for any damages of any kind arising from the use of this software,
including direct, indirect, incidental, punitive, and special damages (broken
builds, regressions, data loss, corrupted lockfiles, lost Git history, production
incidents caused by automated changes or pushes), even if advised of the
possibility of such damage.

Some jurisdictions do not allow certain limitations; where they apply, liability
is limited to the maximum extent permitted by law.

---

## Strong Recommendations

The following are **advice, not contract terms** — but following them is how you
avoid a bad day:

- **Work on a branch**, not directly on `main`/`master`.
- **Have a clean commit to roll back to** before any automated fix.
- **Review every diff** (`package.json`, lockfiles) before committing or pushing.
- **Test in a non-production environment** after fixes — VulnSweep does not run
  your test suite for you.
- **Avoid enabling Git auto-push** unless a testing gate sits between the change
  and production.
- **Revert manually if a fix breaks something** — VulnSweep does not provide
  automatic rollback.

---

## Not Professional Security Advice

VulnSweep is a tool, not a security audit, penetration test, or compliance
assessment. Finding and patching the vulnerabilities it reports does **not** make
your software secure. For compliance work (ISO 27001, SOC 2, PCI-DSS, NIS2, etc.)
engage a qualified security professional.

---

## License and Support

VulnSweep carries **no warranty** beyond the Apache License 2.0 text above, and
**no support is promised**. Contributions are provided "as is"; any help through
the project's issue tracker is voluntary on the maintainer's part. There is no
service-level agreement.

To report bugs or ask questions, use the issue tracker of the repository this
project is published in (see [README.md](README.md)).

---

_Governing license: [Apache License 2.0](LICENSE.md). See also
[PRIVACY_POLICY.md](PRIVACY_POLICY.md)._
