import {
  splitCards,
  extractCardFields,
  findColumns,
  getCardColumn,
} from './parse-dashboard.js';

export const ACTIVE_HEADING = '## 🟢 対応中';
export const ACTIVE_STATE_HEADINGS = [
  '## 🟢 対応中',
  '## 🟡 入力待ち',
  '## 🔴 ブロック中',
];

export function buildCardMarkdown({ project, task, path, pc, tmux }) {
  const lines = [
    `- [ ] **${project} / ${task}**`,
    `\t- **path:** ${path}`,
    `\t- **pc:** ${pc}`,
  ];
  if (tmux) lines.push(`\t- **tmux:** ${tmux}`);
  lines.push(`\t- → [[projects/${project}]]`);
  return lines.join('\n');
}

export function insertCardAtActive(text, cardMarkdown) {
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex(l => l.trim() === ACTIVE_HEADING);
  if (idx === -1) return null;
  const result = [
    ...lines.slice(0, idx + 1),
    '',
    cardMarkdown,
    ...lines.slice(idx + 1),
  ];
  return result.join('\n');
}

export function hasActiveCardForPath(text, targetPath) {
  const cards = splitCards(text);
  const lines = text.split(/\r?\n/);
  const columns = findColumns(lines);
  for (const card of cards) {
    const col = getCardColumn(card, columns);
    if (!col) continue;
    if (!ACTIVE_STATE_HEADINGS.includes(col.heading)) continue;
    const fields = extractCardFields(card.body);
    if (fields.path === targetPath) return true;
  }
  return false;
}
