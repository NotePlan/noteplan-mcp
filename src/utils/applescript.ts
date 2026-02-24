// Shared AppleScript utilities for NotePlan MCP tools

import { execFileSync } from 'child_process';
import { getDetectedAppName } from './version.js';

export const APPLESCRIPT_TIMEOUT_MS = 15_000;
/**
 * Returns the correct AppleScript app name (e.g. "NotePlan", "NotePlan Beta", "NotePlan 3").
 * Uses the name discovered during version detection at startup.
 */
export function getAppName(): string {
  return getDetectedAppName();
}

/** @deprecated Use getAppName() instead — this doesn't resolve "NotePlan Beta" etc. */
export const APP_NAME = 'NotePlan';

export function escapeAppleScript(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\x00-\x1f]/g, ' ');
}

const UPDATE_HINT =
  'This command may not be supported by your version of NotePlan. ' +
  'Please update to the latest version: ' +
  'TestFlight: https://testflight.apple.com/join/fm9q4OjE | ' +
  'App Store: https://apps.apple.com/app/apple-store/id1505432629';

/**
 * Patterns in AppleScript stderr that indicate the command is not implemented
 * in the current NotePlan version.
 */
const NOT_IMPLEMENTED_PATTERNS = [
  /is not handled/i,
  /doesn.t understand/i,
  /not supported/i,
  /can.t continue/i,
  /expected .* but received/i,
];

function isNotImplementedError(stderr: string): boolean {
  return NOT_IMPLEMENTED_PATTERNS.some((p) => p.test(stderr));
}

export function runAppleScript(script: string, timeoutMs = APPLESCRIPT_TIMEOUT_MS): string {
  try {
    return execFileSync('osascript', ['-e', script], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    }).trim();
  } catch (error: any) {
    if (error.killed) {
      throw new Error('AppleScript timed out');
    }
    const stderr = (error.stderr || '').trim();
    if (isNotImplementedError(stderr)) {
      throw new Error(`${stderr}\n\n${UPDATE_HINT}`);
    }
    throw new Error(stderr || error.message || 'AppleScript execution failed');
  }
}
