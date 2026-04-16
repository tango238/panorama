import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runUpdate } from '../src/update.js';

function makeProjectRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'panorama-proj-'));
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: dir, stdio: 'pipe' });
  run('git', ['init', '-q', '-b', 'feature/login']);
  run('git', ['config', 'user.email', 'test@example.com']);
  run('git', ['config', 'user.name', 'Test']);
  run('git', ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'x.txt'), 'x');
  run('git', ['add', 'x.txt']);
  run('git', ['commit', '-q', '-m', 'initial']);
  return dir;
}

test('runUpdate: rewrites branch and last-commit for a card', () => {
  const projectDir = makeProjectRepo();
  const vault = mkdtempSync(join(tmpdir(), 'panorama-vault-'));
  const dashboardPath = join(vault, 'Dashboard.md');

  const dashboard = `---
kanban-plugin: basic
---

## 🟢 対応中

- **project-a / feat login**
\t- **tmux:** (tmux外)
\t- **path:** ${projectDir}
\t- **alive:** (tmux外) <!-- auto -->
\t- **branch:** (n/a) <!-- auto -->
\t- **last-commit:** (n/a) <!-- auto -->
\t- **last-activity:** (n/a) <!-- auto -->

## ✅ 完了
`;
  writeFileSync(dashboardPath, dashboard);

  runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });

  const after = readFileSync(dashboardPath, 'utf8');
  assert.match(after, /\*\*last-commit:\*\* .+ · initial <!-- auto -->/);
  assert.match(after, /\*\*last-activity:\*\* .+ <!-- auto -->/);
  assert.match(after, /\*\*alive:\*\* \(tmux外\) <!-- auto -->/);
});

test('runUpdate: non-existent path gets (n/a)', () => {
  const vault = mkdtempSync(join(tmpdir(), 'panorama-vault-'));
  const dashboardPath = join(vault, 'Dashboard.md');
  const dashboard = `## 🟢 対応中

- **broken card**
\t- **tmux:** (tmux外)
\t- **path:** /nonexistent/xyz-panorama-test
\t- **alive:** (tmux外) <!-- auto -->
\t- **branch:** old <!-- auto -->
\t- **last-commit:** old <!-- auto -->
\t- **last-activity:** old <!-- auto -->
`;
  writeFileSync(dashboardPath, dashboard);

  runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });

  const after = readFileSync(dashboardPath, 'utf8');
  assert.match(after, /- \*\*last-commit:\*\* \(n\/a\) <!-- auto -->/);
  assert.match(after, /- \*\*last-activity:\*\* \(n\/a\) <!-- auto -->/);
});

test('runUpdate: moves active state card to 🟢', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-home-'));
  const vault = mkdtempSync(join(tmpdir(), 'panorama-vault-'));
  const dashboardPath = join(vault, 'Dashboard.md');

  const stateDir = join(home, '.config/panorama/states');
  mkdirSync(stateDir, { recursive: true });
  const ts = Math.floor(Date.now() / 1000);
  writeFileSync(join(stateDir, 'sess-xyz.json'), JSON.stringify({
    state: 'active', timestamp: ts, session_id: 'sess-xyz', cwd: '/nowhere',
  }));

  const dashboard = `## 🟢 対応中

## 🟡 入力待ち

- **proj / t1**
\t- **path:** /nowhere
\t- **last-commit:** x <!-- auto -->
\t- **last-activity:** x <!-- auto -->
\t<!-- session: sess-xyz -->
`;
  writeFileSync(dashboardPath, dashboard);

  const origHome = process.env.HOME;
  process.env.HOME = home;
  try {
    runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });
  } finally {
    process.env.HOME = origHome;
  }

  const after = readFileSync(dashboardPath, 'utf8');
  const activeIdx = after.indexOf('🟢');
  const waitingIdx = after.indexOf('🟡');
  const cardIdx = after.indexOf('proj / t1');
  assert.ok(cardIdx > activeIdx && cardIdx < waitingIdx, 'card should be in 🟢');
});

test('runUpdate: moves card without session to 🟡 via cwd fallback', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-home-'));
  const vault = mkdtempSync(join(tmpdir(), 'panorama-vault-'));
  const dashboardPath = join(vault, 'Dashboard.md');

  const stateDir = join(home, '.config/panorama/states');
  mkdirSync(stateDir, { recursive: true });
  const ts = Math.floor(Date.now() / 1000);
  writeFileSync(join(stateDir, 'sess-abc.json'), JSON.stringify({
    state: 'waiting', timestamp: ts, session_id: 'sess-abc', cwd: '/nowhere',
  }));

  const dashboard = `## 🟢 対応中

- **proj / t1**
\t- **path:** /nowhere
\t- **last-commit:** x <!-- auto -->
\t- **last-activity:** x <!-- auto -->

## 🟡 入力待ち
`;
  writeFileSync(dashboardPath, dashboard);

  const origHome = process.env.HOME;
  process.env.HOME = home;
  try {
    runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });
  } finally {
    process.env.HOME = origHome;
  }

  const after = readFileSync(dashboardPath, 'utf8');
  const waitingIdx = after.indexOf('🟡');
  const cardIdx = after.indexOf('proj / t1');
  assert.ok(cardIdx > waitingIdx, 'card should have moved to 🟡');
});

test('runUpdate: card with no matching state is untouched', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-home-'));
  const vault = mkdtempSync(join(tmpdir(), 'panorama-vault-'));
  const dashboardPath = join(vault, 'Dashboard.md');
  mkdirSync(join(home, '.config/panorama/states'), { recursive: true });

  const dashboard = `## 🟢 対応中

- **proj / t1**
\t- **path:** /nowhere
\t- **last-commit:** x <!-- auto -->
\t- **last-activity:** x <!-- auto -->

## 🟡 入力待ち
`;
  writeFileSync(dashboardPath, dashboard);

  const origHome = process.env.HOME;
  process.env.HOME = home;
  try {
    runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });
  } finally {
    process.env.HOME = origHome;
  }

  const after = readFileSync(dashboardPath, 'utf8');
  const activeIdx = after.indexOf('🟢');
  const waitingIdx = after.indexOf('🟡');
  const cardIdx = after.indexOf('proj / t1');
  assert.ok(cardIdx > activeIdx && cardIdx < waitingIdx);
});

test('runUpdate: does not touch non-auto lines', () => {
  const projectDir = makeProjectRepo();
  const vault = mkdtempSync(join(tmpdir(), 'panorama-vault-'));
  const dashboardPath = join(vault, 'Dashboard.md');
  const dashboard = `## 🟢 対応中

- **project-a / feat login**
\t- **tmux:** (tmux外)
\t- **path:** ${projectDir}
\t- **alive:** (tmux外) <!-- auto -->
\t- **branch:** (n/a) <!-- auto -->
\t- **last-commit:** (n/a) <!-- auto -->
\t- **last-activity:** (n/a) <!-- auto -->
\t- don't touch me
\t- also don't touch me
`;
  writeFileSync(dashboardPath, dashboard);

  runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });

  const after = readFileSync(dashboardPath, 'utf8');
  assert.match(after, /don't touch me/);
  assert.match(after, /also don't touch me/);
});
