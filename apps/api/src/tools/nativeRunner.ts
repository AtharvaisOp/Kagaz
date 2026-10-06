import { spawn, spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
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
export const DEFAULT_NATIVE_POLICY = {
  timeoutMs: 60_000,
  limits: {
    addressSpace: 384 * 1024 * 1024,
    cpuSeconds: 60,
    fileBytes: 40 * 1024 * 1024,
  },
} as const;

async function waitForLinuxGroup(group: number): Promise<void> {
  // The parent close event cannot acknowledge descendants with independent
  // stdio. SIGKILL stops user code; wait for kernel exit before files are removed.
  // Reaped or zombie descendants cannot write. Container init reaps the latter.
  for (;;) {
    const processes = (await readdir('/proc')).filter((name) =>
      /^\d+$/.test(name),
    );
    let living = false;
    for (const pid of processes) {
      try {
        const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ');
        if (Number(fields[2]) === group && fields[0] !== 'Z') {
          living = true;
          break;
        }
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          (error.code === 'ENOENT' || error.code === 'ESRCH')
        ))
          throw error;
      }
    }
    if (!living) return;
    // Retain admission on uninterruptible kernel I/O until the process exits.
    await delay(10);
  }
}

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
          `--as=${request.limits?.addressSpace ?? DEFAULT_NATIVE_POLICY.limits.addressSpace}`,
          `--cpu=${request.limits?.cpuSeconds ?? DEFAULT_NATIVE_POLICY.limits.cpuSeconds}`,
          `--fsize=${request.limits?.fileBytes ?? DEFAULT_NATIVE_POLICY.limits.fileBytes}`,
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
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (grouped && child.pid) {
          process.kill(-child.pid, signal);
          return true;
        } else if (child.pid) {
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
      return false;
    };
    const stop = (error: HeavyToolError) => {
      if (failure) return;
      failure = error;
      kill('SIGTERM');
      // Escalate if the parent ignores TERM. Close also retires any remaining
      // group, so a retired numeric group is never signalled by a later timer.
      escalation = setTimeout(() => {
        escalation = undefined;
        kill('SIGKILL');
      }, 250);
    };
    const abort = () =>
      stop(
        request.signal.reason instanceof HeavyToolError
          ? request.signal.reason
          : new HeavyToolError('cancelled'),
      );
    const timeout = setTimeout(
      () => stop(new HeavyToolError('processing-timeout')),
      request.timeoutMs ?? DEFAULT_NATIVE_POLICY.timeoutMs,
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
      // A successful parent can leave descendants with closed/inherited-free
      // stdio. Close proves only the parent exited; retire its remaining group
      // before cleanup and admission release. Unix groups remain addressable
      // while any descendant is alive, even after their leader exits.
      const groupSent = grouped && kill('SIGKILL');
      clearTimeout(escalation);
      const settle = async () => {
        if (groupSent && process.platform === 'linux' && child.pid)
          await waitForLinuxGroup(child.pid);
        if (failure) reject(failure);
        // util-linux reserves 126/127 for an unusable/missing exec target.
        // The wrapper can start successfully while the server-selected tool cannot.
        else if (code === null || (limited && (code === 126 || code === 127)))
          reject(new HeavyToolError('processing-failed'));
        else
          resolve({
            exitCode: code,
            stdout: stdout.toString('utf8'),
            stderr: stderr.toString('utf8'),
          });
      };
      void settle().catch(() =>
        reject(new HeavyToolError('processing-failed')),
      );
    });
    if (request.signal.aborted) abort();
  });
};
