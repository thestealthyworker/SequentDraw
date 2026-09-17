---
type: tool_order
before:
  tool: Bash
  input_match: 'bin/sequentdraw(?:\\")?\s+catalogue'
after:
  tool: Bash
  input_match: '\\"status\\":\s*\\"suggested\\"'
weight: 1
---

Suggestions come from the catalogue, never from memory. The first Bash call
that runs `node ".../bin/sequentdraw" catalogue` must come before the first
Bash call whose command carries a suggested node. Locally the catalogue
call prints a JSON array that begins:

    [
      {
        "id": "stripe",

`input_match` is tested against the JSON-encoded tool input, where the
document piped through `printf` carries its quotes escaped, so a suggested
node shows up as `\"status\": \"suggested\"`. The catalogue output itself
contains no `status` key, and the skill text writes the field as
`status: "suggested"` (no quoted key), so neither can stand in for a real
suggested document.
