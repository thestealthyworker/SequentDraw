// Component parser: the pieces a repository declares ITSELF to be made
// of -- its executables, its library entry point, the plugin it ships,
// the skills it ships.
//
// Why this exists (CTO-M1-01, second half): once the fixture repos were
// excluded, a scan of SequentDraw's own checkout described SequentDraw
// only as six package.json dependencies and three CI jobs. Nothing named
// the render core, the CLI, the plugin or the skills -- the things the
// product actually consists of. A dependency list is what a repo USES; a
// map needs what it IS.
//
// Every record here comes from an explicit declaration in a manifest the
// repository wrote about itself (package.json `bin`/`main`, the plugin
// manifest) or from a published, documented layout convention
// (`skills/<name>/SKILL.md`, exactly as route-parser.js treats Next.js
// route files). Nothing is inferred from directory names alone, so this
// never invents a component.

'use strict';

const PLUGIN_MANIFEST_RE = /(^|\/)\.claude-plugin\/plugin\.json$/;
const SKILL_FILE_RE = /(^|\/)skills\/([A-Za-z0-9_.-]{1,64})\/SKILL\.md$/;

const MAX_COMPONENTS_PER_MANIFEST = 100;
const MAX_NAME_LENGTH = 120;

function findLineForKey(lines, key) {
  const re = new RegExp(`"${escapeRegExp(key)}"\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function usableName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME_LENGTH;
}

// package.json: each `bin` entry is an executable this package installs,
// and `main` is the library surface it exposes. Both are the package
// stating its own shape.
function parsePackageComponents(path, content) {
  const records = [];
  let doc;
  try {
    doc = JSON.parse(content);
  } catch {
    return records;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return records;

  const lines = content.split(/\r\n|\r|\n/);
  const packageName = usableName(doc.name) ? doc.name : null;

  if (typeof doc.bin === 'string') {
    if (packageName) {
      records.push({
        kind: 'component',
        path,
        line: findLineForKey(lines, 'bin'),
        value: packageName,
        role: 'cli',
        to: doc.bin,
      });
    }
  } else if (doc.bin && typeof doc.bin === 'object' && !Array.isArray(doc.bin)) {
    for (const [name, target] of Object.entries(doc.bin).slice(0, MAX_COMPONENTS_PER_MANIFEST)) {
      if (!usableName(name) || typeof target !== 'string') continue;
      records.push({
        kind: 'component',
        path,
        line: findLineForKey(lines, name),
        value: name,
        role: 'cli',
        to: target,
      });
    }
  }

  if (usableName(doc.main)) {
    records.push({
      kind: 'component',
      path,
      line: findLineForKey(lines, 'main'),
      value: doc.main,
      role: 'library',
      to: doc.main,
    });
  }

  return records;
}

// .claude-plugin/plugin.json: the plugin this repository publishes.
function parsePluginManifest(path, content) {
  const records = [];
  let doc;
  try {
    doc = JSON.parse(content);
  } catch {
    return records;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return records;
  if (!usableName(doc.name)) return records;

  const lines = content.split(/\r\n|\r|\n/);
  records.push({
    kind: 'component',
    path,
    line: findLineForKey(lines, 'name'),
    value: doc.name,
    role: 'plugin',
    to: null,
  });
  return records;
}

// skills/<name>/SKILL.md -- a shipped skill, recognised by layout, with
// no need to read the file (and therefore no exposure to its prose).
function parseComponentPath(relPath) {
  const normalised = typeof relPath === 'string' ? relPath.split('\\').join('/') : '';
  const match = SKILL_FILE_RE.exec(normalised);
  if (!match) return [];
  return [
    {
      kind: 'component',
      path: normalised,
      line: null,
      value: match[2],
      role: 'skill',
      to: null,
    },
  ];
}

module.exports = {
  parsePackageComponents,
  parsePluginManifest,
  parseComponentPath,
  PLUGIN_MANIFEST_RE,
  SKILL_FILE_RE,
};
