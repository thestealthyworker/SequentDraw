// The scan step: runs SequentDraw's own small parsers (compose, workflow,
// manifests, SDK imports, routes, env names, .NET project files, data
// access) and the dependency-manifest parsers vendored from stack-analyser
// (src/scan/rules/) against an already-acquired local directory, through
// the SafeProvider, and assembles the evidence bundle.
//
// This module never touches the network and never executes anything in
// the scanned repository: every parser here is regex/JSON/TOML/YAML parse
// over text handed
// back by SafeProvider -- nothing here calls eval, require()s a path
// inside the scanned repo, or shells out.

const path = require('node:path');

const { SafeProvider } = require('./safe-provider');
const { assembleEvidence, mapDependencyTuples } = require('./evidence');
const { readDependencyManifests } = require('./rules/dependency-manifests');
const { parseCompose } = require('./parsers/compose-parser');
const { parseWorkflow } = require('./parsers/workflow-parser');
const { parsePackageJson, parseRequirementsTxt } = require('./parsers/manifest-parser');
const { parseImports } = require('./parsers/import-parser');
const { parseRoute } = require('./parsers/route-parser');
const { parseEnvNames } = require('./parsers/env-parser');
const { parseCsproj } = require('./parsers/csproj-parser');
const {
  parsePackageComponents,
  parsePluginManifest,
  parseComponentPath,
  PLUGIN_MANIFEST_RE,
} = require('./parsers/component-parser');
const { parseDataAccess, SOURCE_EXT_RE } = require('./parsers/data-access-parser');
const { parseYamlSafe } = require('./yaml-safe');
const { lookup } = require('./crosswalk');
const {
  RelevancePolicy,
  productRootsFromPackageJson,
  productRootsFromCompose,
  normalise: normaliseRel,
} = require('./exclusions');

const COMPOSE_FILE_RE = /(^|\/)docker-compose[^/]*\.ya?ml$/i;
const COMPOSE_SPEC_FILE_RE = /(^|\/)compose[^/]*\.ya?ml$/i;
const WORKFLOW_FILE_RE = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i;
const JS_TS_RE = /\.(js|jsx|ts|tsx|mjs|cjs)$/i;
const ENV_FILE_RE = /(^|\/)\.env(\.|$)/i;
const DOTNET_PROJECT_RE = /\.(csproj|fsproj|vbproj)$/i;

// The manifests read in the pre-pass, before the walk, to learn what the
// repository says about itself.
const ROOT_COMPOSE_NAMES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

// Evidence kinds that come from a compose file, and can therefore be
// stated more than once when a repo ships compose variants.
const COMPOSE_KINDS = new Set(['compose-service', 'depends-on', 'image', 'build-context']);

// Stores a component can be said to talk to. A crosswalk hit outside this
// set (react, express, ...) says nothing about data flow.
const STORE_TECHS = new Set(['postgresql', 'mysql', 'mongodb', 'redis', 'rabbitmq', 'kafka', 'elasticsearch']);

// Which concrete stores an operation of each family could belong to. A
// family is only resolved when the owning component declares exactly one
// matching client -- never guessed.
const FAMILY_TECHS = { sql: ['postgresql', 'mysql'], redis: ['redis'] };

function isComposeFile(relPath) {
  return COMPOSE_FILE_RE.test(relPath) || COMPOSE_SPEC_FILE_RE.test(relPath);
}

// Recursively collects every file path the SafeProvider is willing to
// list (directories/files it skips -- node_modules, symlinks, excluded
// test/fixture paths, files past the listing cap -- never appear here,
// because listDir() already enforces that). Returns absolute paths.
async function collectFiles(provider, dirPath, out) {
  const entries = await provider.listDir(dirPath);
  for (const entry of entries) {
    if (entry.type === 'dir') {
      await collectFiles(provider, entry.fp, out);
    } else {
      out.push(entry.fp);
    }
  }
  return out;
}

