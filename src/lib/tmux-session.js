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
