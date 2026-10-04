import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import {
  getRepoState,
  getRepoRoot,
  getRecentCommits,
  getUpstreamStatus,
  CommitHistoryItem,
  UpstreamStatus,
} from '../core/git.js';
import { configManager } from '../core/config.js';
import { GitRemindDaemon } from '../core/daemon.js';
import { notifier } from '../core/notifier.js';
import { GitRepoState } from '../core/types.js';
import { normalizeRepoPath } from '../utils/paths.js';
import {
  clearScreen,
  hideCursor,
  showCursor,
  enterAlternateScreen,
  leaveAlternateScreen,
  writeFrame,
  renderBox,
  renderDualPaneBox,
  renderTelemetryBar,
  formatBadge,
  formatDaemonPill,
  formatStatusPill,
  visibleLength,
  pad,
  truncate,
  SPINNER_FRAMES,
  PULSE_FRAMES,
} from './tui.js';
import { runCommitWizard } from './commit-wizard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CachedRepoExtra {
  recentCommits: CommitHistoryItem[];
  upstream: UpstreamStatus;
}

export class DashboardApp {
  private selectedIndex = 0;
  private repos: GitRepoState[] = [];
  private repoExtras = new Map<string, CachedRepoExtra>();
  private flashMessage = '';
  private flashTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private animTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isInteracting = false;
  private autoRefreshSeconds = 4;
  private nextPollTimestamp = Date.now() + 4000;
  private userNavigated = false;
  private currentCwdRoot: string | null = null;

  // Animation frame indices
  private spinnerIndex = 0;
  private pulseIndex = 0;

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
        this.renderFrame();
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
            pc.green(`⚡ Auto-enrolled "${path.basename(normalizedCurrent)}" into GitRemind.`),
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

