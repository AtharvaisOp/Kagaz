import { readdir, lstat, realpath, readlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { HeavyToolError } from './errors.js';
import type { HeavyToolErrorCode } from '@kagaz/shared-types';

/** Bounds the aggregate intermediates as well as the runner's individual file limit. */
export function watchWorkspaceBudget(
  directory: string,
  controller: AbortController,
  policy: { readonly bytes: number; readonly error: HeavyToolErrorCode },
) {
  let pending = Promise.resolve();
  let stopped = false;
  const scan = async () => {
    let bytes = 0,
      entries = 0;
    let workspaceRoot = directory;
    const inside = (target: string) => {
      const path = relative(workspaceRoot, target);
      return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
    };
    const visit = async (path: string, depth: number): Promise<void> => {
      if (depth > 16) throw new Error('workspace nesting');
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (stopped) return;
        if (++entries > 4096) throw new Error('workspace entries');
        const child = join(path, entry.name);
        try {
          if (entry.isSymbolicLink()) {
            // OCRmyPDF links its own intermediates. Never traverse links or permit
            // targets outside the private workspace, including dangling external links.
            const target = resolve(dirname(child), await readlink(child));
            if (!inside(target) || !inside(await realpath(child)))
              throw new Error('workspace link');
            bytes += (await lstat(child)).size;
          } else if (entry.isDirectory()) await visit(child, depth + 1);
          else bytes += (await lstat(child)).size;
        } catch (error) {
          // Engines remove intermediates while this asynchronous inventory runs.
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          ) {
            // ENOENT from realpath is not proof that the entry disappeared.
            // An existing dangling link has no verified canonical destination.
            if (entry.isSymbolicLink()) {
              try {
                await lstat(child);
              } catch (missing) {
                if (
                  missing instanceof Error &&
                  'code' in missing &&
                  missing.code === 'ENOENT'
                )
                  continue;
                throw missing;
              }
              throw error;
            }
          } else throw error;
        }
        if (bytes > policy.bytes) throw new Error('workspace bytes');
      }
    };
    try {
      workspaceRoot = await realpath(directory);
      await visit(directory, 0);
    } catch {
      controller.abort(new HeavyToolError(policy.error));
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
