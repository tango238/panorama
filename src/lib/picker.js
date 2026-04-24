export function interpretKey(key) {
  if (key === '\x1b[A' || key === 'k') return 'up';
  if (key === '\x1b[B' || key === 'j') return 'down';
  if (key === '\r' || key === '\n') return 'select';
  if (key === 'q' || key === '\x1b') return 'quit';
  if (key === '\x03') return 'interrupt';
  return null;
}

export function clampIndex(index, length) {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

/**
 * 矢印キー対話ピッカー。
 * @param {object} opts
 * @param {string[]} opts.items
 * @param {string} opts.header
 * @param {number} [opts.initialIndex=0]
 * @param {NodeJS.ReadStream} [opts.stdin=process.stdin]
 * @param {NodeJS.WriteStream} [opts.stdout=process.stdout]
 * @returns {Promise<number|null>} 選択 index、キャンセル時は null、interrupt 時は例外
 */
export function pick({
  items,
  header,
  initialIndex = 0,
  stdin = process.stdin,
  stdout = process.stdout,
}) {
  if (!Array.isArray(items) || items.length === 0) {
    return Promise.reject(new Error('picker: no items to select'));
  }
  if (!stdin.isTTY) {
    return Promise.reject(new Error('picker: not a tty'));
  }

  let index = clampIndex(initialIndex, items.length);
  const ALT_SCREEN_ON = '\x1b[?1049h';
  const ALT_SCREEN_OFF = '\x1b[?1049l';
  const CURSOR_HIDE = '\x1b[?25l';
  const CURSOR_SHOW = '\x1b[?25h';
  const CLEAR_SCREEN = '\x1b[2J\x1b[H';

  const render = () => {
    stdout.write(CLEAR_SCREEN);
    stdout.write(`${header}\n\n`);
    for (let i = 0; i < items.length; i++) {
      const prefix = i === index ? '> ' : '  ';
      stdout.write(`${prefix}${items[i]}\n`);
    }
  };

  const cleanup = () => {
    stdin.setRawMode?.(false);
    stdin.pause();
    stdout.write(CURSOR_SHOW);
    stdout.write(ALT_SCREEN_OFF);
  };

  return new Promise((resolve, reject) => {
    let resolved = false;
    const finish = (value, err) => {
      if (resolved) return;
      resolved = true;
      stdin.removeListener('data', onData);
      cleanup();
      if (err) reject(err);
      else resolve(value);
    };

    const onData = (chunk) => {
      const key = chunk.toString('utf8');
      const action = interpretKey(key);
      if (action === 'up') {
        index = clampIndex(index - 1, items.length);
        render();
      } else if (action === 'down') {
        index = clampIndex(index + 1, items.length);
        render();
      } else if (action === 'select') {
        finish(index);
      } else if (action === 'quit') {
        finish(null);
      } else if (action === 'interrupt') {
        finish(null, Object.assign(new Error('interrupted'), { code: 'SIGINT' }));
      }
    };

    stdout.write(ALT_SCREEN_ON);
    stdout.write(CURSOR_HIDE);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    render();
    stdin.on('data', onData);

    const onExit = () => cleanup();
    process.once('exit', onExit);
  });
}
