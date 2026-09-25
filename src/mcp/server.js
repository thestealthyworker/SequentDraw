// The SequentDraw MCP server: a hand-rolled stdio JSON-RPC 2.0 transport
// (newline-delimited JSON, one message per line) over the six tools in
// ./tools.js. No dependency is added for this -- the surface `initialize`,
// `notifications/initialized`, `ping`, `tools/list` and `tools/call` is
// small enough that a client library would cost more than it saves, and
// step 8a of docs/HANDOVER.md just spent real effort getting `npm audit`
// clean.
//
// Hosts that cannot run a shell command (Cursor, Gemini CLI, Copilot, Codex
// via its own MCP config) reach the engine through this process; Claude Code
// gets it bundled through .claude-plugin/plugin.json's own inline
// "mcpServers" field, deliberately not a root-level .mcp.json -- this repo
// is itself a project contributors open in Claude Code, and a root
// .mcp.json is loaded there too, as a PROJECT-scoped server, where
// ${CLAUDE_PLUGIN_ROOT} does not expand. Every tool call runs the exact
// same `main()` the CLI does (src/mcp/tools.js), so every surface gives the
// same answers and the same refusals.

const { MAX_DOCUMENT_BYTES, TOOL_LIST, callTool } = require('./tools');

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const SERVER_NAME = 'sequentdraw';

// A JSON-RPC line is the tool-call envelope around, at most, one document
// (bounded by MAX_DOCUMENT_BYTES) plus one merge patch of the same cap.
// Nothing legitimate needs more than a modest margin over that for the
// envelope itself (id, method, flag values, file paths), so a line this
// large is refused outright, unparsed -- parsing it first would mean
// holding the whole oversized line in memory just to reject it.
const LINE_SIZE_MARGIN = 64 * 1024;
const MAX_LINE_BYTES = MAX_DOCUMENT_BYTES + LINE_SIZE_MARGIN;

const NEWLINE = 0x0a;

// Only JSON-RPC messages may reach the real stdout. The commands this
// server drives already write through the `io` this module hands `main()`
// (captured in memory, src/mcp/tools.js), never through the process's own
// streams, but a stray console.log from anywhere in the require graph
// would otherwise land on the same stdout a client is parsing as protocol.
function redirectConsoleToStderr(stderr) {
  ['log', 'info', 'warn', 'debug'].forEach(method => {
    // eslint-disable-next-line no-console -- this IS the console override.
    console[method] = (...args) => {
      stderr.write(`${args.map(String).join(' ')}\n`);
    };
  });
}

function negotiateProtocolVersion(requested) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
}

