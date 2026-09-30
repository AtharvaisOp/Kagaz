import { spawn } from 'node:child_process';
import { checkAbort, HeavyToolError } from './errors.js';

export interface NativeRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
  readonly resourceLimits?: boolean;
}

export interface NativeResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type NativeRunner = (request: NativeRequest) => Promise<NativeResult>;
const DIAGNOSTIC_LIMIT = 16 * 1024;

/** Resolves only after close, so callers may safely remove files after termination. */
export const runNative: NativeRunner = (request) => {
  checkAbort(request.signal);
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const limited =
      process.platform === 'linux' && request.resourceLimits !== false;
    const executable = limited ? '/usr/bin/prlimit' : request.executable;
    const args = limited
      ? [
          '--as=402653184',
          '--cpu=60',
          '--fsize=41943040',
          '--',
          request.executable,
          ...request.args,
        ]
      : [...request.args];
    const child = spawn(executable, args, {
      cwd: request.cwd,
      shell: false,
      windowsHide: true,
      detached: grouped,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Native tools do not inherit application secrets or Ghostscript option overrides.
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: request.cwd,
        TMP: request.cwd,
        TMPDIR: request.cwd,
        HOME: request.cwd,
        LANG: 'C',
      },
    });
    let stdout = Buffer.alloc(0),
      stderr = Buffer.alloc(0);
    let failure: HeavyToolError | null = null;
    let escalation: NodeJS.Timeout | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* Process may have already exited. */
      }
    };
    const stop = (error: HeavyToolError) => {
      if (failure) return;
      failure = error;
      kill('SIGTERM');
      escalation = setTimeout(() => kill('SIGKILL'), 250);
    };
    const abort = () =>
      stop(
        request.signal.reason instanceof HeavyToolError
          ? request.signal.reason
          : new HeavyToolError('cancelled'),
      );
    const timeout = setTimeout(
      () => stop(new HeavyToolError('processing-timeout')),
      request.timeoutMs ?? 60_000,
    );
    request.signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < DIAGNOSTIC_LIMIT)
        stdout = Buffer.concat([
          stdout,
          chunk.subarray(0, DIAGNOSTIC_LIMIT - stdout.length),
        ]);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < DIAGNOSTIC_LIMIT)
        stderr = Buffer.concat([
          stderr,
          chunk.subarray(0, DIAGNOSTIC_LIMIT - stderr.length),
        ]);
    });
    child.on('error', () => {
      failure ??= new HeavyToolError('processing-failed');
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      clearTimeout(escalation);
      request.signal.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code === null) reject(new HeavyToolError('processing-failed'));
      else
        resolve({
          exitCode: code,
          stdout: stdout.toString('utf8'),
          stderr: stderr.toString('utf8'),
        });
    });
    if (request.signal.aborted) abort();
  });
};
