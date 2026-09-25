// .NET project-file parser (*.csproj / *.fsproj / *.vbproj).
//
// Why this exists (#27): the example-voting-app bundle had no entry
// at all for `worker/` -- a .NET project whose Worker.csproj declares
// StackExchange.Redis and Npgsql. The founder run had to add a gap note
// saying the worker's runtime was unknown, and the direction inference
// fixed in #27 had no client evidence to work from for the one service
// that sits in the middle of the pipeline.
//
// Regex over text only: never an XML parse, never an eval, never a
// dependency resolve. Every pattern is anchored and length-bounded (no
// nested or unbounded quantifiers) so hostile project files cannot drive
// catastrophic backtracking.

'use strict';

const { lookup } = require('../crosswalk');

// <PackageReference Include="Npgsql" Version="4.1.9" />, in either
// attribute order, and the child-element form
// (<PackageReference Include="X"><Version>1</Version></PackageReference>)
// for which only the Include is taken. Attribute runs are capped at 400
// characters and exclude '>' so a match can never span past the element.
const PACKAGE_REF_RE = /<PackageReference\s[^>]{0,400}?Include\s*=\s*"([^"<>]{1,200})"/gi;
const VERSION_ATTR_RE = /\sVersion\s*=\s*"([^"<>]{1,60})"/i;

// <TargetFramework>net7.0</TargetFramework> or
// <TargetFrameworks>net6.0;net7.0</TargetFrameworks>.
const TARGET_FRAMEWORK_RE = /<TargetFrameworks?>\s*([^<\n]{1,120}?)\s*<\/TargetFrameworks?>/i;

function findLineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

// The element text containing this match, bounded, so the Version
// attribute is only ever read from the same element as the Include.
function elementAt(content, matchIndex) {
  const end = content.indexOf('>', matchIndex);
  const stop = end === -1 ? Math.min(content.length, matchIndex + 500) : end;
  return content.slice(matchIndex, stop);
}

function parseCsproj(path, content) {
  const records = [];
  const seen = new Set();

  PACKAGE_REF_RE.lastIndex = 0;
  let m;
  while ((m = PACKAGE_REF_RE.exec(content))) {
    const name = m[1].trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const versionMatch = VERSION_ATTR_RE.exec(elementAt(content, m.index));
    const cross = lookup(name);
    records.push({
      kind: 'manifest-dependency',
      path,
      line: findLineOf(content, m.index),
      value: name,
      version: versionMatch ? versionMatch[1] : null,
      tech: cross ? cross.tech : null,
      icon: cross ? cross.icon : null,
    });
  }

  // The runtime is what let the founder run drop its "worker runtime
  // unknown" gap note: the project file states its own target framework.
  const tf = TARGET_FRAMEWORK_RE.exec(content);
  if (tf && tf[1]) {
    const value = tf[1].split(';')[0].trim();
    if (value) {
      const cross = lookup('dotnet');
      records.push({
        kind: 'runtime',
        path,
        line: findLineOf(content, tf.index),
        value,
        tech: cross ? cross.tech : 'dotnet',
        icon: cross ? cross.icon : null,
      });
    }
  }

  return records;
}

module.exports = { parseCsproj };
