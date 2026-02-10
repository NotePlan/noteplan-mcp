// Shared AppleScript utilities for NotePlan MCP tools

import { execFileSync } from 'child_process';

export const APPLESCRIPT_TIMEOUT_MS = 15_000;
export const APP_NAME = 'NotePlan';

export function escapeAppleScript(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\x00-\x1f]/g, ' ');
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
    throw new Error(stderr || error.message || 'AppleScript execution failed');
  }
}
