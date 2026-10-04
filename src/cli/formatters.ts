import pc from 'picocolors';
import { GitRepoState, GitFileStatus } from '../core/types.js';

export function formatBadge(kind: GitFileStatus['kind']): string {
  switch (kind) {
    case 'modified':
      return pc.yellow('[M]');
    case 'staged':
      return pc.cyan('[A]');
    case 'untracked':
      return pc.green('[?]');
    case 'deleted':
      return pc.red('[D]');
    case 'renamed':
      return pc.magenta('[R]');
    case 'conflicted':
      return pc.bgRed(pc.white('[!]'));
    default:
      return pc.gray('[*]');
  }
}

export function formatRepoCard(state: GitRepoState, language: 'tr' | 'en' = 'en'): string {
  const lines: string[] = [];
  const isTr = language === 'tr';

  const statusText = state.isDirty
    ? pc.yellow(isTr ? `⚠️  DEĞİŞİKLİKLER BEKLİYOR (${state.summary.total} dosya)` : `⚠️  PENDING CHANGES (${state.summary.total} uncommitted file${state.summary.total === 1 ? '' : 's'})`)
    : pc.green(isTr ? '✅ TEMİZ (Tüm değişiklikler commit edildi)' : '✅ CLEAN (Working tree clean, all committed)');

  lines.push(pc.bold(pc.cyan(`\n📦 ${state.name}`)) + pc.gray(` (${state.rootPath})`));
  lines.push(`   ${isTr ? 'Dal (Branch)' : 'Branch'}          : ${pc.magenta(state.branch)}`);
  lines.push(`   ${isTr ? 'Durum' : 'Status'}          : ${statusText}`);
  lines.push(`   ${isTr ? 'Son Commit' : 'Last Commit'}     : ${pc.dim(state.lastCommitRelative || (isTr ? 'Yok' : 'None'))} - "${pc.italic(state.lastCommitMessage || (isTr ? 'Yok' : 'None'))}"`);

  if (state.isDirty && state.files.length > 0) {
    lines.push(pc.bold(isTr ? '   Commit Edilmemiş Dosyalar:' : '   Uncommitted Files:'));
    const preview = state.files.slice(0, 8);
    for (const f of preview) {
      lines.push(`     ${formatBadge(f.kind)} ${f.path}`);
    }
    if (state.files.length > 8) {
      lines.push(pc.gray(isTr ? `     ... ve ${state.files.length - 8} dosya daha` : `     ... and ${state.files.length - 8} more file(s)`));
    }
  }

  return lines.join('\n');
}

export function formatBanner(): string {
  return [
    pc.cyan('╭─────────────────────────────────────────────────────────────────────────────╮'),
    pc.cyan('│') + pc.bold(pc.white('   🔔 GitRemind — Intelligent Git Watcher & Commit Reminder Daemon            ')) + pc.cyan('│'),
    pc.cyan('╰─────────────────────────────────────────────────────────────────────────────╯'),
  ].join('\n');
}

export function formatDashboardHeader(daemonRunning: boolean, pid?: number, watchedCount = 0, interval = 20): string {
  const statusBadge = daemonRunning
    ? pc.bgGreen(pc.black(' ACTIVE ')) + ` ${pc.green(`(PID: ${pid})`)}`
    : pc.bgYellow(pc.black(' STOPPED ')) + pc.gray(' (Run: gitremind start)');

  return [
    formatBanner(),
    pc.bold('\n📊 System Overview:'),
    `   Daemon Status    : ${statusBadge}`,
    `   Reminder Cadence : ${pc.cyan(interval + ' minutes')}`,
    `   Watched Repos    : ${pc.yellow(String(watchedCount))}`,
  ].join('\n');
}
