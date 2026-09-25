// #27: the scanner must map the repository, not the repository's
// own test fixtures.
//
// Before this policy existed, scanning the SequentDraw checkout produced
// 69 evidence entries of which 54 came from tests/fixtures/repos/* and
// evals/* -- three synthetic fixture apps. `check --evidence` passed the
// resulting map, because every fact was real; they were just facts about
// someone else's system. These tests pin both halves of the fix: the
// fixture trees are excluded and reported, and what remains actually
// describes the product.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { scanPath } = require('../src/scan/scan');
const {
  RelevancePolicy,
  productRootsFromPackageJson,
  productRootsFromCompose,
} = require('../src/scan/exclusions');
const {
  parsePackageComponents,
  parsePluginManifest,
  parseComponentPath,
} = require('../src/scan/parsers/component-parser');

const ROOT = path.resolve(__dirname, '..');
const REPOS_DIR = path.join(__dirname, 'fixtures', 'repos');

function scanFixture(name) {
  return scanPath(path.join(REPOS_DIR, name), { name, source: 'local', ref: null });
}

function exclusionFor(bundle, p) {
  return bundle.exclusions.find(e => e.path === p);
}

describe('relevance policy (unit)', () => {
  test('excludes conventional test directories and test-named files', () => {
    const policy = new RelevancePolicy([]);
    assert.deepStrictEqual(policy.classifyDir('tests'), { reason: 'test-directory', ambiguous: false });
    assert.deepStrictEqual(policy.classifyDir('src/__tests__'), { reason: 'test-directory', ambiguous: false });
    assert.deepStrictEqual(policy.classifyDir('evals'), { reason: 'test-directory', ambiguous: false });
    assert.deepStrictEqual(policy.classifyFile('docker-compose.test.yml'), { reason: 'test-file', ambiguous: false });
    assert.strictEqual(policy.classifyDir('src'), null);
    assert.strictEqual(policy.classifyFile('latest.json'), null);
  });

  test('flags example-style directories as ambiguous rather than treating them as certain', () => {
    const policy = new RelevancePolicy([]);
    assert.deepStrictEqual(policy.classifyDir('examples'), { reason: 'example-directory', ambiguous: true });
  });

  test('a directory the manifest points at is kept, however it is named', () => {
    const policy = new RelevancePolicy(['examples', 'demo/app']);
    assert.strictEqual(policy.classifyDir('examples'), null);
    // "demo" contains a product root, so it is kept too.
    assert.strictEqual(policy.classifyDir('demo'), null);
  });

  test('a test directory nested inside a product directory is still a test directory', () => {
    // The voting app's `result/` is a product root; `result/tests/` is not,
    // and its docker-compose.test.yml is what leaked false facts.
    const policy = new RelevancePolicy(['result']);
    assert.deepStrictEqual(policy.classifyDir('result/tests'), { reason: 'test-directory', ambiguous: false });
  });

  test('product roots are read from what the manifests actually declare', () => {
    const roots = productRootsFromPackageJson(
      JSON.stringify({ main: 'src/index.js', bin: { tool: 'bin/tool' }, workspaces: ['examples/*'], files: ['dist/'] }),
    );
    assert.ok(roots.includes('src/index.js'));
    assert.ok(roots.includes('bin/tool'));
    assert.ok(roots.includes('examples'));
    assert.ok(roots.includes('dist'));

    const composeRoots = productRootsFromCompose({
      services: { a: { build: './vote' }, b: { build: { context: './worker' } } },
    });
    assert.deepStrictEqual(composeRoots.sort(), ['vote', 'worker']);
  });

  test('a malformed manifest yields no roots instead of throwing', () => {
    assert.deepStrictEqual(productRootsFromPackageJson('{not json'), []);
    assert.deepStrictEqual(productRootsFromCompose(null), []);
  });
});

