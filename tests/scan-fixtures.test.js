// End-to-end scanPath() against the three synthetic, MIT-licensed fixture
// repos under tests/fixtures/repos/. Each assertion pins the evidence
// this specific fixture must produce, per kind.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { scanPath } = require('../src/scan/scan');

const REPOS_DIR = path.join(__dirname, 'fixtures', 'repos');

function byKindCounts(evidence) {
  const counts = {};
  for (const e of evidence) counts[e.kind] = (counts[e.kind] || 0) + 1;
  return counts;
}

function valuesOfKind(evidence, kind) {
  return evidence.filter(e => e.kind === kind).map(e => e.value);
}

describe('compose-app fixture', () => {
  test('finds 5 compose services, their depends_on edges, and postgres/redis images', async () => {
    const bundle = await scanPath(path.join(REPOS_DIR, 'compose-app'), { name: 'compose-app', source: 'local', ref: null });
    assert.strictEqual(bundle.limits.truncated, false);

    const services = valuesOfKind(bundle.evidence, 'compose-service').sort();
    assert.deepStrictEqual(services, ['api', 'postgres', 'redis', 'web', 'worker'].sort());

    const dependsOn = bundle.evidence.filter(e => e.kind === 'depends-on');
    assert.ok(dependsOn.some(d => d.from === 'web' && d.to === 'api'));
    assert.ok(dependsOn.some(d => d.from === 'web' && d.to === 'postgres'));
    assert.ok(dependsOn.some(d => d.from === 'api' && d.to === 'postgres'));
    assert.ok(dependsOn.some(d => d.from === 'api' && d.to === 'redis'));
    assert.ok(dependsOn.some(d => d.from === 'worker' && d.to === 'redis'));

    const images = bundle.evidence.filter(e => e.kind === 'image');
    assert.ok(images.some(i => i.value === 'postgres' && i.tech === 'postgresql'));
    assert.ok(images.some(i => i.value === 'redis' && i.tech === 'redis'));

    assert.deepStrictEqual(bundle.repo, { name: 'compose-app', source: 'local', ref: null });
  });
});

describe('next-supabase-stripe fixture', () => {
  test('finds the Supabase/Stripe env names, the sdk-import, the webhook route, and manifest deps', async () => {
    const bundle = await scanPath(path.join(REPOS_DIR, 'next-supabase-stripe'), { name: 'next-supabase-stripe', source: 'local', ref: null });

    const envNames = bundle.evidence.filter(e => e.kind === 'env-name');
    assert.ok(envNames.find(e => e.value === 'NEXT_PUBLIC_SUPABASE_URL' && e.tech === 'supabase'));
    assert.ok(envNames.find(e => e.value === 'STRIPE_SECRET_KEY' && e.tech === 'stripe'));

    const imports = bundle.evidence.filter(e => e.kind === 'sdk-import');
    assert.ok(imports.some(e => e.value === 'stripe' && e.path === 'app/api/webhooks/stripe/route.ts'));

    const routes = bundle.evidence.filter(e => e.kind === 'route');
    assert.deepStrictEqual(routes.map(r => r.value), ['/api/webhooks/stripe']);

    const manifestDeps = valuesOfKind(bundle.evidence, 'manifest-dependency');
    assert.ok(manifestDeps.includes('next'));
    assert.ok(manifestDeps.includes('@supabase/supabase-js'));
    assert.ok(manifestDeps.includes('stripe'));

    // The example key value never appears anywhere in the bundle.
    const dump = JSON.stringify(bundle);
    assert.strictEqual(dump.includes('sk_test_FAKEVALUE123'), false);
    assert.strictEqual(dump.includes('https://x'), false);
  });
});

describe('fastapi-celery fixture', () => {
  test('finds postgres/redis services, celery + fastapi sdk-imports, and requirements.txt deps', async () => {
    const bundle = await scanPath(path.join(REPOS_DIR, 'fastapi-celery'), { name: 'fastapi-celery', source: 'local', ref: null });

    const services = valuesOfKind(bundle.evidence, 'compose-service').sort();
    assert.deepStrictEqual(services, ['api', 'postgres', 'redis', 'worker'].sort());

    const manifestDeps = valuesOfKind(bundle.evidence, 'manifest-dependency').sort();
    assert.deepStrictEqual(manifestDeps, ['celery', 'fastapi', 'psycopg2-binary', 'redis', 'sqlalchemy', 'uvicorn'].sort());

    const imports = bundle.evidence.filter(e => e.kind === 'sdk-import');
    assert.ok(imports.some(e => e.value === 'fastapi' && e.path === 'main.py'));
    assert.ok(imports.some(e => e.value === 'celery' && e.path === 'worker.py'));

    const counts = byKindCounts(bundle.evidence);
    assert.ok(counts['manifest-dependency'] >= 6);
  });
});

describe('determinism across fixtures', () => {
  for (const name of ['compose-app', 'next-supabase-stripe', 'fastapi-celery']) {
    test(`${name}: byte-identical bundle across two scans`, async () => {
      const opts = { name, source: 'local', ref: null };
      const dir = path.join(REPOS_DIR, name);
      const a = await scanPath(dir, opts);
      const b = await scanPath(dir, opts);
      assert.deepStrictEqual(a, b);
    });
  }
});
