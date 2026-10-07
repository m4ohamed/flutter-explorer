/**
 * Implementation behind the `flutter_run_analyze` and `flutter_run_build_runner` MCP tools.
 * Kept out of mcp-server.ts so it can be unit tested and so the server file stays readable.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseToolDiagnostics, resolveInsideProject, runProcess, ToolDiagnostic } from './processRunner';

export interface AnalysisReport {
  success: boolean;
  exitCode: number;
  diagnosticsCount: number;
  diagnostics: ToolDiagnostic[];
  rawOutput: string;
  stderr?: string;
  note?: string;
}

export type AnalysisOutcome =
  | { ok: true; report: AnalysisReport }
  | { ok: false; error: string };

function tail(text: string, max: number): string {
  return text.length > max ? text.slice(text.length - max) : text;
}

/**
 * Run the analyzer that matches the project type.
 * `target` may be a file or folder inside the project; paths outside the project are rejected.
 */
export async function runProjectAnalysis(
  projectRoot: string,
  projectType: string,
  target?: string,
): Promise<AnalysisOutcome> {
  let targetRel: string | null = null;
  if (target !== undefined && target !== null && String(target).trim() !== '') {
    const resolved = resolveInsideProject(projectRoot, target);
    if (!resolved) {
      return {
        ok: false,
        error: `Rejected targetPath "${target}": it must be a plain path inside the project (${projectRoot}).`,
      };
    }
    targetRel = resolved.rel;
  }

  let command: string;
  let args: string[];
  let note: string | undefined;

  if (projectType === 'flutter') {
    command = 'flutter';
    args = targetRel && targetRel !== '.' ? ['analyze', targetRel] : ['analyze'];
  } else if (projectType === 'ts') {
    command = 'npx';
    args = ['tsc', '--noEmit'];
    if (targetRel && targetRel !== '.') {
      note = `tsc always checks the whole project (tsconfig.json); results were filtered to "${targetRel}".`;
    }
  } else if (projectType === 'android') {
    const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    command = fs.existsSync(path.join(projectRoot, wrapper)) ? wrapper : 'gradle';
    args = ['lint'];
  } else {
    return { ok: false, error: `Error: Could not determine project type for analysis at: ${projectRoot}.` };
  }

  const run = await runProcess(command, args, { cwd: projectRoot, timeoutMs: 300_000 });

  let diagnostics = parseToolDiagnostics(run.stdout + '\n' + run.stderr);

  if (projectType === 'ts' && targetRel && targetRel !== '.') {
    const prefix = targetRel.replace(/\/+$/, '');
    diagnostics = diagnostics.filter(d => {
      const file = d.file.replace(/\\/g, '/');
      return file === prefix || file.startsWith(prefix + '/');
    });
  }

  const errorCount = diagnostics.filter(d => d.severity === 'error').length;

  // A non-zero exit code with nothing parsed means the tool itself failed (not installed,
  // bad tsconfig, ...). The old implementation reported that as success.
  const toolFailed = !!run.error || run.timedOut || (run.code !== 0 && diagnostics.length === 0);
  const success = !toolFailed && errorCount === 0;

  const report: AnalysisReport = {
    success,
    exitCode: run.code,
    diagnosticsCount: diagnostics.length,
    diagnostics: diagnostics.slice(0, 100),
    rawOutput: run.stdout.substring(0, 2000),
  };
  if (run.stderr.trim()) { report.stderr = tail(run.stderr.trim(), 1500); }
  if (run.error) { report.note = run.error; }
  else if (run.timedOut) { report.note = 'The analysis timed out.'; }
  else if (note) { report.note = note; }
  else if (toolFailed) { report.note = 'The command exited with an error but produced no recognizable diagnostics; see stderr/rawOutput.'; }

  return { ok: true, report };
}

export interface BuildRunnerReport {
  success: boolean;
  exitCode: number;
  rawOutput: string;
  stderr?: string;
  note?: string;
}

export async function runBuildRunner(projectRoot: string): Promise<{ ok: true; report: BuildRunnerReport } | { ok: false; error: string }> {
  if (!fs.existsSync(path.join(projectRoot, 'pubspec.yaml'))) {
    return {
      ok: false,
      error: `Error: 'pubspec.yaml' not found in current project path: ${projectRoot}. Use 'flutter_set_project_path' to set it first.`,
    };
  }

  const run = await runProcess('dart', ['run', 'build_runner', 'build', '--delete-conflicting-outputs'], {
    cwd: projectRoot,
    timeoutMs: 180_000,
  });

  const report: BuildRunnerReport = {
    success: run.code === 0 && !run.error && !run.timedOut,
    exitCode: run.code,
    rawOutput: tail(run.stdout, 2000),
  };
  if (run.stderr.trim() && !report.success) { report.stderr = tail(run.stderr.trim(), 1500); }
  if (run.error) { report.note = run.error; }
  else if (run.timedOut) { report.note = 'build_runner timed out after 3 minutes.'; }
  return { ok: true, report };
}
