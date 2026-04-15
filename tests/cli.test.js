import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve('bin/panorama');

test('pano update: reads config and updates dashboard', () => {
  const vault = mkdtempSync(join(tmpdir(), 'panorama-cli-'));
  const cfgPath = join(vault, 'config.yaml');
  const dashboardPath = join(vault, 'Dashboard.md');
  writeFileSync(cfgPath, `vault_path: ${vault}\ndashboard_file: Dashboard.md\nupdate_interval_seconds: 180\n`);
  writeFileSync(dashboardPath, `## 🟢 対応中\n\n### empty card\n\n- **tmux:** (tmux外)\n- **path:** /nonexistent/xyz-panorama\n- **alive:** old <!-- auto -->\n- **branch:** old <!-- auto -->\n- **last-commit:** old <!-- auto -->\n- **last-activity:** old <!-- auto -->\n`);

  execFileSync('node', [CLI, 'update', '--config', cfgPath], { stdio: 'pipe' });

  const after = readFileSync(dashboardPath, 'utf8');
  assert.match(after, /- \*\*last-commit:\*\* \(n\/a\) <!-- auto -->/);
});

test('pano doctor: exits 0 when node and git exist', () => {
  const out = execFileSync('node', [CLI, 'doctor'], { encoding: 'utf8' });
  assert.match(out, /node:\s+OK/);
  assert.match(out, /git:\s+OK/);
});

test('pano: unknown subcommand exits non-zero', () => {
  assert.throws(() => {
    execFileSync('node', [CLI, 'bogus'], { stdio: 'pipe' });
  });
});
