// `sequentdraw mcp`: the stdio JSON-RPC 2.0 transport (src/mcp/server.js)
// and the six tools it dispatches through the exact same `main()` the CLI
// uses (src/mcp/tools.js). These tests spawn the real server -- `node
// bin/sequentdraw mcp` -- and speak the protocol to it over its own stdin
// and stdout, the same way a host (Cursor, Codex, Gemini CLI) would.
//
// The guarantee under test throughout is parity: an MCP tool call must give
// the same text and the same isError flag a direct CLI invocation gives for
// the same input, because that parity is what lets every surface refuse the
// same things (docs/design/gitrepo-suggest.md:38).

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const readline = require('node:readline');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MAX_DOCUMENT_BYTES } = require('../src/cli/read-document');
const { MERGE_TMP_PREFIX } = require('../src/mcp/tools');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'sequentdraw');
const FIXTURE = path.join(ROOT, 'examples', 'medusa-return-flow.json');
const FIXTURE_DOC = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// `fn` is always async here, so this must await it before cleaning up --
// returning the bare promise would let `finally` delete the directory
// while `fn` was still writing into it.
async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-mcp-test-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Spawns `node bin/sequentdraw mcp` and gives back a small client: `call`
// for a request that expects a reply, `notify` for one that does not,
// `sendRaw` for a hand-written line (used for the malformed/oversized
// cases below), and `allLines`/`allMessages` for the whole transcript --
// what stdout purity is checked against.
function spawnServer() {
  const child = spawn(process.execPath, [BIN, 'mcp']);
  const emitter = new EventEmitter();
  const allLines = [];
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', line => {
    allLines.push(line);
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      emitter.emit('unparsable', line);
      return;
    }
    emitter.emit('message', message);
  });

  let nextId = 1;

  function waitFor(predicate, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        emitter.off('message', onMessage);
        reject(new Error(`timed out waiting for a matching JSON-RPC message`));
      }, timeoutMs);
      function onMessage(message) {
        if (predicate(message)) {
          clearTimeout(timer);
          emitter.off('message', onMessage);
          resolve(message);
        }
      }
      emitter.on('message', onMessage);
    });
  }

  function sendRaw(line) {
    child.stdin.write(`${line}\n`);
  }

  // Writes `line` (already newline-terminated) as many separate small
  // writes rather than one, so the server's chunk-by-chunk framing is
  // actually exercised across many 'data' events -- most of which land in
  // the middle of the line, not on a boundary. Awaits each write's
  // callback so writes are not reordered relative to each other.
  function sendChunked(line, chunkSize = 64 * 1024) {
    const writeOne = offset => {
      if (offset >= line.length) return Promise.resolve();
      const piece = line.slice(offset, offset + chunkSize);
      return new Promise((resolve, reject) => {
        child.stdin.write(piece, 'utf8', err => (err ? reject(err) : resolve()));
      }).then(() => writeOne(offset + chunkSize));
    };
    return writeOne(0);
  }

  function call(method, params) {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return waitFor(message => message.id === id);
  }

  function callTool(name, args) {
    return call('tools/call', { name, arguments: args });
  }

  function notify(method, params) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  return { child, call, callTool, notify, sendRaw, sendChunked, waitFor, allLines };
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', ...options });
}

// The five codes docs/design/gitrepo-suggest.md defines for --repos, reused
// exactly as tests/repos-check-repos.test.js builds them, so this file pins
// the MCP parity of that check rather than re-deriving its fixtures.
function repoNoteMap() {
  return {
    title: 'Repo candidates',
    nodes: [
      { id: 'a', label: 'Enquiry arrives', kind: 'external' },
      { id: 'b', label: 'Chase the customer', kind: 'manual' },
    ],
    edges: [{ from: 'a', to: 'b', type: 'solid' }],
    notes: [
      {
        id: 'n_repo_b',
        attachTo: ['b'],
        color: 'blue',
        content: '**Could fill this gap**\n\n[owner/repo](https://github.com/owner/repo) — MIT, 1.8k stars. Sends a reminder on a schedule.',
      },
    ],
  };
}

// --- 1. initialize -----------------------------------------------------

test('initialize: negotiates a supported version and echoes an unsupported one to the default', async () => {
  await withServer(async server => {
    for (const version of ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']) {
      const reply = await server.call('initialize', { protocolVersion: version });
      assert.strictEqual(reply.result.protocolVersion, version);
      assert.deepStrictEqual(reply.result.capabilities, { tools: {} });
      assert.strictEqual(reply.result.serverInfo.name, 'sequentdraw');
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
      assert.strictEqual(reply.result.serverInfo.version, pkg.version);
    }

    const unknown = await server.call('initialize', { protocolVersion: '1999-01-01' });
    assert.strictEqual(unknown.result.protocolVersion, '2025-06-18');

    server.notify('notifications/initialized');
  });
});

