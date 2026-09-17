// SequentDraw's integration catalogue (src/catalogue/) and the
// `sequentdraw catalogue` command. The data checks pin the owner's licensing
// decision of 2026-09-17 (docs/design/suggestion-agent.md, decision A): each
// entry holds only our own id, a product name, our own category, our own
// one-line description and a Simple Icons slug, and nothing from n8n.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const simpleIcons = require('simple-icons');

const {
  CATEGORIES,
  ENTRY_KEYS,
  ID_PATTERN,
  MAX_DESCRIPTION_LENGTH,
  listIntegrations,
  getIntegration,
} = require('../src/catalogue');
const { INTEGRATIONS } = require('../src/catalogue/integrations');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'sequentdraw');
const CATALOGUE_DIR = path.join(ROOT, 'src', 'catalogue');

const ICON_SLUGS = new Set(
  Object.values(simpleIcons).filter(icon => icon && icon.slug).map(icon => icon.slug)
);

function runCli(args) {
  return spawnSync(process.execPath, [BIN, 'catalogue', ...args], { cwd: ROOT, encoding: 'utf8' });
}

describe('catalogue data', () => {
  test('holds a broad small-business list', () => {
    assert.ok(INTEGRATIONS.length >= 60 && INTEGRATIONS.length <= 80, `got ${INTEGRATIONS.length}`);
  });

  test('ids are unique', () => {
    const ids = INTEGRATIONS.map(e => e.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepStrictEqual(dupes, []);
  });

  test('ids are kebab-case', () => {
    const bad = INTEGRATIONS.filter(e => typeof e.id !== 'string' || !ID_PATTERN.test(e.id)).map(e => e.id);
    assert.deepStrictEqual(bad, []);
  });

  test('every entry has exactly the allowed keys, so no other data can ride along', () => {
    for (const entry of INTEGRATIONS) {
      assert.deepStrictEqual(Object.keys(entry).sort(), [...ENTRY_KEYS].sort(), entry.id);
    }
  });

  test('names are non-empty strings and unique', () => {
    const names = INTEGRATIONS.map(e => e.name);
    for (const name of names) assert.ok(typeof name === 'string' && name.trim() === name && name.length > 0, name);
    assert.strictEqual(new Set(names).size, names.length);
  });

  test('every category is in the known set', () => {
    const bad = INTEGRATIONS.filter(e => !CATEGORIES.includes(e.category)).map(e => `${e.id}:${e.category}`);
    assert.deepStrictEqual(bad, []);
  });

  test('every known category has at least one entry', () => {
    const used = new Set(INTEGRATIONS.map(e => e.category));
    assert.deepStrictEqual(CATEGORIES.filter(c => !used.has(c)), []);
  });

  test('descriptions are one line within the length limit', () => {
    for (const { id, description } of INTEGRATIONS) {
      assert.strictEqual(typeof description, 'string', id);
      assert.ok(description.length > 0 && description.length <= MAX_DESCRIPTION_LENGTH, `${id}: ${description.length} chars`);
      assert.doesNotMatch(description, /[\r\n]/, id);
    }
  });

  test('every non-null icon is a slug in the installed simple-icons package', () => {
    const bad = INTEGRATIONS.filter(e => e.icon !== null && !ICON_SLUGS.has(e.icon)).map(e => `${e.id}:${e.icon}`);
    assert.deepStrictEqual(bad, []);
  });

  test('icon is a string or null, never undefined or empty', () => {
    for (const { id, icon } of INTEGRATIONS) {
      assert.ok(icon === null || (typeof icon === 'string' && icon.length > 0), id);
    }
  });

  test('no entry contains "n8n-nodes" anywhere', () => {
    for (const entry of INTEGRATIONS) {
      assert.ok(!JSON.stringify(entry).includes('n8n-nodes'), entry.id);
    }
  });

  test('no catalogue source file contains "n8n-nodes"', () => {
    for (const file of fs.readdirSync(CATALOGUE_DIR)) {
      const text = fs.readFileSync(path.join(CATALOGUE_DIR, file), 'utf8');
      assert.ok(!text.includes('n8n-nodes'), file);
    }
  });

  test('descriptions carry no price, budget, plan or region talk', () => {
    const banned = /\b(price[sd]?|pricing|cost[s]?|budget|free|plan|plans|tier[s]?|region[s]?|cheap|expensive|popular(ity)?)\b/i;
    const bad = INTEGRATIONS.filter(e => banned.test(e.description)).map(e => e.id);
    assert.deepStrictEqual(bad, []);
  });

  test('entries are frozen', () => {
    assert.ok(Object.isFrozen(INTEGRATIONS));
    for (const entry of INTEGRATIONS) assert.ok(Object.isFrozen(entry), entry.id);
  });
});

describe('catalogue lookups', () => {
  test('listIntegrations returns every entry in category order', () => {
    const all = listIntegrations();
    assert.strictEqual(all.length, INTEGRATIONS.length);
    const positions = all.map(e => CATEGORIES.indexOf(e.category));
    assert.deepStrictEqual(positions, [...positions].sort((a, b) => a - b));
  });

  test('listIntegrations filters by category and returns a fresh array', () => {
    const payments = listIntegrations('payments');
    assert.ok(payments.length > 0);
    assert.ok(payments.every(e => e.category === 'payments'));
    assert.notStrictEqual(listIntegrations('payments'), payments);
  });

  test('getIntegration finds by id and returns null otherwise', () => {
    assert.strictEqual(getIntegration('stripe').name, 'Stripe');
    assert.strictEqual(getIntegration('no-such-thing'), null);
  });
});

describe('sequentdraw catalogue', () => {
  test('lists every entry as text grouped by category', () => {
    const result = runCli([]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /^payments:\n/);
    for (const entry of INTEGRATIONS) assert.ok(result.stdout.includes(`  ${entry.id}  ${entry.name} -- `), entry.id);
  });

  test('--json prints the entries as a JSON array', () => {
    const result = runCli(['--json']);
    assert.strictEqual(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.length, INTEGRATIONS.length);
    assert.deepStrictEqual(Object.keys(parsed[0]).sort(), [...ENTRY_KEYS].sort());
  });

  test('--category filters, in both spellings, with and without --json', () => {
    const spaced = runCli(['--category', 'crm', '--json']);
    const joined = runCli(['--json', '--category=crm']);
    assert.strictEqual(spaced.status, 0, spaced.stderr);
    assert.strictEqual(spaced.stdout, joined.stdout);
    const parsed = JSON.parse(spaced.stdout);
    assert.ok(parsed.length > 0 && parsed.every(e => e.category === 'crm'));

    const text = runCli(['--category', 'crm']);
    assert.strictEqual(text.status, 0, text.stderr);
    assert.match(text.stdout, /^crm:\n/);
    assert.doesNotMatch(text.stdout, /^payments:/m);
  });

  test('an unknown category exits 1 and names the known ones', () => {
    const result = runCli(['--category', 'crypto']);
    assert.strictEqual(result.status, 1);
    assert.strictEqual(result.stdout, '');
    assert.match(result.stderr, /Unknown category "crypto"/);
    assert.match(result.stderr, /payments/);
  });

  for (const args of [
    ['--bogus'],
    ['extra'],
    ['--json', 'extra'],
    ['--category'],
    ['--category', '--json'],
    ['--category='],
    ['--category', 'crm', '--category', 'email'],
  ]) {
    test(`strict arguments: ${JSON.stringify(args)} prints usage and exits 1`, () => {
      const result = runCli(args);
      assert.strictEqual(result.status, 1);
      assert.strictEqual(result.stdout, '');
      assert.match(result.stderr, /Usage: sequentdraw catalogue/);
    });
  }

  test('--help prints usage and exits 0', () => {
    const result = runCli(['--help']);
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /Usage: sequentdraw catalogue/);
  });
});
