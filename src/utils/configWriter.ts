/**
 * Safe writers for third-party configuration files (Claude Desktop, Cursor, Gemini, VS Code MCP).
 *
 * Problems with the previous inline implementation in mcpSetup.ts:
 *   - a config file that failed to parse (comments, trailing commas, a half saved file) was treated
 *     as `{}` and then overwritten, deleting every other MCP server the user had configured;
 *   - `GEMINI.md` was updated with `before + content`, which threw away everything the user (or
 *     another tool) had written below the extension's block;
 *   - the other of `servers`/`mcpServers` was deleted instead of merged;
 *   - files were rewritten on every start, even when nothing changed;
 *   - no backups, non-atomic writes.
 *
 * Nothing here imports `vscode`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type WriteStatus = 'created' | 'updated' | 'unchanged' | 'skipped' | 'error';

export interface WriteResult {
  path: string;
  status: WriteStatus;
  message?: string;
  backup?: string;
}

export function defaultBackupDir(): string {
  return path.join(os.homedir(), '.flutter-explorer', 'backups');
}

/** Write via a temp file in the same directory, then rename over the target. */
export function writeFileAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/** Copy `filePath` into `backupDir` (timestamped) and keep only the 10 newest copies per file. */
export function backupFile(filePath: string, backupDir: string = defaultBackupDir()): string | null {
  try {
    if (!fs.existsSync(filePath)) { return null; }
    fs.mkdirSync(backupDir, { recursive: true });
    const safeName = filePath.replace(/[:\\/]+/g, '_').replace(/^_+/, '');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(backupDir, `${stamp}__${safeName}.bak`);
    fs.copyFileSync(filePath, target);

    const suffix = `__${safeName}.bak`;
    const copies = fs.readdirSync(backupDir).filter(f => f.endsWith(suffix)).sort();
    for (const old of copies.slice(0, Math.max(0, copies.length - 10))) {
      try { fs.unlinkSync(path.join(backupDir, old)); } catch { /* ignore */ }
    }
    return target;
  } catch {
    return null;
  }
}

function detectIndent(text: string): string | number {
  const m = /^([ \t]+)"/m.exec(text);
  if (!m) { return 2; }
  return m[1].includes('\t') ? '\t' : m[1].length;
}

function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP server entries inside JSON config files
// ─────────────────────────────────────────────────────────────────────────────

export function upsertMcpServer(
  filePath: string,
  serverName: string,
  entry: Record<string, unknown>,
  useServersKey: boolean,
  backupDir: string = defaultBackupDir(),
): WriteResult {
  try {
    const mainKey = useServersKey ? 'servers' : 'mcpServers';
    const otherKey = useServersKey ? 'mcpServers' : 'servers';

    let config: Record<string, any> = {};
    let existed = false;
    let indent: string | number = 2;
    let eol = '\n';
    let hadTrailingNewline = false;

    if (fs.existsSync(filePath)) {
      existed = true;
      const text = fs.readFileSync(filePath, 'utf8');
      if (text.trim() !== '') {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
        } catch (err) {
          return {
            path: filePath,
            status: 'skipped',
            message: 'File is not strict JSON (comments, trailing comma or a syntax error); it was left untouched. ' +
              `Add the "${serverName}" entry to "${mainKey}" manually.`,
          };
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { path: filePath, status: 'skipped', message: 'Top level of the file is not a JSON object; left untouched.' };
        }
        config = parsed as Record<string, any>;
        indent = detectIndent(text);
        eol = detectEol(text);
        hadTrailingNewline = /\n$/.test(text);
      }
    }

    let changed = !existed;

    const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

    if (!isObject(config[mainKey])) {
      if (config[mainKey] !== undefined) {
        return { path: filePath, status: 'skipped', message: `"${mainKey}" exists but is not an object; left untouched.` };
      }
      config[mainKey] = {};
      changed = true;
    }

    // Merge (never delete) servers that were stored under the other key.
    if (isObject(config[otherKey])) {
      for (const [name, value] of Object.entries(config[otherKey])) {
        if (config[mainKey][name] === undefined) { config[mainKey][name] = value; }
      }
      delete config[otherKey];
      changed = true;
    }

    if (JSON.stringify(config[mainKey][serverName]) !== JSON.stringify(entry)) {
      config[mainKey][serverName] = entry;
      changed = true;
    }

    if (!changed) { return { path: filePath, status: 'unchanged' }; }

    const backup = existed ? backupFile(filePath, backupDir) ?? undefined : undefined;
    let out = JSON.stringify(config, null, indent);
    if (eol !== '\n') { out = out.replace(/\n/g, eol); }
    if (!existed || hadTrailingNewline) { out += eol; }
    writeFileAtomic(filePath, out);
    return { path: filePath, status: existed ? 'updated' : 'created', backup };
  } catch (err) {
    return { path: filePath, status: 'error', message: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Marker-delimited block inside a Markdown/text file (GEMINI.md)
// ─────────────────────────────────────────────────────────────────────────────

export function upsertMarkedBlock(
  filePath: string,
  blockId: string,
  body: string,
  legacyHeader: string | null = null,
  backupDir: string = defaultBackupDir(),
): WriteResult {
  try {
    const begin = `<!-- flutter-explorer:${blockId}:begin -->`;
    const end = `<!-- flutter-explorer:${blockId}:end -->`;

    const existed = fs.existsSync(filePath);
    const existing = existed ? fs.readFileSync(filePath, 'utf8') : '';
    const eol = detectEol(existing);
    const normalizedBody = body.replace(/\r\n/g, '\n').trim().replace(/\n/g, eol);
    const block = `${begin}${eol}${normalizedBody}${eol}${end}${eol}`;

    let updated: string;
    const beginIdx = existing.indexOf(begin);
    const endIdx = beginIdx >= 0 ? existing.indexOf(end, beginIdx + begin.length) : -1;

    if (beginIdx >= 0 && endIdx >= 0) {
      let regionEnd = endIdx + end.length;
      // swallow the line break that followed the end marker so the block stays idempotent
      if (existing.startsWith('\r\n', regionEnd)) { regionEnd += 2; }
      else if (existing[regionEnd] === '\n') { regionEnd += 1; }
      updated = existing.slice(0, beginIdx) + block + existing.slice(regionEnd);
    } else if (legacyHeader && existing.includes(legacyHeader)) {
      // Older versions appended the block without markers. The legacy block runs until the next
      // top level heading ("# ") or the end of file; anything after it belongs to the user.
      const start = existing.indexOf(legacyHeader);
      const after = existing.slice(start + legacyHeader.length);
      const next = /\r?\n# (?!#)/.exec(after);
      const stop = next ? start + legacyHeader.length + next.index + 1 : existing.length;
      const tailStart = next && existing[stop] === '\r' ? stop + 1 : stop;
      updated = existing.slice(0, start) + block + (stop < existing.length ? eol + existing.slice(tailStart) : '');
    } else if (existing.trim() === '') {
      updated = block;
    } else {
      updated = existing.replace(/\s+$/, '') + eol + eol + block;
    }

    if (updated === existing) { return { path: filePath, status: 'unchanged' }; }

    const backup = existed && existing.trim() !== '' ? backupFile(filePath, backupDir) ?? undefined : undefined;
    writeFileAtomic(filePath, updated);
    return { path: filePath, status: existed ? 'updated' : 'created', backup };
  } catch (err) {
    return { path: filePath, status: 'error', message: String(err) };
  }
}
