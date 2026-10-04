import { spawn } from 'node:child_process';
import { getRepoState } from './git.js';
import { notifier } from './notifier.js';
import { logger } from '../utils/logger.js';

export interface WatchedProcess {
  pid: number;
  repoPath: string;
  name: string;
  startedAt: Date;
}

export class ProcessTracker {
  private trackedPids = new Map<number, WatchedProcess>();
  private pollTimer: NodeJS.Timeout | null = null;

  /**
   * Checks if a process with given PID is still active
   */
  isProcessAlive(pid: number): boolean {
    try {
      // process.kill with signal 0 checks for process existence without killing it
      process.kill(pid, 0);
      return true;
    } catch (err: unknown) {
      const error = err as { code?: string };
      // ESRCH means process does not exist (it has terminated)
      return error.code === 'EPERM'; // EPERM means it exists but we don't have permission; ESRCH means dead
    }
  }

  /**
   * Registers a PID to watch. When the process terminates, triggers project close check.
   */
  watchPid(pid: number, repoPath: string, processName = 'Editor'): void {
    if (this.trackedPids.has(pid)) return;

    this.trackedPids.set(pid, {
      pid,
      repoPath,
      name: processName,
      startedAt: new Date(),
    });

    logger.info(`Started tracking process ${processName} (PID: ${pid}) for ${repoPath}`);
    this.ensurePolling();
  }

  private ensurePolling(): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(async () => {
      if (this.trackedPids.size === 0) {
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        return;
      }

      for (const [pid, info] of Array.from(this.trackedPids.entries())) {
        if (!this.isProcessAlive(pid)) {
          this.trackedPids.delete(pid);
          logger.info(`Tracked process ${info.name} (PID: ${pid}) exited. Evaluating git state...`);
          await this.handleProcessExit(info);
        }
      }
    }, 3000);
  }

  private async handleProcessExit(info: WatchedProcess): Promise<void> {
    try {
      const state = await getRepoState(info.repoPath);
      if (state.isDirty) {
        logger.info(`Project ${state.name} closed with uncommitted changes! Sending reminder.`);
        await notifier.notify({
          trigger: 'close',
          title: 'GitRemind: Proje Kapatıldı!',
          subtitle: `Repo: ${state.name} (${state.branch})`,
          message: `⚠️ Projeyi kapattınız fakat ${state.summary.total} dosya commit edilmedi!`,
          repoName: state.name,
          repoPath: state.rootPath,
          branch: state.branch,
          fileCount: state.summary.total,
          filesPreview: state.files.map((f) => f.path),
        });
      } else {
        logger.info(`Project ${state.name} closed with clean git working tree.`);
      }
    } catch (err) {
      logger.error('Error checking git state on process exit', err);
    }
  }

  /**
   * Spawns an editor/command session and monitors until exit
   */
  async runSession(command: string, args: string[], repoPath: string): Promise<number> {
    logger.info(`Starting interactive session: ${command} ${args.join(' ')} in ${repoPath}`);

    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: repoPath,
        stdio: 'inherit',
        shell: true,
      });

      child.on('close', async (code: number | null) => {
        logger.info(`Session process ${command} exited with code ${code}`);
        const state = await getRepoState(repoPath);

        if (state.isDirty) {
          await notifier.notify({
            trigger: 'close',
            title: 'GitRemind: Proje Kapatıldı!',
            subtitle: `Repo: ${state.name} (${state.branch})`,
            message: `⚠️ Projeyi kapattınız fakat ${state.summary.total} dosya commit edilmedi!`,
            repoName: state.name,
            repoPath: state.rootPath,
            branch: state.branch,
            fileCount: state.summary.total,
            filesPreview: state.files.map((f) => f.path),
          });

          console.log('\n\x1b[33m%s\x1b[0m', '═══════════════════════════════════════════════════════');
          console.log('\x1b[1;33m%s\x1b[0m', ' ⚠️  GitRemind Hatırlatması: Değişiklikler Commit Edilmedi!');
          console.log('\x1b[33m%s\x1b[0m', ` Repo: ${state.name} | Dal: ${state.branch}`);
          console.log('\x1b[33m%s\x1b[0m', ` Değiştirilen Dosya Sayısı: ${state.summary.total}`);
          console.log('\x1b[33m%s\x1b[0m', '═══════════════════════════════════════════════════════\n');
        }

        resolve(code ?? 0);
      });

      child.on('error', (err: Error) => {
        logger.error(`Session error: ${err.message}`);
        resolve(1);
      });
    });
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.trackedPids.clear();
  }
}

export const processTracker = new ProcessTracker();
