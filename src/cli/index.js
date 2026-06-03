#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const analytics = require('./analytics.js');
const { parseCliArgs } = require('./arg-parser.js');
const { printAuditReport, printDependencyReport } = require('./console-reporter.js');
const { run } = require('./runner.js');
const { evaluateThreshold } = require('./threshold-evaluator.js');

// Read package version
const pkgPath = resolve(__dirname, '../../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const VERSION = pkg.version;

// ─── Banner ────────────────────────────────────────────────────────────────────
/**
 * Prints a startup banner with tool name, version, and legal notice.
 */
function printBanner() {
  const { buildBox } = require('./utils');
  const title = `VulnSweep CLI v${VERSION}`;
  const rows = [
    { text: `  ${title}  `, align: 'center' },
    { text: ' ', align: 'left' },
    {
      text: '  \u26A0 By using this tool you accept our Privacy Policy and Disclaimer.  ',
      align: 'left',
    },
    {
      text: '    https://github.com/carlosgalveias/vulnsweep-releases/blob/main/PRIVACY_POLICY.md  ',
      align: 'left',
    },
    {
      text: '    https://github.com/carlosgalveias/vulnsweep-releases/blob/main/DISCLAIMER.md  ',
      align: 'left',
    },
  ];
  const box = buildBox(rows, { minWidth: 80, borderStyle: 'single' });
  process.stderr.write(`\n${box}\n\n`);
}

// ─── Show banner unless --help, -h, --version, -V ─────────────────────────────
const skipBannerFlags = ['--help', '-h', '--version', '-V'];
const shouldSkipBanner = process.argv.slice(2).some((a) => skipBannerFlags.includes(a));
if (!shouldSkipBanner) {
  printBanner();
  console.log(
    '\n  🔒 Your code never leaves your machine. All scanning and analysis is performed locally.'
  );
  console.log('     We only collect anonymous usage statistics — see documentation for opt-out.\n');
}

// ─── Subcommand routing (before parseArgs to avoid unknown-positional errors) ──
const subcommandArg = process.argv[2];

if (subcommandArg === 'purchase') {
  const { handlePurchase } = require('./purchase-handler');
  handlePurchase()
    .then((r) => process.exit(r.ok ? 0 : 1))
    .catch((err) => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(3);
    });
} else if (subcommandArg === 'activate') {
  const { handleActivate } = require('./purchase-handler');
  // Parse --email and --txn from remaining args
  const args = process.argv.slice(3);
  let email = null;
  let txn = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) {
      email = args[i + 1];
      i++;
    } else if (args[i] === '--txn' && args[i + 1]) {
      txn = args[i + 1];
      i++;
    }
  }
  handleActivate(email, txn)
    .then((r) => process.exit(r.ok ? 0 : 1))
    .catch((err) => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(3);
    });
} else if (subcommandArg === 'status') {
  const { handleStatus } = require('./status-handler');
  handleStatus()
    .then(() => process.exit(0))
    .catch((err) => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(3);
    });
} else {
  // Normal scan logic
  main();
}

/**
 * Prints formatted help text to stdout.
 */
