import { watch, FSWatcher } from 'chokidar';
import { getRepoState } from './git.js';
import { GitRepoState, GitRemindConfig } from './types.js';
import { notifier } from './notifier.js';
import { configManager } from './config.js';
import { logger } from '../utils/logger.js';

export interface WatcherStats {
  repoPath: string;
  isDirty: boolean;
  fileCount: number;
  firstDirtyAt: Date | null;
  lastNotifiedAt: Date | null;
  lastCheckedAt: Date;
}

export class RepoWatcher {
  private fsWatcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private intervalCheckTimer: NodeJS.Timeout | null = null;
  private isDirty = false;
  private firstDirtyAt: Date | null = null;
  private lastNotifiedAt: Date | null = null;
  private lastCheckedAt: Date = new Date();
  private currentState: GitRepoState | null = null;
  private isRunning = false;

  constructor(
    public readonly repoPath: string,
    private config: GitRemindConfig
  ) {}

  /**
   * Starts watching the repository files and periodically checking interval
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info(`Starting watcher for repository: ${this.repoPath}`);

    // Initial check
    await this.evaluateGitState();

    // Setup file watcher
    try {
      this.fsWatcher = watch(this.repoPath, {
        ignored: this.config.ignorePatterns,
        ignoreInitial: true,
        persistent: true,
        awaitWriteFinish: {
          stabilityThreshold: 1000,
          pollInterval: 200,
        },
      });

      this.fsWatcher.on('all', (event: string, filePath: string) => {
        logger.debug(`File event [${event}] on ${filePath}`);
        this.queueEvaluation();
      });

      this.fsWatcher.on('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`FSWatcher error on ${this.repoPath}: ${msg}`);
      });
    } catch (err) {
      logger.error(`Failed to initialize FSWatcher for ${this.repoPath}`, err);
    }

    // Interval reminder runner: checks every 60 seconds if repo is dirty and interval reached
    this.intervalCheckTimer = setInterval(() => {
      this.checkIntervalReminder();
    }, 60 * 1000);
  }

  /**
   * Queues an evaluation with debounce to prevent spamming during multi-file builds
   */
  private queueEvaluation(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(async () => {
      await this.evaluateGitState();
    }, 2500);
  }

  /**
   * Evaluates current git status of repository
   */
  async evaluateGitState(): Promise<GitRepoState> {
    const state = await getRepoState(this.repoPath);
    this.currentState = state;
    this.lastCheckedAt = new Date();

    if (!state.isGitRepo) {
      this.isDirty = false;
      return state;
    }

    if (state.isDirty) {
      if (!this.isDirty) {
        // Just became dirty!
        this.isDirty = true;
        this.firstDirtyAt = new Date();
        logger.info(`Repo "${state.name}" is now DIRTY (${state.summary.total} uncommitted files).`);
      } else {
        logger.debug(`Repo "${state.name}" still dirty (${state.summary.total} files).`);
      }

      configManager.updateRepoState(this.repoPath, {
        lastSeenDirtyAt: this.firstDirtyAt?.toISOString(),
        lastFileCount: state.summary.total,
      });
    } else {
      if (this.isDirty) {
        // Just became clean (committed or stashed/discarded)!
        this.isDirty = false;
        this.firstDirtyAt = null;
        this.lastNotifiedAt = null;
        logger.info(`Repo "${state.name}" is now CLEAN. All changes committed.`);
        configManager.updateRepoState(this.repoPath, {
          lastSeenDirtyAt: undefined,
          lastFileCount: 0,
        });
      }
    }

    return state;
  }

  /**
   * Checks if periodic reminder should be triggered
   */
  private async checkIntervalReminder(): Promise<void> {
    if (!this.isDirty || !this.currentState) return;

    // Refresh config
    this.config = configManager.load();
    const intervalMs = Math.max(1, this.config.intervalMinutes) * 60 * 1000;
    const now = Date.now();

    const baselineTime = this.lastNotifiedAt
      ? this.lastNotifiedAt.getTime()
      : (this.firstDirtyAt?.getTime() ?? now);

    const elapsed = now - baselineTime;

    if (elapsed >= intervalMs) {
      logger.info(`Interval threshold (${this.config.intervalMinutes}m) reached for dirty repo "${this.currentState.name}". Sending reminder.`);
      
      const fileNames = this.currentState.files.map((f) => f.path);

      await notifier.notify({
        trigger: 'interval',
        title: 'GitRemind: Uncommitted Changes!',
        subtitle: `Repo: ${this.currentState.name} (${this.currentState.branch})`,
        message: `💡 ${this.currentState.summary.total} uncommitted file(s) waiting in "${this.currentState.name}". Last commit: ${this.currentState.lastCommitRelative}`,
        repoName: this.currentState.name,
        repoPath: this.currentState.rootPath,
        branch: this.currentState.branch,
        fileCount: this.currentState.summary.total,
        filesPreview: fileNames,
      });

      this.lastNotifiedAt = new Date();
      configManager.updateRepoState(this.repoPath, {
        lastNotifiedAt: this.lastNotifiedAt.toISOString(),
      });
    }
  }

  /**
   * Triggers an immediate check and notification if dirty
   */
  async checkNow(notifyAnyway = false): Promise<GitRepoState> {
    const state = await this.evaluateGitState();
    if (state.isDirty || notifyAnyway) {
      const fileNames = state.files.map((f) => f.path);
      await notifier.notify({
        trigger: 'manual',
        title: 'GitRemind: Status Report',
        subtitle: `Repo: ${state.name} (${state.branch})`,
        message: state.isDirty
          ? `⚠️ You have ${state.summary.total} uncommitted file(s).`
          : '✅ All changes committed. Working tree clean.',
        repoName: state.name,
        repoPath: state.rootPath,
        branch: state.branch,
        fileCount: state.summary.total,
        filesPreview: fileNames,
      });
    }
    return state;
  }

  getStats(): WatcherStats {
    return {
      repoPath: this.repoPath,
      isDirty: this.isDirty,
      fileCount: this.currentState?.summary.total ?? 0,
      firstDirtyAt: this.firstDirtyAt,
      lastNotifiedAt: this.lastNotifiedAt,
      lastCheckedAt: this.lastCheckedAt,
    };
  }

  getCurrentState(): GitRepoState | null {
    return this.currentState;
  }

  /**
   * Stops the watcher and cleans up all timers
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.intervalCheckTimer) {
      clearInterval(this.intervalCheckTimer);
      this.intervalCheckTimer = null;
    }
    if (this.fsWatcher) {
      await this.fsWatcher.close();
      this.fsWatcher = null;
    }
    logger.info(`Stopped watcher for: ${this.repoPath}`);
  }
}
