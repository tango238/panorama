import * as defaultTmux from '../lib/tmux-session.js';
import { pick as defaultPick } from '../lib/picker.js';

export function formatSessionItem(session) {
  const namePart = session.name.padEnd(12, ' ');
  const winLabel = session.windows === 1 ? 'window' : 'windows';
  const windowsPart = `${session.windows} ${winLabel}`;
  const attachedPart = session.attached ? ' (attached)' : '';
  return `${namePart}  ${windowsPart}${attachedPart}`;
}

export async function runAttach({
  args,
  tmux = defaultTmux,
  pick = defaultPick,
  stderr = process.stderr,
}) {
  if (args.length > 1) {
    stderr.write('panorama attach: too many arguments\n');
    stderr.write('Usage: panorama attach [<session-name>]\n');
    return 2;
  }

  if (!tmux.isTmuxAvailable()) {
    stderr.write('panorama attach: tmux not found\n');
    return 1;
  }

  if (args.length === 1) {
    const name = args[0];
    if (!tmux.hasSession(name)) {
      stderr.write(`panorama attach: session '${name}' not found\n`);
      return 1;
    }
    try {
      return tmux.attachOrSwitch(name);
    } catch (err) {
      stderr.write(`panorama attach: ${err.message}\n`);
      return 1;
    }
  }

  const sessions = tmux.listSessions();
  if (sessions.length === 0) {
    stderr.write('panorama attach: no tmux sessions\n');
    return 1;
  }

  const items = sessions.map(formatSessionItem);
  let index;
  try {
    index = await pick({
      items,
      header: 'Select tmux session (↑/↓ to move, Enter to select, q to quit):',
    });
  } catch (err) {
    if (err.code === 'SIGINT') return 130;
    stderr.write(`panorama attach: ${err.message}\n`);
    return 2;
  }

  if (index === null) return 0;

  try {
    return tmux.attachOrSwitch(sessions[index].name);
  } catch (err) {
    stderr.write(`panorama attach: ${err.message}\n`);
    return 1;
  }
}
