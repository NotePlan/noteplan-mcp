/**
 * Server-level configuration from environment variables.
 *
 * NOTEPLAN_READ_ONLY=true   → reject all write actions (safe for read-only MCP clients)
 * NOTEPLAN_SKIP_DRY_RUN=true → skip the two-step dryRun/confirmationToken flow
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
