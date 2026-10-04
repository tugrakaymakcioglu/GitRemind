import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { GitFileStatus, GitRepoState, GitRepoSummary, FileChangeKind, CommitOptions, CommitResult } from './types.js';

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
      lastCommitRelative = 'No commits yet';
      lastCommitMessage = 'Waiting for initial commit';
    }

    // 4. Calculate time of first uncommitted change
    let firstDirtyTime: Date | null = null;
    let firstDirtyRelative = '';
    if (isDirty && files.length > 0) {
      let oldestMs = Infinity;
      for (const f of files) {
        try {
          const fullPath = path.resolve(root, f.path);
          if (fs.existsSync(fullPath)) {
            const stat = fs.statSync(fullPath);
            if (stat.mtimeMs < oldestMs) {
              oldestMs = stat.mtimeMs;
            }
          }
        } catch {
          // ignore
        }
      }
      if (oldestMs !== Infinity) {
        firstDirtyTime = new Date(oldestMs);
        firstDirtyRelative = formatTimeAgo(firstDirtyTime);
      }
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
      firstDirtyTime,
      firstDirtyRelative,
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

/**
 * Formats a Date object into human readable relative time in English
 */
export function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 'just now';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin === 1) return '1 minute ago';
  if (diffMin < 60) return `${diffMin} minutes ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
}

/**
 * Stages all changes in the target git repository
 */
export async function stageAll(repoPath: string): Promise<string> {
  const root = await getRepoRoot(repoPath);
  return await runGit(['add', '-A'], root || repoPath);
}

/**
 * Stages specific files in the target git repository
 */
export async function stageFiles(repoPath: string, files: string[]): Promise<string> {
  if (!files || files.length === 0) return '';
  const root = await getRepoRoot(repoPath);
  return await runGit(['add', '--', ...files], root || repoPath);
}

/**
 * Commits staged changes or optionally stages all changes before committing
 */
export async function commitChanges(
  repoPath: string,
  message: string,
  stageAll?: boolean
): Promise<{
  success: boolean;
  hash?: string;
  message?: string;
  commitHash?: string;
  commitMessage?: string;
  relativeTime?: string;
  error?: string;
}>;
export async function commitChanges(
  options: CommitOptions
): Promise<CommitResult>;
export async function commitChanges(
  repoPathOrOptions: string | CommitOptions,
  maybeMessage?: string,
  stageAll = true
): Promise<CommitResult & { hash?: string; message?: string }> {
  let targetPath: string;
  let commitMsg: string;
  let shouldStageAll = stageAll;
  let specificFiles: string[] | undefined;

  if (typeof repoPathOrOptions === 'string') {
    targetPath = repoPathOrOptions;
    commitMsg = maybeMessage || '';
  } else {
    targetPath = repoPathOrOptions.repoPath || process.cwd();
    commitMsg = repoPathOrOptions.message;
    specificFiles = repoPathOrOptions.files;
    shouldStageAll = !specificFiles || specificFiles.length === 0;
  }

  const targetDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const root = await getRepoRoot(targetDir);
  if (!root) {
    return {
      success: false,
      error: `Directory "${targetDir}" is not a git repository.`,
    };
  }

  try {
    if (specificFiles && specificFiles.length > 0) {
      await runGit(['add', '--', ...specificFiles], root);
    } else if (shouldStageAll) {
      await runGit(['add', '-A'], root);
    }

    const commitOutput = await runGit(['commit', '-m', commitMsg], root);

    let commitHash: string | undefined;
    let relativeTime = 'just now';
    try {
      const logOut = await runGit(['log', '-1', '--format=%h|%cr'], root);
      if (logOut) {
        const parts = logOut.split('|');
        commitHash = parts[0] ? parts[0].trim() : undefined;
        relativeTime = parts[1] ? parts[1].trim() : 'just now';
      }
    } catch {
      // fallback
    }

    return {
      success: true,
      hash: commitHash,
      commitHash,
      message: commitOutput,
      commitMessage: commitMsg,
      relativeTime,
      filesCommitted: specificFiles ? specificFiles.length : undefined,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Generates an automated Conventional Commit suggestion based on changed files
 */
export function generateCommitSuggestion(files: GitFileStatus[]): string {
  if (!files || files.length === 0) {
    return 'chore: update project files';
  }

  const paths = files.map((f) => f.path.replace(/\\/g, '/').toLowerCase());
  const kinds = files.map((f) => f.kind);

  // Check if all files match test patterns
  const isAllTests = paths.every((p) => p.includes('test') || p.includes('spec'));
  if (isAllTests) {
    return 'test: update test suites and assertions';
  }

  // Check if all files are documentation
  const isAllDocs = paths.every(
    (p) => p.endsWith('.md') || p.includes('docs/') || p.includes('license') || p.endsWith('.txt')
  );
  if (isAllDocs) {
    return 'docs: update documentation';
  }

  // Check if build or CI configuration
  const isAllBuildOrCi = paths.every(
    (p) =>
      p.endsWith('package.json') ||
      p.endsWith('package-lock.json') ||
      p.endsWith('tsconfig.json') ||
      p.startsWith('.github/') ||
      p.startsWith('.gitlab/') ||
      p.endsWith('.yml') ||
      p.endsWith('.yaml')
  );
  if (isAllBuildOrCi) {
    return 'build: update configuration and dependencies';
  }

  // Check if styles
  const isAllStyles = paths.every(
    (p) => p.endsWith('.css') || p.endsWith('.scss') || p.endsWith('.less') || p.endsWith('.sass')
  );
  if (isAllStyles) {
    return 'style: update styling and UI design';
  }

  // Check if deleted files only
  const isAllDeleted = kinds.every((k) => k === 'deleted');
  if (isAllDeleted) {
    return 'refactor: remove obsolete files';
  }

  // Check if small set of newly added files
  const isAllAdded = kinds.every((k) => k === 'untracked' || k === 'staged');
  if (isAllAdded && files.length <= 3) {
    const baseNames = files.map((f) => path.basename(f.path));
    return `feat: add ${baseNames.join(', ')}`;
  }

  // Determine scope if all files are in the same directory
  const topDirs = paths
    .map((p) => (p.includes('/') ? p.split('/')[0] : ''))
    .filter((d) => d.length > 0 && d !== 'src');

  const scope = topDirs.length > 0 && topDirs.every((d) => d === topDirs[0]) ? `(${topDirs[0]})` : '';

  if (files.some((f) => f.kind === 'untracked')) {
    return `feat${scope}: implement new features and updates`;
  }

  return `refactor${scope}: update and polish project files`;
}

/**
 * Suggests a conventional commit message for a repository state or file status list
 */
export function suggestCommitMessage(stateOrFiles: GitRepoState | GitFileStatus[]): string {
  const files = Array.isArray(stateOrFiles) ? stateOrFiles : stateOrFiles.files;
  return generateCommitSuggestion(files);
}

export interface CommitHistoryItem {
  hash: string;
  relativeTime: string;
  author: string;
  message: string;
}

/**
 * Retrieves recent commits for the repository
 */
export async function getRecentCommits(
  repoPath: string,
  limit = 5
): Promise<CommitHistoryItem[]> {
  try {
    const root = (await getRepoRoot(repoPath)) || repoPath;
    const logOut = await runGit(['log', `-${limit}`, '--format=%h|%cr|%an|%s'], root);
    if (!logOut || !logOut.trim()) return [];
    return logOut
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const [hash, relativeTime, author, message] = line.split('|');
        return {
          hash: hash || '',
          relativeTime: relativeTime || '',
          author: author || '',
          message: message || '',
        };
      });
  } catch {
    return [];
  }
}

export interface UpstreamStatus {
  ahead: number;
  behind: number;
  upstream: string;
}

/**
 * Checks ahead / behind count against remote tracking branch
 */
export async function getUpstreamStatus(repoPath: string): Promise<UpstreamStatus> {
  try {
    const root = (await getRepoRoot(repoPath)) || repoPath;
    const revOut = await runGit(['rev-parse', '--abbrev-ref', '@{upstream}'], root);
    const upstream = revOut.trim();
    if (!upstream) {
      return { ahead: 0, behind: 0, upstream: '' };
    }
    const counts = await runGit(['rev-list', '--left-right', '--count', `HEAD...${upstream}`], root);
    const [aheadStr, behindStr] = counts.trim().split(/\s+/);
    return {
      ahead: parseInt(aheadStr || '0', 10) || 0,
      behind: parseInt(behindStr || '0', 10) || 0,
      upstream,
    };
  } catch {
    return { ahead: 0, behind: 0, upstream: '' };
  }
}

