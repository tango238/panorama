const CARD_ITEM = /^- .+$/;
const COLUMN_HEADING = /^## /;

export function splitCards(text) {
  const lines = text.split(/\r?\n/);
  const cards = [];
  let currentStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (CARD_ITEM.test(line)) {
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

const FIELD_LINE = /^\s*-\s+\*\*([a-z-]+):\*\*\s+(.*?)(\s+<!--\s*auto\s*-->)?\s*$/;
const SESSION_COMMENT = /<!--\s*session:\s*([0-9a-f-]+)\s*(\|\s*blocked\s*)?-->/;

export function extractCardFields(body) {
  const result = {};
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(FIELD_LINE);
    if (m) {
      result[m[1]] = m[2];
    }
    const s = line.match(SESSION_COMMENT);
    if (s) {
      result.session = s[1];
      if (s[2]) result.blocked = true;
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

export function findColumns(lines) {
  const columns = [];
  for (let i = 0; i < lines.length; i++) {
    if (COLUMN_HEADING.test(lines[i])) {
      columns.push({ heading: lines[i].trim(), line: i });
    }
  }
  return columns;
}

export function getCardColumn(card, columns) {
  for (let i = columns.length - 1; i >= 0; i--) {
    if (columns[i].line < card.startLine) {
      return columns[i];
    }
  }
  return null;
}

export function moveCard(lines, card, targetColumnHeading) {
  const targetCol = lines.findIndex(l => l.trim() === targetColumnHeading);
  if (targetCol === -1) return lines;

  const cardContent = lines.slice(card.startLine, card.endLine + 1);

  const result = [
    ...lines.slice(0, card.startLine),
    ...lines.slice(card.endLine + 1),
  ];

  const newTargetCol = result.findIndex(l => l.trim() === targetColumnHeading);
  result.splice(newTargetCol + 1, 0, '', ...cardContent);

  return result;
}
