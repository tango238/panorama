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

const STALE_THRESHOLD_SEC = 3600; // 1h
const VALID_STATES = new Set(['active', 'waiting']);

export function loadAllHookStates(homeDir = homedir()) {
  const stateDir = join(homeDir, '.config/panorama/states');
  const bySession = new Map();
  const byCwd = new Map();

  let files;
  try {
    files = readdirSync(stateDir);
  } catch {
    return { bySession, byCwd };
  }

  const entries = [];
  for (const f of files) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    try {
      const raw = readFileSync(join(stateDir, f), 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') continue;
      if (typeof parsed.session_id !== 'string' || parsed.session_id.length === 0) continue;
      entries.push(parsed);
    } catch { /* skip unreadable/malformed */ }
  }

  for (const e of entries) {
    bySession.set(e.session_id, e);
    if (typeof e.cwd === 'string' && e.cwd.length > 0) {
      if (!byCwd.has(e.cwd)) byCwd.set(e.cwd, []);
      byCwd.get(e.cwd).push(e);
    }
  }

  for (const arr of byCwd.values()) {
    arr.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  return { bySession, byCwd };
}

export function detectClaudeCodeState(hookState, staleThreshold = STALE_THRESHOLD_SEC) {
  if (hookState === null || typeof hookState !== 'object') return null;
  if (!VALID_STATES.has(hookState.state)) return null;
  if (typeof hookState.timestamp !== 'number') return null;
  const elapsed = Math.floor(Date.now() / 1000) - hookState.timestamp;
  if (elapsed > staleThreshold) return null;
  return hookState.state;
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
