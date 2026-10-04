import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { GitFileStatus, GitRepoState, GitRepoSummary, FileChangeKind } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Executes a git command safely with timeout
 */
async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: 8000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout.trimEnd();
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    // If command failed, check if stdout contains output or throw
    if (error.stdout) {
      return error.stdout.trimEnd();
    }
    throw new Error(error.stderr || error.message || 'Git command failed');
  }
}

/**
 * Checks if target directory is inside a git repository
 */
export async function isGitRepository(targetDir: string): Promise<boolean> {
  if (!fs.existsSync(targetDir)) {
    return false;
  }
  try {
    const out = await runGit(['rev-parse', '--is-inside-work-tree'], targetDir);
    return out === 'true';
  } catch {
    return false;
  }
}

/**
 * Resolves the top-level root directory of a git repository
 */
export async function getRepoRoot(targetDir: string): Promise<string | null> {
  if (!fs.existsSync(targetDir)) {
    return null;
  }
  try {
    const out = await runGit(['rev-parse', '--show-toplevel'], targetDir);
    return path.normalize(out);
  } catch {
    return null;
  }
}

/**
 * Parses raw git status porcelain v1 output line into GitFileStatus
 */
export function parsePorcelainLine(line: string): GitFileStatus | null {
  if (!line || line.length < 3) return null;

  const x = line[0];
  const y = line[1];
  const rawPath = line.slice(3).trim();
  // Handle renamed format: "old -> new"
  const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ')[1] : rawPath;

  let kind: FileChangeKind = 'modified';
  let staged = false;

  if (x === '?' && y === '?') {
    kind = 'untracked';
    staged = false;
  } else if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
    kind = 'conflicted';
    staged = false;
  } else if (x === 'D' || y === 'D') {
    kind = 'deleted';
    staged = x === 'D' && y === ' ';
  } else if (x === 'A') {
    kind = 'staged';
    staged = true;
  } else if (x === 'R') {
    kind = 'renamed';
    staged = true;
  } else if (x === 'M' && y === ' ') {
    kind = 'staged';
    staged = true;
  } else if (y === 'M') {
    kind = 'modified';
    staged = false;
  } else {
    kind = 'modified';
    staged = x !== ' ' && x !== '?';
  }

  return {
    path: filePath,
    kind,
    staged,
    rawStatus: line.slice(0, 2),
  };
}

/**
 * Gathers complete repository status and commit metadata
 */
export async function getRepoState(repoPath: string): Promise<GitRepoState> {
  const root = await getRepoRoot(repoPath);
  const repoName = root ? path.basename(root) : path.basename(repoPath);

  if (!root) {
    return {
      isGitRepo: false,
      rootPath: repoPath,
      name: repoName,
      branch: '',
      isDirty: false,
      files: [],
      summary: { modified: 0, untracked: 0, staged: 0, deleted: 0, total: 0 },
      lastCommitTime: null,
      lastCommitRelative: '',
      lastCommitHash: '',
      lastCommitMessage: '',
      error: 'Not a git repository',
    };
  }

  try {
    // 1. Current Branch
    let branch = 'HEAD';
    try {
      branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root);
    } catch {
      branch = 'unknown';
    }

    // 2. Uncommitted changes via porcelain
    const statusOutput = await runGit(['status', '--porcelain=v1', '-uall'], root);
    const lines = statusOutput.split(/\r?\n/).filter((l) => l.trim().length > 0);

    const files: GitFileStatus[] = [];
    const summary: GitRepoSummary = {
      modified: 0,
      untracked: 0,
      staged: 0,
      deleted: 0,
      total: 0,
    };

    for (const line of lines) {
      const parsed = parsePorcelainLine(line);
      if (parsed) {
        files.push(parsed);
        if (parsed.kind === 'untracked') {
          summary.untracked++;
        } else if (parsed.kind === 'deleted') {
          summary.deleted++;
        } else if (parsed.kind === 'staged' || parsed.staged) {
          summary.staged++;
        } else {
          summary.modified++;
        }
      }
    }
    summary.total = files.length;
    const isDirty = summary.total > 0;

    // 3. Last Commit info
    let lastCommitTime: Date | null = null;
    let lastCommitRelative = '';
    let lastCommitHash = '';
    let lastCommitMessage = '';

    try {
      const logOut = await runGit(['log', '-1', '--format=%H|%cr|%ct|%s'], root);
      if (logOut) {
        const [hash, relative, timestampSec, message] = logOut.split('|');
        lastCommitHash = (hash || '').slice(0, 8);
        lastCommitRelative = relative || '';
        lastCommitMessage = message || '';
        if (timestampSec) {
          lastCommitTime = new Date(parseInt(timestampSec, 10) * 1000);
        }
      }
    } catch {
      // Empty repository with no commits yet
      lastCommitRelative = 'Henüz commit yok';
      lastCommitMessage = 'İlk commit bekleniyor';
    }

    return {
      isGitRepo: true,
      rootPath: root,
      name: repoName,
      branch,
      isDirty,
      files,
      summary,
      lastCommitTime,
      lastCommitRelative,
      lastCommitHash,
      lastCommitMessage,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      isGitRepo: true,
      rootPath: root,
      name: repoName,
      branch: 'error',
      isDirty: false,
      files: [],
      summary: { modified: 0, untracked: 0, staged: 0, deleted: 0, total: 0 },
      lastCommitTime: null,
      lastCommitRelative: '',
      lastCommitHash: '',
      lastCommitMessage: '',
      error: errorMsg,
    };
  }
}
