import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** Resolve existing ancestors as well as paths that have not been created yet. */
export function canonicalPath(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) {
    return realpathSync(absolute);
  }
  const parent = dirname(absolute);
  if (parent === absolute) {
    return absolute;
  }
  return join(canonicalPath(parent), basename(absolute));
}
