import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs');
vi.mock('./file-reader.js', () => ({
  getNotePlanPath: vi.fn(() => '/np'),
  getNotesPath: vi.fn(() => '/np/Notes'),
  getCalendarPath: vi.fn(() => '/np/Calendar'),
  getFileExtension: vi.fn(() => '.md'),
  hasYearSubfolders: vi.fn(() => false),
  buildCalendarNotePath: vi.fn((date: string) => `Calendar/${date}.md`),
  getCalendarNote: vi.fn(() => null),
}));

import {
  writeNoteFile,
  createProjectNote,
  createCalendarNote,
  ensureCalendarNote,
  appendToNote,
  prependToNote,
  updateNote,
  deleteNote,
  moveLocalNote,
  previewMoveLocalNote,
  restoreLocalNoteFromTrash,
  previewRestoreLocalNoteFromTrash,
  renameLocalNoteFile,
  previewRenameLocalNoteFile,
  createFolder,
  previewCreateFolder,
  deleteLocalFolder,
  previewDeleteLocalFolder,
  moveLocalFolder,
  previewMoveLocalFolder,
  renameLocalFolder,
  previewRenameLocalFolder,
} from './file-writer.js';

import { getCalendarNote } from './file-reader.js';

const mockFs = vi.mocked(fs);

beforeEach(() => {
  vi.resetAllMocks();
  // Default: directories exist, files do not
  mockFs.existsSync.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// writeNoteFile
// ---------------------------------------------------------------------------
describe('writeNoteFile', () => {
  it('normalizes CRLF to LF', () => {
    mockFs.existsSync.mockReturnValue(true); // dir exists, file exists
    writeNoteFile('Notes/test.md', 'line1\r\nline2\r\n');
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      '/np/Notes/test.md',
      'line1\nline2\n',
      { encoding: 'utf-8' },
    );
  });

  it('creates parent directories when they do not exist', () => {
    // First call: dir check -> false, second call: file check -> false
    mockFs.existsSync.mockReturnValue(false);
    writeNoteFile('Notes/sub/test.md', 'content');
    expect(mockFs.mkdirSync).toHaveBeenCalledWith('/np/Notes/sub', { recursive: true });
  });

  it('does in-place write for existing files (no wx flag)', () => {
    // dir exists, file exists
    mockFs.existsSync.mockReturnValue(true);
    writeNoteFile('Notes/existing.md', 'updated');
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      '/np/Notes/existing.md',
      'updated',
      { encoding: 'utf-8' },
    );
  });

  it('uses wx flag for new files', () => {
    // dir exists (first call), file does not exist (second call)
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes') return true; // dir
      return false; // file
    });
    writeNoteFile('Notes/new.md', 'hello');
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      '/np/Notes/new.md',
      'hello',
      { encoding: 'utf-8', flag: 'wx' },
    );
  });

  it('falls back to plain write on EPERM from wx', () => {
    mockFs.existsSync.mockImplementation((p) => {
      if (String(p) === '/np/Notes') return true;
      return false;
    });
    const eperm = Object.assign(new Error('EPERM'), { code: 'EPERM' });
    mockFs.writeFileSync.mockImplementationOnce(() => {
      throw eperm;
    });
    writeNoteFile('Notes/new.md', 'data');
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2);
    expect(mockFs.writeFileSync).toHaveBeenLastCalledWith(
      '/np/Notes/new.md',
      'data',
      { encoding: 'utf-8' },
    );
  });

  it('falls back to plain write on EEXIST from wx', () => {
    mockFs.existsSync.mockImplementation((p) => {
      if (String(p) === '/np/Notes') return true;
      return false;
    });
    const eexist = Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
    mockFs.writeFileSync.mockImplementationOnce(() => {
      throw eexist;
    });
    writeNoteFile('Notes/new.md', 'data');
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2);
  });

  it('re-throws non-EPERM/EEXIST errors', () => {
    mockFs.existsSync.mockImplementation((p) => {
      if (String(p) === '/np/Notes') return true;
      return false;
    });
    const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    mockFs.writeFileSync.mockImplementationOnce(() => {
      throw eacces;
    });
    expect(() => writeNoteFile('Notes/new.md', 'data')).toThrow('EACCES');
  });

  it('rejects paths outside NotePlan root', () => {
    expect(() => writeNoteFile('/outside/path.md', 'x')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// createProjectNote
// ---------------------------------------------------------------------------
describe('createProjectNote', () => {
  it('creates note with sanitized filename and returns relative path', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = createProjectNote('My Note');
    expect(result).toBe(path.join('Notes', 'My Note.md'));
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });

  it('uses default content when content is empty', () => {
    mockFs.existsSync.mockReturnValue(false);
    createProjectNote('Title');
    // The writeFileSync should be called with "# Title\n\n" (after CRLF normalization, still same)
    const calls = mockFs.writeFileSync.mock.calls;
    const contentArg = calls[0]?.[1];
    expect(contentArg).toBe('# Title\n\n');
  });

  it('uses provided content when given', () => {
    mockFs.existsSync.mockReturnValue(false);
    createProjectNote('Title', 'custom body');
    const calls = mockFs.writeFileSync.mock.calls;
    expect(calls[0]?.[1]).toBe('custom body');
  });

  it('creates note in specified folder', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = createProjectNote('Note', '', 'Work');
    expect(result).toBe(path.join('Notes', 'Work', 'Note.md'));
  });

  it('throws if note already exists with same extension', () => {
    mockFs.existsSync.mockImplementation((p) => {
      return String(p) === '/np/Notes/Dup.md';
    });
    expect(() => createProjectNote('Dup')).toThrow('Note already exists');
  });

  it('throws if note exists with alternate extension (.txt)', () => {
    mockFs.existsSync.mockImplementation((p) => {
      return String(p) === '/np/Notes/Dup.txt';
    });
    expect(() => createProjectNote('Dup')).toThrow('Note already exists');
  });

  it('sanitizes special characters in title', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = createProjectNote('Hello/World?');
    expect(result).toBe(path.join('Notes', 'Hello-World-.md'));
  });

  it('sanitizes all illegal filename chars', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = createProjectNote('a\\b?c%d*e:f|g"h<i>j');
    // Each illegal char replaced with -
    expect(result).toBe(path.join('Notes', 'a-b-c-d-e-f-g-h-i-j.md'));
  });
});

