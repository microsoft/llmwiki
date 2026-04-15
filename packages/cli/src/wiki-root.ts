import { join } from 'node:path';
import { WIKI_DIR_NAME } from '@llmwiki/shared';

/**
 * Resolve the wiki root directory from a user-supplied project path.
 * The wiki root is always `<projectPath>/.wiki/`.
 *
 * All shared library functions expect the wiki root (containing `raw/` and `wiki/`).
 * The CLI `--path` option points to the project folder; this helper bridges the two.
 */
export function resolveWikiRoot(projectPath: string): string {
  return join(projectPath, WIKI_DIR_NAME);
}
