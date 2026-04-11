import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function getLastActivity(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  let latest = null;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      const stat = statSync(join(dir, entry.name));
      if (latest === null || stat.mtime > latest) {
        latest = stat.mtime;
      }
    } catch {
      continue;
    }
  }
  return latest;
}
