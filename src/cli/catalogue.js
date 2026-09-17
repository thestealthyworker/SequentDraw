// `sequentdraw catalogue [--category <name>] [--json]`
//
// Prints SequentDraw's own integration catalogue (src/catalogue/), the pool a
// suggestion must be chosen from. Same strict-argument contract as
// src/cli/render.js: an unknown flag, a missing flag value or any positional
// prints usage and exits 1. An unknown category also exits 1 and names the
// known ones. Reads nothing and writes no files.

const { CATEGORIES, isCategory, listIntegrations } = require('../catalogue');

const USAGE = 'Usage: sequentdraw catalogue [--category <name>] [--json]';

const HELP = `${USAGE}

Lists the integrations SequentDraw can suggest: an id, the product name, a
category and a one-line description written by SequentDraw. Entries are not
ranked.

Options:
  --category <name>  Only list one category. Known categories:
                     ${CATEGORIES.join(', ')}
  --json             Print a JSON array of entries
                     ({ id, name, category, description, icon }) instead of
                     the text listing.
  --help             Show this help.
`;

function parseArgs(args) {
  let category = null;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--category') {
      if (category != null) return null;
      const value = args[i + 1];
      if (value == null || value.startsWith('-')) return null;
      category = value;
      i++;
    } else if (arg.startsWith('--category=')) {
      if (category != null) return null;
      category = arg.slice('--category='.length);
      if (!category) return null;
    } else if (arg === '--json') {
      json = true;
    } else {
      // Unknown flag or any positional.
      return null;
    }
  }
  return { category, json };
}

function formatText(entries) {
  const lines = [];
  let current = null;
  for (const entry of entries) {
    if (entry.category !== current) {
      if (current !== null) lines.push('');
      current = entry.category;
      lines.push(`${current}:`);
    }
    lines.push(`  ${entry.id}  ${entry.name} -- ${entry.description}`);
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
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
  if (parsed.category != null && !isCategory(parsed.category)) {
    stderr.write(`${USAGE}\nUnknown category "${parsed.category}". Known categories: ${CATEGORIES.join(', ')}\n`);
    return 1;
  }

  const entries = listIntegrations(parsed.category);
  stdout.write(parsed.json ? `${JSON.stringify(entries, null, 2)}\n` : formatText(entries));
  return 0;
}

module.exports = { run, parseArgs, USAGE };
