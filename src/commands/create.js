import { readFileSync, writeFileSync, existsSync as fsExistsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as defaultTmux from '../lib/tmux-session.js';
import { loadConfig as defaultLoadConfig } from '../lib/config.js';
import {
  buildCardMarkdown,
  insertCardAtActive,
  hasActiveCardForPath,
} from '../lib/dashboard-card.js';

function parseCreateArgs(args) {
  if (args.length === 0) return { error: 'missing session name' };
  const [name, ...rest] = args;
  if (typeof name !== 'string' || name.length === 0) {
    return { error: 'missing session name' };
  }
  let task = null;
  let register = true;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--task') {
      const value = rest[i + 1];
      if (value === undefined) return { error: '--task requires a value' };
      task = value;
      i++;
    } else if (rest[i] === '--no-register') {
      register = false;
    } else {
      return { error: `unknown argument: ${rest[i]}` };
    }
  }
  return { name, task, register };
}

function defaultPcName() {
  try {
    return execFileSync('scutil', ['--get', 'ComputerName'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    try {
      return execFileSync('hostname', ['-s'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return 'unknown';
    }
  }
}

function defaultConfigPath() {
  return join(homedir(), '.config/panorama/config.yaml');
}

const defaultIO = {
  existsSync: fsExistsSync,
  readFile: (p) => readFileSync(p, 'utf8'),
  writeFile: (p, t) => writeFileSync(p, t),
  loadConfig: defaultLoadConfig,
};

function prepareDashboardRegistration({ cwd, sessionName, task, pcName, configPath, io }) {
  if (!io.existsSync(configPath)) {
    return { skip: true, reason: `config not found at ${configPath}` };
  }
  const cfg = io.loadConfig(configPath);
  const dashboardPath = join(cfg.vault_path, cfg.dashboard_file);
  if (!io.existsSync(dashboardPath)) {
    return { skip: true, reason: `dashboard not found at ${dashboardPath}` };
  }
  const text = io.readFile(dashboardPath);
  if (hasActiveCardForPath(text, cwd)) {
    return {
      error: `a card for path '${cwd}' already exists in 🟢/🟡/🔴 of ${dashboardPath}`,
    };
  }
  const project = basename(cwd);
  const card = buildCardMarkdown({
    project,
    task: task ?? sessionName,
    path: cwd,
    pc: pcName,
    tmux: sessionName,
  });
  const updated = insertCardAtActive(text, card);
  if (updated === null) {
    return { skip: true, reason: `active column heading not found in ${dashboardPath}` };
  }
  return { apply: { dashboardPath, updated } };
}

export async function runCreate({
  args,
  tmux = defaultTmux,
  cwd = process.cwd(),
  stderr = process.stderr,
  stdout = process.stdout,
  pcName,
  configPath,
  io = defaultIO,
}) {
  const parsed = parseCreateArgs(args);
  if (parsed.error) {
    stderr.write(`panorama create: ${parsed.error}\n`);
    stderr.write('Usage: panorama create <session-name> [--task <name>] [--no-register]\n');
    return 2;
  }

  if (!tmux.isTmuxAvailable()) {
    stderr.write('panorama create: tmux not found\n');
    return 1;
  }

  if (tmux.hasSession(parsed.name)) {
    stderr.write(
      `panorama create: session '${parsed.name}' already exists. Use 'panorama attach ${parsed.name}' instead.\n`
    );
    return 1;
  }

  let prep = null;
  if (parsed.register) {
    try {
      prep = prepareDashboardRegistration({
        cwd,
        sessionName: parsed.name,
        task: parsed.task,
        pcName: pcName ?? defaultPcName(),
        configPath: configPath ?? defaultConfigPath(),
        io,
      });
    } catch (err) {
      prep = { skip: true, reason: `dashboard read failed: ${err.message}` };
    }
    if (prep.error) {
      stderr.write(`panorama create: ${prep.error}\n`);
      return 1;
    }
    if (prep.skip) {
      stderr.write(`panorama create: skipping dashboard registration — ${prep.reason}\n`);
    }
  }

  try {
    tmux.createSession(parsed.name, cwd);
    tmux.renameWindow(parsed.name, parsed.task ?? parsed.name);
  } catch (err) {
    stderr.write(`panorama create: ${err.message}\n`);
    return 1;
  }

  if (prep?.apply) {
    try {
      io.writeFile(prep.apply.dashboardPath, prep.apply.updated);
      stdout.write(`panorama create: added card to ${prep.apply.dashboardPath}\n`);
    } catch (err) {
      stderr.write(`panorama create: dashboard write failed: ${err.message}\n`);
    }
  }

  try {
    return tmux.attachOrSwitch(parsed.name);
  } catch (err) {
    stderr.write(`panorama create: ${err.message}\n`);
    return 1;
  }
}