// Pre-pass (CTO-M1-01): before walking anything, read the repository's own
// root manifests and ask them what the product is. package.json's `files`,
// `bin`, `main`, `exports` and `workspaces`, and every compose service's
// build context, are the repository's own statement of which directories
// it is made of. Those become the product roots that can rescue an
// otherwise test-looking directory, so a project that genuinely ships an
// `examples/` workspace is not stripped of its own product.
//
// Reads a fixed, tiny set of root paths by name -- no listing, so this
// costs nothing on a huge repo and cannot itself be steered by repo
// content.
async function buildRelevancePolicy(provider) {
  const roots = [];

  const pkgText = await provider.open(path.join(provider.basePath, 'package.json'));
  if (pkgText != null) roots.push(...productRootsFromPackageJson(pkgText));

  for (const name of ROOT_COMPOSE_NAMES) {
    const text = await provider.open(path.join(provider.basePath, name));
    if (text == null) continue;
    roots.push(...productRootsFromCompose(parseYamlSafe(text)));
  }

  return new RelevancePolicy(roots);
}

// Runs every custom parser against the files the walk found. Returns raw
// (id-less) evidence records, plus the un-attributed data-access
// operations, which need whole-repo context (which component owns a file,
// which store clients that component declares) before they can become
// evidence.
async function runCustomParsers(provider, absolutePaths) {
  const records = [];
  const dataOps = [];

  for (const absPath of absolutePaths) {
    const relPath = provider.relPath(absPath);
    const basename = path.basename(relPath);

    // Route detection is a pure filename-convention match: no content
    // needed, and it must run even for files the provider would
    // otherwise refuse to open (it never does for .ts/.js source, but
    // keeping this content-independent keeps the rule simple).
    if (JS_TS_RE.test(relPath)) {
      records.push(...parseRoute(relPath));
    }

    // Layout-convention components (a shipped skill). Like parseRoute
    // above this needs no file content, so it costs one regex per path.
    records.push(...parseComponentPath(relPath));

    if (ENV_FILE_RE.test(basename)) {
      // Always call open(): for a real .env* file this returns null and
      // (as a side effect) records the real-env-file finding; for the
      // three safe example names it returns the value-stripped content.
      const content = await provider.open(absPath);
      if (content != null) records.push(...parseEnvNames(relPath, content));
      continue;
    }

    if (WORKFLOW_FILE_RE.test(relPath)) {
      const content = await provider.open(absPath);
      if (content != null) records.push(...parseWorkflow(relPath, content));
      continue;
    }

    if (isComposeFile(relPath)) {
      const content = await provider.open(absPath);
      if (content != null) records.push(...parseCompose(relPath, content));
      continue;
    }

    if (PLUGIN_MANIFEST_RE.test(relPath)) {
      const content = await provider.open(absPath);
      if (content != null) records.push(...parsePluginManifest(relPath, content));
      continue;
    }

    if (basename === 'package.json') {
      const content = await provider.open(absPath);
      if (content != null) {
        records.push(...parsePackageJson(relPath, content));
        // What this package IS (its executables, its entry point), not
        // just what it depends on.
        records.push(...parsePackageComponents(relPath, content));
      }
      continue;
    }

    if (basename === 'requirements.txt') {
      const content = await provider.open(absPath);
      if (content != null) records.push(...parseRequirementsTxt(relPath, content));
      continue;
    }

    // .NET project files (CTO-M1-05): the voting app's worker declares
    // its Postgres and Redis clients, and its target framework, here and
    // nowhere else. Without this the whole service was invisible.
    if (DOTNET_PROJECT_RE.test(relPath)) {
      const content = await provider.open(absPath);
      if (content != null) records.push(...parseCsproj(relPath, content));
      continue;
    }

    if (SOURCE_EXT_RE.test(relPath)) {
      const content = await provider.open(absPath);
      if (content != null) {
        records.push(...parseImports(relPath, content)); // no-op for non JS/TS/Python
        dataOps.push(...parseDataAccess(relPath, content));
      }
    }
  }

  return { records, dataOps };
}

