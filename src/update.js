import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitCards, extractCardFields, rewriteAutoField } from './lib/parse-dashboard.js';
import { getBranch, getLastCommit } from './lib/git.js';
import { getLastActivity } from './lib/fs-activity.js';
import { formatRelative } from './lib/relative-time.js';
import { listPanes, parseTmuxField, classifyAlive } from './lib/tmux.js';

const AUTO_KEYS = ['alive', 'branch', 'last-commit', 'last-activity'];

function buildCardUpdates(card, panes) {
  const fields = extractCardFields(card.body);
  const updates = {
    alive: '(tmux外)',
    branch: '(n/a)',
    'last-commit': '(n/a)',
    'last-activity': '(n/a)',
  };

  if (fields.path) {
    try {
      const branch = getBranch(fields.path);
      if (branch !== null) updates.branch = branch;
      const commit = getLastCommit(fields.path);
      if (commit !== null) updates['last-commit'] = commit;
      const activity = getLastActivity(fields.path);
      if (activity !== null) updates['last-activity'] = formatRelative(activity);
    } catch {
      /* leave defaults */
    }
  }

  if (fields.tmux !== undefined) {
    const parsed = parseTmuxField(fields.tmux);
    if (panes === null) {
      updates.alive = '(tmux外)';
    } else {
      updates.alive = classifyAlive(parsed, panes);
    }
  }

  return updates;
}

function applyUpdatesToLines(lines, card, updates) {
  for (let i = card.startLine; i <= card.endLine; i++) {
    for (const key of AUTO_KEYS) {
      lines[i] = rewriteAutoField(lines[i], key, updates[key]);
    }
  }
}

export function runUpdate(config) {
  const dashboardPath = join(config.vault_path, config.dashboard_file);
  const text = readFileSync(dashboardPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const cards = splitCards(text);
  const panes = listPanes();

  for (const card of cards) {
    const updates = buildCardUpdates(card, panes);
    applyUpdatesToLines(lines, card, updates);
  }

  writeFileSync(dashboardPath, lines.join('\n'));
}
