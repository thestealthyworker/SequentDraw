// Tool definitions for the SequentDraw MCP server: one tool per CLI
// command, each a thin adapter over `COMMANDS[name].run(args, io)` from
// src/cli/index.js. This file owns three things per tool: the JSON Schema
// a host shows the model (`tools/list`), the hand-written check that
// validates a `tools/call`'s arguments against that schema before anything
// is built from them, and the argv/stdin this tool's CLI command actually
// needs.
//
// Why hand-written validation and not a schema library: this module ships
// in the npm package, where only "dependencies" install (never
// devDependencies, which is where ajv already lives for this repo's own
// tests) -- see docs/HANDOVER.md step 8a and the decision this brief holds
// to, "no new dependency". The six schemas below are simple enough (flat
// objects, string/boolean/integer/array-of-string/object properties) that
// hand-checking type, required, and additionalProperties is a page of code,
// not a parser.
//
// The one rule every schema shares: a caller-given STRING value may never
// start with "-". Every such value ends up on an argv the CLI's own parsers
// read positionally or as a flag's value, and several of those parsers only
// special-case the literal "-" (the stdin sentinel we choose ourselves,
// never accept from a caller) while rejecting every other leading dash as
// an unknown flag. Refusing it here, uniformly, means no single tool has to
// re-derive which of its string arguments could be read as an option by
// the command it drives -- and a value that slipped through would not be
// "misread as a flag", because none of these commands take positional
// argv from a caller that was not already checked against a real path or a
// real repository id.
//
// A document or a merge patch given inline never touches this rule: it is
// typed "object" and travels over stdin (or a temp file) as raw JSON text,
// never as an argv token, so its own content -- including a field starting
// with "-" -- is the workflow's business, not this file's.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { main } = require('../cli/index');
const { STDIN_PATH, MAX_DOCUMENT_BYTES } = require('../cli/read-document');
const { CATEGORIES } = require('../catalogue');

// A merge patch given inline, when the document is ALSO inline (so stdin is
// already taken), is written under this prefix and removed in a `finally`.
// Exported so the test that proves the temp file is really gone can find it
// without hardcoding the string twice.
const MERGE_TMP_PREFIX = 'sequentdraw-mcp-merge-';

const DOCUMENT_PROPS = {
  document: { type: 'object', description: 'The workflow JSON document, given inline.' },
  path: { type: 'string', description: 'A file path to the workflow JSON document.' },
};

const MERGE_PROPS = {
  merge: { type: 'object', description: 'A merge patch, given inline (same shape as "sequentdraw check --merge").' },
  merge_path: { type: 'string', description: 'A file path to a merge patch.' },
};

// --- hand-written schema check --------------------------------------------

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

// Returns an error string, or null when `value` satisfies `propSchema`.
// Deliberately narrow: it only knows the JSON Schema vocabulary this file's
// six tools actually use.
function checkValue(key, value, propSchema) {
  switch (propSchema.type) {
    case 'string':
      if (typeof value !== 'string') return `"${key}" must be a string`;
      if (value.startsWith('-')) return `"${key}" must not start with "-"`;
      if (propSchema.enum && !propSchema.enum.includes(value)) {
        return `"${key}" must be one of: ${propSchema.enum.join(', ')}`;
      }
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : `"${key}" must be a boolean`;
    case 'integer':
      if (!Number.isInteger(value)) return `"${key}" must be an integer`;
      if (propSchema.minimum != null && value < propSchema.minimum) {
        return `"${key}" must be >= ${propSchema.minimum}`;
      }
      return null;
    case 'object':
      return isPlainObject(value) ? null : `"${key}" must be an object`;
    case 'array': {
      if (!Array.isArray(value)) return `"${key}" must be an array`;
      if (propSchema.minItems != null && value.length < propSchema.minItems) {
        return `"${key}" must have at least ${propSchema.minItems} item(s)`;
      }
      const itemType = propSchema.items && propSchema.items.type;
      for (const item of value) {
        if (itemType === 'string') {
          if (typeof item !== 'string') return `every item of "${key}" must be a string`;
          if (item.startsWith('-')) return `every item of "${key}" must not start with "-"`;
        }
      }
      return null;
    }
    default:
      return null;
  }
}

// Validates `args` against `schema` (properties/required/additionalProperties
// is always false for these six tools). Returns { error } or { value: args }.
function checkSchema(schema, args) {
  if (!isPlainObject(args)) return { error: 'arguments must be an object' };
  const props = schema.properties || {};
  for (const key of Object.keys(args)) {
    if (!(key in props)) return { error: `unknown argument "${key}"` };
  }
  for (const key of schema.required || []) {
    if (!(key in args)) return { error: `missing required argument "${key}"` };
  }
  for (const [key, value] of Object.entries(args)) {
    const err = checkValue(key, value, props[key]);
    if (err) return { error: err };
  }
  return { value: args };
}

