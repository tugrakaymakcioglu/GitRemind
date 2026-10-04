#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getRepoState, getRepoRoot, stageAll, commitChanges } from '../core/git.js';
import { configManager } from '../core/config.js';
import { GitRemindDaemon } from '../core/daemon.js';
import { notifier } from '../core/notifier.js';
import { processTracker } from '../core/process-tracker.js';
import { formatRepoCard, formatBanner, formatDashboardHeader } from './formatters.js';
import { normalizeRepoPath, getLogPath, getConfigPath } from '../utils/paths.js';
import { startDashboard } from './dashboard.js';
import { runCommitWizard } from './commit-wizard.js';

const __filename = fileURLToPath(import.meta.url);
const program = new Command();

program
  .name('gitremind')
  .description('Intelligent Automated Git Reminder & Watcher Daemon')
  .version('1.0.0');

// 1. START
program
  .command('start')
  .description('Start the GitRemind background monitoring daemon')
  .option('-f, --foreground', 'Run daemon in foreground terminal instead of detached background')
  .action(async (options) => {
    const isRunning = GitRemindDaemon.isRunning();
    if (isRunning.running) {
      console.log(pc.yellow(`⚠️  GitRemind daemon is already running (PID: ${isRunning.pid}).`));
      return;
    }

    if (options.foreground) {
      console.log(formatBanner());
      console.log(pc.cyan('🚀 GitRemind daemon running in foreground... (Press Ctrl+C to stop)'));
      const daemon = new GitRemindDaemon();
      await daemon.start();
    } else {
      const result = GitRemindDaemon.spawnBackground(__filename);
      if (result.success) {
        console.log(pc.green(`✔ ${result.message}`));
        console.log(pc.gray(`  To stream daemon logs: Get-Content -Wait "${getLogPath()}"`));
      } else {
        console.log(pc.red(`✖ ${result.message}`));
      }
    }
  });

// 2. STOP
program
  .command('stop')
  .description('Stop the running GitRemind background daemon')
  .action(async () => {
    const isRunning = GitRemindDaemon.isRunning();
    if (!isRunning.running || !isRunning.pid) {
      console.log(pc.yellow('ℹ️  No active GitRemind daemon found running.'));
      return;
    }

    try {
      process.kill(isRunning.pid, 'SIGTERM');
      console.log(pc.green(`✔ GitRemind daemon (PID: ${isRunning.pid}) has been stopped.`));
    } catch (err: unknown) {
      const error = err as Error;
      console.log(pc.red(`✖ Error stopping daemon: ${error.message}`));
    }
  });

// 3. RESTART
program
  .command('restart')
  .description('Restart the GitRemind background daemon')
  .action(async () => {
    const isRunning = GitRemindDaemon.isRunning();
    if (isRunning.running && isRunning.pid) {
      try {
        process.kill(isRunning.pid, 'SIGTERM');
        console.log(pc.yellow(`ℹ️  Previous daemon (PID: ${isRunning.pid}) stopped.`));
        // Small delay to allow clean socket release
        await new Promise((r) => setTimeout(r, 1000));
      } catch {
        // ignore
      }
    }

    const result = GitRemindDaemon.spawnBackground(__filename);
    if (result.success) {
      console.log(pc.green(`✔ ${result.message}`));
    } else {
      console.log(pc.red(`✖ ${result.message}`));
    }
  });

// 4. STATUS / DASHBOARD
program
  .command('status')
  .description('Displays daemon status and watched repository health dashboard')
  .action(async () => {
    const isRunning = GitRemindDaemon.isRunning();
    const config = configManager.load();

    console.log(formatDashboardHeader(isRunning.running, isRunning.pid, config.watchedRepos.length, config.intervalMinutes));

    console.log(pc.bold('\n⚙️  Configuration:'));
    console.log(`   Auto-Close Alerts: ${config.notifyOnClose ? pc.green('✔ Enabled') : pc.red('✖ Disabled')}`);
    console.log(`   Audio Chime      : ${config.sound ? pc.green('✔ Enabled') : pc.red('✖ Disabled')}`);
    console.log(`   Quiet Hours      : ${config.quietHours.enabled ? pc.cyan(`${config.quietHours.start} - ${config.quietHours.end}`) : pc.gray('Disabled')}`);
    console.log(`   Config File      : ${pc.gray(getConfigPath())}`);

    // Current working directory check
    const currentRepo = await getRepoState(process.cwd());
    if (currentRepo.isGitRepo) {
      console.log(pc.bold('\n📍 Active Directory:'));
      console.log(formatRepoCard(currentRepo, config.language));
    }
  });

// 5. WATCH (Add repo)
program
  .command('watch [path]')
  .description('Add a git repository to the watch list (default: current directory)')
  .action(async (targetPath?: string) => {
    const dir = targetPath ? path.resolve(targetPath) : process.cwd();
    const result = await configManager.addRepo(dir);

    if (result.success) {
      console.log(pc.green(`✔ ${result.message}`));
      // If daemon is not running, prompt user
      const isRunning = GitRemindDaemon.isRunning();
      if (!isRunning.running) {
        console.log(pc.cyan('💡 To start the background daemon: gitremind start'));
      }
    } else {
      console.log(pc.yellow(`ℹ️  ${result.message}`));
    }
  });

