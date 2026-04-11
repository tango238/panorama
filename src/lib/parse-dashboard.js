const CARD_HEADING = /^### (?!次にやること|メモ)(.+)$/;
const COLUMN_HEADING = /^## /;

export function splitCards(text) {
  const lines = text.split(/\r?\n/);
  const cards = [];
  let currentStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (CARD_HEADING.test(line)) {
      if (currentStart !== -1) {
        cards.push({
          startLine: currentStart,
          endLine: i - 1,
          body: lines.slice(currentStart, i).join('\n'),
        });
      }
      currentStart = i;
    } else if (COLUMN_HEADING.test(line) && currentStart !== -1) {
      cards.push({
        startLine: currentStart,
        endLine: i - 1,
        body: lines.slice(currentStart, i).join('\n'),
      });
      currentStart = -1;
    }
  }
  if (currentStart !== -1) {
    cards.push({
      startLine: currentStart,
      endLine: lines.length - 1,
      body: lines.slice(currentStart).join('\n'),
    });
  }
  return cards;
}

const FIELD_LINE = /^-\s+\*\*([a-z-]+):\*\*\s+(.*?)(\s+<!--\s*auto\s*-->)?\s*$/;

export function extractCardFields(body) {
  const result = {};
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(FIELD_LINE);
    if (m) {
      result[m[1]] = m[2];
    }
  }
  return result;
}

export function rewriteAutoField(line, key, newValue) {
  const m = line.match(/^(\s*-\s+\*\*([a-z-]+):\*\*\s+)(.*?)(\s+<!--\s*auto\s*-->)\s*$/);
  if (!m) return line;
  if (m[2] !== key) return line;
  return `${m[1]}${newValue}${m[4]}`;
}
