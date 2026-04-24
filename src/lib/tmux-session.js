import { execFileSync } from 'node:child_process';

export function isTmuxAvailable() {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function isInsideTmux() {
  return !!process.env.TMUX;
}

export function hasSession(name) {
  try {
    execFileSync('tmux', ['has-session', '-t', `=${name}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function parseSessionsOutput(stdout) {
  return stdout
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => {
      const parts = line.split('\t');
      if (parts.length !== 3) return null;
      const [name, windowsStr, attachedStr] = parts;
      const windows = Number(windowsStr);
      if (!Number.isInteger(windows)) return null;
      if (attachedStr !== '0' && attachedStr !== '1') return null;
      return { name, windows, attached: attachedStr === '1' };
    })
    .filter(Boolean);
}

export function listSessions() {
  try {
    const out = execFileSync(
      'tmux',
      ['list-sessions', '-F', '#{session_name}\t#{session_windows}\t#{?session_attached,1,0}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return parseSessionsOutput(out);
  } catch {
    return [];
  }
}
