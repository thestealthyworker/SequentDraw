// Env-name evidence from a sanitised example file (.env.example/.sample/
// .template). The safe provider has already stripped every value before
// this ever sees the content -- this module only ever receives
// "NAME=" lines, never "NAME=secret". It extracts the names and, where a
// name suggests a known vendor (e.g. STRIPE_SECRET_KEY), tags the tech
// via the crosswalk so the evidence carries an icon.

const { lookup } = require('../crosswalk');

const ENV_LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

// A conservative set of substrings to test an env var name against, so
// "STRIPE_SECRET_KEY" resolves to stripe, "NEXT_PUBLIC_SUPABASE_URL"
// resolves to supabase, without false-positiving on unrelated names.
function techFromName(name) {
  const lower = name.toLowerCase();
  const candidates = [
    'stripe',
    'supabase',
    'firebase',
    'openai',
    'anthropic',
    'twilio',
    'sendgrid',
    'resend',
    'postgres',
    'postgresql',
    'mysql',
    'mongodb',
    'redis',
    'rabbitmq',
    'kafka',
    'elasticsearch',
    'sentry',
    'vercel',
    'netlify',
    'aws',
  ];
  for (const c of candidates) {
    if (lower.includes(c)) {
      const cross = lookup(c === 'aws' ? 'aws-sdk' : c);
      if (cross) return cross;
    }
  }
  return null;
}

function parseEnvNames(path, content) {
  const records = [];
  const lines = content.split(/\r\n|\r|\n/);
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const m = ENV_LINE_RE.exec(line);
    if (!m) return;
    const name = m[1];
    const cross = techFromName(name);
    records.push({
      kind: 'env-name',
      path,
      line: idx + 1,
      value: name,
      tech: cross ? cross.tech : null,
      icon: cross ? cross.icon : null,
    });
  });
  return records;
}

module.exports = { parseEnvNames, techFromName };
