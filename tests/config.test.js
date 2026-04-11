// tests/config.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { parseConfig, loadConfig } from '../src/lib/config.js';

test('parseConfig: scalar values', () => {
  const text = `
vault_path: ~/Documents/Obsidian/work-dashboard
dashboard_file: Dashboard.md
update_interval_seconds: 180
`;
  const cfg = parseConfig(text);
  assert.equal(cfg.vault_path, join(homedir(), 'Documents/Obsidian/work-dashboard'));
  assert.equal(cfg.dashboard_file, 'Dashboard.md');
  assert.equal(cfg.update_interval_seconds, 180);
});

test('parseConfig: list values', () => {
  const text = `
columns:
  - active
  - waiting
  - blocked
  - done
`;
  const cfg = parseConfig(text);
  assert.deepEqual(cfg.columns, ['active', 'waiting', 'blocked', 'done']);
});

test('parseConfig: ignores comments and blanks', () => {
  const text = `
# panorama config
vault_path: /tmp/vault

# interval
update_interval_seconds: 60
`;
  const cfg = parseConfig(text);
  assert.equal(cfg.vault_path, '/tmp/vault');
  assert.equal(cfg.update_interval_seconds, 60);
});

test('loadConfig: reads file from disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'panorama-cfg-'));
  const path = join(dir, 'config.yaml');
  writeFileSync(path, 'vault_path: /tmp/x\ndashboard_file: D.md\nupdate_interval_seconds: 30\n');
  const cfg = loadConfig(path);
  assert.equal(cfg.vault_path, '/tmp/x');
  assert.equal(cfg.dashboard_file, 'D.md');
  assert.equal(cfg.update_interval_seconds, 30);
});
