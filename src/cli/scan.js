// `sequentdraw scan <path|github-url> [--out bundle.json]`
//
// Registered now, wired up in a follow-up once the scanner (src/scan/,
// feat/git-map-scan: scanRepo, checkEvidence) merges — see
// docs/design/git-map.md sections 1-2. Until then this reports its
// unavailability with exit code 2 rather than pretending to work or
// erroring like a genuinely bad invocation (exit 1).

const USAGE = 'Usage: sequentdraw scan <path|github-url> [--out bundle.json]';

const HELP = `${USAGE}

Scans a local repository or GitHub URL into an evidence bundle (JSON) for
git-map: services, data stores, integrations and the dependency edges
between them, each claim citing a deterministic scan finding.

Not implemented yet — available once the scanner (src/scan/) is merged. See
docs/design/git-map.md sections 1-2.

Options:
  --out <file>   Where to write the evidence bundle.
  --help         Show this help.
`;

const UNAVAILABLE = 'sequentdraw scan: available once the scanner is merged\n';

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
