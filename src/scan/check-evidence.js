// Enforces the evidence contract (docs/design/git-map.md section 3,
// "sequentdraw check --evidence bundle.json") structurally: every node or
// edge that claims `source: "scan"` must cite evidence that actually
// exists in the bundle and actually supports the claim. This is the
// engine half of "evidence, not guesses" -- the skill (a later PR)
// authors the workflow JSON, this function is what stops a document from
// shipping with a citation that does not hold up.
//
// Returns validator-format errors: `{ path, code, message }`, same shape
// as src/n8n/validate.js's ValidationError#errors, so a caller can run
// both checks and report everything in one pass. checkEvidence() never
// throws on a malformed doc/bundle -- it treats anything not shaped as
// expected as "nothing to check there" and returns whatever errors it
// could still establish. Bounding the same way validate.js does (array
// caps before per-item work, echoed strings truncated) matters here too:
// doc and bundle both come from untrusted input paths (an AI tool's
// output, and a scan of a third-party repository).

const NODES_MAX_COUNT = 100;
const EDGES_MAX_COUNT = 500;
const MAX_ERRORS = 100;
const ECHO_MAX_LENGTH = 60;

function isPlainObjectish(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function truncate(value) {
  const s = typeof value === 'string' ? value : String(value);
  return s.length > ECHO_MAX_LENGTH ? `${s.slice(0, ECHO_MAX_LENGTH)}…` : s;
}

function norm(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

function boundedArray(value, max) {
  if (!Array.isArray(value)) return [];
  return value.length > max ? [] : value;
}

function indexEvidence(bundle) {
  const byId = new Map();
  const list = bundle && Array.isArray(bundle.evidence) ? bundle.evidence : [];
  for (const entry of list) {
    if (entry && typeof entry.id === 'string') byId.set(entry.id, entry);
  }
  return byId;
}

function indexNodes(doc) {
  const byId = new Map();
  const nodes = boundedArray(doc && doc.nodes, NODES_MAX_COUNT);
  for (const node of nodes) {
    if (isPlainObjectish(node) && typeof node.id === 'string') byId.set(node.id, node);
  }
  return byId;
}

// The set of "identifying strings" a node can be matched against when
// deciding whether a relationship fact "connects" to it: the node's own
// id and label (a scan-authored node's label is very often exactly the
// evidence value it was built from -- a compose service name, a package
// name), plus the value/tech of every evidence entry the node itself
// cites. Matching is case-insensitive, trimmed.
function identifiersFor(node, evidenceById) {
  const ids = new Set();
  if (!isPlainObjectish(node)) return ids;
  if (typeof node.id === 'string') ids.add(norm(node.id));
  if (typeof node.label === 'string') ids.add(norm(node.label));
  const cited = Array.isArray(node.evidence) ? node.evidence : [];
  for (const id of cited) {
    const entry = typeof id === 'string' ? evidenceById.get(id) : null;
    if (!entry) continue;
    if (entry.value != null) ids.add(norm(entry.value));
    if (entry.tech != null) ids.add(norm(entry.tech));
  }
  ids.delete(null);
  ids.delete('');
  return ids;
}

// Whether a single evidence entry is the kind of fact that can connect
// two endpoints at all (depends-on: relational by construction;
// sdk-import / route: a component using/exposing a technology, weaker
// but still a real connection) and whether it actually links the two
// given identifier sets, in either direction.
function factConnects(entry, fromIds, toIds) {
  if (!entry) return false;

  // Both of these are relational by construction: they name two
  // endpoints. `data-access` ("this component performs this operation
  // against this store") is the fact CTO-M1-02's direction inference
  // rests on, so an edge may cite it -- under exactly the same
  // requirement as depends-on, that its two named endpoints are the
  // edge's two endpoints. Orientation is not checked here: this function
  // answers "is these two things connected", and the map's arrow
  // direction is the skill's decision, made from the entry's own
  // `direction` field.
  if (entry.kind === 'depends-on' || entry.kind === 'data-access') {
    const from = norm(entry.from);
    const to = norm(entry.to);
    if (!from || !to) return false;
    return (fromIds.has(from) && toIds.has(to)) || (fromIds.has(to) && toIds.has(from));
  }

  if (entry.kind === 'sdk-import' || entry.kind === 'route') {
    const value = norm(entry.value);
    const tech = norm(entry.tech);
    const hits = ids => (value && ids.has(value)) || (tech && ids.has(tech));
    return hits(fromIds) || hits(toIds);
  }

  return false;
}

function checkEvidence(doc, bundle) {
  const errors = [];
  if (!isPlainObjectish(doc)) return errors;

  const evidenceById = indexEvidence(bundle);
  const nodesById = indexNodes(doc);

  const nodes = boundedArray(doc.nodes, NODES_MAX_COUNT);
  const edges = boundedArray(doc.edges, EDGES_MAX_COUNT);

  nodes.forEach((node, i) => {
    if (errors.length >= MAX_ERRORS) return;
    if (!isPlainObjectish(node)) return;
    const path = `/nodes/${i}`;
    const evidenceIds = Array.isArray(node.evidence) ? node.evidence : [];

    if (node.source === 'scan' && evidenceIds.length === 0) {
      errors.push({
        path: `${path}/evidence`,
        code: 'evidence-required',
        message: `Node "${truncate(node.id)}" has source "scan" and must cite at least one evidence id.`,
      });
    }

    evidenceIds.forEach((id, j) => {
      if (errors.length >= MAX_ERRORS) return;
      if (typeof id !== 'string' || !evidenceById.has(id)) {
        errors.push({
          path: `${path}/evidence/${j}`,
          code: 'unknown-evidence',
          message: `Node "${truncate(node.id)}" cites evidence id ${JSON.stringify(truncate(String(id)))} which is not in the scan bundle.`,
        });
      }
    });

    if (node.source === 'model' && evidenceIds.length > 0 && node.status !== 'open') {
      errors.push({
        path: `${path}/evidence`,
        code: 'evidence-on-model-node',
        message: `Node "${truncate(node.id)}" has source "model" and cites evidence; a model-authored node may only do that while status is "open".`,
      });
    }
  });

  edges.forEach((edge, i) => {
    if (errors.length >= MAX_ERRORS) return;
    if (!isPlainObjectish(edge)) return;
    const path = `/edges/${i}`;
    const evidenceIds = Array.isArray(edge.evidence) ? edge.evidence : [];

    if (edge.source === 'scan' && evidenceIds.length === 0) {
      errors.push({
        path: `${path}/evidence`,
        code: 'evidence-required',
        message: `Edge #${i} has source "scan" and must cite at least one evidence id.`,
      });
    }

    const resolved = [];
    evidenceIds.forEach((id, j) => {
      if (errors.length >= MAX_ERRORS) return;
      if (typeof id !== 'string' || !evidenceById.has(id)) {
        errors.push({
          path: `${path}/evidence/${j}`,
          code: 'unknown-evidence',
          message: `Edge #${i} cites evidence id ${JSON.stringify(truncate(String(id)))} which is not in the scan bundle.`,
        });
      } else {
        resolved.push(evidenceById.get(id));
      }
    });

    if (edge.source === 'model' && evidenceIds.length > 0) {
      errors.push({
        path: `${path}/evidence`,
        code: 'evidence-on-model-node',
        message: `Edge #${i} has source "model" and cites evidence; only a scan-sourced edge may cite evidence.`,
      });
    }

    if (edge.source === 'scan' && evidenceIds.length > 0 && errors.length < MAX_ERRORS) {
      const fromNode = nodesById.get(edge.from);
      const toNode = nodesById.get(edge.to);
      const fromIds = identifiersFor(fromNode, evidenceById);
      const toIds = identifiersFor(toNode, evidenceById);
      const connects = resolved.some(entry => factConnects(entry, fromIds, toIds));
      if (!connects) {
        errors.push({
          path: `${path}/evidence`,
          code: 'edge-evidence-mismatch',
          message: `Edge #${i} (${truncate(edge.from)} -> ${truncate(edge.to)}) cites evidence, but none of it is a depends-on, sdk-import, or route fact connecting its two endpoints.`,
        });
      }
    }
  });

  return errors.slice(0, MAX_ERRORS);
}

module.exports = { checkEvidence, identifiersFor, factConnects };
