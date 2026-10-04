import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pc from 'picocolors';
import {
  stripAnsi,
  visibleLength,
  pad,
  truncate,
  renderBox,
  renderHeader,
  formatBadge,
  formatDaemonPill,
  formatStatusPill,
  renderActionBar,
  ASCII_BANNER,
} from '../src/cli/tui.js';

describe('TUI Utility Library', () => {
  it('should strip ANSI escape sequences accurately', () => {
    const styled = pc.bold(pc.red('Hello world'));
    assert.equal(stripAnsi(styled), 'Hello world');
    assert.equal(visibleLength(styled), 11);
  });

  it('should pad string respecting visible width', () => {
    const styled = pc.cyan('Test');
    const padded = pad(styled, 10, 'left');
    assert.equal(visibleLength(padded), 10);
    assert.ok(stripAnsi(padded).startsWith('Test'));

    const rightPadded = pad(styled, 10, 'right');
    assert.equal(visibleLength(rightPadded), 10);
    assert.ok(stripAnsi(rightPadded).endsWith('Test'));

    const centerPadded = pad(styled, 10, 'center');
    assert.equal(visibleLength(centerPadded), 10);
  });

  it('should truncate strings exceeding maximum visual length', () => {
    const longText = 'This is a very long text that must be truncated';
    const truncated = truncate(longText, 20);
    assert.equal(visibleLength(truncated), 20);
    assert.ok(truncated.endsWith('...'));

    const shortText = 'Short';
    assert.equal(truncate(shortText, 10), 'Short');
  });

  it('should render header with retro ASCII banner', () => {
    const header = renderHeader(80);
    assert.ok(header.includes('GitRemind'));
    assert.ok(stripAnsi(header).includes('____ _ _   ____'));
  });

  it('should format file badges with distinct labels and colors', () => {
    assert.equal(stripAnsi(formatBadge('modified')), '[M]');
    assert.equal(stripAnsi(formatBadge('untracked')), '[?]');
    assert.equal(stripAnsi(formatBadge('deleted')), '[D]');
    assert.equal(stripAnsi(formatBadge('staged')), '[A]');
    assert.equal(stripAnsi(formatBadge('renamed')), '[R]');
    assert.equal(stripAnsi(formatBadge('conflicted')), '[!]');
  });

  it('should format daemon and status pills correctly', () => {
    const activePill = formatDaemonPill(true, 4321);
    assert.ok(stripAnsi(activePill).includes('🟢 Active'));
    assert.ok(stripAnsi(activePill).includes('4321'));

    const stoppedPill = formatDaemonPill(false);
    assert.ok(stripAnsi(stoppedPill).includes('🔴 Stopped'));

    const cleanPill = formatStatusPill(false);
    assert.ok(stripAnsi(cleanPill).includes('🟢 Clean'));

    const dirtyPill = formatStatusPill(true, 5);
    assert.ok(stripAnsi(dirtyPill).includes('🟡 Dirty'));
    assert.ok(stripAnsi(dirtyPill).includes('5 uncommitted files'));
  });

  it('should render styled boxes with proper width and alignment', () => {
    const box = renderBox({
      title: 'Status Box',
      lines: ['First line', 'Second line with more content'],
      width: 50,
    });

    const lines = box.split('\n');
    assert.ok(lines.length >= 4);
    assert.ok(lines[0].includes('Status Box'));
    for (const line of lines) {
      assert.equal(visibleLength(line), 50);
    }
  });

  it('should render hotkey action bar properly', () => {
    const actionBar = renderActionBar([
      { key: 'c', label: 'Commit' },
      { key: 'w', label: 'Watch' },
      { key: 'q', label: 'Exit' },
    ]);

    const plain = stripAnsi(actionBar);
    assert.ok(plain.includes('[c] Commit'));
    assert.ok(plain.includes('[w] Watch'));
    assert.ok(plain.includes('[q] Exit'));
  });
});