function printHelp() {
  const help = `
VulnSweep CLI v${VERSION} - npm vulnerability scanner

USAGE:
  vulnsweep [command] [options]

SUBCOMMANDS:
  purchase                         Show payment instructions
  activate --email <e> --txn <id>  Activate license after PayPal payment
  status                           Show license and fix usage status

OPTIONS:
  -d, --dir <path>          Root directory to scan (default: current directory)
  -t, --type <type>         Scan type: audit | dependency (default: audit)
  -S, --sources <preset>    Source preset: fast | optimal | full (default: optimal)
                            fast = npm-audit + osv
                            optimal = all except nvd (recommended)
                            full = all sources including nvd
  -o, --output              Print results to stdout
  -s, --sbom <file>         Output SBOM to file
  -f, --format <fmt>        SBOM format: cyclonedx | spdx (default: cyclonedx)
  -a, --autofix             Auto-fix vulnerable dependencies
  -l, --fix-level <level>   Fix risk: low | high (default: low)
  -c, --commit              Commit and push changes after autofix
  -b, --bump                Bump patch version after applying fixes (requires --autofix)
  -u, --update-level <lvl>  Update scope: low | high (default: low)
  -r, --report-dir <dir>    Generate HTML report in directory
  -T, --threshold <sev>     CI/CD fail threshold (default: high)
                            Values: none, critical, high, medium, low, any
  -q, --quiet               Suppress non-essential output
      --no-color            Disable colored output
  -h, --help                Show this help message
  -V, --version             Show version number

API KEYS (parameter overrides environment variable):
      --github-token <token>  GitHub/GHE personal access token
                              (env: VULNSWEEP_GITHUB_TOKEN or GITHUB_TOKEN)
      --nvd-key <key>         NVD API key for accelerated rate limits
                              (env: VULNSWEEP_NVD_KEY or NVD_API_KEY)
                              Request at: https://nvd.nist.gov/developers/request-an-api-key

EXAMPLES:
  vulnsweep                            Scan current directory for vulnerabilities
  vulnsweep -d ./my-project -o         Scan specific dir, print results
  vulnsweep -t dependency -a           Check for outdated deps, auto-fix
  vulnsweep -s report.json -f spdx     Generate SPDX SBOM
  vulnsweep -r ./reports               Generate HTML report
  vulnsweep -T critical                Only fail on critical vulnerabilities
  vulnsweep -a -c -b                   Autofix, bump version, commit & push
  vulnsweep status                     Show license and fix usage
  vulnsweep purchase                   Buy a license from the CLI
  vulnsweep --github-token ghp_xxx     Scan with GitHub authenticated mode
  VULNSWEEP_NVD_KEY=abc vulnsweep      Scan with NVD API key from env var

EXIT CODES:
  0   Scan passed (no vulnerabilities above threshold)
  1   Threshold exceeded (vulnerabilities found above threshold)
  2   Invalid arguments
  3   Scan error
  4   No projects found

TELEMETRY:
  VulnSweep CLI sends anonymous usage analytics (event counts only).
  To disable: set VULNSWEEP_NO_TELEMETRY=1 or DO_NOT_TRACK=1
`.trimStart();

  process.stdout.write(help);
}

/**
 * Main CLI entry point.
 */
