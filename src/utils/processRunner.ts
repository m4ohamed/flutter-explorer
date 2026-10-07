/**
 * Safe child-process helper for the MCP tools (analyze, build_runner, ...).
 *
 * The previous implementation used `spawn(command, args, { shell: true })` with a path that came
 * straight from the LLM, which allowed command injection (`targetPath: "lib; calc.exe"`).
 * Here:
 *   - only a fixed set of commands can be started,
 *   - every argument must match a strict allow-list pattern (no shell meta characters at all),
 *   - on POSIX the command is spawned directly (`shell: false`),
 *   - on Windows `.bat/.cmd` shims (flutter.bat, npx.cmd, ...) are started through `cmd.exe /d /s /c`
 *     with every argument double-quoted; because no meta character can reach cmd.exe this is safe.
 *
 * No dependency on `vscode`.
 */
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface RunOptions {
  cwd: string;
  timeoutMs?: number;
  /** Stop collecting after this many bytes per stream (default 5 MB). */
  maxOutputBytes?: number;
}

export interface RunResult {
  /** Exit code, or -1 when the process could not be started / was killed on timeout. */
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  /** Set when the process could not be started (e.g. command not found) or the input was rejected. */
  error?: string;
}

export const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  'flutter',
  'dart',
  'npx',
  'node',
  'git',
  'gradle',
  'gradlew.bat',
  './gradlew',
]);

/**
 * Letters/digits (any language, so Arabic folder names work), space and a small set of
 * punctuation that is harmless both for POSIX argv and inside cmd.exe double quotes.
 * Explicitly NOT allowed: & | < > ^ " % ! ; $ ` * ? { } newline and friends.
 */
const SAFE_ARG = /^[\p{L}\p{N} _\-.,:@+=/\\()[\]'~#]+$/u;

export function isSafeArg(arg: string): boolean {
  return typeof arg === 'string' && arg.length > 0 && arg.length <= 1024 && SAFE_ARG.test(arg);
}

/**
 * Resolve a user/LLM supplied path and make sure it stays inside the project.
 * Returns a POSIX style path relative to the project root that is safe to pass as an argument,
 * or null when the path escapes the project or contains unsafe characters.
 */
export function resolveInsideProject(
  projectRoot: string,
  target: string | undefined | null,
): { abs: string; rel: string } | null {
  if (target === undefined || target === null) { return null; }
  const trimmed = String(target).trim();
  if (!trimmed || trimmed.includes('\u0000')) { return null; }

  const abs = path.resolve(projectRoot, trimmed);
  const relNative = path.relative(projectRoot, abs);
  if (relNative.startsWith('..') || path.isAbsolute(relNative)) { return null; }

  // Follow symlinks when the target exists, so a link inside the project cannot point outside it.
  try {
    if (fs.existsSync(abs)) {
      const realRoot = fs.realpathSync(projectRoot);
      const realAbs = fs.realpathSync(abs);
      const realRel = path.relative(realRoot, realAbs);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) { return null; }
    }
  } catch {
    return null;
  }

  let rel = relNative.split(path.sep).join('/');
  if (rel === '') { rel = '.'; }
  if (rel.startsWith('-')) { rel = './' + rel; }
  if (!isSafeArg(rel)) { return null; }
  return { abs, rel };
}

function killTree(child: ChildProcess): void {
  try {
    if (process.platform === 'win32' && child.pid) {
      // Static arguments only (the pid is a number we received from the OS).
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => child.kill());
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    // best effort
  }
}

