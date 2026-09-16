// Data-access parser: finds the store operations a source file actually
// performs, so an edge can be drawn in the direction work really flows.
//
// Why this exists (CTO-M1-02): edges used to follow docker-compose
// `depends_on`, which means "starts after", not "work flows this way".
// The two coincide only when a service WRITES. On the real voting app
// that made `worker -> redis` and `result -> db` point backwards, turned
// both data stores into sinks pinned to the right of the layout, and left
// the actual chain vote -> redis -> worker -> postgres -> result
// untraceable.
//
// What this module reports is a fact, not a guess: "this file contains a
// SQL INSERT", "this file calls rpush". It never executes the repository
// and never parses it as a program -- these are bounded regexes over
// text, in the same posture as import-parser.js. The operation token
// recorded in the evidence is a NORMALISED keyword we chose (`insert`,
// `rpush`), never a slice of repository text, so nothing from the scanned
// repo can reach the bundle through this path.
//
// Direction is resolved one level up, in scan.js, which only attributes
// an operation to a store when the owning component actually declares a
// client for that store (see resolveDataAccess there). That gate is what
// keeps a generic-looking match -- an RxJS `.psubscribe(`, a SQL string
// in a comment -- from inventing a data store that is not there.

'use strict';

// Every pattern below is bounded: fixed alternations, or a lazy
// quantifier with an explicit upper bound over a negated class that
// cannot cross a statement boundary. No nested quantifiers, so no
// catastrophic backtracking on hostile input.
const SQL_OPS = [
  { op: 'insert', direction: 'write', re: /\binsert\s+into\b/gi },
  { op: 'update', direction: 'write', re: /\bupdate\b[^;]{0,120}?\bset\b/gi },
  { op: 'delete', direction: 'write', re: /\bdelete\s+from\b/gi },
  { op: 'create-table', direction: 'write', re: /\bcreate\s+table\b/gi },
  { op: 'alter-table', direction: 'write', re: /\balter\s+table\b/gi },
  { op: 'truncate', direction: 'write', re: /\btruncate\s+table\b/gi },
  // A SELECT is only counted as a read when it actually names a source
  // to read FROM. That is not just conservatism: it is what keeps the
  // voting-app worker's "SELECT 1" keep-alive ping from registering as a
  // read of the database it is in fact only writing to.
  { op: 'select', direction: 'read', re: /\bselect\b[^;]{0,200}?\bfrom\b/gi },
];

// Redis operations, matched only as method calls (".rpush(") so a bare
// word in prose cannot match. Deliberately limited to DISTINCTIVE names:
// generic `.set(`, `.get(`, `.expire(` and `.subscribe(` are excluded
// because Map.set, RxJS subscribe and friends are everywhere, and a
// false write would flip a reader's arrow. StackExchange.Redis' PascalCase
// method names are included for .NET clients.
const REDIS_OPS = [
  {
    op: 'push',
    direction: 'write',
    re: /\.(?:rpush|lpush|rpushx|lpushx|listleftpush|listrightpush|listrightpushasync|listleftpushasync)\s*\(/gi,
  },
  {
    op: 'publish',
    direction: 'write',
    re: /\.(?:publish|publishasync|xadd|streamadd|streamaddasync)\s*\(/gi,
  },
  {
    op: 'write',
    direction: 'write',
    re: /\.(?:setex|setnx|hset|hmset|sadd|zadd|hashset|hashsetasync|setadd|sortedsetadd|stringsetasync)\s*\(/gi,
  },
  {
    op: 'pop',
    direction: 'read',
    re: /\.(?:blpop|brpop|lpop|rpop|listleftpop|listrightpop|listleftpopasync|listrightpopasync)\s*\(/gi,
  },
  {
    op: 'read',
    direction: 'read',
    re: /\.(?:lrange|llen|smembers|sismember|hgetall|hmget|zrange|xread|xreadgroup|psubscribe|listrange|listlength|hashgetall|setmembers)\s*\(/gi,
  },
];

// Source extensions this parser understands. The patterns are
// language-agnostic (they match SQL text and method calls), so adding a
// language costs nothing but the file read, which the SafeProvider's
// byte budget already bounds. `.cs` is load-bearing: the voting app's
// worker -- the one service in the middle of the pipeline -- is .NET.
const SOURCE_EXT_RE = /\.(?:js|jsx|ts|tsx|mjs|cjs|py|cs|go|rb|java|php)$/i;

// Files this big are almost never hand-written application logic, and
// scanning them for store operations is not worth the time bound.
const MAX_SCAN_LENGTH = 512 * 1024;

function findLineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

function collect(path, content, specs, family, records) {
  for (const spec of specs) {
    spec.re.lastIndex = 0;
    let m;
    let hits = 0;
    while ((m = spec.re.exec(content))) {
      records.push({
        path,
        line: findLineOf(content, m.index),
        op: spec.op,
        family,
        direction: spec.direction,
      });
      // One file does not need to report the same operation a thousand
      // times; the first few are enough to establish the fact and keep
      // the work per file bounded.
      if (++hits >= 20) break;
      if (spec.re.lastIndex === m.index) spec.re.lastIndex++; // zero-width guard
    }
  }
}

// Returns raw, un-attributed operation records:
//   { path, line, op, family: 'sql'|'redis', direction: 'read'|'write' }
// scan.js turns these into `data-access` evidence once it knows which
// component the file belongs to and which store clients that component
// declares.
function parseDataAccess(path, content) {
  const records = [];
  if (typeof content !== 'string' || !SOURCE_EXT_RE.test(path)) return records;
  const text = content.length > MAX_SCAN_LENGTH ? content.slice(0, MAX_SCAN_LENGTH) : content;
  collect(path, text, SQL_OPS, 'sql', records);
  collect(path, text, REDIS_OPS, 'redis', records);
  return records;
}

module.exports = { parseDataAccess, SOURCE_EXT_RE, SQL_OPS, REDIS_OPS };