async function main() {
  process.on('SIGINT', () => process.exit(130));
  analytics.trackEvent('app_initialized');

  let opts;
  try {
    opts = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    const noColor = process.argv.includes('--no-color') || process.env.NO_COLOR;
    const red = noColor ? '' : '\x1b[31m';
    const reset = noColor ? '' : '\x1b[0m';

    process.stderr.write(`${red}Error: ${err.message}${reset}\n`);
    process.stderr.write('Run with --help for usage\n');
    process.exit(2);
    return; // unreachable but makes intent clear
  }

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.version) {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }

  // Save original intent before license gate may disable autofix
  const userRequestedAutofix = opts.autofix;

  // ─── Headless/CI gate: disable destructive flags in unattended environments ───
  const { isHeadlessEnvironment } = require('./utils');
  if ((opts.autofix || opts.commit || opts.bump) && isHeadlessEnvironment()) {
    const noColor = opts['no-color'] || process.env.NO_COLOR;
    const yellow = noColor ? '' : '\x1b[33m';
    const reset = noColor ? '' : '\x1b[0m';
    process.stderr.write(
      `${yellow}⚠ Autofix is not available in headless or CI/CD environments.${reset}\n`
    );
    opts.autofix = false;
    opts.commit = false;
    opts.bump = false;
  }

  // License gate: check if autofix is allowed before scanning
  if (opts.autofix) {
    const { canAutofix } = require('./license-manager');
    const autofixCheck = await canAutofix();
    if (!autofixCheck.allowed) {
      const noColor = opts['no-color'] || process.env.NO_COLOR;
      const yellow = noColor ? '' : '\x1b[33m';
      const reset = noColor ? '' : '\x1b[0m';
      process.stderr.write(`\n${yellow}⚠️  ${autofixCheck.reason}${reset}\n`);
      process.stderr.write('Run "vulnsweep purchase" to buy a license.\n\n');
      // Continue with scan results but skip autofix
      opts.autofix = false;
    }
  }

  // Validate commit/bump require autofix
  if (opts.commit && !opts.autofix && userRequestedAutofix) {
    // License gate killed autofix — commit is implicitly disabled, no confusing warning needed
    opts.commit = false;
  } else if (opts.commit && !opts.autofix) {
    process.stderr.write('  ⚠ --commit requires --autofix. Ignoring.\n');
    opts.commit = false;
  }
  if (opts.bump && !opts.autofix && userRequestedAutofix) {
    // License gate killed autofix — bump is implicitly disabled, no confusing warning needed
    opts.bump = false;
  } else if (opts.bump && !opts.autofix) {
    process.stderr.write('  ⚠ --bump requires --autofix. Ignoring.\n');
    opts.bump = false;
  }

  // Validate --bump not supported for dependency scans
  if (opts.bump && opts.type === 'dependency') {
    console.warn('⚠ --bump is not supported for dependency update scans. Ignoring.');
    opts.bump = false;
  }

  try {
    const result = await run(opts);

    analytics.trackEvent('scan_completed', {
      repoCount: result.projects ? result.projects.filter(Boolean).length : 0,
      totalVulnerabilities: result.summary ? result.summary.total : 0,
      critical: result.summary ? result.summary.critical : 0,
      high: result.summary ? result.summary.high : 0,
      medium: result.summary ? result.summary.medium : 0,
      low: result.summary ? result.summary.low : 0,
    });

    // Generate SBOM if requested
    if (opts.sbom) {
      const { writeSbom } = require('./sbom-writer');
      await writeSbom(result, opts);
      process.stderr.write(`SBOM written to ${opts.sbom}\n`);
      analytics.trackEvent('sbom_generated', { format: opts.format || 'cyclonedx' });
    }

    // Generate HTML report if requested
    if (opts['report-dir']) {
      const { generateHtmlReport } = require('./html-report-generator');
      const reportPath = await generateHtmlReport(result, {
        ...opts,
        reportDir: opts['report-dir'],
      });
      process.stderr.write(`HTML report written to ${reportPath}\n`);
    }

    // Print formatted report to stdout
    if (opts.output) {
      const reportOpts = { noColor: opts['no-color'], quiet: opts.quiet, sources: opts.sources };
      if (result.type === 'audit') {
        printAuditReport(result, reportOpts);
      } else {
        printDependencyReport(result, reportOpts);
      }
    }

    // Auto-fix if requested (after reports, before threshold)
    if (opts.autofix) {
      const { applyAutofix } = require('./autofix-handler');
      const { consumeFixes } = require('./license-manager');
      const fixResult = await applyAutofix(result, opts);

      // Consume fix credits for all successful fixes applied
      if (fixResult.applied > 0) {
        consumeFixes(fixResult.applied);
        analytics.trackEvent('vulnerability_fixed', {
          fixCount: fixResult.applied,
          skipped: fixResult.skipped,
          failed: fixResult.failed,
        });
      }

      if (!opts.quiet) {
        process.stderr.write(
          `\n  Auto-fix summary: ${fixResult.applied} applied, ${fixResult.skipped} skipped, ${fixResult.failed} failed\n`
        );
      }

      // Commit and push if requested
      if (
        opts.commit &&
        fixResult.applied > 0 &&
        fixResult.modifiedPaths &&
        fixResult.modifiedPaths.length > 0
      ) {
        const { commitAndPush } = require('../main/modules/git');
        const commitMessage = opts.bump
          ? 'fix(security): update vulnerable dependencies and bump version'
          : 'fix(security): update vulnerable dependencies';
        let committed = 0;
        let commitFailed = 0;

        for (const modPath of fixResult.modifiedPaths) {
          try {
            const gitResult = await commitAndPush(modPath, commitMessage);
            if (gitResult.success) {
              committed++;
            } else {
              commitFailed++;
            }
          } catch (err) {
            commitFailed++;
            if (!opts.quiet) {
              console.error(`  ✗ Commit failed for ${modPath}: ${err.message}`);
            }
          }
        }

        if (committed > 0) {
          analytics.trackEvent('commit_pushed', {
            committed,
            commitFailed,
            fixCount: fixResult.applied,
          });
        }

        if (!opts.quiet) {
          if (commitFailed === 0) {
            process.stderr.write(
              `  \u2713 Committed and pushed changes for ${committed} project(s)\n`
            );
          } else {
            if (committed > 0) {
              process.stderr.write(`  \u2713 Committed and pushed: ${committed} project(s)\n`);
            }
            process.stderr.write(`  \u2717 Failed to commit: ${commitFailed} project(s)\n`);
          }
        }
      }
    }

    // Threshold evaluation (audit only)
    if (result.type === 'audit') {
      const threshold = opts.threshold || 'high';
      const evaluation = evaluateThreshold(result.summary, threshold);

      if (!evaluation.passed) {
        const noColor = opts['no-color'] || process.env.NO_COLOR;
        const red = noColor ? '' : '\x1b[31m';
        const reset = noColor ? '' : '\x1b[0m';
        process.stderr.write(`${red}${evaluation.reason}${reset}\n`);
        await analytics.flush();
        process.exit(1);
      }
    }

    await analytics.flush();
    process.exit(0);
  } catch (err) {
    const noColor = process.argv.includes('--no-color') || process.env.NO_COLOR;
    const red = noColor ? '' : '\x1b[31m';
    const reset = noColor ? '' : '\x1b[0m';

    process.stderr.write(`${red}Error: ${err.message}${reset}\n`);
    await analytics.flush();
    process.exit(3);
  }
}
