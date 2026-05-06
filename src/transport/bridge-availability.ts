import { runAppleScript } from '../utils/applescript.js';
import {
  APPLESCRIPT_APP_NAMES,
  MIN_BUILD_BRIDGE,
  getDetectedAppName,
  getNotePlanVersion,
} from '../utils/version.js';
import { BridgeClient } from './bridge-client.js';

const POSITIVE_TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 5_000;

let cachedClient: BridgeClient | null = null;
let cacheExpiresAt = 0;
let inFlight: Promise<BridgeClient | null> | null = null;

export async function getBridgeClient(): Promise<BridgeClient | null> {
  if (cacheExpiresAt > Date.now()) return cachedClient;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const client = await discover();
      cachedClient = client;
      cacheExpiresAt = Date.now() + (client ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS);
      return client;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Drop the cached client — next call will rediscover. Use after a failed request. */
export function invalidateBridgeClient(): void {
  cachedClient = null;
  cacheExpiresAt = 0;
}

async function discover(): Promise<BridgeClient | null> {
  const { build } = getNotePlanVersion();
  if (build > 0 && build < MIN_BUILD_BRIDGE) return null;

  const info = queryBridgeInfo();
  if (!info) return null;

  const client = new BridgeClient(info.port, info.token, {
    onFailure: invalidateBridgeClient,
  });
  if (!(await client.health())) return null;
  return client;
}

/**
 * Try the already-detected app name first (cached during version detection)
 * to avoid up-to-4 sequential 5-second timeouts on the common case. Falls
 * back to iterating remaining names if the detected one doesn't match.
 */
function queryBridgeInfo(): { port: number; token: string } | null {
  const detected = getDetectedAppName();
  const ordered = [detected, ...APPLESCRIPT_APP_NAMES.filter((n) => n !== detected)];

  for (const appName of ordered) {
    let raw: string;
    try {
      raw = runAppleScript(`tell application "${appName}" to getMCPBridgeInfo`, 5_000);
    } catch {
      continue;
    }
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.port === 'number' &&
        parsed.port > 0 &&
        typeof parsed.token === 'string' &&
        parsed.token.length > 0
      ) {
        return { port: parsed.port, token: parsed.token };
      }
    } catch {
      // Not JSON — wrong app or stale response. Try next name.
    }
  }
  return null;
}
