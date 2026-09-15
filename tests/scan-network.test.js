// The one integration test that actually touches the network: clones
// dockersamples/example-voting-app (Apache-2.0) at a pinned commit and
// scans it for real, end to end (acquire -> scan -> cleanup). Skipped
// unless SEQUENTDRAW_NETWORK_TESTS=1, so `npm test` stays fully offline
// by default.
//
// Pinned SHA looked up with:
//   gh api repos/dockersamples/example-voting-app/commits/main -q .sha

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { scanRepo } = require('../src/scan/index');

const PINNED_SHA = '63e9150ca17af4ed05880d4245e486481f73fcb4';
const RUN_NETWORK_TESTS = process.env.SEQUENTDRAW_NETWORK_TESTS === '1';

test(
  'scanRepo clones and scans dockersamples/example-voting-app at a pinned commit',
  { skip: !RUN_NETWORK_TESTS && 'set SEQUENTDRAW_NETWORK_TESTS=1 to run this network-touching test' },
  async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sequentdraw-network-test-'));
    const beforeEntries = fs.readdirSync(tmpRoot);
    assert.deepStrictEqual(beforeEntries, []);

    const bundle = await scanRepo(`https://github.com/dockersamples/example-voting-app/tree/${PINNED_SHA}`, {
      cloneTimeoutMs: 60000,
      tmpRoot,
    });

    assert.strictEqual(bundle.repo.source, 'github');
    assert.strictEqual(bundle.repo.ref, PINNED_SHA);

    // The design doc's expectation for this repo: vote, result, worker,
    // redis, postgres services with depends_on edges between them.
    const services = bundle.evidence.filter(e => e.kind === 'compose-service').map(e => e.value);
    for (const expected of ['redis', 'db']) {
      assert.ok(services.includes(expected) || services.some(s => s.toLowerCase().includes(expected)), `expected a service near "${expected}"`);
    }
    assert.ok(bundle.evidence.some(e => e.kind === 'depends-on'));

    // The temp clone directory (created under our own tmpRoot) must be
    // gone once scanRepo returns, success or not.
    assert.deepStrictEqual(fs.readdirSync(tmpRoot), []);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  },
);
