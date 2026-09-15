// `sequentdraw validate <in.json>`
//
// Prints "ok" and exits 0 when the document is valid. Otherwise prints one
// "path  message" line per validation error to stderr and exits 1. Same
// strict-argument contract as the other subcommands: an unknown flag or an
// extra positional prints usage and exits 1.

const fs = require('fs');
const { validateDoc, ValidationError } = require('../n8n/validate');

const USAGE = 'Usage: sequentdraw validate <in.json>';

const HELP = `${USAGE}

Validates a SequentDraw workflow JSON document against the schema and the
engine's structural invariants (id references, enum values, length limits).

Prints "ok" and exits 0 when the document is valid. Otherwise prints one
"path  message" line per error to stderr and exits 1.

Options:
  --help   Show this help.
`;

function parseArgs(args) {
  const positional = [];
  for (const arg of args) {
    if (arg.startsWith('-')) return null;
    positional.push(arg);
  }
  if (positional.length !== 1) return null;
  return { inputPath: positional[0] };
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

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(parsed.inputPath, 'utf8'));
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 1;
  }

  try {
    validateDoc(doc);
  } catch (err) {
    if (err instanceof ValidationError) {
      err.errors.forEach(e => stderr.write(`${e.path || '/'}  ${e.message}\n`));
      return 1;
    }
    stderr.write(`${err.message}\n`);
    return 1;
  }

  stdout.write('ok\n');
  return 0;
}

module.exports = { run, parseArgs, USAGE, HELP };
