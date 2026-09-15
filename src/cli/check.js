// `sequentdraw check --evidence bundle.json`
//
// Registered now, wired up in a follow-up once the scanner (src/scan/,
// feat/git-map-scan: scanRepo, checkEvidence) merges — see
// docs/design/git-map.md section 3. Until then this reports its
// unavailability with exit code 2 rather than pretending to work or
// erroring like a genuinely bad invocation (exit 1).

const USAGE = 'Usage: sequentdraw check --evidence bundle.json';

const HELP = `${USAGE}

Checks that every scan-sourced node and edge in a workflow JSON document
cites evidence that actually exists in the given scan bundle: every
"source": "scan" node cites at least one real evidence id, and every
"source": "scan" edge cites a dependency, import or route fact linking its
endpoints.

Not implemented yet — available once the scanner (src/scan/) is merged. See
docs/design/git-map.md section 3.

Options:
  --evidence <file>   The evidence bundle produced by "sequentdraw scan".
  --help              Show this help.
`;

const UNAVAILABLE = 'sequentdraw check: available once the scanner is merged\n';

async function run(args, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;

  if (args.includes('--help') || args.includes('-h')) {
    stdout.write(HELP);
    return 0;
  }

  stderr.write(UNAVAILABLE);
  return 2;
}

module.exports = { run, USAGE, HELP };
