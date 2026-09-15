#!/usr/bin/env node
// node src/n8n/cli.js <in.json> <out.html>

const fs = require('fs');
const path = require('path');
const { renderMap } = require('./index');

const USAGE = 'Usage: node src/n8n/cli.js <in.json> <out.html>';

async function main() {
  const args = process.argv.slice(2);
  // Exactly two paths, no options: a flag must never be taken as the output path.
  if (args.length !== 2 || args.some(arg => arg.startsWith('-'))) {
    console.error(USAGE);
    process.exit(1);
  }
  const [inputPath, outputPath] = args;

  const doc = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const html = await renderMap(doc);

  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, html);
  console.log(`wrote ${outputPath} (${(html.length / 1024).toFixed(0)}kb)`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
