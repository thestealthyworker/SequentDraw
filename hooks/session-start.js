#!/usr/bin/env node
// SessionStart hook: injects the `using-sequentdraw` routing note as
// additionalContext -- see docs/design/skills-and-plugin.md, "Routing
// context". Hooks cannot invoke a skill; this only nudges the model toward
// the right one. Kept well under 1,500 characters on purpose.
'use strict';

const NOTE = `# using-sequentdraw

SequentDraw skills (this plugin):
- git-map: map a repo's architecture from a local path or GitHub URL, evidence-only -- every node/edge cites a scan finding, gaps become "open".
- business-map: map a business, process or idea by INTERVIEWING the user -- about eight questions from "work is needed" to "paid"; unknowns become "open" questions; then offers up to five n8n integrations as "suggested" nodes. A conversation, never in the background.
- eval-build: balanced review of an EXISTING map (or map it first): what works, what is missing, what is fragile, drawn in the map; also "suggest integrations for this map".
- grill-build: harsh critique of an existing map ONLY when asked to grill, stress-test, tear apart or be brutal; alternatives drawn beside what they replace.
- doc-map: export an EXISTING SequentDraw map as a static SVG figure for docs/slides; never invents structure.

Not SequentDraw's job: building or deploying n8n workflows; general Mermaid or chart requests; tool advice with no map; grilling a plan with no build or map; exporting a map that does not exist yet (run git-map or business-map first, then doc-map).

Rule: every skill that produces a map or figure publishes a private Claude artifact plus a local copy outside the repo, and writes into the repo only if the user asks.`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: NOTE,
    },
  })
);