// 6. UNWATCH (Remove repo)
program
  .command('unwatch [path]')
  .description('Remove a repository from the watch list')
  .action((targetPath?: string) => {
    const dir = targetPath ? path.resolve(targetPath) : process.cwd();
    const result = configManager.removeRepo(dir);
    if (result.success) {
      console.log(pc.green(`✔ ${result.message}`));
    } else {
      console.log(pc.red(`✖ ${result.message}`));
    }
  });

// 7. LIST
program
  .command('list')
  .description('List all watched repositories and real-time commit status')
  .action(async () => {
    const config = configManager.load();
    if (config.watchedRepos.length === 0) {
      console.log(pc.yellow('ℹ️  No repositories in watch list yet.'));
      console.log(pc.cyan('   To add current repository: gitremind watch'));
      return;
    }

    console.log(pc.bold(`\n📋 Watched Repositories (${config.watchedRepos.length}):`));
    for (const r of config.watchedRepos) {
      if (fs.existsSync(r.path)) {
        const state = await getRepoState(r.path);
        console.log(formatRepoCard(state, config.language));
      } else {
        console.log(pc.red(`\n✖ ${r.name} (${r.path}) - Directory not found!`));
      }
    }
  });

// 8. CHECK (One-off check & notify)
program
  .command('check [path]')
  .description('Inspect repository status immediately and send desktop alert if dirty')
  .action(async (targetPath?: string) => {
    const dir = targetPath ? path.resolve(targetPath) : process.cwd();
    const state = await getRepoState(dir);
    const config = configManager.load();

    if (!state.isGitRepo) {
      console.log(pc.red(`✖ "${dir}" is not a Git repository.`));
      return;
    }

    console.log(formatRepoCard(state, config.language));

    if (state.isDirty) {
      await notifier.notify({
        trigger: 'interval',
        title: 'GitRemind: Uncommitted Changes Detected!',
        subtitle: `Repo: ${state.name} (${state.branch})`,
        message: `💡 ${state.summary.total} uncommitted file(s) waiting in "${state.name}".`,
        repoName: state.name,
        repoPath: state.rootPath,
        branch: state.branch,
        fileCount: state.summary.total,
        filesPreview: state.files.map((f) => f.path),
      });
      console.log(pc.green('\n✔ Desktop notification dispatched.'));
    } else {
      console.log(pc.green('\n✔ Repository is clean! Working tree has no uncommitted changes.'));
    }
  });

// 9. OPEN / SESSION (Run editor & notify on exit)
program
  .command('open <editorCommand> [args...]')
  .description('Launch project in editor and alert on IDE exit if uncommitted changes exist (e.g. gitremind open code .)')
  .action(async (editorCommand: string, args: string[]) => {
    const currentDir = process.cwd();
    const root = await getRepoRoot(currentDir);
    const repoPath = root || currentDir;

    console.log(pc.cyan(`🚀 ${editorCommand} başlatılıyor (${repoPath})...`));
    console.log(pc.gray('   Editör kapandığında commit durumu otomatik denetlenecektir.\n'));

    const exitCode = await processTracker.runSession(editorCommand, args, repoPath);
    process.exit(exitCode);
  });

// 10. DASHBOARD
program
  .command('dashboard')
  .alias('ui')
  .description('Interactive Claude CLI-style terminal dashboard')
  .action(async () => {
    await startDashboard();
  });

// 11. COMMIT WIZARD
program
  .command('commit [path]')
  .alias('wizard')
  .description('Interactive Conventional Commit wizard to stage and commit pending changes')
  .option('-t, --type <type>', 'Commit type (feat, fix, docs, refactor, chore, custom)')
  .option('-s, --scope <scope>', 'Commit scope (e.g. auth, api, cli)')
  .option('-m, --message <message>', 'Commit subject message')
  .option('-y, --yes', 'Stage all changes and commit without confirmation')
  .action(async (targetPath?: string, options: { type?: string; scope?: string; message?: string; yes?: boolean } = {}) => {
    if (!options.message && !options.type) {
      await runCommitWizard(targetPath);
      return;
    }

    const cwd = targetPath ? path.resolve(targetPath) : process.cwd();
    const state = await getRepoState(cwd);
    if (!state.isGitRepo) {
      console.log(pc.red(`✖ Current directory "${cwd}" is not a git repository.`));
      return;
    }
    if (!state.isDirty) {
      console.log(pc.green('✔ Working tree clean. No uncommitted changes found.'));
      return;
    }

    const type = options.type || 'feat';
    const scope = options.scope ? `(${options.scope})` : '';
    const fullMessage = `${type}${scope}: ${options.message || 'update files'}`;
    const result = await commitChanges({ repoPath: cwd, message: fullMessage });
    if (result.success) {
      console.log(pc.green(`\n✔ Successfully staged & committed: ${pc.bold(fullMessage)}`));
      console.log(pc.gray(`  Commit Hash: ${result.commitHash} (${result.relativeTime})`));
    } else {
      console.log(pc.red(`\n✖ Commit failed: ${result.error}`));
    }
  });

