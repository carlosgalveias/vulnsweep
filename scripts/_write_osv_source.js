'use strict';
const fs = require('fs');
const path = require('path');

const content = `'use strict';

const https = require('https');
const { ENRICHMENT_CONFIG } = require('../../../config/constants');

const SEV_ORDER = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, MODERATE: 3, LOW: 2, NONE: 1, UNKNOWN: 0 };

function higherSeverity(a, b) {
  const aS = SEV_ORDER[(a || '').toUpperCase()] || 0;
  const bS = SEV_ORDER[(b || '').toUpperCase()] || 0;
  if (!aS && !bS) return null;
  return aS >= bS ? a : b;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(baseDelay, attempt) {
  return baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 1000);
}

const OSV_BACKOFF_BASE_MS = 1000;
const OSV_MAX_RETRIES = 3;

function httpsPost(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + (u.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'User-Agent': ENRICHMENT_CONFIG.USER_AGENT,
          Accept: 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          if (res.statusCode === 429) {
            const err = new Error('OSV rate-limited (429)');
            err.isRateLimit = true;
            reject(err);
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(\`OSV HTTP \${res.statusCode}: \${data.slice(0, 200)}\`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(\`OSV JSON parse error: \${e.message}\`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(\`OSV timeout \${timeoutMs}ms\`)));
    req.write(payload);
    req.end();
  });
}

function extractSeverity(v) {
  const db = v.database_specific && v.database_specific.severity;
  if (db) return db.toUpperCase();
  if (Array.isArray(v.affected)) {
    for (const a of v.affected) {
      const es = a.ecosystem_specific && a.ecosystem_specific.severity;
      if (es) return es.toUpperCase();
    }
  }
  return null;
}

function extractAliases(v) {
  const s = new Set();
  if (v.id) s.add(v.id);
  if (Array.isArray(v.aliases)) v.aliases.forEach((a) => typeof a === 'string' && s.add(a));
  if (Array.isArray(v.references)) {
    for (const r of v.references) {
      const u = r.url || (typeof r === 'string' ? r : '');
      const m = u.match(/CVE-\\d{4}-\\d{4,}/i);
      if (m) s.add(m[0].toUpperCase());
    }
  }
  return Array.from(s);
}

function extractUrl(v) {
  if (!Array.isArray(v.references) || !v.references.length) return null;
  const urls = v.references.map((r) => (typeof r === 'string' ? r : r.url || ''));
  return (
    urls.find((u) => u.includes('github.com/advisories')) ||
    urls.find((u) => u.includes('nvd.nist.gov')) ||
    urls.find((u) => u.startsWith('https://')) ||
    urls[0] ||
    null
  );
}

async function _fetchOsvRawOrThrow(packageName, version, ecosystem = 'npm') {
  const requestBody = {
    package: { name: packageName, ecosystem },
    version: version || '',
  };
  for (let attempt = 0; attempt <= OSV_MAX_RETRIES; attempt++) {
    try {
      const response = await httpsPost(
        ENRICHMENT_CONFIG.OSV_API_URL,
        requestBody,
        ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS
      );
      return Array.isArray(response.vulns) ? response.vulns : [];
    } catch (err) {
      if (err.isRateLimit && attempt < OSV_MAX_RETRIES) {
        await sleep(backoffDelay(OSV_BACKOFF_BASE_MS, attempt));
        continue;
      }
      console.warn(\`[osv-source] fetchOsvRaw error for \${packageName}@\${version}: \${err.message}\`);
      throw err;
    }
  }
  return [];
}

async function fetchOsvRaw(packageName, version, ecosystem = 'npm') {
  if (!packageName || typeof packageName !== 'string') return [];
  try {
    return await _fetchOsvRawOrThrow(packageName, version, ecosystem);
  } catch {
    return [];
  }
}

function minVersion(versions) {
  if (!versions || versions.length === 0) return null;
  if (versions.length === 1) return versions[0];

  return versions.reduce((min, v) => {
    const [minCore, minPre] = min.split('-');
    const [vCore, vPre] = v.split('-');

    const minParts = minCore.split('.').map((p) => parseInt(p, 10) || 0);
    const vParts = vCore.split('.').map((p) => parseInt(p, 10) || 0);

    const len = Math.max(minParts.length, vParts.length);
    for (let i = 0; i < len; i++) {
      const a = minParts[i] || 0;
      const b = vParts[i] || 0;
      if (b < a) return v;
      if (a < b) return min;
    }

    if (!minPre && vPre) return v;
    if (minPre && !vPre) return min;
    if (minPre && vPre) return minPre <= vPre ? min : v;
    return min;
  });
}

function compareVersions(a, b) {
  const [aCoreStr, aPre] = String(a).split('-');
  const [bCoreStr, bPre] = String(b).split('-');
  const aParts = aCoreStr.split('.').map((p) => parseInt(p, 10) || 0);
  const bParts = bCoreStr.split('.').map((p) => parseInt(p, 10) || 0);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const av = aParts[i] || 0;
    const bv = bParts[i] || 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  if (aPre && bPre) return aPre < bPre ? -1 : aPre > bPre ? 1 : 0;
  return 0;
}

function parseLastKnownAffectedBound(rangeStr) {
  if (!rangeStr || typeof rangeStr !== 'string') return null;
  const m = rangeStr.trim().match(/^<=?\\s*(\\S+)$/);
  return m ? m[1] : null;
}

function extractFixedIn(osvVuln) {
  if (!Array.isArray(osvVuln.affected)) return null;
  const npmFixed = [];
  for (const aff of osvVuln.affected) {
    if (!aff.package || aff.package.ecosystem !== 'npm') continue;
    if (!Array.isArray(aff.ranges)) continue;
    for (const range of aff.ranges) {
      if (range.type !== 'ECOSYSTEM' && range.type !== 'SEMVER') continue;
      if (!Array.isArray(range.events)) continue;
      for (const ev of range.events) {
        if (ev.fixed && typeof ev.fixed === 'string') npmFixed.push(ev.fixed);
      }
    }
  }
  if (npmFixed.length > 0) return minVersion(npmFixed);
  const npmBounds = [];
  for (const aff of osvVuln.affected) {
    if (!aff.package || aff.package.ecosystem !== 'npm') continue;
    const bound = parseLastKnownAffectedBound(
      aff.database_specific && aff.database_specific.last_known_affected_version_range
    );
    if (bound) npmBounds.push(bound);
  }
  if (npmBounds.length > 0) return minVersion(npmBounds);
  for (const aff of osvVuln.affected) {
    if (!Array.isArray(aff.ranges)) continue;
    for (const range of aff.ranges) {
      if (!Array.isArray(range.events)) continue;
      for (const ev of range.events) {
        if (ev.fixed && typeof ev.fixed === 'string') return ev.fixed;
      }
    }
  }
  return null;
}

function isVersionSafe(installedVersion, osvVuln) {
  if (!installedVersion || !osvVuln) return false;
  const fixedIn = extractFixedIn(osvVuln);
  if (!fixedIn) return false;
  return compareVersions(installedVersion, fixedIn) >= 0;
}

async function queryOSV(packageName, version, ecosystem) {
  if (!packageName || typeof packageName !== 'string') {
    return { found: false, error: 'Invalid package name', severity: null, aliases: [], url: null };
  }
  let vulns;
  try {
    vulns = await _fetchOsvRawOrThrow(packageName, version, ecosystem);
  } catch (err) {
    return { found: false, error: err.message, severity: null, aliases: [], url: null };
  }
  if (vulns.length === 0) {
    return { found: false, severity: null, aliases: [], url: null };
  }
  let mergedSeverity = null;
  const allAliases = new Set();
  let firstUrl = null;
  for (const vuln of vulns) {
    const s = extractSeverity(vuln);
    mergedSeverity = mergedSeverity === null ? s : higherSeverity(mergedSeverity, s);
    for (const alias of extractAliases(vuln)) {
      allAliases.add(alias);
    }
    if (!firstUrl) {
      firstUrl = extractUrl(vuln);
    }
  }
  return {
    found: true,
    severity: mergedSeverity,
    aliases: Array.from(allAliases),
    url: firstUrl,
  };
}

module.exports = {
  queryOSV,
  fetchOsvRaw,
  extractFixedIn,
  extractSeverity,
  extractAliases,
  extractUrl,
  isVersionSafe,
};
`;

const dest = path.join(
  __dirname,
  '..',
  'src',
  'main',
  'modules',
  'enrichment',
  'sources',
  'osv-source.js'
);
fs.writeFileSync(dest, content, 'utf8');
console.log('Written', content.length, 'chars to', dest);
