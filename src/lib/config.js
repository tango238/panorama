// src/lib/config.js
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function expandHome(value) {
  if (typeof value !== 'string') return value;
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

function coerce(raw) {
  const trimmed = raw.trim();
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  return expandHome(trimmed);
}

export function parseConfig(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  let currentListKey = null;

  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && currentListKey) {
      result[currentListKey].push(coerce(listItem[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const value = kv[2];
      if (value === '') {
        result[key] = [];
        currentListKey = key;
      } else {
        result[key] = coerce(value);
        currentListKey = null;
      }
    }
  }
  return result;
}

export function loadConfig(path) {
  return parseConfig(readFileSync(path, 'utf8'));
}
