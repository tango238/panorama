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