// The one cross-field rule every document-taking tool shares: exactly one
// of "document" or "path", never both and never neither.
function checkDocumentPair(args) {
  const hasDoc = 'document' in args;
  const hasPath = 'path' in args;
  if (hasDoc && hasPath) return 'give "document" or "path", not both';
  if (!hasDoc && !hasPath) return 'give either "document" or "path"';
  return null;
}

// The same shape, one level down: a merge patch may be inline or by path,
// but never both. Unlike the document, it is optional.
function checkMergePair(args) {
  if ('merge' in args && 'merge_path' in args) return 'give "merge" or "merge_path", not both';
  return null;
}

// --- turning validated arguments into argv + stdin -------------------------

// Chooses the input argv token for a document/path pair, and the stdin text
// it needs (or null when the document comes from a real file and stdin is
// untouched).
function documentInput(args) {
  if ('document' in args) return { argvInput: STDIN_PATH, stdinText: JSON.stringify(args.document) };
  return { argvInput: args.path, stdinText: null };
}

// Chooses the argv token for an optional merge patch, and how it reaches
// the command. When the document already claimed stdin, a merge given
// inline cannot also read "-" -- the CLI's own commands read the document
// first and stdin has already ended by the time they would look for the
// patch -- so it is written to a private temp file instead, removed by the
// caller's `finally`. `takenStdin` is whatever the document step already
// decided to send over stdin (or null).
function mergeInput(args, takenStdin) {
  if ('merge' in args) {
    if (takenStdin != null) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), MERGE_TMP_PREFIX));
      const file = path.join(dir, 'merge.json');
      fs.writeFileSync(file, JSON.stringify(args.merge));
      return { mergeArgv: file, stdinText: takenStdin, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
    }
    return { mergeArgv: STDIN_PATH, stdinText: JSON.stringify(args.merge), cleanup: noop };
  }
  if ('merge_path' in args) return { mergeArgv: args.merge_path, stdinText: takenStdin, cleanup: noop };
  return { mergeArgv: null, stdinText: takenStdin, cleanup: noop };
}

function noop() {}

// --- the six tools -----------------------------------------------------

const TOOLS = [
  {
    name: 'sequentdraw_render',
    description: 'Render a SequentDraw workflow JSON document to an interactive HTML map or a static SVG figure. Mirrors "sequentdraw render".',
    inputSchema: {
      type: 'object',
      properties: {
        ...DOCUMENT_PROPS,
        ...MERGE_PROPS,
        out: { type: 'string', description: 'Output file path, ending in .html or .svg.' },
        layers: { type: 'array', items: { type: 'string' }, description: 'SVG output only: extra layers beyond "base".' },
        fragment: { type: 'boolean', description: 'HTML output only: emit the artifact fragment instead of a full document.' },
      },
      required: ['out'],
      additionalProperties: false,
    },
    checkArgs(args) {
      return checkDocumentPair(args) || checkMergePair(args);
    },
    buildArgv(args) {
      const { argvInput, stdinText: docStdin } = documentInput(args);
      const { mergeArgv, stdinText, cleanup } = mergeInput(args, docStdin);
      const argv = ['render', argvInput, args.out];
      if (args.layers && args.layers.length) argv.push('--layers', args.layers.join(','));
      if (args.fragment) argv.push('--fragment');
      if (mergeArgv != null) argv.push('--merge', mergeArgv);
      return { argv, stdinText, cleanup };
    },
  },
  {
    name: 'sequentdraw_validate',
    description: 'Validate a SequentDraw workflow JSON document against the schema and structural invariants. Mirrors "sequentdraw validate".',
    inputSchema: {
      type: 'object',
      properties: { ...DOCUMENT_PROPS },
      additionalProperties: false,
    },
    checkArgs(args) {
      return checkDocumentPair(args);
    },
    buildArgv(args) {
      const { argvInput, stdinText } = documentInput(args);
      return { argv: ['validate', argvInput], stdinText, cleanup: noop };
    },
  },
  {
    name: 'sequentdraw_scan',
    description: 'Scan a local repository or GitHub URL into an evidence bundle. Mirrors "sequentdraw scan".',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'A local path or a https://github.com/<owner>/<repo> URL.' },
        out: { type: 'string', description: 'Where to write the evidence bundle.' },
        timeout: { type: 'integer', minimum: 1, description: 'Hard deadline for the scan step, in milliseconds.' },
      },
      required: ['source', 'out'],
      additionalProperties: false,
    },
    checkArgs() {
      return null;
    },
    buildArgv(args) {
      const argv = ['scan', args.source, '--out', args.out];
      if (args.timeout != null) argv.push('--timeout', String(args.timeout));
      return { argv, stdinText: null, cleanup: noop };
    },
  },
  {
    name: 'sequentdraw_check',
    description: 'Check a SequentDraw map: structure, scan-sourced claims against an evidence bundle, completeness, and repository notes against verified licences. Mirrors "sequentdraw check".',
    inputSchema: {
      type: 'object',
      properties: {
        ...DOCUMENT_PROPS,
        ...MERGE_PROPS,
        evidence: { type: 'string', description: 'File path to the evidence bundle from "sequentdraw scan".' },
        repos: { type: 'string', description: 'File path to the verdicts from "sequentdraw licences".' },
        emit_open: { type: 'string', description: 'Write a copy of the map with one open node per completeness gap.' },
      },
      additionalProperties: false,
    },
    checkArgs(args) {
      return checkDocumentPair(args) || checkMergePair(args);
    },
    buildArgv(args) {
      const { argvInput, stdinText: docStdin } = documentInput(args);
      const { mergeArgv, stdinText, cleanup } = mergeInput(args, docStdin);
      const argv = ['check', argvInput];
      if (mergeArgv != null) argv.push('--merge', mergeArgv);
      if (args.evidence != null) argv.push('--evidence', args.evidence);
      if (args.repos != null) argv.push('--repos', args.repos);
      if (args.emit_open != null) argv.push('--emit-open', args.emit_open);
      return { argv, stdinText, cleanup };
    },
  },
  {
    name: 'sequentdraw_catalogue',
    description: 'List the integrations SequentDraw can suggest. Mirrors "sequentdraw catalogue".',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: CATEGORIES, description: 'Only list one category.' },
        json: { type: 'boolean', description: 'Return a JSON array instead of the text listing.' },
      },
      additionalProperties: false,
    },
    checkArgs() {
      return null;
    },
    buildArgv(args) {
      const argv = ['catalogue'];
      if (args.category != null) argv.push('--category', args.category);
      if (args.json) argv.push('--json');
      return { argv, stdinText: null, cleanup: noop };
    },
  },
  {
    name: 'sequentdraw_licences',
    description: 'Verify candidate repositories through the GitHub API (MIT only, active, not a fork) and write the verdicts. Mirrors "sequentdraw licences". The token, if any, is read server-side from the environment variable named by "token_env"; it is never an argument.',
    inputSchema: {
      type: 'object',
      properties: {
        repos: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'owner/repo identifiers to verify.' },
        out: { type: 'string', description: 'Where to write the verdicts.' },
        token_env: { type: 'string', description: 'Environment variable holding a GitHub token (default GITHUB_TOKEN).' },
        max: { type: 'integer', minimum: 1, description: 'Refuse a run of more than this many repositories.' },
      },
      required: ['repos', 'out'],
      additionalProperties: false,
    },
    checkArgs() {
      return null;
    },
    buildArgv(args) {
      const argv = ['licences', ...args.repos, '--out', args.out];
      if (args.token_env != null) argv.push('--token-env', args.token_env);
      if (args.max != null) argv.push('--max', String(args.max));
      return { argv, stdinText: null, cleanup: noop };
    },
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map(tool => [tool.name, tool]));