// Starts the server against `io` (defaulting to the real process streams;
// tests pass their own so nothing here ever touches this process's actual
// stdio). Resolves with the exit code once stdin ends and every in-flight
// request -- including anything still queued behind a `tools/call` -- has
// answered.
function runServer(io = {}) {
  const stdin = io.stdin || process.stdin;
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const pkgVersion = io.version || require('../../package.json').version;

  redirectConsoleToStderr(stderr);

  function writeMessage(message) {
    stdout.write(`${JSON.stringify(message)}\n`);
  }
  function respond(id, result) {
    writeMessage({ jsonrpc: '2.0', id, result });
  }
  function respondError(id, code, message) {
    writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
  }

  // Every dispatched request's promise, so stdin ending can wait for all of
  // them -- ping and tools/list answer as soon as they are handled, but
  // this still covers the (unlikely) case one is still pending.
  const pending = new Set();
  function track(promise) {
    pending.add(promise);
    const settle = () => pending.delete(promise);
    promise.then(settle, settle);
    return promise;
  }

  // tools/call requests run one at a time (decision 9: the scan worker is
  // not built for concurrent runs in one process). `queueTail` is always
  // the promise for the most recently queued call, so the next one chains
  // after it; ping and tools/list never join this chain, and answer
  // immediately even while a call is in flight.
  let queueTail = Promise.resolve();

  async function handleToolsCall(id, params) {
    if (!params || typeof params.name !== 'string') {
      respondError(id, -32602, 'tools/call requires a "name" string');
      return;
    }
    const args = params.arguments === undefined ? {} : params.arguments;
    let outcome;
    try {
      outcome = await callTool(params.name, args);
    } catch (err) {
      // None of the six commands are expected to throw -- each already
      // catches its own errors and returns an exit code -- so this is a
      // genuine internal fault, not a document or argument problem.
      respondError(id, -32603, err && err.message ? err.message : String(err));
      return;
    }
    if (outcome.invalidParams) {
      respondError(id, -32602, outcome.invalidParams);
      return;
    }
    respond(id, outcome.result);
  }

  function dispatch(message) {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      respondError(null, -32600, 'Invalid Request');
      return;
    }
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      // A malformed notification (no "id") gets no reply either way --
      // JSON-RPC 2.0 never answers a notification, valid or not.
      if (hasId) respondError(message.id, -32600, 'Invalid Request');
      return;
    }
    if (!hasId) {
      // notifications/initialized and any other notification: nothing to
      // acknowledge, and nothing this server needs to act on.
      return;
    }

    const { id, method, params } = message;
    switch (method) {
      case 'initialize':
        track(
          Promise.resolve().then(() => {
            respond(id, {
              protocolVersion: negotiateProtocolVersion(params && params.protocolVersion),
              capabilities: { tools: {} },
              serverInfo: { name: SERVER_NAME, version: pkgVersion },
            });
          }),
        );
        return;
      case 'ping':
        track(Promise.resolve().then(() => respond(id, {})));
        return;
      case 'tools/list':
        track(Promise.resolve().then(() => respond(id, { tools: TOOL_LIST })));
        return;
      case 'tools/call':
        queueTail = track(queueTail.then(() => handleToolsCall(id, params)));
        return;
      default:
        respondError(id, -32601, `method not found: "${method}"`);
    }
  }

  // Newline-delimited framing over raw bytes (0x0A splits UTF-8 safely: it
  // never appears inside a multi-byte sequence).
  //
  // `pendingChunks`/`pendingLength` hold whatever has arrived for the
  // CURRENT, not-yet-terminated line, as a list of buffers rather than one
  // concatenated buffer: appending a chunk is then O(chunk size), not
  // O(line so far), and each byte is copied at most once, when its line
  // finally completes and the list is concatenated a single time. A naive
  // `buffered = Buffer.concat([buffered, chunk])` on every chunk is
  // quadratic in the line's length -- a 16MB line delivered as 64KB writes
  // would copy on the order of 16MB/64KB * 16MB =~ 2GB.
  //
  // `discarding` is true while skipping the remainder of a line already
  // rejected as oversized, so an arbitrarily long line -- with or without a
  // newline in sight -- still costs bounded memory rather than growing
  // forever while we wait for one; nothing is buffered at all while it is
  // true.
  let pendingChunks = [];
  let pendingLength = 0;
  let discarding = false;

  function resetPending() {
    pendingChunks = [];
    pendingLength = 0;
  }

  function rejectOversizedLine() {
    respondError(null, -32600, `line exceeds the maximum size of ${MAX_LINE_BYTES} bytes`);
    discarding = true;
    resetPending();
  }

  function handleLine(lineBuf) {
    let message;
    try {
      message = JSON.parse(lineBuf.toString('utf8'));
    } catch {
      respondError(null, -32700, 'Parse error');
      return;
    }
    dispatch(message);
  }

  // Scans one incoming chunk for newlines, completing every line it finds
  // (each assembled with exactly one `Buffer.concat`) and buffering
  // whatever is left over as the start of the next line.
  function consumeChunk(chunk) {
    let offset = 0;
    while (offset <= chunk.length) {
      if (discarding) {
        const idx = chunk.indexOf(NEWLINE, offset);
        if (idx === -1) return; // still discarding; nothing to buffer
        discarding = false;
        offset = idx + 1;
        continue;
      }

      const idx = chunk.indexOf(NEWLINE, offset);
      if (idx === -1) {
        const remainder = chunk.subarray(offset);
        if (remainder.length > 0) {
          pendingChunks.push(remainder);
          pendingLength += remainder.length;
        }
        if (pendingLength > MAX_LINE_BYTES) rejectOversizedLine();
        return;
      }

      const segment = chunk.subarray(offset, idx);
      if (pendingLength + segment.length > MAX_LINE_BYTES) {
        rejectOversizedLine();
      } else {
        const lineBuf =
          pendingChunks.length === 0 ? segment : Buffer.concat([...pendingChunks, segment], pendingLength + segment.length);
        resetPending();
        handleLine(lineBuf);
      }
      offset = idx + 1;
    }
  }

  return new Promise(resolve => {
    stdin.on('data', chunk => {
      consumeChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    async function finish() {
      // A final line with no trailing newline still counts -- a well
      // behaved client always terminates its last line, but nothing here
      // should hang waiting for a newline that stdin ending has already
      // made impossible. Its size was already checked as it was buffered,
      // so nothing here can exceed MAX_LINE_BYTES.
      if (!discarding && pendingLength > 0) {
        const lineBuf = pendingChunks.length === 1 ? pendingChunks[0] : Buffer.concat(pendingChunks, pendingLength);
        resetPending();
        handleLine(lineBuf);
      }
      await Promise.allSettled([queueTail, ...pending]);
      resolve(0);
    }

    stdin.on('end', () => {
      finish();
    });
    stdin.on('error', () => {
      finish();
    });
  });
}

module.exports = { runServer, SUPPORTED_PROTOCOL_VERSIONS, DEFAULT_PROTOCOL_VERSION, MAX_LINE_BYTES };
