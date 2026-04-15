import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { splitCards, extractCardFields, rewriteAutoField, findColumns, getCardColumn, moveCard } from './lib/parse-dashboard.js';
import { getLastCommit } from './lib/git.js';
import { getLastActivity } from './lib/fs-activity.js';
import { formatRelative } from './lib/relative-time.js';
import { listPanes, readHookState, detectClaudeCodeState } from './lib/tmux.js';

const AUTO_KEYS = ['last-commit', 'last-activity'];

function buildCardUpdates(card) {
  const fields = extractCardFields(card.body);
  const updates = {
    'last-commit': '(n/a)',
    'last-activity': '(n/a)',
  };

  if (fields.path) {
    try {
      const commit = getLastCommit(fields.path);
      if (commit !== null) updates['last-commit'] = commit;
      const activity = getLastActivity(fields.path);
      if (activity !== null) updates['last-activity'] = formatRelative(activity);
    } catch {
      /* leave defaults */
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

const COL_ACTIVE = '## 🟢 対応中';
const COL_WAITING = '## 🟡 入力待ち';
const AUTO_COLUMNS = [COL_ACTIVE, COL_WAITING];

function targetColumnFor(state) {
  if (state === 'active') return COL_ACTIVE;
  if (state === 'waiting') return COL_WAITING;
  return null;
}

function buildColumnTransitions(cards, columns, panes, idleThreshold) {
  const moves = [];
  for (const card of cards) {
    const fields = extractCardFields(card.body);
    const currentCol = getCardColumn(card, columns);
    if (!currentCol) continue;

    // Only auto-transition cards in auto-managed columns
    const inAutoCol = AUTO_COLUMNS.some(c => currentCol.heading.includes(c.slice(3)));
    if (!inAutoCol) continue;

    if (!fields.path) continue;

    const hookState = readHookState(fields.path);
    const state = detectClaudeCodeState(hookState, idleThreshold);
    if (state === null) continue;

    const destCol = targetColumnFor(state);
    if (!destCol) continue;

    const alreadyInDest = currentCol.heading.includes(destCol.slice(3));
    if (alreadyInDest) continue;

    moves.push({ card, targetHeading: destCol });
  }
  return moves;
}

export function runUpdate(config) {
  const dashboardPath = join(config.vault_path, config.dashboard_file);
  const text = readFileSync(dashboardPath, 'utf8');
  let lines = text.split(/\r?\n/);
  const cards = splitCards(text);
  const panes = listPanes();

  // Phase 1: auto field updates
  for (const card of cards) {
    const updates = buildCardUpdates(card);
    applyUpdatesToLines(lines, card, updates);
  }

  // Phase 2: column transitions — one move at a time with fresh line numbers
  const interval = config.update_interval_seconds || 180;
  const idleThreshold = Math.ceil(interval * 1.5);
  const MAX_MOVES = 10;
  for (let i = 0; i < MAX_MOVES; i++) {
    const currentCards = splitCards(lines.join('\n'));
    const currentColumns = findColumns(lines);
    const moves = buildColumnTransitions(currentCards, currentColumns, panes, idleThreshold);
    if (moves.length === 0) break;
    lines = moveCard(lines, moves[0].card, moves[0].targetHeading);
  }

  writeFileSync(dashboardPath, lines.join('\n'));
}
