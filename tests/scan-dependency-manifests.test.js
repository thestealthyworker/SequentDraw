// The dependency-manifest parsers vendored from @specfy/stack-analyser in
// build step 8a (src/scan/rules/dependency-manifests.js).
//
// How the port was proven. Before anything was changed, every scan fixture
// was scanned with stack-analyser and the whole evidence bundle recorded.
// After the port the six existing fixtures came back byte-identical, ids
// included. The polyglot fixture -- written for this step, because no
// existing fixture exercised any of these eight ecosystems -- differed
// ONLY where the original was wrong, and each of those differences is
// pinned below as a named fix.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const {
  parseGoMod,
  parseCargoToml,
  parseGemfile,
  parseComposerJson,
  parseDenoLock,
  parseTerraformLock,
  parseTerraformResources,
  parseWorkflowDependencies,
  stripHclComments,
  splitImage,
} = require('../src/scan/rules/dependency-manifests');
const { isKnownResourceType, EXACT, PREFIXES } = require('../src/scan/rules/terraform-resources');
const { scanPath } = require('../src/scan/scan');

const POLYGLOT = path.resolve(__dirname, 'fixtures', 'repos', 'polyglot');
const read = rel => fs.readFileSync(path.join(POLYGLOT, rel), 'utf8');

describe('each ecosystem reads what the original read', () => {
  test('Go: direct modules only; an indirect module is skipped', () => {
    assert.deepStrictEqual(parseGoMod(read('services/api/go.mod')), [
      ['golang', 'github.com/stripe/stripe-go/v76', 'v76.8.0'],
      ['golang', 'github.com/redis/go-redis/v9', 'v9.5.1'],
      ['golang', 'golang.org/x/text', 'v0.14.0'],
    ]);
  });

  test('Rust: plain, table, git and path dependencies, across all three sections', () => {
    const got = Object.fromEntries(parseCargoToml(read('services/billing/Cargo.toml')).map(([, n, v]) => [n, v]));
    assert.deepStrictEqual(got, {
      serde: '1.0',
      tokio: '1.36',
      'stripe-rust': 'git:https://github.com/arlyon/async-stripe#main',
      shared: 'path:../shared',
      sqlx: '0.7',
      mockall: '0.12',
      cc: '1.0',
    });
  });

  test('Rust: a Cargo.toml that does not parse contributes nothing', () => {
    assert.deepStrictEqual(parseCargoToml('[dependencies\nserde = '), []);
  });

  test('PHP: require and require-dev', () => {
    assert.deepStrictEqual(parseComposerJson(read('services/web/composer.json')), [
      ['php', 'php', '^8.2'],
      ['php', 'laravel/framework', '^11.0'],
      ['php', 'stripe/stripe-php', '^13.0'],
      ['php', 'phpunit/phpunit', '^10.5'],
    ]);
  });

  test('PHP: a composer.json with no name is skipped, as before', () => {
    assert.deepStrictEqual(parseComposerJson(read('edge/composer.json')), []);
  });

  test('Deno: every remote entry in the lockfile', () => {
    assert.deepStrictEqual(parseDenoLock(read('edge/deno.lock')), [
      ['deno', 'https://deno.land/std@0.220.0/http/server.ts', 'abc123'],
      ['deno', 'https://deno.land/x/oak@v12.6.1/mod.ts', 'def456'],
    ]);
  });

  test('Terraform: only resource types that match a known technology', () => {
    assert.deepStrictEqual(parseTerraformResources(read('infra/main.tf')), [
      ['terraform.resource', 'aws_s3_bucket', 'unknown'],
      ['terraform.resource', 'aws_sqs_queue', 'unknown'],
      ['terraform.resource', 'google_storage_bucket', 'unknown'],
    ]);
  });

  test('Terraform: a commented-out resource is never reported', () => {
    // main.tf mentions aws_iam_role in a # comment and aws_rds_cluster in a
    // /* */ block; both would match a known prefix if they were real.
    assert.ok(isKnownResourceType('aws_iam_role') || isKnownResourceType('aws_rds_cluster'));
    const types = parseTerraformResources(read('infra/main.tf')).map(t => t[1]);
    assert.ok(!types.includes('aws_iam_role'));
    assert.ok(!types.includes('aws_rds_cluster'));
  });

  test('HCL comment stripping leaves string contents alone', () => {
    const out = stripHclComments('a = "keep # this // and /* this */"  # drop\nb = 1 // drop\n/* drop */c = 2');
    assert.strictEqual(out, 'a = "keep # this // and /* this */"  \nb = 1 \nc = 2');
  });
});

