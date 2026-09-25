// `sequentdraw skills install|uninstall|list` (docs/design/skills-and-plugin.md,
// "skills install"). Every test uses a temp HOME and/or a temp --project
// directory -- never the real home directory, per the brief for this
// command. Most tests drive the real CLI as a subprocess (the same way a
// user would), with HOME overridden in the child's environment; a few
// lower-level tests call the pure rewrite/target/marker/symlink helpers
// directly, since those need no filesystem write at all to prove correct.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'sequentdraw');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const {
  rewriteCliPipeline,
  buildEngineCommand,
  splitSection,
  RESOLVING_HEADING,
} = require('../src/skills-install/rewrite-cli-pipeline');
const { resolveTargetRoot } = require('../src/skills-install/target-paths');
const { markerStatus, MARKER_FILENAME } = require('../src/skills-install/marker');
const { symlinkBlocksPath } = require('../src/skills-install/symlink-guard');
const { listShippedSkillNames } = require('../src/skills-install/list-skills');

const SOURCE_CLI_PIPELINE = fs.readFileSync(
  path.join(ROOT, 'skills', 'git-map', 'references', 'cli-pipeline.md'),
  'utf8',
);
const SHIPPED_SKILLS = ['business-map', 'doc-map', 'eval-build', 'git-map', 'gitrepo-suggest', 'grill-build'];

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTmpDirs(names, fn) {
  const dirs = names.map(name => tmpDir(`sequentdraw-skills-${name}-`));
  try {
    return fn(...dirs);
  } finally {
    dirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
  }
}

// Runs the real CLI as a child process with HOME pointed at `home` (never
// the real one) and returns { status, stdout, stderr }. `cwd` defaults to
// ROOT; `spawnSync` never goes through a shell, so no argument here ever
// needs its own quoting. `spawnSync` (unlike `execFileSync`) hands back
// stderr on a successful exit too, rather than only ever inheriting it to
// this process's own terminal on success -- which matters here, since a
// warning this command prints on stderr can accompany exit code 0.
function runCli(args, { home, cwd } = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: cwd || ROOT,
    env: { ...process.env, HOME: home || tmpDir('sequentdraw-unused-home-') },
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function readAllFiles(dir) {
  const out = new Map();
  function walk(current, rel) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      const relPath = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(abs, relPath);
      else if (entry.isFile()) out.set(relPath, fs.readFileSync(abs, 'utf8'));
    }
  }
  walk(dir, '');
  return out;
}

function listing(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  (function walk(current, rel) {
    fs.readdirSync(current, { withFileTypes: true }).forEach(entry => {
      const relPath = path.join(rel, entry.name);
      out.push(relPath);
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(path.join(current, entry.name), relPath);
    });
  })(dir, '');
  return out.sort();
}

// --- 1 & 2: install for codex, byte-identical files except cli-pipeline.md
//     and SKILL.md, and the generated resolving section names the engine
//     command literally ---

test('install for codex writes six marked skill dirs, byte-identical to source except cli-pipeline.md and SKILL.md', () => {
  withTmpDirs(['home'], home => {
    const result = runCli(['skills', 'install', '--agent', 'codex'], { home });
    assert.strictEqual(result.status, 0, result.stderr);

    const targetRoot = path.join(home, '.agents', 'skills');
    SHIPPED_SKILLS.forEach(name => {
      const sourceDir = path.join(ROOT, 'skills', name);
      const targetDir = path.join(targetRoot, name);
      assert.ok(fs.existsSync(path.join(targetDir, MARKER_FILENAME)), `${name} should carry the install marker`);

      const marker = JSON.parse(fs.readFileSync(path.join(targetDir, MARKER_FILENAME), 'utf8'));
      assert.strictEqual(marker.package, 'sequentdraw');
      assert.strictEqual(marker.skill, name);
      assert.strictEqual(marker.version, PKG_VERSION);
      assert.ok(marker.engine.startsWith('node "'), 'engine command should be the literal node invocation in this stable-path case');

      const sourceFiles = readAllFiles(sourceDir);
      const targetFiles = readAllFiles(targetDir);
      const cliPipelineRel = path.join('references', 'cli-pipeline.md');

      sourceFiles.forEach((content, relPath) => {
        if (relPath === cliPipelineRel || relPath === 'SKILL.md') return; // asserted separately below
        assert.strictEqual(targetFiles.get(relPath), content, `${name}/${relPath} should be byte-identical`);
      });
    });
  });
});

