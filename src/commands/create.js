import * as defaultTmux from '../lib/tmux-session.js';

function parseCreateArgs(args) {
  if (args.length === 0) return { error: 'missing session name' };
  const [name, ...rest] = args;
  let task = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--task') {
      const value = rest[i + 1];
      if (value === undefined) return { error: '--task requires a value' };
      task = value;
      i++;
    } else {
      return { error: `unknown argument: ${rest[i]}` };
    }
  }
  return { name, task };
}

export async function runCreate({
  args,
  tmux = defaultTmux,
  cwd = process.cwd(),
  stderr = process.stderr,
}) {
  const parsed = parseCreateArgs(args);
  if (parsed.error) {
    stderr.write(`panorama create: ${parsed.error}\n`);
    stderr.write('Usage: panorama create <session-name> [--task <name>]\n');
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

  try {
    tmux.createSession(parsed.name, cwd);
    tmux.renameWindow(parsed.name, parsed.task ?? parsed.name);
    return tmux.attachOrSwitch(parsed.name);
  } catch (err) {
    stderr.write(`panorama create: ${err.message}\n`);
    return 1;
  }
}
