import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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

test('pano doctor: reports node/git/jq/hooks checks', () => {
  // doctor may exit non-zero depending on environment (e.g. missing claude hooks);
  // we only assert that output contains the expected labels.
  const r = spawnSync('node', [CLI, 'doctor'], { encoding: 'utf8' });
  const out = r.stdout;
  assert.match(out, /node:\s+OK/);
  assert.match(out, /git:\s+OK/);
  assert.match(out, /jq:\s+/);
  assert.match(out, /hooks:\s+/);
});

test('pano: unknown subcommand exits non-zero', () => {
  assert.throws(() => {
    execFileSync('node', [CLI, 'bogus'], { stdio: 'pipe' });
  });
});
