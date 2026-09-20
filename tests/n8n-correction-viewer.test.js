// The rendered viewer's correction mode (docs/design/correction-mode.md,
// build step 7a, part 2). Behaviour that needs a DOM is exercised in a
// browser; what is asserted here is what the engine emits: the embedded
// source document, the operations module the viewer runs, the controls,
// and the security properties of both.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { renderHtml } = require('../src/n8n/render');
const { layoutMap } = require('../src/n8n/layout');
const { validateDoc } = require('../src/n8n/validate');
const { VIEWER_FUNCTIONS, VIEWER_CONSTANTS } = require('../src/n8n/correct-ops');

const ROOT = path.resolve(__dirname, '..');
const MEDUSA = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/medusa-return-flow.json'), 'utf8'));

async function render(doc, opts) {
  const normalized = validateDoc(doc);
  const layout = await layoutMap(normalized);
  return renderHtml(layout, normalized, opts);
}

function scriptOf(html) {
  return html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
}

function sourceDocOf(html) {
  const m = /var SOURCE_DOC = (\{[\s\S]*?\});\n  var FRAGMENT_MODE/.exec(html);
  assert.ok(m, 'expected an embedded SOURCE_DOC literal');
  return JSON.parse(m[1]);
}

describe('the viewer carries the document it was rendered from', () => {
  test('SOURCE_DOC round-trips to the validated document', async () => {
    const html = await render(MEDUSA);
    assert.deepStrictEqual(sourceDocOf(html), validateDoc(MEDUSA));
  });

  test('it carries what the card data drops', async () => {
    const html = await render(MEDUSA);
    const doc = sourceDocOf(html);
    const withIcon = doc.nodes.find(n => n.icon);
    assert.ok(withIcon, 'icons survive');
    assert.ok(doc.groups.every(g => g.id), 'group ids survive');
    assert.ok((doc.notes || []).every(n => typeof n.content === 'string'), 'note bodies survive');
    assert.strictEqual(doc.title, MEDUSA.title);
  });

  test('a hostile title cannot break out of the literal or the script', async () => {
    const doc = JSON.parse(JSON.stringify(MEDUSA));
    doc.title = 'Ends here </script><script>alert(1)</script> and   too';
    const html = await render(doc);
    assert.strictEqual((html.match(/<script/g) || []).length, 1);
    assert.strictEqual(sourceDocOf(html).title, doc.title);
    assert.ok(!scriptOf(html).includes('</script'), 'no closing script tag inside the script');
  });
});

describe('the viewer runs the operations module itself', () => {
  test('every exported function reaches the script, source and all', async () => {
    const script = scriptOf(await render(MEDUSA));
    VIEWER_FUNCTIONS.forEach(fn => {
      assert.ok(script.includes(fn.toString()), `expected ${fn.name} in the viewer script`);
    });
  });

  test('every constant reaches it as JSON', async () => {
    const script = scriptOf(await render(MEDUSA));
    Object.keys(VIEWER_CONSTANTS).forEach(name => {
      assert.ok(
        script.includes(`var ${name} = ${JSON.stringify(VIEWER_CONSTANTS[name])};`),
        `expected ${name} in the viewer script`
      );
    });
  });

  test('the emitted script parses as a program', async () => {
    const vm = require('node:vm');
    const script = scriptOf(await render(MEDUSA));
    assert.doesNotThrow(() => new vm.Script(script));
  });

  test('nothing Node-only leaks into the browser copy', async () => {
    // Matched as calls and assignments, not as words: the viewer's own
    // comments discuss require() and module.exports, and a comment cannot
    // execute.
    const script = scriptOf(await render(MEDUSA));
    assert.ok(!/\brequire\s*\(\s*['"]/.test(script), 'no require("...") call');
    assert.ok(!/\bmodule\.exports\s*=/.test(script), 'no module.exports assignment');
    assert.ok(!/\bprocess\.(env|argv|exit)\b/.test(script), 'no process access');
  });
});

describe('the controls are there, and nothing else changed', () => {
  test('the Correct button and the panel are rendered once each', async () => {
    const html = await render(MEDUSA);
    assert.strictEqual((html.match(/id="correct-toggle"/g) || []).length, 1);
    assert.strictEqual((html.match(/id="correct-panel"/g) || []).length, 1);
    assert.match(html, /aria-pressed="false"/);
  });

  test('the layer bar, zoom bar and details card are untouched', async () => {
    const html = await render(MEDUSA);
    assert.match(html, /class="layer-bar"/);
    assert.match(html, /id="zoom-fit"/);
    assert.match(html, /id="details-card"/);
  });

  test('the fragment render carries correction mode too, in copy-first form', async () => {
    const html = await render(MEDUSA, { fragment: true });
    assert.match(html, /id="correct-toggle"/);
    assert.match(scriptOf(html), /var FRAGMENT_MODE = true;/);
    assert.ok(!html.includes('<!DOCTYPE html>'), 'still a fragment');
  });

  test('a full render is not in fragment mode', async () => {
    const html = await render(MEDUSA);
    assert.match(scriptOf(html), /var FRAGMENT_MODE = false;/);
  });
});

describe('correction mode writes no markup by string concatenation', () => {
  test('the viewer script never assigns innerHTML or outerHTML', async () => {
    // Card and panel text comes from untrusted input, so every value
    // reaches the DOM through textContent or a validated attribute. The
    // assertions match assignments and calls, since the script's own
    // comments name these APIs to say it does not use them.
    const script = scriptOf(await render(MEDUSA));
    assert.ok(!/\.innerHTML\s*=/.test(script), 'no innerHTML assignment');
    assert.ok(!/\.outerHTML\s*=/.test(script), 'no outerHTML assignment');
    assert.ok(!/insertAdjacentHTML\s*\(/.test(script), 'no insertAdjacentHTML');
    assert.ok(!/document\.write\s*\(/.test(script), 'no document.write');
    assert.ok(!/\beval\s*\(/.test(script), 'no eval');
  });

  test('a download is offered as a blob, and its object URL is released', async () => {
    const script = scriptOf(await render(MEDUSA));
    assert.match(script, /new Blob\(/);
    assert.match(script, /URL\.revokeObjectURL/);
  });
});

describe('the cost of carrying the document', () => {
  test('the Medusa render stays within a sensible size', async () => {
    const html = await render(MEDUSA);
    const kb = Buffer.byteLength(html) / 1024;
    assert.ok(kb < 320, `expected the Medusa render under 320kb, got ${Math.round(kb)}kb`);
  });
});
