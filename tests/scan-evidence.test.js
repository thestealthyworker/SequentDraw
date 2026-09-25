// evidence.js: deterministic id assignment, stable sort order, string
// truncation, and the stack-analyser-vs-own-parser dedupe rule.

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { assembleEvidence, mapDependencyTuples, normalisePath, MAX_STRING_LENGTH } = require('../src/scan/evidence');

describe('assembleEvidence: ids and ordering', () => {
  test('assigns sequential ev<N> ids in a stable order by (path, line, kind, value)', () => {
    const raw = [
      { kind: 'image', path: 'docker-compose.yml', line: 10, value: 'redis' },
      { kind: 'compose-service', path: 'docker-compose.yml', line: 2, value: 'web' },
      { kind: 'manifest-dependency', path: 'package.json', line: 1, value: 'express' },
      { kind: 'compose-service', path: 'docker-compose.yml', line: 5, value: 'api' },
    ];
    const evidence = assembleEvidence(raw);
    assert.deepStrictEqual(
      evidence.map(e => e.id),
      ['ev1', 'ev2', 'ev3', 'ev4'],
    );
    // docker-compose.yml sorts before package.json; within it, line 2
    // before line 5 before line 10.
    assert.deepStrictEqual(
      evidence.map(e => `${e.path}:${e.line ?? ''}`),
      ['docker-compose.yml:2', 'docker-compose.yml:5', 'docker-compose.yml:10', 'package.json:1'],
    );
  });

  test('same input produces byte-identical output across two calls', () => {
    const raw = [
      { kind: 'sdk-import', path: 'src/a.js', line: 3, value: 'stripe', tech: 'stripe', icon: 'stripe' },
      { kind: 'env-name', path: '.env.example', line: 1, value: 'STRIPE_KEY' },
    ];
    assert.deepStrictEqual(assembleEvidence(raw), assembleEvidence([...raw]));
  });

  test('omits undefined/null fields rather than including them as null', () => {
    const evidence = assembleEvidence([{ kind: 'compose-service', path: 'x.yml', line: 1, value: 'web' }]);
    assert.deepStrictEqual(evidence[0], { id: 'ev1', kind: 'compose-service', path: 'x.yml', line: 1, value: 'web' });
  });

  test('truncates every string field to 200 characters', () => {
    const long = 'x'.repeat(500);
    const evidence = assembleEvidence([{ kind: 'env-name', path: 'x.env', line: 1, value: long }]);
    assert.strictEqual(evidence[0].value.length, MAX_STRING_LENGTH);
  });

  test('strips zero-width/bidi control characters from evidence strings', () => {
    const evidence = assembleEvidence([{ kind: 'compose-service', path: 'x.yml', line: 1, value: 'web​' }]);
    assert.strictEqual(evidence[0].value, 'web');
  });
});

describe('normalisePath', () => {
  test('strips a leading slash and normalises backslashes', () => {
    assert.strictEqual(normalisePath('/docker-compose.yml'), 'docker-compose.yml');
    assert.strictEqual(normalisePath('app\\api\\route.ts'), 'app/api/route.ts');
    assert.strictEqual(normalisePath('./package.json'), 'package.json');
  });
});

// mapDependencyTuples replaced mapStackAnalyserDependencies in step 8a. It
// takes flat tuples from the vendored parsers rather than walking
// stack-analyser's payload tree, so the "recurses into childs" case has no
// equivalent; the kind mapping, the crosswalk lookup and the path carried
// on every record do.
describe('mapDependencyTuples', () => {
  test('maps terraform.resource to iac-resource, docker to image, githubAction to ci-job', () => {
    const records = mapDependencyTuples([
      { path: 'main.tf', type: 'terraform.resource', name: 'aws_s3_bucket', version: 'unknown' },
      { path: '.github/workflows/ci.yml', type: 'docker', name: 'postgres', version: '16' },
      { path: '.github/workflows/ci.yml', type: 'githubAction', name: 'actions/checkout', version: 'v4' },
    ]);
    assert.deepStrictEqual(records.map(r => r.kind), ['iac-resource', 'image', 'ci-job']);
  });

  test('every other ecosystem is a manifest-dependency', () => {
    for (const type of ['golang', 'rust', 'ruby', 'php', 'deno', 'terraform']) {
      const [record] = mapDependencyTuples([{ path: 'x', type, name: 'n', version: '1' }]);
      assert.strictEqual(record.kind, 'manifest-dependency', type);
    }
  });

  test('every record keeps the path of the manifest it came from', () => {
    const [record] = mapDependencyTuples([
      { path: 'services/api/go.mod', type: 'golang', name: 'github.com/gin-gonic/gin', version: 'v1.9.0' },
    ]);
    assert.strictEqual(record.path, 'services/api/go.mod');
    assert.strictEqual(record.line, null);
  });

  test('a known package picks up its technology and icon from the crosswalk', () => {
    const [record] = mapDependencyTuples([{ path: 'Gemfile', type: 'ruby', name: 'pg', version: '1.5' }]);
    assert.strictEqual(record.tech, 'postgresql');
    assert.strictEqual(record.icon, 'postgresql');
  });
});

describe('dedupe: a bespoke parser wins over a dependency manifest for the same (path, kind, value)', () => {
  test('a manifest record is dropped when a bespoke parser already produced the same fact', () => {
    const ownRecord = { kind: 'image', path: 'docker-compose.yml', line: 8, value: 'postgres', version: '16' };
    const manifestRecord = { kind: 'image', path: 'docker-compose.yml', line: null, value: 'postgres', version: '16', __source: 'dependency-manifests' };
    const evidence = assembleEvidence([ownRecord, manifestRecord]);
    assert.strictEqual(evidence.length, 1);
    assert.strictEqual(evidence[0].line, 8); // ours (with a line number) wins
  });

  test('a manifest record for a different path/value is kept', () => {
    const ownRecord = { kind: 'manifest-dependency', path: 'package.json', line: 1, value: 'express' };
    const manifestRecord = { kind: 'manifest-dependency', path: 'go.mod', line: null, value: 'gin', __source: 'dependency-manifests' };
    const evidence = assembleEvidence([ownRecord, manifestRecord]);
    assert.strictEqual(evidence.length, 2);
  });
});
