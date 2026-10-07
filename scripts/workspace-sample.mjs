import fs from 'node:fs';
import { join } from 'node:path';

// Workspaces can disappear while a request finishes. Only those disappearance
// races are optional samples; other filesystem failures must remain visible.
export function sampleWorkspaceBytes(root, fsImpl = fs) {
  const isRemoved = (error) =>
    error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
  const entries = (path) => {
    try {
      return fsImpl.readdirSync(path);
    } catch (error) {
      if (isRemoved(error)) return [];
      throw error;
    }
  };
  let bytes = 0;
  const walk = (path) => {
    let info;
    try {
      info = fsImpl.lstatSync(path);
    } catch (error) {
      if (isRemoved(error)) return;
      throw error;
    }
    if (info.isDirectory() && !info.isSymbolicLink()) {
      for (const entry of entries(path)) walk(join(path, entry));
      return;
    }
    // Count the link's own metadata, never its target's files.
    bytes += info.size;
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error('Invalid sample size.');
    }
  };

  try {
    for (const entry of entries(root)) {
      if (entry.startsWith('kagaz-')) walk(join(root, entry));
    }
    return bytes;
  } catch {
    // Native temporary names and private paths must not reach CI diagnostics.
    throw new Error('Workspace sampling failed.');
  }
}