// ---------------------------------------------------------------------------
// createCalendarNote
// ---------------------------------------------------------------------------
describe('createCalendarNote', () => {
  it('creates calendar note and returns path', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = createCalendarNote('20240115', '# Jan 15');
    expect(result).toBe('Calendar/20240115.md');
  });
});

// ---------------------------------------------------------------------------
// ensureCalendarNote
// ---------------------------------------------------------------------------
describe('ensureCalendarNote', () => {
  it('returns existing note path when found', () => {
    vi.mocked(getCalendarNote).mockReturnValueOnce({
      filename: 'Calendar/20240115.md',
    } as any);
    const result = ensureCalendarNote('20240115');
    expect(result).toBe('Calendar/20240115.md');
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('creates new note when none exists', () => {
    vi.mocked(getCalendarNote).mockReturnValueOnce(null);
    mockFs.existsSync.mockReturnValue(false);
    const result = ensureCalendarNote('20240115');
    expect(result).toBe('Calendar/20240115.md');
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// appendToNote
// ---------------------------------------------------------------------------
describe('appendToNote', () => {
  it('appends content to existing note', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('existing\n' as any);
    appendToNote('Notes/test.md', 'appended');
    const written = mockFs.writeFileSync.mock.calls[0]?.[1];
    expect(written).toBe('existing\nappended');
  });

  it('adds newline before content if note does not end with one', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('existing' as any);
    appendToNote('Notes/test.md', 'appended');
    const written = mockFs.writeFileSync.mock.calls[0]?.[1];
    expect(written).toBe('existing\nappended');
  });

  it('throws if note does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(() => appendToNote('Notes/nope.md', 'x')).toThrow('Note not found');
  });
});

// ---------------------------------------------------------------------------
// prependToNote
// ---------------------------------------------------------------------------
describe('prependToNote', () => {
  it('inserts after frontmatter', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('---\ntitle: X\n---\nbody' as any);
    prependToNote('Notes/test.md', 'PREPENDED');
    const written = mockFs.writeFileSync.mock.calls[0]?.[1];
    // lines: ['---', 'title: X', '---', 'body']
    // insertIndex = 3, so content goes at index 3
    expect(written).toBe('---\ntitle: X\n---\nPREPENDED\nbody');
  });

  it('inserts at top if no frontmatter', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('# Title\nBody' as any);
    prependToNote('Notes/test.md', 'PREPENDED');
    const written = mockFs.writeFileSync.mock.calls[0]?.[1];
    expect(written).toBe('PREPENDED\n# Title\nBody');
  });

  it('throws if note does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(() => prependToNote('Notes/nope.md', 'x')).toThrow('Note not found');
  });
});