export function runProcess(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  const fail = (error: string): Promise<RunResult> =>
    Promise.resolve({ code: -1, stdout: '', stderr: '', timedOut: false, truncated: false, error });

  if (!ALLOWED_COMMANDS.has(command)) {
    return fail(`Command not allowed: ${command}`);
  }
  for (const arg of args) {
    if (!isSafeArg(arg)) {
      return fail(`Unsafe argument rejected: ${JSON.stringify(arg).slice(0, 120)}`);
    }
  }

  const timeoutMs = options.timeoutMs ?? 300_000;
  const maxBytes = options.maxOutputBytes ?? 5 * 1024 * 1024;

  return new Promise<RunResult>((resolve) => {
    let child: ChildProcess;
    try {
      if (process.platform === 'win32') {
        const cmdLine = args.length > 0
          ? `${command} ${args.map(a => `"${a}"`).join(' ')}`
          : command;
        child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${cmdLine}"`], {
          cwd: options.cwd,
          windowsVerbatimArguments: true,
          windowsHide: true,
        });
      } else {
        child = spawn(command, args, { cwd: options.cwd, shell: false });
      }
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: '', timedOut: false, truncated: false, error: String(err) });
      return;
    }

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const finish = (result: RunResult): void => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      // Give the OS a moment to flush, then resolve regardless of whether 'close' fires.
      setTimeout(() => finish({
        code: -1,
        stdout,
        stderr: stderr + `\nProcess timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        timedOut: true,
        truncated,
      }), 500);
    }, timeoutMs);

    const collect = (current: string, chunk: Buffer): string => {
      if (current.length >= maxBytes) { truncated = true; return current; }
      return current + chunk.toString();
    };

    child.stdout?.on('data', (d: Buffer) => { stdout = collect(stdout, d); });
    child.stderr?.on('data', (d: Buffer) => { stderr = collect(stderr, d); });

    child.on('error', (err: NodeJS.ErrnoException) => {
      const message = err.code === 'ENOENT'
        ? `Command not found: ${command}. Make sure it is installed and on PATH.`
        : String(err);
      finish({ code: -1, stdout, stderr, timedOut, truncated, error: message });
    });

    child.on('close', (code) => {
      if (timedOut) { return; } // the timeout branch resolves
      // cmd.exe reports a missing command as exit code 1 with this text on stderr.
      let error: string | undefined;
      if (process.platform === 'win32' && (code === 1 || code === 9009) && /is not recognized as an internal or external command/i.test(stderr)) {
        error = `Command not found: ${command}. Make sure it is installed and on PATH.`;
      }
      finish({ code: code ?? -1, stdout, stderr, timedOut: false, truncated, error });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics parsing (flutter analyze / tsc / javac-style output)
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolDiagnostic {
  severity: string;
  description: string;
  file: string;
  line: number;
  column: number;
  message: string;
}

const FLUTTER_RE = /^\s*(info|warning|error)\s+[•\-]\s+(.*?)\s+[•\-]\s+(.*?):(\d+):(\d+)\s+[•\-]\s+(.*)$/i;
const TSC_RE = /^(.*?)\((\d+),(\d+)\):\s+(error|warning|info)\s+(TS\d+):\s+(.*)$/i;
const JAVA_RE = /^(.*?):(\d+):\s+(error|warning|info):\s+(.*)$/i;

export function parseToolDiagnostics(output: string): ToolDiagnostic[] {
  const diagnostics: ToolDiagnostic[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) { continue; }

    const f = FLUTTER_RE.exec(line);
    if (f) {
      diagnostics.push({
        severity: f[1].toLowerCase(),
        description: f[2].trim(),
        file: f[3].trim(),
        line: parseInt(f[4], 10),
        column: parseInt(f[5], 10),
        message: f[6].trim(),
      });
      continue;
    }

    const t = TSC_RE.exec(line);
    if (t) {
      diagnostics.push({
        severity: t[4].toLowerCase(),
        description: t[5].trim(),
        file: t[1].trim(),
        line: parseInt(t[2], 10),
        column: parseInt(t[3], 10),
        message: t[6].trim(),
      });
      continue;
    }

    const j = JAVA_RE.exec(line);
    if (j) {
      diagnostics.push({
        severity: j[3].toLowerCase(),
        description: 'Compilation Issue',
        file: j[1].trim(),
        line: parseInt(j[2], 10),
        column: 1,
        message: j[4].trim(),
      });
    }
  }
  return diagnostics;
}