// --- review finding 1 (major): SKILL.md itself must not send the model
//     down the same broken plugin-root math, since the model reads
//     SKILL.md before any references/ file ---

test('every installed SKILL.md carries an "Installed copy" block right after an unchanged frontmatter', () => {
  const { FRONTMATTER_RE } = require('../src/skills-install/patch-skill-md');

  withTmpDirs(['home'], home => {
    const result = runCli(['skills', 'install', '--agent', 'codex'], { home });
    assert.strictEqual(result.status, 0, result.stderr);

    SHIPPED_SKILLS.forEach(name => {
      const sourcePath = path.join(ROOT, 'skills', name, 'SKILL.md');
      const targetPath = path.join(home, '.agents', 'skills', name, 'SKILL.md');
      const source = fs.readFileSync(sourcePath, 'utf8');
      const installed = fs.readFileSync(targetPath, 'utf8');

      const frontmatterMatch = source.match(FRONTMATTER_RE);
      assert.ok(frontmatterMatch, `${name}/SKILL.md should have a recognizable frontmatter`);
      const frontmatter = frontmatterMatch[0];
      const rest = source.slice(frontmatter.length);

      assert.ok(installed.startsWith(frontmatter), `${name}/SKILL.md's frontmatter should be unchanged and first`);
      assert.ok(installed.endsWith(rest), `${name}/SKILL.md's content after the block should be byte-identical to the source`);

      const block = installed.slice(frontmatter.length, installed.length - rest.length);
      assert.match(block, /## Installed copy/);
      assert.match(block, /sequentdraw skills install/);
      assert.match(block, /ignore any instruction below/i);

      const commandMatch = block.match(/```\n(.+)\n```/);
      assert.ok(commandMatch, `${name}/SKILL.md's block should contain a fenced command`);
      const output = execSync(`${commandMatch[1]} --help`, { encoding: 'utf8' });
      assert.match(output, /Usage: sequentdraw/);
    });
  });
});

test('no installed .md file mentions the plugin-root math without its SKILL.md carrying the override block', () => {
  withTmpDirs(['home'], home => {
    const result = runCli(['skills', 'install', '--agent', 'codex'], { home });
    assert.strictEqual(result.status, 0, result.stderr);

    SHIPPED_SKILLS.forEach(name => {
      const skillDir = path.join(home, '.agents', 'skills', name);
      const files = readAllFiles(skillDir);
      const mentionsPluginRootMath = [...files.entries()]
        .filter(([relPath]) => relPath.endsWith('.md'))
        .some(([, content]) => content.includes('two directories above') || content.includes('<plugin root>'));

      if (!mentionsPluginRootMath) return;

      const skillMd = files.get('SKILL.md');
      assert.match(skillMd, /## Installed copy/, `${name} has a leftover plugin-root mention but no override block in its SKILL.md`);
    });
  });
});

// --- review finding 2 (minor): warn when Cursor would load a skill twice ---

test('installing for cursor after codex (same home) warns about the overlap; installing for copilot never does', () => {
  withTmpDirs(['home', 'project'], (home, project) => {
    const codexInstall = runCli(['skills', 'install', '--agent', 'codex'], { home });
    assert.strictEqual(codexInstall.status, 0, codexInstall.stderr);

    const cursorInstall = runCli(['skills', 'install', '--agent', 'cursor'], { home });
    assert.strictEqual(cursorInstall.status, 0, cursorInstall.stderr);
    assert.match(cursorInstall.stderr, /warning:.*Cursor reads skills from both/);
    assert.match(cursorInstall.stderr, /skills uninstall --agent codex/);

    // A fresh, unrelated project directory has neither install yet -- no
    // warning, and copilot's own location never overlaps with anything.
    const copilotInstall = runCli(['skills', 'install', '--agent', 'copilot', '--project', project], { home });
    assert.strictEqual(copilotInstall.status, 0, copilotInstall.stderr);
    assert.strictEqual(copilotInstall.stderr, '');
  });
});

test('installing for codex with nothing yet at the cursor location prints no overlap warning', () => {
  withTmpDirs(['home'], home => {
    const result = runCli(['skills', 'install', '--agent', 'codex'], { home });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stderr, '');
  });
});

test('the copied cli-pipeline.md names the engine literally and keeps every other section byte-identical', () => {
  withTmpDirs(['home'], home => {
    const result = runCli(['skills', 'install', '--agent', 'codex'], { home });
    assert.strictEqual(result.status, 0, result.stderr);

    const copiedPath = path.join(home, '.agents', 'skills', 'git-map', 'references', 'cli-pipeline.md');
    const copied = fs.readFileSync(copiedPath, 'utf8');
    const source = fs.readFileSync(path.join(ROOT, 'skills', 'git-map', 'references', 'cli-pipeline.md'), 'utf8');

    const copiedResolving = splitSection(copied, RESOLVING_HEADING).section;
    assert.match(copiedResolving, /node "/, 'should name node literally');
    assert.ok(!copiedResolving.includes('<plugin root>'), 'should not mention the plugin-root placeholder');
    assert.ok(!copiedResolving.includes('${'), 'should not contain an unresolved brace variable');
    assert.ok(!copiedResolving.includes('$'), 'should not contain any shell variable sigil');

    // Every section other than "Resolving" and (partially) "Learning the
    // document shape" must be untouched.
    const sourceSections = source.split(/\n(?=## )/);
    const copiedSections = copied.split(/\n(?=## )/);
    assert.strictEqual(sourceSections.length, copiedSections.length);
    sourceSections.forEach((sourceSection, i) => {
      const heading = sourceSection.split('\n')[0];
      if (heading.startsWith('## Resolving') || heading.startsWith('## Learning the document shape')) return;
      assert.strictEqual(copiedSections[i], sourceSection, `section "${heading}" should be untouched`);
    });

    const copiedLearning = copiedSections.find(s => s.startsWith('## Learning the document shape'));
    assert.ok(!copiedLearning.includes('<plugin root>'), 'schema reference should be rewritten too');
  });
});

// --- 3: the npx case ---

test('rewriteCliPipeline names an npx command when the package root looks like an npx cache', () => {
  const engineInfo = { isNpx: true, packageRoot: '/home/user/.npm/_npx/abc123/node_modules/sequentdraw', version: '1.2.3' };
  const rewritten = rewriteCliPipeline(SOURCE_CLI_PIPELINE, engineInfo);
  const section = splitSection(rewritten, RESOLVING_HEADING).section;

  assert.match(section, /npx -y sequentdraw@1\.2\.3/);
  assert.ok(!section.includes('<plugin root>'));
  assert.ok(!section.includes('$'));

  const learning = splitSection(rewritten, '## Learning the document shape').section;
  assert.ok(!learning.includes('<plugin root>'));
  assert.match(learning, /ships inside the package/);
});

// --- 4: the generated command actually runs (stable-path case) ---

test('the generated stable-path command actually runs --help successfully', () => {
  withTmpDirs(['home'], home => {
    const result = runCli(['skills', 'install', '--agent', 'codex'], { home });
    assert.strictEqual(result.status, 0, result.stderr);

    const copiedPath = path.join(home, '.agents', 'skills', 'git-map', 'references', 'cli-pipeline.md');
    const copied = fs.readFileSync(copiedPath, 'utf8');
    const section = splitSection(copied, RESOLVING_HEADING).section;
    const commandMatch = section.match(/```\n(.+)\n```/);
    assert.ok(commandMatch, 'resolving section should contain a fenced command');

    const output = execSync(`${commandMatch[1]} --help`, { encoding: 'utf8' });
    assert.match(output, /Usage: sequentdraw/);
  });
});

// --- 5: re-install succeeds; install over an unmarked directory refuses it ---

test('re-installing over our own previous install succeeds', () => {
  withTmpDirs(['home'], home => {
    const first = runCli(['skills', 'install', '--agent', 'codex'], { home });
    assert.strictEqual(first.status, 0, first.stderr);
    const second = runCli(['skills', 'install', '--agent', 'codex'], { home });
    assert.strictEqual(second.status, 0, second.stderr);
    assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'git-map', MARKER_FILENAME)));
  });
});

test('install over a directory with no marker refuses that skill, installs the rest, exits non-zero', () => {
  withTmpDirs(['home'], home => {
    const targetRoot = path.join(home, '.agents', 'skills');
    fs.mkdirSync(path.join(targetRoot, 'git-map'), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, 'git-map', 'unrelated.txt'), 'someone else was here\n');

    const result = runCli(['skills', 'install', '--agent', 'codex'], { home });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /refused git-map/);
    assert.ok(fs.existsSync(path.join(targetRoot, 'git-map', 'unrelated.txt')), 'the unmarked directory must be left untouched');
    assert.ok(!fs.existsSync(path.join(targetRoot, 'git-map', MARKER_FILENAME)));

    // The rest still installed.
    assert.ok(fs.existsSync(path.join(targetRoot, 'doc-map', MARKER_FILENAME)));
    assert.ok(fs.existsSync(path.join(targetRoot, 'business-map', MARKER_FILENAME)));
  });
});

// --- 6: uninstall removes only marked dirs; an unmarked sibling survives ---

test('uninstall removes only marked directories; an unmarked sibling survives', () => {
  withTmpDirs(['home'], home => {
    const targetRoot = path.join(home, '.agents', 'skills');
    const install = runCli(['skills', 'install', '--agent', 'codex'], { home });
    assert.strictEqual(install.status, 0, install.stderr);

    // Simulate a foreign directory sharing the root but not one of our six.
    fs.mkdirSync(path.join(targetRoot, 'someone-elses-skill'), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, 'someone-elses-skill', 'SKILL.md'), '# not ours\n');

    const uninstall = runCli(['skills', 'uninstall', '--agent', 'codex'], { home });
    assert.strictEqual(uninstall.status, 0, uninstall.stderr);

    SHIPPED_SKILLS.forEach(name => {
      assert.ok(!fs.existsSync(path.join(targetRoot, name)), `${name} should be removed`);
    });
    assert.ok(fs.existsSync(path.join(targetRoot, 'someone-elses-skill', 'SKILL.md')), 'a directory we never shipped must survive uninstall');
  });
});