describe('queue-pipeline fixture: what gets left out', () => {
  test('test directories, test compose files and unreferenced examples are excluded and reported', async () => {
    const bundle = await scanFixture('queue-pipeline');

    const testsDir = exclusionFor(bundle, 'reader/tests');
    assert.ok(testsDir, 'reader/tests must be reported as excluded');
    assert.strictEqual(testsDir.reason, 'test-directory');
    assert.strictEqual(testsDir.ambiguous, false);

    const testCompose = exclusionFor(bundle, 'reader/docker-compose.test.yml');
    assert.ok(testCompose, 'the CI-only compose file must be reported as excluded');
    assert.strictEqual(testCompose.reason, 'test-file');

    const examples = exclusionFor(bundle, 'examples');
    assert.ok(examples, 'examples/ must be reported as excluded');
    assert.strictEqual(examples.reason, 'example-directory');
    assert.strictEqual(examples.ambiguous, true, 'examples/ is a judgement call and must be flagged as one');
  });

  test('nothing from an excluded path reaches the evidence', async () => {
    const bundle = await scanFixture('queue-pipeline');
    const values = bundle.evidence.map(e => e.value);
    // Tripwires planted in reader/tests/render.js and examples/demo.js.
    assert.strictEqual(values.includes('stripe'), false);
    assert.strictEqual(values.includes('twilio'), false);
    assert.strictEqual(
      bundle.evidence.some(e => e.path.startsWith('reader/tests/') || e.path.startsWith('examples/')),
      false,
    );
  });

  test('the false facts in the CI-only compose file never appear', async () => {
    const bundle = await scanFixture('queue-pipeline');
    const dependsOn = bundle.evidence.filter(e => e.kind === 'depends-on');
    // Both of these hold ONLY in reader/docker-compose.test.yml.
    assert.strictEqual(dependsOn.some(d => d.from === 'producer' && d.to === 'db'), false);
    assert.strictEqual(dependsOn.some(d => d.from === 'reader' && d.to === 'redis'), false);
    assert.strictEqual(bundle.evidence.some(e => e.value === 'sut'), false);
  });
});

describe('examples-product fixture: not over-excluding', () => {
  test("an examples/ directory the manifest names as the product is kept", async () => {
    const bundle = await scanFixture('examples-product');
    assert.strictEqual(
      bundle.exclusions.some(e => e.path === 'examples'),
      false,
      'examples/ is this repo\'s product and must not be excluded',
    );
    const imports = bundle.evidence.filter(e => e.kind === 'sdk-import');
    assert.ok(
      imports.some(e => e.value === 'stripe' && e.path === 'examples/app/index.js'),
      'the product source under examples/ must still be scanned',
    );
  });
});

describe('component evidence', () => {
  test('package.json bin and main become components', () => {
    const content = JSON.stringify({ name: 'toolkit', main: 'src/index.js', bin: { toolkit: 'bin/toolkit' } }, null, 2);
    const records = parsePackageComponents('package.json', content);
    const cli = records.find(r => r.role === 'cli');
    assert.strictEqual(cli.value, 'toolkit');
    assert.strictEqual(cli.to, 'bin/toolkit');
    const library = records.find(r => r.role === 'library');
    assert.strictEqual(library.value, 'src/index.js');
  });

  test('a plugin manifest and a skill directory become components', () => {
    const plugin = parsePluginManifest('.claude-plugin/plugin.json', JSON.stringify({ name: 'sequentdraw' }, null, 2));
    assert.strictEqual(plugin[0].value, 'sequentdraw');
    assert.strictEqual(plugin[0].role, 'plugin');

    const skill = parseComponentPath('skills/git-map/SKILL.md');
    assert.strictEqual(skill[0].value, 'git-map');
    assert.strictEqual(skill[0].role, 'skill');

    assert.deepStrictEqual(parseComponentPath('src/scan/scan.js'), []);
  });

  test('malformed manifests produce no components instead of throwing', () => {
    assert.deepStrictEqual(parsePackageComponents('package.json', '{oops'), []);
    assert.deepStrictEqual(parsePluginManifest('.claude-plugin/plugin.json', '{oops'), []);
  });
});

// The literal #27 acceptance check, run against this very
// repository: scanning SequentDraw must describe SequentDraw.
describe('scanning the SequentDraw checkout itself', () => {
  test('reports its own components and none of its fixture repos', async () => {
    const bundle = await scanPath(ROOT, { name: 'sequentdraw', source: 'local', ref: null });

    const fixtureEvidence = bundle.evidence.filter(
      e => e.path.startsWith('tests/') || e.path.startsWith('evals/'),
    );
    assert.deepStrictEqual(fixtureEvidence, [], 'no evidence may come from tests/ or evals/');

    const components = bundle.evidence.filter(e => e.kind === 'component');
    assert.ok(
      components.some(c => c.role === 'cli' && c.value === 'sequentdraw'),
      'the CLI must appear as a component',
    );
    assert.ok(
      components.some(c => c.role === 'skill' && c.value === 'git-map'),
      'the git-map skill must appear as a component',
    );
    assert.ok(
      components.some(c => c.role === 'library'),
      'the render core entry point must appear as a component',
    );
    assert.ok(
      bundle.exclusions.some(e => e.path === 'tests' && e.reason === 'test-directory'),
      'the skipped fixture tree must be reported, not silently dropped',
    );
  });
});
