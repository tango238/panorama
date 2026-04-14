import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function parseTmuxField(text) {
  const trimmed = text.trim();
  if (trimmed === '(tmux外)') return null;
  const m = trimmed.match(/^`([^:`]+):([^`]+)`\s*\(window\s*#(\d+),\s*pane\s*#(\d+)\)$/);
  if (!m) return null;
  return {
    session: m[1],
    windowName: m[2],
    windowIndex: Number(m[3]),
    paneIndex: Number(m[4]),
  };
}

export function parsePanesOutput(stdout) {
  return stdout
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => {
      const m = line.match(/^([^:]+):([^:]+):(\d+)\.(\d+)$/);
      if (!m) return null;
      return {
        session: m[1],
        windowName: m[2],
        windowIndex: Number(m[3]),
        paneIndex: Number(m[4]),
      };
    })
    .filter(Boolean);
}

export function listPanes() {
  try {
    const out = execFileSync('tmux', ['list-panes', '-a', '-F', '#S:#W:#I.#P'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parsePanesOutput(out);
  } catch {
    return null;
  }
}

const STATE_DIR = join(homedir(), '.config/panorama/states');
const DEFAULT_IDLE_THRESHOLD_SEC = 90;

export function readHookState(cardPath) {
  const pathKey = cardPath.replace(/\//g, '_');
  let best = null;

  // Check direct state file
  try {
    const raw = readFileSync(join(STATE_DIR, `${pathKey}.json`), 'utf8');
    best = JSON.parse(raw);
  } catch { /* no direct file */ }

  // Check worktree state files (path/.worktrees/*) and pick newest
  try {
    const prefix = `${pathKey}_.worktrees_`;
    const files = readdirSync(STATE_DIR)
      .filter(f => f.startsWith(prefix) && f.endsWith('.json'));
    for (const f of files) {
      try {
        const raw = readFileSync(join(STATE_DIR, f), 'utf8');
        const parsed = JSON.parse(raw);
        if (!best || parsed.timestamp > best.timestamp) {
          best = parsed;
        }
      } catch { /* skip */ }
    }
  } catch { /* no worktree files */ }

  return best;
}

export function detectClaudeCodeState(hookState, idleThreshold = DEFAULT_IDLE_THRESHOLD_SEC) {
  if (hookState === null) return null;

  const elapsed = Math.floor(Date.now() / 1000) - hookState.timestamp;

  if (hookState.state === 'permission' && elapsed < idleThreshold) {
    return 'permission';
  }
  if (elapsed < idleThreshold) {
    return 'active';
  }
  return 'waiting';
}

const PERMISSION_PROMPT = /Do you want to proceed\?/;

export function detectPermissionFromPane(target) {
  try {
    const content = execFileSync('tmux', ['capture-pane', '-p', '-t', target], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
    const tail = lines.slice(-10);
    return tail.some(line => PERMISSION_PROMPT.test(line));
  } catch {
    return false;
  }
}

export function classifyAlive(card, panes) {
  if (card === null) return '(tmux外)';
  const sameSessionAndPane = panes.filter(
    p => p.session === card.session && p.paneIndex === card.paneIndex
  );
  if (sameSessionAndPane.length === 0) return '⚠️ pane closed';
  const exact = sameSessionAndPane.find(p => p.windowName === card.windowName);
  if (exact) return '✅';
  return '⚠️ window renamed?';
}
