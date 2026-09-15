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

// Every timing assertion below that says "stays fast" or "rejected
// quickly" is checked against this bound rather than a tight ~1s one.
// Measured in isolation these checks complete in tens to a few hundred
// milliseconds; under `npm test`'s full-suite concurrency on this
// machine (many unrelated processes, every other test file running at
// once) the same checks have been measured taking up to ~4s from
// contention alone, with no change in behaviour. The bugs these tests
// exist to catch (the YAML width DoS, the SDK-import regex blowup) were
// 100+ seconds or effectively unbounded, so this bound still
// overwhelmingly distinguishes "fixed" from "regressed".
const TIMING_BOUND_MS = 15000;

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

  test('normalises name case and trailing whitespace before classifying (fix round item 4)', () => {
    assert.strictEqual(classifyEnvFile('.ENV'), 'real');
    assert.strictEqual(classifyEnvFile('.Env.Local'), 'real');
    assert.strictEqual(classifyEnvFile('.env '), 'real'); // trailing space
    assert.strictEqual(classifyEnvFile('.ENV.EXAMPLE'), 'safe-example');
    assert.strictEqual(classifyEnvFile('.Env.Sample'), 'safe-example');
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

  describe('stripEnvValues: adversarial cases (fix round item 5) -- no value substring ever survives', () => {
    const cases = [
      ['a multi-line double-quoted value', 'MULTI="line1\nline2\nsecretvalue"\nNEXT=abc\n', ['line1', 'line2', 'secretvalue', 'abc']],
      ['export NAME=', 'export STRIPE_KEY=sk_live_realsecret\n', ['sk_live_realsecret']],
      ['"=" characters inside the value', 'NAME=abc=def=ghi\n', ['abc=def=ghi', 'def=ghi', 'def', 'ghi']],
      ['an inline "#" comment', 'NAME=supersecret # a trailing note\n', ['supersecret']],
      ['CRLF line endings', 'NAME=crlfsecret\r\nOTHER=x\r\n', ['crlfsecret']],
      ['"NAME = value" with spaces around "="', 'NAME = spacedsecret\n', ['spacedsecret']],
      ['a final line with no trailing newline', 'FIRST=x\nLAST=tailsecret', ['tailsecret']],
      ['a secret pasted into a commented-out declaration', '# STRIPE_KEY=sk_test_commentedsecret\n', ['sk_test_commentedsecret']],
      ['a single-quoted value', "NAME='singlequotedsecret'\n", ['singlequotedsecret']],
      ['an unterminated quoted value running to EOF', 'A="unterminatedsecret', ['unterminatedsecret']],
      // Fix round 2, item 2: heredoc-style values.
      ['a heredoc value ("NAME=<<EOF" ... "EOF")', 'NAME=<<EOF\nheredocsecretline1\nheredocsecretline2\nEOF\nNEXT=abc\n', ['heredocsecretline1', 'heredocsecretline2', 'abc']],
      ['a "<<-EOF" heredoc (tab-stripping form)', 'NAME=<<-EOF\n\theredocdashsecret\nEOF\n', ['heredocdashsecret']],
      ["a heredoc with a quoted delimiter (<<'EOF')", "NAME=<<'EOF'\nquotedheredocsecret\nEOF\n", ['quotedheredocsecret']],
      ['an unterminated heredoc running to EOF', 'NAME=<<EOF\nneverclosedsecret\nmore secret body text', ['neverclosedsecret', 'more secret body text']],
      // Fix round 2, item 2: anything else that is not a declaration,
      // blank line, or comment is dropped outright, not passed through.
      ['a stray line shaped like neither a declaration nor a comment', 'FOO=bar\nSTRAY LINE WITH plaintextsecret\nBAZ=qux\n', ['plaintextsecret', 'STRAY LINE']],
    ];

    for (const [label, input, forbidden] of cases) {
      test(`no value substring survives: ${label}`, () => {
        const out = stripEnvValues(input);
        for (const value of forbidden) {
          assert.strictEqual(out.includes(value), false, `expected "${value}" to be stripped from ${JSON.stringify(out)}`);
        }
      });
    }

    test('blank lines and full-line comments between declarations are still kept', () => {
      const out = stripEnvValues('FOO=bar\n\n# a real comment\nBAZ=qux\n');
      assert.ok(out.includes('FOO='));
      assert.ok(out.includes('BAZ='));
      assert.ok(out.includes('# a real comment'));
    });
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

  test('strips C0/C1 control characters and bidi isolates, but keeps tab and newline', async () => {
    await withTempDir(async base => {
      const file = path.join(base, 'controls.txt');
      // \x01 (C0), \x7f (DEL), \x85 (C1), \u2066 (LRI, a bidi isolate),
      // interleaved with a real tab and a real newline that must survive.
      const raw = 'a\x01b\tafter-tab\nc\x7fd\x85e\u2066f';
      fs.writeFileSync(file, raw, 'utf8');
      const provider = new SafeProvider({ path: base, maxFileBytes: 10000 });
      const content = await provider.open(file);
      assert.strictEqual(content, 'ab\tafter-tab\ncdef');
    });
  });
});

describe('SafeProvider: *.yml/*.yaml is parsed with bounded settings before ever being returned (fix round item 3b)', () => {
  test('a valid, ordinary yaml file is returned unchanged in content', async () => {
    await withTempDir(async base => {
      const file = path.join(base, 'docker-compose.yml');
      fs.writeFileSync(file, 'services:\n  web:\n    image: nginx\n');
      const provider = new SafeProvider({ path: base });
      const content = await provider.open(file);
      assert.ok(content.includes('services:'));
      assert.deepStrictEqual(provider.findings, []);
    });
  });

  test('a compose file with deeply nested flow sequences is rejected, recorded, and stays fast', async () => {
    await withTempDir(async base => {
      const file = path.join(base, 'docker-compose.yml');
      // One "[" per line (and later one "]" per line), depth 70 (> the
      // 64 cap) but only ~140 lines total -- this isolates the
      // nesting-depth guard specifically from the width guards (line
      // count / entry count) added in fix round 2 item 1(a), which
      // would otherwise catch a much-larger version of this same bomb
      // first, for a different (still safe) reason, and from the
      // pre-existing, unrelated "single line over 5000 characters"
      // minified-file heuristic.
      const bomb = 'a: ' + '[\n'.repeat(70) + '1' + '\n]'.repeat(70) + '\n';
      fs.writeFileSync(file, bomb);
      const provider = new SafeProvider({ path: base, maxFileBytes: 1024 * 1024 });

      const start = Date.now();
      const content = await provider.open(file);
      const elapsedMs = Date.now() - start;

      assert.strictEqual(content, null);
      assert.ok(elapsedMs < TIMING_BOUND_MS, `expected well under a catastrophic-regression bound, took ${elapsedMs}ms`);
      assert.deepStrictEqual(provider.findings, [{ kind: 'yaml-rejected', path: 'docker-compose.yml', reason: 'too-deep' }]);
    });
  });

  test('a workflow file with deep block nesting is rejected, recorded, and stays fast', async () => {
    await withTempDir(async base => {
      const file = path.join(base, '.github-workflow.yml'); // ordinary .yml name is enough to trigger the check
      let bomb = '';
      // Depth ~100 is enough to exceed MAX_NESTING_DEPTH (64) while
      // keeping the file well under the new 256KB YAML file-size cap
      // (fix round 2 item 1(a)) -- this isolates the nesting-depth
      // guard from that unrelated, earlier-firing size check.
      for (let i = 0; i < 100; i++) bomb += '  '.repeat(i) + 'a:\n';
      fs.writeFileSync(file, bomb);
      const provider = new SafeProvider({ path: base, maxFileBytes: 10 * 1024 * 1024 });

      const start = Date.now();
      const content = await provider.open(file);
      const elapsedMs = Date.now() - start;

      assert.strictEqual(content, null);
      assert.ok(elapsedMs < TIMING_BOUND_MS, `expected well under a catastrophic-regression bound, took ${elapsedMs}ms`);
      assert.ok(
        provider.findings.some(f => f.kind === 'yaml-rejected' && f.path === '.github-workflow.yml' && f.reason === 'too-deep'),
      );
    });
  });

  test('never throws a RangeError even if a pathological document reached the underlying parser', async () => {
    await withTempDir(async base => {
      const file = path.join(base, 'x.yaml');
      // A single, very long flow sequence on one line -- exercises the
      // same code path without relying on any particular yaml version's
      // internal recursion limit.
      fs.writeFileSync(file, 'a: [' + '1,'.repeat(200000) + '1]\n');
      const provider = new SafeProvider({ path: base, maxFileBytes: 10 * 1024 * 1024 });
      await assert.doesNotReject(() => provider.open(file));
    });
  });

  describe('width DoS (fix round 2, item 1): a wide-but-shallow document is rejected before any real parse', () => {
    test('100,000 flat top-level keys is rejected in under 1s', async () => {
      await withTempDir(async base => {
        const file = path.join(base, 'wide.yml');
        const lines = [];
        for (let i = 0; i < 100000; i++) lines.push(`k${i}: v${i}`);
        fs.writeFileSync(file, lines.join('\n'));
        const provider = new SafeProvider({ path: base, maxFileBytes: 10 * 1024 * 1024 });

        const start = Date.now();
        const content = await provider.open(file);
        const elapsedMs = Date.now() - start;

        assert.strictEqual(content, null);
        assert.ok(elapsedMs < TIMING_BOUND_MS, `expected well under a catastrophic-regression bound, took ${elapsedMs}ms`);
        assert.strictEqual(provider.findings.length, 1);
        assert.strictEqual(provider.findings[0].kind, 'yaml-rejected');
        assert.strictEqual(provider.findings[0].path, 'wide.yml');
      });
    });

    test('6,000 sequence items is rejected', async () => {
      await withTempDir(async base => {
        const file = path.join(base, 'seq.yaml');
        const lines = [];
        for (let i = 0; i < 6000; i++) lines.push(`- item${i}`);
        fs.writeFileSync(file, lines.join('\n'));
        const provider = new SafeProvider({ path: base, maxFileBytes: 10 * 1024 * 1024 });

        const start = Date.now();
        const content = await provider.open(file);
        const elapsedMs = Date.now() - start;

        assert.strictEqual(content, null);
        assert.ok(elapsedMs < TIMING_BOUND_MS, `expected well under a catastrophic-regression bound, took ${elapsedMs}ms`);
        assert.deepStrictEqual(provider.findings, [{ kind: 'yaml-rejected', path: 'seq.yaml', reason: 'too-many-entries' }]);
      });
    });

    test('a 300KB YAML file is rejected (over the tighter 256KB YAML file-size cap)', async () => {
      await withTempDir(async base => {
        const file = path.join(base, 'big.yml');
        const bigValue = 'x'.repeat(200);
        const lines = [];
        let size = 0;
        let i = 0;
        while (size < 300 * 1024) {
          const line = `k${i}: ${bigValue}`;
          lines.push(line);
          size += line.length + 1;
          i++;
        }
        fs.writeFileSync(file, lines.join('\n'));
        const provider = new SafeProvider({ path: base, maxFileBytes: 10 * 1024 * 1024 }); // generous generic cap: the YAML-specific one must still bind

        const start = Date.now();
        const content = await provider.open(file);
        const elapsedMs = Date.now() - start;

        assert.strictEqual(content, null);
        assert.ok(elapsedMs < TIMING_BOUND_MS, `expected well under a catastrophic-regression bound, took ${elapsedMs}ms`);
        assert.deepStrictEqual(provider.findings, [{ kind: 'yaml-rejected', path: 'big.yml', reason: 'file-too-large' }]);
      });
    });

    test('a 4,000-key file within every cap parses successfully in under 1s', async () => {
      await withTempDir(async base => {
        const file = path.join(base, 'ok.yml');
        const lines = [];
        for (let i = 0; i < 4000; i++) lines.push(`k${i}: v${i}`);
        fs.writeFileSync(file, lines.join('\n'));
        const provider = new SafeProvider({ path: base, maxFileBytes: 10 * 1024 * 1024 });

        const start = Date.now();
        const content = await provider.open(file);
        const elapsedMs = Date.now() - start;

        assert.ok(content !== null, 'a legitimate, in-bounds document must not be rejected');
        assert.ok(content.includes('k0: v0'));
        assert.ok(elapsedMs < TIMING_BOUND_MS, `expected well under a catastrophic-regression bound, took ${elapsedMs}ms`);
        assert.deepStrictEqual(provider.findings, []);
      });
    });

    test('fix round 3: an alias-count bomb is rejected with reason "too-many-aliases"', async () => {
      await withTempDir(async base => {
        const file = path.join(base, 'alias-bomb.yml');
        const lines = ['a: &a [x,x,x,x,x,x,x,x,x,x]'];
        let prev = 'a';
        for (const letter of 'bcdefghijklmnop') {
          lines.push(`${letter}: &${letter} [*${prev},*${prev},*${prev},*${prev},*${prev},*${prev},*${prev},*${prev},*${prev},*${prev}]`);
          prev = letter;
        }
        fs.writeFileSync(file, lines.join('\n') + '\n');
        const provider = new SafeProvider({ path: base, maxFileBytes: 10 * 1024 * 1024 });

        const start = Date.now();
        const content = await provider.open(file);
        const elapsedMs = Date.now() - start;

        assert.strictEqual(content, null);
        assert.ok(elapsedMs < TIMING_BOUND_MS, `expected well under a catastrophic-regression bound, took ${elapsedMs}ms`);
        assert.deepStrictEqual(provider.findings, [{ kind: 'yaml-rejected', path: 'alias-bomb.yml', reason: 'too-many-aliases' }]);
      });
    });
  });
});