// ---------------------------------------------------------------------------
// updateNote
// ---------------------------------------------------------------------------
describe('updateNote', () => {
  it('replaces entire note content', () => {
    mockFs.existsSync.mockReturnValue(true);
    updateNote('Notes/test.md', 'new content');
    const written = mockFs.writeFileSync.mock.calls[0]?.[1];
    expect(written).toBe('new content');
  });

  it('throws if note does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(() => updateNote('Notes/nope.md', 'x')).toThrow('Note not found');
  });
});

// ---------------------------------------------------------------------------
// deleteNote
// ---------------------------------------------------------------------------
describe('deleteNote', () => {
  it('moves file to @Trash folder', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/test.md') return true;
      if (s === '/np/Notes/@Trash') return true;
      return false; // trash target does not exist yet
    });
    const result = deleteNote('Notes/test.md');
    expect(result).toBe(path.join('Notes', '@Trash', 'test.md'));
    expect(mockFs.renameSync).toHaveBeenCalledWith('/np/Notes/test.md', '/np/Notes/@Trash/test.md');
  });

  it('creates @Trash if it does not exist', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/test.md') return true;
      return false;
    });
    deleteNote('Notes/test.md');
    expect(mockFs.mkdirSync).toHaveBeenCalledWith('/np/Notes/@Trash', { recursive: true });
  });

  it('handles duplicate names in trash (appends -1, -2, etc.)', () => {
    let callCount = 0;
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/test.md') return true;
      if (s === '/np/Notes/@Trash') return true;
      if (s === '/np/Notes/@Trash/test.md') return true; // already taken
      if (s === '/np/Notes/@Trash/test-1.md') return true; // also taken
      if (s === '/np/Notes/@Trash/test-2.md') return false; // free
      return false;
    });
    const result = deleteNote('Notes/test.md');
    expect(result).toBe(path.join('Notes', '@Trash', 'test-2.md'));
  });

  it('throws if file does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(() => deleteNote('Notes/nope.md')).toThrow('Note not found');
  });

  it('uses EPERM fallback for moveFile (copy + delete)', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/test.md') return true;
      if (s === '/np/Notes/@Trash') return true;
      return false;
    });
    const eperm = Object.assign(new Error('EPERM'), { code: 'EPERM' });
    mockFs.renameSync.mockImplementationOnce(() => {
      throw eperm;
    });
    deleteNote('Notes/test.md');
    expect(mockFs.copyFileSync).toHaveBeenCalledWith('/np/Notes/test.md', '/np/Notes/@Trash/test.md');
    expect(mockFs.unlinkSync).toHaveBeenCalledWith('/np/Notes/test.md');
  });

  it('uses EXDEV fallback for moveFile (copy + delete)', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/test.md') return true;
      if (s === '/np/Notes/@Trash') return true;
      return false;
    });
    const exdev = Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
    mockFs.renameSync.mockImplementationOnce(() => {
      throw exdev;
    });
    deleteNote('Notes/test.md');
    expect(mockFs.copyFileSync).toHaveBeenCalled();
    expect(mockFs.unlinkSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// previewMoveLocalNote
// ---------------------------------------------------------------------------
describe('previewMoveLocalNote', () => {
  function setupMovePreview() {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/test.md') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
  }

  it('returns preview with fromFilename, toFilename, destinationFolder', () => {
    setupMovePreview();
    const result = previewMoveLocalNote('Notes/test.md', 'Notes/Work');
    expect(result.fromFilename).toBe(path.join('Notes', 'test.md'));
    expect(result.toFilename).toBe(path.join('Notes', 'Work', 'test.md'));
    expect(result.destinationFolder).toBe('Notes/Work');
  });

  it('validates source exists', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(() => previewMoveLocalNote('Notes/nope.md', 'Notes/Work')).toThrow('Note not found');
  });

  it('rejects directories', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true, isFile: () => false } as any);
    expect(() => previewMoveLocalNote('Notes/folder', 'Notes/Work')).toThrow('Not a note file');
  });

  it('rejects if source is outside Notes folder', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    expect(() => previewMoveLocalNote('Calendar/20240101.md', 'Notes/Work')).toThrow(
      'must be inside Notes',
    );
  });

  it('rejects if already at destination', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Work/test.md') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    expect(() => previewMoveLocalNote('Notes/Work/test.md', 'Notes/Work')).toThrow(
      'already in the destination',
    );
  });

  it('rejects if conflict at destination', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/test.md') return true;
      if (s === '/np/Notes/Work/test.md') return true; // conflict
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    expect(() => previewMoveLocalNote('Notes/test.md', 'Notes/Work')).toThrow(
      'already exists at destination',
    );
  });

  it('handles folder input without Notes/ prefix', () => {
    setupMovePreview();
    const result = previewMoveLocalNote('Notes/test.md', 'Work');
    expect(result.destinationFolder).toBe('Notes/Work');
  });

  it('handles folder input with trailing slash', () => {
    setupMovePreview();
    const result = previewMoveLocalNote('Notes/test.md', 'Work/');
    expect(result.destinationFolder).toBe('Notes/Work');
  });

  it('rejects when destinationFolder looks like a different filename', () => {
    setupMovePreview();
    expect(() => previewMoveLocalNote('Notes/test.md', 'Work/other.md')).toThrow(
      'must be a folder path, not a filename',
    );
  });

  it('strips same filename from destination path', () => {
    setupMovePreview();
    const result = previewMoveLocalNote('Notes/test.md', 'Work/test.md');
    expect(result.destinationFolder).toBe('Notes/Work');
  });
});

