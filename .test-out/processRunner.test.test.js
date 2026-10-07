"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// tests/processRunner.test.ts
var import_node_test = require("node:test");
var assert = __toESM(require("node:assert/strict"));
var fs3 = __toESM(require("fs"));
var os = __toESM(require("os"));
var path3 = __toESM(require("path"));

// src/utils/processRunner.ts
var import_child_process = require("child_process");
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var ALLOWED_COMMANDS = /* @__PURE__ */ new Set([
  "flutter",
  "dart",
  "npx",
  "node",
  "git",
  "gradle",
  "gradlew.bat",
  "./gradlew"
]);
var SAFE_ARG = /^[\p{L}\p{N} _\-.,:@+=/\\()[\]'~#]+$/u;
function isSafeArg(arg) {
  return typeof arg === "string" && arg.length > 0 && arg.length <= 1024 && SAFE_ARG.test(arg);
}
function resolveInsideProject(projectRoot, target) {
  if (target === void 0 || target === null) {
    return null;
  }
  const trimmed = String(target).trim();
  if (!trimmed || trimmed.includes("\0")) {
    return null;
  }
  const abs = path.resolve(projectRoot, trimmed);
  const relNative = path.relative(projectRoot, abs);
  if (relNative.startsWith("..") || path.isAbsolute(relNative)) {
    return null;
  }
  try {
    if (fs.existsSync(abs)) {
      const realRoot = fs.realpathSync(projectRoot);
      const realAbs = fs.realpathSync(abs);
      const realRel = path.relative(realRoot, realAbs);
      if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
        return null;
      }
    }
  } catch {
    return null;
  }
  let rel = relNative.split(path.sep).join("/");
  if (rel === "") {
    rel = ".";
  }
  if (rel.startsWith("-")) {
    rel = "./" + rel;
  }
  if (!isSafeArg(rel)) {
    return null;
  }
  return { abs, rel };
}
function killTree(child) {
  try {
    if (process.platform === "win32" && child.pid) {
      const killer = (0, import_child_process.spawn)("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      killer.on("error", () => child.kill());
    } else {
      child.kill("SIGKILL");
    }
  } catch {
  }
}
function runProcess(command, args, options) {
  const fail = (error) => Promise.resolve({ code: -1, stdout: "", stderr: "", timedOut: false, truncated: false, error });
  if (!ALLOWED_COMMANDS.has(command)) {
    return fail(`Command not allowed: ${command}`);
  }
  for (const arg of args) {
    if (!isSafeArg(arg)) {
      return fail(`Unsafe argument rejected: ${JSON.stringify(arg).slice(0, 120)}`);
    }
  }
  const timeoutMs = options.timeoutMs ?? 3e5;
  const maxBytes = options.maxOutputBytes ?? 5 * 1024 * 1024;
  return new Promise((resolve3) => {
    let child;
    try {
      if (process.platform === "win32") {
        const cmdLine = args.length > 0 ? `${command} ${args.map((a) => `"${a}"`).join(" ")}` : command;
        child = (0, import_child_process.spawn)(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${cmdLine}"`], {
          cwd: options.cwd,
          windowsVerbatimArguments: true,
          windowsHide: true
        });
      } else {
        child = (0, import_child_process.spawn)(command, args, { cwd: options.cwd, shell: false });
      }
    } catch (err) {
      resolve3({ code: -1, stdout: "", stderr: "", timedOut: false, truncated: false, error: String(err) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve3(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      setTimeout(() => finish({
        code: -1,
        stdout,
        stderr: stderr + `
Process timed out after ${Math.round(timeoutMs / 1e3)} seconds.`,
        timedOut: true,
        truncated
      }), 500);
    }, timeoutMs);
    const collect = (current, chunk) => {
      if (current.length >= maxBytes) {
        truncated = true;
        return current;
      }
      return current + chunk.toString();
    };
    child.stdout?.on("data", (d) => {
      stdout = collect(stdout, d);
    });
    child.stderr?.on("data", (d) => {
      stderr = collect(stderr, d);
    });
    child.on("error", (err) => {
      const message = err.code === "ENOENT" ? `Command not found: ${command}. Make sure it is installed and on PATH.` : String(err);
      finish({ code: -1, stdout, stderr, timedOut, truncated, error: message });
    });
    child.on("close", (code) => {
      if (timedOut) {
        return;
      }
      let error;
      if (process.platform === "win32" && (code === 1 || code === 9009) && /is not recognized as an internal or external command/i.test(stderr)) {
        error = `Command not found: ${command}. Make sure it is installed and on PATH.`;
      }
      finish({ code: code ?? -1, stdout, stderr, timedOut: false, truncated, error });
    });
  });
}
var FLUTTER_RE = /^\s*(info|warning|error)\s+[•\-]\s+(.*?)\s+[•\-]\s+(.*?):(\d+):(\d+)\s+[•\-]\s+(.*)$/i;
var TSC_RE = /^(.*?)\((\d+),(\d+)\):\s+(error|warning|info)\s+(TS\d+):\s+(.*)$/i;
var JAVA_RE = /^(.*?):(\d+):\s+(error|warning|info):\s+(.*)$/i;
function parseToolDiagnostics(output) {
  const diagnostics = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }
    const f = FLUTTER_RE.exec(line);
    if (f) {
      diagnostics.push({
        severity: f[1].toLowerCase(),
        description: f[2].trim(),
        file: f[3].trim(),
        line: parseInt(f[4], 10),
        column: parseInt(f[5], 10),
        message: f[6].trim()
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
        message: t[6].trim()
      });
      continue;
    }
    const j = JAVA_RE.exec(line);
    if (j) {
      diagnostics.push({
        severity: j[3].toLowerCase(),
        description: "Compilation Issue",
        file: j[1].trim(),
        line: parseInt(j[2], 10),
        column: 1,
        message: j[4].trim()
      });
    }
  }
  return diagnostics;
}

