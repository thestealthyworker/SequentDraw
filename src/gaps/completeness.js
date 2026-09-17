// The completeness checks SPEC promises (docs/SPEC.md:260-277) as six graph
// tests, specified in docs/design/business-map.md section 2. "Complete" here
// is SPEC's working definition -- one full lifecycle of the unit of value,
// with a named owner at every handoff -- not absolute completeness, which
// produces a map nobody reads (docs/SPEC.md:274-277).
//
// Each rule asks one question about one subject, fires at most once per
// subject, and never follows the graph more than one edge: no transitive
// closure, no scoring. Two properties make this a questionnaire rather than
// a linter (docs/design/business-map.md:143-150):
//
//   * an `open` node SATISFIES a rule -- the gap is already drawn, which is
//     the whole point of `status: "open"` (docs/SPEC.md:241-244). This falls
//     out of the graph tests: an open node standing in a gap is an edge
//     endpoint, so the degree the rule counts is no longer zero.
//   * an `open` node is NEVER a subject -- asking "who receives the thing we
//     do not know who receives" is noise, and skipping open subjects is what
//     makes `check` idempotent: after `--emit-open`, the copy passes.
//
// A `suggested` node is different again: it is IGNORED, together with every
// edge touching it (owner's decision, docs/design/suggestion-agent.md section
// 1). A suggestion is a proposal the user has not accepted, so it never
// changes what the map says about the real system: it is never a subject,
// never satisfies a rule, its edges count toward no degree, handoff or
// decision, it does not open the business-layer gate, and on the `edge`
// layer it is not an unhappy path for rule 6a. Its id still counts as taken,
// so an emitted id never collides with it, and `--emit-open` copies it
// untouched.
//
// ALL SIX RULES GATE ON A `business` LAYER BEING PRESENT (owner's decision,
// 2026-09-16, docs/design/business-map.md:181-203). A `git-map` map carries
// `base` only, so it produces zero findings here: rule 2 would otherwise fire
// on the entry service of practically every scanned repository, and
// `evals/git-map-output-compose-app` grades that `check … --evidence` prints
// `ok` (skills/git-map/SKILL.md:115-122). Applying rules 1, 2 and 4 to
// base-only maps is a separate decision in its own PR.
//
// Returns `{ errors, additions }`. `errors` are validator-format
// `{ path, code, message }` (src/n8n/validate.js:9-12,
// src/scan/check-evidence.js:9-10) so a caller can report gaps in the same
// shape as every other check. `additions` is the plan `--emit-open` applies
// to a COPY of the document -- see buildOpenDocument() below; nothing here
// mutates its input.
//
// Defensive in the same way as src/scan/check-evidence.js: never throws on a
// malformed document, treats anything not shaped as expected as "nothing to
// check there", caps every array BEFORE per-item work (the caps at
// src/n8n/validate.js:74-78) and stops the report at the same 100 errors
// (src/n8n/validate.js:101). The document comes from untrusted input paths --
// an AI tool's output, or an HTTP/MCP surface later.

const NODES_MAX_COUNT = 100;
const EDGES_MAX_COUNT = 500;
const NOTES_MAX_COUNT = 20;
const GROUPS_MAX_COUNT = 50;
const MAX_ERRORS = 100;
const ECHO_MAX_LENGTH = 60;

// Ids must match ^[A-Za-z0-9_.:-]{1,64}$ (src/n8n/validate.js:27) and prompts
// are capped at 500 characters (src/n8n/validate.js:43). Both are enforced
// here rather than left to the validator, because an emitted copy that fails
// validation is a copy that never gets written.
const ID_MAX_LENGTH = 64;
const PROMPT_MAX_LENGTH = 500;
const ID_UNSAFE_RE = /[^A-Za-z0-9_.:-]+/g;

// The id rule 6a gives its map-level note when nothing else holds it.
const UNHAPPY_PATHS_NOTE_ID = 'n_consider_unhappy_paths';

// A node with no explicit `layers` is on `base` (docs/SPEC.md:293). Rules 2,
// 5 and 6 read layers, so the default has to be applied here or a business
// map that leaves `layers` off its happy path would be judged as if its
// nodes were on no layer at all.
const DEFAULT_LAYERS = ['base'];

// Kinds that already name a party. A rule asking "who" is answered when the
// thing standing there is a person or an outside party -- and, where the
// question is "what comes out of this", by a document as well.
const PARTY_KINDS = new Set(['human', 'external']);
const PARTY_OR_ARTIFACT_KINDS = new Set(['human', 'external', 'artifact']);
const DECIDER_KINDS = new Set(['human', 'logic']);

