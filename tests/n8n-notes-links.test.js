// Sticky-note links: spacing around links, and link URLs that are allowed but
// narrowed for untrusted content (security review follow-ups).

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { parseInline, wrapRuns } = require('../src/n8n/markdown');
const { renderMap } = require('../src/n8n/index');

const WIDE = 200;

function lineRuns(markdown) {
  const lines = wrapRuns(parseInline(markdown), WIDE);
  assert.strictEqual(lines.length, 1, 'fixture should fit on one line');
  return lines[0];
}

function visibleText(runs) {
  return runs.map(r => r.text).join('');
}

function docWithNote(content) {
  return {
    title: 'Links',
    groups: [],
    nodes: [
      { id: 'a', label: 'A', kind: 'service' },
      { id: 'b', label: 'B', kind: 'service' },
    ],
    edges: [{ from: 'a', to: 'b', type: 'solid' }],
    notes: [{ id: 'n1', content }],
  };
}

describe('spacing around styled runs', () => {
  test('a style boundary keeps the space between words ("cap halts")', () => {
    assert.strictEqual(visibleText(lineRuns('Refund **cap** halts the flow')), 'Refund cap halts the flow');
  });

  test('the space before a link is outside the link', () => {
    const runs = lineRuns('See the [return docs](https://docs.example.com/) for more');
    const link = runs.find(r => r.href);
    assert.strictEqual(link.text, 'return docs');
    assert.strictEqual(visibleText(runs), 'See the return docs for more');
  });

  test('two adjacent links keep a space between them that belongs to neither', () => {
    const runs = lineRuns('[one](https://a.example/) [two](https://b.example/)');
    const links = runs.filter(r => r.href);
    assert.deepStrictEqual(links.map(l => l.text), ['one', 'two']);
    assert.strictEqual(visibleText(runs), 'one two');
  });

  test('rendered link markup contains no leading or trailing whitespace', async () => {
    const html = await renderMap(docWithNote('See the [docs](https://docs.example.com/) now'));
    const anchor = html.match(/<a href="https:\/\/docs\.example\.com\/"[^>]*>(.*?)<\/a>/);
    assert.ok(anchor, 'link rendered');
    assert.match(anchor[1], /<tspan[^>]*>docs<\/tspan>/);
  });
});

describe('link URL narrowing', () => {
  test('mailto links drop query parameters such as cc and bcc', () => {
    const [link] = parseInline('[mail](mailto:owner@example.com?cc=x@evil.example&amp;bcc=y@evil.example)');
    assert.strictEqual(link.href, 'mailto:owner@example.com');
  });

  test('https links keep their query string', () => {
    const [link] = parseInline('[q](https://example.com/search?q=a&amp;b=c)');
    assert.strictEqual(link.href, 'https://example.com/search?q=a&amp;b=c');
  });

  test('a URL containing a quote renders as plain text', () => {
    const runs = parseInline('[b](https://ok.example/&quot; onmouseover=&quot;x)');
    assert.ok(runs.every(r => !r.href));
  });

  test('a URL containing whitespace renders as plain text', () => {
    const runs = parseInline('[b](https://ok.example/a b)');
    assert.ok(runs.every(r => !r.href));
  });

  test('a URL containing an escaped angle bracket renders as plain text', () => {
    const runs = parseInline('[b](https://ok.example/&lt;x&gt;)');
    assert.ok(runs.every(r => !r.href));
  });
});
