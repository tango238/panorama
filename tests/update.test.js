import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
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

### project-a / feat login

- **tmux:** (tmux外)
- **path:** ${projectDir}
- **alive:** (tmux外) <!-- auto -->
- **branch:** (n/a) <!-- auto -->
- **last-commit:** (n/a) <!-- auto -->
- **last-activity:** (n/a) <!-- auto -->

## ✅ 完了
`;
  writeFileSync(dashboardPath, dashboard);

  runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });

  const after = readFileSync(dashboardPath, 'utf8');
  assert.match(after, /- \*\*branch:\*\* feature\/login <!-- auto -->/);
  assert.match(after, /- \*\*last-commit:\*\* .+ · initial <!-- auto -->/);
  assert.match(after, /- \*\*last-activity:\*\* .+ <!-- auto -->/);
  assert.match(after, /- \*\*alive:\*\* \(tmux外\) <!-- auto -->/);
});

test('runUpdate: non-existent path gets (n/a)', () => {
  const vault = mkdtempSync(join(tmpdir(), 'panorama-vault-'));
  const dashboardPath = join(vault, 'Dashboard.md');
  const dashboard = `## 🟢 対応中

### broken card

- **tmux:** (tmux外)
- **path:** /nonexistent/xyz-panorama-test
- **alive:** (tmux外) <!-- auto -->
- **branch:** old <!-- auto -->
- **last-commit:** old <!-- auto -->
- **last-activity:** old <!-- auto -->
`;
  writeFileSync(dashboardPath, dashboard);

  runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });

  const after = readFileSync(dashboardPath, 'utf8');
  assert.match(after, /- \*\*branch:\*\* \(n\/a\) <!-- auto -->/);
  assert.match(after, /- \*\*last-commit:\*\* \(n\/a\) <!-- auto -->/);
  assert.match(after, /- \*\*last-activity:\*\* \(n\/a\) <!-- auto -->/);
});

test('runUpdate: does not touch non-auto lines', () => {
  const projectDir = makeProjectRepo();
  const vault = mkdtempSync(join(tmpdir(), 'panorama-vault-'));
  const dashboardPath = join(vault, 'Dashboard.md');
  const dashboard = `## 🟢 対応中

### project-a / feat login

- **tmux:** (tmux外)
- **path:** ${projectDir}
- **alive:** (tmux外) <!-- auto -->
- **branch:** (n/a) <!-- auto -->
- **last-commit:** (n/a) <!-- auto -->
- **last-activity:** (n/a) <!-- auto -->

### 次にやること
- [ ] don't touch me

### メモ
- also don't touch me
`;
  writeFileSync(dashboardPath, dashboard);

  runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });

  const after = readFileSync(dashboardPath, 'utf8');
  assert.match(after, /don't touch me/);
  assert.match(after, /also don't touch me/);
});
