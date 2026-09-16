// `sequentdraw check <map.json|-> --evidence <bundle.json>`
//
// Runs validateDoc() (structural/schema validation), then checkEvidence()
// (src/scan/check-evidence.js: every "source": "scan" node/edge in the map
// must cite evidence that actually exists in the bundle and actually
// supports the claim). Prints "ok" and exits 0 when both pass; otherwise
// prints one "path  message" line per error to stderr and exits 1. Same
// strict-argument contract as the other subcommands. "-" reads the map
// from stdin (src/cli/read-document.js); --evidence is always a real file.

const fs = require('fs');
const { validateDoc, ValidationError } = require('../n8n/validate');
const { checkEvidence } = require('../scan');
const { readDocument, STDIN_PATH } = require('./read-document');

const USAGE = 'Usage: sequentdraw check <map.json|-> --evidence <bundle.json>';

const HELP = `${USAGE}

Checks a workflow JSON document: first validateDoc()'s own structural and
schema invariants, then that every "source": "scan" node or edge cites at
least one evidence id that exists in the given bundle and actually
supports the claim (a depends-on, sdk-import, or route fact connecting an
edge's two endpoints).

Prints "ok" and exits 0 when the document passes both checks. Otherwise
prints one "path  message" line per error to stderr and exits 1 -- fix a
violation by demoting the item to "open" or "source": "model", never by
inventing evidence.

Input:
  <map.json>          A file path, or "-" to read the map from stdin (for
                       example from a quoted heredoc), so no file has to be
                       written first.

Options:
  --evidence <file>   The evidence bundle produced by "sequentdraw scan".
                       Required, and always a real file: "-" is not accepted
                       here.
  --help              Show this help.
`;

function parseArgs(args) {
  const positional = [];
  let evidencePath = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--evidence') {
      const value = args[i + 1];
      // "-" is let through so run() can say exactly why it is refused.
      if (value == null || (value !== STDIN_PATH && value.startsWith('-'))) return null;
      evidencePath = value;
      i++;
    } else if (arg.startsWith('--evidence=')) {
      evidencePath = arg.slice('--evidence='.length);
      if (!evidencePath) return null;
    } else if (arg !== STDIN_PATH && arg.startsWith('-')) {
      return null;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) return null;
  if (evidencePath == null) return null;
  return { mapPath: positional[0], evidencePath };
}

function readJson(filePath, stderr) {
  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return { error: true };
  }
}

async function run(args, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const stdin = io.stdin || process.stdin;

  if (args.includes('--help') || args.includes('-h')) {
    stdout.write(HELP);
    return 0;
  }

  const parsed = parseArgs(args);
  if (!parsed) {
    stderr.write(`${USAGE}\n`);
    return 1;
  }
  if (parsed.evidencePath === STDIN_PATH) {
    stderr.write(`${USAGE}\n--evidence must be a real file; "-" (stdin) is only valid for the map document.\n`);
    return 1;
  }

  let doc;
  try {
    doc = await readDocument(parsed.mapPath, stdin);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 1;
  }
  const bundleResult = readJson(parsed.evidencePath, stderr);
  if (bundleResult.error) return 1;

  let normalized;
  try {
    normalized = validateDoc(doc);
  } catch (err) {
    if (err instanceof ValidationError) {
      err.errors.forEach(e => stderr.write(`${e.path || '/'}  ${e.message}\n`));
      return 1;
    }
    stderr.write(`${err.message}\n`);
    return 1;
  }

  const evidenceErrors = checkEvidence(normalized, bundleResult.value);
  if (evidenceErrors.length > 0) {
    evidenceErrors.forEach(e => stderr.write(`${e.path || '/'}  ${e.message}\n`));
    return 1;
  }

  stdout.write('ok\n');
  return 0;
}

module.exports = { run, parseArgs, USAGE, HELP };