function isPlainObjectish(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function truncate(value) {
  const s = typeof value === 'string' ? value : String(value);
  return s.length > ECHO_MAX_LENGTH ? `${s.slice(0, ECHO_MAX_LENGTH)}…` : s;
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function overCap(value, max) {
  return Array.isArray(value) && value.length > max;
}

function layersOf(node) {
  return Array.isArray(node.layers) ? node.layers : DEFAULT_LAYERS;
}

function hasLayer(node, layer) {
  return layersOf(node).includes(layer);
}

function isOpen(node) {
  return isPlainObjectish(node) && node.status === 'open';
}

function isSuggested(node) {
  return isPlainObjectish(node) && node.status === 'suggested';
}

// The label a question quotes back at the user. Falls back to the id, because
// a node with no label is still a thing the user can recognise.
function nameOf(node) {
  if (isPlainObjectish(node) && typeof node.label === 'string' && node.label.trim().length > 0) {
    return truncate(node.label.trim());
  }
  return truncate(isPlainObjectish(node) && typeof node.id === 'string' ? node.id : 'node');
}

function idPart(value) {
  const cleaned = String(value == null ? '' : value).replace(ID_UNSAFE_RE, '_');
  return cleaned.length > 0 ? cleaned : 'node';
}

// `q_<rule>_<subject id>`, cut at 64 with a numeric suffix on collision
// (docs/design/business-map.md:226-231). The `q_` prefix is what the skill
// matches when the user answers a question.
function uniqueId(base, taken) {
  const capped = base.slice(0, ID_MAX_LENGTH);
  if (!taken.has(capped)) {
    taken.add(capped);
    return capped;
  }
  // Bounded by construction: `taken` never holds more ids than the document
  // caps allow plus one per emitted question, so a free suffix exists inside
  // this range.
  for (let n = 2; n <= taken.size + 2; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, ID_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  return null;
}

// An emitted question carries no `source`: the enum is scan | user | model
// (src/n8n/validate.js:33) and an engine-emitted question is none of those.
// Owner's decision, 2026-09-17 (docs/design/business-map.md:449-453); it is
// already identifiable by `status: "open"`, the `q_` id prefix and its prompt.
// `layers` and `parentId` are copied from the subject so the question is
// visible, and sits, wherever the thing it asks about is.
function makeQuestionNode({ id, label, kind, prompt, subject }) {
  const node = { id, label, kind };
  if (isPlainObjectish(subject)) {
    if (Array.isArray(subject.layers)) node.layers = subject.layers.slice();
    if (typeof subject.parentId === 'string') node.parentId = subject.parentId;
  }
  node.status = 'open';
  node.prompt = prompt.slice(0, PROMPT_MAX_LENGTH);
  return node;
}

function checkCompleteness(doc) {
  const errors = [];
  const emittedNodes = [];
  const appendedEdges = [];
  const emittedNotes = [];
  const edgeEdits = new Map(); // edge index -> { from?, to? }
  const empty = { errors, additions: { nodes: emittedNodes, edges: appendedEdges, notes: emittedNotes, edgeEdits: [] } };

  const result = () => ({
    errors: errors.slice(0, MAX_ERRORS),
    additions: {
      nodes: emittedNodes,
      edges: appendedEdges,
      notes: emittedNotes,
      edgeEdits: [...edgeEdits.entries()].map(([index, edit]) => ({ index, ...edit })),
    },
  });

  if (!isPlainObjectish(doc)) return empty;

  // Over ANY cap, nothing is checked and no array is iterated. validateDoc()
  // rejects such a document with a single error before per-item work
  // (src/n8n/validate.js:68-78), so the CLI never reaches this function with
  // one; and silently treating an over-cap `edges` array as empty would make
  // every node look like a sink and fire rules 1, 5 and 6 across the whole
  // document -- unbounded work, and a nonsense report, on a hostile input.
  if (
    overCap(doc.nodes, NODES_MAX_COUNT) ||
    overCap(doc.edges, EDGES_MAX_COUNT) ||
    overCap(doc.notes, NOTES_MAX_COUNT) ||
    overCap(doc.groups, GROUPS_MAX_COUNT)
  ) {
    return empty;
  }

  const nodes = arrayOf(doc.nodes);
  const edges = arrayOf(doc.edges);
  const notes = arrayOf(doc.notes);
  const groups = arrayOf(doc.groups);

  // Suggested nodes, and the edges touching them, are skipped by index rather
  // than filtered out, so every path a finding reports is still the input's
  // own index.
  const suggestedIds = new Set();
  nodes.forEach(node => {
    if (isSuggested(node) && typeof node.id === 'string') suggestedIds.add(node.id);
  });
  const touchesSuggestion = edge => suggestedIds.has(edge.from) || suggestedIds.has(edge.to);

  // The gate. Explicit `business` only: a node defaulting to `base` is not a
  // business map's node.
  const hasBusinessLayer = nodes.some(
    n => isPlainObjectish(n) && !isSuggested(n) && Array.isArray(n.layers) && n.layers.includes('business')
  );
  if (!hasBusinessLayer) return empty;

  const nodesById = new Map();
  nodes.forEach(node => {
    if (isPlainObjectish(node) && !isSuggested(node) && typeof node.id === 'string') nodesById.set(node.id, node);
  });

  const inDegree = new Map();
  const outDegree = new Map();
  const conditionalOut = new Map(); // node id -> [{ index, edge }]
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  edges.forEach((edge, index) => {
    if (!isPlainObjectish(edge)) return;
    if (touchesSuggestion(edge)) return;
    if (typeof edge.from === 'string') {
      bump(outDegree, edge.from);
      if (edge.condition != null) {
        if (!conditionalOut.has(edge.from)) conditionalOut.set(edge.from, []);
        conditionalOut.get(edge.from).push({ index, edge });
      }
    }
    if (typeof edge.to === 'string') bump(inDegree, edge.to);
  });

  // Every id already spoken for: a question id may collide with none of them
  // (src/n8n/validate.js:599-604, 697-706).
  const takenIds = new Set();
  const claim = list => {
    list.forEach(item => {
      if (isPlainObjectish(item) && typeof item.id === 'string') takenIds.add(item.id);
    });
  };
  claim(nodes);
  claim(groups);
  claim(notes);

  const full = () => errors.length >= MAX_ERRORS;

  // Emits one question: the error line the report prints, the open node, and
  // the edge that keeps it from being an `orphan-node` (src/n8n/validate.js:652-684).
  function emit({ path, code, message, rule, subjectKey, label, kind, prompt, subject, wire }) {
    const id = uniqueId(`q_${rule}_${idPart(subjectKey)}`, takenIds);
    if (id == null) return;
    errors.push({ path, code, message });
    emittedNodes.push(makeQuestionNode({ id, label, kind, prompt, subject }));
    wire(id);
  }

  const editEdge = (index, patch) => {
    edgeEdits.set(index, { ...(edgeEdits.get(index) || {}), ...patch });
  };

  // --- rules with a node as subject (1, 2, 4, 5, 6) -------------------------
  //
  // One pass in index order, so the report reads in JSON Pointer order the
  // way validateDoc()'s does.
  nodes.forEach((node, i) => {
    if (full()) return;
    if (!isPlainObjectish(node)) return;
    if (isOpen(node)) return; // an open node is never a subject
    if (isSuggested(node)) return; // nor is a suggestion: it is ignored entirely
    const path = `/nodes/${i}`;
    const out = outDegree.get(node.id) || 0;
    const into = inDegree.get(node.id) || 0;
    const name = nameOf(node);

    // Rule 1: every artifact has a named recipient. An artifact with ANY
    // outgoing edge is received by something and does not fire -- Medusa uses
    // `artifact` for data models and migrations consumed by services, and the
    // stricter reading ("recipient must be human or external") fires on six of
    // them (docs/design/business-map.md:213-216).
    if (node.kind === 'artifact' && out === 0) {
      emit({
        path,
        code: 'artifact-no-recipient',
        message: `Artifact "${truncate(node.id)}" has no outgoing edge; nothing in the map receives it. Name the person or party it goes to.`,
        rule: 'recipient',
        subjectKey: node.id,
        label: 'Who receives this?',
        kind: 'external',
        prompt: `${name} is produced but nothing in the map receives it. Name the person or party it goes to.`,
        subject: node,
        wire: id => appendedEdges.push({ from: node.id, to: id, type: 'solid' }),
      });
      return;
    }

    // Rule 2: every external input has a named source actor. `edge`-only and
    // `build`-only nodes are skipped: a failure branch or a CI job is not an
    // entry point.
    if (into === 0 && !PARTY_KINDS.has(node.kind) && (hasLayer(node, 'base') || hasLayer(node, 'business'))) {
      emit({
        path,
        code: 'input-no-source-actor',
        message: `Node "${truncate(node.id)}" has no incoming edge; nothing in the map sends work into it. Name who asks, and through what.`,
        rule: 'source',
        subjectKey: node.id,
        label: 'Who starts this?',
        kind: 'external',
        prompt: `${name} is where work enters but nothing in the map sends it. Who asks, and through what?`,
        subject: node,
        wire: id => appendedEdges.push({ from: id, to: node.id, type: 'solid' }),
      });
      return;
    }

    // Rule 4: every decision has a named decider, `human` or `logic`. A split
    // is two or more outgoing edges carrying a condition (docs/SPEC.md:66-71).
    const conditional = conditionalOut.get(node.id) || [];
    if (conditional.length >= 2 && !DECIDER_KINDS.has(node.kind)) {
      const conditions = conditional
        .map(({ edge }) => (typeof edge.condition === 'string' ? edge.condition.trim() : ''))
        .filter(Boolean)
        .map(truncate)
        .join(', ');
      emit({
        path,
        code: 'decision-no-decider',
        message: `Node "${truncate(node.id)}" has ${conditional.length} conditional outgoing edges but is not a "human" or "logic" node; name the person or rule that decides.`,
        rule: 'decider',
        subjectKey: node.id,
        label: 'Who decides?',
        kind: 'logic',
        prompt: `${name} branches on ${conditions || 'several conditions'} but is not a person or a rule. Who or what decides?`,
        subject: node,
        // Inserts: subject -> q (solid), and the conditional edges move their
        // `from` to q, keeping their own type and condition.
        wire: id => {
          appendedEdges.push({ from: node.id, to: id, type: 'solid' });
          conditional.forEach(({ index }) => editEdge(index, { from: id }));
        },
      });
      return;
    }

    // Rule 5: the flow reaches money or a discharged obligation, not merely
    // "record saved". The engine cannot recognise money (open question 6);
    // this catches its graph shape -- a business lifecycle that ends inside a
    // system rather than in someone's hands or in a document.
    if (out === 0 && hasLayer(node, 'business') && !PARTY_OR_ARTIFACT_KINDS.has(node.kind)) {
      emit({
        path,
        code: 'flow-dead-end',
        message: `Node "${truncate(node.id)}" is on the business layer with no outgoing edge; the flow ends inside a system. Name what it hands over, and to whom.`,
        rule: 'outcome',
        subjectKey: node.id,
        label: 'What comes out of this?',
        kind: 'artifact',
        prompt: `The flow stops at ${name}. What does it hand over, and to whom: an invoice, a receipt, a signed acceptance?`,
        subject: node,
        wire: id => appendedEdges.push({ from: node.id, to: id, type: 'solid' }),
      });
      return;
    }

    // Rule 6: every unhappy path has an owner. This is where business flow
    // documents are usually incomplete and the part a client cares about most
    // (docs/SPEC.md:271-272).
    if (out === 0 && hasLayer(node, 'edge') && !PARTY_OR_ARTIFACT_KINDS.has(node.kind)) {
      emit({
        path,
        code: 'unhappy-path-no-owner',
        message: `Node "${truncate(node.id)}" is on the edge layer with no outgoing edge; nobody owns this unhappy path. Name who handles it.`,
        rule: 'owner',
        subjectKey: node.id,
        label: 'Who handles this?',
        kind: 'human',
        prompt: `When ${name} happens, nobody in the map deals with it. Who owns it?`,
        subject: node,
        wire: id => appendedEdges.push({ from: node.id, to: id, type: 'solid' }),
      });
    }
  });

  // --- rule 3: a system-to-system handoff that is not an API call ----------
  //
  // Subject is the EDGE. `source: "user"` and no description is the whole
  // test: interview question 8 always writes the mechanism into the
  // description, so a user-sourced edge without one is an unanswered
  // question. Scan and unsourced edges are skipped because an API call and a
  // re-keyed spreadsheet look identical in the graph -- the naive reading
  // fires on seven ordinary API calls in Medusa
  // (docs/design/business-map.md:213-216).
  edges.forEach((edge, i) => {
    if (full()) return;
    if (!isPlainObjectish(edge)) return;
    if (edge.source !== 'user') return;
    if (touchesSuggestion(edge)) return;
    const described = typeof edge.description === 'string' && edge.description.trim().length > 0;
    if (described) return;
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (!from || !to) return;
    if (from.kind !== 'service' || to.kind !== 'service') return;
    // An endpoint that is itself an open question is not a subject: "how does
    // work reach the system we do not know about" is noise.
    if (isOpen(from) || isOpen(to)) return;

    const type = edge.type === 'dashed' || edge.type === 'gutter' ? edge.type : 'solid';
    emit({
      path: `/edges/${i}`,
      code: 'handoff-undrawn',
      message: `Edge #${i} ("${truncate(edge.from)}" -> "${truncate(edge.to)}") is a user-sourced handoff between two systems with no description; say how the work moves, or who carries it.`,
      rule: 'handoff',
      subjectKey: `${idPart(edge.from)}_${idPart(edge.to)}`,
      label: 'How does this move?',
      kind: 'manual',
      prompt: `Work goes from ${nameOf(from)} to ${nameOf(to)}. If a person carries it, who? If a system call, say so and describe the edge.`,
      subject: from,
      // Inserts from -> q -> to: the original edge (with the user's own
      // fields) is re-pointed at the question, and the second half repeats its
      // type. Once edges can carry `status`/`prompt` (open question 1) this
      // rule marks the edge open and stops inserting.
      wire: id => {
        editEdge(i, { to: id });
        appendedEdges.push({ from: id, to: edge.to, type });
      },
    });
  });

  // --- rule 6a: no unhappy path at all -------------------------------------
  //
  // A map-level gold "Consider:" note (docs/HANDOVER.md:223), not a node:
  // there is nothing to hang a question on, and inventing an anchor would be
  // a guess.
  if (!full()) {
    const hasEdgeLayer = nodes.some(n => isPlainObjectish(n) && !isSuggested(n) && hasLayer(n, 'edge'));
    if (!hasEdgeLayer) {
      // A copy that already carries the note (an earlier --emit-open, which
      // skills re-run to save a reviewed or suggested document) still reports
      // the question but does not get the same note a second time.
      const alreadyAsked = arrayOf(doc.notes).some(n => isPlainObjectish(n) && n.id === UNHAPPY_PATHS_NOTE_ID);
      const id = alreadyAsked ? UNHAPPY_PATHS_NOTE_ID : uniqueId(UNHAPPY_PATHS_NOTE_ID, takenIds);
      if (id != null) {
        errors.push({
          path: '/',
          code: 'unhappy-paths-missing',
          message:
            'This map has a business layer but no node on the "edge" layer; nothing goes wrong in it. Name what happens when nobody responds, the work is rejected, or the customer disputes it.',
        });
        if (!alreadyAsked) {
          emittedNotes.push({
            id,
            content:
              'Consider: nothing goes wrong in this map. What happens when nobody responds, the work is rejected, or the customer disputes it?',
            color: 'gold',
            layers: ['base'],
          });
        }
      }
    }
  }

  return result();
}

// The copy `--emit-open` writes: the user's document plus the questions.
// Built from the PARSED INPUT, not from validateDoc()'s normalised form, so
// the user's own fields and key order survive (docs/design/business-map.md:284-287).
// Purely functional: the input document and every object in it are left
// untouched, and edited edges are replaced by new objects rather than mutated.
function buildOpenDocument(doc, additions) {
  if (!isPlainObjectish(doc)) return doc;
  const plan = isPlainObjectish(additions) ? additions : {};
  const newNodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const newEdges = Array.isArray(plan.edges) ? plan.edges : [];
  const newNotes = Array.isArray(plan.notes) ? plan.notes : [];
  const edits = new Map((Array.isArray(plan.edgeEdits) ? plan.edgeEdits : []).map(edit => [edit.index, edit]));

  if (newNodes.length === 0 && newEdges.length === 0 && newNotes.length === 0 && edits.size === 0) {
    return { ...doc };
  }

  const existingNodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  const existingEdges = Array.isArray(doc.edges) ? doc.edges : [];
  const existingNotes = Array.isArray(doc.notes) ? doc.notes : [];

  const rewiredEdges = existingEdges.map((edge, i) => {
    const edit = edits.get(i);
    if (!edit || !isPlainObjectish(edge)) return edge;
    const next = { ...edge };
    if (typeof edit.from === 'string') next.from = edit.from;
    if (typeof edit.to === 'string') next.to = edit.to;
    return next;
  });

  // Spreading `doc` first keeps the document's own key order; nodes/edges
  // keep their original position, and `notes` is only introduced when rule 6a
  // actually fired on a document that had none.
  const copy = {
    ...doc,
    nodes: [...existingNodes, ...newNodes],
    edges: [...rewiredEdges, ...newEdges],
  };
  if (newNotes.length > 0 || existingNotes.length > 0) copy.notes = [...existingNotes, ...newNotes];
  return copy;
}

module.exports = { checkCompleteness, buildOpenDocument };