test('uninstall refuses an installed-looking directory with no marker', () => {
  withTmpDirs(['home'], home => {
    const targetRoot = path.join(home, '.agents', 'skills');
    fs.mkdirSync(path.join(targetRoot, 'git-map'), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, 'git-map', 'SKILL.md'), '# hand-written, not installed by us\n');

    const result = runCli(['skills', 'uninstall', '--agent', 'codex'], { home });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /refused git-map/);
    assert.ok(fs.existsSync(path.join(targetRoot, 'git-map', 'SKILL.md')));
  });
});

// --- 7: symlink refusal ---

test('symlinkBlocksPath refuses a target that is itself a symlink', () => {
  withTmpDirs(['root'], root => {
    const real = path.join(root, 'real');
    fs.mkdirSync(real);
    const linked = path.join(root, 'linked');
    fs.symlinkSync(real, linked, 'dir');
    assert.strictEqual(symlinkBlocksPath(root, linked), true);
    assert.strictEqual(symlinkBlocksPath(root, real), false);
  });
});

test('symlinkBlocksPath refuses a path through a symlinked parent directory', () => {
  withTmpDirs(['root'], root => {
    const real = path.join(root, 'real');
    fs.mkdirSync(real);
    const linkedParent = path.join(root, 'linked-parent');
    fs.symlinkSync(real, linkedParent, 'dir');
    const deep = path.join(linkedParent, 'skill-name');
    assert.strictEqual(symlinkBlocksPath(root, deep), true);
  });
});

