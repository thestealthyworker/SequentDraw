// Monograms for products with no brand mark (issue #55).
//
// A suggestion carries its catalogue `integration`, but Simple Icons has
// no mark for 25 of the 76 catalogue entries (Microsoft, LinkedIn and
// others withdrew theirs). Those nodes fell back to the generic service
// glyph, and a client read them as less real than the suggestions beside
// them that carried a logo. They now show the product's initials.

const { test } = require('node:test');
const assert = require('node:assert');

const { nodeIconMarkup, monogramOf } = require('../src/n8n/render-svg');
const { renderMap, renderSvg } = require('../src/n8n/index');
const { listIntegrations } = require('../src/catalogue');
const ICONS = require('../src/icons');

test('initials come from the first two words of the product name', () => {
  assert.strictEqual(monogramOf('Pipedrive'), 'P');
  assert.strictEqual(monogramOf('Microsoft Teams'), 'MT');
  assert.strictEqual(monogramOf('Acuity Scheduling'), 'AS');
  assert.strictEqual(monogramOf('Microsoft Excel 365'), 'ME');
  assert.strictEqual(monogramOf('monday.com'), 'M');
  assert.strictEqual(monogramOf(''), '');
  assert.strictEqual(monogramOf(undefined), '');
});

test('a product with no brand mark gets its monogram, not the service glyph', () => {
  const markup = nodeIconMarkup({ kind: 'service', integration: 'pipedrive' }, 100, 100);
  assert.match(markup, /class="node-monogram"/);
  assert.match(markup, />P</);
});

test('a brand mark, when there is one, always wins over a monogram', () => {
  const markup = nodeIconMarkup({ kind: 'service', icon: 'slack', integration: 'slack' }, 100, 100);
  assert.doesNotMatch(markup, /node-monogram/);
  assert.match(markup, /<path d=/);
});

test('a node naming no product keeps its kind glyph', () => {
  const markup = nodeIconMarkup({ kind: 'service' }, 100, 100);
  assert.doesNotMatch(markup, /node-monogram/);
});

test('an unknown integration id falls back to the glyph rather than throwing', () => {
  const markup = nodeIconMarkup({ kind: 'service', integration: 'no-such-thing' }, 100, 100);
  assert.doesNotMatch(markup, /node-monogram/);
});

// The issue named three nodes; the property is that EVERY catalogue entry
// without a brand mark is covered. Checked against the live catalogue, so
// an entry added later without an icon is covered automatically, and the
// count below makes a change in Simple Icons coverage visible.
test('every catalogue entry with no brand mark renders a monogram', () => {
  const unbranded = listIntegrations().filter(i => !i.icon || !ICONS.get(i.icon));
  assert.ok(unbranded.length > 0);
  for (const entry of unbranded) {
    const markup = nodeIconMarkup({ kind: 'service', integration: entry.id }, 0, 0);
    assert.match(markup, /node-monogram/, `${entry.id} (${entry.name}) has no monogram`);
  }
});

test('the monogram reaches both the interactive map and the documentation export', async () => {
  const doc = {
    title: 'Monogram',
    nodes: [
      { id: 'quote', label: 'Send quote', kind: 'manual' },
      {
        id: 's',
        label: 'Pipedrive',
        kind: 'service',
        status: 'suggested',
        integration: 'pipedrive',
        rationale: 'Nobody chases a silent quote.',
        cites: ['quote'],
      },
    ],
    edges: [{ from: 's', to: 'quote', type: 'dashed' }],
  };
  assert.match(await renderMap(doc), /class="node-monogram"[^>]*>P</);
  assert.match(await renderSvg(doc), /class="node-monogram"[^>]*>P</);
});

test('a hostile catalogue name could not inject markup', () => {
  // Catalogue names are ours, but the monogram is escaped regardless.
  assert.strictEqual(monogramOf('<script> x'), '<X');
  const markup = nodeIconMarkup({ kind: 'service', integration: 'pipedrive' }, 0, 0);
  assert.doesNotMatch(markup, /<script/);
});
