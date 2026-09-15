// Acquire step: resolveSource() URL/path handling, and cloneGitHub()'s
// exact safe-clone argument/env shape and cleanup behaviour -- all
// through an injected runGit, so these tests never touch the network or
// invoke a real git process.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveSource, cloneGitHub, validateRef, GIT_SAFE_ENV, GIT_SAFE_CONFIG_ARGS } = require('../src/scan/acquire');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'repos', 'compose-app');

describe('resolveSource: local paths', () => {
  test('accepts an existing directory and resolves it to a real path', async () => {
    const source = await resolveSource(FIXTURES_DIR);
    assert.strictEqual(source.type, 'local');
    assert.strictEqual(fs.realpathSync(FIXTURES_DIR), source.path);
  });

  test('rejects a path that does not exist', async () => {
    await assert.rejects(() => resolveSource(path.join(FIXTURES_DIR, 'does-not-exist')), /does not exist/);
  });

  test('rejects a path that is a file, not a directory', async () => {
    const file = path.join(FIXTURES_DIR, 'docker-compose.yml');
    await assert.rejects(() => resolveSource(file), /not a directory/);
  });

  test('rejects an empty string', async () => {
    await assert.rejects(() => resolveSource(''), /non-empty/);
  });
});

describe('resolveSource: GitHub URLs', () => {
  const accept = [
    ['https://github.com/dockersamples/example-voting-app', { owner: 'dockersamples', repo: 'example-voting-app', ref: null }],
    ['https://github.com/dockersamples/example-voting-app.git', { owner: 'dockersamples', repo: 'example-voting-app', ref: null }],
    [
      'https://github.com/dockersamples/example-voting-app/tree/main',
      { owner: 'dockersamples', repo: 'example-voting-app', ref: 'main' },
    ],
    [
      'https://github.com/vercel/nextjs-subscription-payments/tree/abc123',
      { owner: 'vercel', repo: 'nextjs-subscription-payments', ref: 'abc123' },
    ],
  ];

  for (const [url, expected] of accept) {
    test(`accepts "${url}"`, async () => {
      const source = await resolveSource(url);
      assert.strictEqual(source.type, 'github');
      assert.strictEqual(source.owner, expected.owner);
      assert.strictEqual(source.repo, expected.repo);
      assert.strictEqual(source.ref, expected.ref);
    });
  }

  const reject = [
    ['http://github.com/a/b', /scheme/],
    ['https://gitlab.com/a/b', /host/],
    ['https://www.github.com/a/b', /host/],
    ['ssh://git@github.com/a/b.git', /scheme/],
    ['git://github.com/a/b.git', /scheme/],
    ['file:///etc/passwd', /scheme/],
    ['git@github.com:a/b.git', /scp-style/],
    ['https://user:pass@github.com/a/b', /credentials/],
    ['https://github.com/a/b?ref=main', /query string/],
    ['https://github.com/a/../b', /\.\./],
    ['https://github.com/a', /form/],
    ['https://github.com/', /form/],
    // No "://" scheme, so this is treated as a local-path candidate (as
    // intended: a bare string is far more likely to be a typo'd path than
    // a URL) and rejected with the clearer "does not exist" message.
    ['not a url and not a real directory', /does not exist/],
  ];

  for (const [url, expectedMessage] of reject) {
    test(`rejects "${url}"`, async () => {
      await assert.rejects(() => resolveSource(url), expectedMessage);
    });
  }
});

describe('validateRef: rejects a ref that would inject a git option or escape the ref grammar', () => {
  const reject = [
    ['%2D%2Dupload-pack%3D/tmp/pwn.sh', 'percent-encoded leading dashes (git option injection)'],
    ['%2E%2E', 'percent-encoded ".."'],
    ['%252D%252D', 'double percent-encoding (still has "%" after one decode)'],
    ['%2F..', 'decodes to a ref containing ".."'],
    ['@{', 'reflog/upstream shorthand'],
    ['has space', 'plain whitespace'],
    ['%0Ainjected', 'percent-encoded newline'],
    ['-x', 'a literal leading dash'],
    ['a'.repeat(300), 'over the 200-character cap'],
    ['a//b', 'double slash'],
    ['a\\b', 'backslash'],
    ['a/', 'trailing slash'],
    ['a.', 'trailing dot'],
    ['a/b.lock', '.lock path component'],
  ];

  for (const [ref, why] of reject) {
    test(`rejects ${JSON.stringify(ref)} (${why})`, () => {
      assert.throws(() => validateRef(ref));
    });
  }

  test('accepts a plain hex SHA and a plain branch name', () => {
    assert.strictEqual(validateRef('63e9150ca17af4ed05880d4245e486481f73fcb4'), '63e9150ca17af4ed05880d4245e486481f73fcb4');
    assert.strictEqual(validateRef('main'), 'main');
    assert.strictEqual(validateRef('feature%2Fx'), 'feature/x'); // a legitimately encoded slash decodes cleanly
  });

  test('resolveSource rejects the percent-encoded git-option-injection URL from the security review', async () => {
    await assert.rejects(
      () => resolveSource('https://github.com/x/y/tree/%2D%2Dupload-pack%3D/tmp/pwn.sh'),
      /not a valid git ref|option/,
    );
  });
});

