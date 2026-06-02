#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseCliArgs } = require('./arg-parser.js');
const { printAuditReport, printDependencyReport } = require('./console-reporter.js');
const { run } = require('./runner.js');
const { evaluateThreshold } = require('./threshold-evaluator.js');

// Read package version
const pkgPath = resolve(__dirname, '../../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const VERSION = pkg.version;

/**
 * Prints formatted help text to stdout.
 */
function printHelp() {
  const help = `
VulnSweep CLI v${VERSION} - npm vulnerability scanner

USAGE:
  vulnsweep [options]

OPTIONS:
  -d, --dir <path>          Root directory to scan (default: current directory)
  -t, --type <type>         Scan type: audit | dependency (default: audit)
  -o, --output              Print results to stdout
  -s, --sbom <file>         Output SBOM to file
  -f, --format <fmt>        SBOM format: cyclonedx | spdx (default: cyclonedx)
  -a, --autofix             Auto-fix vulnerable dependencies
  -l, --fix-level <level>   Fix risk: low | high (default: low)
  -u, --update-level <lvl>  Update scope: low | high (default: low)
  -r, --report-dir <dir>    Generate HTML report in directory
  -T, --threshold <sev>     CI/CD fail threshold (default: high)
                            Values: none, critical, high, medium, low, any
  -q, --quiet               Suppress non-essential output
      --no-color            Disable colored output
  -h, --help                Show this help message
  -V, --version             Show version number

EXAMPLES:
  vulnsweep                            Scan current directory for vulnerabilities
  vulnsweep -d ./my-project -o         Scan specific dir, print results
  vulnsweep -t dependency -a           Check for outdated deps, auto-fix
  vulnsweep -s report.json -f spdx     Generate SPDX SBOM
  vulnsweep -r ./reports               Generate HTML report
  vulnsweep -T critical                Only fail on critical vulnerabilities

EXIT CODES:
  0   Scan passed (no vulnerabilities above threshold)
  1   Threshold exceeded (vulnerabilities found above threshold)
  2   Invalid arguments
  3   Scan error
  4   No projects found
`.trimStart();

  process.stdout.write(help);
}

/**
 * Main CLI entry point.
 */
async function main() {
  process.on('SIGINT', () => process.exit(130));

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

  try {
    const result = await run(opts);

    // Generate SBOM if requested
    if (opts.sbom) {
      const { writeSbom } = require('./sbom-writer');
      await writeSbom(result, opts);
      process.stderr.write(`SBOM written to ${opts.sbom}\n`);
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
      const reportOpts = { noColor: opts['no-color'], quiet: opts.quiet };
      if (result.type === 'audit') {
        printAuditReport(result, reportOpts);
      } else {
        printDependencyReport(result, reportOpts);
      }
    }

    // Auto-fix if requested (after reports, before threshold)
    if (opts.autofix) {
      const { applyAutofix } = require('./autofix-handler');
      const fixResult = await applyAutofix(result, opts);
      if (!opts.quiet) {
        process.stderr.write(
          `\n  Auto-fix summary: ${fixResult.applied} applied, ${fixResult.skipped} skipped, ${fixResult.failed} failed\n`
        );
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
        process.exit(1);
      }
    }

    process.exit(0);
  } catch (err) {
    const noColor = process.argv.includes('--no-color') || process.env.NO_COLOR;
    const red = noColor ? '' : '\x1b[31m';
    const reset = noColor ? '' : '\x1b[0m';

    process.stderr.write(`${red}Error: ${err.message}${reset}\n`);
    process.exit(3);
  }
}

main();
