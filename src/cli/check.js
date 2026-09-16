// `sequentdraw check <map.json|-> [--evidence <bundle.json>] [--emit-open <out.json>]`
//
// Runs validateDoc() (structural/schema validation), then checkEvidence()
// (src/scan/check-evidence.js: every "source": "scan" node/edge in the map
// must cite evidence that actually exists in the bundle and actually
// supports the claim) when --evidence is given, then checkCompleteness()
// (src/gaps/completeness.js: the six completeness rules of
// docs/design/business-map.md section 2). Prints "ok" and exits 0 when
// everything passes; otherwise prints one "path  message" line per problem
// to stderr and exits 1. Same strict-argument contract as the other
// subcommands. "-" reads the map from stdin (src/cli/read-document.js);
// --evidence and --emit-open are always real files.
//
// --evidence is OPTIONAL (docs/design/business-map.md:14-16): a business map
// has no scan bundle, and structural plus completeness checks are the whole
// of what applies to it.
//
// --emit-open writes a COPY carrying one open node per gap; the input file is
// never modified in place. It exits 0 even when gaps were emitted (owner's
// decision, docs/design/business-map.md:454-459): the flag's job was to emit,
// and a non-zero exit would break `git-map`'s documented re-run-until-`ok`
// loop (skills/git-map/SKILL.md:115-122). The gap lines are printed to stderr
// either way, in the same shape, so a skill can read them off in both modes.
//
// Nothing is written on any error -- a structural error, an evidence error, a
// copy that would breach a validation cap, or an unwritable path. Same
// guarantee as render (src/cli/render.js:3-5).

const fs = require('fs');
const path = require('path');
const { validateDoc, ValidationError } = require('../n8n/validate');
const { checkEvidence } = require('../scan');
const { checkCompleteness, buildOpenDocument } = require('../gaps/completeness');
const { readDocument, STDIN_PATH } = require('./read-document');

const USAGE = 'Usage: sequentdraw check <map.json|-> [--evidence <bundle.json>] [--emit-open <out.json>]';

const HELP = `${USAGE}

Checks a workflow JSON document: first validateDoc()'s own structural and
schema invariants, then -- with --evidence -- that every "source": "scan"
node or edge cites at least one evidence id that exists in the given bundle
and actually supports the claim (a depends-on, sdk-import, or route fact
connecting an edge's two endpoints), then the completeness rules: every
artifact has a named recipient, every external input a named source actor,
every decision a named decider, every unhappy path an owner, and the flow
ends in someone's hands rather than inside a system. The completeness rules
run only on a map that carries a "business" layer.

Prints "ok" and exits 0 when the document passes. Otherwise prints one
"path  message" line per problem to stderr and exits 1 -- fix an evidence
violation by demoting the item to "open" or "source": "model", never by
inventing evidence, and fix a completeness gap by answering it (or by
drawing it with --emit-open).

Input:
  <map.json>          A file path, or "-" to read the map from stdin (for
                       example from a quoted heredoc), so no file has to be
                       written first.

Options:
  --evidence <file>   The evidence bundle produced by "sequentdraw scan".
                       Optional: without it the evidence cross-reference is
                       skipped. Always a real file: "-" is not accepted here.
  --emit-open <file>  Write a COPY of the map with one open question node per
                       completeness gap, then exit 0. The input is never
                       modified in place, and the copy passes "check". Always
                       a real file, and never the input path.
  --help              Show this help.
`;

// A flag value is rejected when it is missing or looks like another flag;
// "-" is let through so run() can say exactly why it is refused.
function flagValue(args, i) {
  const value = args[i + 1];
  if (value == null || (value !== STDIN_PATH && value.startsWith('-'))) return null;
  return value;
}

function parseArgs(args) {
  const positional = [];
  let evidencePath = null;
  let emitOpenPath = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--evidence') {
      const value = flagValue(args, i);
      if (value == null) return null;
      evidencePath = value;
      i++;
    } else if (arg.startsWith('--evidence=')) {
      evidencePath = arg.slice('--evidence='.length);
      if (!evidencePath) return null;
    } else if (arg === '--emit-open') {
      const value = flagValue(args, i);
      if (value == null) return null;
      emitOpenPath = value;
      i++;
    } else if (arg.startsWith('--emit-open=')) {
      emitOpenPath = arg.slice('--emit-open='.length);
      if (!emitOpenPath) return null;
    } else if (arg !== STDIN_PATH && arg.startsWith('-')) {
      return null;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) return null;
  return { mapPath: positional[0], evidencePath, emitOpenPath };
}

