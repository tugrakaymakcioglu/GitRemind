import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import {
  parsePorcelainLine,
  getRepoState,
  isGitRepository,
  commitChanges,
  stageAll,
  stageFiles,
  generateCommitSuggestion,
  suggestCommitMessage,
} from '../src/core/git.js';

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
      assert.equal(state.lastCommitRelative, 'No commits yet');
      assert.equal(state.lastCommitMessage, 'Waiting for initial commit');

      // Create a file
      fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'Hello world', 'utf8');

      state = await getRepoState(tmpDir);
      assert.equal(state.isDirty, true);
      assert.equal(state.summary.untracked, 1);
      assert.equal(state.summary.total, 1);

      // Commit changes using commitChanges helper
      const commitRes = await commitChanges(tmpDir, 'feat: initial commit', true);
      assert.equal(commitRes.success, true);
      assert.ok(commitRes.hash);

      state = await getRepoState(tmpDir);
      assert.equal(state.isDirty, false);
      assert.equal(state.summary.total, 0);
      assert.equal(state.lastCommitMessage, 'feat: initial commit');

      // Modify committed file
      fs.appendFileSync(path.join(tmpDir, 'hello.txt'), '\nsecond line');
      state = await getRepoState(tmpDir);
      assert.equal(state.isDirty, true);
      assert.equal(state.summary.modified, 1);

      // Test stageAll
      await stageAll(tmpDir);
      state = await getRepoState(tmpDir);
      assert.equal(state.summary.staged, 1);

      // Commit staged changes without stageAll=false
      const commit2 = await commitChanges(tmpDir, 'fix: second line added', false);
      assert.equal(commit2.success, true);

      state = await getRepoState(tmpDir);
      assert.equal(state.isDirty, false);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore tmp cleanup error on windows
      }
    }
  });

  it('should generate accurate conventional commit suggestions', () => {
    // Tests
    const testSuggestion = generateCommitSuggestion([
      { path: 'tests/git.test.ts', kind: 'modified', staged: false, rawStatus: ' M' },
    ]);
    assert.ok(testSuggestion.startsWith('test:'));

    // Docs
    const docSuggestion = generateCommitSuggestion([
      { path: 'README.md', kind: 'modified', staged: false, rawStatus: ' M' },
    ]);
    assert.ok(docSuggestion.startsWith('docs:'));

    // Config / Build
    const buildSuggestion = generateCommitSuggestion([
      { path: 'package.json', kind: 'modified', staged: false, rawStatus: ' M' },
    ]);
    assert.ok(buildSuggestion.startsWith('build:'));

    // Styles
    const styleSuggestion = generateCommitSuggestion([
      { path: 'src/theme.css', kind: 'modified', staged: false, rawStatus: ' M' },
    ]);
    assert.ok(styleSuggestion.startsWith('style:'));

    // suggestCommitMessage helper
    const suggested = suggestCommitMessage([
      { path: 'docs/guide.md', kind: 'modified', staged: false, rawStatus: ' M' },
    ]);
    assert.ok(suggested.startsWith('docs:'));
  });
});
