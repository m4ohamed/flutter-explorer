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

// tests/configWriter.test.ts
var import_node_test = require("node:test");
var assert = __toESM(require("node:assert/strict"));
var fs2 = __toESM(require("fs"));
var os2 = __toESM(require("os"));
var path2 = __toESM(require("path"));

// src/utils/configWriter.ts
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));
function defaultBackupDir() {
  return path.join(os.homedir(), ".flutter-explorer", "backups");
}
function writeFileAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp2 = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp2, content, "utf8");
    fs.renameSync(tmp2, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp2);
    } catch {
    }
    throw err;
  }
}
function backupFile(filePath, backupDir = defaultBackupDir()) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    fs.mkdirSync(backupDir, { recursive: true });
    const safeName = filePath.replace(/[:\\/]+/g, "_").replace(/^_+/, "");
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const target = path.join(backupDir, `${stamp}__${safeName}.bak`);
    fs.copyFileSync(filePath, target);
    const suffix = `__${safeName}.bak`;
    const copies = fs.readdirSync(backupDir).filter((f) => f.endsWith(suffix)).sort();
    for (const old of copies.slice(0, Math.max(0, copies.length - 10))) {
      try {
        fs.unlinkSync(path.join(backupDir, old));
      } catch {
      }
    }
    return target;
  } catch {
    return null;
  }
}
function detectIndent(text) {
  const m = /^([ \t]+)"/m.exec(text);
  if (!m) {
    return 2;
  }
  return m[1].includes("	") ? "	" : m[1].length;
}
function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}
function upsertMcpServer(filePath, serverName, entry, useServersKey, backupDir = defaultBackupDir()) {
  try {
    const mainKey = useServersKey ? "servers" : "mcpServers";
    const otherKey = useServersKey ? "mcpServers" : "servers";
    let config = {};
    let existed = false;
    let indent = 2;
    let eol = "\n";
    let hadTrailingNewline = false;
    if (fs.existsSync(filePath)) {
      existed = true;
      const text = fs.readFileSync(filePath, "utf8");
      if (text.trim() !== "") {
        let parsed;
        try {
          parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
        } catch (err) {
          return {
            path: filePath,
            status: "skipped",
            message: `File is not strict JSON (comments, trailing comma or a syntax error); it was left untouched. Add the "${serverName}" entry to "${mainKey}" manually.`
          };
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { path: filePath, status: "skipped", message: "Top level of the file is not a JSON object; left untouched." };
        }
        config = parsed;
        indent = detectIndent(text);
        eol = detectEol(text);
        hadTrailingNewline = /\n$/.test(text);
      }
    }
    let changed = !existed;
    const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
    if (!isObject(config[mainKey])) {
      if (config[mainKey] !== void 0) {
        return { path: filePath, status: "skipped", message: `"${mainKey}" exists but is not an object; left untouched.` };
      }
      config[mainKey] = {};
      changed = true;
    }
    if (isObject(config[otherKey])) {
      for (const [name, value] of Object.entries(config[otherKey])) {
        if (config[mainKey][name] === void 0) {
          config[mainKey][name] = value;
        }
      }
      delete config[otherKey];
      changed = true;
    }
    if (JSON.stringify(config[mainKey][serverName]) !== JSON.stringify(entry)) {
      config[mainKey][serverName] = entry;
      changed = true;
    }
    if (!changed) {
      return { path: filePath, status: "unchanged" };
    }
    const backup = existed ? backupFile(filePath, backupDir) ?? void 0 : void 0;
    let out = JSON.stringify(config, null, indent);
    if (eol !== "\n") {
      out = out.replace(/\n/g, eol);
    }
    if (!existed || hadTrailingNewline) {
      out += eol;
    }
    writeFileAtomic(filePath, out);
    return { path: filePath, status: existed ? "updated" : "created", backup };
  } catch (err) {
    return { path: filePath, status: "error", message: String(err) };
  }
}
function upsertMarkedBlock(filePath, blockId, body, legacyHeader = null, backupDir = defaultBackupDir()) {
  try {
    const begin = `<!-- flutter-explorer:${blockId}:begin -->`;
    const end = `<!-- flutter-explorer:${blockId}:end -->`;
    const existed = fs.existsSync(filePath);
    const existing = existed ? fs.readFileSync(filePath, "utf8") : "";
    const eol = detectEol(existing);
    const normalizedBody = body.replace(/\r\n/g, "\n").trim().replace(/\n/g, eol);
    const block = `${begin}${eol}${normalizedBody}${eol}${end}${eol}`;
    let updated;
    const beginIdx = existing.indexOf(begin);
    const endIdx = beginIdx >= 0 ? existing.indexOf(end, beginIdx + begin.length) : -1;
    if (beginIdx >= 0 && endIdx >= 0) {
      let regionEnd = endIdx + end.length;
      if (existing.startsWith("\r\n", regionEnd)) {
        regionEnd += 2;
      } else if (existing[regionEnd] === "\n") {
        regionEnd += 1;
      }
      updated = existing.slice(0, beginIdx) + block + existing.slice(regionEnd);
    } else if (legacyHeader && existing.includes(legacyHeader)) {
      const start = existing.indexOf(legacyHeader);
      const after = existing.slice(start + legacyHeader.length);
      const next = /\r?\n# (?!#)/.exec(after);
      const stop = next ? start + legacyHeader.length + next.index + 1 : existing.length;
      const tailStart = next && existing[stop] === "\r" ? stop + 1 : stop;
      updated = existing.slice(0, start) + block + (stop < existing.length ? eol + existing.slice(tailStart) : "");
    } else if (existing.trim() === "") {
      updated = block;
    } else {
      updated = existing.replace(/\s+$/, "") + eol + eol + block;
    }
    if (updated === existing) {
      return { path: filePath, status: "unchanged" };
    }
    const backup = existed && existing.trim() !== "" ? backupFile(filePath, backupDir) ?? void 0 : void 0;
    writeFileAtomic(filePath, updated);
    return { path: filePath, status: existed ? "updated" : "created", backup };
  } catch (err) {
    return { path: filePath, status: "error", message: String(err) };
  }
}

