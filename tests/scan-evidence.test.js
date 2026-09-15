// evidence.js: deterministic id assignment, stable sort order, string
// truncation, and the stack-analyser-vs-own-parser dedupe rule.

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { assembleEvidence, mapStackAnalyserDependencies, normalisePath, MAX_STRING_LENGTH } = require('../src/scan/evidence');

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

describe('mapStackAnalyserDependencies', () => {
  function tree(overrides) {
    return Object.assign({ path: ['/'], dependencies: [], childs: [] }, overrides);
  }

  test('maps terraform.resource to iac-resource and docker to image', () => {
    const node = tree({
      path: ['/main.tf'],
      dependencies: [
        ['terraform.resource', 'aws_s3_bucket.data', null],
        ['docker', 'postgres', '16'],
      ],
    });
    const records = mapStackAnalyserDependencies(node);
    assert.ok(records.some(r => r.kind === 'iac-resource' && r.value === 'aws_s3_bucket.data'));
    assert.ok(records.some(r => r.kind === 'image' && r.value === 'postgres' && r.version === '16'));
  });

  test('skips npm and python dependency types entirely (covered by manifest-parser.js instead)', () => {
    const node = tree({
      dependencies: [
        ['npm', 'express', '^4.0.0'],
        ['python', 'fastapi', null],
      ],
    });
    assert.deepStrictEqual(mapStackAnalyserDependencies(node), []);
  });

  test('recurses into childs', () => {
    const node = tree({
      childs: [tree({ path: ['/sub/go.mod'], dependencies: [['golang', 'github.com/gin-gonic/gin', 'v1.9.0']] })],
    });
    const records = mapStackAnalyserDependencies(node);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].kind, 'manifest-dependency');
    assert.strictEqual(records[0].value, 'github.com/gin-gonic/gin');
  });
});

describe('dedupe: own parsers win over stack-analyser for the same (path, kind, value)', () => {
  test('a stack-analyser image record is dropped when compose-parser already produced the same fact', () => {
    const ownRecord = { kind: 'image', path: 'docker-compose.yml', line: 8, value: 'postgres', version: '16' };
    const stackAnalyserRecord = { kind: 'image', path: 'docker-compose.yml', line: null, value: 'postgres', version: '16', __source: 'stack-analyser' };
    const evidence = assembleEvidence([ownRecord, stackAnalyserRecord]);
    assert.strictEqual(evidence.length, 1);
    assert.strictEqual(evidence[0].line, 8); // ours (with a line number) wins
  });

  test('a stack-analyser record for a different path/value is kept', () => {
    const ownRecord = { kind: 'manifest-dependency', path: 'package.json', line: 1, value: 'express' };
    const stackAnalyserRecord = { kind: 'manifest-dependency', path: 'go.mod', line: null, value: 'gin', __source: 'stack-analyser' };
    const evidence = assembleEvidence([ownRecord, stackAnalyserRecord]);
    assert.strictEqual(evidence.length, 2);
  });
});
