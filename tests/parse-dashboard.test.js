import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCards, extractCardFields, rewriteAutoField } from '../src/lib/parse-dashboard.js';

const sampleDashboard = `---
kanban-plugin: basic
---

## 🟢 対応中

### project-a / feat login

- **tmux:** \`work:feat-login\` (window #2, pane #1)
- **path:** /tmp/project-a
- **alive:** ✅ <!-- auto -->
- **branch:** main <!-- auto -->
- **last-commit:** (n/a) <!-- auto -->
- **last-activity:** (n/a) <!-- auto -->

### 次にやること
- [ ] hook up API

### project-b / refactor

- **tmux:** (tmux外)
- **path:** /tmp/project-b
- **alive:** (tmux外) <!-- auto -->
- **branch:** (n/a) <!-- auto -->
- **last-commit:** (n/a) <!-- auto -->
- **last-activity:** (n/a) <!-- auto -->

## 🟡 入力待ち

## ✅ 完了
`;

test('splitCards: returns one block per card', () => {
  const cards = splitCards(sampleDashboard);
  assert.equal(cards.length, 2);
  assert.match(cards[0].body, /project-a \/ feat login/);
  assert.match(cards[1].body, /project-b \/ refactor/);
});

test('splitCards: records start/end line indices', () => {
  const cards = splitCards(sampleDashboard);
  assert.ok(cards[0].endLine > cards[0].startLine);
  assert.ok(cards[1].startLine > cards[0].endLine);
});

test('extractCardFields: tmux and path', () => {
  const cards = splitCards(sampleDashboard);
  const fields = extractCardFields(cards[0].body);
  assert.equal(fields.tmux, '`work:feat-login` (window #2, pane #1)');
  assert.equal(fields.path, '/tmp/project-a');
});

test('extractCardFields: (tmux外) card', () => {
  const cards = splitCards(sampleDashboard);
  const fields = extractCardFields(cards[1].body);
  assert.equal(fields.tmux, '(tmux外)');
  assert.equal(fields.path, '/tmp/project-b');
});

test('rewriteAutoField: replaces marked value in-place', () => {
  const before = '- **branch:** main <!-- auto -->';
  const after = rewriteAutoField(before, 'branch', 'feature/login');
  assert.equal(after, '- **branch:** feature/login <!-- auto -->');
});

test('rewriteAutoField: leaves non-auto line alone', () => {
  const before = '- **branch:** main';
  const after = rewriteAutoField(before, 'branch', 'feature/login');
  assert.equal(after, '- **branch:** main');
});

test('rewriteAutoField: leaves unrelated key alone', () => {
  const before = '- **alive:** ✅ <!-- auto -->';
  const after = rewriteAutoField(before, 'branch', 'feature/login');
  assert.equal(after, '- **alive:** ✅ <!-- auto -->');
});