// --- 2. tools/list -------------------------------------------------------

test('tools/list: exactly the six tools, each with a strict inputSchema, and no "mcp" tool', async () => {
  await withServer(async server => {
    const reply = await server.call('tools/list', {});
    const names = reply.result.tools.map(t => t.name).sort();
    assert.deepStrictEqual(names, [
      'sequentdraw_catalogue',
      'sequentdraw_check',
      'sequentdraw_licences',
      'sequentdraw_render',
      'sequentdraw_scan',
      'sequentdraw_validate',
    ]);
    reply.result.tools.forEach(tool => {
      assert.strictEqual(tool.inputSchema.additionalProperties, false, `${tool.name} must set additionalProperties: false`);
      assert.strictEqual(tool.inputSchema.type, 'object');
      assert.ok(tool.description.length > 0);
    });
  });
});

// Every file-path argument's description must say how a relative path
// resolves and that an absolute one is recommended, across all six tools --
// not duplicated per property elsewhere in this file, since a wording
// change should only need pinning once.
test('tools/list: every file-path argument documents relative resolution and recommends an absolute path', async () => {
  await withServer(async server => {
    const reply = await server.call('tools/list', {});
    const PATH_ARGS = new Set([
      'path', 'merge_path', 'out', 'source', 'evidence', 'repos:check', 'emit_open',
    ]);
    reply.result.tools.forEach(tool => {
      Object.entries(tool.inputSchema.properties).forEach(([key, prop]) => {
        // "repos" means two different things: a file path for check, an
        // array of owner/repo ids for licences -- only the former is a path.
        const argKey = key === 'repos' && tool.name === 'sequentdraw_check' ? 'repos:check' : key;
        if (!PATH_ARGS.has(argKey)) return;
        assert.match(
          prop.description,
          /relative path resolves against this server's own working directory.*absolute path is recommended/,
          `${tool.name}.${key} must document relative/absolute path resolution`,
        );
      });
    });
  });
});

// --- security: sequentdraw_licences never accepts a caller-named env var --

test('sequentdraw_licences has no "token_env": naming any environment variable is refused', async () => {
  await withServer(async server => {
    await withTempDir(async dir => {
      const out = path.join(dir, 'verified.json');
      // Even a legitimate-looking value must be refused -- the point is that
      // this argument does not exist at all, not that some values of it are
      // disallowed.
      const reply = await server.callTool('sequentdraw_licences', {
        repos: ['owner/repo'],
        out,
        token_env: 'GITHUB_TOKEN',
      });
      assert.strictEqual(reply.error.code, -32602);
      assert.match(reply.error.message, /unknown argument "token_env"/);
      assert.strictEqual(fs.existsSync(out), false);
    });
  });
});

// --- 3. parity with the CLI ----------------------------------------------

test('parity: validate gives the same text and exit as the CLI', async () => {
  await withServer(async server => {
    const mcp = await server.callTool('sequentdraw_validate', { path: FIXTURE });
    const cli = runCli(['validate', FIXTURE]);
    assert.strictEqual(mcp.result.isError, cli.status !== 0);
    assert.strictEqual(mcp.result.content[0].text, cli.stdout + cli.stderr);
  });
});

test('parity: check on the reference fixture (four completeness gaps) matches the CLI', async () => {
  await withServer(async server => {
    const mcp = await server.callTool('sequentdraw_check', { path: FIXTURE });
    const cli = runCli(['check', FIXTURE]);
    assert.strictEqual(cli.status, 1); // sanity: this fixture is expected to fail check
    assert.strictEqual(mcp.result.isError, true);
    assert.strictEqual(mcp.result.content[0].text, cli.stdout + cli.stderr);
  });
});

test('parity: render writes a byte-identical HTML file to the CLI, for the same fixture', async () => {
  await withServer(async server => {
    await withTempDir(async dir => {
      const cliOut = path.join(dir, 'cli.html');
      const mcpOut = path.join(dir, 'mcp.html');
      const cli = runCli(['render', FIXTURE, cliOut]);
      assert.strictEqual(cli.status, 0, cli.stderr);
      const mcp = await server.callTool('sequentdraw_render', { path: FIXTURE, out: mcpOut });
      assert.strictEqual(mcp.result.isError, false, mcp.result.content[0].text);
      assert.ok(fs.readFileSync(cliOut).equals(fs.readFileSync(mcpOut)), 'render output must be byte-identical');
    });
  });
});

