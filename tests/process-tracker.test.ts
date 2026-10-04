import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessTracker } from '../src/core/process-tracker.js';

describe('ProcessTracker', () => {
  it('should detect current process as alive', () => {
    const tracker = new ProcessTracker();
    const alive = tracker.isProcessAlive(process.pid);
    assert.equal(alive, true);
    tracker.stop();
  });

  it('should detect non-existent process as dead', () => {
    const tracker = new ProcessTracker();
    // 999999 is extraordinarily unlikely to exist
    const alive = tracker.isProcessAlive(9999999);
    assert.equal(alive, false);
    tracker.stop();
  });
});