// 12. CONFIG
program
  .command('config [key] [value]')
  .description('View or update configuration settings (interval, sound, close, lang)')
  .action((key?: string, value?: string) => {
    const config = configManager.load();

    if (!key) {
      console.log(pc.bold('\n⚙️  GitRemind Configuration:'));
      console.log(`   intervalMinutes : ${pc.cyan(String(config.intervalMinutes))}`);
      console.log(`   notifyOnClose   : ${pc.cyan(String(config.notifyOnClose))}`);
      console.log(`   sound           : ${pc.cyan(String(config.sound))}`);
      console.log(`   language        : ${pc.cyan(config.language)}`);
      console.log(`   Configuration   : ${pc.gray(getConfigPath())}`);
      return;
    }

    if (key === 'interval' && value) {
      const minutes = parseInt(value, 10);
      if (isNaN(minutes) || minutes < 1) {
        console.log(pc.red('✖ interval must be a positive integer (in minutes).'));
        return;
      }
      configManager.updateSettings({ intervalMinutes: minutes });
      console.log(pc.green(`✔ Reminder interval updated to ${minutes} minutes.`));
    } else if (key === 'sound' && value) {
      const soundVal = value.toLowerCase() === 'true' || value === '1' || value === 'yes';
      configManager.updateSettings({ sound: soundVal });
      console.log(pc.green(`✔ Audio chime ${soundVal ? 'enabled' : 'disabled'}.`));
    } else if (key === 'close' && value) {
      const closeVal = value.toLowerCase() === 'true' || value === '1' || value === 'yes';
      configManager.updateSettings({ notifyOnClose: closeVal });
      console.log(pc.green(`✔ Project close notification ${closeVal ? 'enabled' : 'disabled'}.`));
    } else if (key === 'lang' && value) {
      if (value !== 'tr' && value !== 'en') {
        console.log(pc.red('✖ Language must be either "en" or "tr".'));
        return;
      }
      configManager.updateSettings({ language: value });
      console.log(pc.green(`✔ Language preference updated to "${value}".`));
    } else {
      console.log(pc.yellow(`Unknown config key: "${key}". Supported keys: interval, sound, close, lang`));
    }
  });

// 13. NOTIFY (Test notification)
program
  .command('notify [message]')
  .description('Send a test native desktop notification')
  .action(async (customMsg?: string) => {
    console.log(pc.cyan('🔔 Sending test desktop notification...'));
    const success = await notifier.notify({
      trigger: 'test',
      title: 'GitRemind: Test Notification',
      subtitle: 'Git Reminder Service',
      message: customMsg || 'This is a test desktop notification. GitRemind is active and working properly!',
    });

    if (success) {
      console.log(pc.green('✔ Notification successfully dispatched.'));
    } else {
      console.log(pc.red('✖ Failed to dispatch notification.'));
    }
  });

// 14. HOOK (Shell integration)
program
  .command('hook [shell]')
  .description('Generate shell exit hook integration script (powershell, bash, zsh)')
  .action((shell = 'powershell') => {
    const s = shell.toLowerCase();
    if (s === 'powershell' || s === 'pwsh') {
      console.log(pc.cyan('# GitRemind PowerShell Integration'));
      console.log(pc.gray('# Add this block to your $PROFILE:'));
      console.log(`
Register-EngineEvent PowerShell.Exiting -Action {
    try {
        if (git rev-parse --is-inside-work-tree 2>$null) {
            $dirty = git status --porcelain=v1 2>$null
            if ($dirty) {
                Write-Host "\`n[GitRemind] ⚠️  WARNING: Exiting terminal but uncommitted changes remain!" -ForegroundColor Yellow
                git status -s
                gitremind check 2>$null
            }
        }
    } catch {}
} | Out-Null
`);
    } else if (s === 'bash' || s === 'zsh') {
      console.log(pc.cyan(`# GitRemind ${s.toUpperCase()} Integration`));
      console.log(pc.gray(`# Add this block to your ~/.${s}rc:`));
      console.log(`
gitremind_exit_hook() {
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        if [ -n "$(git status --porcelain=v1 2>/dev/null)" ]; then
            printf "\\n\\033[1;33m[GitRemind] ⚠️  WARNING: Uncommitted changes detected before exit!\\033[0m\\n"
            git status -s
            gitremind check >/dev/null 2>&1 &
        fi
    fi
}
trap gitremind_exit_hook EXIT
`);
    } else {
      console.log(pc.red(`Unsupported shell: "${shell}". Supported: powershell, bash, zsh`));
    }
  });

// 15. DAEMON RUN (Internal)
program
  .command('daemon')
  .argument('<action>', 'run')
  .description('Background daemon process runner (internal)')
  .action(async (action) => {
    if (action === 'run') {
      const daemon = new GitRemindDaemon();
      await daemon.start();
    }
  });

if (process.argv.length <= 2) {
  if (process.stdin.isTTY) {
    process.argv.push('dashboard');
  } else {
    process.argv.push('status');
  }
}

await program.parseAsync(process.argv);
