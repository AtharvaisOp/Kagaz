import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { sampleWorkspaceBytes } from './workspace-sample.mjs';

const knownTemp = resolve(fs.realpathSync(tmpdir()));

function removeFixtureDirectory(root, path) {
  const fixtureRoot = resolve(root);
  const target = resolve(path);
  const withinFixture = relative(fixtureRoot, target);
  assert(
    dirname(fixtureRoot) === knownTemp &&
      fixtureRoot.startsWith(join(knownTemp, 'kagaz-sampler-test-')) &&
      !isAbsolute(withinFixture) &&
      withinFixture !== '..' &&
      !withinFixture.startsWith(`..${sep}`),
    'Sampler fixture cleanup target must remain inside the known temp fixture.',
  );
  fs.rmSync(target, { recursive: true, force: true });
}

function fixture(t) {
  const root = fs.mkdtempSync(join(knownTemp, 'kagaz-sampler-test-'));
  t.after(() => removeFixtureDirectory(root, root));
  return root;
}

test('sampling tolerates a real directory removed or replaced between lstat and readdir', (t) => {
  for (const replaced of [false, true]) {
    const root = fixture(t);
    const workspace = join(root, 'kagaz-private');
    fs.mkdirSync(workspace);
    fs.writeFileSync(join(workspace, 'input.pdf'), Buffer.alloc(17));
    let removed = false;
    const fsImpl = {
      ...fs,
      readdirSync(path) {
        if (path === workspace) {
          removeFixtureDirectory(root, workspace);
          if (replaced) fs.writeFileSync(workspace, 'replacement');
          removed = true;
        }
        return fs.readdirSync(path);
      },
    };
    assert.equal(sampleWorkspaceBytes(root, fsImpl), 0);
    assert.equal(removed, true);
  }
});

test('sampling counts a symlink itself without traversing its target', (t) => {
  const root = fixture(t);
  const target = join(root, 'external-target');
  const workspace = join(root, 'kagaz-private');
  const link = join(workspace, 'linked-directory');
  fs.mkdirSync(target);
  fs.writeFileSync(join(target, 'outside.pdf'), Buffer.alloc(100_000));
  fs.mkdirSync(workspace);
  fs.writeFileSync(join(workspace, 'input.pdf'), Buffer.alloc(23));
  fs.symlinkSync(
    target,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.equal(sampleWorkspaceBytes(root), 23 + fs.lstatSync(link).size);
});

test('unexpected filesystem errors fail with a fixed redacted diagnostic', (t) => {
  const root = fixture(t);
  const workspace = join(root, 'kagaz-private');
  fs.mkdirSync(workspace);
  const denied = Object.assign(new Error(`EACCES scandir '${workspace}'`), {
    code: 'EACCES',
    path: workspace,
  });
  const fsImpl = {
    ...fs,
    readdirSync(path) {
      if (path === workspace) throw denied;
      return fs.readdirSync(path);
    },
  };
  assert.throws(
    () => sampleWorkspaceBytes(root, fsImpl),
    (error) => {
      assert.equal(error.message, 'Workspace sampling failed.');
      assert.equal(error.cause, undefined);
      assert(!error.stack.includes(workspace));
      return true;
    },
  );
});
