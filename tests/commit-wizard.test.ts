import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { commitChanges, getRepoState, formatTimeAgo } from '../src/core/git.js';
import { DashboardApp } from '../src/cli/dashboard.js';

describe('Commit Wizard & Git Operations', () => {
  it('should format relative time correctly', () => {
    const now = new Date();
    assert.equal(formatTimeAgo(now), 'just now');

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    assert.equal(formatTimeAgo(fiveMinAgo), '5 minutes ago');

    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    assert.equal(formatTimeAgo(twoHoursAgo), '2 hours ago');

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    assert.equal(formatTimeAgo(threeDaysAgo), '3 days ago');
  });

  it('should stage and commit changes using commitChanges', async () => {
    const tmpDir = path.join(os.tmpdir(), `gitremind-wizard-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      execSync('git init', { cwd: tmpDir });
      execSync('git config user.email "wizard@example.com"', { cwd: tmpDir });
      execSync('git config user.name "Wizard Tester"', { cwd: tmpDir });

      // Create new file
      fs.writeFileSync(path.join(tmpDir, 'feature.ts'), 'export const magic = 42;\n', 'utf8');

      // Check dirty state
      const beforeState = await getRepoState(tmpDir);
      assert.equal(beforeState.isDirty, true);
      assert.equal(beforeState.summary.total, 1);
      assert.ok(beforeState.firstDirtyRelative);

      // Run commitChanges
      const commitRes = await commitChanges({
        repoPath: tmpDir,
        message: 'feat(core): add magic feature',
      });

      assert.equal(commitRes.success, true);
      assert.ok(commitRes.commitHash);
      assert.equal(commitRes.commitMessage, 'feat(core): add magic feature');

      // Verify repository is now clean
      const afterState = await getRepoState(tmpDir);
      assert.equal(afterState.isDirty, false);
      assert.equal(afterState.summary.total, 0);
      assert.equal(afterState.lastCommitMessage, 'feat(core): add magic feature');
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('should initialize DashboardApp without errors', async () => {
    const app = new DashboardApp();
    assert.ok(app);
    // In non-TTY test environment, start() should gracefully render and return
    await app.start();
    await app.stop();
  });
});