test('install --project <this repo> refuses through the repo\'s own .agents/skills symlinks, writing nothing into skills/', () => {
  const gitMapSkillMd = path.join(ROOT, 'skills', 'git-map', 'SKILL.md');
  const beforeContent = fs.readFileSync(gitMapSkillMd, 'utf8');

  withTmpDirs(['home'], home => {
    const result = runCli(['skills', 'install', '--agent', 'codex', '--project', ROOT], { home });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /symlink/);
    SHIPPED_SKILLS.forEach(name => assert.match(result.stderr, new RegExp(`refused ${name}`)));
  });

  const afterContent = fs.readFileSync(gitMapSkillMd, 'utf8');
  assert.strictEqual(afterContent, beforeContent, 'the real skills/ source must be untouched');
});

// --- 8: copilot requires --project ---

test('copilot without --project refuses with a clear message', () => {
  withTmpDirs(['home'], home => {
    const result = runCli(['skills', 'install', '--agent', 'copilot'], { home });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--project/);
  });
});

test('copilot with --project writes .github/skills/', () => {
  withTmpDirs(['home', 'project'], (home, project) => {
    const result = runCli(['skills', 'install', '--agent', 'copilot', '--project', project], { home });
    assert.strictEqual(result.status, 0, result.stderr);
    SHIPPED_SKILLS.forEach(name => {
      assert.ok(fs.existsSync(path.join(project, '.github', 'skills', name, 'SKILL.md')));
    });
  });
});

