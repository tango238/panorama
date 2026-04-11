import { execFileSync } from 'node:child_process';

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