// tests/configWriter.test.ts
function tmp() {
  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), "fe-cfg-"));
  return { dir, backups: path2.join(dir, "backups") };
}
var ENTRY = { command: "node", args: ["/x/out/mcp-server.js"], env: { FLUTTER_PROJECT_PATH: "${workspaceFolder}" } };
(0, import_node_test.test)("creates a new config file", () => {
  const { dir, backups } = tmp();
  const file = path2.join(dir, "sub", "mcp.json");
  const r = upsertMcpServer(file, "flutter-explorer-mcp", ENTRY, false, backups);
  assert.equal(r.status, "created");
  assert.deepEqual(JSON.parse(fs2.readFileSync(file, "utf8")), { mcpServers: { "flutter-explorer-mcp": ENTRY } });
});
(0, import_node_test.test)("keeps every other server and top level key, backs up, and is idempotent", () => {
  const { dir, backups } = tmp();
  const file = path2.join(dir, "claude_desktop_config.json");
  const original = { theme: "dark", mcpServers: { other: { command: "x" }, another: { command: "y" } } };
  fs2.writeFileSync(file, JSON.stringify(original, null, 4) + "\n");
  const r1 = upsertMcpServer(file, "flutter-explorer-mcp", ENTRY, false, backups);
  assert.equal(r1.status, "updated");
  assert.ok(r1.backup && fs2.existsSync(r1.backup));
  const after = JSON.parse(fs2.readFileSync(file, "utf8"));
  assert.equal(after.theme, "dark");
  assert.deepEqual(Object.keys(after.mcpServers).sort(), ["another", "flutter-explorer-mcp", "other"]);
  assert.match(fs2.readFileSync(file, "utf8"), /^ {4}"theme"/m, "indentation preserved");
  const mtime = fs2.statSync(file).mtimeMs;
  const r2 = upsertMcpServer(file, "flutter-explorer-mcp", ENTRY, false, backups);
  assert.equal(r2.status, "unchanged");
  assert.equal(fs2.statSync(file).mtimeMs, mtime, "no rewrite when nothing changed");
});
(0, import_node_test.test)("NEVER overwrites a file that is not strict JSON (old code replaced it with {})", () => {
  const { dir, backups } = tmp();
  const file = path2.join(dir, "mcp.json");
  const jsonc = '{\n  // my servers\n  "servers": { "keep-me": { "command": "x" }, },\n}\n';
  fs2.writeFileSync(file, jsonc);
  const r = upsertMcpServer(file, "flutter-explorer-mcp", ENTRY, true, backups);
  assert.equal(r.status, "skipped");
  assert.equal(fs2.readFileSync(file, "utf8"), jsonc);
  const broken = path2.join(dir, "broken.json");
  fs2.writeFileSync(broken, '{ "mcpServers": { "a": ');
  assert.equal(upsertMcpServer(broken, "x", ENTRY, false, backups).status, "skipped");
  assert.equal(fs2.readFileSync(broken, "utf8"), '{ "mcpServers": { "a": ');
});
(0, import_node_test.test)("merges servers stored under the other key instead of deleting them", () => {
  const { dir, backups } = tmp();
  const file = path2.join(dir, "mcp.json");
  fs2.writeFileSync(file, JSON.stringify({ servers: { a: { command: "a" } }, mcpServers: { b: { command: "b" } } }));
  const r = upsertMcpServer(file, "flutter-explorer-mcp", ENTRY, true, backups);
  assert.equal(r.status, "updated");
  const after = JSON.parse(fs2.readFileSync(file, "utf8"));
  assert.equal(after.mcpServers, void 0);
  assert.deepEqual(Object.keys(after.servers).sort(), ["a", "b", "flutter-explorer-mcp"]);
});
(0, import_node_test.test)("preserves CRLF files", () => {
  const { dir, backups } = tmp();
  const file = path2.join(dir, "mcp.json");
  fs2.writeFileSync(file, '{\r\n  "mcpServers": {}\r\n}\r\n');
  upsertMcpServer(file, "flutter-explorer-mcp", ENTRY, false, backups);
  const text = fs2.readFileSync(file, "utf8");
  assert.ok(text.includes("\r\n"));
  assert.ok(!/[^\r]\n/.test(text));
});
(0, import_node_test.test)("backups are pruned to the 10 newest per file", () => {
  const { dir, backups } = tmp();
  const file = path2.join(dir, "a.json");
  fs2.writeFileSync(file, "{}");
  for (let i = 0; i < 14; i++) {
    backupFile(file, backups);
  }
  assert.ok(fs2.readdirSync(backups).length <= 10);
});
var HEADER = "# Agent rules";
var BODY = `${HEADER}

rule one
rule two

## Section
text`;
(0, import_node_test.test)("creates the file with a marked block", () => {
  const { dir, backups } = tmp();
  const file = path2.join(dir, "GEMINI.md");
  assert.equal(upsertMarkedBlock(file, "rules", BODY, HEADER, backups).status, "created");
  const text = fs2.readFileSync(file, "utf8");
  assert.match(text, /flutter-explorer:rules:begin/);
  assert.match(text, /rule two/);
});
(0, import_node_test.test)("re-running is idempotent and content below the block survives updates", () => {
  const { dir, backups } = tmp();
  const file = path2.join(dir, "GEMINI.md");
  upsertMarkedBlock(file, "rules", BODY, HEADER, backups);
  assert.equal(upsertMarkedBlock(file, "rules", BODY, HEADER, backups).status, "unchanged");
  fs2.appendFileSync(file, "\n# My own notes\nkeep this forever\n");
  const r = upsertMarkedBlock(file, "rules", BODY.replace("rule two", "rule TWO (new)"), HEADER, backups);
  assert.equal(r.status, "updated");
  const text = fs2.readFileSync(file, "utf8");
  assert.match(text, /rule TWO \(new\)/);
  assert.doesNotMatch(text, /rule two\n/);
  assert.match(text, /keep this forever/);
});
(0, import_node_test.test)("migrates the legacy unmarked block without eating user content after it", () => {
  const { dir, backups } = tmp();
  const file = path2.join(dir, "GEMINI.md");
  const legacy = `# Existing user text
hello

${BODY.replace("rule one", "OLD RULE")}

# User section after
precious
`;
  fs2.writeFileSync(file, legacy);
  const r = upsertMarkedBlock(file, "rules", BODY, HEADER, backups);
  assert.equal(r.status, "updated");
  const text = fs2.readFileSync(file, "utf8");
  assert.match(text, /Existing user text/);
  assert.doesNotMatch(text, /OLD RULE/);
  assert.match(text, /rule one/);
  assert.match(text, /# User section after\nprecious/);
  assert.equal(text.split("flutter-explorer:rules:begin").length - 1, 1);
});
(0, import_node_test.test)("legacy block at the very end of the file is migrated too", () => {
  const { dir, backups } = tmp();
  const file = path2.join(dir, "GEMINI.md");
  fs2.writeFileSync(file, `user line

${BODY.replace("rule one", "OLD")}
`);
  upsertMarkedBlock(file, "rules", BODY, HEADER, backups);
  const text = fs2.readFileSync(file, "utf8");
  assert.match(text, /^user line/);
  assert.doesNotMatch(text, /OLD/);
  assert.match(text, /rule one/);
});
(0, import_node_test.test)("appends to a file that has other content", () => {
  const { dir, backups } = tmp();
  const file = path2.join(dir, "GEMINI.md");
  fs2.writeFileSync(file, "something else\n");
  upsertMarkedBlock(file, "rules", BODY, HEADER, backups);
  const text = fs2.readFileSync(file, "utf8");
  assert.match(text, /^something else/);
  assert.match(text, /rule one/);
});