// ---------------------------------------------------------------------------
// moveLocalNote
// ---------------------------------------------------------------------------
describe('moveLocalNote', () => {
  it('moves note between folders', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/test.md') return true;
      if (s === '/np/Notes/Work') return false; // will be created
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);

    const result = moveLocalNote('Notes/test.md', 'Work');
    expect(result).toBe(path.join('Notes', 'Work', 'test.md'));
    expect(mockFs.mkdirSync).toHaveBeenCalledWith('/np/Notes/Work', { recursive: true });
    expect(mockFs.renameSync).toHaveBeenCalled();
  });

  it('creates destination folder if needed', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/test.md') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);

    moveLocalNote('Notes/test.md', 'NewFolder');
    expect(mockFs.mkdirSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// previewRestoreLocalNoteFromTrash
// ---------------------------------------------------------------------------
describe('previewRestoreLocalNoteFromTrash', () => {
  it('returns preview for restoring from trash', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/@Trash/test.md') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);

    const result = previewRestoreLocalNoteFromTrash('Notes/@Trash/test.md', 'Notes');
    expect(result.fromFilename).toBe(path.join('Notes', '@Trash', 'test.md'));
    expect(result.toFilename).toBe(path.join('Notes', 'test.md'));
  });

  it('throws if source not found', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(() => previewRestoreLocalNoteFromTrash('Notes/@Trash/nope.md', 'Notes')).toThrow(
      'Note not found',
    );
  });

  it('throws if source is not inside @Trash', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    expect(() => previewRestoreLocalNoteFromTrash('Notes/test.md', 'Notes')).toThrow(
      'must be inside @Trash',
    );
  });

  it('throws if conflict at destination', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/@Trash/test.md') return true;
      if (s === '/np/Notes/test.md') return true; // conflict
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    expect(() => previewRestoreLocalNoteFromTrash('Notes/@Trash/test.md', 'Notes')).toThrow(
      'already exists at destination',
    );
  });
});

