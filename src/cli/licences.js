// `sequentdraw licences <owner/repo> [...] --out <verified.json>`
//
// Verifies candidate repositories through the GitHub API and writes the
// verdicts (docs/design/gitrepo-suggest.md section 2). The verdicts ARE the
// output: the command exits 0 whenever the file is written, whatever each
// repository turned out to be, because "this one is AGPL-3.0" is the answer
// the caller needs and not a failure of the run.
//
// It exits 1 only when it could not do its job at all: a usage error, more
// repositories than --max, or a path it cannot write.
//
// The token is read here, from the environment only, and handed to the
// verifier as a value. It is never accepted as an argument -- an argument
// lands in shell history, in a process list, and in any log of the command
// line -- and never printed, including in an error.
//
// Same strict-argument contract as the other subcommands: an unknown flag,
// a missing value or no repositories at all prints usage and exits 1, and
// nothing is written on any error.

const fs = require('fs');
const path = require('path');
const { verifyRepos, REASON_TEXT, DEFAULT_MAX_REPOS } = require('../repos/licences');
const { parseRepoId } = require('../repos/repo-id');

const USAGE =
  'Usage: sequentdraw licences <owner/repo> [<owner/repo> ...] --out <verified.json> [--token-env <NAME>] [--max <n>]';

const DEFAULT_TOKEN_ENV = 'GITHUB_TOKEN';

const HELP = `${USAGE}

Checks each repository against the GitHub API and writes one verdict per
repository. A repository is usable only when ALL of these hold:

  * GitHub's licence API reports an SPDX id of exactly "MIT" -- not MIT-0,
    not NOASSERTION, not a licence it cannot identify;
  * it is not archived;
  * something has been pushed to it within 18 months;
  * it is not a fork;
  * it has at least 50 stars.

A repository that fails any rule is written with the reason, so a caller can
say why a candidate was dropped rather than silently producing fewer.

Nothing is cloned and nothing is executed: this reads two JSON documents per
repository from api.github.com and no other host.

Options:
  --out <file>        Where to write the verdicts. Required. Nothing is
                       written if any argument is refused.
  --token-env <NAME>  Environment variable holding a GitHub token (default
                       ${DEFAULT_TOKEN_ENV}). The token is sent as a header and is
                       never logged or written to the output. Without one,
                       GitHub allows 60 requests an hour, and this command
                       uses two per repository.
  --max <n>           Refuse a run of more than n repositories (default
                       ${DEFAULT_MAX_REPOS}).
  --help              Show this help.

Exits 0 whenever the file is written, whatever the verdicts are.
`;

function flagValue(args, i) {
  const value = args[i + 1];
  if (value == null || value.startsWith('-')) return null;
  return value;
}

function parseArgs(args) {
  const repos = [];
  let outPath = null;
  let tokenEnv = DEFAULT_TOKEN_ENV;
  let max = DEFAULT_MAX_REPOS;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out') {
      const value = flagValue(args, i);
      if (value == null) return null;
      outPath = value;
      i++;
    } else if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath) return null;
    } else if (arg === '--token-env') {
      const value = flagValue(args, i);
      if (value == null) return null;
      tokenEnv = value;
      i++;
    } else if (arg.startsWith('--token-env=')) {
      tokenEnv = arg.slice('--token-env='.length);
      if (!tokenEnv) return null;
    } else if (arg === '--max') {
      const value = flagValue(args, i);
      if (value == null) return null;
      max = Number(value);
      i++;
    } else if (arg.startsWith('--max=')) {
      max = Number(arg.slice('--max='.length));
    } else if (arg.startsWith('-')) {
      return null;
    } else {
      repos.push(arg);
    }
  }

  if (repos.length === 0 || outPath == null) return null;
  if (!Number.isInteger(max) || max < 1) return null;
  return { repos, outPath, tokenEnv, max };
}

async function run(args, io = {}, deps = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const env = deps.env || process.env;

  if (args.includes('--help') || args.includes('-h')) {
    stdout.write(HELP);
    return 0;
  }

  const parsed = parseArgs(args);
  if (!parsed) {
    stderr.write(`${USAGE}\n`);
    return 1;
  }

  // Every id is checked before a single request is made, so a typo does not
  // cost part of the rate-limit budget and no URL is ever built from text
  // that was not accepted here.
  const bad = parsed.repos.filter(id => parseRepoId(id) == null);
  if (bad.length > 0) {
    stderr.write(`${USAGE}\n`);
    bad.forEach(id =>
      stderr.write(`"${String(id).slice(0, 120)}" is not a bare "owner/repo" identifier.\n`),
    );
    return 1;
  }

  if (parsed.repos.length > parsed.max) {
    stderr.write(
      `${parsed.repos.length} repositories were given; --max is ${parsed.max}. Verify fewer, or raise --max.\n`,
    );
    return 1;
  }

  let verified;
  try {
    verified = await verifyRepos(parsed.repos, {
      // Own properties only: process.env inherits Object.prototype, so a
      // --token-env of "constructor" would otherwise send the Object
      // constructor's source as a bearer token.
      token: Object.prototype.hasOwnProperty.call(env, parsed.tokenEnv) ? env[parsed.tokenEnv] || null : null,
      max: parsed.max,
      fetchImpl: deps.fetchImpl,
      nowIso: deps.nowIso,
      timeoutMs: deps.timeoutMs,
      wallClockMs: deps.wallClockMs,
    });
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 1;
  }

  const serialized = `${JSON.stringify(verified, null, 2)}\n`;
  try {
    fs.mkdirSync(path.dirname(parsed.outPath), { recursive: true });
    fs.writeFileSync(parsed.outPath, serialized);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 1;
  }

  // Every rejection is named on stderr, with its reason in words: a caller
  // that attaches only the survivors still needs to be able to say why the
  // others were dropped.
  verified.repos
    .filter(entry => !entry.usable)
    .forEach(entry => {
      const why = REASON_TEXT[entry.reason] || entry.reason || 'rejected';
      stderr.write(`${entry.id}  ${why}\n`);
    });

  const usable = verified.repos.filter(entry => entry.usable).length;
  const rejected = verified.repos.length - usable;
  stdout.write(
    `wrote ${parsed.outPath} (${usable} usable, ${rejected} rejected)\n`,
  );
  return 0;
}

module.exports = { run, parseArgs, USAGE, HELP, DEFAULT_TOKEN_ENV };
