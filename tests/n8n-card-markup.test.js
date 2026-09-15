// Markup checks for the details-card interaction surface
// (docs/design/n8n-visual-style.md "Details card"): every node and edge
// must be keyboard-focusable with a descriptive accessible name, the
// single details-card container must exist, and the removed edge-stub
// markup must not reappear.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { renderMap } = require('../src/n8n/index');

const FIXTURE = path.join(__dirname, '..', 'examples', 'medusa-return-flow.json');
const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

describe('details card markup on the Medusa fixture', () => {
  let html;

  test('renderMap resolves', async () => {
    html = await renderMap(doc);
    assert.ok(html.length > 0);
  });

  test('exactly one details-card container exists', () => {
    const matches = html.match(/id="details-card"/g) || [];
    assert.strictEqual(matches.length, 1);
  });

  test('every node <g> carries tabindex="0" and a non-empty aria-label', () => {
    const nodeTags = [...html.matchAll(/<g class="n8n-node[^"]*"[^>]*>/g)].map(m => m[0]);
    assert.strictEqual(nodeTags.length, doc.nodes.length, 'expected one <g class="n8n-node"> per node');
    nodeTags.forEach(tag => {
      assert.match(tag, /tabindex="0"/, `missing tabindex on ${tag}`);
      const m = tag.match(/aria-label="([^"]*)"/);
      assert.ok(m, `missing aria-label on ${tag}`);
      assert.ok(m[1].trim().length > 0, `empty aria-label on ${tag}`);
    });
  });

  test('every edge <g> carries tabindex="0" and a non-empty aria-label', () => {
    const edgeTags = [...html.matchAll(/<g class="n8n-edge[^"]*"[^>]*>/g)].map(m => m[0]);
    assert.strictEqual(edgeTags.length, doc.edges.length, 'expected one <g class="n8n-edge"> per edge');
    edgeTags.forEach(tag => {
      assert.match(tag, /tabindex="0"/, `missing tabindex on ${tag}`);
      const m = tag.match(/aria-label="([^"]*)"/);
      assert.ok(m, `missing aria-label on ${tag}`);
      assert.ok(m[1].trim().length > 0, `empty aria-label on ${tag}`);
    });
  });

  test('a node aria-label follows the "label, kind, receives from N, sends to N" shape', () => {
    const tag = [...html.matchAll(/<g class="n8n-node[^"]*" data-id="pay_provider"[^>]*>/g)][0];
    assert.ok(tag);
    const m = tag[0].match(/aria-label="([^"]*)"/);
    assert.match(m[1], /^Payment provider, service, receives from \d+, sends to \d+$/);
  });

  test('no edge-stub markup remains anywhere in the output', () => {
    assert.ok(!html.includes('edge-stub'));
    assert.ok(!html.includes('show-stub-start'));
    assert.ok(!html.includes('show-stub-end'));
    assert.ok(!html.includes('stub-start'));
    assert.ok(!html.includes('stub-end'));
  });
});