// ---------------------------------------------------------------------------
// restoreLocalNoteFromTrash
// ---------------------------------------------------------------------------
describe('restoreLocalNoteFromTrash', () => {
  it('restores note from trash to destination', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/@Trash/test.md') return true;
      if (s === '/np/Notes') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);

    const result = restoreLocalNoteFromTrash('Notes/@Trash/test.md', 'Notes');
    expect(result).toBe(path.join('Notes', 'test.md'));
    expect(mockFs.renameSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// previewRenameLocalNoteFile
// ---------------------------------------------------------------------------
describe('previewRenameLocalNoteFile', () => {
  function setupRenamePreview() {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/old.md') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
  }

  it('returns preview with fromFilename and toFilename', () => {
    setupRenamePreview();
    const result = previewRenameLocalNoteFile('Notes/old.md', 'new');
    expect(result.fromFilename).toBe(path.join('Notes', 'old.md'));
    expect(result.toFilename).toBe(path.join('Notes', 'new.md'));
  });

  it('keepExtension=true preserves original extension', () => {
    setupRenamePreview();
    const result = previewRenameLocalNoteFile('Notes/old.md', 'new.txt', true);
    // keepExtension=true means keep .md
    expect(result.toFilename).toBe(path.join('Notes', 'new.md'));
  });

  it('keepExtension=false uses provided extension', () => {
    setupRenamePreview();
    const result = previewRenameLocalNoteFile('Notes/old.md', 'new.txt', false);
    expect(result.toFilename).toBe(path.join('Notes', 'new.txt'));
  });

  it('throws if new name matches current name', () => {
    setupRenamePreview();
    expect(() => previewRenameLocalNoteFile('Notes/old.md', 'old')).toThrow(
      'matches current filename',
    );
  });

  it('throws if new name already exists', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/old.md') return true;
      if (s === '/np/Notes/taken.md') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    expect(() => previewRenameLocalNoteFile('Notes/old.md', 'taken')).toThrow(
      'already exists with filename',
    );
  });

  it('throws if source not found', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(() => previewRenameLocalNoteFile('Notes/nope.md', 'new')).toThrow('Note not found');
  });

  it('throws if source is a directory', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true, isFile: () => false } as any);
    expect(() => previewRenameLocalNoteFile('Notes/folder', 'new')).toThrow('Not a note file');
  });

  it('sanitizes special characters in rename', () => {
    setupRenamePreview();
    const result = previewRenameLocalNoteFile('Notes/old.md', 'he?lo');
    expect(result.toFilename).toBe(path.join('Notes', 'he-lo.md'));
  });

  it('rejects rename that changes folder', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/old.md') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    expect(() => previewRenameLocalNoteFile('Notes/old.md', 'OtherFolder/new')).toThrow(
      'must stay in the same folder',
    );
  });
});

// ---------------------------------------------------------------------------
// renameLocalNoteFile
// ---------------------------------------------------------------------------
describe('renameLocalNoteFile', () => {
  it('renames file within same folder', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/old.md') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    const result = renameLocalNoteFile('Notes/old.md', 'new');
    expect(result).toBe(path.join('Notes', 'new.md'));
    expect(mockFs.renameSync).toHaveBeenCalledWith('/np/Notes/old.md', '/np/Notes/new.md');
  });
});

