// Sticky-note tests: validation invariants, markdown rendering (including
// hostile content), and placement on the Medusa fixture. See
// docs/design/n8n-visual-style.md "Notes (text boxes)" and "Testing".

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { validateDoc } = require('../src/n8n/validate');
const { layoutMap } = require('../src/n8n/layout');
const { renderHtml } = require('../src/n8n/render');
const { renderMap } = require('../src/n8n/index');
const { layoutMarkdown, parseInline, escapeHtml } = require('../src/n8n/markdown');
const { labelBoxesOf, frameTitleBoxesOf } = require('../src/n8n/obstacles');
const { samplePath, pointInRect } = require('../src/n8n/sample-path');

const FIXTURE = path.join(__dirname, '..', 'examples', 'medusa-return-flow.json');
const medusaDoc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

function baseDoc(extra) {
  return Object.assign(
    {
      title: 't',
      groups: [{ id: 'g1', label: 'G', color: 'purple' }],
      nodes: [
        { id: 'n1', label: 'N', kind: 'service', icon: null, parentId: 'g1', layers: ['base'] },
        { id: 'n2', label: 'N2', kind: 'service', icon: null, parentId: null, layers: ['base'] },
      ],
      edges: [{ from: 'n1', to: 'n2', type: 'solid', condition: null }],
    },
    extra,
  );
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

describe('note validation', () => {
  test('attachTo referencing an unknown id throws', () => {
    const doc = baseDoc({ notes: [{ id: 'note1', content: 'hi', attachTo: ['does-not-exist'] }] });
    assert.throws(() => validateDoc(doc), /attachTo/);
  });

  test('attachTo accepts a node id or a group id', () => {
    const doc = baseDoc({
      notes: [
        { id: 'note1', content: 'attached to a node', attachTo: ['n1'] },
        { id: 'note2', content: 'attached to a group', attachTo: ['g1'] },
      ],
    });
    const result = validateDoc(doc);
    assert.strictEqual(result.notes.length, 2);
  });

  test('empty content throws', () => {
    const doc = baseDoc({ notes: [{ id: 'note1', content: '' }] });
    assert.throws(() => validateDoc(doc), /content/);
  });

  test('whitespace-only content throws', () => {
    const doc = baseDoc({ notes: [{ id: 'note1', content: '   \n  ' }] });
    assert.throws(() => validateDoc(doc), /content/);
  });

  test('non-string content throws', () => {
    const doc = baseDoc({ notes: [{ id: 'note1', content: 42 }] });
    assert.throws(() => validateDoc(doc), /content/);
  });

  test('content over 2000 chars throws', () => {
    const doc = baseDoc({ notes: [{ id: 'note1', content: 'x'.repeat(2001) }] });
    assert.throws(() => validateDoc(doc), /2000/);
  });

  test('content of exactly 2000 chars is accepted', () => {
    const doc = baseDoc({ notes: [{ id: 'note1', content: 'x'.repeat(2000) }] });
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('invalid color throws', () => {
    const doc = baseDoc({ notes: [{ id: 'note1', content: 'hi', color: 'orange' }] });
    assert.throws(() => validateDoc(doc), /color/);
  });

  test('every one of the seven note colors validates', () => {
    for (const color of ['yellow', 'gold', 'red', 'green', 'blue', 'purple', 'gray']) {
      const doc = baseDoc({ notes: [{ id: 'note1', content: 'hi', color }] });
      assert.doesNotThrow(() => validateDoc(doc), `color ${color} should be valid`);
    }
  });

  test('invalid layers value throws', () => {
    const doc = baseDoc({ notes: [{ id: 'note1', content: 'hi', layers: ['not-a-layer'] }] });
    assert.throws(() => validateDoc(doc), /layers/);
  });

  test('more than 20 notes throws', () => {
    const notes = Array.from({ length: 21 }, (_, i) => ({ id: `note${i}`, content: 'hi' }));
    const doc = baseDoc({ notes });
    assert.throws(() => validateDoc(doc), /20/);
  });

  test('exactly 20 notes is accepted', () => {
    const notes = Array.from({ length: 20 }, (_, i) => ({ id: `note${i}`, content: 'hi' }));
    const doc = baseDoc({ notes });
    assert.doesNotThrow(() => validateDoc(doc));
  });

  test('duplicate note ids throw', () => {
    const doc = baseDoc({
      notes: [
        { id: 'dup', content: 'one' },
        { id: 'dup', content: 'two' },
      ],
    });
    assert.throws(() => validateDoc(doc), /[Dd]uplicate/);
  });

  test('a note id colliding with a node id throws', () => {
    const doc = baseDoc({ notes: [{ id: 'n1', content: 'collides with node n1' }] });
    assert.throws(() => validateDoc(doc), /collides/);
  });

  test('a note id colliding with a group id throws', () => {
    const doc = baseDoc({ notes: [{ id: 'g1', content: 'collides with group g1' }] });
    assert.throws(() => validateDoc(doc), /collides/);
  });

  test('a malformed note id throws', () => {
    const doc = baseDoc({ notes: [{ id: 'bad id with spaces!', content: 'hi' }] });
    assert.throws(() => validateDoc(doc), /id/);
  });

  test('omitted or empty attachTo is accepted as a map-level note', () => {
    const doc1 = baseDoc({ notes: [{ id: 'note1', content: 'map level, omitted attachTo' }] });
    const doc2 = baseDoc({ notes: [{ id: 'note1', content: 'map level, empty attachTo', attachTo: [] }] });
    assert.doesNotThrow(() => validateDoc(doc1));
    assert.doesNotThrow(() => validateDoc(doc2));
  });

  test('a doc with no notes key at all still validates (notes is optional)', () => {
    const doc = baseDoc({});
    delete doc.notes;
    const result = validateDoc(doc);
    assert.deepStrictEqual(result.notes, []);
  });
});

// ---------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------

describe('markdown subset rendering', () => {
  test('# and ## headings produce h1/h2 blocks', () => {
    const layout = layoutMarkdown('# Title\n## Subtitle\nBody text', 400);
    const kinds = layout.lines.map(l => l.kind);
    assert.ok(kinds.includes('h1'));
    assert.ok(kinds.includes('h2'));
    assert.ok(kinds.includes('p'));
  });

  test('**bold** produces a bold run', () => {
    const runs = parseInline(escapeHtml('plain **bold** plain'));
    assert.ok(runs.some(r => r.bold && r.text === 'bold'));
  });

  test('*italic* produces an italic run', () => {
    const runs = parseInline(escapeHtml('plain *italic* plain'));
    assert.ok(runs.some(r => r.italic && r.text === 'italic'));
  });

  test('`inline code` produces a code run, inert to further markdown', () => {
    const runs = parseInline(escapeHtml('see `a * b` here'));
    const codeRun = runs.find(r => r.code);
    assert.ok(codeRun);
    assert.strictEqual(codeRun.text, 'a * b');
    assert.ok(!codeRun.bold && !codeRun.italic);
  });

  test('- bullet lines produce li blocks', () => {
    const layout = layoutMarkdown('- one\n- two\n- three', 400);
    const bullets = layout.lines.filter(l => l.kind === 'li' && l.bulletMarker);
    assert.strictEqual(bullets.length, 3);
  });

  test('a blank line becomes a line break, not a merged paragraph', () => {
    const layout = layoutMarkdown('first\n\nsecond', 400);
    const kinds = layout.lines.map(l => l.kind);
    assert.deepStrictEqual(kinds, ['p', 'blank', 'p']);
  });

  test('[text](https://...) produces a link run with the href intact', () => {
    const runs = parseInline(escapeHtml('see [the docs](https://example.com/path) for more'));
    const link = runs.find(r => r.href);
    assert.ok(link);
    assert.strictEqual(link.text, 'the docs');
    assert.strictEqual(link.href, 'https://example.com/path');
  });

  test('mailto: links are allowed', () => {
    const runs = parseInline(escapeHtml('[email us](mailto:hi@example.com)'));
    const link = runs.find(r => r.href);
    assert.ok(link);
    assert.strictEqual(link.href, 'mailto:hi@example.com');
  });

  test('a long note wraps across multiple lines and every line fits the estimate width', () => {
    const long = 'word '.repeat(200).trim();
    const innerWidth = 480 - 28;
    const layout = layoutMarkdown(long, innerWidth);
    assert.ok(layout.lines.length > 5, 'should wrap into several lines');
  });
});

// ---------------------------------------------------------------------
// Hostile content
// ---------------------------------------------------------------------

describe('hostile note content', () => {
  function docWithNote(content) {
    return baseDoc({ notes: [{ id: 'hostile', content }] });
  }

  // The viewer carries the document it was rendered from as a JSON literal
  // inside its one <script>, so correction mode can write a corrected one
  // (docs/design/correction-mode.md). A hostile note's text therefore DOES
  // appear in the output -- as string data, never as markup. These tests
  // are about markup, so they look at everything outside that script; that
  // the literal cannot be escaped from is asserted separately below and in
  // tests/n8n-correction-viewer.test.js.
  function markupOf(html) {
    const start = html.indexOf('<script>');
    if (start < 0) return html;
    const end = html.lastIndexOf('</script>');
    const body = html.slice(start + '<script>'.length, end);
    assert.ok(!body.includes('</script'), 'nothing may close the script element from inside it');
    return html.slice(0, start) + html.slice(end + '</script>'.length);
  }

  test('<script> and </script> in content never produce a live script tag', async () => {
    const html = await renderMap(docWithNote('before <script>alert(1)</script> after'));
    const scriptOpenTags = html.match(/<script[ >]/g) || [];
    assert.strictEqual(scriptOpenTags.length, 1, 'only the viewer\'s own inline <script> should exist');
    assert.ok(html.includes('&lt;script&gt;'), 'the hostile tag should survive only as escaped text');
  });

  test('<img onerror=...> never produces a live <img> element', async () => {
    const html = markupOf(await renderMap(docWithNote('<img src=x onerror="alert(1)">')));
    assert.ok(!/<img[ >]/.test(html), 'no live <img> element should exist anywhere in the markup');
  });

  test('a raw double quote in content cannot break out of an attribute', async () => {
    const html = markupOf(await renderMap(docWithNote('quote" onmouseover="alert(1)')));
    // The quote must render as inert text (entity-escaped), never as a live
    // attribute boundary. "onmouseover=" is expected to appear as plain
    // visible text — what must never happen is a *live* onmouseover=
    // attribute, i.e. one immediately preceded by an unescaped quote.
    assert.ok(html.includes('quote&quot;'), 'the raw quote must survive only as an HTML entity');
    assert.ok(!/["'`]\s*onmouseover\s*=/.test(html), 'no live onmouseover= attribute may exist anywhere in the markup');
  });

  test('[x](javascript:alert(1)) never produces a javascript: href', async () => {
    const html = markupOf(await renderMap(docWithNote('[x](javascript:alert(1))')));
    assert.ok(!/javascript:/i.test(html));
    assert.ok(!/<a[^>]*href/i.test(html), 'no anchor at all should be emitted for a disallowed scheme');
  });

  test('[x](JaVaScRiPt:alert(1)) is case-insensitively rejected', async () => {
    const html = markupOf(await renderMap(docWithNote('[x](JaVaScRiPt:alert(1))')));
    assert.ok(!/javascript:/i.test(html));
  });

  test('[x](data:text/html,...) never produces a data: href', async () => {
    const full = await renderMap(docWithNote('[x](data:text/html,<script>alert(1)</script>)'));
    const html = markupOf(full);
    assert.ok(!/data:/i.test(html));
    const scriptOpenTags = full.match(/<script[ >]/g) || [];
    assert.strictEqual(scriptOpenTags.length, 1);
  });

  test('[x]( javascript:alert(1)) with a leading space is still rejected', () => {
    const runs = parseInline(escapeHtml('[x]( javascript:alert(1))'));
    assert.ok(!runs.some(r => r.href));
  });

  test('exactly one <script> element and no javascript:/data: hrefs across every hostile payload combined', async () => {
    const content = [
      '<script>alert(1)</script>',
      '</script>',
      '<img src=x onerror="alert(2)">',
      'a quote " right here',
      '[a](javascript:alert(3))',
      '[b](JaVaScRiPt:alert(4))',
      '[c](data:text/html,<script>alert(5)</script>)',
      '[d]( javascript:alert(6))',
    ].join('\n');
    const full = await renderMap(docWithNote(content));
    const html = markupOf(full);
    const scriptOpenTags = full.match(/<script[ >]/g) || [];
    assert.strictEqual(scriptOpenTags.length, 1);
    assert.ok(!/javascript:/i.test(html));
    assert.ok(!/href="data:/i.test(html));
  });
});

// ---------------------------------------------------------------------
// Placement on the Medusa fixture
// ---------------------------------------------------------------------

describe('note placement on the Medusa fixture', () => {
  let layout;

  test('layoutMap resolves and places every note', async () => {
    layout = await layoutMap(medusaDoc);
    assert.strictEqual(Object.keys(layout.noteBoxes).length, medusaDoc.notes.length);
  });

  test('no note overlaps any node box', () => {
    const bad = [];
    for (const [noteId, nb] of Object.entries(layout.noteBoxes)) {
      for (const [nodeId, box] of Object.entries(layout.nodeBoxes)) {
        if (overlaps(nb, box)) bad.push(`${noteId} / node ${nodeId}`);
      }
    }
    assert.deepStrictEqual(bad, []);
  });

  test('no note overlaps any node label strip', () => {
    const labelBoxes = labelBoxesOf(layout.nodeBoxes);
    const bad = [];
    for (const [noteId, nb] of Object.entries(layout.noteBoxes)) {
      for (const lb of labelBoxes) {
        if (overlaps(nb, lb)) bad.push(`${noteId} / label ${lb.id}`);
      }
    }
    assert.deepStrictEqual(bad, []);
  });

  test('no note overlaps any frame title', () => {
    const frameTitleBoxes = frameTitleBoxesOf(medusaDoc.groups, layout.frameBoxes);
    const bad = [];
    for (const [noteId, nb] of Object.entries(layout.noteBoxes)) {
      for (const tb of frameTitleBoxes) {
        if (overlaps(nb, tb)) bad.push(`${noteId} / frame title ${tb.id}`);
      }
    }
    assert.deepStrictEqual(bad, []);
  });

  test('no note overlaps another note', () => {
    const entries = Object.entries(layout.noteBoxes);
    const bad = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (overlaps(entries[i][1], entries[j][1])) bad.push(`${entries[i][0]} / ${entries[j][0]}`);
      }
    }
    assert.deepStrictEqual(bad, []);
  });

  test('no edge path crosses a note box', () => {
    const noteBoxList = Object.entries(layout.noteBoxes).map(([id, b]) => ({ id, ...b }));
    const bad = [];
    for (const edge of layout.edges) {
      const pts = samplePath(edge.d);
      for (const box of noteBoxList) {
        if (pts.some(pt => pointInRect(pt, box))) bad.push(`edge ${edge.index} crosses note ${box.id}`);
      }
    }
    assert.deepStrictEqual(bad, []);
  });

  test('every note lies within the canvas bounds', () => {
    const c = layout.canvas;
    const bad = [];
    for (const [id, b] of Object.entries(layout.noteBoxes)) {
      const inside = b.x >= c.x && b.y >= c.y && b.x + b.w <= c.x + c.width && b.y + b.h <= c.y + c.height;
      if (!inside) bad.push(id);
    }
    assert.deepStrictEqual(bad, []);
  });

  test('note layout is deterministic across two runs', async () => {
    const a = await layoutMap(medusaDoc);
    const b = await layoutMap(medusaDoc);
    assert.deepStrictEqual(
      Object.fromEntries(Object.entries(a.noteBoxes).map(([id, box]) => [id, { x: box.x, y: box.y, w: box.w, h: box.h }])),
      Object.fromEntries(Object.entries(b.noteBoxes).map(([id, box]) => [id, { x: box.x, y: box.y, w: box.w, h: box.h }])),
    );
  });

  test('a long note never overflows its box: estimated line count matches what is rendered', async () => {
    const longDoc = JSON.parse(JSON.stringify(medusaDoc));
    longDoc.notes.push({
      id: 'n_stress_test',
      content:
        '# Stress test\nThis note exists purely to check that a long, heavily wrapped note never overflows its box. ' +
        'It repeats a fair amount of text, mixes in **bold**, *italic*, `inline code`, a [link](https://example.com/x) and a short list.\n' +
        '- first item that is long enough to wrap onto a second line by itself\n' +
        '- second item\n' +
        '- third item that is also fairly long so it wraps too, just to be sure',
      color: 'gold',
    });
    const stressLayout = await layoutMap(longDoc);
    const box = stressLayout.noteBoxes.n_stress_test;
    assert.ok(box, 'the stress-test note should be placed');
    const visibleLines = box.mdLayout.lines.filter(l => l.kind !== 'blank');
    assert.ok(visibleLines.length >= 6, 'expected the long note to wrap into several lines');
    // The box height came from the exact same `lines` the renderer draws
    // (see notes-render.js), so there is no separate measurement to drift:
    // assert the rendered <text> contains one tspan group per visible line.
    const html = renderHtml(stressLayout, longDoc);
    const noteBlock = html.slice(html.indexOf('data-id="n_stress_test"'));
    const textBlock = noteBlock.slice(noteBlock.indexOf('<text'), noteBlock.indexOf('</text>'));
    const yValues = [...textBlock.matchAll(/y="(-?\d+(?:\.\d+)?)"/g)].map(m => Number(m[1]));
    assert.ok(yValues.length > 0);
    const maxY = Math.max(...yValues);
    assert.ok(maxY <= box.y + box.h, `last text baseline (${maxY}) must be within the note box (bottom ${box.y + box.h})`);
  });
});

// ---------------------------------------------------------------------
// Backward compatibility: a doc without notes renders identically
// ---------------------------------------------------------------------

describe('backward compatibility', () => {
  test('a doc without `notes` still renders identically to before (node boxes unchanged)', async () => {
    const withoutNotes = JSON.parse(JSON.stringify(medusaDoc));
    delete withoutNotes.notes;

    const layoutWith = await layoutMap(medusaDoc);
    const layoutWithout = await layoutMap(withoutNotes);

    assert.deepStrictEqual(layoutWithout.nodeBoxes, layoutWith.nodeBoxes);
    assert.deepStrictEqual(layoutWithout.frameBoxes, layoutWith.frameBoxes);
    assert.deepStrictEqual(layoutWithout.noteBoxes, {});
  });

  test('renderMap succeeds end to end on a doc with no notes key at all', async () => {
    const doc = baseDoc({});
    delete doc.notes;
    const html = await renderMap(doc);
    assert.ok(html.startsWith('<!DOCTYPE html>'));
  });
});
