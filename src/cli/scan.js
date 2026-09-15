// `sequentdraw scan <path|github-url> --out <bundle.json> [--timeout <ms>]`
//
// Thin CLI wrapper over src/scan's scanRepo(): acquire (local path or a
// shallow, read-only GitHub clone), scan through the safe provider, and
// write the resulting evidence bundle as JSON. See docs/design/git-map.md
// sections 1-3 for the full contract. Same strict-argument contract as the
// other subcommands: an unknown flag or an extra/missing positional prints
// usage and exits 1, and nothing is written to disk on error.
//
// Never prints file contents: this command never itself reads a scanned
// repository's files (scanRepo does that, behind the safe provider), and
// every error scanRepo/acquire.js can throw is already a short, structured
// "git-map: ..." line -- never raw repository text -- so printing
// err.message directly is safe. `timeoutMs` is passed straight through to
// scanRepo(), which runs the scan step in a worker_threads Worker and
// enforces that deadline by terminating it (scan-timeout.js) -- this CLI
// does not set `inProcess`, so it always gets that hard-kill guarantee
// rather than the in-process fast path scanRepo() also offers (tests
// only).

const fs = require('fs');
const path = require('path');
const { scanRepo } = require('../scan');

const USAGE = 'Usage: sequentdraw scan <path|github-url> --out <bundle.json> [--timeout <ms>]';

const HELP = `${USAGE}

Scans a local repository or GitHub URL into an evidence bundle (JSON) for
git-map: services, data stores, integrations and the dependency edges
between them, each claim citing a deterministic scan finding (compose/K8s
services, IaC resources, SDK imports, dependency manifest entries,
environment variable names, routes, CI jobs). Nothing in the repository is
ever executed.

Options:
  --out <file>      Where to write the evidence bundle. Required.
  --timeout <ms>    Hard deadline for the scan step (default: 60000). On
                     timeout the scan is terminated and nothing is written.
  --help            Show this help.
`;

function parseArgs(args) {
  const positional = [];
  let outPath = null;
  let timeoutRaw = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out') {
      const value = args[i + 1];
      if (value == null || value.startsWith('-')) return null;
      outPath = value;
      i++;
    } else if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath) return null;
    } else if (arg === '--timeout') {
      const value = args[i + 1];
      if (value == null || value.startsWith('-')) return null;
      timeoutRaw = value;
      i++;
    } else if (arg.startsWith('--timeout=')) {
      timeoutRaw = arg.slice('--timeout='.length);
      if (!timeoutRaw) return null;
    } else if (arg.startsWith('-')) {
      return null;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) return null;
  if (outPath == null) return null;

  let timeoutMs;
  if (timeoutRaw != null) {
    if (!/^[1-9][0-9]*$/.test(timeoutRaw)) return null;
    timeoutMs = Number(timeoutRaw);
  }

  return { source: positional[0], outPath, timeoutMs };
}

async function run(args, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;

  if (args.includes('--help') || args.includes('-h')) {
    stdout.write(HELP);
    return 0;
  }

  const parsed = parseArgs(args);
  if (!parsed) {
    stderr.write(`${USAGE}\n`);
    return 1;
  }

  let bundle;
  try {
    const options = {};
    if (parsed.timeoutMs != null) options.timeoutMs = parsed.timeoutMs;
    bundle = await scanRepo(parsed.source, options);
  } catch (err) {
    // scan-timeout (ScanTimeoutError), an invalid source/ref (acquire.js),
    // and a clone/network failure all land here with one clear
    // "git-map: ..." line already in err.message -- never raw repo content.
    stderr.write(`${err.message}\n`);
    return 1;
  }

  const outDir = path.dirname(parsed.outPath);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(parsed.outPath, JSON.stringify(bundle, null, 2));
  stdout.write(`wrote ${parsed.outPath} (${bundle.evidence.length} evidence entries)\n`);
  return 0;
}

module.exports = { run, parseArgs, USAGE, HELP };
