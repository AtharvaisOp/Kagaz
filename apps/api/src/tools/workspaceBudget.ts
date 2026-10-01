import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { HeavyToolError } from './errors.js';

/** Bounds the aggregate intermediates as well as the runner's individual file limit. */
export function watchWorkspaceBudget(
  directory: string,
  controller: AbortController,
) {
  let pending = Promise.resolve();
  let stopped = false;
  const scan = async () => {
    let bytes = 0,
      entries = 0;
    const visit = async (path: string, depth: number): Promise<void> => {
      if (depth > 16) throw new Error('workspace nesting');
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (stopped) return;
        if (++entries > 4096) throw new Error('workspace entries');
        const child = join(path, entry.name);
        if (entry.isSymbolicLink()) throw new Error('workspace link');
        try {
          if (entry.isDirectory()) await visit(child, depth + 1);
          else bytes += (await lstat(child)).size;
        } catch (error) {
          // Engines remove intermediates while this asynchronous inventory runs.
          if (!(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          ))
            throw error;
        }
        if (bytes > 192 * 1024 * 1024) throw new Error('workspace bytes');
      }
    };
    try {
      await visit(directory, 0);
    } catch {
      controller.abort(new HeavyToolError('ocr-failed'));
    }
  };
  let scanning = false;
  const timer = setInterval(() => {
    if (scanning || stopped) return;
    scanning = true;
    pending = scan().finally(() => {
      scanning = false;
    });
  }, 500);
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}
