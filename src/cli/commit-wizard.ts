import readline from 'node:readline';
import pc from 'picocolors';
import { getRepoState, commitChanges } from '../core/git.js';
import { CommitResult } from '../core/types.js';
import { formatBadge, renderBox, visibleLength } from './tui.js';

interface CommitTypeOption {
  num: string;
  name: string;
  desc: string;
}

const COMMIT_TYPES: CommitTypeOption[] = [
  { num: '1', name: 'feat', desc: 'A new feature' },
  { num: '2', name: 'fix', desc: 'A bug fix' },
  { num: '3', name: 'docs', desc: 'Documentation only changes' },
  { num: '4', name: 'refactor', desc: 'A code change that neither fixes a bug nor adds a feature' },
  { num: '5', name: 'chore', desc: 'Changes to build process, tooling, or dependencies' },
  { num: '6', name: 'custom', desc: 'Custom commit type / prefix' },
];

/**
 * Runs the interactive Git commit wizard
 */
export async function runCommitWizard(targetPath?: string): Promise<CommitResult | null> {
  const repoDir = targetPath || process.cwd();
  const state = await getRepoState(repoDir);

  if (!state.isGitRepo) {
    console.log(pc.red(`\n✖ Error: "${repoDir}" is not a Git repository.`));
    return null;
  }

  // Header Banner
  console.log('\n' + renderBox({
    lines: [
      pc.bold(pc.cyan('                     GITREMIND COMMIT WIZARD                     ')),
      pc.dim('               Craft Clean & Structured Git Commits             '),
    ],
    width: 76,
    borderColor: pc.cyan,
  }));

  console.log(`\n  ${pc.bold('Repository:')} ${pc.magenta(state.name)} ${pc.gray(`(branch: ${state.branch})`)}`);
  console.log(`  ${pc.bold('Location:  ')} ${pc.dim(state.rootPath)}\n`);

  if (!state.isDirty || state.files.length === 0) {
    console.log(renderBox({
      lines: [
        pc.green('  ✨ Repository is clean! All changes have already been committed.'),
        pc.dim('     No uncommitted or modified files found to stage.'),
      ],
      width: 76,
      borderColor: pc.green,
    }) + '\n');
    return null;
  }

  // Display changed files
  console.log(pc.bold(pc.white(`  Changed Files (${state.files.length}):`)));
  const preview = state.files.slice(0, 15);
  for (const f of preview) {
    const badge = formatBadge(f.kind);
    const stagedMarker = f.staged ? pc.green(' [staged]') : '';
    console.log(`    ${badge}  ${f.path}${stagedMarker}`);
  }
  if (state.files.length > 15) {
    console.log(pc.gray(`    ... and ${state.files.length - 15} more files`));
  }
  console.log('');

  // Interactive readline session
  const wasRaw = process.stdin.isRaw;
  if (wasRaw) {
    process.stdin.setRawMode(false);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (promptText: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(promptText, (answer) => {
        resolve(answer.trim());
      });
    });
  };

  try {
    // 1. Commit Type
    console.log(pc.bold(pc.cyan('  1. Select Commit Type:')));
    for (const t of COMMIT_TYPES) {
      console.log(`     ${pc.yellow(`[${t.num}]`)} ${pc.bold(pc.white(t.name.padEnd(10)))} ${pc.gray(t.desc)}`);
    }

    let typeStr = '';
    while (!typeStr) {
      const input = await ask(pc.cyan('  Select type [1-6] (default: 1 feat): '));
      if (!input || input === '1' || input.toLowerCase() === 'feat') {
        typeStr = 'feat';
      } else if (input === '2' || input.toLowerCase() === 'fix') {
        typeStr = 'fix';
      } else if (input === '3' || input.toLowerCase() === 'docs') {
        typeStr = 'docs';
      } else if (input === '4' || input.toLowerCase() === 'refactor') {
        typeStr = 'refactor';
      } else if (input === '5' || input.toLowerCase() === 'chore') {
        typeStr = 'chore';
      } else if (input === '6' || input.toLowerCase() === 'custom') {
        const customType = await ask(pc.cyan('  Enter custom commit type (e.g. perf, test, ci): '));
        typeStr = customType || 'chore';
      } else {
        console.log(pc.red('  Please enter a valid choice between 1 and 6.'));
      }
    }

    // 2. Scope (Optional)
    console.log('');
    console.log(pc.bold(pc.cyan('  2. Commit Scope (Optional):')));
    const scopeInput = await ask(pc.gray('  Scope (e.g. auth, ui, core - press Enter to skip): '));
    const scope = scopeInput.trim();

    // 3. Commit Description / Summary
    console.log('');
    console.log(pc.bold(pc.cyan('  3. Commit Message:')));
    let message = '';
    while (!message) {
      message = await ask(pc.cyan('  Short description: '));
      if (!message) {
        console.log(pc.yellow('  Description cannot be empty. Please describe what changed.'));
      }
    }

    // Compose final commit message
    const formattedSubject = scope ? `${typeStr}(${scope}): ${message}` : `${typeStr}: ${message}`;

    console.log('\n' + renderBox({
      title: 'Commit Preview',
      lines: [
        `  ${pc.bold(pc.green(formattedSubject))}`,
        '',
        pc.gray(`  Files to stage & commit: ${state.files.length} file(s)`),
      ],
      width: 76,
      borderColor: pc.green,
    }));

    // Confirmation
    const confirm = await ask(pc.bold(pc.yellow('  Stage all changes and commit now? [Y/n]: ')));
    if (confirm && confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      console.log(pc.yellow('\n✖ Commit cancelled by user.\n'));
      return null;
    }

    // Execute commit
    console.log(pc.cyan('\n⏳ Staging files and creating git commit...'));
    const result = await commitChanges({
      repoPath: state.rootPath,
      message: formattedSubject,
    });

    if (result.success) {
      console.log('\n' + renderBox({
        title: '✔ COMMIT SUCCESSFUL',
        lines: [
          `  ${pc.bold('Commit Hash :')} ${pc.yellow(result.commitHash || 'HEAD')}`,
          `  ${pc.bold('Message     :')} ${pc.white(result.commitMessage || formattedSubject)}`,
          `  ${pc.bold('Files       :')} ${pc.green(`${state.files.length} file(s) staged & committed`)}`,
          `  ${pc.bold('Committed   :')} ${pc.dim(result.relativeTime || 'just now')}`,
        ],
        width: 76,
        borderColor: pc.green,
      }) + '\n');
    } else {
      console.log('\n' + renderBox({
        title: '✖ COMMIT FAILED',
        lines: [
          pc.red(`  ${result.error || 'Unknown error occurred while running git commit'}`),
        ],
        width: 76,
        borderColor: pc.red,
      }) + '\n');
    }

    return result;
  } finally {
    rl.close();
    if (wasRaw) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    }
  }
}
