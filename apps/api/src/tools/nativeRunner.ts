import { spawn, spawnSync } from 'node:child_process';
import { checkAbort, HeavyToolError } from './errors.js';

export interface NativeRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
  readonly resourceLimits?: boolean;
  readonly limits?: {
    readonly addressSpace: number;
    readonly cpuSeconds: number;
    readonly fileBytes: number;
  };
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
          `--as=${request.limits?.addressSpace ?? 402653184}`,
          `--cpu=${request.limits?.cpuSeconds ?? 60}`,
          `--fsize=${request.limits?.fileBytes ?? 41943040}`,
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
        OMP_THREAD_LIMIT: '1',
        OPENBLAS_NUM_THREADS: '1',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    });
    let stdout = Buffer.alloc(0),
      stderr = Buffer.alloc(0);
    let failure: HeavyToolError | null = null;
    let termination: Promise<void> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, signal);
        else if (child.pid) {
          // OCRmyPDF has descendants. Terminating only Python would leave OCR running.
          spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
            timeout: 5000,
          });
        }
      } catch {
        /* Process may have already exited. */
      }
    };
    const stop = (error: HeavyToolError) => {
      if (failure) return;
      failure = error;
      kill('SIGTERM');
      // Do not cancel escalation when the parent closes: a descendant may ignore TERM.
      termination = new Promise<void>((resolve) => {
        setTimeout(() => {
          kill('SIGKILL');
          resolve();
        }, 250);
      });
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
      request.signal.removeEventListener('abort', abort);
      if (failure) {
        const error = failure;
        void (termination ?? Promise.resolve()).then(() => reject(error));
      } else if (code === null) reject(new HeavyToolError('processing-failed'));
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
