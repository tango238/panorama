import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectClaudeCodeState } from '../src/lib/tmux.js';

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

// Default threshold is 90s
describe('detectClaudeCodeState (hook-based)', () => {
  it('returns null when hookState is null', () => {
    assert.equal(detectClaudeCodeState(null), null);
  });

  // --- active states (within default 90s threshold) ---

  it('detects recent active hook as active', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() };
    assert.equal(detectClaudeCodeState(hookState), 'active');
  });

  it('detects active hook 10s ago as active', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() - 10 };
    assert.equal(detectClaudeCodeState(hookState), 'active');
  });

  it('detects active hook 89s ago as active', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() - 89 };
    assert.equal(detectClaudeCodeState(hookState), 'active');
  });

  // --- waiting states (beyond threshold) ---

  it('detects active hook 91s ago as waiting', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() - 91 };
    assert.equal(detectClaudeCodeState(hookState), 'waiting');
  });

  it('detects active hook 300s ago as waiting', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() - 300 };
    assert.equal(detectClaudeCodeState(hookState), 'waiting');
  });

  // --- custom threshold ---

  it('respects custom threshold (30s)', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() - 29 };
    assert.equal(detectClaudeCodeState(hookState, 30), 'active');
  });

  it('custom threshold triggers waiting', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() - 31 };
    assert.equal(detectClaudeCodeState(hookState, 30), 'waiting');
  });

  // --- permission states ---

  it('detects recent permission hook as permission', () => {
    const hookState = { state: 'permission', timestamp: nowEpoch() };
    assert.equal(detectClaudeCodeState(hookState), 'permission');
  });

  it('detects permission hook 60s ago as permission', () => {
    const hookState = { state: 'permission', timestamp: nowEpoch() - 60 };
    assert.equal(detectClaudeCodeState(hookState), 'permission');
  });

  it('detects permission hook 91s ago as waiting (stale)', () => {
    const hookState = { state: 'permission', timestamp: nowEpoch() - 91 };
    assert.equal(detectClaudeCodeState(hookState), 'waiting');
  });
});
