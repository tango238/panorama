import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runList, groupCardsByColumn, formatList } from '../src/commands/list.js';

const CLI = resolve('bin/panorama');

const SAMPLE = [
  '---',
  'kanban-plugin: basic',
  '---',
  '',
  '## 🟢 対応中',
  '',
  '- [ ] **panorama / list-cmd**',
  '\t- **path:** /Users/me/work/panorama',
  '\t- **pc:** MacBook',
  '\t- **tmux:** pano',
  '\t- **branch:** main <!-- auto -->',
  '\t- → [[projects/panorama]]',
  '\t<!-- session: 11111111-2222-3333-4444-555555555555 -->',
  '',
  '## 🟡 入力待ち',
  '',
  '## 🔴 ブロック中',
  '',
  '- [ ] **other / blocked-task**',
  '\t- **path:** /tmp/other',
  '\t- **pc:** Desktop',
  '\t<!-- session: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee | blocked -->',
  '',
  '## ✅ 完了',
  '',
  '- [ ] **done / finished**',
  '\t- **path:** /tmp/done',
  '',
].join('\n');

function makeIO(files) {
  return {
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFile: (p) => {
      if (!files[p]) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    loadConfig: () => ({ vault_path: '/vault', dashboard_file: 'Dashboard.md' }),
  };
}

test('groupCardsByColumn: groups cards under their column heading', () => {
  const grouped = groupCardsByColumn(SAMPLE);
  const active = grouped.get('## 🟢 対応中');
  assert.equal(active.length, 1);
  assert.equal(active[0].title, 'panorama / list-cmd');
  assert.equal(active[0].fields.path, '/Users/me/work/panorama');
  assert.equal(active[0].fields.pc, 'MacBook');
  assert.equal(active[0].fields.tmux, 'pano');
  assert.equal(active[0].fields.branch, 'main');

  const blocked = grouped.get('## 🔴 ブロック中');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].fields.blocked, true);

  const waiting = grouped.get('## 🟡 入力待ち');
  assert.equal(waiting.length, 0);
});

test('formatList: shows state columns by default and skips ✅完了', () => {
  const out = formatList(groupCardsByColumn(SAMPLE));
  assert.match(out, /🟢 対応中/);
  assert.match(out, /🟡 入力待ち/);
  assert.match(out, /🔴 ブロック中/);
  assert.doesNotMatch(out, /✅ 完了/);
  assert.match(out, /panorama \/ list-cmd/);
  assert.match(out, /\/Users\/me\/work\/panorama/);
  assert.match(out, /pc=MacBook/);
  assert.match(out, /tmux=pano/);
  assert.match(out, /branch=main/);
  assert.match(out, /session=11111111/);
  assert.match(out, /\[BLOCK\]/);
});

test('formatList: --all includes ✅完了', () => {
  const out = formatList(groupCardsByColumn(SAMPLE), { all: true });
  assert.match(out, /✅ 完了/);
  assert.match(out, /done \/ finished/);
});

test('formatList: empty state column shows (なし)', () => {
  const out = formatList(groupCardsByColumn(SAMPLE));
  const waitingBlock = out.split('\n').slice(
    out.split('\n').findIndex(l => l.includes('🟡 入力待ち')),
    out.split('\n').findIndex(l => l.includes('🟡 入力待ち')) + 2,
  );
  assert.match(waitingBlock.join('\n'), /\(なし\)/);
});

test('runList: returns 1 when config missing', async () => {
  const messages = [];
  const exit = await runList({
    args: [],
    stderr: { write: (s) => messages.push(s) },
    stdout: { write: () => {} },
    configPath: '/nope/config.yaml',
    io: makeIO({}),
  });
  assert.equal(exit, 1);
  assert.match(messages.join(''), /config not found/);
});

test('runList: returns 1 when dashboard missing', async () => {
  const messages = [];
  const exit = await runList({
    args: [],
    stderr: { write: (s) => messages.push(s) },
    stdout: { write: () => {} },
    configPath: '/cfg.yaml',
    io: makeIO({ '/cfg.yaml': '' }),
  });
  assert.equal(exit, 1);
  assert.match(messages.join(''), /dashboard not found/);
});

test('runList: writes formatted output and returns 0', async () => {
  const out = [];
  const exit = await runList({
    args: [],
    stdout: { write: (s) => out.push(s) },
    stderr: { write: () => {} },
    configPath: '/cfg.yaml',
    io: makeIO({
      '/cfg.yaml': '',
      '/vault/Dashboard.md': SAMPLE,
    }),
  });
  assert.equal(exit, 0);
  assert.match(out.join(''), /panorama \/ list-cmd/);
});

test('runList: rejects unknown argument', async () => {
  const messages = [];
  const exit = await runList({
    args: ['--bogus'],
    stderr: { write: (s) => messages.push(s) },
    stdout: { write: () => {} },
    configPath: '/cfg.yaml',
    io: makeIO({ '/cfg.yaml': '', '/vault/Dashboard.md': SAMPLE }),
  });
  assert.equal(exit, 2);
  assert.match(messages.join(''), /unknown argument/);
});

test('CLI: panorama list reads config and prints dashboard', () => {
  const vault = mkdtempSync(join(tmpdir(), 'panorama-list-'));
  const cfgPath = join(vault, 'config.yaml');
  const dashboardPath = join(vault, 'Dashboard.md');
  writeFileSync(cfgPath, `vault_path: ${vault}\ndashboard_file: Dashboard.md\nupdate_interval_seconds: 180\n`);
  writeFileSync(dashboardPath, SAMPLE);

  const out = execFileSync('node', [CLI, 'list', '--config', cfgPath], { encoding: 'utf8' });
  assert.match(out, /🟢 対応中/);
  assert.match(out, /panorama \/ list-cmd/);
  assert.doesNotMatch(out, /✅ 完了/);
});

test('CLI: panorama ls is an alias for list', () => {
  const vault = mkdtempSync(join(tmpdir(), 'panorama-ls-'));
  const cfgPath = join(vault, 'config.yaml');
  const dashboardPath = join(vault, 'Dashboard.md');
  writeFileSync(cfgPath, `vault_path: ${vault}\ndashboard_file: Dashboard.md\nupdate_interval_seconds: 180\n`);
  writeFileSync(dashboardPath, SAMPLE);

  const out = execFileSync('node', [CLI, 'ls', '--config', cfgPath], { encoding: 'utf8' });
  assert.match(out, /panorama \/ list-cmd/);
});

test('CLI: panorama list --all includes ✅完了', () => {
  const vault = mkdtempSync(join(tmpdir(), 'panorama-list-all-'));
  const cfgPath = join(vault, 'config.yaml');
  const dashboardPath = join(vault, 'Dashboard.md');
  writeFileSync(cfgPath, `vault_path: ${vault}\ndashboard_file: Dashboard.md\nupdate_interval_seconds: 180\n`);
  writeFileSync(dashboardPath, SAMPLE);

  const out = execFileSync('node', [CLI, 'list', '--all', '--config', cfgPath], { encoding: 'utf8' });
  assert.match(out, /✅ 完了/);
  assert.match(out, /done \/ finished/);
});