// --- 4. inline document vs path, and giving both -------------------------

test('inline document and path document give the same result; giving both is -32602', async () => {
  await withServer(async server => {
    const byPath = await server.callTool('sequentdraw_validate', { path: FIXTURE });
    const inline = await server.callTool('sequentdraw_validate', { document: FIXTURE_DOC });
    assert.deepStrictEqual(byPath.result, inline.result);
    assert.strictEqual(inline.result.isError, false);

    const both = await server.callTool('sequentdraw_validate', { document: FIXTURE_DOC, path: FIXTURE });
    assert.strictEqual(both.error.code, -32602);

    const neither = await server.callTool('sequentdraw_validate', {});
    assert.strictEqual(neither.error.code, -32602);
  });
});

// --- 5. inline document + inline merge patch, and its temp file ----------

function tmpEntriesWithPrefix(prefix) {
  return fs.readdirSync(os.tmpdir()).filter(name => name.startsWith(prefix));
}

test('inline document + inline merge patch works, and the temp file it needed is gone afterwards', async () => {
  await withServer(async server => {
    await withTempDir(async dir => {
      const before = tmpEntriesWithPrefix(MERGE_TMP_PREFIX);
      const out = path.join(dir, 'merged.html');
      const patch = { notes: [{ id: 'n_extra', attachTo: ['refund_out'], content: 'Consider: added by the merge patch.' }] };

      const reply = await server.callTool('sequentdraw_render', {
        document: FIXTURE_DOC,
        merge: patch,
        out,
        fragment: true,
      });
      assert.strictEqual(reply.result.isError, false, reply.result.content[0].text);
      assert.ok(fs.existsSync(out));

      const after = tmpEntriesWithPrefix(MERGE_TMP_PREFIX);
      assert.deepStrictEqual(after, before, 'the merge patch temp directory must be cleaned up');
    });
  });
});

// --- 6. a failing command is isError: true, never a JSON-RPC error -------

test('an invalid document is a tool result with isError: true, not a JSON-RPC error', async () => {
  await withServer(async server => {
    const reply = await server.callTool('sequentdraw_validate', { document: { title: '', nodes: [], edges: [] } });
    assert.strictEqual(reply.error, undefined);
    assert.strictEqual(reply.result.isError, true);
    assert.ok(reply.result.content[0].text.length > 0);
  });
});

// --- 7. check --repos parity: an unverified GitHub link is refused -------

test('check --repos refuses an unverified GitHub link exactly as the CLI refuses it', async () => {
  await withServer(async server => {
    await withTempDir(async dir => {
      const mapPath = path.join(dir, 'map.json');
      const reposPath = path.join(dir, 'repos.json');
      fs.writeFileSync(mapPath, JSON.stringify(repoNoteMap()));
      fs.writeFileSync(reposPath, JSON.stringify({ checkedAt: '2026-09-20T00:00:00Z', repos: [] }));

      const cli = runCli(['check', mapPath, '--repos', reposPath]);
      assert.strictEqual(cli.status, 1);
      assert.match(cli.stderr, /was not verified in this run/);

      const mcp = await server.callTool('sequentdraw_check', { path: mapPath, repos: reposPath });
      assert.strictEqual(mcp.result.isError, true);
      assert.strictEqual(mcp.result.content[0].text, cli.stdout + cli.stderr);
    });
  });
});

// --- 8. protocol errors ---------------------------------------------------

test('a malformed line gives -32700, and the server keeps answering afterward', async () => {
  await withServer(async server => {
    server.sendRaw('{not valid json');
    const parseError = await server.waitFor(m => m.error && m.error.code === -32700);
    assert.strictEqual(parseError.id, null);

    const stillUp = await server.call('ping', {});
    assert.deepStrictEqual(stillUp.result, {});
  });
});

test('an unknown method is -32601', async () => {
  await withServer(async server => {
    const reply = await server.call('bogus/method', {});
    assert.strictEqual(reply.error.code, -32601);
  });
});

test('an unknown tool and an extra argument are both -32602', async () => {
  await withServer(async server => {
    const unknownTool = await server.callTool('sequentdraw_nonexistent', {});
    assert.strictEqual(unknownTool.error.code, -32602);

    const extraArg = await server.callTool('sequentdraw_validate', { path: FIXTURE, bogus: true });
    assert.strictEqual(extraArg.error.code, -32602);
  });
});

