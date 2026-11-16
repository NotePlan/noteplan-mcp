// Deprecation notice for this Node.js connector.
//
// NotePlan 3.22 ships a built-in connector (Help > AI Connectors (MCP)) that
// replaces this package. The connector keeps working so nobody gets blocked,
// but the AI app is asked to tell the user, with the steps that fit the
// installed NotePlan version and sync method.

export const HELP_ARTICLE_URL = 'https://help.noteplan.co/article/277-how-to-install-the-noteplan-mcp-server';

/** First NotePlan version with the built-in connector. */
const BUILT_IN_CONNECTOR_VERSION: [number, number] = [3, 22];

/** Show the notice in a tool result again after this long (the server can run for days). */
const REPEAT_AFTER_MS = 24 * 60 * 60 * 1000;

export interface DeprecationContext {
  /** Installed NotePlan version, e.g. "3.22.1", or null when unknown. */
  notePlanVersion: string | null;
  /** True when the notes sync with iCloud Drive (the built-in connector can't read those). */
  usesICloudDrive: boolean;
}

export function hasBuiltInConnector(version: string | null): boolean {
  if (!version) return false;
  const [major, minor] = version.split('.').map((part) => parseInt(part, 10));
  if (Number.isNaN(major)) return false;
  const [needMajor, needMinor] = BUILT_IN_CONNECTOR_VERSION;
  return major > needMajor || (major === needMajor && (minor || 0) >= needMinor);
}

/** The steps for the user, in plain words. */
export function userSteps(context: DeprecationContext): string[] {
  const steps: string[] = [];
  if (context.notePlanVersion === null) {
    steps.push('Make sure NotePlan is version 3.22 or later, and update it if needed (App Store or Setapp).');
  } else if (!hasBuiltInConnector(context.notePlanVersion)) {
    steps.push(`Update NotePlan to version 3.22 or later (installed: ${context.notePlanVersion}), from the App Store or Setapp.`);
  }
  if (context.usesICloudDrive) {
    steps.push('In NotePlan, switch to CloudKit sync in Settings > Sync. The new connector can\'t read notes that sync with iCloud Drive.');
  }
  steps.push('In NotePlan, open Help > AI Connectors (MCP) and install the connector for your AI app (for Claude Desktop: "Install Claude Connector…").');
  steps.push('Remove this old connector, otherwise the NotePlan tools show up twice. Claude Desktop: Settings > Developer > Edit Config, delete the "noteplan" entry under mcpServers, save, and quit Claude with ⌘Q. Claude Code: run `claude mcp remove noteplan`. Codex: run `codex mcp remove noteplan`.');
  return steps;
}

/** Text for the tool result: addressed to the AI, asking it to tell the user. */
export function deprecationNotice(context: DeprecationContext): string {
  const steps = userSteps(context).map((step, index) => `${index + 1}. ${step}`).join('\n');
  return [
    'NOTICE FOR THE USER (please tell the user once, briefly, then continue with their request):',
    'This NotePlan connector (@noteplanco/noteplan-mcp, Node.js) is deprecated and will stop receiving updates. It still works for now.',
    'NotePlan 3.22 and later has a built-in connector that replaces it: no Node.js needed, and it updates with NotePlan. To switch:',
    steps,
    `Details: ${HELP_ARTICLE_URL}`,
  ].join('\n');
}

/** Short version for the server instructions. */
export function deprecationInstructions(): string {
  return [
    '## Deprecated connector',
    '',
    'This Node.js NotePlan connector is deprecated. NotePlan 3.22 and later has a built-in connector that replaces it (NotePlan > Help > AI Connectors (MCP)).',
    `When you first use a NotePlan tool in a conversation, tell the user this once and point them to ${HELP_ARTICLE_URL}. The tools keep working, so continue with their request.`,
  ].join('\n');
}

/**
 * Decides when a tool result carries the notice: the first call after the
 * server starts, then again once a day.
 */
export class DeprecationNoticeGate {
  private lastShownAt: number | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  shouldShow(): boolean {
    const now = this.now();
    if (this.lastShownAt !== null && now - this.lastShownAt < REPEAT_AFTER_MS) return false;
    this.lastShownAt = now;
    return true;
  }
}
