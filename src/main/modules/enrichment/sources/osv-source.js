'use strict';

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
            reject(new Error(`OSV HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`OSV JSON parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`OSV timeout ${timeoutMs}ms`)));
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
      const m = u.match(/CVE-\d{4}-\d{4,}/i);
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

/**
 * Query OSV.dev for a given npm package + version.
 *
 * @param {string} packageName
 * @param {string} version
 * @param {string} [ecosystem='npm']
 * @returns {Promise<{found: boolean, severity: string|null, aliases: string[], url: string|null, error?: string}>}
 */
async function queryOSV(packageName, version, ecosystem) {
  if (!packageName || typeof packageName !== 'string') {
    return { found: false, severity: null, aliases: [], url: null, error: 'Invalid package name' };
  }

  const requestBody = {
    package: { name: packageName, ecosystem: ecosystem || 'npm' },
    version: version || '',
  };

  for (let attempt = 0; attempt <= OSV_MAX_RETRIES; attempt++) {
    try {
      const response = await httpsPost(
        ENRICHMENT_CONFIG.OSV_API_URL,
        requestBody,
        ENRICHMENT_CONFIG.ENRICHMENT_TIMEOUT_MS
      );

      const vulns = response.vulns;
      if (!Array.isArray(vulns) || vulns.length === 0) {
        return { found: false, severity: null, aliases: [], url: null };
      }

      let mergedSeverity = null;
      const allAliases = new Set();
      let firstUrl = null;

      for (const v of vulns) {
        const sev = extractSeverity(v);
        mergedSeverity = higherSeverity(mergedSeverity, sev);
        extractAliases(v).forEach((a) => allAliases.add(a));
        if (!firstUrl) firstUrl = extractUrl(v);
      }

      return {
        found: true,
        severity: mergedSeverity,
        aliases: Array.from(allAliases),
        url: firstUrl,
      };
    } catch (err) {
      if (err.isRateLimit && attempt < OSV_MAX_RETRIES) {
        const delay = backoffDelay(OSV_BACKOFF_BASE_MS, attempt);
        console.warn(
          `[osv] Rate limited, retry ${attempt + 1}/${OSV_MAX_RETRIES} after ${delay}ms`
        );
        await sleep(delay);
        continue;
      }
      if (err.isRateLimit) {
        console.warn(
          `[osv] Rate limit exceeded after ${OSV_MAX_RETRIES} retries for ${packageName}`
        );
        return {
          found: false,
          severity: null,
          aliases: [],
          url: null,
          error: 'rate_limit_exceeded',
        };
      }
      console.warn(`[osv-source] queryOSV error for ${packageName}@${version}: ${err.message}`);
      return { found: false, severity: null, aliases: [], url: null, error: err.message };
    }
  }
  // Exhausted retries
  return { found: false, severity: null, aliases: [], url: null, error: 'rate_limit_exceeded' };
}

module.exports = { queryOSV };
