import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectClaudeCodeState } from '../src/lib/tmux.js';

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

describe('detectClaudeCodeState (hook-based)', () => {
  it('returns null when hookState is null', () => {
    assert.equal(detectClaudeCodeState(null), null);
  });

  // --- active states ---

  it('detects recent active hook as active', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() };
    assert.equal(detectClaudeCodeState(hookState), 'active');
  });

  it('detects active hook 10s ago as active', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() - 10 };
    assert.equal(detectClaudeCodeState(hookState), 'active');
  });

  it('detects active hook 29s ago as active', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() - 29 };
    assert.equal(detectClaudeCodeState(hookState), 'active');
  });

  // --- waiting states ---

  it('detects active hook 31s ago as waiting', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() - 31 };
    assert.equal(detectClaudeCodeState(hookState), 'waiting');
  });

  it('detects active hook 120s ago as waiting', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() - 120 };
    assert.equal(detectClaudeCodeState(hookState), 'waiting');
  });

  // --- permission states ---

  it('detects recent permission hook as permission', () => {
    const hookState = { state: 'permission', timestamp: nowEpoch() };
    assert.equal(detectClaudeCodeState(hookState), 'permission');
  });

  it('detects permission hook 15s ago as permission', () => {
    const hookState = { state: 'permission', timestamp: nowEpoch() - 15 };
    assert.equal(detectClaudeCodeState(hookState), 'permission');
  });

  it('detects permission hook 31s ago as waiting (stale)', () => {
    const hookState = { state: 'permission', timestamp: nowEpoch() - 31 };
    assert.equal(detectClaudeCodeState(hookState), 'waiting');
  });
});
