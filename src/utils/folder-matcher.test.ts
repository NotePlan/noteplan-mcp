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
});
