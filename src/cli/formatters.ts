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

export function formatRepoCard(state: GitRepoState): string {
  const lines: string[] = [];

  const statusColor = state.isDirty ? pc.yellow : pc.green;
  const statusText = state.isDirty
    ? pc.yellow(`⚠️  DEĞİŞİKLİKLER BEKLİYOR (${state.summary.total} dosya)`)
    : pc.green('✅ TEMİZ (Tüm değişiklikler commit edildi)');

  lines.push(pc.bold(pc.cyan(`\n📦 ${state.name}`)) + pc.gray(` (${state.rootPath})`));
  lines.push(`   Dal (Branch)    : ${pc.magenta(state.branch)}`);
  lines.push(`   Durum           : ${statusText}`);
  lines.push(`   Son Commit      : ${pc.dim(state.lastCommitRelative || 'Yok')} - "${pc.italic(state.lastCommitMessage || 'Yok')}"`);

  if (state.isDirty && state.files.length > 0) {
    lines.push(pc.bold('   Commit Edilmemiş Dosyalar:'));
    const preview = state.files.slice(0, 8);
    for (const f of preview) {
      lines.push(`     ${formatBadge(f.kind)} ${f.path}`);
    }
    if (state.files.length > 8) {
      lines.push(pc.gray(`     ... ve ${state.files.length - 8} dosya daha`));
    }
  }

  return lines.join('\n');
}

export function formatBanner(): string {
  return [
    pc.cyan('╔════════════════════════════════════════════════════════════════╗'),
    pc.cyan('║') + pc.bold(pc.white('   GitRemind - Akıllı Git Commit & Değişiklik Hatırlatıcı       ')) + pc.cyan('║'),
    pc.cyan('╚════════════════════════════════════════════════════════════════╝'),
  ].join('\n');
}
