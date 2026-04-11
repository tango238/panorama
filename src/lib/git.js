import { execFileSync } from 'node:child_process';

function runGit(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export function getBranch(cwd) {
  return runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

export function getLastCommit(cwd) {
  return runGit(cwd, ['log', '-1', '--format=%ar · %s']);
}
