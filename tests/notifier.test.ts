import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Notifier } from '../src/core/notifier.js';
import { GitRemindConfig } from '../src/core/types.js';

describe('Notifier formatting & quiet hours', () => {
  const mockConfig: GitRemindConfig = {
    version: 1,
    intervalMinutes: 20,
    notifyOnClose: true,
    sound: true,
    language: 'tr',
    watchedRepos: [],
    ignorePatterns: [],
    ideProcesses: [],
    quietHours: {
      enabled: true,
      start: '23:00',
      end: '08:00',
    },
  };

  it('should format Turkish close notification properly', () => {
    const notifier = new Notifier();
    const formatted = notifier.formatMessage(
      {
        trigger: 'close',
        title: '',
        message: '',
        repoName: 'MyProject',
        branch: 'main',
        fileCount: 4,
        filesPreview: ['app.ts', 'style.css'],
      },
      mockConfig
    );

    assert.equal(formatted.title, 'GitRemind: Proje Kapatıldı!');
    assert.ok(formatted.message.includes('MyProject'));
    assert.ok(formatted.message.includes('4 dosya'));
    assert.ok(formatted.message.includes('app.ts, style.css'));
  });

  it('should format English interval notification properly', () => {
    const notifier = new Notifier();
    const enConfig: GitRemindConfig = { ...mockConfig, language: 'en' };
    const formatted = notifier.formatMessage(
      {
        trigger: 'interval',
        title: '',
        message: '',
        repoName: 'BackendAPI',
        branch: 'feature/auth',
        fileCount: 2,
      },
      enConfig
    );

    assert.equal(formatted.title, 'GitRemind: Uncommitted Changes!');
    assert.ok(formatted.message.includes('BackendAPI'));
    assert.ok(formatted.message.includes('2 files'));
  });

  it('should handle quiet hours calculation when disabled', () => {
    const notifier = new Notifier();
    const disabledCfg = { ...mockConfig, quietHours: { enabled: false, start: '00:00', end: '23:59' } };
    assert.equal(notifier.isQuietHour(disabledCfg), false);
  });
});
