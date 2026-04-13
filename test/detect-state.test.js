import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectClaudeCodeState } from '../src/lib/tmux.js';

function pane(bodyLines) {
  const statusBar = '  [Opus 4.6 (1M context)] 📁 project | ⎇ main | 🪙 100K 12%';
  const modeLine = '  ⏵⏵ accept edits on (shift+tab to cycle)';
  const sep = '─'.repeat(80);
  return [
    ...bodyLines,
    sep,
    '❯ ',
    sep,
    statusBar,
    modeLine,
  ].join('\n');
}

describe('detectClaudeCodeState', () => {
  it('returns null when content is null', () => {
    assert.equal(detectClaudeCodeState(null), null);
  });

  it('returns null when no Claude Code status bar', () => {
    const content = 'just a regular shell\n$ ls\nfile.txt\n';
    assert.equal(detectClaudeCodeState(content), null);
  });

  // --- active states ---

  it('detects ✶ spinner as active', () => {
    const content = pane(['✶ Swooping… (57s · ↓ 81 tokens)']);
    assert.equal(detectClaudeCodeState(content), 'active');
  });

  it('detects ✢ spinner as active', () => {
    const content = pane(['✢ Thinking…']);
    assert.equal(detectClaudeCodeState(content), 'active');
  });

  it('detects · spinner as active', () => {
    const content = pane(['· Grooving… (5m 57s · ↓ 13.1k tokens)']);
    assert.equal(detectClaudeCodeState(content), 'active');
  });

  it('detects ✳ spinner as active', () => {
    const content = pane(['✳ Enchanting… (2m 10s · ↓ 5k tokens)']);
    assert.equal(detectClaudeCodeState(content), 'active');
  });

  it('detects spinner with spaces in task name as active', () => {
    const content = pane(['· Phase 4: 再 analyze + 検証中… (4m 30s · ↓ 590 tokens)']);
    assert.equal(detectClaudeCodeState(content), 'active');
  });

  it('detects Running… as active', () => {
    const content = pane(['  ⎿  Running…']);
    assert.equal(detectClaudeCodeState(content), 'active');
  });

  it('detects Running… with timeout as active', () => {
    const content = pane(['  ⎿  Running… (1m 31s · timeout 5m)']);
    assert.equal(detectClaudeCodeState(content), 'active');
  });

  // --- waiting states ---

  it('detects idle prompt as waiting', () => {
    const content = pane(['  some previous output']);
    assert.equal(detectClaudeCodeState(content), 'waiting');
  });

  it('does not match truncated output lines as active', () => {
    const content = pane([
      "  Bash(node -e \"import { foo } from './lib/tmux.js';…)\"",
    ]);
    assert.equal(detectClaudeCodeState(content), 'waiting');
  });

  it('does not match indented lines with ellipsis as active', () => {
    const content = pane([
      '      /Users/go/.local/share/panorama/src/lib/tmux.js…)',
    ]);
    assert.equal(detectClaudeCodeState(content), 'waiting');
  });

  it('does not match ⎿ Done as active', () => {
    const content = pane(['  ⎿  Done']);
    assert.equal(detectClaudeCodeState(content), 'waiting');
  });

  it('does not match status bar emoji as active', () => {
    const content = pane([]);
    assert.equal(detectClaudeCodeState(content), 'waiting');
  });

  // --- permission states ---

  it('detects permission prompt', () => {
    const content = pane([
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. No',
    ]);
    assert.equal(detectClaudeCodeState(content), 'permission');
  });

  it('detects permission prompt even without status bar', () => {
    // Permission dialog can push status bar off-screen
    const content = [
      '  ⎿  Running…',
      '─'.repeat(80),
      ' Bash command',
      '   mkdir -p /some/path',
      '   Create directory',
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. No',
      ' Esc to cancel',
    ].join('\n');
    assert.equal(detectClaudeCodeState(content), 'permission');
  });

  it('does not detect old permission prompt outside tail', () => {
    const filler = Array(20).fill('some output line');
    const content = [
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      ...filler,
      '─'.repeat(80),
      '❯ ',
      '─'.repeat(80),
      '  [Opus 4.6 (1M context)] 📁 project | ⎇ main',
      '  ⏵⏵ accept edits on',
    ].join('\n');
    assert.equal(detectClaudeCodeState(content), 'waiting');
  });
});
