import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitCards, extractCardFields, rewriteAutoField, findColumns, getCardColumn, moveCard } from './lib/parse-dashboard.js';
import { getBranch, getLastCommit } from './lib/git.js';
import { getLastActivity } from './lib/fs-activity.js';
import { formatRelative } from './lib/relative-time.js';
import { listPanes, parseTmuxField, classifyAlive, capturePaneContent, detectClaudeCodeState } from './lib/tmux.js';

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

const COL_ACTIVE = '## 🟢 対応中';
const COL_WAITING = '## 🟡 入力待ち';

function buildColumnTransitions(cards, columns, panes) {
  const moves = [];
  for (const card of cards) {
    const fields = extractCardFields(card.body);
    const currentCol = getCardColumn(card, columns);
    if (!currentCol) continue;

    const tmuxInfo = parseTmuxField(fields.tmux || '');
    if (!tmuxInfo) continue;

    const target = `${tmuxInfo.session}:${tmuxInfo.windowIndex}.${tmuxInfo.paneIndex}`;
    const content = capturePaneContent(target);
    const state = detectClaudeCodeState(content);
    if (state === null) continue;

    const inActive = currentCol.heading.includes('🟢');
    const inWaiting = currentCol.heading.includes('🟡');

    if (state === 'waiting' && inActive) {
      moves.push({ card, targetHeading: COL_WAITING });
    } else if (state === 'active' && inWaiting) {
      moves.push({ card, targetHeading: COL_ACTIVE });
    }
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
    const updates = buildCardUpdates(card, panes);
    applyUpdatesToLines(lines, card, updates);
  }

  // Phase 2: column transitions
  const updatedText = lines.join('\n');
  const freshCards = splitCards(updatedText);
  const columns = findColumns(lines);
  const moves = buildColumnTransitions(freshCards, columns, panes);

  for (const { card, targetHeading } of moves) {
    lines = moveCard(lines, card, targetHeading);
    // Re-parse after each move since line numbers shift
    const reparsed = splitCards(lines.join('\n'));
    const newColumns = findColumns(lines);
    const remaining = buildColumnTransitions(reparsed, newColumns, panes);
    if (remaining.length === 0) break;
  }

  writeFileSync(dashboardPath, lines.join('\n'));
}
