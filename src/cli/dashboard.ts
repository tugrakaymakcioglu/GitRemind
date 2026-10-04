import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { getRepoState, getRepoRoot } from '../core/git.js';
import { configManager } from '../core/config.js';
import { GitRemindDaemon } from '../core/daemon.js';
import { notifier } from '../core/notifier.js';
import { GitRepoState, WatchedRepoConfig } from '../core/types.js';
import { normalizeRepoPath } from '../utils/paths.js';
import {
  clearScreen,
  hideCursor,
  showCursor,
  renderHeader,
  renderBox,
  renderActionBar,
  formatBadge,
  formatDaemonPill,
  formatStatusPill,
  visibleLength,
  pad,
} from './tui.js';
import { runCommitWizard } from './commit-wizard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DashboardApp {
  private selectedIndex = 0;
  private repos: GitRepoState[] = [];
  private flashMessage = '';
  private flashTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isInteracting = false;
  private autoRefreshSeconds = 4;
  private userNavigated = false;
  private currentCwdRoot: string | null = null;

  /**
   * Resolves entry script path for background daemon
   */
  private getEntryPath(): string {
    const isTs = __filename.endsWith('.ts');
    const cand1 = path.resolve(__dirname, isTs ? 'index.ts' : 'index.js');
    if (fs.existsSync(cand1)) return cand1;

    const cand2 = path.resolve(process.cwd(), isTs ? 'src/cli/index.ts' : 'dist/cli/index.js');
    if (fs.existsSync(cand2)) return cand2;

    return __filename;
  }

  /**
   * Displays temporary status message in dashboard
   */
  private setFlash(msg: string, timeoutMs = 3500): void {
    this.flashMessage = msg;
    if (this.flashTimer) {
      clearTimeout(this.flashTimer);
    }
    this.flashTimer = setTimeout(() => {
      this.flashMessage = '';
      if (this.isRunning && !this.isInteracting) {
        this.render();
      }
    }, timeoutMs);
  }

  /**
   * Loads all repository states with automatic zero-touch Git repo detection and enrollment
   */
  private async loadState(): Promise<void> {
    const config = configManager.load();

    // 1. Automatic Zero-Touch Detection: check if current working directory is a Git repository
    this.currentCwdRoot = await getRepoRoot(process.cwd());
    if (this.currentCwdRoot) {
      const normalizedCurrent = normalizeRepoPath(this.currentCwdRoot);
      const isAlreadyWatched = config.watchedRepos.some(
        (r) => normalizeRepoPath(r.path).toLowerCase() === normalizedCurrent.toLowerCase()
      );

      if (!isAlreadyWatched) {
        const addResult = await configManager.addRepo(normalizedCurrent);
        if (addResult.success) {
          this.setFlash(
            pc.green(`⚡ Auto-detected Git repo! Enrolled "${path.basename(normalizedCurrent)}" into GitRemind.`),
            4500
          );
        }
      }
    }

    // 2. Read refreshed configuration
    const freshConfig = configManager.load();
    const loadedStates: GitRepoState[] = [];

    for (const w of freshConfig.watchedRepos) {
      if (fs.existsSync(w.path)) {
        try {
          const state = await getRepoState(w.path);
          loadedStates.push(state);
        } catch {
          // ignore corrupted or unreadable path
        }
      }
    }

    this.repos = loadedStates;

    // 3. Focus active repository: if standing in a git repo, auto-focus it
    if (this.currentCwdRoot && !this.userNavigated) {
      const normCurrent = normalizeRepoPath(this.currentCwdRoot).toLowerCase();
      const currentIdx = this.repos.findIndex(
        (r) => normalizeRepoPath(r.rootPath).toLowerCase() === normCurrent
      );
      if (currentIdx !== -1) {
        this.selectedIndex = currentIdx;
      }
    }

    // Bounds check on selected index
    if (this.selectedIndex >= this.repos.length) {
      this.selectedIndex = Math.max(0, this.repos.length - 1);
    }
  }

  /**
   * Renders the complete dashboard to the terminal
   */
  public render(): void {
    if (this.isInteracting) return;

    const termWidth = Math.min(Math.max(process.stdout.columns || 80, 80), 96);
    const innerWidth = termWidth - 4;
    const daemonInfo = GitRemindDaemon.isRunning();
    const config = configManager.load();

    clearScreen();

    // 1. Header Banner
    console.log(renderHeader(termWidth));
    console.log('');

    // 2. Live Status Box
    const dirtyCount = this.repos.filter((r) => r.isDirty).length;
    const quietStr = config.quietHours.enabled
      ? `${config.quietHours.start}-${config.quietHours.end}`
      : 'Disabled';

    const statusLine1 = `  Daemon       : ${formatDaemonPill(daemonInfo.running, daemonInfo.pid)}      Watch Interval : ${pc.cyan(`${config.intervalMinutes} min`)}`;
    const statusLine2 = `  Watched Repos: ${pc.bold(pc.white(String(config.watchedRepos.length)))} (${dirtyCount > 0 ? pc.yellow(`${dirtyCount} dirty`) : pc.green('all clean')})     Quiet Hours    : ${pc.dim(quietStr)}`;

    console.log(
      renderBox({
        title: 'Live System Status',
        lines: [statusLine1, statusLine2],
        width: termWidth,
        borderColor: pc.cyan,
      })
    );
    console.log('');

    // 3. Repositories List Box
    const repoLines: string[] = [];
    if (this.repos.length === 0) {
      repoLines.push(pc.gray('  No git repositories found. Navigate to a Git repo to auto-enroll, or press [w].'));
    } else {
      this.repos.forEach((repo, idx) => {
        const isSelected = idx === this.selectedIndex;
        const isCurrent = this.currentCwdRoot &&
          normalizeRepoPath(repo.rootPath).toLowerCase() === normalizeRepoPath(this.currentCwdRoot).toLowerCase();

        const pointer = isSelected ? pc.bold(pc.cyan('▸ ')) : '  ';
        const num = pc.gray(`[${idx + 1}] `);

        const currentTag = isCurrent ? pc.cyan('★ ') : '';
        const rawName = currentTag + repo.name;
        const nameStr = isSelected
          ? pc.bold(pc.white(rawName.padEnd(20)))
          : pc.white(rawName.padEnd(20));

        const branchStr = pc.magenta(`(${repo.branch || 'HEAD'})`.padEnd(16));
        const pill = formatStatusPill(repo.isDirty, repo.summary.total);

        repoLines.push(`${pointer}${num}${nameStr} ${branchStr} ${pill}`);
      });
    }

    console.log(
      renderBox({
        title: `Watched Repositories (${this.repos.length}) [Navigate: ↑ / ↓]`,
        lines: repoLines,
        width: termWidth,
        borderColor: pc.blue,
      })
    );
    console.log('');

    // 4. Active Repository Details Box
    const active = this.repos[this.selectedIndex];
    if (active) {
      const detailsLines: string[] = [];

      // Truncate path safely if too long
      const maxPathLen = Math.max(15, innerWidth - active.name.length - 22);
      const safePath = active.rootPath.length > maxPathLen
        ? '...' + active.rootPath.slice(-(maxPathLen - 3))
        : active.rootPath;

      detailsLines.push(
        `  ${pc.bold('Repository')}  : ${pc.bold(pc.cyan(active.name))}  ${pc.gray(`[${safePath}]`)}`
      );
      detailsLines.push(`  ${pc.bold('Branch')}      : ${pc.magenta(active.branch || 'unknown')}`);

      // Safe commit message truncation so box right border never overflows
      const maxMsgLen = Math.max(15, innerWidth - 36);
      const safeMsg = active.lastCommitMessage
        ? (active.lastCommitMessage.length > maxMsgLen
            ? active.lastCommitMessage.slice(0, maxMsgLen - 3) + '...'
            : active.lastCommitMessage)
        : 'Waiting for initial commit';

      const lastCommitText = active.lastCommitHash
        ? `${pc.yellow(active.lastCommitHash)} ${pc.white(`"${safeMsg}"`)} ${pc.dim(`(${active.lastCommitRelative})`)}`
        : pc.dim(active.lastCommitRelative || 'No commits yet');

      detailsLines.push(`  ${pc.bold('Last Commit')} : ${lastCommitText}`);

      if (active.isDirty) {
        const firstChangeStr = active.firstDirtyRelative
          ? pc.yellow(`${active.firstDirtyRelative}`)
          : pc.dim('Recently');
        detailsLines.push(`  ${pc.bold('Uncommitted')} : ${pc.bold(pc.yellow(`Active for ${firstChangeStr}`))}`);
        detailsLines.push(
          `  ${pc.bold('Summary')}     : ${pc.yellow(`${active.summary.modified} modified`)}, ${pc.green(`${active.summary.untracked} untracked`)}, ${pc.cyan(`${active.summary.staged} staged`)}, ${pc.red(`${active.summary.deleted} deleted`)}`
        );
        detailsLines.push('');
        detailsLines.push(pc.bold('  Pending Changed Files:'));

        const previewFiles = active.files.slice(0, 7);
        for (const file of previewFiles) {
          const badge = formatBadge(file.kind);
          const stagedMark = file.staged ? pc.green(' [staged]') : '';
          detailsLines.push(`    ${badge}  ${file.path}${stagedMark}`);
        }
        if (active.files.length > 7) {
          detailsLines.push(pc.dim(`    ... and ${active.files.length - 7} more files`));
        }
      } else {
        detailsLines.push(`  ${pc.bold('Status')}      : ${pc.green('✔  Working directory is clean. No pending changes.')}`);
      }

      console.log(
        renderBox({
          title: `Active Repository Details: ${active.name}`,
          lines: detailsLines,
          width: termWidth,
          borderColor: active.isDirty ? pc.yellow : pc.green,
        })
      );
    }
    console.log('');

    // 5. Flash Message / Toast Line
    if (this.flashMessage) {
      console.log(`  ${pc.bold(pc.yellow('⚡ [Action]'))} ${this.flashMessage}`);
    } else {
      console.log(`  ${pc.dim(`⚡ Auto-refreshing every ${this.autoRefreshSeconds}s. Press [r] to refresh now.`)}`);
    }
    console.log('');

    // 6. Action Hotkeys Bar
    console.log(
      renderActionBar([
        { key: 'c', label: 'Commit' },
        { key: 'd', label: 'Diff' },
        { key: 'o', label: 'Open' },
        { key: 'w', label: 'Watch' },
        { key: 'u', label: 'Unwatch' },
        { key: 's', label: 'Daemon' },
        { key: 'n', label: 'Notify' },
        { key: 'r', label: 'Refresh' },
        { key: 'q', label: 'Exit' },
      ])
    );
  }

  /**
   * Handles user keypress input
   */
  private async handleKey(str: string, key?: readline.Key): Promise<void> {
    if (this.isInteracting) return;

    // Quit commands: [q] or [Ctrl+C]
    if (str === 'q' || str === 'Q' || (key && key.ctrl && key.name === 'c')) {
      await this.stop();
      process.exit(0);
      return;
    }

    // Navigation: Up / k
    if ((key && key.name === 'up') || str === 'k') {
      if (this.repos.length > 0) {
        this.userNavigated = true;
        this.selectedIndex = (this.selectedIndex - 1 + this.repos.length) % this.repos.length;
        this.render();
      }
      return;
    }

    // Navigation: Down / j / tab
    if ((key && key.name === 'down') || str === 'j' || (key && key.name === 'tab')) {
      if (this.repos.length > 0) {
        this.userNavigated = true;
        this.selectedIndex = (this.selectedIndex + 1) % this.repos.length;
        this.render();
      }
      return;
    }

    // Refresh immediately: [r]
    if (str === 'r' || str === 'R') {
      await this.loadState();
      this.setFlash(pc.cyan('Refreshed repository statuses.'));
      this.render();
      return;
    }

    // Commit Wizard: [c] or [m]
    if (str === 'c' || str === 'C' || str === 'm' || str === 'M') {
      const active = this.repos[this.selectedIndex];
      if (!active) {
        this.setFlash(pc.red('No active repository selected.'));
        return;
      }

      if (!active.isDirty) {
        this.setFlash(pc.green(`Repository "${active.name}" is already clean! Nothing to commit.`));
        return;
      }

      // Enter interactive wizard
      this.isInteracting = true;
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
      showCursor();

      clearScreen();
      await runCommitWizard(active.rootPath);

      // Return to dashboard
      console.log(pc.gray('\nPress any key to return to dashboard...'));
      await new Promise<void>((resolve) => {
        const resumeHandler = () => {
          process.stdin.removeListener('data', resumeHandler);
          resolve();
        };
        process.stdin.once('data', resumeHandler);
      });

      this.isInteracting = false;
      hideCursor();
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
      }

      await this.loadState();
      this.startRefreshTimer();
      this.render();
      return;
    }

    // Diff preview: [d]
    if (str === 'd' || str === 'D') {
      const active = this.repos[this.selectedIndex];
      if (!active || !active.isDirty) {
        this.setFlash(pc.yellow('No pending uncommitted changes to diff.'));
        return;
      }

      this.isInteracting = true;
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
      showCursor();
      clearScreen();

      console.log(pc.bold(pc.cyan(`\n🔍 Git Diff Summary: ${active.name} (${active.branch})\n`)));
      try {
        const statusShort = execSync('git status -s', { cwd: active.rootPath }).toString();
        const diffStat = execSync('git diff --stat', { cwd: active.rootPath }).toString();
        console.log(pc.bold('Changed Files:'));
        console.log(statusShort.trim() || pc.gray('No unstaged changes.'));
        console.log(pc.bold('\nDiff Statistics:'));
        console.log(diffStat.trim() || pc.gray('No tracked changes.'));
      } catch {
        console.log(pc.red('Could not fetch git diff statistics.'));
      }

      console.log(pc.gray('\nPress any key to return to dashboard...'));
      await new Promise<void>((resolve) => {
        const resumeHandler = () => {
          process.stdin.removeListener('data', resumeHandler);
          resolve();
        };
        process.stdin.once('data', resumeHandler);
      });

      this.isInteracting = false;
      hideCursor();
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
      }

      this.startRefreshTimer();
      this.render();
      return;
    }

    // Open active repository in editor: [o]
    if (str === 'o' || str === 'O') {
      const active = this.repos[this.selectedIndex];
      if (!active) {
        this.setFlash(pc.red('No repository to open.'));
        return;
      }

      try {
        const editorCmd = process.env.EDITOR || (process.platform === 'win32' ? 'code.cmd' : 'code');
        const child = spawn(editorCmd, ['.'], {
          cwd: active.rootPath,
          detached: true,
          stdio: 'ignore',
          shell: true,
        });
        child.unref();
        this.setFlash(pc.green(`🚀 Launched editor for "${active.name}".`));
      } catch {
        this.setFlash(pc.yellow(`Could not open editor. Try running: gitremind open code .`));
      }
      this.render();
      return;
    }

    // Watch repo: [w]
    if (str === 'w' || str === 'W') {
      const targetDir = this.repos[this.selectedIndex]?.rootPath || process.cwd();
      const res = await configManager.addRepo(targetDir);
      if (res.success) {
        this.setFlash(pc.green(`✔ ${res.message}`));
      } else {
        this.setFlash(pc.yellow(`ℹ ${res.message}`));
      }
      await this.loadState();
      this.render();
      return;
    }

    // Unwatch repo: [u]
    if (str === 'u' || str === 'U') {
      const active = this.repos[this.selectedIndex];
      if (!active) {
        this.setFlash(pc.red('No repository to unwatch.'));
        return;
      }

      const res = configManager.removeRepo(active.rootPath);
      if (res.success) {
        this.setFlash(pc.green(`✔ Removed "${active.name}" from watch list.`));
      } else {
        this.setFlash(pc.yellow(`ℹ ${res.message}`));
      }
      await this.loadState();
      this.render();
      return;
    }

    // Toggle daemon: [s]
    if (str === 's' || str === 'S') {
      const current = GitRemindDaemon.isRunning();
      if (current.running && current.pid) {
        try {
          process.kill(current.pid, 'SIGTERM');
          this.setFlash(pc.green(`✔ Background daemon (PID: ${current.pid}) stopped.`));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.setFlash(pc.red(`✖ Failed to stop daemon: ${msg}`));
        }
      } else {
        const entryPath = this.getEntryPath();
        const spawnRes = GitRemindDaemon.spawnBackground(entryPath);
        if (spawnRes.success) {
          this.setFlash(pc.green(`✔ Background daemon started (PID: ${spawnRes.pid || 'active'}).`));
        } else {
          this.setFlash(pc.red(`✖ ${spawnRes.message}`));
        }
      }
      this.render();
      return;
    }

    // Test notification: [n]
    if (str === 'n' || str === 'N') {
      this.setFlash(pc.cyan('Sending test desktop notification...'));
      this.render();
      const sent = await notifier.notify({
        trigger: 'test',
        title: 'GitRemind Notification',
        subtitle: 'Desktop Alert Service',
        message: 'GitRemind dashboard notification test succeeded!',
      });
      if (sent) {
        this.setFlash(pc.green('✔ Desktop notification sent successfully.'));
      } else {
        this.setFlash(pc.yellow('ℹ Test notification triggered.'));
      }
      this.render();
      return;
    }
  }

  /**
   * Starts periodic background state reload
   */
  private startRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.refreshTimer = setInterval(async () => {
      if (!this.isInteracting && this.isRunning) {
        await this.loadState();
        this.render();
      }
    }, this.autoRefreshSeconds * 1000);
  }

  /**
   * Starts the dashboard application
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Ensure background daemon is running silently so monitoring is always active
    await GitRemindDaemon.ensureRunning(this.getEntryPath());

    await this.loadState();

    if (!process.stdin.isTTY) {
      // Non-interactive fallback (e.g. CI or piped stdout)
      this.render();
      console.log(pc.yellow('\nNotice: Non-interactive terminal environment detected. Exiting dashboard.\n'));
      return;
    }

    hideCursor();
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    }

    const keyListener = (str: string, key: readline.Key) => {
      this.handleKey(str, key).catch((err) => {
        this.setFlash(pc.red(`Error: ${err.message}`));
        this.render();
      });
    };

    process.stdin.on('keypress', keyListener);

    this.startRefreshTimer();
    this.render();

    // Clean exit handlers
    const onExit = () => {
      this.stop();
      process.exit(0);
    };

    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);
  }

  /**
   * Stops dashboard and restores terminal settings
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.flashTimer) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
    showCursor();
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
  }
}

export async function startDashboard(): Promise<void> {
  const app = new DashboardApp();
  await app.start();
}
