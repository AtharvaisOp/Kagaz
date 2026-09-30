import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function createTempWorkspace(root = tmpdir()) {
  const directory = await mkdtemp(join(root, 'kagaz-'));
  return {
    directory,
    input: join(directory, 'input.pdf'),
    output: join(directory, 'output.pdf'),
    // All paths originate here; user filenames are never accepted.
    cleanup: () =>
      rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      }),
  };
}
