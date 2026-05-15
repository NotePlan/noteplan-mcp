/**
 * Server-level configuration from environment variables.
 *
 * NOTEPLAN_READ_ONLY=true       → reject all write actions (safe for read-only MCP clients)
 * NOTEPLAN_SKIP_DRY_RUN=true    → skip the two-step dryRun/confirmationToken flow
 * NOTEPLAN_MCP_AUTOLAUNCH=false → suppress AppleScript-triggered NotePlan launches
 *                                  during bridge discovery (default: launch on probe)
 */

function envBool(key: string): boolean {
  const v = process.env[key];
  return v?.toLowerCase() === 'true' || v === '1';
}

export function isReadOnly(): boolean {
  return envBool('NOTEPLAN_READ_ONLY');
}

export function isSkipDryRun(): boolean {
  return envBool('NOTEPLAN_SKIP_DRY_RUN');
}

/** True when bridge discovery may activate NotePlan via AppleScript. Defaults
 *  to true; auto-launch sidesteps macOS Files & Folders (TCC) prompts by
 *  routing requests through NotePlan instead of direct container access.
 *  Set `NOTEPLAN_MCP_AUTOLAUNCH=false` to opt out (probe stays passive, MCP
 *  uses the SQLite / FS fallback when NotePlan is closed). */
export function shouldAutoLaunchNotePlan(): boolean {
  const v = process.env.NOTEPLAN_MCP_AUTOLAUNCH;
  if (v === undefined) return true;
  const normalized = v.toLowerCase();
  return normalized !== 'false' && normalized !== '0';
}
