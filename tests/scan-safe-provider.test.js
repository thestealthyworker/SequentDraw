// SafeProvider: the sole filesystem gateway @specfy/stack-analyser (and
// SequentDraw's own custom parsers) are given. Every guard here is
// safety-critical, so each is tested in isolation against a small,
// purpose-built temp directory (not the full hostile fixture, which is
// covered end-to-end in scan-hostile.test.js).

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SafeProvider, classifyEnvFile, stripEnvValues } = require('../src/scan/safe-provider');

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-provider-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('classifyEnvFile / stripEnvValues', () => {
  test('classifies real vs safe-example env filenames', () => {
    assert.strictEqual(classifyEnvFile('.env'), 'real');
    assert.strictEqual(classifyEnvFile('.env.local'), 'real');
    assert.strictEqual(classifyEnvFile('.env.production'), 'real');
    assert.strictEqual(classifyEnvFile('.env.example'), 'safe-example');
    assert.strictEqual(classifyEnvFile('.env.sample'), 'safe-example');
    assert.strictEqual(classifyEnvFile('.env.template'), 'safe-example');
    assert.strictEqual(classifyEnvFile('other.txt'), null);
  });

  test('strips values, keeping only NAME=, including export and quoted forms', () => {
    const input = [
      'FOO=bar',
      'export BAR=baz # a comment',
      'QUOTED="has spaces"',
      "SINGLE='also quoted'",
      '# a full-line comment',
      'NO_EQUALS_HERE',
    ].join('\n');
    const out = stripEnvValues(input);
    assert.strictEqual(out.includes('bar'), false);
    assert.strictEqual(out.includes('baz'), false);
    assert.strictEqual(out.includes('has spaces'), false);
    assert.strictEqual(out.includes('also quoted'), false);
    assert.ok(out.includes('FOO='));
    assert.ok(out.includes('export BAR='));
    assert.ok(out.includes('QUOTED='));
    assert.ok(out.includes('SINGLE='));
  });
});

describe('SafeProvider: confinement', () => {
  test('listDir/open/stat refuse a path outside basePath', async () => {
    await withTempDir(async outer => {
      const base = path.join(outer, 'repo');
      fs.mkdirSync(base);
      fs.writeFileSync(path.join(outer, 'secret.txt'), 'nope');
      const provider = new SafeProvider({ path: base });

      assert.deepStrictEqual(await provider.listDir(path.join(outer, 'secret.txt')), []);
      assert.strictEqual(await provider.open(path.join(outer, 'secret.txt')), null);
      assert.strictEqual(await provider.stat(path.join(outer, 'secret.txt')), null);
      assert.deepStrictEqual(await provider.listDir(path.join(base, '..')), []);
    });
  });

  test('never follows a symlinked file or directory', async () => {
    await withTempDir(async outer => {
      const base = path.join(outer, 'repo');
      fs.mkdirSync(base);
      fs.writeFileSync(path.join(outer, 'outside.txt'), 'outside content');
      fs.symlinkSync(path.join(outer, 'outside.txt'), path.join(base, 'link.txt'), 'file');
      fs.mkdirSync(path.join(outer, 'outside-dir'));
      fs.symlinkSync(path.join(outer, 'outside-dir'), path.join(base, 'link-dir'), 'dir');

      const provider = new SafeProvider({ path: base });
      const entries = await provider.listDir(base);
      assert.deepStrictEqual(entries, []); // both symlink entries are filtered out at listing time
      assert.strictEqual(await provider.open(path.join(base, 'link.txt')), null);
      assert.strictEqual(await provider.stat(path.join(base, 'link.txt')), null);
    });
  });

  test('a symlink loop does not hang or error', async () => {
    await withTempDir(async base => {
      const loop = path.join(base, 'loop');
      fs.mkdirSync(loop);
      fs.symlinkSync(loop, path.join(loop, 'self'), 'dir');
      const provider = new SafeProvider({ path: base });
      const entries = await provider.listDir(loop);
      assert.deepStrictEqual(entries, []);
    });
  });
});

describe('SafeProvider: skip rules', () => {
  test('skips well-known noise directories entirely', async () => {
    await withTempDir(async base => {
      for (const dir of ['node_modules', 'vendor', 'dist', 'build', '.git', '.next', 'target', 'coverage', '.venv', '__pycache__']) {
        fs.mkdirSync(path.join(base, dir));
        fs.writeFileSync(path.join(base, dir, 'x.txt'), 'x');
      }
      fs.writeFileSync(path.join(base, 'real.txt'), 'real');
      const provider = new SafeProvider({ path: base });
      const entries = await provider.listDir(base);
      assert.deepStrictEqual(entries.map(e => e.name).sort(), ['real.txt']);
    });
  });

  test('skips *.min.js / *.min.css by name', async () => {
    await withTempDir(async base => {
      fs.writeFileSync(path.join(base, 'app.min.js'), 'x');
      fs.writeFileSync(path.join(base, 'app.min.css'), 'x');
      fs.writeFileSync(path.join(base, 'app.js'), 'x');
      const provider = new SafeProvider({ path: base });
      const entries = await provider.listDir(base);
      assert.deepStrictEqual(entries.map(e => e.name).sort(), ['app.js']);
    });
  });

  test('open() refuses a file with a line over 5000 characters (content-based minified detection)', async () => {
    await withTempDir(async base => {
      const file = path.join(base, 'bundle.js'); // innocuous name, still minified by content
      fs.writeFileSync(file, `var x=1;${'a'.repeat(5001)}`);
      const provider = new SafeProvider({ path: base });
      assert.strictEqual(await provider.open(file), null);
    });
  });

  test('open() refuses a binary file (NUL byte in first 8KB)', async () => {
    await withTempDir(async base => {
      const file = path.join(base, 'binary.dat');
      const buf = Buffer.alloc(100, 0x41);
      buf[5] = 0x00;
      fs.writeFileSync(file, buf);
      const provider = new SafeProvider({ path: base });
      assert.strictEqual(await provider.open(file), null);
    });
  });
});

