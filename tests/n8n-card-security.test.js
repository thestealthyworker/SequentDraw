// Details-card security (docs/design/n8n-visual-style.md "Details card",
// "Security"): hostile node/edge description, link, prompt and rationale
// values must never break out of the single inline <script>, and the
// viewer script itself must never touch a DOM sink that would let embedded
// data execute as markup.

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { renderMap } = require('../src/n8n/index');
const { renderHtml } = require('../src/n8n/render');
const { layoutMap } = require('../src/n8n/layout');
const { buildCardData } = require('../src/n8n/card-data');
const { validateDoc } = require('../src/n8n/validate');
const { script } = require('../src/n8n/render-shell');

const LS = '\u2028';
const PS = '\u2029';

const EMPTY_GEOMETRY = {
  nodeBoxes: {},
  labelReserve: 48,
  padding: { top: 40, left: 24, right: 24, bottom: 24 },
  grid: 16,
  frameLabelOffsetX: 12,
  frameLabelOffsetY: 22,
};

function hostileDoc() {
  return {
    title: 'Hostile card data',
    groups: [{ id: 'g1', label: 'G"><script>alert(9)</script>', color: 'purple' }],
    nodes: [
      {
        id: 'n1',
        label: 'N1',
        kind: 'service',
        parentId: 'g1',
        status: 'open',
        description: `</script><img src=x onerror=alert(1)>${LS}${PS}"quoted"'single'`,
        link: 'https://example.com/safe',
        prompt: `</script><svg onload=alert(2)>${LS}"quoted"`,
      },
      {
        id: 'n2',
        label: 'N2',
        kind: 'service',
        status: 'suggested',
        rationale: `</script><img onerror=alert(3) src=x>${PS}'quoted'`,
        cites: ['n1'],
        integration: 'slack',
      },
    ],
    edges: [
      {
        from: 'n1',
        to: 'n2',
        type: 'dashed',
        condition: `</script><img onerror=alert(4) src=x>`,
        description: `</script>${LS}${PS}"quoted"<script>alert(5)</script>`,
      },
    ],
  };
}

// Extracts the single embedded CARD_DATA JSON literal, without regex-ing
// arbitrary content out of a hostile document — it looks for the fixed
// marker text render-shell.js always emits around it.
function extractCardDataJson(html) {
  const start = html.indexOf('var CARD_DATA = ');
  assert.ok(start >= 0, 'CARD_DATA literal should be present in the script');
  const afterMarker = start + 'var CARD_DATA = '.length;
  const end = html.indexOf(';\n  var nodeCardsById', afterMarker);
  assert.ok(end >= 0, 'CARD_DATA literal should be terminated by the expected statement boundary');
  return html.slice(afterMarker, end);
}

describe('details card: hostile input never breaks the single <script>', () => {
  test('exactly one <script> element survives every hostile field', async () => {
    const html = await renderMap(hostileDoc());
    const scriptOpenTags = html.match(/<script[ >]/g) || [];
    assert.strictEqual(scriptOpenTags.length, 1, `expected exactly one <script> tag, found ${scriptOpenTags.length}`);
  });

  test('none of the hostile payloads appear as a live </script> break-out or executable tag', async () => {
    const html = await renderMap(hostileDoc());
    assert.ok(!/<\/script><img/i.test(html.replace(/\\u003c\/script\\u003e/gi, '')), 'a raw </script><img sequence must never appear literally');
    assert.ok(!html.includes('<img src=x onerror=alert(1)>'), 'onerror payload must not appear as live markup');
    assert.ok(!html.includes('<svg onload=alert(2)>'), 'onload payload must not appear as live markup');
    // The escaped forms are expected and fine: \u003c/script\u003e etc.
    assert.ok(html.includes('\\u003c/script\\u003e'), 'the </script> sequence should be escaped, not dropped');
  });

  test('the embedded CARD_DATA JSON parses back to exactly the same data buildCardData() produced', async () => {
    const doc = validateDoc(hostileDoc());
    const layout = await layoutMap(doc);
    const expected = buildCardData(doc, layout);
    const html = renderHtml(layout, doc);
    const jsonText = extractCardDataJson(html);
    const parsed = JSON.parse(jsonText);
    assert.deepStrictEqual(parsed, expected);
    // And the hostile strings really did survive the round trip unmangled.
    const n1 = parsed.nodes.find(n => n.id === 'n1');
    assert.ok(n1.description.includes('</script>'));
    assert.ok(n1.description.includes(LS));
    assert.ok(n1.description.includes(PS));
  });

  test('U+2028 and U+2029 in the embedded script text are escaped, not literal', async () => {
    const html = await renderMap(hostileDoc());
    const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(scriptMatch);
    assert.ok(!scriptMatch[1].includes(LS), 'a literal U+2028 must not appear inside the inline script');
    assert.ok(!scriptMatch[1].includes(PS), 'a literal U+2029 must not appear inside the inline script');
  });
});

describe('viewer script: no banned DOM sinks, static check', () => {
  test('the viewer script source contains none of innerHTML, outerHTML, insertAdjacentHTML, document.write, eval', () => {
    const src = script({ x: 0, y: 0, width: 100, height: 100 }, { nodes: [], edges: [] }, EMPTY_GEOMETRY);
    // Strip `//` line comments first: the surrounding source documents
    // this very rule in prose (naming the banned sinks so a future editor
    // knows why they are absent), which would otherwise false-positive
    // against a naive substring search of the raw source.
    const code = src
      .split('\n')
      .map(line => line.replace(/\/\/.*$/, ''))
      .join('\n');
    const banned = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval('];
    const found = banned.filter(sink => code.includes(sink));
    assert.deepStrictEqual(found, [], `viewer script must not use: ${found.join(', ')}`);
  });

  test('no edge-stub markers remain: the stub feature was removed in favour of hiding the whole edge', () => {
    const src = script({ x: 0, y: 0, width: 100, height: 100 }, { nodes: [], edges: [] }, EMPTY_GEOMETRY);
    assert.ok(!src.includes('edge-stub'));
    assert.ok(!src.includes('show-stub-start'));
    assert.ok(!src.includes('show-stub-end'));
  });
});
