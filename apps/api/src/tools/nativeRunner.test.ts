import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runNative } from './nativeRunner.js';

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'kagaz-runner-test-'));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});
function run(
  code: string,
  signal = new AbortController().signal,
  timeoutMs = 5000,
  extra: string[] = [],
) {
  return runNative({
    executable: process.execPath,
    args: ['-e', code, ...extra],
    cwd,
    signal,
    timeoutMs,
    resourceLimits: false,
  });
}
describe('native process lifecycle', () => {
  it('passes arguments literally without invoking a shell and captures exit status', async () => {
    const trick = '$(touch escaped); & ..\\secret.pdf';
    const result = await run(
      'process.stdout.write(process.argv[1]); process.exitCode=7',
      undefined,
      5000,
      [trick],
    );
    expect(result.stdout).toBe(trick);
    expect(result.exitCode).toBe(7);
  });
  it('bounds both diagnostic streams while continuing to drain them', async () => {
    const result = await run(
      'process.stdout.write("x".repeat(100000)); process.stderr.write("y".repeat(100000))',
    );
    expect(Buffer.byteLength(result.stdout)).toBe(16384);
    expect(Buffer.byteLength(result.stderr)).toBe(16384);
  });
  it('terminates timeout processes and waits for close', async () => {
    await expect(
      run('setInterval(()=>{},1000)', undefined, 150),
    ).rejects.toMatchObject({ code: 'processing-timeout' });
  });
  it('terminates on cancellation, including processes ignoring SIGTERM', async () => {
    const controller = new AbortController();
    const task = expect(
      run(
        'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)',
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
    setTimeout(() => controller.abort(), 300);
    await task;
  });
  it('maps missing binaries to safe structured errors', async () => {
    await expect(
      runNative({
        executable: join(cwd, 'missing'),
        args: [],
        cwd,
        signal: new AbortController().signal,
        resourceLimits: false,
      }),
    ).rejects.toMatchObject({
      code: 'processing-failed',
    });
  });
});
