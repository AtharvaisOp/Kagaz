import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { watchWorkspaceBudget } from './workspaceBudget.js';
import { OCR_POLICY } from './ocr.js';

const budget = {
  bytes: OCR_POLICY.workspaceBytes,
  error: 'ocr-failed',
} as const;

it('aborts OCR when aggregate intermediate files exceed its disk budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kagaz-budget-'));
  const controller = new AbortController();
  const stop = watchWorkspaceBudget(directory, controller, budget);
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
  const stop = watchWorkspaceBudget(directory, controller, budget);
  await stop();
  expect(controller.signal.aborted).toBe(false);
  expect(await readdir(directory)).toEqual([]);
  await rm(directory, { recursive: true, force: true });
});

it('permits OCRmyPDF links to private intermediates without traversing them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kagaz-budget-'));
  const controller = new AbortController();
  await mkdir(join(directory, 'data'));
  await writeFile(join(directory, 'data', 'input.pdf'), 'synthetic fixture');
  await symlink(
    join(directory, 'data'),
    join(directory, 'internal-link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const stop = watchWorkspaceBudget(directory, controller, budget);
  try {
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(controller.signal.aborted).toBe(false);
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it('rejects links that resolve outside the isolated workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kagaz-budget-'));
  const outside = await mkdtemp(join(tmpdir(), 'kagaz-budget-external-'));
  const controller = new AbortController();
  await symlink(
    outside,
    join(directory, 'external-link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const stop = watchWorkspaceBudget(directory, controller, budget);
  try {
    await new Promise<void>((resolve) =>
      controller.signal.addEventListener('abort', () => resolve(), {
        once: true,
      }),
    );
    expect(controller.signal.reason).toMatchObject({ code: 'ocr-failed' });
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

it('rejects an existing link whose canonical destination cannot be verified', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kagaz-budget-'));
  const target = join(directory, 'removed-target');
  await mkdir(target);
  await symlink(
    target,
    join(directory, 'dangling-link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await rm(target, { recursive: true });
  const controller = new AbortController();
  const stop = watchWorkspaceBudget(directory, controller, budget);
  try {
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