test('cursor installs into .cursor/skills/', () => {
  withTmpDirs(['home'], home => {
    const result = runCli(['skills', 'install', '--agent', 'cursor'], { home });
    assert.strictEqual(result.status, 0, result.stderr);
    SHIPPED_SKILLS.forEach(name => {
      assert.ok(fs.existsSync(path.join(home, '.cursor', 'skills', name, 'SKILL.md')));
    });
  });
});

// --- 9: --dry-run writes nothing ---

test('--dry-run prints every action and changes nothing on disk', () => {
  withTmpDirs(['home'], home => {
    const targetRoot = path.join(home, '.agents', 'skills');
    const before = listing(home);
    const result = runCli(['skills', 'install', '--agent', 'codex', '--dry-run'], { home });
    assert.strictEqual(result.status, 0, result.stderr);
    SHIPPED_SKILLS.forEach(name => assert.match(result.stdout, new RegExp(`would install ${name}`)));
    const after = listing(home);
    assert.deepStrictEqual(after, before, 'dry-run must not create anything');
    assert.ok(!fs.existsSync(targetRoot));
  });
});

test('uninstall --dry-run changes nothing on disk', () => {
  withTmpDirs(['home'], home => {
    const install = runCli(['skills', 'install', '--agent', 'codex'], { home });
    assert.strictEqual(install.status, 0, install.stderr);
    const before = listing(path.join(home, '.agents', 'skills'));
    const result = runCli(['skills', 'uninstall', '--agent', 'codex', '--dry-run'], { home });
    assert.strictEqual(result.status, 0, result.stderr);
    const after = listing(path.join(home, '.agents', 'skills'));
    assert.deepStrictEqual(after, before);
  });
});

