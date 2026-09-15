#!/usr/bin/env node
// node src/n8n/cli.js <in.json> <out.html> [--layout flat|rows]

const fs = require('fs');
const path = require('path');
const { renderMap } = require('./index');

function parseArgs(argv) {
  const positional = [];
  let layout = 'flat';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--layout') {
      layout = argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }
  return { positional, layout };
}

async function main() {
  const { positional, layout } = parseArgs(process.argv.slice(2));
  const [inputPath, outputPath] = positional;
  if (!inputPath || !outputPath) {
    console.error('Usage: node src/n8n/cli.js <in.json> <out.html> [--layout flat|rows]');
    process.exit(1);
  }
  if (layout !== 'flat' && layout !== 'rows') {
    console.error(`Unknown --layout "${layout}" (expected "flat" or "rows")`);
    process.exit(1);
  }

  const doc = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const html = await renderMap(doc, { strategy: layout });

  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, html);
  console.log(`wrote ${outputPath} (${(html.length / 1024).toFixed(0)}kb, layout=${layout})`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
