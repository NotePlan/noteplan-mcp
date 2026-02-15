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
export const MIN_BUILD_EMBED_TEXT = 1491;

// Build that ships the createBackup AppleScript command
export const MIN_BUILD_CREATE_BACKUP = 1492;

const CACHE_TTL_MS = 60_000;
let cachedVersion: NotePlanVersion | null = null;
let cachedAt = 0;

function detectViaAppleScript(): NotePlanVersion | null {
  try {
    // Check if NotePlan is running first to avoid launching it as a side effect
    const isRunning = execFileSync('osascript', ['-e', 'application "NotePlan" is running'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3_000,
    }).trim();
    if (isRunning !== 'true') return null;

    const raw = execFileSync('osascript', ['-e', 'tell application "NotePlan" to getVersion'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5_000,
    }).trim();
    const parsed = JSON.parse(raw);
    if (typeof parsed.version === 'string' && typeof parsed.build === 'number') {
      return { version: parsed.version, build: parsed.build, source: 'applescript' };
    }
  } catch {
    // App not running or command not available
  }
  return null;
}

const KNOWN_APP_PATHS = [
  '/Applications/NotePlan 3.app',
  '/Applications/NotePlan.app',
  path.join(process.env.HOME ?? '', 'Applications/NotePlan 3.app'),
  path.join(process.env.HOME ?? '', 'Applications/NotePlan.app'),
  // Setapp
  '/Applications/Setapp/NotePlan 3.app',
  '/Applications/Setapp/NotePlan.app',
];

function detectViaPlist(): NotePlanVersion | null {
  for (const appPath of KNOWN_APP_PATHS) {
    const plistPath = path.join(appPath, 'Contents/Info.plist');
    if (!fs.existsSync(plistPath)) continue;
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
        return { version, build, source: 'plist' };
      }
    } catch {
      // plist read failed for this path, try next
    }
  }
  return null;
}

export function getNotePlanVersion(forceRefresh = false): NotePlanVersion {
  const now = Date.now();
  if (!forceRefresh && cachedVersion && (now - cachedAt) < CACHE_TTL_MS) {
    return cachedVersion;
  }

  const version = detectViaAppleScript() ?? detectViaPlist() ?? { version: '0.0.0', build: 0, source: 'unknown' as const };
  cachedVersion = version;
  cachedAt = now;
  return version;
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