// ---------------------------------------------------------------------------
// previewCreateFolder
// ---------------------------------------------------------------------------
describe('previewCreateFolder', () => {
  it('returns normalized folder path', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = previewCreateFolder('MyFolder');
    expect(result).toBe('MyFolder');
  });

  it('strips Notes/ prefix', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = previewCreateFolder('Notes/MyFolder');
    expect(result).toBe('MyFolder');
  });

  it('throws if folder already exists', () => {
    mockFs.existsSync.mockReturnValue(true);
    expect(() => previewCreateFolder('ExistingFolder')).toThrow('Folder already exists');
  });

  it('throws on empty folder path', () => {
    expect(() => previewCreateFolder('  ')).toThrow();
  });

  it('throws on invalid segments (..)', () => {
    expect(() => previewCreateFolder('a/../b')).toThrow('invalid');
  });
});

// ---------------------------------------------------------------------------
// createFolder
// ---------------------------------------------------------------------------
describe('createFolder', () => {
  it('creates folder under Notes and returns normalized path', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = createFolder('Projects');
    expect(result).toBe('Projects');
    expect(mockFs.mkdirSync).toHaveBeenCalledWith('/np/Notes/Projects', { recursive: true });
  });

  it('creates nested folder', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = createFolder('Projects/Work');
    expect(result).toBe('Projects/Work');
  });
});

// ---------------------------------------------------------------------------
// previewDeleteLocalFolder
// ---------------------------------------------------------------------------
describe('previewDeleteLocalFolder', () => {
  it('returns normalized folder path', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    const result = previewDeleteLocalFolder('MyFolder');
    expect(result).toBe('MyFolder');
  });

  it('throws if folder does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(() => previewDeleteLocalFolder('Nope')).toThrow('Folder not found');
  });

  it('throws if target is not a directory', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => false } as any);
    expect(() => previewDeleteLocalFolder('file.md')).toThrow('Not a folder');
  });

  it('cannot delete @Trash folder', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    expect(() => previewDeleteLocalFolder('@Trash')).toThrow('Cannot delete the @Trash folder');
  });

  it('throws on empty path', () => {
    expect(() => previewDeleteLocalFolder('  ')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// deleteLocalFolder
// ---------------------------------------------------------------------------
describe('deleteLocalFolder', () => {
  it('moves folder to @Trash', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Old') return true;
      if (s === '/np/Notes/@Trash') return true;
      if (s === '/np/Notes/@Trash/Old') return false;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    const result = deleteLocalFolder('Old');
    expect(result).toBe(path.join('Notes', '@Trash', 'Old'));
    expect(mockFs.renameSync).toHaveBeenCalled();
  });

  it('handles duplicate folder names in trash', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Old') return true;
      if (s === '/np/Notes/@Trash') return true;
      if (s === '/np/Notes/@Trash/Old') return true; // taken
      if (s === '/np/Notes/@Trash/Old-1') return false; // free
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    const result = deleteLocalFolder('Old');
    expect(result).toBe(path.join('Notes', '@Trash', 'Old-1'));
  });

  it('creates @Trash if it does not exist', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Old') return true;
      if (s === '/np/Notes/@Trash') return false; // needs creation
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    deleteLocalFolder('Old');
    expect(mockFs.mkdirSync).toHaveBeenCalledWith('/np/Notes/@Trash', { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// previewMoveLocalFolder
// ---------------------------------------------------------------------------
describe('previewMoveLocalFolder', () => {
  function setupFolderMove() {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Source') return true;
      if (s === '/np/Notes/Dest') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
  }

  it('returns preview with fromFolder and toFolder', () => {
    setupFolderMove();
    const result = previewMoveLocalFolder('Source', 'Dest');
    expect(result.fromFolder).toBe('Source');
    expect(result.toFolder).toBe('Dest/Source');
  });

  it('cannot move folder into itself', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    expect(() => previewMoveLocalFolder('Source', 'Source')).toThrow(
      'Cannot move a folder into itself',
    );
  });

  it('cannot move folder into its descendants', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Source') return true;
      if (s === '/np/Notes/Source/Child') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    expect(() => previewMoveLocalFolder('Source', 'Source/Child')).toThrow(
      'Cannot move a folder into itself',
    );
  });

  it('throws if source folder not found', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(() => previewMoveLocalFolder('Nope', 'Dest')).toThrow('Source folder not found');
  });

  it('throws if destination folder not found', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Source') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    expect(() => previewMoveLocalFolder('Source', 'NoDest')).toThrow(
      'Destination folder not found',
    );
  });

  it('throws if folder already at destination', () => {
    // Source is already inside Dest, meaning the target path resolves to the same place
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Dest/Source') return true;
      if (s === '/np/Notes/Dest') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    expect(() => previewMoveLocalFolder('Dest/Source', 'Dest')).toThrow(
      'already in the destination',
    );
  });

  it('throws if conflict at destination', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Source') return true;
      if (s === '/np/Notes/Dest') return true;
      if (s === '/np/Notes/Dest/Source') return true; // conflict
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    expect(() => previewMoveLocalFolder('Source', 'Dest')).toThrow(
      'already exists at destination',
    );
  });

  it('allows moving to Notes root', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Sub/Source') return true;
      if (s === '/np/Notes') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    const result = previewMoveLocalFolder('Sub/Source', 'Notes');
    expect(result.toFolder).toBe('Source');
    expect(result.destinationFolder).toBe('Notes');
  });
});

