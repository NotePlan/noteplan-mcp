import { describe, it, expect, vi, beforeEach } from 'vitest';

// detectConfig() depends on fs/child_process to find the storage path.
// We don't care about its return value here — only the BRIDGE precedence,
// so we mock the heuristic to always return '.txt'. That way any test
// expecting '.md' must be coming from the bridge path.
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => [{ isFile: () => true, name: '20240101.txt' }]),
  statSync: vi.fn(() => ({ mtimeMs: 1, isFile: () => true, isDirectory: () => false })),
  promises: { readFile: vi.fn(), writeFile: vi.fn(), stat: vi.fn() },
}));
vi.mock('child_process', () => ({ execFileSync: vi.fn(() => '/np\n') }));
vi.mock('../transport/bridge-availability.js', () => ({
  getBridgeClient: vi.fn(),
}));
vi.mock('../transport/bridge-fs.js', () => ({
  readFileUtf8: vi.fn(),
  statPath: vi.fn(),
  pathExists: vi.fn(),
  readDir: vi.fn(),
}));
vi.mock('./ripgrep-search.js', () => ({
  isRipgrepAvailable: vi.fn(),
  ripgrepOnlyMatching: vi.fn(),
}));

import {
  resolveNotePlanFileExtension,
  buildCalendarNotePathAsync,
  __resetCalendarExtensionCache,
} from './file-reader.js';
import { getBridgeClient } from '../transport/bridge-availability.js';

const mockedGetBridgeClient = vi.mocked(getBridgeClient);

beforeEach(() => {
  vi.clearAllMocks();
  __resetCalendarExtensionCache();
});

describe('resolveNotePlanFileExtension – bridge precedence', () => {
  it("returns the bridge's reported extension when NotePlan is running", async () => {
    mockedGetBridgeClient.mockResolvedValue({
      config: vi.fn().mockResolvedValue({ fileExtension: '.md' }),
    } as never);
    expect(await resolveNotePlanFileExtension()).toBe('.md');
  });

  it('falls back to the fs heuristic when no bridge is available', async () => {
    mockedGetBridgeClient.mockResolvedValue(null);
    // The fs mock at the top of this file shows one .txt calendar file,
    // so the heuristic returns '.txt'.
    expect(await resolveNotePlanFileExtension()).toBe('.txt');
  });

  it('falls back when bridge.config() throws', async () => {
    mockedGetBridgeClient.mockResolvedValue({
      config: vi.fn().mockRejectedValue(new Error('boom')),
    } as never);
    expect(await resolveNotePlanFileExtension()).toBe('.txt');
  });

  it('ignores a malformed bridge fileExtension and falls back', async () => {
    mockedGetBridgeClient.mockResolvedValue({
      config: vi.fn().mockResolvedValue({ fileExtension: '.markdown' }),
    } as never);
    expect(await resolveNotePlanFileExtension()).toBe('.txt');
  });
});

describe('buildCalendarNotePathAsync', () => {
  it("uses the bridge's extension for new calendar notes (regression: hardcoded .txt)", async () => {
    mockedGetBridgeClient.mockResolvedValue({
      config: vi.fn().mockResolvedValue({ fileExtension: '.md' }),
    } as never);
    expect(await buildCalendarNotePathAsync('20260403')).toBe('Calendar/20260403.md');
  });
});
