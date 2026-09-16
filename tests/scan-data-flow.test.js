// CTO-M1-02 and CTO-M1-05: arrows must follow work, not startup order,
// and the scan must not miss a service or count a compose file three
// times.
//
// On the real example-voting-app, edges used to follow `depends_on`,
// which means "starts after". That made `worker -> redis` and
// `result -> db` point backwards, turned both stores into sinks, and left
// the actual chain vote -> redis -> worker -> postgres -> result
// untraceable. The queue-pipeline fixture has the same shape: a producer
// that only pushes, a processor that pops from the queue and writes to the
// database, and a reader that only selects.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { scanPath } = require('../src/scan/scan');
const { checkEvidence } = require('../src/scan/check-evidence');
const { parseCsproj } = require('../src/scan/parsers/csproj-parser');
const { parseDataAccess } = require('../src/scan/parsers/data-access-parser');

const REPOS_DIR = path.join(__dirname, 'fixtures', 'repos');

function scanFixture(name) {
  return scanPath(path.join(REPOS_DIR, name), { name, source: 'local', ref: null });
}

function dataAccess(bundle, from, to) {
  return bundle.evidence.find(e => e.kind === 'data-access' && e.from === from && e.to === to);
}

describe('data-access direction (CTO-M1-02)', () => {
  test('a component that only pushes is upstream of the queue', async () => {
    const bundle = await scanFixture('queue-pipeline');
    const fact = dataAccess(bundle, 'producer', 'redis');
    assert.ok(fact, 'producer -> redis must be established');
    assert.strictEqual(fact.direction, 'write');
    assert.strictEqual(fact.path, 'producer/app.py');
  });

  test('a component that pops from the queue is DOWNSTREAM of it', async () => {
    const bundle = await scanFixture('queue-pipeline');
    const fact = dataAccess(bundle, 'processor', 'redis');
    assert.ok(fact, 'processor/redis must be established');
    // This is the whole point: depends_on says processor -> redis, but the
    // work flows redis -> processor.
    assert.strictEqual(fact.direction, 'read');
  });

  test('a component that inserts is upstream of the database', async () => {
    const bundle = await scanFixture('queue-pipeline');
    const fact = dataAccess(bundle, 'processor', 'postgresql');
    assert.ok(fact);
    assert.strictEqual(fact.direction, 'write');
  });

  test('a component that only selects is DOWNSTREAM of the database', async () => {
    const bundle = await scanFixture('queue-pipeline');
    const fact = dataAccess(bundle, 'reader', 'postgresql');
    assert.ok(fact);
    assert.strictEqual(fact.direction, 'read');
  });

  test('the four facts spell out the pipeline end to end', async () => {
    const bundle = await scanFixture('queue-pipeline');
    const chain = bundle.evidence
      .filter(e => e.kind === 'data-access')
      .map(e => (e.direction === 'write' ? `${e.from}->${e.to}` : `${e.to}->${e.from}`))
      .sort();
    assert.deepStrictEqual(chain, [
      'postgresql->reader',
      'processor->postgresql',
      'producer->redis',
      'redis->processor',
    ]);
  });

  test('a keep-alive SELECT with no FROM is not a read of the data', async () => {
    const bundle = await scanFixture('queue-pipeline');
    // processor/Program.cs runs "SELECT 1"; it writes to postgres and must
    // not also be reported as reading from it.
    const fact = dataAccess(bundle, 'processor', 'postgresql');
    assert.strictEqual(fact.direction, 'write');
  });

  test('SQL text in a component with no declared client establishes nothing', async () => {
    const bundle = await scanFixture('queue-pipeline');
    // tools/report.js contains a SELECT ... FROM but declares no database
    // client, so no store may be attributed to it.
    assert.strictEqual(
      bundle.evidence.some(e => e.kind === 'data-access' && e.from === 'tools'),
      false,
    );
  });
});

describe('depends_on is labelled as a deployment fact (CTO-M1-02)', () => {
  test('every depends-on entry carries role "deployment"', async () => {
    const bundle = await scanFixture('queue-pipeline');
    const dependsOn = bundle.evidence.filter(e => e.kind === 'depends-on');
    assert.ok(dependsOn.length > 0);
    for (const entry of dependsOn) {
      assert.strictEqual(entry.role, 'deployment', `${entry.from} -> ${entry.to} must be marked as a startup dependency`);
    }
  });

  test('build contexts attribute source directories to their service', async () => {
    const bundle = await scanFixture('queue-pipeline');
    const contexts = bundle.evidence.filter(e => e.kind === 'build-context');
    assert.ok(contexts.some(c => c.from === 'processor' && c.to === 'processor'));
  });
});

