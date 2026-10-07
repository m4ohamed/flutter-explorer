import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export interface PackageConfigEntry {
  name: string;
  rootUri: string;
  packageUri: string;
  languageVersion?: string;
  actualDir: string;
}

export interface PackageSearchResult {
  packageName: string;
  file: string;
  line: number;
  content: string;
}

export interface PubDevPackageSummary {
  name: string;
  latestVersion: string;
  description: string;
  url: string;
  pubPoints?: number;
  popularity?: number;
  likes?: number;
  published?: string;
}

export class PackageResolver {
  private projectRoot: string;
  private packageConfig: Map<string, PackageConfigEntry> = new Map();
  private loaded = false;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.loadPackageConfig();
  }

  public reload(): void {
    this.packageConfig.clear();
    this.loaded = false;
    this.loadPackageConfig();
  }

  private loadPackageConfig(): void {
    const configPath = path.join(this.projectRoot, '.dart_tool', 'package_config.json');
    if (!fs.existsSync(configPath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const json = JSON.parse(raw);
      const dartToolDir = path.join(this.projectRoot, '.dart_tool');

      for (const pkg of json.packages || []) {
        let actualDir = '';
        const rootUri = pkg.rootUri || '';

        if (rootUri.startsWith('file://')) {
          try {
            actualDir = fileURLToPath(rootUri);
          } catch {
            actualDir = rootUri.replace(/^file:\/\/\/?/, '');
          }
        } else {
          actualDir = path.resolve(dartToolDir, rootUri);
        }

        actualDir = path.normalize(actualDir);

        this.packageConfig.set(pkg.name, {
          name: pkg.name,
          rootUri: pkg.rootUri,
          packageUri: pkg.packageUri || 'lib/',
          languageVersion: pkg.languageVersion,
          actualDir
        });
      }
      this.loaded = true;
    } catch (err) {
      console.error('[PackageResolver] Failed to parse package_config.json:', err);
    }
  }

  public getLoadedPackages(): string[] {
    if (!this.loaded) this.loadPackageConfig();
    return Array.from(this.packageConfig.keys());
  }

  public getPackageEntry(packageName: string): PackageConfigEntry | undefined {
    if (!this.loaded) this.loadPackageConfig();
    return this.packageConfig.get(packageName);
  }

  /**
   * Resolves a package URI (e.g. package:dio/dio.dart or package:flutter/material.dart)
   * into an absolute file path on the local filesystem.
   */
  public resolvePackageUri(uri: string): { filePath: string; exists: boolean; packageName: string } | null {
    if (!this.loaded) this.loadPackageConfig();

    const match = uri.match(/^package:([^/]+)\/(.*)$/);
    if (!match) {
      return null;
    }

    const packageName = match[1];
    const subPath = match[2];
    const entry = this.packageConfig.get(packageName);

    if (!entry) {
      return null;
    }

    const pkgLibDir = path.resolve(entry.actualDir, entry.packageUri);
    const targetFile = path.resolve(pkgLibDir, subPath);
    const normPkg = pkgLibDir.replace(/\\/g, '/');
    const normTarget = targetFile.replace(/\\/g, '/');
    if (!normTarget.startsWith(normPkg + '/') && normTarget !== normPkg) {
      return null;
    }

    return {
      filePath: targetFile,
      exists: fs.existsSync(targetFile),
      packageName
    };
  }

  /**
   * Reads source code for a package URI, optionally within a line slice.
   */
  public readPackageSource(uri: string, startLine = 1, lineCount = 100): {
    success: boolean;
    uri: string;
    filePath?: string;
    totalLines?: number;
    startLine?: number;
    endLine?: number;
    content?: string;
    error?: string;
  } {
    const resolved = this.resolvePackageUri(uri);
    if (!resolved) {
      return { success: false, uri, error: `Package for URI '${uri}' not found in .dart_tool/package_config.json` };
    }

    if (!resolved.exists) {
      return { success: false, uri, filePath: resolved.filePath, error: `File not found on disk: ${resolved.filePath}` };
    }

    try {
      const fullText = fs.readFileSync(resolved.filePath, 'utf-8');
      const lines = fullText.split('\n');
      const totalLines = lines.length;

      const safeStart = Math.max(1, startLine);
      const safeEnd = Math.min(totalLines, safeStart + lineCount - 1);
      const sliced = lines.slice(safeStart - 1, safeEnd).join('\n');

      return {
        success: true,
        uri,
        filePath: resolved.filePath,
        totalLines,
        startLine: safeStart,
        endLine: safeEnd,
        content: sliced
      };
    } catch (err: any) {
      return { success: false, uri, filePath: resolved.filePath, error: err.message };
    }
  }

  /**
   * Search across all or specific cached packages (ripgrep-like functionality)
   */
  public searchInPackages(query: string, options?: {
    packageName?: string;
    isRegex?: boolean;
    caseSensitive?: boolean;
    maxResults?: number;
  }): { resultsCount: number; results: PackageSearchResult[]; searchedPackages: number } {
    if (!this.loaded) this.loadPackageConfig();

    const maxResults = options?.maxResults || 50;
    const isRegex = !!options?.isRegex;
    const caseSensitive = !!options?.caseSensitive;
    const targetPackage = options?.packageName;

    let regex: RegExp;
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      regex = isRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch (e: any) {
      throw new Error(`Invalid search pattern: ${e.message}`);
    }

    const packagesToSearch: PackageConfigEntry[] = [];
    if (targetPackage) {
      const entry = this.packageConfig.get(targetPackage);
      if (entry) packagesToSearch.push(entry);
    } else {
      for (const entry of this.packageConfig.values()) {
        packagesToSearch.push(entry);
      }
    }

    const results: PackageSearchResult[] = [];

    for (const pkg of packagesToSearch) {
      if (results.length >= maxResults) break;

      const libDir = path.join(pkg.actualDir, pkg.packageUri);
      if (!fs.existsSync(libDir)) continue;

      const scanDir = (dir: string) => {
        if (results.length >= maxResults) return;
        let items: string[] = [];
        try {
          items = fs.readdirSync(dir);
        } catch {
          return;
        }

        for (const item of items) {
          if (results.length >= maxResults) break;
          const fullPath = path.join(dir, item);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              if (item !== '.git' && item !== 'build') {
                scanDir(fullPath);
              }
            } else if (item.endsWith('.dart')) {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (results.length >= maxResults) break;
                const lineText = lines[i];
                if (regex.test(lineText)) {
                  const relInPackage = path.relative(libDir, fullPath).replace(/\\/g, '/');
                  results.push({
                    packageName: pkg.name,
                    file: `package:${pkg.name}/${relInPackage}`,
                    line: i + 1,
                    content: lineText.trim().substring(0, 200)
                  });
                }
              }
            }
          } catch {
            // skip unreadable
          }
        }
      };

      scanDir(libDir);
    }

    return {
      resultsCount: results.length,
      results,
      searchedPackages: packagesToSearch.length
    };
  }

  // ─── Pub.dev Live Integration ──────────────────────────────────────────────

  /**
   * Searches pub.dev for packages matching a query
   */
  public async searchPubDev(query: string, page = 1): Promise<{
    packages: PubDevPackageSummary[];
    totalCount?: number;
  }> {
    const url = `https://pub.dev/api/search?q=${encodeURIComponent(query)}&page=${page}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FlutterExplorer-MCP/1.0' }
    });

    if (!res.ok) {
      throw new Error(`pub.dev search failed with status ${res.status}: ${res.statusText}`);
    }

    const data: any = await res.json();
    const packages: PubDevPackageSummary[] = [];

    for (const item of (data.packages || []).slice(0, 15)) {
      const pkgName = item.package;
      packages.push({
        name: pkgName,
        latestVersion: 'loading',
        description: '',
        url: `https://pub.dev/packages/${pkgName}`
      });
    }

    // Parallel fetch top package details
    await Promise.all(
      packages.map(async (pkg) => {
        try {
          const detailRes = await fetch(`https://pub.dev/api/packages/${encodeURIComponent(pkg.name)}`, {
            headers: { 'User-Agent': 'FlutterExplorer-MCP/1.0' }
          });
          if (detailRes.ok) {
            const detail: any = await detailRes.json();
            pkg.latestVersion = detail.latest?.version || 'unknown';
            pkg.description = detail.latest?.pubspec?.description || '';
            pkg.published = detail.latest?.published || '';
          }
        } catch {
          // ignore individual timeout
        }
      })
    );

    return { packages, totalCount: data.packages?.length };
  }

  /**
   * Retrieves detailed metrics and metadata for a specific package from pub.dev
   */
  public async getPubPackageInfo(packageName: string): Promise<any> {
    const [infoRes, scoreRes] = await Promise.all([
      fetch(`https://pub.dev/api/packages/${encodeURIComponent(packageName)}`, {
        headers: { 'User-Agent': 'FlutterExplorer-MCP/1.0' }
      }),
      fetch(`https://pub.dev/api/packages/${encodeURIComponent(packageName)}/score`, {
        headers: { 'User-Agent': 'FlutterExplorer-MCP/1.0' }
      })
    ]);

    if (!infoRes.ok) {
      throw new Error(`Package '${packageName}' not found on pub.dev (${infoRes.status})`);
    }

    const info: any = await infoRes.json();
    let score: any = {};
    if (scoreRes.ok) {
      score = await scoreRes.json();
    }

    const latest = info.latest || {};
    const pubspec = latest.pubspec || {};

    return {
      name: info.name,
      latestVersion: latest.version,
      published: latest.published,
      description: pubspec.description,
      homepage: pubspec.homepage,
      repository: pubspec.repository,
      documentation: pubspec.documentation,
      dependencies: Object.keys(pubspec.dependencies || {}),
      score: {
        grantedPoints: score.grantedPoints,
        maxPoints: score.maxPoints,
        likeCount: score.likeCount,
        popularityScore: score.popularityScore ? Math.round(score.popularityScore * 100) : undefined,
        tags: score.tags || []
      },
      versionsCount: (info.versions || []).length
    };
  }
}
