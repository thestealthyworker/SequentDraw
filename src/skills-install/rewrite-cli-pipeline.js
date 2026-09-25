// Rewrites a COPIED skill's `references/cli-pipeline.md` so it names a
// working engine command, instead of the plugin-root math every skill's
// source copy uses ("the plugin root is two directories above this
// skill's own directory"). That math only holds for a skill still living
// inside a Claude Code plugin checkout -- a skill copied to
// ~/.agents/skills/<name> (or any other host location) has no plugin root
// two directories up, so the original section would send every skill down
// a dead path. See docs/design/skills-and-plugin.md, "skills install".
//
// Exactly two spots change, both inside this one file:
//   1. The whole "## Resolving `<sequentdraw>`" section is replaced with a
//      generated one that names the engine command literally.
//   2. Inside "## Learning the document shape", the one
//      "<plugin root>/schema/..." reference is replaced the same way.
// Every other byte of the file, and every other file in the skill, is
// untouched -- `copy-skill.js` copies everything else byte for byte.

const RESOLVING_HEADING = '## Resolving `<sequentdraw>`';
const SCHEMA_HEADING = '## Learning the document shape';
const SCHEMA_MARKER = '`<plugin root>/schema/sequentdraw.schema.json`';
const NEXT_HEADING_RE = /\n## /;

// Splits `content` into the text before `heading`, the section starting at
// `heading` and running up to (not including) the next top-level "## "
// heading -- or to the end of the file when there is none -- and the text
// after that point.
function splitSection(content, heading) {
  const start = content.indexOf(heading);
  if (start === -1) throw new Error(`section heading not found: "${heading}"`);
  const searchFrom = start + heading.length;
  const rest = content.slice(searchFrom);
  const nextMatch = rest.match(NEXT_HEADING_RE);
  // +1 keeps the "\n" that starts the next heading's own line with `after`,
  // matching how every other section boundary in this file is spaced.
  const sectionEnd = nextMatch ? searchFrom + nextMatch.index + 1 : content.length;
  return {
    before: content.slice(0, start),
    section: content.slice(start, sectionEnd),
    after: content.slice(sectionEnd),
  };
}

// The engine command this copy runs, and which case produced it. `kind`
// drives the wording of the generated section, not just the command
// itself, since a path and a published-version pin need different caveats.
function buildEngineCommand({ isNpx, packageRoot, version }) {
  if (isNpx) {
    return { kind: 'npx', command: `npx -y sequentdraw@${version}`, packageRoot };
  }
  // Always double-quoted, matching the original section's own rule ("if
  // that path contains a space, put it in double quotes") -- quoting a
  // path that happens to have no space in it is harmless, so this needs no
  // conditional and no test can catch it doing the wrong thing on either
  // input.
  return { kind: 'stable', command: `node "${packageRoot}/bin/sequentdraw"`, packageRoot };
}

// What "Learning the document shape" should call the schema by, for this
// engine. A stable install still has a schema file on disk to point at; an
// npx run's own path is a temporary cache that will be cleaned up, so it
// is described instead of pointed at.
function schemaReferenceText(engine) {
  if (engine.kind === 'npx') {
    return 'the schema that ships inside the package';
  }
  return `\`${engine.packageRoot}/schema/sequentdraw.schema.json\``;
}

function buildResolvingSection(engine) {
  const intro = engine.kind === 'npx'
    ? [
      'This copy of the skill is running from a temporary `npx` cache, which',
      'will be cleaned up later, so `<sequentdraw>` names an exact published',
      'version instead of a path. For a faster, stable engine, run',
      '`npm install -g sequentdraw` and reinstall this skill.',
    ].join('\n')
    : [
      'This copy of the skill was installed by `sequentdraw skills install`',
      'for one fixed engine command. `<sequentdraw>` is always the command',
      'below -- never a variable, and never a path this skill computes',
      'itself:',
    ].join('\n');

  const quoteBullet = engine.kind === 'stable'
    ? '- If this command\'s own path contains a space, it is already wrapped\n'
      + '  in double quotes above -- keep that quoting exactly as written.\n'
    : '';

  return `${RESOLVING_HEADING}

${intro}

\`\`\`
${engine.command}
\`\`\`

- **Never substitute a variable, an environment variable reference, or a
  placeholder for this command.** It is already the literal command chosen
  when the skill was installed. Write any output folder the same way, as a
  literal absolute path, never a shell variable such as a temp-directory
  one -- a narrow grant can refuse the expansion, or split it unexpectedly
  into several arguments, so the grant cannot tell what the command would
  actually run.
${quoteBullet}- **Never** go through \`bash scripts/sequentdraw.sh\`, and never start with
  \`cd ... &&\`. Both can be refused under a narrow grant.
- **A refused command means that command form was refused, not that the
  shell is unavailable.** Commands such as \`ls\`, \`pwd\`, \`cd\`, \`echo\`,
  \`env\` or \`find\` may be refused while the command above is allowed.
  Never probe with them. If a call is refused, retry it once in exactly the
  shapes below with the exact command above before concluding anything.
- **If the CLI still cannot run, say so, and claim nothing it would have
  said.** Report that the engine did not run. Never state what \`check\`,
  \`scan\` or \`render\` would have found or produced, from the map's
  contents or from anything else: an engine result that was never computed
  is not a fact, and presenting it as one is worse than saying it is
  missing.
- Look for files with the host's file tools (Read, and Glob inside the
  working directory), never with shell commands.

`;
}

// Applies the one schema-path substitution inside the (already-extracted)
// "Learning the document shape" section. For the npx case, the follow-on
// sentence about opening the file no longer makes sense once the marker is
// replaced by a description rather than a path, so it is folded into one
// sentence that says the engine enforces the shape itself.
function rewriteSchemaSection(section, engine) {
  if (!section.includes(SCHEMA_MARKER)) {
    throw new Error('schema reference not found in "Learning the document shape" section');
  }
  if (engine.kind === 'npx') {
    const readSentence = "Read that file with the\nhost's file-reading tool when a field is unclear.";
    if (!section.includes(readSentence)) {
      throw new Error('expected sentence after the schema reference was not found');
    }
    return section
      .replace(SCHEMA_MARKER, schemaReferenceText(engine))
      .replace(
        readSentence,
        'The CLI validates every document against it, so an unclear field\nsurfaces as a validation error rather than needing to be read ahead of\ntime.',
      );
  }
  return section.split(SCHEMA_MARKER).join(schemaReferenceText(engine));
}

// The one exported entry point: takes the source `references/cli-pipeline.md`
// content and the engine this install resolved to, and returns the copy's
// content with exactly the two spots above rewritten.
function rewriteCliPipeline(content, engineInfo) {
  const engine = buildEngineCommand(engineInfo);

  const resolving = splitSection(content, RESOLVING_HEADING);
  const afterResolving = resolving.before + buildResolvingSection(engine) + resolving.after;

  const schema = splitSection(afterResolving, SCHEMA_HEADING);
  const rewrittenSchema = rewriteSchemaSection(schema.section, engine);
  return schema.before + rewrittenSchema + schema.after;
}

module.exports = {
  rewriteCliPipeline,
  buildEngineCommand,
  schemaReferenceText,
  splitSection,
  RESOLVING_HEADING,
  SCHEMA_HEADING,
};
