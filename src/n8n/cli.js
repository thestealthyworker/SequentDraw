#!/usr/bin/env node
// node src/n8n/cli.js <in.json> <out.html>

const fs = require('fs');
const path = require('path');
const { renderMap } = require('./index');

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error('Usage: node src/n8n/cli.js <in.json> <out.html>');
    process.exit(1);
  }

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
