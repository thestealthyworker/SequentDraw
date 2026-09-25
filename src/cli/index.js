// SequentDraw CLI dispatcher: `sequentdraw <command> [options]`.
//
// bin/sequentdraw is the thin installed entry point (see package.json
// "bin") that calls main() here. `node src/n8n/cli.js` remains a separate,
// unchanged entry for the legacy two-positional-args invocation.
//
// Strict argument handling throughout: an unknown command, unknown flag, or
// extra positional prints usage and exits 1; nothing is ever written on
// error (each subcommand owns that guarantee for its own writes).

const renderCmd = require('./render');
const validateCmd = require('./validate');
const scanCmd = require('./scan');
const checkCmd = require('./check');
const licencesCmd = require('./licences');

// `mcp` starts the stdio MCP server (src/mcp/server.js) and never returns
// until stdin ends -- see that file for the protocol. It is dispatched
// through COMMANDS like every other command, but src/mcp/tools.js lists
// the six MCP tools by name rather than from COMMANDS' own keys, so this
// command never becomes a seventh tool that calls itself.
const MCP_USAGE = 'Usage: sequentdraw mcp';
const mcpCmd = {
  USAGE: MCP_USAGE,
  async run(args, io = {}) {
    const stdout = io.stdout || process.stdout;
    const stderr = io.stderr || process.stderr;
    const stdin = io.stdin || process.stdin;

    if (args.includes('--help') || args.includes('-h')) {
      stdout.write(`${MCP_USAGE}\n\nStarts the SequentDraw MCP server over stdio (newline-delimited JSON-RPC 2.0). Runs until stdin ends.\n`);
      return 0;
    }
    if (args.length > 0) {
      stderr.write(`${MCP_USAGE}\n`);
      return 1;
    }
    const { runServer } = require('../mcp/server');
    return runServer({ stdin, stdout, stderr });
  },
};

const COMMANDS = {
  render: renderCmd,
  validate: validateCmd,
  scan: scanCmd,
  check: checkCmd,
  catalogue: require('./catalogue'),
  licences: licencesCmd,
  mcp: mcpCmd,
};

const TOP_USAGE = `Usage: sequentdraw <command> [options]

Commands:
  render <in.json|-> <out.html|out.svg> [--layers a,b] [--fragment] [--merge <patch|->]
                                        Render a workflow JSON document to
                                        HTML or SVG.
  validate <in.json|->                 Validate a workflow JSON document.
  scan <path|url> --out <bundle.json>  Scan a repository into an evidence
                                        bundle.
  check <map.json|-> [--merge <patch|->] [--evidence <f>] [--emit-open <out.json>] [--repos <f>]
                                        Check a map: structure, scan-sourced
                                        claims against an evidence bundle,
                                        completeness, and repository notes
                                        against verified licences.
  licences <owner/repo> ... --out <f>  Verify candidate repositories through
                                        the GitHub API (MIT only, active,
                                        not a fork).
  mcp                                  Start the MCP server over stdio, for
                                        hosts that reach SequentDraw through
                                        MCP instead of a shell command.

"-" as the input document reads it from stdin, and so does "-" as a --merge
patch when the input is a file. Output paths, --evidence, --repos and
--emit-open are always real files.

Run "sequentdraw <command> --help" for command-specific options.
`;

async function main(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const stdin = io.stdin || process.stdin;
  const [command, ...rest] = argv;

  if (!command) {
    stderr.write(TOP_USAGE);
    return 1;
  }
  if (command === '--help' || command === '-h') {
    stdout.write(TOP_USAGE);
    return 0;
  }

  const impl = COMMANDS[command];
  if (!impl) {
    stderr.write(`Unknown command "${command}".\n${TOP_USAGE}`);
    return 1;
  }

  return impl.run(rest, { stdout, stderr, stdin });
}

module.exports = { main, COMMANDS, TOP_USAGE };