describe('SafeProvider: secrets', () => {
  test('open() returns null for a real .env and records a real-env-file finding by name only', async () => {
    await withTempDir(async base => {
      fs.writeFileSync(path.join(base, '.env'), 'SECRET=super-sensitive-value');
      const provider = new SafeProvider({ path: base });
      const content = await provider.open(path.join(base, '.env'));
      assert.strictEqual(content, null);
      assert.deepStrictEqual(provider.findings, [{ kind: 'real-env-file', path: '.env' }]);
    });
  });

  test('open() strips values from .env.example but keeps names', async () => {
    await withTempDir(async base => {
      fs.writeFileSync(path.join(base, '.env.example'), 'STRIPE_SECRET_KEY=sk_test_FAKEVALUE123\n');
      const provider = new SafeProvider({ path: base });
      const content = await provider.open(path.join(base, '.env.example'));
      assert.ok(content.includes('STRIPE_SECRET_KEY='));
      assert.strictEqual(content.includes('sk_test_FAKEVALUE123'), false);
      assert.deepStrictEqual(provider.findings, []);
    });
  });

  test('.env.production is treated as real (not opened, finding recorded)', async () => {
    await withTempDir(async base => {
      fs.writeFileSync(path.join(base, '.env.production'), 'SECRET=x');
      const provider = new SafeProvider({ path: base });
      assert.strictEqual(await provider.open(path.join(base, '.env.production')), null);
      assert.strictEqual(provider.findings.length, 1);
      assert.strictEqual(provider.findings[0].path, '.env.production');
    });
  });
});

describe('SafeProvider: limits', () => {
  test('per-file byte limit: a file over maxFileBytes is refused and truncation is reported', async () => {
    await withTempDir(async base => {
      fs.writeFileSync(path.join(base, 'big.txt'), Buffer.alloc(2000, 'x'));
      const provider = new SafeProvider({ path: base, maxFileBytes: 1000 });
      assert.strictEqual(await provider.open(path.join(base, 'big.txt')), null);
      assert.strictEqual(provider.truncated, true);
      assert.match(provider.reason, /per-file limit/);
    });
  });

  test('total byte budget: further opens are refused once the budget is exceeded', async () => {
    await withTempDir(async base => {
      fs.writeFileSync(path.join(base, 'a.txt'), Buffer.alloc(600, 'a'));
      fs.writeFileSync(path.join(base, 'b.txt'), Buffer.alloc(600, 'b'));
      fs.writeFileSync(path.join(base, 'c.txt'), Buffer.alloc(600, 'c'));
      const provider = new SafeProvider({ path: base, maxTotalBytes: 1000 });

      const first = await provider.open(path.join(base, 'a.txt'));
      assert.strictEqual(first.length, 600);
      assert.strictEqual(provider.truncated, false); // still under budget

      // The second file's own read pushes the running total past the
      // 1000-byte budget (600 + 600 = 1200): that read still completes
      // (it is the one that discovers the budget is exceeded), but every
      // read after it is refused.
      const second = await provider.open(path.join(base, 'b.txt'));
      assert.strictEqual(second.length, 600);
      assert.strictEqual(provider.truncated, true);
      assert.match(provider.reason, /total bytes/);

      const third = await provider.open(path.join(base, 'c.txt'));
      assert.strictEqual(third, null);
    });
  });

  test('file listing cap: stops listing once maxFiles is reached and reports truncation', async () => {
    await withTempDir(async base => {
      for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(base, `f${i}.txt`), '');
      const provider = new SafeProvider({ path: base, maxFiles: 5 });
      const entries = await provider.listDir(base);
      assert.strictEqual(entries.length, 5);
      assert.strictEqual(provider.truncated, true);
      assert.match(provider.reason, /5 files/);
    });
  });

  test('directory depth cap: refuses to list beyond maxDepth', async () => {
    await withTempDir(async base => {
      let dir = base;
      for (let i = 0; i < 5; i++) {
        dir = path.join(dir, `d${i}`);
        fs.mkdirSync(dir);
      }
      const provider = new SafeProvider({ path: base, maxDepth: 2 });
      const deep = await provider.listDir(dir); // depth 5, beyond the cap
      assert.deepStrictEqual(deep, []);
      assert.strictEqual(provider.truncated, true);
      assert.match(provider.reason, /depth/);
    });
  });
});

describe('SafeProvider: text sanitisation', () => {
  test('strips zero-width and bidi control characters from returned content', async () => {
    await withTempDir(async base => {
      const file = path.join(base, 'weird.txt');
      fs.writeFileSync(file, 'safe​text‮with﻿controls');
      const provider = new SafeProvider({ path: base });
      const content = await provider.open(file);
      assert.strictEqual(content, 'safetextwithcontrols');
    });
  });
});