test('a string argument starting with "-" is refused, never turned into a flag', async () => {
  await withServer(async server => {
    const dashPath = await server.callTool('sequentdraw_validate', { path: '--evidence' });
    assert.strictEqual(dashPath.error.code, -32602);

    const dashOut = await server.callTool('sequentdraw_render', { path: FIXTURE, out: '--fragment' });
    assert.strictEqual(dashOut.error.code, -32602);

    // A bare "-" (the internal stdin sentinel) is also refused from a
    // caller: only this server may choose it, never the arguments it is
    // handed.
    const bareDash = await server.callTool('sequentdraw_validate', { path: '-' });
    assert.strictEqual(bareDash.error.code, -32602);
  });
});

// --- 9. an oversized line ------------------------------------------------

test('an oversized line is refused with -32600, and the server keeps running', async () => {
  await withServer(async server => {
    const huge = JSON.stringify({
      jsonrpc: '2.0',
      id: 999,
      method: 'tools/call',
      params: { name: 'sequentdraw_validate', arguments: { document: { pad: 'x'.repeat(MAX_DOCUMENT_BYTES + 1024 * 1024) } } },
    });
    server.sendRaw(huge);
    const oversized = await server.waitFor(m => m.error && m.error.code === -32600, 30000);
    assert.strictEqual(oversized.id, null);

    const stillUp = await server.call('ping', {});
    assert.deepStrictEqual(stillUp.result, {});
  });
});

// A performance regression, not a protocol case: framing that re-copies
// everything buffered so far on every incoming chunk is quadratic in the
// line's length. A ~10MB document delivered as ~64KB writes -- about 160 of
// them -- would not time out from that alone, but it is the shape that
// exposed it; this pins that the answer is still exactly right, not just
// that it eventually arrives. The document itself cannot be schema-valid at
// this size (every SequentDraw field is capped well under 10MB), so the
// oracle is the identical, tiny-padded document run once through the real
// CLI: the padding's length is irrelevant to which structural errors fire,
// only its presence is, so the two must produce byte-identical text.
test('a ~10MB document sent as many small stdin writes answers exactly like the CLI does', async () => {
  await withServer(async server => {
    const paddedDoc = padLength => ({ pad: 'x'.repeat(padLength) });

    const cli = runCli(['validate', '-'], { input: JSON.stringify(paddedDoc(10)) });
    assert.strictEqual(cli.status, 1);

    const id = 4242;
    const line = `${JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: 'sequentdraw_validate', arguments: { document: paddedDoc(10 * 1024 * 1024) } },
    })}\n`;

    const [reply] = await Promise.all([server.waitFor(m => m.id === id, 30000), server.sendChunked(line)]);
    assert.strictEqual(reply.result.isError, true);
    assert.strictEqual(reply.result.content[0].text, cli.stdout + cli.stderr);
  });
});

// --- 10. stdout purity, across everything above --------------------------

test('every line the server ever wrote to stdout parses as a JSON-RPC 2.0 message', async () => {
  await withServer(async server => {
    await server.call('initialize', { protocolVersion: '2025-06-18' });
    server.notify('notifications/initialized');
    await server.call('tools/list', {});
    await server.callTool('sequentdraw_validate', { path: FIXTURE });
    server.sendRaw('not json at all');
    await server.waitFor(m => m.error && m.error.code === -32700);
    await server.call('ping', {});

    assert.ok(server.allLines.length > 0);
    server.allLines.forEach(line => {
      const message = JSON.parse(line); // throws (failing the test) if any line is not JSON
      assert.strictEqual(message.jsonrpc, '2.0');
      assert.ok('result' in message || 'error' in message, `${line} is neither a result nor an error`);
    });
  });
});

// --- 11. closing stdin exits 0 -------------------------------------------

test('closing stdin makes the server exit 0', async () => {
  const server = spawnServer();
  await server.call('initialize', { protocolVersion: '2025-06-18' });
  const exitCode = await new Promise(resolve => {
    server.child.on('exit', code => resolve(code));
    server.child.stdin.end();
  });
  assert.strictEqual(exitCode, 0);
});

// --- test harness: spawn once, always tear down --------------------------

async function withServer(fn) {
  const server = spawnServer();
  try {
    await fn(server);
  } finally {
    server.child.stdin.end();
    await new Promise(resolve => {
      server.child.once('exit', () => resolve());
      setTimeout(resolve, 5000);
    });
    if (server.child.exitCode === null) server.child.kill();
  }
}
