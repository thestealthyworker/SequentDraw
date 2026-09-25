---
type: regex
target: trace
pattern: '\\"tour\\"\s*:\s*\[\s*\{\s*\\"order\\"\s*:\s*\d+(?:(?!"type":"tool_use")[\s\S]){0,4000}?bin/sequentdraw(?:\\")?\s+check\s+(?:\\")?[^\s"\\]*gaps[^\s"\\]*\.json(?:\\")?\s+--merge\s+-\s+--emit-open\s+(?:\\")?[^\s"\\]*tour[^\s"\\]*\.json(?:\\")?"(?:(?!"type":"tool_use")[\s\S]){0,4000}?(?:\\n|"(?:content|text|stdout)":")wrote [^\s"\\]*tour[^\s"\\]*\.json \(\d+ open nodes?(?:, \d+ notes?)?\)'
match: contains
weight: 1
---

A tour was actually passed to the engine and accepted, not merely described
in prose. The pattern requires the real Bash tool call: the escaped
quoting a real `tool_use` input has around the JSON payload and the CLI
path (`\"tour\":[{\"order\":1,...` then, later in the same command string,
`\"...bin/sequentdraw\" check .../gaps.json --merge - --emit-open
.../tour.json`), followed -- within the same tool call's result, never
crossing into a later `"type":"tool_use"` -- by the `wrote
.../tour.json (<n> open node(s))` line `--emit-open` prints on success.

`references/tours.md` shows the same patch and command shape, but only as
plain Markdown inside a fenced code block: `"order": 1` with a single
quote, no backslash, and no digit directly after an escaped quote followed
by a colon the way a real tool call's JSON-encoded command string has it.
Loading the skill (or this reference) into the trace cannot satisfy this
grader on its own, because the reference never appears as a `tool_use`
input: it has no `\"tour\":` or `\"order\":\d`, and no `bin/sequentdraw`
immediately preceded by an escaped quote.

Tested locally against this case before trusting it (`claude plugin eval .
--trust-plugin --scaffold --no-publish --ablation none --allow-tools
"Bash(node:*)" --json /tmp/sd-tour-eval.json --keep-temp --case
business-map-output-tour`). Captured from the CLI call and its result in
that run's trace:

    ...bin/sequentdraw\" check /private/tmp/e-xPduCh/tmp/sequentdraw-cleaning/gaps.json --merge - --emit-open /private/tmp/e-xPduCh/tmp/sequentdraw-cleaning/tour.json","description":"Add a 4-step tour and save as tour.json"}...
    ...content":"wrote /private/tmp/e-xPduCh/tmp/sequentdraw-cleaning/tour.json (0 open nodes)","is_error":...

with the printf-piped `"tour":[{"order":1,...` patch, escaped the same way,
about 1,600 characters earlier in the same command string -- which is why
the window between the `order` marker and `bin/sequentdraw` needs room for
a whole tour's JSON, not just a short flag string.
