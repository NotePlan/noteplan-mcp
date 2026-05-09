import { describe, it, expect } from 'vitest';
import { matchFolder } from './folder-matcher.js';
import { Folder } from '../noteplan/types.js';

function makeFolder(folderPath: string): Folder {
  const segments = folderPath.split('/');
  return {
    name: segments[segments.length - 1],
    path: folderPath,
    source: 'local' as const,
  };
}

describe('matchFolder', () => {
  describe('multi-level path queries should not fuzzy-match to wrong folders', () => {
    const folders: Folder[] = [
      makeFolder('99 🔬 Test and Temporary'),
      makeFolder('99 🔬 Test and Temporary/Test Sub-folder'),
    ];

    it('should NOT match a non-existent multi-level path to a similar existing folder', () => {
      // User requests "98 - Testing/Test Sub-folder A/Test Sub-folder B"
      // which doesn't exist at all. It should NOT fuzzy-match to
      // "99 🔬 Test and Temporary/Test Sub-folder"
      const result = matchFolder(
        '98 - Testing/Test Sub-folder A/Test Sub-folder B',
        folders,
      );
      expect(result.matched).toBe(false);
    });

    it('should still exact-match an existing multi-level path', () => {
      const result = matchFolder(
        '99 🔬 Test and Temporary/Test Sub-folder',
        folders,
      );
      expect(result.matched).toBe(true);
      expect(result.folder?.path).toBe('99 🔬 Test and Temporary/Test Sub-folder');
      expect(result.score).toBe(1.0);
    });

    it('should NOT match a 2-level non-existent path to a 1-level folder', () => {
      // "A/B" should not match "A" or anything with a different structure
      const result = matchFolder('Foo/Bar', [makeFolder('Foo')]);
      expect(result.matched).toBe(false);
    });
  });

  describe('reserved top-level names (Notes / Calendar) are not fuzzy-matched', () => {
    // Bug observed in manual testing: `folder: "Notes"` (the user wanted
    // the vault root) was substring-matched to `30 - Resources/35.0 - AI Notes`
    // with score ~0.81 because "AI Notes" contains "notes". Result: new
    // notes silently landed deep in the wrong subtree. The matcher now
    // returns `matched: false` for these literals so callers fall back
    // to the literal value, which file-writer collapses to root.
    const folders: Folder[] = [
      makeFolder('30 - Resources/35.0 - AI Notes'),
      makeFolder('30 - Resources/30.2 - Quick Notes'),
      makeFolder('Calendar/2026-09'),
      makeFolder('Work'),
    ];

    it('does not match bare "Notes" to a fuzzy substring', () => {
      const result = matchFolder('Notes', folders);
      expect(result.matched).toBe(false);
    });

    it('does not match "Notes/" (trailing slash) either', () => {
      expect(matchFolder('Notes/', folders).matched).toBe(false);
    });

    it('does not match bare "Calendar" to nested calendar subtrees', () => {
      const result = matchFolder('Calendar', folders);
      expect(result.matched).toBe(false);
    });

    it('is case-insensitive for the reserved names', () => {
      expect(matchFolder('notes', folders).matched).toBe(false);
      expect(matchFolder('CALENDAR', folders).matched).toBe(false);
    });

    it('still resolves real subfolder hints', () => {
      // Sanity: the short-circuit must not break ordinary fuzzy matching.
      const result = matchFolder('Work', folders);
      expect(result.matched).toBe(true);
      expect(result.folder?.path).toBe('Work');
    });

    it('still matches Notes/<sub> as a path query', () => {
      // `Notes/Work` is a path query; the path-exact branch handles it
      // (after the reserved-name guard). This must keep working.
      const result = matchFolder('Notes/Work', folders);
      expect(result.matched).toBe(true);
      expect(result.folder?.path).toBe('Work');
    });
  });
});