describe('the table vendored from the original rules', () => {
  test('85 exact types and 81 prefixes, as extracted', () => {
    assert.strictEqual(EXACT.size, 85);
    assert.strictEqual(PREFIXES.length, 81);
  });

  test('matching is exact-or-prefix, and nothing else', () => {
    assert.strictEqual(isKnownResourceType('aws_s3_bucket'), true);
    assert.strictEqual(isKnownResourceType('null_resource'), false);
    assert.strictEqual(isKnownResourceType(''), false);
  });
});

// Each of these was found by recording what the original emitted on the
// polyglot fixture. The original's output is quoted in each comment.
describe('the five defects fixed in the port', () => {
  test('1. every record carries the path of the manifest it came from', async () => {
    // Original: `manifest-dependency |  | rails | 7.1.3` -- no path at all,
    // for every Go, Ruby, Deno and Actions dependency.
    const bundle = await scanPath(POLYGLOT, { source: 'local', name: 'polyglot' });
    const dependencyKinds = new Set(['manifest-dependency', 'iac-resource', 'ci-job', 'image']);
    const pathless = bundle.evidence.filter(e => dependencyKinds.has(e.kind) && !e.path);
    assert.deepStrictEqual(pathless, [], 'evidence that cannot say which file it came from');
  });

  test('2. an Actions container given as an object is read as an image', () => {
    // Original: `image | h | a` for `container: { image: hashicorp/terraform }`.
    const deps = parseWorkflowDependencies(read('.github/workflows/ci.yml'));
    assert.ok(deps.some(([t, n, v]) => t === 'docker' && n === 'hashicorp/terraform' && v === 'latest'));
    assert.ok(!deps.some(([, n]) => n === 'h'));
  });

  test('3. a Terraform provider is reported once', () => {
    // Original: each lockfile provider twice, once with no path.
    assert.deepStrictEqual(parseTerraformLock(read('infra/.terraform.lock.hcl')), [
      ['terraform', 'registry.terraform.io/hashicorp/aws', '5.40.0'],
      ['terraform', 'registry.terraform.io/hashicorp/google', '5.20.0'],
    ]);
  });

  test('4. a Gemfile entry is read with single quotes, and with no version', () => {
    // Original: required double quotes AND a comma, so these were missed.
    assert.deepStrictEqual(parseGemfile(read('services/web/Gemfile')), [
      ['ruby', 'rails', '7.1.3'],
      ['ruby', 'pg', '~> 1.5'],
      ['ruby', 'sidekiq', 'latest'],
      ['ruby', 'redis', '5.0'],
      ['ruby', 'stripe', '10.0.0'],
    ]);
  });

  test('5. every workflow in a directory is read, not only the first', async () => {
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sd-8a-'));
    try {
      fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
      for (const [file, action] of [['a.yml', 'actions/first'], ['b.yml', 'actions/second']]) {
        fs.writeFileSync(
          path.join(dir, '.github', 'workflows', file),
          `on: [push]\njobs:\n  j:\n    runs-on: x\n    steps:\n      - uses: ${action}@v1\n`,
        );
      }
      const bundle = await scanPath(dir, { source: 'local', name: 'two-workflows' });
      const actions = bundle.evidence.filter(e => e.kind === 'ci-job' && e.value.startsWith('actions/')).map(e => e.value);
      assert.deepStrictEqual(actions.sort(), ['actions/first', 'actions/second']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('small changes of mechanism', () => {
  test('an image registry with a port keeps its host', () => {
    // The original split on every colon: "localhost:5000/tool:1" became
    // image "localhost", version "5000/tool".
    assert.deepStrictEqual(splitImage('localhost:5000/tool:1'), ['localhost:5000/tool', '1']);
    assert.deepStrictEqual(splitImage('postgres:16'), ['postgres', '16']);
    assert.deepStrictEqual(splitImage('redis'), ['redis', '']);
  });

  test('Cargo workspace dependencies are read', () => {
    // The original looked up the literal key "workspace.dependencies",
    // which TOML never produces.
    const deps = parseCargoToml('[workspace.dependencies]\nserde = "1.0"\n');
    assert.deepStrictEqual(deps, [['rust', 'serde', '1.0']]);
  });
});

test('stack-analyser is no longer loaded by the scanner', () => {
  const scanSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'scan', 'scan.js'), 'utf8');
  assert.doesNotMatch(scanSource, /import\(['"]@specfy/);
  assert.doesNotMatch(scanSource, /require\(['"]@specfy/);
});
