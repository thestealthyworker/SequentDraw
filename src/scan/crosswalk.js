// Icon crosswalk: technology / package key -> { tech, kind, icon }.
//
// "kind" here is the *default* evidence kind a bare mention of this key
// should produce when no more specific parser already classified it (e.g.
// a docker-compose image is already 'compose-service'; a raw SDK import
// found in source is 'sdk-import'). It exists so callers do not have to
// hardcode a kind when they only have a package/tech name in hand.
//
// "icon" is a simple-icons slug, or null when Simple Icons has no usable
// mark for the brand (e.g. AWS: removed from Simple Icons for trademark
// reasons). Never guess a brand -- an unlisted key resolves to no icon,
// never a nearby-looking one.
//
// Keys are matched case-insensitively against: npm/pip/etc package names,
// docker image names (repo part only, tag stripped), and dependency names
// read by the manifest parsers in src/scan/rules/.

const CROSSWALK = new Map(
  Object.entries({
    // --- data stores ---
    postgres: { tech: 'postgresql', kind: 'service', icon: 'postgresql' },
    postgresql: { tech: 'postgresql', kind: 'service', icon: 'postgresql' },
    pg: { tech: 'postgresql', kind: 'service', icon: 'postgresql' },
    mysql: { tech: 'mysql', kind: 'service', icon: 'mysql' },
    mariadb: { tech: 'mysql', kind: 'service', icon: 'mysql' },
    mongodb: { tech: 'mongodb', kind: 'service', icon: 'mongodb' },
    mongo: { tech: 'mongodb', kind: 'service', icon: 'mongodb' },
    redis: { tech: 'redis', kind: 'service', icon: 'redis' },
    rabbitmq: { tech: 'rabbitmq', kind: 'service', icon: 'rabbitmq' },
    kafka: { tech: 'kafka', kind: 'service', icon: 'apachekafka' },
    'apache-kafka': { tech: 'kafka', kind: 'service', icon: 'apachekafka' },
    elasticsearch: { tech: 'elasticsearch', kind: 'service', icon: 'elasticsearch' },

    // --- data-store CLIENT libraries ---
    // These are what a component imports or declares in order to talk to
    // a store. scan.js uses exactly these entries to decide which store a
    // SQL or Redis operation found in that component's source belongs to
    // (see resolveDataAccess) -- without a declared client, an operation
    // is never attributed to a store, so a stray match can never invent
    // one.
    psycopg2: { tech: 'postgresql', kind: 'sdk-import', icon: 'postgresql' },
    'psycopg2-binary': { tech: 'postgresql', kind: 'sdk-import', icon: 'postgresql' },
    psycopg: { tech: 'postgresql', kind: 'sdk-import', icon: 'postgresql' },
    npgsql: { tech: 'postgresql', kind: 'sdk-import', icon: 'postgresql' },
    'node-postgres': { tech: 'postgresql', kind: 'sdk-import', icon: 'postgresql' },
    asyncpg: { tech: 'postgresql', kind: 'sdk-import', icon: 'postgresql' },
    mysql2: { tech: 'mysql', kind: 'sdk-import', icon: 'mysql' },
    pymysql: { tech: 'mysql', kind: 'sdk-import', icon: 'mysql' },
    ioredis: { tech: 'redis', kind: 'sdk-import', icon: 'redis' },
    'stackexchange.redis': { tech: 'redis', kind: 'sdk-import', icon: 'redis' },
    pymongo: { tech: 'mongodb', kind: 'sdk-import', icon: 'mongodb' },
    mongoose: { tech: 'mongodb', kind: 'sdk-import', icon: 'mongodb' },

    // --- runtimes ---
    dotnet: { tech: 'dotnet', kind: 'runtime', icon: 'dotnet' },

    // --- infra / proxy ---
    nginx: { tech: 'nginx', kind: 'service', icon: 'nginx' },
    docker: { tech: 'docker', kind: 'service', icon: 'docker' },

    // --- vendors / SaaS ---
    stripe: { tech: 'stripe', kind: 'sdk-import', icon: 'stripe' },
    supabase: { tech: 'supabase', kind: 'sdk-import', icon: 'supabase' },
    '@supabase/supabase-js': { tech: 'supabase', kind: 'sdk-import', icon: 'supabase' },
    firebase: { tech: 'firebase', kind: 'sdk-import', icon: 'firebase' },
    'firebase-admin': { tech: 'firebase', kind: 'sdk-import', icon: 'firebase' },
    openai: { tech: 'openai', kind: 'sdk-import', icon: 'openai' },
    anthropic: { tech: 'anthropic', kind: 'sdk-import', icon: 'anthropic' },
    '@anthropic-ai/sdk': { tech: 'anthropic', kind: 'sdk-import', icon: 'anthropic' },
    twilio: { tech: 'twilio', kind: 'sdk-import', icon: 'twilio' },
    sendgrid: { tech: 'sendgrid', kind: 'sdk-import', icon: 'sendgrid' },
    '@sendgrid/mail': { tech: 'sendgrid', kind: 'sdk-import', icon: 'sendgrid' },
    resend: { tech: 'resend', kind: 'sdk-import', icon: 'resend' },

    // --- cloud ---
    'aws-sdk': { tech: 'aws-sdk', kind: 'sdk-import', icon: null },
    '@aws-sdk/client-s3': { tech: 'aws-sdk', kind: 'sdk-import', icon: null },
    s3: { tech: 'aws-sdk', kind: 'sdk-import', icon: null },
    boto3: { tech: 'aws-sdk', kind: 'sdk-import', icon: null },
    'google-cloud': { tech: 'google-cloud', kind: 'sdk-import', icon: 'googlecloud' },
    '@google-cloud/storage': { tech: 'google-cloud', kind: 'sdk-import', icon: 'googlecloud' },
    vercel: { tech: 'vercel', kind: 'service', icon: 'vercel' },
    netlify: { tech: 'netlify', kind: 'service', icon: 'netlify' },

    // --- CI ---
    'github-actions': { tech: 'github-actions', kind: 'ci-job', icon: 'githubactions' },

    // --- frameworks / libraries ---
    'next.js': { tech: 'next.js', kind: 'manifest-dependency', icon: 'nextdotjs' },
    next: { tech: 'next.js', kind: 'manifest-dependency', icon: 'nextdotjs' },
    react: { tech: 'react', kind: 'manifest-dependency', icon: 'react' },
    fastapi: { tech: 'fastapi', kind: 'manifest-dependency', icon: 'fastapi' },
    django: { tech: 'django', kind: 'manifest-dependency', icon: 'django' },
    flask: { tech: 'flask', kind: 'manifest-dependency', icon: 'flask' },
    express: { tech: 'express', kind: 'manifest-dependency', icon: 'express' },
    celery: { tech: 'celery', kind: 'manifest-dependency', icon: 'celery' },
    prisma: { tech: 'prisma', kind: 'manifest-dependency', icon: 'prisma' },
    sentry: { tech: 'sentry', kind: 'manifest-dependency', icon: 'sentry' },
    '@sentry/node': { tech: 'sentry', kind: 'manifest-dependency', icon: 'sentry' },
  }),
);

// Normalises a raw name (package name, docker image, tech key) for
// lookup: lowercase, and a docker image's tag/digest stripped.
function normalise(name) {
  if (typeof name !== 'string') return '';
  let n = name.trim().toLowerCase();
  // strip a docker registry/tag/digest suffix: "postgres:16" -> "postgres",
  // "library/redis@sha256:..." -> "redis"
  n = n.split('@')[0];
  n = n.split(':')[0];
  const parts = n.split('/');
  n = parts[parts.length - 1];
  return n;
}

// Looks up a crosswalk entry by raw name. Returns null for anything not
// in the table -- callers must treat that as "no icon, no known tech",
// never guess a nearby brand.
function lookup(name) {
  const key = normalise(name);
  if (!key) return null;
  return CROSSWALK.has(key) ? CROSSWALK.get(key) : null;
}

module.exports = { CROSSWALK, lookup, normalise };
