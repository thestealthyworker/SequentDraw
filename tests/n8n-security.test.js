// Fix-round regression tests: stored XSS via unescaped attribute values,
// renderMap crashing on a spec-valid doc with no `groups`, and SPEC enum
// validation. See the code-review fix-round brief for background.

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { renderMap } = require('../src/n8n/index');
const { validateDoc } = require('../src/n8n/validate');

function baseDoc() {
  return {
    title: 't',
    groups: [{ id: 'g1', label: 'G', color: 'purple' }],
    nodes: [
      { id: 'n1', label: 'N', kind: 'service', icon: null, parentId: 'g1', layers: ['base'] },
      { id: 'n2', label: 'N2', kind: 'service', icon: null, parentId: null, layers: ['base'] },
    ],
    edges: [{ from: 'n1', to: 'n2', type: 'solid', condition: null }],
  };
}

describe('security: escaping and validation', () => {
  test('injection attempts in every free-text field render as inert text, not markup', async () => {
    const doc = {
      title: 'T"><script>alert(1)</script>',
      groups: [{ id: 'g1', label: 'G"><script>alert(2)</script>', color: 'purple' }],
      nodes: [
        {
          id: 'n1',
          label: 'L"><script>alert(3)</script>',
          sublabel: 'S"><script>alert(4)</script>',
          kind: 'service',
          icon: null,
          parentId: 'g1',
          layers: ['base', 'edge'],
          status: 'open',
          prompt: 'P"><script>alert(5)</script>',
        },
        { id: 'n2', label: 'N2', kind: 'external', icon: null, parentId: 'g1', layers: ['base'] },
      ],
      edges: [{ from: 'n1', to: 'n2', type: 'dashed', condition: 'C"><script>alert(6)</script>' }],
    };

    const html = await renderMap(doc, { strategy: 'flat' });

    // Exactly one <script> element should exist: the viewer's own inline
    // script. Any more means something broke out of an attribute or text
    // node and injected a new element.
    const scriptOpenTags = html.match(/<script[ >]/g) || [];
    assert.strictEqual(scriptOpenTags.length, 1, `expected exactly one <script> tag, found ${scriptOpenTags.length}`);

    // None of the injected payloads should appear as live, executable
    // script content (only as escaped text within SVG/HTML text nodes).
    assert.ok(!/alert\(1\)/.test(html.split('<script')[1] || ''), 'title payload must not reach the inline script');
    for (const marker of ['alert(1)', 'alert(2)', 'alert(3)', 'alert(4)', 'alert(5)', 'alert(6)']) {
      // It's fine (expected) for the escaped form to appear in text content;
      // what must never appear is a live "<script>alert(" sequence.
      assert.ok(!html.includes(`<script>${marker}`), `${marker} must not appear as an unescaped inline script`);
    }
  });

  test('a doc with no `groups` key still renders end to end (renderMap normalises before renderHtml)', async () => {
    const doc = {
      title: 'No groups',
      nodes: [
        { id: 'a', label: 'A', kind: 'service', icon: null, parentId: null, layers: ['base'] },
        { id: 'b', label: 'B', kind: 'service', icon: null, parentId: null, layers: ['base'] },
      ],
      edges: [{ from: 'a', to: 'b', type: 'solid', condition: null }],
    };
    const html = await renderMap(doc, { strategy: 'flat' });
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
  });

  test('invalid enum values throw a clear validation error instead of rendering', () => {
    const badLayer = baseDoc();
    badLayer.nodes[0].layers = ['not-a-layer'];
    assert.throws(() => validateDoc(badLayer), /layers/);

    const badKind = baseDoc();
    badKind.nodes[0].kind = 'not-a-kind';
    assert.throws(() => validateDoc(badKind), /kind/);

    const badStatus = baseDoc();
    badStatus.nodes[0].status = 'not-a-status';
    assert.throws(() => validateDoc(badStatus), /status/);

    const badEdgeType = baseDoc();
    badEdgeType.edges[0].type = 'not-a-type';
    assert.throws(() => validateDoc(badEdgeType), /type/);

    const badColor = baseDoc();
    badColor.groups[0].color = 'not-a-color';
    assert.throws(() => validateDoc(badColor), /color/);

    const badId = baseDoc();
    badId.nodes[0].id = 'bad id with spaces!';
    assert.throws(() => validateDoc(badId), /id/);
  });

  test('valid docs still pass validation unchanged', () => {
    const doc = baseDoc();
    const result = validateDoc(doc);
    assert.strictEqual(result.nodes.length, 2);
    assert.strictEqual(result.groups.length, 1);
    assert.strictEqual(result.title, 't');
  });
});