// src/utils/analysisRunner.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
function tail(text, max) {
  return text.length > max ? text.slice(text.length - max) : text;
}
async function runProjectAnalysis(projectRoot, projectType, target) {
  let targetRel = null;
  if (target !== void 0 && target !== null && String(target).trim() !== "") {
    const resolved = resolveInsideProject(projectRoot, target);
    if (!resolved) {
      return {
        ok: false,
        error: `Rejected targetPath "${target}": it must be a plain path inside the project (${projectRoot}).`
      };
    }
    targetRel = resolved.rel;
  }
  let command;
  let args;
  let note;
  if (projectType === "flutter") {
    command = "flutter";
    args = targetRel && targetRel !== "." ? ["analyze", targetRel] : ["analyze"];
  } else if (projectType === "ts") {
    command = "npx";
    args = ["tsc", "--noEmit"];
    if (targetRel && targetRel !== ".") {
      note = `tsc always checks the whole project (tsconfig.json); results were filtered to "${targetRel}".`;
    }
  } else if (projectType === "android") {
    const wrapper = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
    command = fs2.existsSync(path2.join(projectRoot, wrapper)) ? wrapper : "gradle";
    args = ["lint"];
  } else {
    return { ok: false, error: `Error: Could not determine project type for analysis at: ${projectRoot}.` };
  }
  const run = await runProcess(command, args, { cwd: projectRoot, timeoutMs: 3e5 });
  let diagnostics = parseToolDiagnostics(run.stdout + "\n" + run.stderr);
  if (projectType === "ts" && targetRel && targetRel !== ".") {
    const prefix = targetRel.replace(/\/+$/, "");
    diagnostics = diagnostics.filter((d) => {
      const file = d.file.replace(/\\/g, "/");
      return file === prefix || file.startsWith(prefix + "/");
    });
  }
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const toolFailed = !!run.error || run.timedOut || run.code !== 0 && diagnostics.length === 0;
  const success = !toolFailed && errorCount === 0;
  const report = {
    success,
    exitCode: run.code,
    diagnosticsCount: diagnostics.length,
    diagnostics: diagnostics.slice(0, 100),
    rawOutput: run.stdout.substring(0, 2e3)
  };
  if (run.stderr.trim()) {
    report.stderr = tail(run.stderr.trim(), 1500);
  }
  if (run.error) {
    report.note = run.error;
  } else if (run.timedOut) {
    report.note = "The analysis timed out.";
  } else if (note) {
    report.note = note;
  } else if (toolFailed) {
    report.note = "The command exited with an error but produced no recognizable diagnostics; see stderr/rawOutput.";
  }
  return { ok: true, report };
}
async function runBuildRunner(projectRoot) {
  if (!fs2.existsSync(path2.join(projectRoot, "pubspec.yaml"))) {
    return {
      ok: false,
      error: `Error: 'pubspec.yaml' not found in current project path: ${projectRoot}. Use 'flutter_set_project_path' to set it first.`
    };
  }
  const run = await runProcess("dart", ["run", "build_runner", "build", "--delete-conflicting-outputs"], {
    cwd: projectRoot,
    timeoutMs: 18e4
  });
  const report = {
    success: run.code === 0 && !run.error && !run.timedOut,
    exitCode: run.code,
    rawOutput: tail(run.stdout, 2e3)
  };
  if (run.stderr.trim() && !report.success) {
    report.stderr = tail(run.stderr.trim(), 1500);
  }
  if (run.error) {
    report.note = run.error;
  } else if (run.timedOut) {
    report.note = "build_runner timed out after 3 minutes.";
  }
  return { ok: true, report };
}

