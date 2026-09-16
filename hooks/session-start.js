#!/usr/bin/env node
// SessionStart hook: injects the `using-sequentdraw` routing note as
// additionalContext -- see docs/design/skills-and-plugin.md, "Routing
// context". Hooks cannot invoke a skill; this only nudges the model toward
// the right one. Kept well under 1,500 characters on purpose.
'use strict';

const NOTE = `# using-sequentdraw

SequentDraw skills (this plugin):
- git-map: map a repo's architecture from a local path or GitHub URL, evidence-only -- every node/edge cites a scan finding, gaps become "open".
- doc-map: export an EXISTING SequentDraw map as a static SVG figure for docs/slides; never invents structure.

Not SequentDraw's job: building or deploying n8n workflows; general Mermaid or chart requests; a business/process map (business-map, not shipped yet); reviewing or grilling an architecture (eval-build/grill-build, not shipped yet); exporting a map that does not exist yet (run git-map first, then doc-map).

Rule: every skill that produces a map or figure publishes a private Claude artifact plus a local copy outside the repo, and writes into the repo only if the user asks.`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: NOTE,
    },
  })
);
