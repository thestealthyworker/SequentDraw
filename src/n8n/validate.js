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
const NOTES_MAX_COUNT = 20;
const NODES_MAX_COUNT = 100;
const TOUR_TITLE_MAX = 80;
const TOUR_DESCRIPTION_MAX = 500;

const TOP_LEVEL_KEYS = new Set(['$schema', 'title', 'groups', 'nodes', 'edges', 'notes', 'tour']);
const GROUP_KEYS = new Set(['id', 'label', 'color']);
const NODE_KEYS = new Set(['id', 'label', 'sublabel', 'kind', 'icon', 'parentId', 'layers', 'status', 'source', 'prompt', 'rationale']);
const EDGE_KEYS = new Set(['from', 'to', 'type', 'condition']);
const NOTE_KEYS = new Set(['id', 'content', 'attachTo', 'color', 'layers']);
const TOUR_KEYS = new Set(['order', 'title', 'description', 'nodeIds']);

const MAX_SUGGEST_DISTANCE = 2;

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
    .map(e => `  ${e.path || '/'} [${e.code}] ${e.message}`)
    .join('\n');
  const more = count > MAX_LISTED ? `\n  ...and ${count - MAX_LISTED} more` : '';
  return `${count} validation ${noun} found:\n${listed}${more}`;
}

// --- small helpers ---------------------------------------------------

