// Fragment render mode: renderMap(doc, { fragment: true }) — the artifact
// output shape used when a host (Claude's artifact publisher) supplies its
// own page skeleton. See docs/design/skills-and-plugin.md's artifact output
// rule and docs/design/git-map.md section 4.
//
// Full-document output (renderMap(doc), no opts) must stay byte-identical —
// that is tests/n8n-render-golden.test.js's job, not this file's.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { renderMap } = require('../src/n8n/index');

const FIXTURE = path.join(__dirname, '..', 'examples', 'medusa-return-flow.json');

async function loadFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

test('fragment output has no <!DOCTYPE>, <html>, <head> or <body>', async () => {
  const doc = await loadFixture();
  const frag = await renderMap(doc, { fragment: true });
  assert.doesNotMatch(frag, /<!DOCTYPE/i);
  assert.doesNotMatch(frag, /<html[\s>]/i);
  assert.doesNotMatch(frag, /<head[\s>]/i);
  assert.doesNotMatch(frag, /<body[\s>]/i);
});

test('fragment output has exactly one <title> and one <script>', async () => {
  const doc = await loadFixture();
  const frag = await renderMap(doc, { fragment: true });
  assert.strictEqual((frag.match(/<title[\s>]/g) || []).length, 1);
  assert.strictEqual((frag.match(/<script[\s>]/g) || []).length, 1);
  assert.strictEqual((frag.match(/<\/script>/g) || []).length, 1);
});

test('fragment output starts with <title> then <style>, in that order', async () => {
  const doc = await loadFixture();
  const frag = await renderMap(doc, { fragment: true });
  const titleIdx = frag.indexOf('<title>');
  const styleIdx = frag.indexOf('<style>');
  assert.strictEqual(titleIdx, 0, 'fragment must start with <title>');
  assert.ok(styleIdx > titleIdx, '<style> must come after <title>');
});

test('fragment sets an explicit background on the map root (#stage)', async () => {
  const doc = await loadFixture();
  const frag = await renderMap(doc, { fragment: true });
  const style = frag.slice(frag.indexOf('<style>'), frag.indexOf('</style>'));
  assert.match(style, /#stage\{background:/);
});

test('fragment makes no external requests: no <link>, <iframe>, or remote script/img src', async () => {
  const doc = await loadFixture();
  const frag = await renderMap(doc, { fragment: true });
  assert.doesNotMatch(frag, /<link\b/i);
  assert.doesNotMatch(frag, /<iframe\b/i);
  assert.doesNotMatch(frag, /\bsrc=["']https?:/i);
  // A note's own link is the one legitimate exception (sticky notes render
  // their href as underlined text/an anchor same as the full page) — but it
  // must never point off the page except as a plain http(s) href, never as
  // a script-bearing or same-origin-breaking scheme.
  const hrefs = [...frag.matchAll(/\bhref="([^"]*)"/gi)].map(m => m[1]);
  hrefs.forEach(href => assert.match(href, /^https?:\/\//i));
});

test('fragment is otherwise equivalent to the full page\'s body content', async () => {
  const doc = await loadFixture();
  const full = await renderMap(doc);
  const frag = await renderMap(doc, { fragment: true });

  const bodyStart = full.indexOf('<body>') + '<body>'.length;
  const bodyEnd = full.indexOf('</body>');
  const fullBody = full.slice(bodyStart, bodyEnd).trim();

  // The fragment is <title>...</title>\n<style>...</style>\n<body-content>.
  const fragStyleEnd = frag.indexOf('</style>') + '</style>'.length;
  const fragBody = frag.slice(fragStyleEnd).trim();

  // One deliberate difference: correction mode's save step offers a copy
  // first in an artifact host, where a download may not reach a
  // filesystem (docs/design/correction-mode.md, "In an artifact host").
  // The flag that selects it is the only thing that may differ.
  assert.strictEqual(
    fragBody.replace('var FRAGMENT_MODE = true;', 'var FRAGMENT_MODE = false;'),
    fullBody
  );
  assert.ok(fragBody.includes('var FRAGMENT_MODE = true;'), 'the fragment is in fragment mode');
  assert.ok(fullBody.includes('var FRAGMENT_MODE = false;'), 'the full page is not');

  // And the <style> content matches too, apart from the one extra
  // #stage{background:...} rule the fragment appends.
  const fullStyle = full.slice(full.indexOf('<style>') + '<style>'.length, full.indexOf('</style>'));
  const fragStyle = frag.slice(frag.indexOf('<style>') + '<style>'.length, frag.indexOf('</style>'));
  assert.strictEqual(fragStyle, fullStyle + '#stage{background:#f5f5f5}\n');
});

test('fragment works at phone width: no hardcoded desktop-only min-width in the stylesheet', async () => {
  const doc = await loadFixture();
  const frag = await renderMap(doc, { fragment: true });
  const style = frag.slice(frag.indexOf('<style>'), frag.indexOf('</style>'));
  assert.doesNotMatch(style, /min-width:\s*[5-9]\d{2,}px/);
});

test('full-document renderMap(doc) with no opts is unaffected by fragment mode existing', async () => {
  const doc = await loadFixture();
  const full = await renderMap(doc);
  assert.ok(full.startsWith('<!DOCTYPE html>'));
  assert.match(full, /<html lang="en" data-theme="light">/);
  assert.match(full, /<body>/);
});