// ---------------------------------------------------------------------------
// moveLocalFolder
// ---------------------------------------------------------------------------
describe('moveLocalFolder', () => {
  it('moves folder to destination', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Source') return true;
      if (s === '/np/Notes/Dest') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    const result = moveLocalFolder('Source', 'Dest');
    expect(result.fromFolder).toBe('Source');
    expect(result.toFolder).toBe('Dest/Source');
    expect(mockFs.renameSync).toHaveBeenCalledWith('/np/Notes/Source', '/np/Notes/Dest/Source');
  });
});

// ---------------------------------------------------------------------------
// previewRenameLocalFolder
// ---------------------------------------------------------------------------
describe('previewRenameLocalFolder', () => {
  function setupFolderRename() {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Old') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
  }

  it('returns preview with fromFolder and toFolder', () => {
    setupFolderRename();
    const result = previewRenameLocalFolder('Old', 'New');
    expect(result.fromFolder).toBe('Old');
    expect(result.toFolder).toBe('New');
  });

  it('sanitizes new folder name', () => {
    setupFolderRename();
    const result = previewRenameLocalFolder('Old', 'He?lo');
    expect(result.toFolder).toBe('He-lo');
  });

  it('throws if new name matches current name', () => {
    setupFolderRename();
    expect(() => previewRenameLocalFolder('Old', 'Old')).toThrow('matches current name');
  });

  it('throws if new name already exists', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Old') return true;
      if (s === '/np/Notes/Taken') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    expect(() => previewRenameLocalFolder('Old', 'Taken')).toThrow('already exists');
  });

  it('throws if source not found', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(() => previewRenameLocalFolder('Nope', 'New')).toThrow('Source folder not found');
  });

  it('throws on empty new name', () => {
    setupFolderRename();
    expect(() => previewRenameLocalFolder('Old', '  ')).toThrow('required');
  });

  it('must stay in same parent folder', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Old') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    expect(() => previewRenameLocalFolder('Old', 'Other/New')).toThrow(
      'must stay in the same parent folder',
    );
  });
});

// ---------------------------------------------------------------------------
// renameLocalFolder
// ---------------------------------------------------------------------------
describe('renameLocalFolder', () => {
  it('renames folder and returns preview', () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Old') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    const result = renameLocalFolder('Old', 'New');
    expect(result.fromFolder).toBe('Old');
    expect(result.toFolder).toBe('New');
    expect(mockFs.renameSync).toHaveBeenCalledWith('/np/Notes/Old', '/np/Notes/New');
  });
});
