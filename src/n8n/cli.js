#!/usr/bin/env node
// node src/n8n/cli.js <in.json> <out.html|out.svg> [--layers a,b]

const fs = require('fs');
const path = require('path');
const { renderMap, renderSvg, ValidationError } = require('./index');

const USAGE = 'Usage: node src/n8n/cli.js <in.json> <out.html|out.svg> [--layers a,b]';

function parseArgs(args) {
  // Exactly two positional paths; the only option is --layers=<value> or
  // --layers <value>, and it needs a value. Any other flag, a flag in a
  // positional slot, or extra positional arguments must fail loudly
  // instead of being mistaken for an output path (a stray `--layout` file
  // was written this way once — see tests/n8n-cli.test.js).
  const positional = [];
  let layersRaw = null;
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
    } else if (arg.startsWith('-')) {
      return null;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) return null;
  return { inputPath: positional[0], outputPath: positional[1], layersRaw };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(USAGE);
    process.exit(1);
  }
  const { inputPath, outputPath, layersRaw } = parsed;

  const ext = path.extname(outputPath).toLowerCase();
  if (ext !== '.html' && ext !== '.svg') {
    console.error(`${USAGE}\nOutput file must end in .html or .svg (got "${outputPath}").`);
    process.exit(1);
  }
  if (layersRaw != null && ext !== '.svg') {
    console.error(`${USAGE}\n--layers is only valid with a .svg output file.`);
    process.exit(1);
  }

  const doc = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  let output;
  if (ext === '.svg') {
    const layers = layersRaw ? layersRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    output = await renderSvg(doc, { layers });
  } else {
    output = await renderMap(doc);
  }

  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, output);
  console.log(`wrote ${outputPath} (${(output.length / 1024).toFixed(0)}kb)`);
}

main().catch(err => {
  if (err instanceof ValidationError) {
    for (const e of err.errors) {
      console.error(`${e.path || '/'}  ${e.message}`);
    }
    process.exit(1);
  }
  console.error(err.message);
  process.exit(1);
});