          // Fetch extra git telemetry (recent commits & upstream status)
          const [recentCommits, upstream] = await Promise.all([
            getRecentCommits(w.path, 3),
            getUpstreamStatus(w.path),
          ]);
          this.repoExtras.set(w.path, { recentCommits, upstream });
        } catch {
          // ignore corrupted or unreadable path
        }
      }
    }

    this.repos = loadedStates;

    // 3. Focus active repository: if standing in a git repo, auto-focus it on initial start
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

    this.nextPollTimestamp = Date.now() + this.autoRefreshSeconds * 1000;
  }

  /**
   * Generates the signature unified top status box
   */
  private buildTopBar(termWidth: number, daemonRunning: boolean, daemonPid?: number): string {
    const innerW = termWidth - 4;
    const pulseChar = PULSE_FRAMES[this.pulseIndex % PULSE_FRAMES.length];
    const spinnerChar = SPINNER_FRAMES[this.spinnerIndex % SPINNER_FRAMES.length];

    const now = new Date();
    const timeStr = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join(':');

    const countdownSec = Math.max(0, Math.ceil((this.nextPollTimestamp - Date.now()) / 1000));

    // Daemon pill
    const daemonTag = daemonRunning
      ? `${pc.bold(pc.green(pulseChar))} ${pc.bold(pc.white('DAEMON ACTIVE'))} ${pc.dim(`(PID: ${daemonPid || 'auto'})`)}`
      : `${pc.red('○')} ${pc.dim('DAEMON STOPPED')}`;

    const dirtyCount = this.repos.filter((r) => r.isDirty).length;
    const summaryTag = dirtyCount > 0
      ? `${pc.bold(pc.yellow(`▲ ${dirtyCount}/${this.repos.length} Dirty`))}`
      : `${pc.bold(pc.green(`● ${this.repos.length} Clean`))}`;

    const clockTag = `${pc.cyan(spinnerChar)} ${pc.dim(`Auto-poll ${countdownSec}s`)} │ ${pc.bold(pc.white(timeStr))}`;

    const leftGroup = `${daemonTag}  │  ${summaryTag}`;
    const rightGroup = clockTag;

    const leftLen = visibleLength(leftGroup);
    const rightLen = visibleLength(rightGroup);
    const gap = Math.max(2, innerW - leftLen - rightLen);

    const contentLine = leftGroup + ' '.repeat(gap) + rightGroup;

    return renderBox({
      title: 'GitRemind v1.0.0',
      lines: [contentLine],
      width: termWidth,
      borderColor: pc.cyan,
    });
  }

  /**
   * Builds the left repositories navigation list
   */
  private buildRepoListLines(innerW: number): string[] {
    const lines: string[] = [];

    if (this.repos.length === 0) {
      lines.push(pc.gray(' No repositories watched.'));
      lines.push(pc.dim(' Navigate to a Git project'));
      lines.push(pc.dim(' or press [w] to watch cwd.'));
      return lines;
    }

    this.repos.forEach((repo, idx) => {
      const isSelected = idx === this.selectedIndex;
      const isCurrent =
        this.currentCwdRoot &&
        normalizeRepoPath(repo.rootPath).toLowerCase() === normalizeRepoPath(this.currentCwdRoot).toLowerCase();

      const numBadge = pc.dim(`[${idx + 1}]`);
      const star = isCurrent ? pc.cyan(' ★') : '';
      const rawName = `${repo.name}`;
      const nameTrunc = truncate(rawName, innerW - 12);

      const statusBadge = repo.isDirty
        ? pc.bold(pc.yellow(`▲ ${repo.summary.total} uncommitted`))
        : pc.green('● clean');

      const branchStr = pc.magenta(`(${truncate(repo.branch || 'HEAD', 10)})`);

      if (isSelected) {
        lines.push(` ${pc.bold(pc.cyan('▸'))} ${pc.bold(pc.white(nameTrunc))}${star} ${numBadge}`);
        lines.push(`   ${branchStr} │ ${statusBadge}`);
      } else {
        lines.push(`   ${pc.white(nameTrunc)}${star} ${numBadge}`);
        lines.push(`   ${pc.dim(branchStr)} │ ${statusBadge}`);
      }

      if (idx < this.repos.length - 1) {
        lines.push('---DIVIDER---');
      }
    });

    return lines;
  }

  /**
   * Builds the right repository telemetry & inspector panel
   */
  private buildInspectorLines(innerW: number): string[] {
    const lines: string[] = [];
    const active = this.repos[this.selectedIndex];

    if (!active) {
      lines.push(pc.gray(' No repository selected.'));
      return lines;
    }

    const extra = this.repoExtras.get(active.rootPath) || {
      recentCommits: [],
      upstream: { ahead: 0, behind: 0, upstream: '' },
    };

    // 1. Repo header & location
    const safePath = truncate(active.rootPath, innerW - 10);
    lines.push(` ${pc.bold('Path   :')} ${pc.dim(safePath)}`);

    let upstreamInfo = pc.dim('(local only)');
    if (extra.upstream.upstream) {
      if (extra.upstream.ahead === 0 && extra.upstream.behind === 0) {
        upstreamInfo = pc.green(`synced with ${extra.upstream.upstream}`);
      } else {
        const aheadStr = extra.upstream.ahead > 0 ? pc.cyan(`↑${extra.upstream.ahead} ahead `) : '';
        const behindStr = extra.upstream.behind > 0 ? pc.red(`↓${extra.upstream.behind} behind`) : '';
        upstreamInfo = `${aheadStr}${behindStr} (${extra.upstream.upstream})`;
      }
    }

    lines.push(
      ` ${pc.bold('Branch :')} ${pc.magenta(`(${active.branch})`)}  ${pc.dim('│')}  ${pc.bold('Upstream:')} ${upstreamInfo}`
    );

    lines.push('---DIVIDER---');

    // 2. Visual Telemetry Bar & Breakdown
    const barWidth = Math.max(12, Math.min(24, innerW - 28));
    const telemetryBar = renderTelemetryBar(active.summary, barWidth);
    lines.push(` ${pc.bold('Telemetry :')} ${telemetryBar}`);

    const badgeStaged = pc.cyan(`● ${active.summary.staged} Staged`);
    const badgeModified = pc.yellow(`▲ ${active.summary.modified} Modified`);
    const badgeUntracked = pc.green(`+ ${active.summary.untracked} Untracked`);
    const badgeDeleted = pc.red(`- ${active.summary.deleted} Deleted`);

    const fullBadgeLine = ` ${badgeStaged}  │  ${badgeModified}  │  ${badgeUntracked}  │  ${badgeDeleted}`;
    if (visibleLength(fullBadgeLine) <= innerW) {
      lines.push(fullBadgeLine);
    } else {
      lines.push(` ${badgeStaged}  │  ${badgeModified}`);
      lines.push(` ${badgeUntracked}  │  ${badgeDeleted}`);
    }

    lines.push('---DIVIDER---');

    // 3. Uncommitted Changes List / Clean Status
    if (active.isDirty) {
      const activeAge = active.firstDirtyRelative ? ` (active for ${active.firstDirtyRelative})` : '';
      lines.push(
        ` ${pc.bold(pc.yellow('Uncommitted Files'))} ${pc.dim(`[${active.files.length} total]${activeAge}`)}:`
      );

      const maxFileRows = 5;
      const visibleFiles = active.files.slice(0, maxFileRows);
      for (const file of visibleFiles) {
        const badge = formatBadge(file.kind);
        const stagedTag = file.staged ? pc.green(' [staged]') : '';
        const filePath = truncate(file.path, innerW - 14);
        lines.push(`   ${badge} ${pc.white(filePath)}${stagedTag}`);
      }

      if (active.files.length > maxFileRows) {
        lines.push(pc.dim(`   ... and ${active.files.length - maxFileRows} more files`));
      }
    } else {
      lines.push(` ${pc.bold('Status    :')} ${pc.green('✔  Clean working tree. Everything is committed.')}`);
    }

    lines.push('---DIVIDER---');

    // 4. Recent Commits Timeline
    lines.push(` ${pc.bold(pc.cyan('Recent Commit Timeline:'))}`);
    if (extra.recentCommits.length > 0) {
      for (const c of extra.recentCommits) {
        const hash = pc.yellow(c.hash);
        const rel = pc.dim(`(${c.relativeTime})`);
        const msg = pc.white(truncate(c.message, innerW - c.hash.length - c.relativeTime.length - 10));
        lines.push(`   ${hash} ${rel} ${msg}`);
      }
    } else if (active.lastCommitHash) {
      const hash = pc.yellow(active.lastCommitHash);
      const rel = pc.dim(`(${active.lastCommitRelative})`);
      const msg = pc.white(truncate(active.lastCommitMessage, innerW - 22));
      lines.push(`   ${hash} ${rel} "${msg}"`);
    } else {
      lines.push(pc.dim('   Waiting for initial commit'));
    }

    return lines;
  }

  /**
   * Builds the bottom action dock and hotkey controls
   */
  private buildActionDock(termWidth: number): string {
    const actions = [
      { key: 'c', label: 'Commit' },
      { key: 'd', label: 'Diff' },
      { key: 'o', label: 'Editor' },
      { key: 'w', label: 'Watch' },
      { key: 'u', label: 'Unwatch' },
      { key: 's', label: 'Daemon' },
      { key: 'n', label: 'Notify' },
      { key: 'r', label: 'Refresh' },
      { key: 'q', label: 'Quit' },
    ];

    const innerW = termWidth - 4;
    const parts = actions.map(
      (a) => `${pc.bold(pc.cyan(`[${a.key}]`))} ${pc.white(a.label)}`
    );

    const singleLine = parts.join(pc.dim(' │ '));
    if (visibleLength(singleLine) <= innerW) {
      return renderBox({
        title: 'Action Dock',
        lines: [pad(singleLine, innerW, 'center')],
        width: termWidth,
        borderColor: pc.cyan,
      });
    }

    // 2-row layout for narrower screens so no keys are truncated
    const row1 = pad(parts.slice(0, 5).join(pc.dim(' │ ')), innerW, 'center');
    const row2 = pad(parts.slice(5).join(pc.dim(' │ ')), innerW, 'center');

    return renderBox({
      title: 'Action Dock',
      lines: [row1, row2],
      width: termWidth,
      borderColor: pc.cyan,
    });
  }

  /**
   * Builds complete frame buffer and writes atomically to terminal
   */
  public renderFrame(): void {
    if (this.isInteracting) return;

    const termCols = process.stdout.columns || 80;
    // Leave 2 columns safety buffer so Windows Terminal never auto-wraps or clips lines
    const termWidth = Math.max(76, Math.min(termCols - 2, 110));

    const daemonInfo = GitRemindDaemon.isRunning();
    const outputLines: string[] = [];

    // 1. Signature Unified Top Bar
    outputLines.push(this.buildTopBar(termWidth, daemonInfo.running, daemonInfo.pid));
    outputLines.push('');

    // 2. Dual Pane Grid or Responsive Stack
    if (termWidth >= 86) {
      const leftW = Math.max(28, Math.min(34, Math.floor(termWidth * 0.34)));
      const rightW = termWidth - leftW - 1;

      const leftLines = this.buildRepoListLines(leftW - 4);
      const rightLines = this.buildInspectorLines(rightW - 4);

      const activeName = this.repos[this.selectedIndex]?.name || 'Inspector';
      const dualPane = renderDualPaneBox(
        {
          title: `Repositories (${this.repos.length})`,
          lines: leftLines,
          width: leftW,
          borderColor: pc.cyan,
        },
        {
          title: `Inspector: ${activeName}`,
          lines: rightLines,
          width: rightW,
          borderColor: this.repos[this.selectedIndex]?.isDirty ? pc.yellow : pc.cyan,
        }
      );
      outputLines.push(dualPane);
    } else {
      // Narrow screen fallback: stacked view
      const leftLines = this.buildRepoListLines(termWidth - 4);
      const rightLines = this.buildInspectorLines(termWidth - 4);

      outputLines.push(
        renderBox({
          title: `Repositories (${this.repos.length})`,
          lines: leftLines,
          width: termWidth,
          borderColor: pc.cyan,
        })
      );
      outputLines.push('');
      outputLines.push(
        renderBox({
          title: `Inspector: ${this.repos[this.selectedIndex]?.name || 'None'}`,
          lines: rightLines,
          width: termWidth,
          borderColor: pc.cyan,
        })
      );
    }

    outputLines.push('');

    // 3. Action Dock
    outputLines.push(this.buildActionDock(termWidth));

    // 4. Flash Banner / Telemetry Notice
    if (this.flashMessage) {
      outputLines.push(`  ${pc.bold(pc.yellow('⚡ [Alert]'))} ${this.flashMessage}`);
    } else {
      outputLines.push(
        `  ${pc.dim('⚡ Auto-monitoring active • Press [r] to poll now • Use [↑/↓] or [1-9] to select repo')}`
      );
    }

    const frameString = outputLines.join('\n');

    if (process.stdout.isTTY) {
      writeFrame(frameString);
    } else {
      console.log(frameString);
    }
  }

  /**
   * Legacy render alias for compatibility
   */
  public render(): void {
    this.renderFrame();
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

    // Direct numeric repo selection: [1-9]
    if (/^[1-9]$/.test(str)) {
      const targetIdx = parseInt(str, 10) - 1;
      if (targetIdx < this.repos.length) {
        this.userNavigated = true;
        this.selectedIndex = targetIdx;
        this.renderFrame();
      }
      return;
    }

    // Navigation: Up / k
    if ((key && key.name === 'up') || str === 'k') {
      if (this.repos.length > 0) {
        this.userNavigated = true;
        this.selectedIndex = (this.selectedIndex - 1 + this.repos.length) % this.repos.length;
        this.renderFrame();
      }
      return;
    }

    // Navigation: Down / j / tab
    if ((key && key.name === 'down') || str === 'j' || (key && key.name === 'tab')) {
      if (this.repos.length > 0) {
        this.userNavigated = true;
        this.selectedIndex = (this.selectedIndex + 1) % this.repos.length;
        this.renderFrame();
      }
      return;
    }

    // Refresh immediately: [r]
    if (str === 'r' || str === 'R') {
      await this.loadState();
      this.setFlash(pc.cyan('Refreshed repository statuses.'));
      this.renderFrame();
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
        this.setFlash(pc.green(`Repository "${active.name}" is clean! Nothing to commit.`));
        return;
      }

      // Enter interactive wizard
      this.isInteracting = true;
      leaveAlternateScreen();
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

      enterAlternateScreen();
      hideCursor();
      this.isInteracting = false;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
      }

      await this.loadState();
      this.renderFrame();
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
      leaveAlternateScreen();
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

      enterAlternateScreen();
      hideCursor();
      this.isInteracting = false;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
      }

      this.renderFrame();
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
      this.renderFrame();
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
      this.renderFrame();
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
      this.renderFrame();
      return;
    }

    // Toggle daemon: [s]
    if (str === 's' || str === 'S') {
      const current = GitRemindDaemon.isRunning();
      if (current.running && current.pid) {
        try {
          process.kill(current.pid, 'SIGTERM');
          this.setFlash(pc.green(`✔ Daemon (PID: ${current.pid}) stopped.`));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.setFlash(pc.red(`✖ Failed to stop daemon: ${msg}`));
        }
      } else {
        const entryPath = this.getEntryPath();
        const spawnRes = GitRemindDaemon.spawnBackground(entryPath);
        if (spawnRes.success) {
          this.setFlash(pc.green(`✔ Daemon started (PID: ${spawnRes.pid || 'active'}).`));
        } else {
          this.setFlash(pc.red(`✖ ${spawnRes.message}`));
        }
      }
      this.renderFrame();
      return;
    }

    // Test notification: [n]
    if (str === 'n' || str === 'N') {
      this.setFlash(pc.cyan('Sending desktop alert...'));
      this.renderFrame();
      const sent = await notifier.notify({
        trigger: 'test',
        title: 'GitRemind Alert',
        subtitle: 'Desktop Reminder Service',
        message: 'GitRemind dashboard notification test succeeded!',
      });
      if (sent) {
        this.setFlash(pc.green('✔ Desktop notification sent successfully.'));
      } else {
        this.setFlash(pc.yellow('ℹ Test notification triggered.'));
      }
      this.renderFrame();
      return;
    }
  }

  /**
   * Starts periodic background state reload
   */
  private startPollTimer(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    this.pollTimer = setInterval(async () => {
      if (!this.isInteracting && this.isRunning) {
        await this.loadState();
        this.renderFrame();
      }
    }, this.autoRefreshSeconds * 1000);
  }

  /**
   * Starts fluid 120ms animation loop for rotating radar circle, pulse, and digital clock
   */
  private startAnimTimer(): void {
    if (this.animTimer) {
      clearInterval(this.animTimer);
    }
    this.animTimer = setInterval(() => {
      if (!this.isInteracting && this.isRunning) {
        this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
        if (this.spinnerIndex % 2 === 0) {
          this.pulseIndex = (this.pulseIndex + 1) % PULSE_FRAMES.length;
        }
        this.renderFrame();
      }
    }, 120);
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
      this.renderFrame();
      console.log(pc.yellow('\nNotice: Non-interactive terminal environment detected. Exiting dashboard.\n'));
      return;
    }

    enterAlternateScreen();
    hideCursor();

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    }

    const keyListener = (str: string, key: readline.Key) => {
      this.handleKey(str, key).catch((err) => {
        this.setFlash(pc.red(`Error: ${err.message}`));
        this.renderFrame();
      });
    };

    process.stdin.on('keypress', keyListener);

    // Terminal resize handler
    if (process.stdout.on) {
      process.stdout.on('resize', () => {
        if (this.isRunning && !this.isInteracting) {
          this.renderFrame();
        }
      });
    }

    this.startAnimTimer();
    this.startPollTimer();
    this.renderFrame();

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
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.animTimer) {
      clearInterval(this.animTimer);
      this.animTimer = null;
    }
    if (this.flashTimer) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
    leaveAlternateScreen();
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
