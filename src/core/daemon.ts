import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { RepoWatcher } from './watcher.js';
import { configManager } from './config.js';
import { getPidPath } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { DaemonStatus } from './types.js';
import { normalizeRepoPath } from '../utils/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class GitRemindDaemon {
  private watchers = new Map<string, RepoWatcher>();
  private isRunning = false;
  private startedAt: Date | null = null;
  private configPollTimer: NodeJS.Timeout | null = null;

  /**
   * Checks if daemon process is currently running
   */
  static isRunning(): { running: boolean; pid?: number } {
    const pidPath = getPidPath();
    if (!fs.existsSync(pidPath)) {
      return { running: false };
    }

    try {
      const pidStr = fs.readFileSync(pidPath, 'utf8').trim();
      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) {
        return { running: false };
      }

      // Check if process is alive
      try {
        process.kill(pid, 0);
        return { running: true, pid };
      } catch (e: unknown) {
        const err = e as { code?: string };
        if (err.code === 'EPERM') {
          return { running: true, pid };
        }
        // Dead PID file left over, cleanup
        try {
          fs.unlinkSync(pidPath);
        } catch {
          // ignore
        }
        return { running: false };
      }
    } catch {
      return { running: false };
    }
  }

  /**
   * Launches daemon as a detached background process
   */
  static spawnBackground(entryPath: string): { success: boolean; pid?: number; message: string } {
    const current = GitRemindDaemon.isRunning();
    if (current.running) {
      return {
        success: false,
        pid: current.pid,
        message: `GitRemind background service is already running (PID: ${current.pid}).`,
      };
    }

    try {
      // On Windows, use run-hidden.vbs to launch fully detached from console
      if (process.platform === 'win32') {
        const vbsCandidates = [
          path.resolve(__dirname, '../../scripts/run-hidden.vbs'),
          path.resolve(__dirname, '../scripts/run-hidden.vbs'),
          path.resolve(process.cwd(), 'scripts/run-hidden.vbs'),
        ];
        const vbsPath = vbsCandidates.find((p) => fs.existsSync(p));
        if (vbsPath) {
          logger.info('Spawning background daemon via WScript', { vbsPath, execPath: process.execPath, entryPath });
          const child = spawn('wscript.exe', [vbsPath, process.execPath, entryPath, 'daemon', 'run'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          });
          child.unref();

          return {
            success: true,
            message: 'GitRemind service started in background.',
          };
        }
      }

      const outLog = path.join(getPidPath(), '../daemon.stdout.log');
      const outFd = fs.openSync(outLog, 'a');
      logger.info('Spawning background daemon', { execPath: process.execPath, entryPath });
      const child = spawn(process.execPath, [entryPath, 'daemon', 'run'], {
        detached: true,
        stdio: ['ignore', outFd, outFd],
        windowsHide: true,
      });

      child.unref();

      return {
        success: true,
        pid: child.pid,
        message: `GitRemind service started in background (PID: ${child.pid}).`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Failed to start service: ${msg}`,
      };
    }
  }

  /**
   * Ensures the background daemon is active, automatically starting it if stopped
   */
  static async ensureRunning(entryPath: string): Promise<{ running: boolean; pid?: number }> {
    const status = GitRemindDaemon.isRunning();
    if (status.running) {
      return status;
    }

    GitRemindDaemon.spawnBackground(entryPath);
    // Poll up to 1200ms for PID file initialization
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const check = GitRemindDaemon.isRunning();
      if (check.running) {
        return check;
      }
    }
    return GitRemindDaemon.isRunning();
  }

  /**
   * Starts the daemon engine in current process (used when running in daemon mode)
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startedAt = new Date();

    logger.setSilentConsole(true);
    logger.info(`GitRemind daemon starting with PID ${process.pid}`);

    // Write PID file
    fs.writeFileSync(getPidPath(), String(process.pid), 'utf8');

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception in daemon process', err);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection in daemon process', reason);
    });

    // Setup graceful exit
    const cleanup = async (signal: string) => {
      logger.info(`Daemon received shutdown signal: ${signal}`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => cleanup('SIGINT'));
    process.on('SIGTERM', () => cleanup('SIGTERM'));
    process.on('exit', (code) => {
      logger.info(`Daemon process.on('exit') fired with code: ${code}`);
      try {
        const pidPath = getPidPath();
        if (fs.existsSync(pidPath)) {
          const content = fs.readFileSync(pidPath, 'utf8').trim();
          if (content === String(process.pid)) {
            fs.unlinkSync(pidPath);
          }
        }
      } catch {
        // ignore
      }
    });

    // Check for repo list changes every 10 seconds (keeps event loop continuously active)
    this.configPollTimer = setInterval(async () => {
      await this.syncWatchers();
    }, 10 * 1000);

    // Initial sync
    await this.syncWatchers();
  }

  /**
   * Synchronizes active watchers with config repos
   */
  private async syncWatchers(): Promise<void> {
    const config = configManager.load();
    const configPaths = new Set(config.watchedRepos.map((r) => normalizeRepoPath(r.path)));

    // 1. Remove watchers that are no longer in config
    for (const [watchedPath, watcher] of Array.from(this.watchers.entries())) {
      if (!configPaths.has(watchedPath)) {
        logger.info(`Detaching watcher for removed repo: ${watchedPath}`);
        await watcher.stop();
        this.watchers.delete(watchedPath);
      }
    }

    // 2. Add watchers for new repos
    for (const repoConfig of config.watchedRepos) {
      const norm = normalizeRepoPath(repoConfig.path);
      if (!this.watchers.has(norm)) {
        if (fs.existsSync(norm)) {
          logger.info(`Attaching watcher for configured repo: ${repoConfig.name} (${norm})`);
          const watcher = new RepoWatcher(norm, config);
          this.watchers.set(norm, watcher);
          await watcher.start();
        } else {
          logger.warn(`Configured repo directory does not exist: ${norm}`);
        }
      }
    }
  }

  /**
   * Stops the daemon and all active watchers
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.configPollTimer) {
      clearInterval(this.configPollTimer);
      this.configPollTimer = null;
    }

    for (const watcher of this.watchers.values()) {
      await watcher.stop();
    }
    this.watchers.clear();

    const pidPath = getPidPath();
    if (fs.existsSync(pidPath)) {
      try {
        fs.unlinkSync(pidPath);
      } catch {
        // ignore
      }
    }

    logger.info('GitRemind daemon successfully stopped.');
  }

  getStatus(): DaemonStatus {
    const isAlive = GitRemindDaemon.isRunning();
    const config = configManager.load();

    let dirtyCount = 0;
    for (const watcher of this.watchers.values()) {
      if (watcher.getStats().isDirty) {
        dirtyCount++;
      }
    }

    const uptimeSeconds = this.startedAt
      ? Math.floor((Date.now() - this.startedAt.getTime()) / 1000)
      : undefined;

    return {
      running: isAlive.running,
      pid: isAlive.pid,
      startedAt: this.startedAt?.toISOString(),
      uptimeSeconds,
      watchedCount: config.watchedRepos.length,
      dirtyCount,
    };
  }
}

export const daemon = new GitRemindDaemon();