function isPlainObjectish(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
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
  let best = null;
  let bestDist = Infinity;
  for (const candidate of allowedKeys) {
    const dist = levenshtein(key.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return bestDist <= MAX_SUGGEST_DISTANCE ? best : null;
}

function checkUnknownFields(obj, allowedKeys, path, errors, skip) {
  for (const key of Object.keys(obj)) {
    if (skip && skip.has(key)) continue;
    if (allowedKeys.has(key)) continue;
    const hint = suggestKey(key, allowedKeys);
    const hintText = hint ? ` Did you mean "${hint}"?` : '';
    errors.push({ path: `${path}/${key}`, code: 'unknown-field', message: `Unknown field "${key}".${hintText}` });
  }
}

function checkId(value, path, errors, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    errors.push({
      path,
      code: 'invalid-id',
      message: `${label} id ${JSON.stringify(value)} is invalid: must be ${ID_RE_DESCRIPTION}.`,
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
      errors.push({ path: `${path}/${index}/id`, code: 'duplicate-id', message: `Duplicate ${label} id "${id}".` });
    } else {
      seen.set(id, index);
    }
  });
}

// value: string | undefined | null | other. `code` becomes `invalid-<code>`
// and `<code>-too-long`.
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
      message: `${label} "${value}" is invalid; expected one of ${[...values].join(', ')}.`,
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
        message: `layers contains "${l}", expected one of ${[...LAYER_VALUES].join(', ')}.`,
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

  if (nodesOk && rawNodes.length > NODES_MAX_COUNT) {
    errors.push({
      path: '/nodes',
      code: 'too-many-nodes',
      message: `Document has ${rawNodes.length} nodes, maximum is ${NODES_MAX_COUNT}.`,
    });
  }

  // --- groups ---
  const groupIds = new Set();
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
        message: `Group "${g.id}" must not have a parentId; groups may only nest one level deep, under nodes.`,
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

  // --- nodes ---
  const nodeIds = new Set();
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
            message: `Node "${n.id}" sublabel "${n.sublabel}" is ${words.length} words, must be ${SUBLABEL_MAX_WORDS} or fewer.`,
          });
        }
      }
    }

    checkEnum(n.kind, { path: `${path}/kind`, errors, required: true, values: KIND_VALUES, code: 'kind', label: 'Node kind' });

    if (n.icon != null && typeof n.icon !== 'string') {
      errors.push({ path: `${path}/icon`, code: 'invalid-icon', message: `Node "${n.id}" icon must be a string or null.` });
    }

    if (n.parentId != null) {
      if (typeof n.parentId !== 'string') {
        errors.push({ path: `${path}/parentId`, code: 'invalid-parent-id', message: `Node "${n.id}" parentId must be a string or null.` });
      } else if (!groupIds.has(n.parentId)) {
        errors.push({
          path: `${path}/parentId`,
          code: 'unknown-group',
          message: `Node "${n.id}" has parentId "${n.parentId}" which is not a declared group.`,
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
        message: `Node "${n.id}" has status "suggested" and must carry a non-empty rationale.`,
      });
    }
    if (n.status !== 'suggested' && n.rationale != null) {
      errors.push({
        path: `${path}/rationale`,
        code: 'rationale-not-allowed',
        message: `Node "${n.id}" has a rationale but is not status "suggested"; rationale is only allowed on suggested nodes.`,
      });
    }
  });
  checkDuplicateIds(
    rawNodes.map((n, index) => ({ id: isPlainObjectish(n) ? n.id : undefined, index })),
    '/nodes',
    errors,
    'node',
  );

  // --- edges ---
  rawEdges.forEach((e, i) => {
    const path = `/edges/${i}`;
    if (!isPlainObjectish(e)) {
      errors.push({ path, code: 'invalid-edge', message: `Edge at index ${i} must be an object.` });
      return;
    }
    checkUnknownFields(e, EDGE_KEYS, path, errors);

    if (typeof e.from !== 'string' || e.from.length === 0) {
      errors.push({ path: `${path}/from`, code: 'invalid-endpoint', message: `Edge #${i} "from" is required and must reference a node id.` });
    } else if (!nodeIds.has(e.from)) {
      errors.push({ path: `${path}/from`, code: 'unknown-node', message: `Edge #${i} has "from": "${e.from}" which is not a declared node.` });
    }

    if (typeof e.to !== 'string' || e.to.length === 0) {
      errors.push({ path: `${path}/to`, code: 'invalid-endpoint', message: `Edge #${i} "to" is required and must reference a node id.` });
    } else if (!nodeIds.has(e.to)) {
      errors.push({ path: `${path}/to`, code: 'unknown-node', message: `Edge #${i} has "to": "${e.to}" which is not a declared node.` });
    }

    checkEnum(e.type, { path: `${path}/type`, errors, required: true, values: EDGE_TYPE_VALUES, code: 'type', label: 'Edge type' });

    checkString(e.condition, { path: `${path}/condition`, errors, required: false, max: CONDITION_MAX, code: 'condition', label: 'Edge condition' });
    if (e.condition != null && e.type !== 'dashed') {
      errors.push({
        path: `${path}/condition`,
        code: 'condition-requires-dashed',
        message: `Edge #${i} has a condition, so type must be "dashed" (got "${e.type}").`,
      });
    }
  });

  // --- orphan node check: zero edges is an error unless the node is the
  // only member of its group (nodes sharing the same parentId, including
  // ungrouped nodes sharing parentId === null/undefined). ---
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
        message: `Node "${n.id}" has no edges and is not the only node in its group.`,
      });
    }
  });

  // --- notes ---
  if (rawNotes.length > NOTES_MAX_COUNT) {
    errors.push({ path: '/notes', code: 'too-many-notes', message: `Too many notes: ${rawNotes.length} (max ${NOTES_MAX_COUNT}).` });
  }
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
      if (nodeIds.has(note.id) || groupIds.has(note.id)) {
        errors.push({ path: `${path}/id`, code: 'duplicate-id', message: `Note "${note.id}" id collides with a node or group id.` });
      } else if (noteIds.has(note.id)) {
        errors.push({ path: `${path}/id`, code: 'duplicate-id', message: `Duplicate note id: "${note.id}".` });
      } else {
        noteIds.add(note.id);
      }
    }

    checkString(note.content, { path: `${path}/content`, errors, required: true, max: NOTE_CONTENT_MAX_LENGTH, code: 'content', label: 'Note content' });

    checkEnum(note.color, { path: `${path}/color`, errors, required: false, values: NOTE_COLOR_VALUES, code: 'color', label: 'Note color' });

    if (note.attachTo != null) {
      if (!Array.isArray(note.attachTo)) {
        errors.push({ path: `${path}/attachTo`, code: 'invalid-attach-to', message: `Note "${note.id}" attachTo must be an array.` });
      } else {
        note.attachTo.forEach((targetId, j) => {
          if (!nodeIds.has(targetId) && !groupIds.has(targetId)) {
            errors.push({
              path: `${path}/attachTo/${j}`,
              code: 'unknown-attach-target',
              message: `Note "${note.id}" attachTo references "${targetId}" which is not a declared node or group.`,
            });
          }
        });
      }
    }

    checkLayersField(note.layers, `${path}/layers`, errors);
  });

  // --- tour ---
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
    } else {
      entry.nodeIds.forEach((id, j) => {
        if (!nodeIds.has(id)) {
          errors.push({ path: `${path}/nodeIds/${j}`, code: 'unknown-node', message: `Tour entry #${i} references node "${id}" which is not a declared node.` });
        }
      });
    }
  });

  if (errors.length > 0) {
    throw new ValidationError(errors);
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

module.exports = { validateDoc, ValidationError };
