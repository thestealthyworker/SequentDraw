// .github/workflows/*.yml parser: extracts job names as `ci-job` evidence
// (the design doc's "build" layer material). We only need job identity,
// not the full job graph, so this stays intentionally small.

const { parseYamlSafe } = require('../yaml-safe');

function findLine(lines, re) {
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseWorkflow(path, content) {
  const doc = parseYamlSafe(content);
  const records = [];
  if (!doc || typeof doc !== 'object' || typeof doc.jobs !== 'object' || doc.jobs == null) {
    return records;
  }

  const lines = content.split(/\r\n|\r|\n/);
  for (const jobId of Object.keys(doc.jobs)) {
    const job = doc.jobs[jobId];
    const name = job && typeof job === 'object' && typeof job.name === 'string' ? job.name : jobId;
    const line = findLine(lines, new RegExp(`^\\s{0,4}${escapeRegExp(jobId)}\\s*:\\s*$`));
    records.push({ kind: 'ci-job', path, line, value: name });
  }
  return records;
}

module.exports = { parseWorkflow };