// --- 10: skills list ---

test('skills list prints exactly the six shipped skills with a one-line summary', () => {
  withTmpDirs(['home'], home => {
    const result = runCli(['skills', 'list'], { home });
    assert.strictEqual(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split('\n');
    assert.strictEqual(lines.length, SHIPPED_SKILLS.length);
    SHIPPED_SKILLS.forEach(name => {
      assert.ok(lines.some(line => line.startsWith(`${name}  `)), `list should include ${name}`);
    });
    assert.deepStrictEqual(listShippedSkillNames(ROOT), SHIPPED_SKILLS);
  });
});

// --- 11: a package path containing a space is double-quoted ---

test('buildEngineCommand double-quotes a package path containing a space', () => {
  const { command } = buildEngineCommand({ isNpx: false, packageRoot: '/Users/x/My Drive/sequentdraw', version: '0.1.0' });
  assert.strictEqual(command, 'node "/Users/x/My Drive/sequentdraw/bin/sequentdraw"');
});

test('buildEngineCommand names an exact npx version with no path at all', () => {
  const { command, kind } = buildEngineCommand({ isNpx: true, packageRoot: '/tmp/_npx/abc/node_modules/sequentdraw', version: '2.0.0' });
  assert.strictEqual(kind, 'npx');
  assert.strictEqual(command, 'npx -y sequentdraw@2.0.0');
});

// --- resolveTargetRoot: pure unit coverage of the targets table ---

test('resolveTargetRoot maps each agent to its documented target', () => {
  assert.deepStrictEqual(resolveTargetRoot('codex', null, '/home/u'), { root: path.join('/home/u', '.agents', 'skills') });
  assert.deepStrictEqual(resolveTargetRoot('codex', '/proj', '/home/u'), { root: path.join('/proj', '.agents', 'skills') });
  assert.deepStrictEqual(resolveTargetRoot('cursor', null, '/home/u'), { root: path.join('/home/u', '.cursor', 'skills') });
  assert.deepStrictEqual(resolveTargetRoot('cursor', '/proj', '/home/u'), { root: path.join('/proj', '.cursor', 'skills') });
  assert.deepStrictEqual(resolveTargetRoot('copilot', '/proj', '/home/u'), { root: path.join('/proj', '.github', 'skills') });
  assert.ok(resolveTargetRoot('copilot', null, '/home/u').error);
});

// --- markerStatus: pure unit coverage ---

test('markerStatus distinguishes absent, ours and foreign', () => {
  withTmpDirs(['root'], root => {
    const absent = path.join(root, 'absent');
    assert.strictEqual(markerStatus(absent), 'absent');

    const ours = path.join(root, 'ours');
    fs.mkdirSync(ours);
    fs.writeFileSync(path.join(ours, MARKER_FILENAME), JSON.stringify({ package: 'sequentdraw' }));
    assert.strictEqual(markerStatus(ours), 'ours');

    const foreignNoMarker = path.join(root, 'foreign-no-marker');
    fs.mkdirSync(foreignNoMarker);
    assert.strictEqual(markerStatus(foreignNoMarker), 'foreign');

    const foreignBadJson = path.join(root, 'foreign-bad-json');
    fs.mkdirSync(foreignBadJson);
    fs.writeFileSync(path.join(foreignBadJson, MARKER_FILENAME), 'not json');
    assert.strictEqual(markerStatus(foreignBadJson), 'foreign');

    const foreignFile = path.join(root, 'foreign-file');
    fs.writeFileSync(foreignFile, 'a plain file, not a directory\n');
    assert.strictEqual(markerStatus(foreignFile), 'foreign');
  });
});

// --- --help and unknown flags ---

test('skills --help prints usage without touching disk', () => {
  const result = runCli(['skills', '--help']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /skills install/);
});

test('an unknown skills subcommand exits 1 with usage', () => {
  const result = runCli(['skills', 'bogus']);
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});
