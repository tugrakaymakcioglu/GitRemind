import pc from 'picocolors';
import { GitFileStatus, FileChangeKind } from '../core/types.js';

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const PULSE_FRAMES = ['●', '◉', '◎', '○', '◎', '◉'];

/**
 * Strips ANSI escape codes to calculate visual string width
 */
export function stripAnsi(str: string): string {
  return str.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Calculates visual display length of a string without ANSI sequences
 */
export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

/**
 * Truncates a string to a visual width with ellipsis, respecting ANSI codes
 */
export function truncate(str: string, maxWidth: number): string {
  const vLen = visibleLength(str);
  if (vLen <= maxWidth) return str;

  const raw = stripAnsi(str);
  if (raw.length <= maxWidth) return str;

  const cutLen = Math.max(0, maxWidth - 3);
  return raw.slice(0, cutLen) + '...';
}

/**
 * Pads a string to a visual width respecting ANSI escape codes
 */
export function pad(
  str: string,
  targetWidth: number,
  align: 'left' | 'right' | 'center' = 'left'
): string {
  const vLen = visibleLength(str);
  if (vLen > targetWidth) {
    return truncate(str, targetWidth);
  }
  if (vLen === targetWidth) return str;

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
 * Modern compact 2-line block ASCII banner for GitRemind
 */
export const ASCII_BANNER = [
  '  █▀▀ █ ▀█▀ █▀█ █▀▀ █▀▄▀█ █ █▄░█ █▀▄',
  '  █▄█ █  █  █▀▄ ██▄ █ ▀ █ █ █ ▀█ █▄▀',
].join('\n');

/**
 * Renders the top modern header banner
 */
export function renderHeader(terminalWidth = 80): string {
  const line1 = pc.bold(pc.cyan('  █▀▀ █ ▀█▀ █▀█ █▀▀ █▀▄▀█ █ █▄░█ █▀▄'));
  const line2 = pc.bold(pc.cyan('  █▄█ █  █  █▀▄ ██▄ █ ▀ █ █ █ ▀█ █▄▀'));
  const tag = pc.bold(pc.white('GitRemind')) + pc.gray(' • Intelligent Git Watcher & Commit Assistant');
  const divider = pc.dim('─'.repeat(Math.max(terminalWidth, 68)));
  return `${line1}\n${line2}   ${tag}\n${divider}`;
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
 * Renders a stylized box with rounded borders and strict width clipping
 */
export function renderBox(options: {
  title?: string;
  lines: string[];
  width?: number;
  borderColor?: (str: string) => string;
}): string {
  const { title, lines, width = 78, borderColor = pc.cyan } = options;
  const innerWidth = Math.max(20, width - 4);

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
 * Renders two boxes side-by-side with matched row counts and clean borders
 */
export function renderDualPaneBox(
  left: { title: string; lines: string[]; width: number; borderColor?: (s: string) => string },
  right: { title: string; lines: string[]; width: number; borderColor?: (s: string) => string }
): string {
  const leftColor = left.borderColor || pc.cyan;
  const rightColor = right.borderColor || pc.blue;

  const leftInnerWidth = Math.max(10, left.width - 4);
  const rightInnerWidth = Math.max(10, right.width - 4);

  const leftTop = left.title
    ? leftColor('╭─ ') + pc.bold(left.title) + ' ' + leftColor('─'.repeat(Math.max(0, leftInnerWidth - visibleLength(left.title) - 1)) + '╮')
    : leftColor('╭' + '─'.repeat(leftInnerWidth + 2) + '╮');

  const rightTop = right.title
    ? rightColor('╭─ ') + pc.bold(right.title) + ' ' + rightColor('─'.repeat(Math.max(0, rightInnerWidth - visibleLength(right.title) - 1)) + '╮')
    : rightColor('╭' + '─'.repeat(rightInnerWidth + 2) + '╮');

  const leftBottom = leftColor('╰' + '─'.repeat(leftInnerWidth + 2) + '╯');
  const rightBottom = rightColor('╰' + '─'.repeat(rightInnerWidth + 2) + '╯');

  const maxRows = Math.max(left.lines.length, right.lines.length);
  const rows: string[] = [];

  rows.push(`${leftTop} ${rightTop}`);

  for (let i = 0; i < maxRows; i++) {
    const lRaw = left.lines[i] !== undefined ? left.lines[i] : '';
    const rRaw = right.lines[i] !== undefined ? right.lines[i] : '';

    const lPadded = pad(lRaw, leftInnerWidth);
    const rPadded = pad(rRaw, rightInnerWidth);

    rows.push(`${leftColor('│ ')}${lPadded}${leftColor(' │')} ${rightColor('│ ')}${rPadded}${rightColor(' │')}`);
  }

  rows.push(`${leftBottom} ${rightBottom}`);
  return rows.join('\n');
}

/**
 * Renders a visual telemetry progress bar of uncommitted changes
 */
export function renderTelemetryBar(
  summary: { modified: number; untracked: number; staged: number; deleted: number; total: number },
  barWidth = 20
): string {
  if (summary.total === 0) {
    return `${pc.green(`[${'━'.repeat(barWidth)}]`)} ${pc.bold(pc.green('✔ Clean & Synced'))}`;
  }

  const { staged, modified, untracked, deleted, total } = summary;
  const stagedChars = Math.min(barWidth, Math.round((staged / total) * barWidth));
  const modifiedChars = Math.min(barWidth - stagedChars, Math.round((modified / total) * barWidth));
  const untrackedChars = Math.min(barWidth - stagedChars - modifiedChars, Math.round((untracked / total) * barWidth));
  const deletedChars = Math.min(barWidth - stagedChars - modifiedChars - untrackedChars, Math.round((deleted / total) * barWidth));
  const remaining = Math.max(0, barWidth - stagedChars - modifiedChars - untrackedChars - deletedChars);

  const bar =
    pc.cyan('█'.repeat(stagedChars)) +
    pc.yellow('█'.repeat(modifiedChars)) +
    pc.green('░'.repeat(untrackedChars)) +
    pc.red('x'.repeat(deletedChars)) +
    pc.dim('─'.repeat(remaining));

  return `[${bar}] ${pc.bold(pc.yellow(`${total} uncommitted`))}`;
}

/**
 * Enters alternate screen buffer and hides cursor for flicker-free TUI
 */
export function enterAlternateScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1049h\x1b[H\x1b[?25l');
  }
}

/**
 * Exits alternate screen buffer and restores terminal cursor
 */
export function leaveAlternateScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1049l\x1b[?25h');
  }
}

/**
 * Atomic frame writer that resets cursor to top-left and replaces screen contents
 */
export function writeFrame(frame: string): void {
  process.stdout.write('\x1b[H' + frame);
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