// --- compose variants (CTO-M1-05) -------------------------------------
//
// A repo may ship several compose files: the real one, an images-only
// variant, an overlay. They restate the same services, which used to make
// the voting app's five services look like seventeen. The canonical file
// is the standard-named one nearest the root; a variant's restatement of
// a fact the canonical file already states is dropped as a duplicate and
// recorded, while anything a variant states that the canonical one does
// NOT (a pre-built image name, an extra service) is kept, because that is
// genuinely new information.
function pickCanonicalCompose(paths) {
  const scored = paths.map(p => {
    const base = path.basename(p).toLowerCase();
    const standard = ROOT_COMPOSE_NAMES.includes(base) ? 0 : 1;
    const depth = p.split('/').length;
    return { p, standard, depth };
  });
  scored.sort((a, b) => a.standard - b.standard || a.depth - b.depth || (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
  return scored.length > 0 ? scored[0].p : null;
}

function composeIdentity(record) {
  return `${record.kind} ${record.value || ''} ${record.from || ''} ${record.to || ''}`;
}

function dedupeComposeVariants(records) {
  const composePaths = [...new Set(records.filter(r => COMPOSE_KINDS.has(r.kind)).map(r => r.path))];
  if (composePaths.length <= 1) return { records, duplicates: [] };

  const canonical = pickCanonicalCompose(composePaths);
  const canonicalIdentities = new Set(
    records.filter(r => COMPOSE_KINDS.has(r.kind) && r.path === canonical).map(composeIdentity),
  );

  const kept = [];
  const duplicates = [];
  for (const record of records) {
    if (COMPOSE_KINDS.has(record.kind) && record.path !== canonical && canonicalIdentities.has(composeIdentity(record))) {
      duplicates.push(record);
      continue;
    }
    kept.push(record);
  }
  return { records: kept, duplicates, canonical };
}

// --- data-access attribution (CTO-M1-02) ------------------------------

// Which component a file belongs to. A compose `build` context is
// authoritative (`worker/Program.cs` belongs to the `worker` service);
// otherwise the top-level directory names the component, and a file at
// the repo root belongs to the repo itself.
function makeComponentResolver(records, repoName) {
  const contexts = [];
  for (const record of records) {
    if (record.kind !== 'build-context') continue;
    const dir = normaliseRel(record.to);
    if (!dir || typeof record.from !== 'string') continue;
    contexts.push({ dir, service: record.from });
  }
  contexts.sort((a, b) => b.dir.length - a.dir.length); // longest prefix wins

  return function componentOf(relPath) {
    const rel = normaliseRel(relPath);
    for (const { dir, service } of contexts) {
      if (rel === dir || rel.startsWith(`${dir}/`)) return service;
    }
    const segments = rel.split('/');
    return segments.length > 1 ? segments[0] : repoName;
  };
}

// Which stores each component declares a client for, from its own
// manifest entries and SDK imports. This is the gate that keeps a stray
// regex match from inventing a data store: an operation is only ever
// attributed to a store the component demonstrably has a client for.
function clientsByComponent(records, componentOf) {
  const map = new Map();
  for (const record of records) {
    if (record.kind !== 'sdk-import' && record.kind !== 'manifest-dependency') continue;
    if (typeof record.value !== 'string') continue;
    const cross = lookup(record.value);
    if (!cross || !STORE_TECHS.has(cross.tech)) continue;
    const component = componentOf(record.path);
    if (!component) continue;
    if (!map.has(component)) map.set(component, new Set());
    map.get(component).add(cross.tech);
  }
  return map;
}

// Turns raw operations into one `data-access` fact per
// (component, store) pair.
//
// The direction rule, and why it is this way: if a component WRITES to a
// store at all, work flows into that store, so the arrow points at the
// store. A component that only ever reads is downstream of it, so the
// arrow points away from the store. That single rule is what makes the
// voting app read vote -> redis -> worker -> db -> result: vote only
// pushes, the worker only pops from redis but inserts into the database,
// and result only selects.
function resolveDataAccess(records, dataOps, repoName) {
  const componentOf = makeComponentResolver(records, repoName);
  const clients = clientsByComponent(records, componentOf);
  const pairs = new Map();

  const sorted = [...dataOps].sort(
    (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || (a.line || 0) - (b.line || 0) || (a.op < b.op ? -1 : a.op > b.op ? 1 : 0),
  );

  for (const operation of sorted) {
    const component = componentOf(operation.path);
    if (!component) continue;
    const declared = clients.get(component);
    if (!declared) continue;

    const candidates = (FAMILY_TECHS[operation.family] || []).filter(tech => declared.has(tech));
    // Zero candidates: the component has no client for this kind of
    // store, so this match is not evidence of anything. More than one
    // (a component wired to both Postgres and MySQL): which store this
    // statement hits is genuinely unknown, and guessing is exactly what
    // this engine must not do. Either way, no fact is recorded.
    if (candidates.length !== 1) continue;

    const key = `${component} ${candidates[0]}`;
    if (!pairs.has(key)) pairs.set(key, { component, tech: candidates[0], reads: [], writes: [] });
    const bucket = pairs.get(key);
    (operation.direction === 'write' ? bucket.writes : bucket.reads).push(operation);
  }

  const out = [];
  for (const { component, tech, reads, writes } of pairs.values()) {
    const direction = writes.length > 0 ? 'write' : 'read';
    const chosen = (direction === 'write' ? writes : reads)[0];
    const cross = lookup(tech);
    out.push({
      kind: 'data-access',
      path: chosen.path,
      line: chosen.line,
      value: chosen.op,
      from: component,
      to: tech,
      direction,
      tech,
      icon: cross ? cross.icon : null,
    });
  }
  return out;
}

// Everything the scan deliberately left out, so the skill can tell the
// user rather than presenting a quietly partial picture.
function buildExclusions(provider, duplicates) {
  const entries = provider.findings
    .filter(f => f.kind === 'excluded-path')
    .map(f => ({ path: f.path, reason: f.reason, ambiguous: f.ambiguous === true }));

  const seenDuplicatePaths = new Set();
  for (const record of duplicates) {
    if (seenDuplicatePaths.has(record.path)) continue;
    seenDuplicatePaths.add(record.path);
    entries.push({ path: record.path, reason: 'duplicate-compose-variant', ambiguous: false });
  }

  if (provider.excludedSuppressed > 0) {
    entries.push({
      path: '(more)',
      reason: 'exclusion-list-truncated',
      ambiguous: false,
      count: provider.excludedSuppressed,
    });
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || (a.reason < b.reason ? -1 : 1));
  return entries;
}

// Scans an already-acquired local directory and returns the evidence
// bundle. `meta` carries what the caller already knows about the source
// (acquire.js resolves this): { name, source: 'local'|'github', ref }.
// `ref` is whatever the caller already resolved (the cloned commit SHA
// for a GitHub source); scan.js never independently probes a directory's
// git ancestry for a ref, so a local scan never reports the SHA of some
// unrelated enclosing repository the folder happens to sit inside.
async function scanPath(repoPath, meta, providerOptions = {}) {
  const provider = new SafeProvider({ path: repoPath, ...providerOptions });

  // Ask the repository what it is before walking it, then install the
  // resulting policy on the single filesystem gateway, so every parser
  // inherits it.
  provider.relevance = await buildRelevancePolicy(provider);

  // One walk, one files-listed budget (provider.filesListed). Until step 8a
  // stack-analyser ran a second traversal of its own after this one, over
  // whatever budget remained; now every parser reads from this single list.
  const allFiles = await collectFiles(provider, provider.basePath, []);
  const { records: customRecords, dataOps } = await runCustomParsers(provider, allFiles);

  // Manifests for the ecosystems with no bespoke parser: Go, Rust, Ruby,
  // PHP, Deno, Terraform and Actions `uses:` lines. Vendored from
  // stack-analyser in build step 8a (src/scan/rules/); read from the same
  // file list our own walk produced, so there is one traversal and one
  // files-listed budget instead of two walks competing for it.
  const dependencyRecords = mapDependencyTuples(await readDependencyManifests(provider, allFiles));

  const realEnvRecords = provider.findings
    .filter(f => f.kind === 'real-env-file')
    .map(f => ({ kind: 'real-env-file', path: f.path, line: null }));

  const deduped = dedupeComposeVariants([...customRecords, ...dependencyRecords, ...realEnvRecords]);
  const dataAccessRecords = resolveDataAccess(deduped.records, dataOps, meta.name);

  const evidence = assembleEvidence([...deduped.records, ...dataAccessRecords]);

  return {
    repo: { name: meta.name, source: meta.source, ref: meta.ref || null },
    limits: {
      files: provider.filesListed,
      bytes: provider.bytesOpened,
      truncated: provider.truncated,
      reason: provider.reason,
    },
    findings: provider.findings.filter(f => f.kind !== 'excluded-path').map(f => ({ ...f })),
    exclusions: buildExclusions(provider, deduped.duplicates),
    evidence,
  };
}

module.exports = {
  scanPath,
  collectFiles,
  runCustomParsers,
  buildRelevancePolicy,
  dedupeComposeVariants,
  resolveDataAccess,
};