describe('cloneGitHub: safe argument and env shape', () => {
  function fakeRunGit(script) {
    const calls = [];
    const runGit = async (args, opts) => {
      calls.push({ args, cwd: opts.cwd, env: opts.env });
      return script(args, opts, calls.length);
    };
    return { runGit, calls };
  }

  test('clone (no ref): uses the exact safe config flags, filter, and depth-1 single-branch clone', async () => {
    const { runGit, calls } = fakeRunGit(() => ({ code: 0, stdout: '', stderr: '', timedOut: false }));

    const result = await cloneGitHub(
      { owner: 'dockersamples', repo: 'example-voting-app', ref: null },
      { tmpRoot: os.tmpdir(), runGit },
    );

    assert.strictEqual(calls.length, 2); // clone, then rev-parse HEAD for the resolved ref
    const cloneArgs = calls[0].args;
    for (const flag of GIT_SAFE_CONFIG_ARGS) assert.ok(cloneArgs.includes(flag), `expected clone args to include "${flag}"`);
    assert.ok(cloneArgs.includes('clone'));
    assert.ok(cloneArgs.includes('--depth'));
    assert.ok(cloneArgs.includes('1'));
    assert.ok(cloneArgs.includes('--single-branch'));
    assert.ok(cloneArgs.includes('--no-tags'));
    assert.ok(cloneArgs.includes('--no-recurse-submodules'));
    assert.ok(cloneArgs.includes('--filter=blob:limit=1m'));
    assert.ok(cloneArgs.includes('https://github.com/dockersamples/example-voting-app.git'));

    for (const call of calls) {
      for (const [key, value] of Object.entries(GIT_SAFE_ENV)) {
        assert.strictEqual(call.env[key], value, `expected env.${key} to be "${value}"`);
      }
      assert.strictEqual(call.env.GIT_LFS_SKIP_SMUDGE, '1');
    }

    // "--" must separate git's own options from the positional
    // <url> <dir> pair, and the url must be the argument immediately
    // after it -- this is what stops a hostile-but-validated-looking
    // string from ever being parsed as an option instead of a value.
    const dashDashIndex = cloneArgs.indexOf('--');
    assert.ok(dashDashIndex >= 0, 'expected a literal "--" in the clone argv');
    assert.strictEqual(cloneArgs[dashDashIndex + 1], 'https://github.com/dockersamples/example-voting-app.git');

    await result.cleanup();
    assert.strictEqual(fs.existsSync(result.path), false);
  });

  test('clone (no ref): submodule/fsmonitor/protocol-allow config flags are present', async () => {
    const { runGit, calls } = fakeRunGit(() => ({ code: 0, stdout: '', stderr: '', timedOut: false }));
    const result = await cloneGitHub({ owner: 'a', repo: 'b', ref: null }, { tmpRoot: os.tmpdir(), runGit });
    const cloneArgs = calls[0].args;
    for (const flag of ['submodule.recurse=false', 'core.fsmonitor=false', 'protocol.allow=never', 'protocol.https.allow=always']) {
      assert.ok(cloneArgs.includes(flag), `expected clone args to include "${flag}"`);
    }
    await result.cleanup();
  });

  test('clone with a ref: init, fetch --depth 1 <url> <ref>, checkout --detach FETCH_HEAD', async () => {
    const { runGit, calls } = fakeRunGit(() => ({ code: 0, stdout: '', stderr: '', timedOut: false }));

    const result = await cloneGitHub(
      { owner: 'vercel', repo: 'nextjs-subscription-payments', ref: 'main' },
      { tmpRoot: os.tmpdir(), runGit },
    );

    assert.strictEqual(result.ref, 'main');
    const subcommands = calls.map(c => c.args.find(a => !a.startsWith('-') && a !== 'main' && a !== 'C'));
    assert.ok(calls.some(c => c.args.includes('init')));
    const fetchCall = calls.find(c => c.args.includes('fetch'));
    assert.ok(fetchCall, 'expected a fetch call');
    assert.ok(fetchCall.args.includes('--depth'));
    assert.ok(fetchCall.args.includes('--filter=blob:limit=1m'));
    assert.ok(fetchCall.args.includes('https://github.com/vercel/nextjs-subscription-payments.git'));
    assert.ok(fetchCall.args.includes('main'));
    const checkoutCall = calls.find(c => c.args.includes('checkout'));
    assert.ok(checkoutCall, 'expected a checkout call');
    assert.ok(checkoutCall.args.includes('--detach'));
    assert.ok(checkoutCall.args.includes('FETCH_HEAD'));
    // The ref itself is never an argument to checkout -- FETCH_HEAD is
    // the only positional there.
    assert.strictEqual(checkoutCall.args.includes('main'), false);
    void subcommands;

    // "--" must separate fetch's own options from the positional
    // <url> <ref> pair, with the url immediately after it.
    const dashDashIndex = fetchCall.args.indexOf('--');
    assert.ok(dashDashIndex >= 0, 'expected a literal "--" in the fetch argv');
    assert.strictEqual(fetchCall.args[dashDashIndex + 1], 'https://github.com/vercel/nextjs-subscription-payments.git');
    assert.strictEqual(fetchCall.args[dashDashIndex + 2], 'main');

    for (const call of calls) {
      assert.strictEqual(call.env.GIT_LFS_SKIP_SMUDGE, '1');
      for (const flag of ['submodule.recurse=false', 'core.fsmonitor=false', 'protocol.allow=never', 'protocol.https.allow=always']) {
        assert.ok(call.args.includes(flag), `expected "${flag}" on every call in the ref path`);
      }
    }

    await result.cleanup();
  });

  test('rejects a hostile ref before ever calling runGit', async () => {
    const { runGit, calls } = fakeRunGit(() => ({ code: 0, stdout: '', stderr: '', timedOut: false }));
    await assert.rejects(
      () => cloneGitHub({ owner: 'a', repo: 'b', ref: '--upload-pack=/tmp/pwn.sh' }, { tmpRoot: os.tmpdir(), runGit }),
    );
    assert.strictEqual(calls.length, 0, 'runGit must never be invoked with a rejected ref');
  });

  test('never invokes a shell: git is always run with an argument array', async () => {
    const { runGit } = fakeRunGit((args) => {
      assert.ok(Array.isArray(args));
      for (const a of args) assert.strictEqual(typeof a, 'string');
      return { code: 0, stdout: '', stderr: '', timedOut: false };
    });
    const result = await cloneGitHub({ owner: 'a', repo: 'b', ref: null }, { tmpRoot: os.tmpdir(), runGit });
    await result.cleanup();
  });

  test('cleans up the temp directory when git fails', async () => {
    let seenDir = null;
    const runGit = async (args, opts) => {
      seenDir = opts.cwd;
      return { code: 128, stdout: '', stderr: 'fatal: repository not found', timedOut: false };
    };
    await assert.rejects(
      () => cloneGitHub({ owner: 'nobody', repo: 'nowhere', ref: null }, { tmpRoot: os.tmpdir(), runGit }),
      /failed/,
    );
    assert.ok(seenDir, 'runGit should have been called with a cwd');
    assert.strictEqual(fs.existsSync(seenDir), false);
  });

  test('cleans up the temp directory on a reported timeout', async () => {
    let seenDir = null;
    const runGit = async (args, opts) => {
      seenDir = opts.cwd;
      return { code: null, stdout: '', stderr: '', timedOut: true };
    };
    await assert.rejects(
      () => cloneGitHub({ owner: 'a', repo: 'b', ref: null }, { tmpRoot: os.tmpdir(), timeoutMs: 50, runGit }),
      /timed out/,
    );
    assert.strictEqual(fs.existsSync(seenDir), false);
  });

  test('cleans up and rejects when the cloned size exceeds maxBytes', async () => {
    const runGit = async (args, opts) => {
      if (args.includes('clone')) {
        // Simulate a successful clone by writing a file larger than the
        // (tiny, test-only) maxBytes limit into the target directory.
        fs.writeFileSync(path.join(opts.cwd, 'big.bin'), Buffer.alloc(2048, 'x'));
      }
      return { code: 0, stdout: '', stderr: '', timedOut: false };
    };
    let workDir = null;
    const wrapped = async (args, opts) => {
      workDir = opts.cwd;
      return runGit(args, opts);
    };
    await assert.rejects(
      () => cloneGitHub({ owner: 'a', repo: 'b', ref: null }, { tmpRoot: os.tmpdir(), maxBytes: 1024, runGit: wrapped }),
      /exceeding the 1024-byte limit/,
    );
    assert.strictEqual(fs.existsSync(workDir), false);
  });

  test('cleanup() is idempotent', async () => {
    const runGit = async () => ({ code: 0, stdout: '', stderr: '', timedOut: false });
    const result = await cloneGitHub({ owner: 'a', repo: 'b', ref: null }, { tmpRoot: os.tmpdir(), runGit });
    await result.cleanup();
    await result.cleanup(); // must not throw
  });
});
