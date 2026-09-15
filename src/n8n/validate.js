// Input validation: structure, references, and the SPEC enums.
//
// Collects EVERY problem in one pass and throws a single ValidationError
// carrying `errors: [{ path, code, message }]` rather than failing on the
// first one found (docs/SPEC.md "Invariants the renderer validates before
// drawing"). This matters because most callers are AI tools (CLI, HTTP API,
// MCP server, agent skills) that want to fix a document in one round trip,
// not one error at a time.
//
// `path` is a JSON Pointer into the input doc. `code` is a stable
// kebab-case string skills can branch on. `message` names the offending id
// (or path) and the fix.
//
// This runs on untrusted input from an HTTP API / MCP server, so it is
// written defensively against adversarial documents, not just malformed
// ones: array-length caps are checked BEFORE any per-item work (so a
// 50,000-node or 200,000-edge document is rejected in O(1), not iterated),
// a single object may not carry more than MAX_OWN_KEYS fields (so a
// document cannot force unbounded per-key work), the "did you mean" hint
// is only computed for short field names, and every user-supplied string
// echoed into a message is truncated. See the fix-round commit for the
// adversarial cases this closes.
//
// Escaping in render-svg.js is kept as defence in depth regardless — this
// is not the only line of defence against a malformed or hostile doc.

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const ID_RE_DESCRIPTION = '1-64 chars: letters, digits, _ . : -';

const LAYER_VALUES = new Set(['base', 'edge', 'business', 'build']);
const KIND_VALUES = new Set(['service', 'human', 'external', 'manual', 'artifact', 'logic']);
const STATUS_VALUES = new Set(['open', 'confirmed', 'suggested']);
const SOURCE_VALUES = new Set(['scan', 'user', 'model']);
const EDGE_TYPE_VALUES = new Set(['solid', 'dashed', 'gutter']);
const GROUP_COLOR_VALUES = new Set(['purple', 'teal', 'coral', 'pink', 'blue', 'green', 'amber', 'gray']);
const NOTE_COLOR_VALUES = new Set(['yellow', 'gold', 'red', 'green', 'blue', 'purple', 'gray']);

const TITLE_MAX = 120;
const LABEL_MAX = 80;
const SUBLABEL_MAX = 60;
const SUBLABEL_MAX_WORDS = 3;
const CONDITION_MAX = 80;
const PROMPT_MAX = 500;
const RATIONALE_MAX = 500;
const NOTE_CONTENT_MAX_LENGTH = 2000;
const TOUR_TITLE_MAX = 80;
const TOUR_DESCRIPTION_MAX = 500;

// Details card fields (docs/design/n8n-visual-style.md "Details card").
const NODE_DESCRIPTION_MAX = 280;
const NODE_LINK_MAX = 300;
const EDGE_DESCRIPTION_MAX = 200;

