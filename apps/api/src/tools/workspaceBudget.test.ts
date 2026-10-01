import { mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { watchWorkspaceBudget } from './workspaceBudget.js';

it('aborts OCR when aggregate intermediate files exceed its disk budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kagaz-budget-'));
  const controller = new AbortController();
  const stop = watchWorkspaceBudget(directory, controller);
  try {
    const file = await open(join(directory, 'large-intermediate'), 'w');
    await file.truncate(193 * 1024 * 1024);
    await file.close();
    await new Promise<void>((resolve) =>
      controller.signal.addEventListener('abort', () => resolve(), {
        once: true,
      }),
    );
    expect(controller.signal.reason).toMatchObject({ code: 'ocr-failed' });
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it('stops inventory before cleanup and permits normal private intermediates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kagaz-budget-'));
  const controller = new AbortController();
  const stop = watchWorkspaceBudget(directory, controller);
  await stop();
  expect(controller.signal.aborted).toBe(false);
  expect(await readdir(directory)).toEqual([]);
  await rm(directory, { recursive: true, force: true });
});