// The `tools/list` payload: name, description and inputSchema only -- never
// the internal checkArgs/buildArgv functions.
const TOOL_LIST = TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

// Builds a Readable that yields `text` (or nothing) and then ends, so a
// command that calls readDocument(path, stdin) with `path` other than "-"
// never touches it, and one that reads "-" gets exactly this text. Real
// process.stdin is never handed to a command run through the MCP server --
// see src/mcp/server.js for why that separation matters.
function stdinFromText(text) {
  const { Readable } = require('stream');
  const readable = new Readable({ read() {} });
  readable.push(text == null ? null : Buffer.from(text, 'utf8'));
  if (text != null) readable.push(null);
  readable.isTTY = false;
  return readable;
}

function captureStream() {
  let text = '';
  return {
    write(chunk) {
      text += chunk;
      return true;
    },
    get text() {
      return text;
    },
  };
}

// Runs one tool call to completion: validates arguments against the tool's
// declared schema and cross-field rules, then calls the same
// `COMMANDS[name].run` src/cli/index.js's `main()` would, with stdout and
// stderr captured in memory and stdin built from whatever the arguments
// need. Returns either `{ invalidParams: <message> }` (never run) or
// `{ result: { content, isError } }`.
async function callTool(name, args) {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return { invalidParams: `unknown tool "${name}"` };

  const checked = checkSchema(tool.inputSchema, args == null ? {} : args);
  if (checked.error) return { invalidParams: checked.error };

  const crossError = tool.checkArgs(checked.value);
  if (crossError) return { invalidParams: crossError };

  const { argv, stdinText, cleanup } = tool.buildArgv(checked.value);
  const stdout = captureStream();
  const stderr = captureStream();
  const stdin = stdinFromText(stdinText);

  let exitCode;
  try {
    exitCode = await main(argv, { stdout, stderr, stdin });
  } finally {
    cleanup();
  }

  return {
    result: {
      content: [{ type: 'text', text: stdout.text + stderr.text }],
      isError: exitCode !== 0,
    },
  };
}

module.exports = { TOOLS, TOOL_LIST, callTool, MERGE_TMP_PREFIX, MAX_DOCUMENT_BYTES };
