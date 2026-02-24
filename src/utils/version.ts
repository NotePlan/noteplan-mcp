// Version detection and feature gating for NotePlan MCP server

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface NotePlanVersion {
  version: string;
  build: number;
  source: 'applescript' | 'plist' | 'unknown';
}

// Placeholder — set to the first build that ships themes/plugins/ui/space-writes
export const MIN_BUILD_ADVANCED_FEATURES = 1300;

// Build that ships the renderTemplate AppleScript command
export const MIN_BUILD_RENDER_TEMPLATE = 1400;

// Build that ships the embedText AppleScript command
export const MIN_BUILD_EMBED_TEXT = 1490;

// Build that ships the createBackup AppleScript command
export const MIN_BUILD_CREATE_BACKUP = 1492;

const CACHE_TTL_MS = 60_000;
let cachedVersion: NotePlanVersion | null = null;
let cachedAt = 0;
let cachedAppName: string | null = null;

/**
 * Returns the AppleScript-resolvable app name discovered during version detection.
 * Falls back to 'NotePlan' if detection hasn't run or found a running app.
 */
export function getDetectedAppName(): string {
  return cachedAppName ?? 'NotePlan';
}

// AppleScript may resolve the app by CFBundleName or by .app filename depending on macOS version.
// MAS installs can use the store marketing name as the .app folder name, so we try multiple names.
const APPLESCRIPT_APP_NAMES = [
  'NotePlan',
  'NotePlan 3',
  'NotePlan Beta',
  'NotePlan - To-Do List & Notes',
];

function detectViaAppleScript(): NotePlanVersion | null {
  for (const appName of APPLESCRIPT_APP_NAMES) {
    try {
      const isRunning = execFileSync('osascript', ['-e', `application "${appName}" is running`], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3_000,
      }).trim();
      if (isRunning !== 'true') {
        console.error(`[noteplan-mcp] AppleScript: "${appName}" not running, skipping`);
        continue;
      }
      console.error(`[noteplan-mcp] AppleScript: "${appName}" is running, querying version...`);

      const raw = execFileSync('osascript', ['-e', `tell application "${appName}" to getVersion`], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5_000,
      }).trim();
      const parsed = JSON.parse(raw);
      if (typeof parsed.version === 'string' && typeof parsed.build === 'number') {
        console.error(`[noteplan-mcp] AppleScript: detected "${appName}" v${parsed.version} build ${parsed.build}`);
        cachedAppName = appName;
        return { version: parsed.version, build: parsed.build, source: 'applescript' };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[noteplan-mcp] AppleScript detection failed for "${appName}": ${msg}`);
      if (msg.includes('not allowed') || msg.includes('permission') || msg.includes('1743') || msg.includes('assistive')) {
        console.error('[noteplan-mcp] Hint: The parent app (e.g. Claude Desktop, Terminal) may need Automation permission for NotePlan. Check System Settings > Privacy & Security > Automation.');
        return null; // Permission issue — no point trying other names
      }
    }
  }
  console.error('[noteplan-mcp] AppleScript: NotePlan not found running under any known name.');
  return null;
}

const KNOWN_APP_PATHS = [
  '/Applications/NotePlan 3.app',
  '/Applications/NotePlan.app',
  '/Applications/NotePlan Beta.app',
  '/Applications/NotePlan - To-Do List & Notes.app',
  path.join(process.env.HOME ?? '', 'Applications/NotePlan 3.app'),
  path.join(process.env.HOME ?? '', 'Applications/NotePlan.app'),
  path.join(process.env.HOME ?? '', 'Applications/NotePlan Beta.app'),
  path.join(process.env.HOME ?? '', 'Applications/NotePlan - To-Do List & Notes.app'),
  // Setapp
  '/Applications/Setapp/NotePlan 3.app',
  '/Applications/Setapp/NotePlan.app',
];

function detectViaPlist(): NotePlanVersion | null {
  console.error(`[noteplan-mcp] Plist: scanning ${KNOWN_APP_PATHS.length} known app paths...`);
  // First try hardcoded known paths
  const result = readVersionFromAppPath(KNOWN_APP_PATHS);
  if (result) return result;

  // Fallback: use mdfind (Spotlight) to locate the app bundle dynamically
  console.error(`[noteplan-mcp] Plist: app not found at known paths, trying mdfind...`);
  try {
    const mdfindResult = execFileSync('mdfind', ['kMDItemCFBundleIdentifier == "co.noteplan.NotePlan3" || kMDItemCFBundleIdentifier == "co.noteplan.NotePlan-setapp" || kMDItemCFBundleIdentifier == "co.noteplan.NotePlan"'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5_000,
    }).trim();
    if (mdfindResult) {
      const discoveredPaths = mdfindResult.split('\n').filter(Boolean);
      console.error(`[noteplan-mcp] mdfind discovered: ${discoveredPaths.join(', ')}`);
      const found = readVersionFromAppPath(discoveredPaths);
      if (found) return found;
    }
  } catch (err: unknown) {
    console.error(`[noteplan-mcp] mdfind fallback failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

function readVersionFromAppPath(appPaths: string[]): NotePlanVersion | null {
  for (const appPath of appPaths) {
    const plistPath = path.join(appPath, 'Contents/Info.plist');
    if (!fs.existsSync(plistPath)) {
      console.error(`[noteplan-mcp] Plist: no Info.plist at ${appPath}`);
      continue;
    }
    try {
      const version = execFileSync('defaults', ['read', path.join(appPath, 'Contents/Info'), 'CFBundleShortVersionString'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3_000,
      }).trim();
      const buildStr = execFileSync('defaults', ['read', path.join(appPath, 'Contents/Info'), 'CFBundleVersion'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3_000,
      }).trim();
      const build = parseInt(buildStr, 10) || 0;
      if (version) {
        console.error(`[noteplan-mcp] Plist: found v${version} build ${build} at ${appPath}`);
        return { version, build, source: 'plist' };
      }
    } catch (err: unknown) {
      console.error(`[noteplan-mcp] Plist read failed for ${appPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return null;
}

export function getNotePlanVersion(forceRefresh = false): NotePlanVersion {
  const now = Date.now();
  if (!forceRefresh && cachedVersion && (now - cachedAt) < CACHE_TTL_MS) {
    console.error(`[noteplan-mcp] Version: serving from cache (v${cachedVersion.version} build ${cachedVersion.build})`);
    return cachedVersion;
  }

  const version = detectViaAppleScript() ?? detectViaPlist() ?? null;
  if (!version) {
    console.error('[noteplan-mcp] Version: both AppleScript and Plist detection failed, falling back to 0.0.0');
    cachedVersion = { version: '0.0.0', build: 0, source: 'unknown' as const };
  } else {
    cachedVersion = version;
  }
  cachedAt = now;
  return cachedVersion;
}

export function isAdvancedFeaturesAvailable(forceRefresh = false): boolean {
  const { build } = getNotePlanVersion(forceRefresh);
  return build >= MIN_BUILD_ADVANCED_FEATURES;
}

export function upgradeMessage(feature: string): string {
  return `"${feature}" requires a newer version of NotePlan (build ${MIN_BUILD_ADVANCED_FEATURES}+). Please update NotePlan to use this feature.`;
}

let cachedMcpVersion: string | null = null;

export function getMcpServerVersion(): string {
  if (cachedMcpVersion) return cachedMcpVersion;
  try {
    const pkgPath = new URL('../../package.json', import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    cachedMcpVersion = pkg.version ?? 'unknown';
  } catch {
    cachedMcpVersion = 'unknown';
  }
  return cachedMcpVersion!;
}
