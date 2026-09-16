// `sequentdraw render <in.json|-> <out.html|out.svg> [--layers a,b] [--fragment]`
//
// Same strict-argument-handling contract as the original
// `node src/n8n/cli.js` (tests/n8n-cli.test.js): unknown flags and extra
// positionals print usage and exit 1, and nothing is written to disk on any
// error. This adds `--fragment`, valid only for an `.html` output -- see
// src/n8n/render.js's renderHtml() and docs/design/skills-and-plugin.md's
// artifact output rule -- and "-" as the input path, which reads the
// document from stdin (src/cli/read-document.js). The output path is
// always a real file.

const fs = require('fs');
const path = require('path');
const { renderMap, renderSvg, ValidationError } = require('../n8n/index');
const { readDocument, STDIN_PATH } = require('./read-document');

const USAGE = 'Usage: sequentdraw render <in.json|-> <out.html|out.svg> [--layers a,b] [--fragment]';

const HELP = `${USAGE}

Renders a SequentDraw workflow JSON document into an interactive HTML map
(n8n-style, pan/zoom, details cards) or a static SVG documentation figure
with inline captions.

Input:
  <in.json>      A file path, or "-" to read the document from stdin (for
                 example from a quoted heredoc), so no file has to be
                 written first. The output is always a real file path.

Options:
  --layers a,b   SVG output only. Extra layers to include; "base" is always
                 included. Omit to export the base layer alone.
  --fragment     HTML output only. Emit the artifact fragment: a <title>,
                 <style>, the map markup and one <script>, with no
                 <!DOCTYPE>, <html>, <head> or <body>. For embedding in a
                 host page that supplies its own shell (a published Claude
                 artifact).
  --help         Show this help.
`;

// Exported so the top-level dispatcher (src/cli/index.js) and tests can
// reuse the exact same argument contract without re-parsing argv twice.
function parseArgs(args) {
  const positional = [];
  let layersRaw = null;
  let fragment = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--layers') {
      const value = args[i + 1];
      if (value == null || value.startsWith('-')) return null;
      layersRaw = value;
      i++;
    } else if (arg.startsWith('--layers=')) {
      layersRaw = arg.slice('--layers='.length);
      if (!layersRaw) return null;
    } else if (arg === '--fragment') {
      fragment = true;
    } else if (arg !== STDIN_PATH && arg.startsWith('-')) {
      return null;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) return null;
  return { inputPath: positional[0], outputPath: positional[1], layersRaw, fragment };
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
  const { inputPath, outputPath, layersRaw, fragment } = parsed;

  if (outputPath === STDIN_PATH) {
    stderr.write(`${USAGE}\nThe output must be a real .html or .svg path; "-" (stdin) is only valid as the input document.\n`);
    return 1;
  }
  const ext = path.extname(outputPath).toLowerCase();
  if (ext !== '.html' && ext !== '.svg') {
    stderr.write(`${USAGE}\nOutput file must end in .html or .svg (got "${outputPath}").\n`);
    return 1;
  }
  if (layersRaw != null && ext !== '.svg') {
    stderr.write(`${USAGE}\n--layers is only valid with a .svg output file.\n`);
    return 1;
  }
  if (fragment && ext !== '.html') {
    stderr.write(`${USAGE}\n--fragment is only valid with an .html output file.\n`);
    return 1;
  }

  // Every argument is settled before stdin is touched, so a usage error
  // never leaves a piped document half-consumed.
  let doc;
  try {
    doc = await readDocument(inputPath, stdin);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 1;
  }

  let output;
  try {
    if (ext === '.svg') {
      const layers = layersRaw ? layersRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
      output = await renderSvg(doc, { layers });
    } else {
      output = await renderMap(doc, { fragment });
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      err.errors.forEach(e => stderr.write(`${e.path || '/'}  ${e.message}\n`));
      return 1;
    }
    stderr.write(`${err.message}\n`);
    return 1;
  }

  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, output);
  stdout.write(`wrote ${outputPath} (${(output.length / 1024).toFixed(0)}kb)\n`);
  return 0;
}

module.exports = { run, parseArgs, USAGE, HELP };
