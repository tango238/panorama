import { readFileSync, existsSync as fsExistsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig as defaultLoadConfig } from '../lib/config.js';
import {
  splitCards,
  extractCardFields,
  findColumns,
  getCardColumn,
} from '../lib/parse-dashboard.js';

const STATE_HEADINGS = [
  '## 🟢 対応中',
  '## 🟡 入力待ち',
  '## 🔴 ブロック中',
];

const TITLE_RE = /^-\s+(?:\[[ xX]\]\s+)?\*\*(.+?)\*\*\s*$/;

function parseListArgs(args) {
  let all = false;
  let configPath = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all' || arg === '-a') {
      all = true;
    } else if (arg === '--config') {
      const value = args[i + 1];
      if (value === undefined) return { error: '--config requires a value' };
      configPath = value;
      i++;
    } else {
      return { error: `unknown argument: ${arg}` };
    }
  }
  return { all, configPath };
}

function defaultConfigPath() {
  return join(homedir(), '.config/panorama/config.yaml');
}

const defaultIO = {
  existsSync: fsExistsSync,
  readFile: (p) => readFileSync(p, 'utf8'),
  loadConfig: defaultLoadConfig,
};

function extractTitle(body) {
  const firstLine = body.split(/\r?\n/)[0] ?? '';
  const m = firstLine.match(TITLE_RE);
  return m ? m[1] : firstLine.replace(/^-\s+/, '').trim();
}

export function groupCardsByColumn(text) {
  const lines = text.split(/\r?\n/);
  const columns = findColumns(lines);
  const cards = splitCards(text);
  const grouped = new Map();
  for (const col of columns) {
    grouped.set(col.heading, []);
  }
  for (const card of cards) {
    const col = getCardColumn(card, columns);
    if (!col) continue;
    grouped.get(col.heading).push({
      title: extractTitle(card.body),
      fields: extractCardFields(card.body),
    });
  }
  return grouped;
}

export function formatList(grouped, { all = false } = {}) {
  const out = [];
  for (const [heading, cards] of grouped) {
    if (!all && !STATE_HEADINGS.includes(heading)) continue;
    out.push(heading.replace(/^##\s+/, ''));
    if (cards.length === 0) {
      out.push('  (なし)');
      continue;
    }
    for (const { title, fields } of cards) {
      const flag = fields.blocked ? ' [BLOCK]' : '';
      out.push(`  - ${title}${flag}`);
      if (fields.path) out.push(`      ${fields.path}`);
      const meta = [];
      if (fields.pc) meta.push(`pc=${fields.pc}`);
      if (fields.tmux) meta.push(`tmux=${fields.tmux}`);
      if (fields.branch) meta.push(`branch=${fields.branch}`);
      if (fields.session) meta.push(`session=${fields.session.slice(0, 8)}`);
      if (meta.length > 0) out.push(`      ${meta.join('  ')}`);
    }
  }
  return out.join('\n') + '\n';
}

export async function runList({
  args,
  stdout = process.stdout,
  stderr = process.stderr,
  configPath,
  io = defaultIO,
}) {
  const parsed = parseListArgs(args);
  if (parsed.error) {
    stderr.write(`panorama list: ${parsed.error}\n`);
    stderr.write('Usage: panorama list [--all]\n');
    return 2;
  }

  const cfgPath = parsed.configPath ?? configPath ?? defaultConfigPath();
  if (!io.existsSync(cfgPath)) {
    stderr.write(`panorama list: config not found at ${cfgPath}\n`);
    return 1;
  }

  let cfg;
  try {
    cfg = io.loadConfig(cfgPath);
  } catch (err) {
    stderr.write(`panorama list: failed to read config: ${err.message}\n`);
    return 1;
  }

  const dashboardPath = join(cfg.vault_path, cfg.dashboard_file);
  if (!io.existsSync(dashboardPath)) {
    stderr.write(`panorama list: dashboard not found at ${dashboardPath}\n`);
    return 1;
  }

  let text;
  try {
    text = io.readFile(dashboardPath);
  } catch (err) {
    stderr.write(`panorama list: failed to read dashboard: ${err.message}\n`);
    return 1;
  }

  const grouped = groupCardsByColumn(text);
  stdout.write(formatList(grouped, { all: parsed.all }));
  return 0;
}
