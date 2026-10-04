import pc from 'picocolors';
import { GitFileStatus, FileChangeKind } from '../core/types.js';

/**
 * Strips ANSI escape codes to calculate visual string width
 */
export function stripAnsi(str: string): string {
  // Matches standard ANSI color and formatting codes
  return str.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Calculates visual display length of a string without ANSI sequences
 */
export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

/**
 * Pads a string to a visible width respecting ANSI escape codes
 */
export function pad(
  str: string,
  targetWidth: number,
  align: 'left' | 'right' | 'center' = 'left'
): string {
  const vLen = visibleLength(str);
  if (vLen >= targetWidth) return str;

  const diff = targetWidth - vLen;
  if (align === 'right') {
    return ' '.repeat(diff) + str;
  } else if (align === 'center') {
    const left = Math.floor(diff / 2);
    const right = diff - left;
    return ' '.repeat(left) + str + ' '.repeat(right);
  }
  return str + ' '.repeat(diff);
}

/**
 * Truncates a string to a visual width with ellipsis
 */
export function truncate(str: string, maxWidth: number): string {
  if (visibleLength(str) <= maxWidth) return str;
  const raw = stripAnsi(str);
  if (raw.length <= maxWidth) return str;
  return raw.slice(0, Math.max(0, maxWidth - 3)) + '...';
}

/**
 * Retro ASCII art banner for GitRemind
 */
export const ASCII_BANNER = [
  '  ____ _ _   ____                 _           _ ',
  ' / ___(_) |_|  _ \\ ___ _ __ ___ (_)_ __   __| |',
  '| |  _| | __| |_) / _ \\ \'_ ` _ \\| | \'_ \\ / _` |',
  '| |_| | | |_|  _ <  __/ | | | | | | | | | (_| |',
  ' \\____|_|\\__|_| \\_\\___|_| |_| |_|_|_| |_|\\__,_|',
].join('\n');

/**
 * Renders the top retro header banner
 */
export function renderHeader(terminalWidth = 80): string {
  const coloredBanner = pc.cyan(ASCII_BANNER);
  const tag = pc.bold(pc.white('GitRemind')) + pc.gray(' • Intelligent Git Tracker & Interactive Committer');
  const divider = pc.dim('─'.repeat(Math.max(terminalWidth, 68)));
  return `${coloredBanner}\n  ${tag}\n${divider}`;
}

/**
 * Formats a file change badge with distinctive colors
 */
export function formatBadge(kind: FileChangeKind): string {
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

/**
 * Formats daemon status pill
 */
export function formatDaemonPill(running: boolean, pid?: number): string {
  if (running && pid) {
    return `${pc.green('🟢 Active')} ${pc.dim(`[PID: ${pid}]`)}`;
  }
  return `${pc.red('🔴 Stopped')}`;
}

/**
 * Formats repository status pill
 */
export function formatStatusPill(isDirty: boolean, uncommittedCount = 0): string {
  if (isDirty) {
    const fileLabel = uncommittedCount === 1 ? 'file' : 'files';
    return `${pc.yellow('🟡 Dirty')} ${pc.yellow(`(${uncommittedCount} uncommitted ${fileLabel})`)}`;
  }
  return `${pc.green('🟢 Clean')} ${pc.green('(All changes committed)')}`;
}

/**
 * Renders a stylized box with rounded borders
 */
export function renderBox(options: {
  title?: string;
  lines: string[];
  width?: number;
  borderColor?: (str: string) => string;
}): string {
  const { title, lines, width = 78, borderColor = pc.cyan } = options;
  const innerWidth = width - 4; // 2 border chars + 2 padding spaces

  const topBorder = title
    ? borderColor('╭─ ') + pc.bold(title) + ' ' + borderColor('─'.repeat(Math.max(0, innerWidth - visibleLength(title) - 1)) + '╮')
    : borderColor('╭' + '─'.repeat(innerWidth + 2) + '╮');

  const bottomBorder = borderColor('╰' + '─'.repeat(innerWidth + 2) + '╯');

  const contentLines = lines.map((line) => {
    const padded = pad(line, innerWidth);
    return borderColor('│ ') + padded + borderColor(' │');
  });

  return [topBorder, ...contentLines, bottomBorder].join('\n');
}

/**
 * Clears terminal screen and resets cursor position
 */
export function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}

/**
 * Hides terminal cursor
 */
export function hideCursor(): void {
  process.stdout.write('\x1b[?25l');
}

/**
 * Shows terminal cursor
 */
export function showCursor(): void {
  process.stdout.write('\x1b[?25h');
}

/**
 * Formats hotkey action bar at bottom of dashboard
 */
export function renderActionBar(
  actions: Array<{ key: string; label: string }>
): string {
  const parts = actions.map(
    (a) => `${pc.bold(pc.cyan(`[${a.key}]`))} ${pc.white(a.label)}`
  );
  return '  ' + parts.join(pc.dim('  │  '));
}
