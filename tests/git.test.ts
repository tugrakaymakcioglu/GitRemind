import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { parsePorcelainLine, getRepoState, isGitRepository } from '../src/core/git.js';

describe('Git Parser & Inspector', () => {
  it('should parse untracked files correctly', () => {
    const res = parsePorcelainLine('?? newfile.ts');
    assert.ok(res);
    assert.equal(res.path, 'newfile.ts');
    assert.equal(res.kind, 'untracked');
    assert.equal(res.staged, false);
  });

  it('should parse modified unstaged files correctly', () => {
    const res = parsePorcelainLine(' M src/index.ts');
    assert.ok(res);
    assert.equal(res.path, 'src/index.ts');
    assert.equal(res.kind, 'modified');
    assert.equal(res.staged, false);
  });

  it('should parse staged added files correctly', () => {
    const res = parsePorcelainLine('A  src/new-feature.ts');
    assert.ok(res);
    assert.equal(res.path, 'src/new-feature.ts');
    assert.equal(res.kind, 'staged');
    assert.equal(res.staged, true);
  });

  it('should parse deleted files correctly', () => {
    const res = parsePorcelainLine(' D old.txt');
    assert.ok(res);
    assert.equal(res.path, 'old.txt');
    assert.equal(res.kind, 'deleted');
  });

  it('should parse renamed files correctly', () => {
    const res = parsePorcelainLine('R  old.txt -> new.txt');
    assert.ok(res);
    assert.equal(res.path, 'new.txt');
    assert.equal(res.kind, 'renamed');
    assert.equal(res.staged, true);
  });

  it('should parse conflicted files correctly', () => {
    const res = parsePorcelainLine('UU conflict.ts');
    assert.ok(res);
    assert.equal(res.path, 'conflict.ts');
    assert.equal(res.kind, 'conflicted');
  });

  it('should inspect actual git repository states', async () => {
    // Create a temporary git repo to test real git inspection
    const tmpDir = path.join(os.tmpdir(), `gitremind-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      execSync('git init', { cwd: tmpDir });
      execSync('git config user.email "test@example.com"', { cwd: tmpDir });
      execSync('git config user.name "Test Runner"', { cwd: tmpDir });

      const isRepo = await isGitRepository(tmpDir);
      assert.equal(isRepo, true);

      // Initially empty
      let state = await getRepoState(tmpDir);
      assert.equal(state.isGitRepo, true);
      assert.equal(state.isDirty, false);

      // Create a file
      fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'Hello world', 'utf8');

      state = await getRepoState(tmpDir);
      assert.equal(state.isDirty, true);
      assert.equal(state.summary.untracked, 1);
      assert.equal(state.summary.total, 1);

      // Stage and commit
      execSync('git add hello.txt', { cwd: tmpDir });
      execSync('git commit -m "initial commit"', { cwd: tmpDir });

      state = await getRepoState(tmpDir);
      assert.equal(state.isDirty, false);
      assert.equal(state.summary.total, 0);
      assert.equal(state.lastCommitMessage, 'initial commit');

      // Modify committed file
      fs.appendFileSync(path.join(tmpDir, 'hello.txt'), '\nsecond line');
      state = await getRepoState(tmpDir);
      assert.equal(state.isDirty, true);
      assert.equal(state.summary.modified, 1);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore tmp cleanup error on windows
      }
    }
  });
});
