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

// tests/importResolver.test.ts
var import_node_test = require("node:test");
var assert = __toESM(require("node:assert/strict"));

// src/indexer/importResolver.ts
var path = __toESM(require("path"));
var TS_EXTS = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs"];
var OTHER_EXTS = [".dart", ".kt", ".java"];
var JS_TO_TS = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"]
};
function toPosix(p) {
  return p.replace(/\\/g, "/");
}
function normalizeKey(p) {
  const n = path.posix.normalize(toPosix(p));
  return n.startsWith("./") ? n.slice(2) : n;
}
var ImportResolver = class {
  constructor(files, options = null) {
    /** normalized path -> the key exactly as it appears in the index */
    this.files = /* @__PURE__ */ new Map();
    this.cache = /* @__PURE__ */ new Map();
    this.suffixScanCache = /* @__PURE__ */ new Map();
    this.paths = [];
    const opts = typeof options === "string" ? { projectName: options } : options ?? {};
    this.projectName = opts.projectName ?? null;
    for (const f of files) {
      this.files.set(normalizeKey(f), f);
    }
    if (opts.paths) {
      for (const [pattern, targets] of Object.entries(opts.paths)) {
        const wildcard = pattern.endsWith("*");
        this.paths.push({
          prefix: wildcard ? pattern.slice(0, -1) : pattern,
          wildcard,
          targets: targets.map((t) => toPosix(t))
        });
      }
      this.paths.sort((a, b) => b.prefix.length - a.prefix.length);
    }
  }
  /** True when `filePath` is part of the indexed file set. */
  has(filePath) {
    return this.files.has(normalizeKey(filePath));
  }
  /**
   * Resolve an import/export/part specifier written in `fromFile` to the matching
   * indexed file. Returns null for external packages, SDK libraries and unknown files.
   */
  resolve(fromFile, spec) {
    const raw = (spec ?? "").trim();
    if (!raw) {
      return null;
    }
    const cacheKey = fromFile + "\0" + raw;
    const cached = this.cache.get(cacheKey);
    if (cached !== void 0) {
      return cached;
    }
    const result = this.resolveUncached(fromFile, raw);
    this.cache.set(cacheKey, result);
    return result;
  }
  resolveUncached(fromFile, spec) {
    if (spec.startsWith("dart:")) {
      return null;
    }
    if (spec.startsWith("package:")) {
      const m = /^package:([^/]+)\/(.+)$/.exec(spec);
      if (!m || !this.projectName || m[1] !== this.projectName) {
        return null;
      }
      return this.tryCandidates("lib/" + m[2]);
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec)) {
      return null;
    }
    const fromNorm = normalizeKey(fromFile);
    const fromDir = path.posix.dirname(fromNorm);
    if (spec.startsWith(".")) {
      return this.tryCandidates(path.posix.join(fromDir, spec));
    }
    if (spec.startsWith("/")) {
      return this.tryCandidates(spec.replace(/^\/+/, ""));
    }
    for (const alias of this.paths) {
      if (alias.wildcard ? spec.startsWith(alias.prefix) : spec === alias.prefix) {
        const rest = alias.wildcard ? spec.slice(alias.prefix.length) : "";
        for (const target of alias.targets) {
          const hit = this.tryCandidates(target.replace("*", rest));
          if (hit) {
            return hit;
          }
        }
      }
    }
    const ext = path.posix.extname(fromNorm);
    if (ext === ".dart") {
      return this.tryCandidates(path.posix.join(fromDir, spec));
    }
    if ((ext === ".kt" || ext === ".java") && /^[\w.]+$/.test(spec) && spec.includes(".")) {
      return this.resolveQualifiedName(spec);
    }
    return null;
  }
  resolveQualifiedName(qualified) {
    const cached = this.suffixScanCache.get(qualified);
    if (cached !== void 0) {
      return cached;
    }
    const tail = "/" + qualified.replace(/\./g, "/");
    let found = null;
    for (const [norm, original] of this.files) {
      if (norm.endsWith(tail + ".kt") || norm.endsWith(tail + ".java")) {
        found = original;
        break;
      }
    }
    this.suffixScanCache.set(qualified, found);
    return found;
  }
  tryCandidates(base) {
    const b = path.posix.normalize(base);
    if (b.startsWith("../") || b === "..") {
      return null;
    }
    const candidates = [b];
    const ext = path.posix.extname(b);
    if (ext && JS_TO_TS[ext]) {
      const stem = b.slice(0, -ext.length);
      for (const e of JS_TO_TS[ext]) {
        candidates.push(stem + e);
      }
    }
    for (const e of TS_EXTS) {
      candidates.push(b + e);
    }
    for (const e of OTHER_EXTS) {
      candidates.push(b + e);
    }
    for (const e of TS_EXTS) {
      candidates.push(b + "/index" + e);
    }
    for (const c of candidates) {
      const hit = this.files.get(c);
      if (hit !== void 0) {
        return hit;
      }
    }
    return null;
  }
};
function makeQName(filePath, className, entity) {
  return `${filePath}:${className ? className + "." : ""}${entity}`;
}
function stripGenerics(typeName) {
  const lt = typeName.indexOf("<");
  return (lt >= 0 ? typeName.slice(0, lt) : typeName).trim();
}
var CallResolver = class {
  constructor(index, resolver) {
    this.index = index;
    this.resolver = resolver;
    this.classesByName = /* @__PURE__ */ new Map();
    this.classesByFile = /* @__PURE__ */ new Map();
    this.funcsByFile = /* @__PURE__ */ new Map();
    this.funcsByName = /* @__PURE__ */ new Map();
    this.methodsByClass = /* @__PURE__ */ new Map();
    // key: `${className}\u0000${method}`
    this.importedCache = /* @__PURE__ */ new Map();
    for (const [file, info] of Object.entries(index)) {
      for (const cls of info.classes ?? []) {
        const entry = { name: cls.name, file, info: cls };
        pushMap(this.classesByName, cls.name, entry);
        pushMap(this.classesByFile, file, entry);
        for (const m of cls.methods ?? []) {
          const target = {
            qname: makeQName(file, cls.name, m.name),
            filePath: file,
            kind: "method",
            name: m.name,
            parentClass: cls.name
          };
          pushMap(this.methodsByClass, cls.name + "\0" + m.name, target);
        }
      }
      for (const fn of info.functions ?? []) {
        const target = {
          qname: makeQName(file, null, fn.name),
          filePath: file,
          kind: "function",
          name: fn.name,
          parentClass: null
        };
        let perFile = this.funcsByFile.get(file);
        if (!perFile) {
          perFile = /* @__PURE__ */ new Map();
          this.funcsByFile.set(file, perFile);
        }
        if (!perFile.has(fn.name)) {
          perFile.set(fn.name, target);
        }
        pushMap(this.funcsByName, fn.name, target);
      }
    }
  }
  /** Class (in `file`) whose line range contains `line`; innermost wins. */
  classAt(file, line) {
    if (!line) {
      return null;
    }
    let best = null;
    for (const entry of this.classesByFile.get(file) ?? []) {
      const start = entry.info.line ?? 0;
      const end = entry.info.lineEnd ?? Number.MAX_SAFE_INTEGER;
      if (line >= start && line <= end) {
        if (!best || start >= (best.info.line ?? 0)) {
          best = entry;
        }
      }
    }
    return best ? best.name : null;
  }
  /** Qualified name of the code that contains `call` (used as the caller node of an edge). */
  callerQName(file, call) {
    const cls = call.callerClass ?? this.classAt(file, call.line);
    if (call.callerFunction) {
      return makeQName(file, cls, call.callerFunction);
    }
    return makeQName(file, cls, "<module>");
  }
  resolve(fromFile, call) {
    let name = call.name;
    if (!name) {
      return null;
    }
    let receiver = call.receiver ?? null;
    const dot = name.lastIndexOf(".");
    if (dot > 0) {
      receiver = name.slice(0, dot);
      name = name.slice(dot + 1);
    }
    const callerClass = call.callerClass ?? this.classAt(fromFile, call.line);
    if (receiver) {
      if (receiver === "this" || receiver === "super") {
        if (!callerClass) {
          return null;
        }
        return this.findMethod(callerClass, name, receiver === "super", fromFile);
      }
      const cls2 = this.resolveClassName(receiver, fromFile);
      if (!cls2) {
        return null;
      }
      return this.findMethod(cls2.name, name, false, cls2.file) ?? this.classTarget(cls2);
    }
    const sameFile = this.funcsByFile.get(fromFile)?.get(name);
    if (sameFile) {
      return sameFile;
    }
    if (callerClass) {
      const method = this.findMethod(callerClass, name, false, fromFile);
      if (method) {
        return method;
      }
    }
    const imported = this.importedFiles(fromFile);
    for (const f of imported) {
      const hit = this.funcsByFile.get(f)?.get(name);
      if (hit) {
        return hit;
      }
    }
    const cls = this.resolveClassName(name, fromFile, false);
    if (cls) {
      return this.classTarget(cls);
    }
    const global = this.funcsByName.get(name);
    if (global && global.length === 1) {
      return global[0];
    }
    return null;
  }
  // ── internals ──────────────────────────────────────────────────────────────
  classTarget(cls) {
    return {
      qname: makeQName(cls.file, null, cls.name),
      filePath: cls.file,
      kind: "class",
      name: cls.name,
      parentClass: null
    };
  }
  importedFiles(file) {
    const cached = this.importedCache.get(file);
    if (cached) {
      return cached;
    }
    const out = /* @__PURE__ */ new Set();
    const info = this.index[file];
    const specs = [];
    for (const imp of info?.imports ?? []) {
      specs.push(typeof imp === "string" ? imp : imp.path);
    }
    for (const exp of info?.exports ?? []) {
      specs.push(typeof exp === "string" ? exp : exp.path);
    }
    for (const spec of specs) {
      if (!spec) {
        continue;
      }
      const resolved = this.resolver.resolve(file, spec);
      if (resolved && resolved !== file) {
        out.add(resolved);
      }
    }
    this.importedCache.set(file, out);
    return out;
  }
  /**
   * Find a class by (type or variable) name. `indexManager` resolves to `IndexManager`,
   * `_cache` to `Cache`. `allowVariableForm=false` is used for bare calls like `Foo()`.
   */
  resolveClassName(receiver, fromFile, allowVariableForm = true) {
    const candidates = [receiver];
    if (allowVariableForm) {
      const stripped = receiver.replace(/^[_$]+/, "");
      if (stripped && stripped !== receiver) {
        candidates.push(stripped);
      }
      if (stripped && stripped[0] === stripped[0].toLowerCase()) {
        candidates.push(stripped[0].toUpperCase() + stripped.slice(1));
      }
    }
    for (const candidate of candidates) {
      const entries = this.classesByName.get(candidate);
      if (!entries || entries.length === 0) {
        continue;
      }
      if (entries.length === 1) {
        return entries[0];
      }
      const sameFile = entries.find((e) => e.file === fromFile);
      if (sameFile) {
        return sameFile;
      }
      const imported = this.importedFiles(fromFile);
      const viaImport = entries.find((e) => imported.has(e.file));
      if (viaImport) {
        return viaImport;
      }
      return entries[0];
    }
    return null;
  }
  findMethod(className, method, skipSelf, preferFile) {
    const order = this.ancestry(className);
    for (let i = skipSelf ? 1 : 0; i < order.length; i++) {
      const hits = this.methodsByClass.get(order[i] + "\0" + method);
      if (hits && hits.length > 0) {
        return hits.find((h) => h.filePath === preferFile) ?? hits[0];
      }
    }
    return null;
  }
  /** The class itself followed by its ancestors (extends / with / implements), breadth first. */
  ancestry(className) {
    const seen = /* @__PURE__ */ new Set([className]);
    const order = [className];
    for (let i = 0; i < order.length && order.length < 64; i++) {
      for (const entry of this.classesByName.get(order[i]) ?? []) {
        const parents = [
          entry.info.extendsClass ?? "",
          ...entry.info.mixins ?? [],
          ...entry.info.implements ?? []
        ];
        for (const parent of parents) {
          const clean = stripGenerics(parent);
          if (clean && !seen.has(clean)) {
            seen.add(clean);
            order.push(clean);
          }
        }
      }
    }
    return order;
  }
};
function pushMap(map, key, value) {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}

