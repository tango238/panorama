import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCardMarkdown,
  insertCardAtActive,
  hasActiveCardForPath,
} from '../src/lib/dashboard-card.js';

test('buildCardMarkdown: includes all fields when tmux present', () => {
  const md = buildCardMarkdown({
    project: 'panorama',
    task: 'verify',
    path: '/Users/me/work/panorama',
    pc: 'MacBook',
    tmux: 'panorama',
  });
  assert.equal(
    md,
    [
      '- [ ] **panorama / verify**',
      '\t- **path:** /Users/me/work/panorama',
      '\t- **pc:** MacBook',
      '\t- **tmux:** panorama',
      '\t- → [[projects/panorama]]',
    ].join('\n')
  );
});

test('buildCardMarkdown: omits tmux line when tmux empty', () => {
  const md = buildCardMarkdown({
    project: 'panorama',
    task: 'verify',
    path: '/Users/me/work/panorama',
    pc: 'MacBook',
    tmux: '',
  });
  assert.ok(!md.includes('**tmux:**'));
  assert.ok(md.includes('**pc:** MacBook\n\t- → [[projects/panorama]]'));
});

test('insertCardAtActive: inserts card directly after 🟢 heading', () => {
  const text = [
    '## 🟢 対応中',
    '',
    '- [ ] **existing / task**',
    '\t- **path:** /x',
    '',
    '## 🟡 入力待ち',
  ].join('\n');

  const card = buildCardMarkdown({
    project: 'foo',
    task: 'bar',
    path: '/y',
    pc: 'pc',
    tmux: 'sess',
  });
  const updated = insertCardAtActive(text, card);
  assert.ok(updated !== null);
  const lines = updated.split('\n');
  assert.equal(lines[0], '## 🟢 対応中');
  assert.equal(lines[1], '');
  assert.equal(lines[2], '- [ ] **foo / bar**');
  assert.ok(updated.indexOf('- [ ] **foo / bar**') < updated.indexOf('- [ ] **existing / task**'));
});

test('insertCardAtActive: returns null when heading not found', () => {
  const text = '## Something else\n\n- [ ] **x / y**';
  assert.equal(insertCardAtActive(text, 'card'), null);
});

test('hasActiveCardForPath: true when path exists in 🟢', () => {
  const text = [
    '## 🟢 対応中',
    '',
    '- [ ] **foo / bar**',
    '\t- **path:** /workspace/foo',
    '',
    '## ✅ 完了',
  ].join('\n');
  assert.equal(hasActiveCardForPath(text, '/workspace/foo'), true);
});

test('hasActiveCardForPath: true when path exists in 🟡', () => {
  const text = [
    '## 🟢 対応中',
    '',
    '## 🟡 入力待ち',
    '',
    '- [ ] **foo / bar**',
    '\t- **path:** /workspace/foo',
  ].join('\n');
  assert.equal(hasActiveCardForPath(text, '/workspace/foo'), true);
});

test('hasActiveCardForPath: true when path exists in 🔴', () => {
  const text = [
    '## 🟢 対応中',
    '',
    '## 🔴 ブロック中',
    '',
    '- [ ] **foo / bar**',
    '\t- **path:** /workspace/foo',
  ].join('\n');
  assert.equal(hasActiveCardForPath(text, '/workspace/foo'), true);
});

test('hasActiveCardForPath: false when path only in ✅完了', () => {
  const text = [
    '## 🟢 対応中',
    '',
    '## ✅ 完了',
    '',
    '- [ ] **foo / bar**',
    '\t- **path:** /workspace/foo',
  ].join('\n');
  assert.equal(hasActiveCardForPath(text, '/workspace/foo'), false);
});

test('hasActiveCardForPath: false when path not found', () => {
  const text = [
    '## 🟢 対応中',
    '',
    '- [ ] **foo / bar**',
    '\t- **path:** /workspace/foo',
  ].join('\n');
  assert.equal(hasActiveCardForPath(text, '/workspace/other'), false);
});