describe('compose variants are counted once (CTO-M1-05)', () => {
  test('services are not multiplied across compose files', async () => {
    const bundle = await scanFixture('queue-pipeline');
    const services = bundle.evidence.filter(e => e.kind === 'compose-service').map(e => e.value).sort();
    assert.deepStrictEqual(services, ['db', 'processor', 'producer', 'reader', 'redis']);
  });

  test('the duplicate variant is reported rather than silently dropped', async () => {
    const bundle = await scanFixture('queue-pipeline');
    assert.ok(
      bundle.exclusions.some(e => e.path === 'docker-compose.images.yml' && e.reason === 'duplicate-compose-variant'),
    );
  });

  test('information only the variant carries is kept', async () => {
    const bundle = await scanFixture('queue-pipeline');
    const images = bundle.evidence.filter(e => e.kind === 'image').map(e => e.value);
    assert.ok(images.includes('example/queue-pipeline-processor'), 'a pre-built image name is new information');
  });
});

describe('.NET projects are scanned (CTO-M1-05)', () => {
  test('the processor\'s data-store clients and runtime are found', async () => {
    const bundle = await scanFixture('queue-pipeline');
    const deps = bundle.evidence.filter(e => e.kind === 'manifest-dependency' && e.path === 'processor/Worker.csproj');
    const values = deps.map(d => d.value);
    assert.ok(values.includes('StackExchange.Redis'));
    assert.ok(values.includes('Npgsql'));

    const runtime = bundle.evidence.find(e => e.kind === 'runtime');
    assert.ok(runtime, 'the worker runtime must be identified, so no gap note is needed');
    assert.strictEqual(runtime.value, 'net8.0');
    assert.strictEqual(runtime.path, 'processor/Worker.csproj');
  });

  test('parseCsproj reads package references and the target framework', () => {
    const records = parseCsproj(
      'x.csproj',
      '<Project><PropertyGroup><TargetFramework>net7.0</TargetFramework></PropertyGroup>' +
        '<ItemGroup><PackageReference Include="Npgsql" Version="4.1.9" /></ItemGroup></Project>',
    );
    const dep = records.find(r => r.kind === 'manifest-dependency');
    assert.strictEqual(dep.value, 'Npgsql');
    assert.strictEqual(dep.version, '4.1.9');
    assert.strictEqual(records.find(r => r.kind === 'runtime').value, 'net7.0');
  });

  test('a malformed project file yields no records instead of throwing', () => {
    assert.deepStrictEqual(parseCsproj('x.csproj', '<Project'), []);
  });
});

describe('data-access parser (unit)', () => {
  test('classifies reads and writes, and ignores unknown file types', () => {
    const writes = parseDataAccess('a.js', "db.query('INSERT INTO votes VALUES (1)')");
    assert.strictEqual(writes[0].direction, 'write');
    assert.strictEqual(writes[0].family, 'sql');

    const reads = parseDataAccess('a.js', "db.query('SELECT id FROM votes')");
    assert.strictEqual(reads[0].direction, 'read');

    const pushes = parseDataAccess('a.py', "store.rpush('votes', data)");
    assert.strictEqual(pushes[0].direction, 'write');
    assert.strictEqual(pushes[0].family, 'redis');

    assert.deepStrictEqual(parseDataAccess('README.md', 'SELECT id FROM votes'), []);
  });

  test('a bare SELECT with no FROM is not a read', () => {
    assert.deepStrictEqual(parseDataAccess('a.cs', 'cmd.CommandText = "SELECT 1";'), []);
  });

  test('stays bounded on pathological input', () => {
    const hostile = `${'select '.repeat(20000)}x`;
    const started = Date.now();
    parseDataAccess('a.js', hostile);
    assert.ok(Date.now() - started < 5000, 'must not backtrack catastrophically');
  });
});

describe('check --evidence accepts a data-access citation', () => {
  test('an edge citing a data-access fact connecting its endpoints passes', async () => {
    const bundle = await scanFixture('queue-pipeline');
    const fact = dataAccess(bundle, 'processor', 'redis');
    const doc = {
      title: 'pipeline',
      nodes: [
        { id: 'redis', label: 'redis', kind: 'service', source: 'scan', evidence: [fact.id] },
        { id: 'processor', label: 'processor', kind: 'service', source: 'scan', evidence: [fact.id] },
      ],
      // Drawn queue -> consumer, the direction the evidence establishes.
      edges: [{ from: 'redis', to: 'processor', type: 'solid', source: 'scan', evidence: [fact.id] }],
    };
    assert.deepStrictEqual(checkEvidence(doc, bundle), []);
  });

  test('an edge citing a data-access fact about unrelated endpoints still fails', async () => {
    const bundle = await scanFixture('queue-pipeline');
    const fact = dataAccess(bundle, 'processor', 'redis');
    const doc = {
      title: 'pipeline',
      nodes: [
        { id: 'reader', label: 'reader', kind: 'service', source: 'scan', evidence: [fact.id] },
        { id: 'stripe', label: 'stripe', kind: 'service', source: 'scan', evidence: [fact.id] },
      ],
      edges: [{ from: 'reader', to: 'stripe', type: 'solid', source: 'scan', evidence: [fact.id] }],
    };
    const errors = checkEvidence(doc, bundle);
    assert.ok(errors.some(e => e.code === 'edge-evidence-mismatch'));
  });
});
