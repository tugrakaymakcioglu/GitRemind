import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigManager } from '../src/core/config.js';

describe('ConfigManager', () => {
  it('should load default configuration values', () => {
    const mgr = new ConfigManager();
    const cfg = mgr.load();

    assert.ok(cfg);
    assert.equal(typeof cfg.intervalMinutes, 'number');
    assert.equal(typeof cfg.notifyOnClose, 'boolean');
    assert.equal(typeof cfg.sound, 'boolean');
    assert.ok(Array.isArray(cfg.watchedRepos));
    assert.ok(Array.isArray(cfg.ignorePatterns));
  });

  it('should update settings properly', () => {
    const mgr = new ConfigManager();
    const updated = mgr.updateSettings({ intervalMinutes: 25, sound: false });

    assert.equal(updated.intervalMinutes, 25);
    assert.equal(updated.sound, false);

    // Re-read
    const cfg = mgr.load();
    assert.equal(cfg.intervalMinutes, 25);
    assert.equal(cfg.sound, false);
  });
});
