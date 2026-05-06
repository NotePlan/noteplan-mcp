import { describe, expect, it } from 'vitest';
import {
  filterBridgeRowsByTrash,
  findRootSpaceIdFromRows,
  isTrashFolderRow,
} from './space-row-utils.js';
import { SQLITE_NOTE_TYPES } from './types.js';
import type { BridgeSpaceRow } from '../transport/bridge-client.js';

function row(overrides: Partial<BridgeSpaceRow> & { id: string }): BridgeSpaceRow {
  return {
    content: '',
    note_type: SQLITE_NOTE_TYPES.TEAMSPACE_NOTE,
    title: '',
    filename: '',
    parent: null,
    is_dir: 0,
    ...overrides,
  };
}

describe('isTrashFolderRow', () => {
  it('matches @Trash folder regardless of casing', () => {
    expect(isTrashFolderRow({ is_dir: 1, title: '@Trash' })).toBe(true);
    expect(isTrashFolderRow({ is_dir: 1, title: '@trash' })).toBe(true);
    expect(isTrashFolderRow({ is_dir: 1, title: '@TRASH' })).toBe(true);
  });

  it('rejects regular folders', () => {
    expect(isTrashFolderRow({ is_dir: 1, title: 'Notes' })).toBe(false);
  });

  it('rejects notes named @Trash', () => {
    // is_dir = 0 — a note literally titled "@Trash" should not be treated as the system folder.
    expect(isTrashFolderRow({ is_dir: 0, title: '@Trash' })).toBe(false);
  });

  it('handles missing/null title', () => {
    expect(isTrashFolderRow({ is_dir: 1, title: undefined })).toBe(false);
    expect(isTrashFolderRow({ is_dir: 1, title: null })).toBe(false);
  });
});

describe('filterBridgeRowsByTrash', () => {
  it('returns input unchanged when includeTrash=true', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    expect(filterBridgeRowsByTrash(rows, true)).toBe(rows);
  });

  it('returns input unchanged when no @Trash folder exists', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    expect(filterBridgeRowsByTrash(rows)).toEqual(rows);
  });

  it('removes the @Trash folder itself plus its descendants', () => {
    const rows = [
      row({ id: 'space', is_dir: 1, title: 'My Space' }),
      row({ id: 'trash', is_dir: 1, title: '@Trash', parent: 'space' }),
      row({ id: 'note-in-trash', parent: 'trash' }),
      row({ id: 'note-in-trash-subfolder', parent: 'sub-trash-folder' }),
      row({ id: 'sub-trash-folder', is_dir: 1, title: 'Inner', parent: 'trash' }),
      row({ id: 'kept-note', parent: 'space' }),
    ];
    const result = filterBridgeRowsByTrash(rows);
    const ids = result.map((r) => r.id).sort();
    expect(ids).toEqual(['kept-note', 'space']);
  });

  it('handles MULTIPLE @Trash folders (one per teamspace)', () => {
    // Real-world scenario: each teamspace has its own @Trash folder.
    // Both subtrees must be filtered out.
    const rows = [
      row({ id: 'space-a', is_dir: 1, title: 'A' }),
      row({ id: 'trash-a', is_dir: 1, title: '@Trash', parent: 'space-a' }),
      row({ id: 'note-a-trashed', parent: 'trash-a' }),
      row({ id: 'note-a-kept', parent: 'space-a' }),

      row({ id: 'space-b', is_dir: 1, title: 'B' }),
      row({ id: 'trash-b', is_dir: 1, title: '@Trash', parent: 'space-b' }),
      row({ id: 'note-b-trashed', parent: 'trash-b' }),
      row({ id: 'note-b-kept', parent: 'space-b' }),
    ];
    const visible = filterBridgeRowsByTrash(rows).map((r) => r.id).sort();
    expect(visible).toEqual(['note-a-kept', 'note-b-kept', 'space-a', 'space-b']);
  });

  it('does not infinite-loop on a parent-chain cycle inside @Trash', () => {
    // a -> b -> a (corrupt data); both reachable from @Trash root.
    const rows = [
      row({ id: 'trash', is_dir: 1, title: '@Trash' }),
      row({ id: 'a', is_dir: 1, title: 'A', parent: 'trash' }),
      // The bridge graph itself shouldn't have cycles, but be defensive.
      row({ id: 'b', is_dir: 1, title: 'B', parent: 'a' }),
      // Children-by-parent map is built by iterating once over rows, so
      // the dedupe `seen` set inside the BFS is what saves us.
      row({ id: 'note', parent: 'b' }),
    ];
    // Should complete in well under a second; vitest's default 5s timeout
    // catches a real infinite loop.
    const visible = filterBridgeRowsByTrash(rows).map((r) => r.id);
    expect(visible).toEqual([]);
  });
});

describe('findRootSpaceIdFromRows', () => {
  it('returns undefined for a top-level note with no parent', () => {
    const rows = [row({ id: 'orphan' })];
    expect(findRootSpaceIdFromRows('orphan', rows)).toBeUndefined();
  });

  it('walks the chain to the teamspace root', () => {
    const rows = [
      row({ id: 'space', is_dir: 1, note_type: SQLITE_NOTE_TYPES.TEAMSPACE, title: 'Engineering' }),
      row({ id: 'folder', is_dir: 1, parent: 'space', title: 'Subfolder' }),
      row({ id: 'note', parent: 'folder' }),
    ];
    expect(findRootSpaceIdFromRows('note', rows)).toBe('space');
  });

  it('returns undefined when the chain breaks before hitting a teamspace', () => {
    const rows = [
      row({ id: 'note', parent: 'missing-parent' }),
    ];
    expect(findRootSpaceIdFromRows('note', rows)).toBeUndefined();
  });

  it('does NOT infinite-loop on a self-referential parent', () => {
    // Self-loop: row's parent points at itself. Bug regression — the
    // previous implementation hung indefinitely.
    const rows = [row({ id: 'note', parent: 'note' })];
    expect(findRootSpaceIdFromRows('note', rows)).toBeUndefined();
  });

  it('does NOT infinite-loop on a longer parent cycle', () => {
    // a -> b -> a
    const rows = [
      row({ id: 'a', parent: 'b' }),
      row({ id: 'b', parent: 'a' }),
    ];
    expect(findRootSpaceIdFromRows('a', rows)).toBeUndefined();
    expect(findRootSpaceIdFromRows('b', rows)).toBeUndefined();
  });
});