// tests/processRunner.test.ts
(0, import_node_test.test)("isSafeArg rejects every shell meta character", () => {
  for (const bad of ["lib; calc.exe", "a&b", "a|b", "$(whoami)", "`id`", 'a"b', "%PATH%", "a\nb", "a>b", "a<b", "a^b", "a!b", "*.dart", "{a,b}", ""]) {
    assert.equal(isSafeArg(bad), false, JSON.stringify(bad));
  }
});
(0, import_node_test.test)("isSafeArg accepts ordinary and Arabic paths", () => {
  for (const ok2 of ["lib/features/posts", "C:\\Users\\Name With Space\\proj", "\u0645\u0634\u0631\u0648\u0639/lib/main.dart", "--noEmit", "src/(group)/page.tsx", "it's/fine.dart"]) {
    assert.equal(isSafeArg(ok2), true, ok2);
  }
});
(0, import_node_test.test)("resolveInsideProject keeps paths inside the project", () => {
  const root = fs3.mkdtempSync(path3.join(os.tmpdir(), "fe-root-"));
  fs3.mkdirSync(path3.join(root, "lib"));
  assert.equal(resolveInsideProject(root, "lib")?.rel, "lib");
  assert.equal(resolveInsideProject(root, path3.join(root, "lib"))?.rel, "lib");
  assert.equal(resolveInsideProject(root, ".")?.rel, ".");
  assert.equal(resolveInsideProject(root, "../etc/passwd"), null);
  assert.equal(resolveInsideProject(root, path3.join(os.tmpdir(), "other")), null);
  assert.equal(resolveInsideProject(root, "lib; calc.exe"), null);
  assert.equal(resolveInsideProject(root, "-rf")?.rel, "./-rf");
  assert.equal(resolveInsideProject(root, ""), null);
  assert.equal(resolveInsideProject(root, void 0), null);
});
(0, import_node_test.test)("resolveInsideProject rejects a symlink that points outside", { skip: process.platform === "win32" }, () => {
  const root = fs3.mkdtempSync(path3.join(os.tmpdir(), "fe-root-"));
  const outside = fs3.mkdtempSync(path3.join(os.tmpdir(), "fe-out-"));
  fs3.symlinkSync(outside, path3.join(root, "escape"));
  assert.equal(resolveInsideProject(root, "escape"), null);
});
(0, import_node_test.test)("runProcess refuses commands outside the allow-list", async () => {
  const r = await runProcess("calc.exe", [], { cwd: os.tmpdir() });
  assert.match(r.error ?? "", /not allowed/);
});
(0, import_node_test.test)("runProcess refuses injected arguments and never starts a shell", async () => {
  const marker = path3.join(os.tmpdir(), "fe-pwned-" + Date.now());
  const r = await runProcess("node", ["-e", "1", `; touch ${marker}`], { cwd: os.tmpdir() });
  assert.match(r.error ?? "", /Unsafe argument/);
  assert.equal(fs3.existsSync(marker), false);
});
function script(body) {
  const dir = fs3.mkdtempSync(path3.join(os.tmpdir(), "fe-script-"));
  const file = path3.join(dir, "run.js");
  fs3.writeFileSync(file, body);
  return file;
}
(0, import_node_test.test)("runProcess runs allowed commands and captures output", async () => {
  const r = await runProcess("node", [script("console.log(21 * 2);")], { cwd: os.tmpdir() });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), "42");
});
(0, import_node_test.test)("runProcess reports non-zero exit codes and stderr", async () => {
  const r = await runProcess("node", [script("console.error(7); process.exit(3);")], { cwd: os.tmpdir() });
  assert.equal(r.code, 3);
  assert.equal(r.stderr.trim(), "7");
});
(0, import_node_test.test)("runProcess kills on timeout", async () => {
  const t0 = Date.now();
  const r = await runProcess("node", [script("setTimeout(() => {}, 60000);")], { cwd: os.tmpdir(), timeoutMs: 300 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - t0 < 5e3);
});
(0, import_node_test.test)("runProcess reports a missing executable as an error", async () => {
  const r = await runProcess("flutter", ["--version"], { cwd: os.tmpdir() });
  assert.ok(r.code === 0 || (r.error ?? "").includes("Command not found"));
});
(0, import_node_test.test)("parseToolDiagnostics understands flutter, tsc and javac output", () => {
  const out = [
    "  error \u2022 Undefined name 'x' \u2022 lib/main.dart:12:5 \u2022 undefined_identifier",
    "   info \u2022 Avoid print \u2022 lib/a.dart:3:1 \u2022 avoid_print",
    "src/a.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/Main.java:7: error: cannot find symbol",
    "random noise"
  ].join("\n");
  const d = parseToolDiagnostics(out);
  assert.equal(d.length, 4);
  assert.deepEqual(d.map((x) => x.severity), ["error", "info", "error", "error"]);
  assert.equal(d[0].file, "lib/main.dart");
  assert.equal(d[0].line, 12);
  assert.equal(d[2].description, "TS2322");
});
(0, import_node_test.test)("runProjectAnalysis rejects targets outside the project and injection attempts", async () => {
  const root = fs3.mkdtempSync(path3.join(os.tmpdir(), "fe-proj-"));
  const a = await runProjectAnalysis(root, "flutter", "../../etc");
  assert.equal(a.ok, false);
  const b = await runProjectAnalysis(root, "flutter", "lib && calc.exe");
  assert.equal(b.ok, false);
});
(0, import_node_test.test)("runProjectAnalysis runs tsc, parses errors and filters by target", async () => {
  const base = path3.resolve(__dirname, "..", ".tmp-ts-proj");
  fs3.rmSync(base, { recursive: true, force: true });
  fs3.mkdirSync(path3.join(base, "src", "a"), { recursive: true });
  fs3.mkdirSync(path3.join(base, "src", "b"), { recursive: true });
  fs3.writeFileSync(path3.join(base, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src"] }));
  fs3.writeFileSync(path3.join(base, "src", "a", "bad.ts"), 'export const n: number = "x";\n');
  fs3.writeFileSync(path3.join(base, "src", "b", "bad2.ts"), "export const m: boolean = 5;\n");
  try {
    const all = await runProjectAnalysis(base, "ts");
    assert.equal(all.ok, true);
    if (all.ok) {
      assert.equal(all.report.success, false);
      assert.equal(all.report.diagnosticsCount, 2);
    }
    const only = await runProjectAnalysis(base, "ts", "src/a");
    assert.equal(only.ok, true);
    if (only.ok) {
      assert.equal(only.report.diagnosticsCount, 1);
      assert.match(only.report.diagnostics[0].file, /src[\\/]a[\\/]bad\.ts/);
      assert.match(only.report.note ?? "", /whole project/);
    }
  } finally {
    fs3.rmSync(base, { recursive: true, force: true });
  }
});
(0, import_node_test.test)("a missing tool is reported as failure, not success", async () => {
  const root = fs3.mkdtempSync(path3.join(os.tmpdir(), "fe-proj-"));
  const r = await runProjectAnalysis(root, "flutter");
  assert.equal(r.ok, true);
  if (r.ok && !r.report.success) {
    assert.ok(r.report.note);
  }
});
(0, import_node_test.test)("runBuildRunner requires a pubspec.yaml", async () => {
  const root = fs3.mkdtempSync(path3.join(os.tmpdir(), "fe-proj-"));
  const r = await runBuildRunner(root);
  assert.equal(r.ok, false);
});