// tests/importResolver.test.ts
var FILES = [
  "src/extension.ts",
  "src/indexer/indexManager.ts",
  "src/indexer/dartParser.ts",
  "src/indexer/jsTsParser.ts",
  "src/utils/index.ts",
  "src/utils/helpers.tsx",
  "lib/main.dart",
  "lib/core/theme.dart",
  "lib/data/user.dart",
  "lib/data/user.g.dart",
  "android/app/src/main/java/com/example/app/MainActivity.kt"
];
(0, import_node_test.test)("relative TypeScript imports resolve without extension", () => {
  const r = new ImportResolver(FILES);
  assert.equal(r.resolve("src/extension.ts", "./indexer/indexManager"), "src/indexer/indexManager.ts");
  assert.equal(r.resolve("src/indexer/indexManager.ts", "./dartParser"), "src/indexer/dartParser.ts");
});
(0, import_node_test.test)('ESM style ".js" specifiers map to the .ts source', () => {
  const r = new ImportResolver(FILES);
  assert.equal(r.resolve("src/indexer/indexManager.ts", "./jsTsParser.js"), "src/indexer/jsTsParser.ts");
});
(0, import_node_test.test)("directory imports resolve to index files and .tsx", () => {
  const r = new ImportResolver(FILES);
  assert.equal(r.resolve("src/extension.ts", "./utils"), "src/utils/index.ts");
  assert.equal(r.resolve("src/extension.ts", "./utils/helpers"), "src/utils/helpers.tsx");
});
(0, import_node_test.test)("npm packages, node builtins and SDK libraries are external", () => {
  const r = new ImportResolver(FILES, "my_app");
  assert.equal(r.resolve("src/extension.ts", "vscode"), null);
  assert.equal(r.resolve("src/extension.ts", "node:fs"), null);
  assert.equal(r.resolve("lib/main.dart", "dart:async"), null);
  assert.equal(r.resolve("lib/main.dart", "package:flutter/material.dart"), null);
});
(0, import_node_test.test)("dart package: imports of the own package resolve to lib/", () => {
  const r = new ImportResolver(FILES, "my_app");
  assert.equal(r.resolve("lib/main.dart", "package:my_app/core/theme.dart"), "lib/core/theme.dart");
});
(0, import_node_test.test)('dart relative imports and part directives work without "./"', () => {
  const r = new ImportResolver(FILES, "my_app");
  assert.equal(r.resolve("lib/main.dart", "core/theme.dart"), "lib/core/theme.dart");
  assert.equal(r.resolve("lib/data/user.dart", "user.g.dart"), "lib/data/user.g.dart");
  assert.equal(r.resolve("lib/data/user.g.dart", "user.dart"), "lib/data/user.dart");
});
(0, import_node_test.test)("kotlin fully qualified imports resolve by package path", () => {
  const r = new ImportResolver(FILES);
  assert.equal(
    r.resolve("android/app/src/main/java/com/example/app/Other.kt", "com.example.app.MainActivity"),
    "android/app/src/main/java/com/example/app/MainActivity.kt"
  );
});
(0, import_node_test.test)("imports escaping the project are rejected", () => {
  const r = new ImportResolver(FILES);
  assert.equal(r.resolve("src/extension.ts", "../../outside"), null);
});
(0, import_node_test.test)("tsconfig style path aliases", () => {
  const r = new ImportResolver(FILES, { paths: { "@/*": ["src/*"] } });
  assert.equal(r.resolve("src/extension.ts", "@/indexer/indexManager"), "src/indexer/indexManager.ts");
});
(0, import_node_test.test)("windows style keys are normalised and returned as indexed", () => {
  const r = new ImportResolver(["src\\a.ts", "src\\b.ts"]);
  assert.equal(r.resolve("src\\a.ts", "./b"), "src\\b.ts");
});
var INDEX = {
  "src/a.ts": {
    imports: [{ path: "./b" }],
    classes: [
      { name: "Alpha", line: 1, lineEnd: 20, extendsClass: "Base", methods: [{ name: "run" }, { name: "build" }] }
    ],
    functions: [{ name: "helper" }]
  },
  "src/b.ts": {
    imports: [],
    classes: [
      { name: "Base", line: 1, lineEnd: 10, methods: [{ name: "dispose" }] },
      { name: "IndexManager", line: 12, lineEnd: 40, methods: [{ name: "buildFullIndex" }, { name: "build" }] }
    ],
    functions: [{ name: "fromB" }, { name: "helper" }]
  },
  "src/c.ts": {
    imports: [],
    classes: [{ name: "Other", line: 1, lineEnd: 9, methods: [{ name: "build" }] }],
    functions: [{ name: "unique" }]
  }
};
function makeCalls() {
  const resolver = new ImportResolver(Object.keys(INDEX));
  return new CallResolver(INDEX, resolver);
}
(0, import_node_test.test)("calls on this / super use the caller class and its ancestors", () => {
  const c = makeCalls();
  assert.equal(c.resolve("src/a.ts", { name: "run", receiver: "this", callerClass: "Alpha" })?.qname, makeQName("src/a.ts", "Alpha", "run"));
  assert.equal(c.resolve("src/a.ts", { name: "dispose", receiver: "this", callerClass: "Alpha" })?.qname, makeQName("src/b.ts", "Base", "dispose"));
  assert.equal(c.resolve("src/a.ts", { name: "dispose", receiver: "super", callerClass: "Alpha" })?.qname, makeQName("src/b.ts", "Base", "dispose"));
});
(0, import_node_test.test)("a variable named after a class resolves to that class (indexManager -> IndexManager)", () => {
  const c = makeCalls();
  const hit = c.resolve("src/a.ts", { name: "buildFullIndex", receiver: "indexManager" });
  assert.equal(hit?.qname, makeQName("src/b.ts", "IndexManager", "buildFullIndex"));
});
(0, import_node_test.test)("ambiguous method names are NOT guessed (the old resolver picked the first class)", () => {
  const c = makeCalls();
  assert.equal(c.resolve("src/c.ts", { name: "build", receiver: "somethingElse" }), null);
  assert.equal(c.resolve("src/c.ts", { name: "build", receiver: "IndexManager" })?.qname, makeQName("src/b.ts", "IndexManager", "build"));
});
(0, import_node_test.test)("bare calls prefer same file, then imported files, then unique global", () => {
  const c = makeCalls();
  assert.equal(c.resolve("src/a.ts", { name: "helper" })?.qname, makeQName("src/a.ts", null, "helper"));
  assert.equal(c.resolve("src/a.ts", { name: "fromB" })?.qname, makeQName("src/b.ts", null, "fromB"));
  assert.equal(c.resolve("src/a.ts", { name: "unique" })?.qname, makeQName("src/c.ts", null, "unique"));
  assert.equal(c.resolve("src/c.ts", { name: "helper" }), null);
});
(0, import_node_test.test)("instantiation resolves to the class", () => {
  const c = makeCalls();
  const hit = c.resolve("src/a.ts", { name: "IndexManager" });
  assert.equal(hit?.kind, "class");
  assert.equal(hit?.qname, makeQName("src/b.ts", null, "IndexManager"));
});
(0, import_node_test.test)("missing callerClass is inferred from the line range", () => {
  const c = makeCalls();
  assert.equal(c.classAt("src/a.ts", 5), "Alpha");
  assert.equal(c.callerQName("src/a.ts", { name: "x", callerFunction: "run", line: 5 }), makeQName("src/a.ts", "Alpha", "run"));
  assert.equal(c.callerQName("src/a.ts", { name: "x", line: 99 }), makeQName("src/a.ts", null, "<module>"));
});