function readJson(filePath, stderr) {
  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return { error: true };
  }
}

// "The input is never modified in place": --emit-open naming the input path,
// after both are resolved, is a usage error
// (docs/design/business-map.md:279-282). realpath catches the case the string
// comparison cannot -- a symlink, or two spellings of the same file -- and is
// only consulted for paths that already exist.
function samePath(a, b) {
  if (path.resolve(a) === path.resolve(b)) return true;
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

function writeLines(stream, errors) {
  errors.forEach(e => stream.write(`${e.path || '/'}  ${e.message}\n`));
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
  if (parsed.emitOpenPath === STDIN_PATH) {
    stderr.write(`${USAGE}\n--emit-open must be a real file; "-" (stdin) is only valid for the map document.\n`);
    return 1;
  }
  // Every argument is settled before stdin is touched or anything is read, so
  // a usage error never leaves a piped document half-consumed.
  if (parsed.emitOpenPath != null && parsed.mapPath !== STDIN_PATH && samePath(parsed.emitOpenPath, parsed.mapPath)) {
    stderr.write(`${USAGE}\n--emit-open writes a copy and must not name the input document ("${parsed.mapPath}").\n`);
    return 1;
  }

  let doc;
  try {
    doc = await readDocument(parsed.mapPath, stdin);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 1;
  }

  let bundle = null;
  if (parsed.evidencePath != null) {
    const bundleResult = readJson(parsed.evidencePath, stderr);
    if (bundleResult.error) return 1;
    bundle = bundleResult.value;
  }

  let normalized;
  try {
    normalized = validateDoc(doc);
  } catch (err) {
    if (err instanceof ValidationError) {
      writeLines(stderr, err.errors);
      return 1;
    }
    stderr.write(`${err.message}\n`);
    return 1;
  }

  if (bundle != null) {
    const evidenceErrors = checkEvidence(normalized, bundle);
    if (evidenceErrors.length > 0) {
      writeLines(stderr, evidenceErrors);
      return 1;
    }
  }

  // The checks run against validateDoc()'s normalised form (its nodes and
  // edges are the input's own arrays, so the indexes in a gap's path are the
  // input's indexes); the copy is built from the parsed input.
  const { errors: gaps, additions } = checkCompleteness(normalized);

  if (parsed.emitOpenPath == null) {
    if (gaps.length > 0) {
      writeLines(stderr, gaps);
      return 1;
    }
    stdout.write('ok\n');
    return 0;
  }

  const copy = buildOpenDocument(doc, additions);

  // The copy must pass before it is written: this is where a cap breach
  // (100 nodes, 500 edges, 20 notes, src/n8n/validate.js:74-78) and any other
  // structural consequence of the additions is caught, with nothing written.
  try {
    validateDoc(copy);
  } catch (err) {
    stderr.write('--emit-open would produce an invalid document; nothing was written.\n');
    if (err instanceof ValidationError) {
      writeLines(stderr, err.errors);
      return 1;
    }
    stderr.write(`${err.message}\n`);
    return 1;
  }

  const serialized = `${JSON.stringify(copy, null, 2)}\n`;
  try {
    fs.mkdirSync(path.dirname(parsed.emitOpenPath), { recursive: true });
    fs.writeFileSync(parsed.emitOpenPath, serialized);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 1;
  }

  writeLines(stderr, gaps);
  const nodeCount = additions.nodes.length;
  const noteCount = additions.notes.length;
  const noteSuffix = noteCount > 0 ? `, ${noteCount} note${noteCount === 1 ? '' : 's'}` : '';
  stdout.write(`wrote ${parsed.emitOpenPath} (${nodeCount} open node${nodeCount === 1 ? '' : 's'}${noteSuffix})\n`);
  return 0;
}

module.exports = { run, parseArgs, USAGE, HELP };
