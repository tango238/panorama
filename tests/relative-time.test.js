import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRelative } from '../src/lib/relative-time.js';

test('formatRelative: just now', () => {
  const now = new Date('2026-04-11T10:00:00Z');
  const d = new Date('2026-04-11T09:59:30Z');
  assert.equal(formatRelative(d, now), 'just now');
});

test('formatRelative: minutes ago', () => {
  const now = new Date('2026-04-11T10:00:00Z');
  const d = new Date('2026-04-11T09:50:00Z');
  assert.equal(formatRelative(d, now), '10 minutes ago');
});

test('formatRelative: 1 minute ago (singular)', () => {
  const now = new Date('2026-04-11T10:00:00Z');
  const d = new Date('2026-04-11T09:59:00Z');
  assert.equal(formatRelative(d, now), '1 minute ago');
});

test('formatRelative: hours ago', () => {
  const now = new Date('2026-04-11T10:00:00Z');
  const d = new Date('2026-04-11T08:00:00Z');
  assert.equal(formatRelative(d, now), '2 hours ago');
});

test('formatRelative: days ago', () => {
  const now = new Date('2026-04-11T10:00:00Z');
  const d = new Date('2026-04-08T10:00:00Z');
  assert.equal(formatRelative(d, now), '3 days ago');
});
