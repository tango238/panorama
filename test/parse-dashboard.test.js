import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitCards,
  extractCardFields,
  rewriteAutoField,
  findColumns,
  getCardColumn,
  moveCard,
} from '../src/lib/parse-dashboard.js';

const DASHBOARD = `---
kanban-plugin: board
---

## 🟢 対応中

- **project-a / task-1**
\t- **tmux:** \`session:window\` (window #1, pane #1)
\t- **path:** /Users/go/work/project-a
\t- **alive:** ✅ <!-- auto -->
\t- **branch:** main <!-- auto -->
\t- **last-commit:** 1h ago · fix bug <!-- auto -->
\t- **last-activity:** 30m ago <!-- auto -->
\t- → [[projects/project-a]]

## 🟡 入力待ち

- **project-b / task-2**
\t- **tmux:** \`session:window\` (window #1, pane #2)
\t- **path:** /Users/go/work/project-b
\t- **alive:** ✅ <!-- auto -->
\t- **branch:** feat/x <!-- auto -->
\t- **last-commit:** 2h ago · add feature <!-- auto -->
\t- **last-activity:** 1h ago <!-- auto -->
\t- → [[projects/project-b]]

## 🔴 ブロック中

## ✅ 完了

%% kanban:settings
\`\`\`
{"kanban-plugin":"board"}
\`\`\`
%%
`;

describe('splitCards', () => {
  it('finds all cards', () => {
    const cards = splitCards(DASHBOARD);
    assert.equal(cards.length, 2);
  });

  it('card body includes all sub-items', () => {
    const cards = splitCards(DASHBOARD);
    assert.ok(cards[0].body.includes('project-a / task-1'));
    assert.ok(cards[0].body.includes('**path:**'));
    assert.ok(cards[0].body.includes('**alive:**'));
    assert.ok(cards[0].body.includes('→ [[projects/project-a]]'));
  });

  it('does not include frontmatter --- as card', () => {
    const cards = splitCards(DASHBOARD);
    assert.ok(!cards.some(c => c.body.includes('kanban-plugin')));
  });

  it('does not include kanban settings as card', () => {
    const cards = splitCards(DASHBOARD);
    assert.ok(!cards.some(c => c.body.includes('kanban:settings')));
  });
});

describe('extractCardFields', () => {
  it('extracts all fields from card body', () => {
    const cards = splitCards(DASHBOARD);
    const fields = extractCardFields(cards[0].body);
    assert.equal(fields.path, '/Users/go/work/project-a');
    assert.equal(fields.branch, 'main');
    assert.equal(fields.alive, '✅');
  });

  it('extracts tmux field', () => {
    const cards = splitCards(DASHBOARD);
    const fields = extractCardFields(cards[0].body);
    assert.ok(fields.tmux.includes('session:window'));
  });
});

describe('rewriteAutoField', () => {
  it('rewrites auto field value', () => {
    const line = '\t- **branch:** main <!-- auto -->';
    const result = rewriteAutoField(line, 'branch', 'feat/new');
    assert.equal(result, '\t- **branch:** feat/new <!-- auto -->');
  });

  it('does not touch non-matching key', () => {
    const line = '\t- **branch:** main <!-- auto -->';
    const result = rewriteAutoField(line, 'alive', '✅');
    assert.equal(result, line);
  });

  it('does not touch line without auto marker', () => {
    const line = '\t- **path:** /some/path';
    const result = rewriteAutoField(line, 'path', '/other');
    assert.equal(result, line);
  });
});

describe('findColumns', () => {
  it('finds all column headings', () => {
    const lines = DASHBOARD.split(/\r?\n/);
    const columns = findColumns(lines);
    assert.equal(columns.length, 4);
    assert.ok(columns[0].heading.includes('🟢'));
    assert.ok(columns[1].heading.includes('🟡'));
  });
});

describe('getCardColumn', () => {
  it('returns correct column for each card', () => {
    const lines = DASHBOARD.split(/\r?\n/);
    const cards = splitCards(DASHBOARD);
    const columns = findColumns(lines);
    const col0 = getCardColumn(cards[0], columns);
    const col1 = getCardColumn(cards[1], columns);
    assert.ok(col0.heading.includes('🟢'));
    assert.ok(col1.heading.includes('🟡'));
  });
});

describe('moveCard', () => {
  it('moves card to target column', () => {
    const lines = DASHBOARD.split(/\r?\n/);
    const cards = splitCards(DASHBOARD);
    const result = moveCard(lines, cards[0], '## 🟡 入力待ち');
    const text = result.join('\n');

    // card-a should no longer be under 🟢
    const activeIdx = result.findIndex(l => l.includes('🟢'));
    const waitingIdx = result.findIndex(l => l.includes('🟡'));
    const between = result.slice(activeIdx + 1, waitingIdx);
    assert.ok(!between.some(l => l.includes('project-a')));

    // card-a should be under 🟡
    const waitIdx = result.findIndex(l => l.includes('🟡'));
    const blockIdx = result.findIndex(l => l.includes('🔴'));
    const waitSection = result.slice(waitIdx + 1, blockIdx);
    assert.ok(waitSection.some(l => l.includes('project-a')));
  });

  it('preserves card content after move', () => {
    const lines = DASHBOARD.split(/\r?\n/);
    const cards = splitCards(DASHBOARD);
    const result = moveCard(lines, cards[0], '## 🟡 入力待ち');
    const text = result.join('\n');
    assert.ok(text.includes('**path:** /Users/go/work/project-a'));
    assert.ok(text.includes('→ [[projects/project-a]]'));
  });

  it('preserves frontmatter', () => {
    const lines = DASHBOARD.split(/\r?\n/);
    const cards = splitCards(DASHBOARD);
    const result = moveCard(lines, cards[0], '## 🟡 入力待ち');
    assert.equal(result[0], '---');
    assert.ok(result[1].includes('kanban-plugin'));
    assert.equal(result[2], '---');
  });

  it('preserves other cards', () => {
    const lines = DASHBOARD.split(/\r?\n/);
    const cards = splitCards(DASHBOARD);
    const result = moveCard(lines, cards[0], '## 🟡 入力待ち');
    const text = result.join('\n');
    assert.ok(text.includes('project-b / task-2'));
  });

  it('does not corrupt file with multiple sequential moves', () => {
    let lines = DASHBOARD.split(/\r?\n/);

    // Move card-a from 🟢 to 🟡
    let cards = splitCards(lines.join('\n'));
    lines = moveCard(lines, cards[0], '## 🟡 入力待ち');

    // Move card-b from 🟡 to 🟢
    cards = splitCards(lines.join('\n'));
    const cardB = cards.find(c => c.body.includes('project-b'));
    lines = moveCard(lines, cardB, '## 🟢 対応中');

    const text = lines.join('\n');
    // Both cards should be intact
    assert.ok(text.includes('project-a / task-1'));
    assert.ok(text.includes('→ [[projects/project-a]]'));
    assert.ok(text.includes('project-b / task-2'));
    assert.ok(text.includes('→ [[projects/project-b]]'));
    // Frontmatter intact
    assert.ok(text.startsWith('---'));
    assert.ok(text.includes('kanban-plugin'));
  });
});
