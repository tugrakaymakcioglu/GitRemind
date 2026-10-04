export type FileChangeKind =
  | 'modified'
  | 'staged'
  | 'untracked'
  | 'deleted'
  | 'renamed'
  | 'conflicted';

export interface GitFileStatus {
  path: string;
  kind: FileChangeKind;
  staged: boolean;
  rawStatus: string;
}

export interface GitRepoSummary {
  modified: number;
  untracked: number;
  staged: number;
  deleted: number;
  total: number;
}

export interface GitRepoState {
  isGitRepo: boolean;
  rootPath: string;
  name: string;
  branch: string;
  isDirty: boolean;
  files: GitFileStatus[];
  summary: GitRepoSummary;
  lastCommitTime: Date | null;
  lastCommitRelative: string;
  lastCommitHash: string;
  lastCommitMessage: string;
  firstDirtyTime?: Date | null;
  firstDirtyRelative?: string;
  error?: string;
}

export interface CommitOptions {
  files?: string[];
  message: string;
  repoPath?: string;
}

export interface CommitResult {
  success: boolean;
  hash?: string;
  message?: string;
  commitHash?: string;
  commitMessage?: string;
  filesCommitted?: number;
  relativeTime?: string;
  error?: string;
}

export interface WatchedRepoConfig {
  path: string;
  name: string;
  addedAt: string;
  lastNotifiedAt?: string;
  lastSeenDirtyAt?: string;
  lastFileCount?: number;
}

export interface QuietHoursConfig {
  enabled: boolean;
  start: string; // e.g. "23:00"
  end: string;   // e.g. "08:00"
}

export interface GitRemindConfig {
  version: number;
  intervalMinutes: number;
  notifyOnClose: boolean;
  sound: boolean;
  language: 'en' | 'tr';
  watchedRepos: WatchedRepoConfig[];
  ignorePatterns: string[];
  ideProcesses: string[];
  quietHours: QuietHoursConfig;
}

export type NotificationTrigger = 'interval' | 'close' | 'idle' | 'manual' | 'test';

export interface NotificationPayload {
  trigger: NotificationTrigger;
  title: string;
  subtitle?: string;
  message: string;
  repoName?: string;
  repoPath?: string;
  branch?: string;
  fileCount?: number;
  filesPreview?: string[];
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  startedAt?: string;
  uptimeSeconds?: number;
  watchedCount: number;
  dirtyCount: number;
}