// Same narrowing idea as markdown.js's safeHref: http(s) only, and never a
// value carrying whitespace, a quote, or an angle bracket -- those are not a
// real address, so they are rejected outright here rather than degraded to
// plain text (there is no "plain text" fallback for a structured field).
//
// Requires the "//" and at least one further character -- "https:evil.com"
// (a scheme with no authority) and "http:/x" (one slash) must NOT pass:
// without this, the server would accept a value the viewer's own
// client-side re-check (render-shell.js's appendDocsLink, which requires
// a literal "http://" or "https://" prefix) then correctly refuses to use
// as an href, so a link that validated could still silently never work.
const LINK_PROTOCOL_RE = /^https?:\/\/./i;
const UNSAFE_LINK_CONTENT_RE = /[\s"'<>]/;

// Array-length caps. Checked BEFORE any per-item iteration: an array over
// its cap gets exactly one error and its items (and anything that would
// otherwise cross-reference them) are skipped, not validated one at a
// time. Nodes and notes are the two caps SPEC.md already names; edges,
// groups and tour steps are new caps added in this fix round so no array
// in the document is unbounded.
const NODES_MAX_COUNT = 100;
const EDGES_MAX_COUNT = 500;
const GROUPS_MAX_COUNT = 50;
const NOTES_MAX_COUNT = 20;
const TOUR_MAX_COUNT = 50;

// A single object (the doc itself, or any node/edge/group/note/tour entry)
// may not carry more than this many own keys. Past this, unknown-field
// detection (which would otherwise do one "did you mean" computation per
// key) is replaced by a single too-many-fields error.
const MAX_OWN_KEYS = 200;

// Hints are only computed for short field names, and only against known
// keys within 2 characters of the same length (an edit distance of 2 is
// impossible otherwise) — this bounds the Levenshtein DP against both an
// attacker-supplied key of unbounded length and an unbounded number of
// candidate comparisons.
const MAX_HINT_KEY_LENGTH = 40;
const MAX_SUGGEST_DISTANCE = 2;

// Every user-supplied string interpolated into a message or a JSON
// Pointer path segment is cut to this length.
const ECHO_MAX_LENGTH = 60;

// The thrown error carries every problem found, but both the reported
// list and its own summary message are capped so a pathological document
// cannot produce an unbounded error report.
const MAX_ERRORS = 100;
const MAX_SUMMARY_LENGTH = 2000;
const MAX_MESSAGE_IN_SUMMARY = 300;

const TOP_LEVEL_KEYS = new Set(['$schema', 'title', 'groups', 'nodes', 'edges', 'notes', 'tour']);
const GROUP_KEYS = new Set(['id', 'label', 'color']);
const NODE_KEYS = new Set([
  'id',
  'label',
  'sublabel',
  'kind',
  'icon',
  'parentId',
  'layers',
  'status',
  'source',
  'prompt',
  'rationale',
  'description',
  'link',
  'evidence',
]);
const EDGE_KEYS = new Set(['from', 'to', 'type', 'condition', 'description', 'evidence', 'source']);

// evidence: an array of 1-20 evidence ids (src/scan/check-evidence.js
// cross-references these against a scan bundle; this only checks shape).
const EVIDENCE_MIN_COUNT = 1;
const EVIDENCE_MAX_COUNT = 20;
const NOTE_KEYS = new Set(['id', 'content', 'attachTo', 'color', 'layers']);
const TOUR_KEYS = new Set(['order', 'title', 'description', 'nodeIds']);

class ValidationError extends Error {
  constructor(errors) {
    super(summarize(errors));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

function summarize(errors) {
  const MAX_LISTED = 5;
  const count = errors.length;
  const noun = count === 1 ? 'error' : 'errors';
  const listed = errors
    .slice(0, MAX_LISTED)
    .map(e => {
      const msg = e.message.length > MAX_MESSAGE_IN_SUMMARY ? `${e.message.slice(0, MAX_MESSAGE_IN_SUMMARY)}…` : e.message;
      return `  ${e.path || '/'} [${e.code}] ${msg}`;
    })
    .join('\n');
  const more = count > MAX_LISTED ? `\n  ...and ${count - MAX_LISTED} more` : '';
  let summary = `${count} validation ${noun} found:\n${listed}${more}`;
  // Final defence in depth: no matter what the fields above added up to,
  // the summary itself never exceeds the bound.
  if (summary.length > MAX_SUMMARY_LENGTH) {
    summary = `${summary.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
  }
  return summary;
}

// --- small helpers ---------------------------------------------------

function isPlainObjectish(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Renders an arbitrary, possibly-hostile value for use inside a message,
// without ever doing unbounded work: strings are cut to ECHO_MAX_LENGTH
// (slicing a long string for a short prefix is cheap regardless of the
// string's full length), and objects/arrays are summarised by shape
// rather than serialised (serialising a huge array/object is itself an
// unbounded-work risk).
function truncate(value, max = ECHO_MAX_LENGTH) {
  if (typeof value === 'string') {
    return value.length > max ? `${value.slice(0, max)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `(array, ${value.length} items)`;
  if (typeof value === 'object') return '(object)';
  return String(value);
}

// Same as truncate(), but wraps a string result in quotes for messages
// that don't already carry literal quotes around the placeholder.
function displayValue(value) {
  return typeof value === 'string' ? `"${truncate(value)}"` : truncate(value);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function suggestKey(key, allowedKeys) {
  if (key.length > MAX_HINT_KEY_LENGTH) return null; // never run the DP on a long/hostile key
  let best = null;
  let bestDist = Infinity;
  for (const candidate of allowedKeys) {
    // A Levenshtein distance <= MAX_SUGGEST_DISTANCE is impossible once
    // the length difference exceeds it, so skip the DP entirely.
    if (Math.abs(candidate.length - key.length) > MAX_SUGGEST_DISTANCE) continue;
    const dist = levenshtein(key.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
      if (bestDist === 0) break;
    }
  }
  return bestDist <= MAX_SUGGEST_DISTANCE ? best : null;
}

// Checks an object's own keys against an allow-list. Guards against two
// unbounded-work shapes: an object with an enormous number of keys (capped
// by MAX_OWN_KEYS, reported as one error instead of one per key) and a key
// name of unbounded length (truncated before it ever reaches a message or
// path, and excluded from hint computation by suggestKey itself).
function checkUnknownFields(obj, allowedKeys, path, errors, skip) {
  const keys = Object.keys(obj);
  if (keys.length > MAX_OWN_KEYS) {
    errors.push({
      path,
      code: 'too-many-fields',
      message: `Object at "${path || '/'}" has ${keys.length} fields, maximum is ${MAX_OWN_KEYS}.`,
    });
    return;
  }
  for (const key of keys) {
    if (skip && skip.has(key)) continue;
    if (allowedKeys.has(key)) continue;
    const shownKey = truncate(key);
    const hint = suggestKey(key, allowedKeys);
    const hintText = hint ? ` Did you mean "${hint}"?` : '';
    errors.push({ path: `${path}/${shownKey}`, code: 'unknown-field', message: `Unknown field "${shownKey}".${hintText}` });
  }
}

function checkId(value, path, errors, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    errors.push({
      path,
      code: 'invalid-id',
      message: `${label} id ${displayValue(value)} is invalid: must be ${ID_RE_DESCRIPTION}.`,
    });
    return false;
  }
  return true;
}

function checkDuplicateIds(entries, path, errors, label) {
  const seen = new Map();
  entries.forEach(({ id, index }) => {
    if (typeof id !== 'string') return;
    if (seen.has(id)) {
      errors.push({ path: `${path}/${index}/id`, code: 'duplicate-id', message: `Duplicate ${label} id ${displayValue(id)}.` });
    } else {
      seen.set(id, index);
    }
  });
}

// value: string | undefined | null | other. `code` becomes `invalid-<code>`
// and `<code>-too-long`. Never echoes the value itself into the message
// (only its length), so this is already safe against a huge string.
function checkString(value, { path, errors, required, max, code, label }) {
  if (value == null) {
    if (required) {
      errors.push({ path, code: `invalid-${code}`, message: `${label} is required and must be a non-empty string.` });
    }
    return;
  }
  if (typeof value !== 'string') {
    errors.push({ path, code: `invalid-${code}`, message: `${label} must be a string.` });
    return;
  }
  if (required && value.trim().length === 0) {
    errors.push({ path, code: `invalid-${code}`, message: `${label} must be a non-empty string.` });
    return;
  }
  if (max != null && value.length > max) {
    errors.push({
      path,
      code: `${code}-too-long`,
      message: `${label} is ${value.length} characters, must be ${max} or fewer.`,
    });
  }
}

// Like checkString, but (for an optional field) a present value must be
// non-empty after trimming whitespace -- not just non-empty by length. Line
// breaks are kept (never stripped), matching the "trimmed non-empty, line
// breaks kept" rule for node/edge description. Never echoes the value
// itself into the message (only its length), same as checkString.
function checkTrimmedString(value, { path, errors, max, code, label }) {
  if (value == null) return;
  if (typeof value !== 'string') {
    errors.push({ path, code: `invalid-${code}`, message: `${label} must be a string.` });
    return;
  }
  if (value.trim().length === 0) {
    errors.push({ path, code: `invalid-${code}`, message: `${label} must not be empty or whitespace-only.` });
    return;
  }
  if (value.length > max) {
    errors.push({
      path,
      code: `${code}-too-long`,
      message: `${label} is ${value.length} characters, must be ${max} or fewer.`,
    });
  }
}

// node.link: optional, at most NODE_LINK_MAX characters, http(s) only, and
// never carrying whitespace, a quote, or an angle bracket anywhere in the
// string (not just leading/trailing) -- the same narrowing idea as
// markdown.js's safeHref(), reapplied here because this is a structured
// field with no "render as plain text" fallback to degrade to.
function checkLink(value, { path, errors, label }) {
  if (value == null) return;
  if (typeof value !== 'string') {
    errors.push({ path, code: 'invalid-link', message: `${label} link must be a string.` });
    return;
  }
  if (value.length > NODE_LINK_MAX) {
    errors.push({
      path,
      code: 'link-too-long',
      message: `${label} link is ${value.length} characters, must be ${NODE_LINK_MAX} or fewer.`,
    });
    return;
  }
  if (!LINK_PROTOCOL_RE.test(value) || UNSAFE_LINK_CONTENT_RE.test(value)) {
    errors.push({
      path,
      code: 'invalid-link',
      message: `${label} link ${displayValue(value)} must be an http:// or https:// URL with no whitespace, quotes, or angle brackets.`,
    });
  }
}

function checkEnum(value, { path, errors, required, values, code, label }) {
  if (value == null) {
    if (required) {
      errors.push({
        path,
        code: `invalid-${code}`,
        message: `${label} is required and must be one of ${[...values].join(', ')}.`,
      });
    }
    return;
  }
  if (!values.has(value)) {
    errors.push({
      path,
      code: `invalid-${code}`,
      message: `${label} ${displayValue(value)} is invalid; expected one of ${[...values].join(', ')}.`,
    });
  }
}

function checkLayersField(value, path, errors) {
  if (value == null) return;
  if (!Array.isArray(value)) {
    errors.push({ path, code: 'invalid-layers', message: `layers must be an array of ${[...LAYER_VALUES].join(', ')}.` });
    return;
  }
  value.forEach((l, i) => {
    if (!LAYER_VALUES.has(l)) {
      errors.push({
        path: `${path}/${i}`,
        code: 'invalid-layers',
        message: `layers contains ${displayValue(l)}, expected one of ${[...LAYER_VALUES].join(', ')}.`,
      });
    }
  });
}

// node.evidence / edge.evidence: optional array of 1-20 evidence id
// strings (same id charset as node/group/note ids). Shape only -- whether
// a cited id actually exists in a scan bundle, and whether it supports
// the claim, is src/scan/check-evidence.js's job, not the renderer's.
function checkEvidenceField(value, path, errors, label) {
  if (value == null) return;
  if (!Array.isArray(value)) {
    errors.push({ path, code: 'invalid-evidence', message: `${label} evidence must be an array of evidence ids.` });
    return;
  }
  if (value.length < EVIDENCE_MIN_COUNT || value.length > EVIDENCE_MAX_COUNT) {
    errors.push({
      path,
      code: 'invalid-evidence',
      message: `${label} evidence has ${value.length} entries, must be between ${EVIDENCE_MIN_COUNT} and ${EVIDENCE_MAX_COUNT}.`,
    });
    return;
  }
  value.forEach((id, i) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      errors.push({
        path: `${path}/${i}`,
        code: 'invalid-evidence',
        message: `${label} evidence id ${displayValue(id)} is invalid: must be ${ID_RE_DESCRIPTION}.`,
      });
    }
  });
}

// --- main entry point --------------------------------------------------

function validateDoc(doc) {
  if (!isPlainObjectish(doc)) {
    throw new ValidationError([{ path: '', code: 'invalid-doc', message: 'SequentDraw doc must be an object.' }]);
  }

  const errors = [];

  checkUnknownFields(doc, TOP_LEVEL_KEYS, '', errors);

  checkString(doc.title, { path: '/title', errors, required: true, max: TITLE_MAX, code: 'title', label: 'title' });

  const nodesOk = Array.isArray(doc.nodes);
  if (!nodesOk) errors.push({ path: '/nodes', code: 'invalid-nodes', message: 'doc.nodes must be an array.' });
  const rawNodes = nodesOk ? doc.nodes : [];

  const edgesOk = Array.isArray(doc.edges);
  if (!edgesOk) errors.push({ path: '/edges', code: 'invalid-edges', message: 'doc.edges must be an array.' });
  const rawEdges = edgesOk ? doc.edges : [];

  let groupsOk = true;
  if (doc.groups != null) {
    groupsOk = Array.isArray(doc.groups);
    if (!groupsOk) errors.push({ path: '/groups', code: 'invalid-groups', message: 'doc.groups must be an array.' });
  }
  const rawGroups = groupsOk && Array.isArray(doc.groups) ? doc.groups : [];

  let notesOk = true;
  if (doc.notes != null) {
    notesOk = Array.isArray(doc.notes);
    if (!notesOk) errors.push({ path: '/notes', code: 'invalid-notes', message: 'doc.notes must be an array.' });
  }
  const rawNotes = notesOk && Array.isArray(doc.notes) ? doc.notes : [];

  let tourOk = true;
  if (doc.tour != null) {
    tourOk = Array.isArray(doc.tour);
    if (!tourOk) errors.push({ path: '/tour', code: 'invalid-tour', message: 'doc.tour must be an array.' });
  }
  const rawTour = tourOk && Array.isArray(doc.tour) ? doc.tour : [];

  // --- fail fast on size, BEFORE any per-item work: every array's length
  // is checked against its cap up front. An array over its cap gets
  // exactly one error; its items are never iterated, and any other check
  // that would cross-reference them (edge endpoints, orphan detection,
  // note attachTo, tour nodeIds) is skipped too, guarded below by these
  // flags. This is what keeps a 50,000-node or 200,000-edge document (or
  // one with 2,000 fields on a single object) O(1) instead of O(n).
  const nodesCapped = nodesOk && rawNodes.length > NODES_MAX_COUNT;
  if (nodesCapped) {
    errors.push({ path: '/nodes', code: 'too-many-nodes', message: `Document has ${rawNodes.length} nodes, maximum is ${NODES_MAX_COUNT}.` });
  }
  const edgesCapped = edgesOk && rawEdges.length > EDGES_MAX_COUNT;
  if (edgesCapped) {
    errors.push({ path: '/edges', code: 'too-many-edges', message: `Document has ${rawEdges.length} edges, maximum is ${EDGES_MAX_COUNT}.` });
  }
  const groupsCapped = groupsOk && rawGroups.length > GROUPS_MAX_COUNT;
  if (groupsCapped) {
    errors.push({ path: '/groups', code: 'too-many-groups', message: `Document has ${rawGroups.length} groups, maximum is ${GROUPS_MAX_COUNT}.` });
  }
  const notesCapped = notesOk && rawNotes.length > NOTES_MAX_COUNT;
  if (notesCapped) {
    errors.push({ path: '/notes', code: 'too-many-notes', message: `Too many notes: ${rawNotes.length} (max ${NOTES_MAX_COUNT}).` });
  }
  const tourCapped = tourOk && rawTour.length > TOUR_MAX_COUNT;
  if (tourCapped) {
    errors.push({ path: '/tour', code: 'too-many-tour-entries', message: `Document has ${rawTour.length} tour entries, maximum is ${TOUR_MAX_COUNT}.` });
  }

  // --- groups ---
  const groupIds = new Set();
  if (!groupsCapped) {
    rawGroups.forEach((g, i) => {
      const path = `/groups/${i}`;
      if (!isPlainObjectish(g)) {
        errors.push({ path, code: 'invalid-group', message: `Group at index ${i} must be an object.` });
        return;
      }
      checkUnknownFields(g, GROUP_KEYS, path, errors, new Set(['parentId']));
      if (Object.prototype.hasOwnProperty.call(g, 'parentId')) {
        errors.push({
          path: `${path}/parentId`,
          code: 'group-nested',
          message: `Group "${truncate(g.id)}" must not have a parentId; groups may only nest one level deep, under nodes.`,
        });
      }
      const idOk = checkId(g.id, `${path}/id`, errors, 'Group');
      if (idOk) groupIds.add(g.id);
      checkString(g.label, { path: `${path}/label`, errors, required: true, max: LABEL_MAX, code: 'label', label: 'Group label' });
      checkEnum(g.color, { path: `${path}/color`, errors, required: false, values: GROUP_COLOR_VALUES, code: 'color', label: 'Group color' });
    });
    checkDuplicateIds(
      rawGroups.map((g, index) => ({ id: isPlainObjectish(g) ? g.id : undefined, index })),
      '/groups',
      errors,
      'group',
    );
  }

  // --- nodes ---
  const nodeIds = new Set();
  if (!nodesCapped) {
    rawNodes.forEach((n, i) => {
      const path = `/nodes/${i}`;
      if (!isPlainObjectish(n)) {
        errors.push({ path, code: 'invalid-node', message: `Node at index ${i} must be an object.` });
        return;
      }
      checkUnknownFields(n, NODE_KEYS, path, errors);

      const idOk = checkId(n.id, `${path}/id`, errors, 'Node');
      if (idOk) nodeIds.add(n.id);

      checkString(n.label, { path: `${path}/label`, errors, required: true, max: LABEL_MAX, code: 'label', label: 'Node label' });

      if (n.sublabel != null) {
        checkString(n.sublabel, { path: `${path}/sublabel`, errors, required: false, max: SUBLABEL_MAX, code: 'sublabel', label: 'sublabel' });
        if (typeof n.sublabel === 'string') {
          const words = n.sublabel.trim().split(/\s+/).filter(Boolean);
          if (words.length > SUBLABEL_MAX_WORDS) {
            errors.push({
              path: `${path}/sublabel`,
              code: 'sublabel-too-many-words',
              message: `Node "${truncate(n.id)}" sublabel "${truncate(n.sublabel)}" is ${words.length} words, must be ${SUBLABEL_MAX_WORDS} or fewer.`,
            });
          }
        }
      }

      checkEnum(n.kind, { path: `${path}/kind`, errors, required: true, values: KIND_VALUES, code: 'kind', label: 'Node kind' });

      if (n.icon != null && typeof n.icon !== 'string') {
        errors.push({ path: `${path}/icon`, code: 'invalid-icon', message: `Node "${truncate(n.id)}" icon must be a string or null.` });
      }

      if (n.parentId != null) {
        if (typeof n.parentId !== 'string') {
          errors.push({ path: `${path}/parentId`, code: 'invalid-parent-id', message: `Node "${truncate(n.id)}" parentId must be a string or null.` });
        } else if (!groupsCapped && !groupIds.has(n.parentId)) {
          errors.push({
            path: `${path}/parentId`,
            code: 'unknown-group',
            message: `Node "${truncate(n.id)}" has parentId "${truncate(n.parentId)}" which is not a declared group.`,
          });
        }
      }

      checkLayersField(n.layers, `${path}/layers`, errors);

      checkEnum(n.status, { path: `${path}/status`, errors, required: false, values: STATUS_VALUES, code: 'status', label: 'Node status' });
      checkEnum(n.source, { path: `${path}/source`, errors, required: false, values: SOURCE_VALUES, code: 'source', label: 'Node source' });

      checkString(n.prompt, { path: `${path}/prompt`, errors, required: false, max: PROMPT_MAX, code: 'prompt', label: 'Node prompt' });
      checkString(n.rationale, { path: `${path}/rationale`, errors, required: false, max: RATIONALE_MAX, code: 'rationale', label: 'Node rationale' });

      const hasRationale = n.rationale != null && typeof n.rationale === 'string' && n.rationale.trim().length > 0;
      if (n.status === 'suggested' && !hasRationale) {
        errors.push({
          path: `${path}/rationale`,
          code: 'rationale-required',
          message: `Node "${truncate(n.id)}" has status "suggested" and must carry a non-empty rationale.`,
        });
      }
      if (n.status !== 'suggested' && n.rationale != null) {
        errors.push({
          path: `${path}/rationale`,
          code: 'rationale-not-allowed',
          message: `Node "${truncate(n.id)}" has a rationale but is not status "suggested"; rationale is only allowed on suggested nodes.`,
        });
      }

      checkTrimmedString(n.description, {
        path: `${path}/description`,
        errors,
        max: NODE_DESCRIPTION_MAX,
        code: 'description',
        label: `Node "${truncate(n.id)}" description`,
      });
      checkLink(n.link, { path: `${path}/link`, errors, label: `Node "${truncate(n.id)}"` });
      checkEvidenceField(n.evidence, `${path}/evidence`, errors, `Node "${truncate(n.id)}"`);
    });
    checkDuplicateIds(
      rawNodes.map((n, index) => ({ id: isPlainObjectish(n) ? n.id : undefined, index })),
      '/nodes',
      errors,
      'node',
    );
  }

  // --- edges ---
  if (!edgesCapped) {
    rawEdges.forEach((e, i) => {
      const path = `/edges/${i}`;
      if (!isPlainObjectish(e)) {
        errors.push({ path, code: 'invalid-edge', message: `Edge at index ${i} must be an object.` });
        return;
      }
      checkUnknownFields(e, EDGE_KEYS, path, errors);

      if (typeof e.from !== 'string' || e.from.length === 0) {
        errors.push({ path: `${path}/from`, code: 'invalid-endpoint', message: `Edge #${i} "from" is required and must reference a node id.` });
      } else if (!nodesCapped && !nodeIds.has(e.from)) {
        errors.push({ path: `${path}/from`, code: 'unknown-node', message: `Edge #${i} has "from": "${truncate(e.from)}" which is not a declared node.` });
      }

      if (typeof e.to !== 'string' || e.to.length === 0) {
        errors.push({ path: `${path}/to`, code: 'invalid-endpoint', message: `Edge #${i} "to" is required and must reference a node id.` });
      } else if (!nodesCapped && !nodeIds.has(e.to)) {
        errors.push({ path: `${path}/to`, code: 'unknown-node', message: `Edge #${i} has "to": "${truncate(e.to)}" which is not a declared node.` });
      }

      checkEnum(e.type, { path: `${path}/type`, errors, required: true, values: EDGE_TYPE_VALUES, code: 'type', label: 'Edge type' });

      checkString(e.condition, { path: `${path}/condition`, errors, required: false, max: CONDITION_MAX, code: 'condition', label: 'Edge condition' });
      if (e.condition != null && e.type !== 'dashed') {
        errors.push({
          path: `${path}/condition`,
          code: 'condition-requires-dashed',
          message: `Edge #${i} has a condition, so type must be "dashed" (got ${displayValue(e.type)}).`,
        });
      }

      checkTrimmedString(e.description, {
        path: `${path}/description`,
        errors,
        max: EDGE_DESCRIPTION_MAX,
        code: 'description',
        label: `Edge #${i} description`,
      });
      checkEvidenceField(e.evidence, `${path}/evidence`, errors, `Edge #${i}`);
      checkEnum(e.source, { path: `${path}/source`, errors, required: false, values: SOURCE_VALUES, code: 'source', label: 'Edge source' });
    });
  }

  // --- orphan node check: zero edges is an error unless the node is the
  // only member of its group (nodes sharing the same parentId, including
  // ungrouped nodes sharing parentId === null/undefined). Needs both
  // nodes and edges fully validated (not capped) to be meaningful. ---
  if (!nodesCapped && !edgesCapped) {
    const incidentNodeIds = new Set();
    rawEdges.forEach(e => {
      if (isPlainObjectish(e)) {
        if (typeof e.from === 'string') incidentNodeIds.add(e.from);
        if (typeof e.to === 'string') incidentNodeIds.add(e.to);
      }
    });
    const groupBuckets = new Map();
    rawNodes.forEach(n => {
      if (!isPlainObjectish(n)) return;
      const key = n.parentId == null ? ' ungrouped' : n.parentId;
      if (!groupBuckets.has(key)) groupBuckets.set(key, []);
      groupBuckets.get(key).push(n.id);
    });
    rawNodes.forEach((n, i) => {
      if (!isPlainObjectish(n) || typeof n.id !== 'string') return;
      if (incidentNodeIds.has(n.id)) return;
      const key = n.parentId == null ? ' ungrouped' : n.parentId;
      const bucket = groupBuckets.get(key) || [];
      if (bucket.length > 1) {
        errors.push({
          path: `/nodes/${i}`,
          code: 'orphan-node',
          message: `Node "${truncate(n.id)}" has no edges and is not the only node in its group.`,
        });
      }
    });
  }

  // --- notes ---
  if (!notesCapped) {
    const noteIds = new Set();
    rawNotes.forEach((note, i) => {
      const path = `/notes/${i}`;
      if (!isPlainObjectish(note)) {
        errors.push({ path, code: 'invalid-note', message: `Note at index ${i} must be an object.` });
        return;
      }
      checkUnknownFields(note, NOTE_KEYS, path, errors);

      const idOk = checkId(note.id, `${path}/id`, errors, 'Note');
      if (idOk) {
        if ((!nodesCapped && nodeIds.has(note.id)) || (!groupsCapped && groupIds.has(note.id))) {
          errors.push({ path: `${path}/id`, code: 'duplicate-id', message: `Note "${truncate(note.id)}" id collides with a node or group id.` });
        } else if (noteIds.has(note.id)) {
          errors.push({ path: `${path}/id`, code: 'duplicate-id', message: `Duplicate note id: "${truncate(note.id)}".` });
        } else {
          noteIds.add(note.id);
        }
      }

      checkString(note.content, { path: `${path}/content`, errors, required: true, max: NOTE_CONTENT_MAX_LENGTH, code: 'content', label: 'Note content' });

      checkEnum(note.color, { path: `${path}/color`, errors, required: false, values: NOTE_COLOR_VALUES, code: 'color', label: 'Note color' });

      if (note.attachTo != null) {
        if (!Array.isArray(note.attachTo)) {
          errors.push({ path: `${path}/attachTo`, code: 'invalid-attach-to', message: `Note "${truncate(note.id)}" attachTo must be an array.` });
        } else if (!nodesCapped && !groupsCapped) {
          note.attachTo.forEach((targetId, j) => {
            if (!nodeIds.has(targetId) && !groupIds.has(targetId)) {
              errors.push({
                path: `${path}/attachTo/${j}`,
                code: 'unknown-attach-target',
                message: `Note "${truncate(note.id)}" attachTo references "${truncate(targetId)}" which is not a declared node or group.`,
              });
            }
          });
        }
      }

      checkLayersField(note.layers, `${path}/layers`, errors);
    });
  }

  // --- tour ---
  if (!tourCapped) {
    const seenOrders = new Map();
    rawTour.forEach((entry, i) => {
      const path = `/tour/${i}`;
      if (!isPlainObjectish(entry)) {
        errors.push({ path, code: 'invalid-tour-entry', message: `Tour entry at index ${i} must be an object.` });
        return;
      }
      checkUnknownFields(entry, TOUR_KEYS, path, errors);

      if (!Number.isInteger(entry.order) || entry.order <= 0) {
        errors.push({ path: `${path}/order`, code: 'invalid-order', message: `Tour entry #${i} order must be a positive integer.` });
      } else if (seenOrders.has(entry.order)) {
        errors.push({ path: `${path}/order`, code: 'duplicate-order', message: `Tour order ${entry.order} is used more than once; order must be unique.` });
      } else {
        seenOrders.set(entry.order, i);
      }

      checkString(entry.title, { path: `${path}/title`, errors, required: true, max: TOUR_TITLE_MAX, code: 'tour-title', label: 'Tour title' });
      checkString(entry.description, {
        path: `${path}/description`,
        errors,
        required: true,
        max: TOUR_DESCRIPTION_MAX,
        code: 'tour-description',
        label: 'Tour description',
      });

      if (!Array.isArray(entry.nodeIds) || entry.nodeIds.length === 0) {
        errors.push({ path: `${path}/nodeIds`, code: 'invalid-node-ids', message: `Tour entry #${i} nodeIds must be a non-empty array of node ids.` });
      } else if (!nodesCapped) {
        entry.nodeIds.forEach((id, j) => {
          if (!nodeIds.has(id)) {
            errors.push({ path: `${path}/nodeIds/${j}`, code: 'unknown-node', message: `Tour entry #${i} references node "${truncate(id)}" which is not a declared node.` });
          }
        });
      }
    });
  }

  if (errors.length > 0) {
    let finalErrors = errors;
    if (errors.length > MAX_ERRORS) {
      const remaining = errors.length - MAX_ERRORS;
      finalErrors = errors.slice(0, MAX_ERRORS);
      finalErrors.push({ path: '', code: 'too-many-errors', message: `${remaining} more errors not shown.` });
    }
    throw new ValidationError(finalErrors);
  }

  return {
    title: doc.title,
    groups: rawGroups,
    nodes: doc.nodes,
    edges: doc.edges,
    notes: rawNotes,
    tour: rawTour,
  };
}

module.exports = { validateDoc, ValidationError, LAYER_VALUES };
