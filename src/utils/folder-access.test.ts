import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  isFolderAllowed,
  assertFolderAllowed,
  __resetFolderAccessConfigForTests,
} from './folder-access.js';

const ALLOWED = 'NOTEPLAN_ALLOWED_FOLDERS';
const DENIED = 'NOTEPLAN_DENIED_FOLDERS';

function withEnv(env: Partial<Record<string, string>>, fn: () => void): void {
  const before: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) before[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  __resetFolderAccessConfigForTests();
  try {
    fn();
  } finally {
    for (const [key, prev] of Object.entries(before)) {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
    __resetFolderAccessConfigForTests();
  }
}

beforeEach(() => {
  delete process.env[ALLOWED];
  delete process.env[DENIED];
  __resetFolderAccessConfigForTests();
});

afterEach(() => {
  delete process.env[ALLOWED];
  delete process.env[DENIED];
  __resetFolderAccessConfigForTests();
});

describe('isFolderAllowed — defaults', () => {
  it('allows everything when neither env var is set (back-compat)', () => {
    expect(isFolderAllowed('Notes/Personal/Diary.md')).toBe(true);
    expect(isFolderAllowed('Calendar/20260507.txt')).toBe(true);
    expect(isFolderAllowed('')).toBe(true);
  });
  // No-rules guarantee: the helpers must short-circuit BEFORE any normalization,
  // sugaring, or other work runs. Unsetting the vars again restores the no-op
  // behavior — the cached config is keyed off env-var presence.
  it('assertFolderAllowed never throws when no rules are configured', () => {
    expect(() => assertFolderAllowed('Notes/Personal/Diary.md', 'create')).not.toThrow();
    expect(() => assertFolderAllowed('Calendar/20260507.txt', 'delete')).not.toThrow();
    expect(() => assertFolderAllowed('Anything/At/All.md', 'move')).not.toThrow();
  });
});

describe('isFolderAllowed — denylist', () => {
  it('blocks files inside a denied folder', () => {
    withEnv({ [DENIED]: 'Notes/Personal' }, () => {
      expect(isFolderAllowed('Notes/Personal/Diary.md')).toBe(false);
      expect(isFolderAllowed('Notes/Personal')).toBe(false);
    });
  });
  it('allows siblings outside the denied folder', () => {
    withEnv({ [DENIED]: 'Notes/Personal' }, () => {
      expect(isFolderAllowed('Notes/Work/Plan.md')).toBe(true);
      expect(isFolderAllowed('Calendar/20260507.txt')).toBe(true);
    });
  });
  it('does NOT match folder names that share a prefix without a path boundary', () => {
    // Notes/Personal must not match Notes/PersonalRecords.
    withEnv({ [DENIED]: 'Notes/Personal' }, () => {
      expect(isFolderAllowed('Notes/PersonalRecords/index.md')).toBe(true);
      expect(isFolderAllowed('Notes/PersonalRecords.md')).toBe(true);
    });
  });
  it('supports multiple denied folders', () => {
    withEnv({ [DENIED]: 'Notes/Personal, Notes/Finance, Calendar' }, () => {
      expect(isFolderAllowed('Notes/Personal/Diary.md')).toBe(false);
      expect(isFolderAllowed('Notes/Finance/Budget.md')).toBe(false);
      expect(isFolderAllowed('Calendar/20260507.txt')).toBe(false);
      expect(isFolderAllowed('Notes/Work/Plan.md')).toBe(true);
    });
  });
  it('tolerates sloppy whitespace, slashes, and backslashes in the env value', () => {
    withEnv({ [DENIED]: '  /Notes/Personal/  ,\\Notes\\Finance\\  ' }, () => {
      expect(isFolderAllowed('Notes/Personal/Diary.md')).toBe(false);
      expect(isFolderAllowed('Notes/Finance/Budget.md')).toBe(false);
    });
  });
});

describe('isFolderAllowed — allowlist', () => {
  it('blocks paths outside the allowlist', () => {
    withEnv({ [ALLOWED]: 'Notes/Work' }, () => {
      expect(isFolderAllowed('Notes/Work/Plan.md')).toBe(true);
      expect(isFolderAllowed('Notes/Personal/Diary.md')).toBe(false);
      expect(isFolderAllowed('Calendar/20260507.txt')).toBe(false);
    });
  });
  it('allows the listed root folder itself', () => {
    withEnv({ [ALLOWED]: 'Notes/Work' }, () => {
      expect(isFolderAllowed('Notes/Work')).toBe(true);
    });
  });
  it('supports multiple allowed prefixes', () => {
    withEnv({ [ALLOWED]: 'Notes/Work, Calendar' }, () => {
      expect(isFolderAllowed('Notes/Work/Plan.md')).toBe(true);
      expect(isFolderAllowed('Calendar/20260507.txt')).toBe(true);
      expect(isFolderAllowed('Notes/Other/x.md')).toBe(false);
    });
  });
});

describe('isFolderAllowed — both lists', () => {
  it('denylist wins over allowlist for overlapping paths', () => {
    withEnv(
      { [ALLOWED]: 'Notes', [DENIED]: 'Notes/Personal' },
      () => {
        expect(isFolderAllowed('Notes/Work/Plan.md')).toBe(true);
        expect(isFolderAllowed('Notes/Personal/Diary.md')).toBe(false);
      }
    );
  });
});

describe('isFolderAllowed — top-level prefix sugar', () => {
  // Most users don't think to type the `Notes/` prefix when configuring
  // the env vars. A bare entry is treated as if it lived under `Notes/`.
  // `Calendar` (and `Calendar/...`) are reserved top-levels and stay as-is.
  it('treats a bare entry as Notes/<entry>', () => {
    withEnv({ [DENIED]: 'Personal' }, () => {
      expect(isFolderAllowed('Notes/Personal/Diary.md')).toBe(false);
      expect(isFolderAllowed('Notes/Personal')).toBe(false);
      expect(isFolderAllowed('Notes/Work/Plan.md')).toBe(true);
    });
  });
  it('still respects the path-boundary rule after sugaring', () => {
    withEnv({ [DENIED]: 'Personal' }, () => {
      expect(isFolderAllowed('Notes/PersonalRecords.md')).toBe(true);
    });
  });
  it('keeps Calendar as a reserved top-level (not sugared)', () => {
    withEnv({ [DENIED]: 'Calendar' }, () => {
      expect(isFolderAllowed('Calendar/20260507.txt')).toBe(false);
      expect(isFolderAllowed('Notes/Calendar/note.md')).toBe(true);
    });
  });
  it('mixes sugared and explicit entries in the same list', () => {
    // `Calendar/2026` targets a yearFolders-mode subtree (NotePlan stores
    // calendar files under year folders when that preference is enabled).
    // The path-boundary rule means it matches `Calendar/2026/...` but not
    // a flat `Calendar/20260507.txt`.
    withEnv({ [DENIED]: 'Personal, Notes/Finance, Calendar/2026' }, () => {
      expect(isFolderAllowed('Notes/Personal/Diary.md')).toBe(false);
      expect(isFolderAllowed('Notes/Finance/Budget.md')).toBe(false);
      expect(isFolderAllowed('Calendar/2026/20260507.txt')).toBe(false);
      expect(isFolderAllowed('Calendar/2025/20250507.txt')).toBe(true);
      expect(isFolderAllowed('Notes/Work/Plan.md')).toBe(true);
    });
  });
  it('applies sugar to the allowlist too', () => {
    withEnv({ [ALLOWED]: 'Work' }, () => {
      expect(isFolderAllowed('Notes/Work/Plan.md')).toBe(true);
      expect(isFolderAllowed('Notes/Personal/Diary.md')).toBe(false);
      // Calendar is NOT allowed because the sugared allow rule is `Notes/Work`.
      expect(isFolderAllowed('Calendar/20260507.txt')).toBe(false);
    });
  });
});

describe('assertFolderAllowed', () => {
  it('returns silently when access is allowed', () => {
    expect(() => assertFolderAllowed('Notes/Work/Plan.md', 'create')).not.toThrow();
  });
  it('throws with the deny env var name when blocked by the denylist', () => {
    withEnv({ [DENIED]: 'Notes/Personal' }, () => {
      expect(() => assertFolderAllowed('Notes/Personal/Diary.md', 'delete')).toThrowError(
        /NOTEPLAN_DENIED_FOLDERS/
      );
    });
  });
  it('throws with the allow env var name when blocked by the allowlist', () => {
    withEnv({ [ALLOWED]: 'Notes/Work' }, () => {
      expect(() => assertFolderAllowed('Notes/Other/x.md', 'create')).toThrowError(
        /NOTEPLAN_ALLOWED_FOLDERS/
      );
    });
  });
  it('mentions the action and the path in the error message', () => {
    withEnv({ [DENIED]: 'Notes/Personal' }, () => {
      expect(() => assertFolderAllowed('Notes/Personal/Diary.md', 'delete')).toThrowError(
        /Cannot delete "Notes\/Personal\/Diary\.md"/
      );
    });
  });
});
