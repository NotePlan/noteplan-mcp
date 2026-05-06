import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs');
vi.mock('../transport/bridge-availability.js', () => ({
  getBridgeClient: vi.fn(async () => null),
  invalidateBridgeClient: vi.fn(),
}));
vi.mock('./file-reader.js', () => ({
  getNotePlanPath: vi.fn(() => '/np'),
  getNotesPath: vi.fn(() => '/np/Notes'),
  getCalendarPath: vi.fn(() => '/np/Calendar'),
  getFileExtension: vi.fn(() => '.md'),
  hasYearSubfolders: vi.fn(() => false),
  buildCalendarNotePathAsync: vi.fn(async (date: string) => `Calendar/${date}.md`),
  getCalendarNote: vi.fn(() => null),
  isValidNoteExtension: vi.fn((filename: string) => {
    const ext = path.extname(filename).toLowerCase();
    return ext === '.md' || ext === '.txt';
  }),
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

// Production code uses fs.promises; tests assert against fs.*Sync. The proxy
// forwards every promise call to its sync counterpart, with existsSync gating
// stat/readFile/access so ENOENT surfaces consistently.
beforeEach(() => {
  vi.resetAllMocks();
  mockFs.existsSync.mockReturnValue(false);

  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

  mockFs.promises = {
    writeFile: vi.fn(async (p: any, content: any, opts?: any) => {
      const normalized = typeof opts === 'string' ? { encoding: opts } : opts;
      return mockFs.writeFileSync(p, content, normalized);
    }),
    mkdir: vi.fn(async (p: any, opts?: any) => mockFs.mkdirSync(p, opts)),
    rename: vi.fn(async (a: any, b: any) => mockFs.renameSync(a, b)),
    copyFile: vi.fn(async (a: any, b: any) => mockFs.copyFileSync(a, b)),
    unlink: vi.fn(async (p: any) => mockFs.unlinkSync(p)),
    rm: vi.fn(async (p: any) => {
      if (mockFs.rmSync) mockFs.rmSync(p, { recursive: true });
      else mockFs.unlinkSync(p);
    }),
    readFile: vi.fn(async (p: any, enc?: any) => {
      if (!mockFs.existsSync(p)) throw enoent();
      return mockFs.readFileSync(p, enc);
    }),
    readdir: vi.fn(async (p: any, opts?: any) => mockFs.readdirSync(p, opts)),
    stat: vi.fn(async (p: any) => {
      if (!mockFs.existsSync(p)) throw enoent();
      const explicit = mockFs.statSync(p);
      if (explicit !== undefined && explicit !== null) return explicit as any;
      return { isDirectory: () => false, isFile: () => true } as any;
    }),
    access: vi.fn(async (p: any) => {
      if (!mockFs.existsSync(p)) throw enoent();
    }),
  } as any;
});

// ---------------------------------------------------------------------------
// writeNoteFile
// ---------------------------------------------------------------------------
describe('writeNoteFile', () => {
  it('normalizes CRLF to LF', async () => {
    mockFs.existsSync.mockReturnValue(true); // dir exists, file exists
    await writeNoteFile('Notes/test.md', 'line1\r\nline2\r\n');
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      '/np/Notes/test.md',
      'line1\nline2\n',
      { encoding: 'utf-8' },
    );
  });

  it('creates parent directories when they do not exist', async () => {
    // First call: dir check -> false, second call: file check -> false
    mockFs.existsSync.mockReturnValue(false);
    await writeNoteFile('Notes/sub/test.md', 'content');
    expect(mockFs.mkdirSync).toHaveBeenCalledWith('/np/Notes/sub', { recursive: true });
  });

  it('does in-place write for existing files (no wx flag)', async () => {
    // dir exists, file exists
    mockFs.existsSync.mockReturnValue(true);
    await writeNoteFile('Notes/existing.md', 'updated');
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      '/np/Notes/existing.md',
      'updated',
      { encoding: 'utf-8' },
    );
  });

  it('uses wx flag for new files', async () => {
    // dir exists (first call), file does not exist (second call)
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes') return true; // dir
      return false; // file
    });
    await writeNoteFile('Notes/new.md', 'hello');
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      '/np/Notes/new.md',
      'hello',
      { encoding: 'utf-8', flag: 'wx' },
    );
  });

  it('falls back to plain write on EPERM from wx', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      if (String(p) === '/np/Notes') return true;
      return false;
    });
    const eperm = Object.assign(new Error('EPERM'), { code: 'EPERM' });
    mockFs.writeFileSync.mockImplementationOnce(() => {
      throw eperm;
    });
    await writeNoteFile('Notes/new.md', 'data');
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2);
    expect(mockFs.writeFileSync).toHaveBeenLastCalledWith(
      '/np/Notes/new.md',
      'data',
      { encoding: 'utf-8' },
    );
  });

  it('falls back to plain write on EEXIST from wx', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      if (String(p) === '/np/Notes') return true;
      return false;
    });
    const eexist = Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
    mockFs.writeFileSync.mockImplementationOnce(() => {
      throw eexist;
    });
    await writeNoteFile('Notes/new.md', 'data');
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2);
  });

  it('re-throws non-EPERM/EEXIST errors', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      if (String(p) === '/np/Notes') return true;
      return false;
    });
    const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    mockFs.writeFileSync.mockImplementationOnce(() => {
      throw eacces;
    });
    await expect(writeNoteFile('Notes/new.md', 'data')).rejects.toThrow('EACCES');
  });

  it('rejects paths outside NotePlan root', async () => {
    await expect(writeNoteFile('/outside/path.md', 'x')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// createProjectNote
// ---------------------------------------------------------------------------
describe('createProjectNote', () => {
  it('creates note with sanitized filename and returns relative path', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await createProjectNote('My Note');
    expect(result).toBe(path.join('Notes', 'My Note.md'));
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });

  it('uses default content when content is empty', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await createProjectNote('Title');
    // The writeFileSync should be called with "# Title\n\n" (after CRLF normalization, still same)
    const calls = mockFs.writeFileSync.mock.calls;
    const contentArg = calls[0]?.[1];
    expect(contentArg).toBe('# Title\n\n');
  });

  it('uses provided content when given', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await createProjectNote('Title', 'custom body');
    const calls = mockFs.writeFileSync.mock.calls;
    expect(calls[0]?.[1]).toBe('custom body');
  });

  it('creates note in specified folder', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await createProjectNote('Note', '', 'Work');
    expect(result).toBe(path.join('Notes', 'Work', 'Note.md'));
  });

  it('strips Notes/ prefix from folder to avoid double-nesting', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await createProjectNote('Note', '', 'Notes/Work');
    expect(result).toBe(path.join('Notes', 'Work', 'Note.md'));
  });

  it('throws if note already exists with same extension', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      return String(p) === '/np/Notes/Dup.md';
    });
    await expect(createProjectNote('Dup')).rejects.toThrow('Note already exists');
  });

  it('throws if note exists with alternate extension (.txt)', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      return String(p) === '/np/Notes/Dup.txt';
    });
    await expect(createProjectNote('Dup')).rejects.toThrow('Note already exists');
  });

  it('sanitizes special characters in title', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await createProjectNote('Hello/World?');
    expect(result).toBe(path.join('Notes', 'Hello-World-.md'));
  });

  it('sanitizes all illegal filename chars', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await createProjectNote('a\\b?c%d*e:f|g"h<i>j');
    // Each illegal char replaced with -
    expect(result).toBe(path.join('Notes', 'a-b-c-d-e-f-g-h-i-j.md'));
  });
});

// ---------------------------------------------------------------------------
// createCalendarNote
// ---------------------------------------------------------------------------
describe('createCalendarNote', () => {
  it('creates calendar note and returns path', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await createCalendarNote('20240115', '# Jan 15');
    expect(result).toBe('Calendar/20240115.md');
  });
});

// ---------------------------------------------------------------------------
// ensureCalendarNote
// ---------------------------------------------------------------------------
describe('ensureCalendarNote', () => {
  it('returns existing note path when found', async () => {
    vi.mocked(getCalendarNote).mockResolvedValueOnce({
      filename: 'Calendar/20240115.md',
    } as any);
    const result = await ensureCalendarNote('20240115');
    expect(result).toBe('Calendar/20240115.md');
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('creates new note when none exists', async () => {
    vi.mocked(getCalendarNote).mockResolvedValueOnce(null);
    mockFs.existsSync.mockReturnValue(false);
    const result = await ensureCalendarNote('20240115');
    expect(result).toBe('Calendar/20240115.md');
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// appendToNote
// ---------------------------------------------------------------------------
describe('appendToNote', () => {
  it('appends content to existing note', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('existing\n' as any);
    await appendToNote('Notes/test.md', 'appended');
    const written = mockFs.writeFileSync.mock.calls[0]?.[1];
    expect(written).toBe('existing\nappended');
  });

  it('adds newline before content if note does not end with one', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('existing' as any);
    await appendToNote('Notes/test.md', 'appended');
    const written = mockFs.writeFileSync.mock.calls[0]?.[1];
    expect(written).toBe('existing\nappended');
  });

  it('throws if note does not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await expect(appendToNote('Notes/nope.md', 'x')).rejects.toThrow('Note not found');
  });
});

// ---------------------------------------------------------------------------
// prependToNote
// ---------------------------------------------------------------------------
describe('prependToNote', () => {
  it('inserts after frontmatter', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('---\ntitle: X\n---\nbody' as any);
    await prependToNote('Notes/test.md', 'PREPENDED');
    const written = mockFs.writeFileSync.mock.calls[0]?.[1];
    // lines: ['---', 'title: X', '---', 'body']
    // insertIndex = 3, so content goes at index 3
    expect(written).toBe('---\ntitle: X\n---\nPREPENDED\nbody');
  });

  it('inserts at top if no frontmatter', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('# Title\nBody' as any);
    await prependToNote('Notes/test.md', 'PREPENDED');
    const written = mockFs.writeFileSync.mock.calls[0]?.[1];
    expect(written).toBe('PREPENDED\n# Title\nBody');
  });

  it('throws if note does not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await expect(prependToNote('Notes/nope.md', 'x')).rejects.toThrow('Note not found');
  });
});

// ---------------------------------------------------------------------------
// updateNote
// ---------------------------------------------------------------------------
describe('updateNote', () => {
  it('replaces entire note content', async () => {
    mockFs.existsSync.mockReturnValue(true);
    await updateNote('Notes/test.md', 'new content');
    const written = mockFs.writeFileSync.mock.calls[0]?.[1];
    expect(written).toBe('new content');
  });

  it('throws if note does not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await expect(updateNote('Notes/nope.md', 'x')).rejects.toThrow('Note not found');
  });
});

// ---------------------------------------------------------------------------
// deleteNote
// ---------------------------------------------------------------------------
describe('deleteNote', () => {
  it('moves file to @Trash folder', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/test.md') return true;
      if (s === '/np/Notes/@Trash') return true;
      return false; // trash target does not exist yet
    });
    const result = await deleteNote('Notes/test.md');
    expect(result).toBe(path.join('Notes', '@Trash', 'test.md'));
    expect(mockFs.renameSync).toHaveBeenCalledWith('/np/Notes/test.md', '/np/Notes/@Trash/test.md');
  });

  it('creates @Trash if it does not exist', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/test.md') return true;
      return false;
    });
    await deleteNote('Notes/test.md');
    expect(mockFs.mkdirSync).toHaveBeenCalledWith('/np/Notes/@Trash', { recursive: true });
  });

  it('handles duplicate names in trash (appends -1, -2, etc.)', async () => {
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
    const result = await deleteNote('Notes/test.md');
    expect(result).toBe(path.join('Notes', '@Trash', 'test-2.md'));
  });

  it('throws if file does not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await expect(deleteNote('Notes/nope.md')).rejects.toThrow('Note not found');
  });

  it('uses EPERM fallback for moveFile (copy + delete)', async () => {
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
    await deleteNote('Notes/test.md');
    expect(mockFs.copyFileSync).toHaveBeenCalledWith('/np/Notes/test.md', '/np/Notes/@Trash/test.md');
    expect(mockFs.unlinkSync).toHaveBeenCalledWith('/np/Notes/test.md');
  });

  it('uses EXDEV fallback for moveFile (copy + delete)', async () => {
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
    await deleteNote('Notes/test.md');
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

  it('returns preview with fromFilename, toFilename, destinationFolder', async () => {
    setupMovePreview();
    const result = await previewMoveLocalNote('Notes/test.md', 'Notes/Work');
    expect(result.fromFilename).toBe(path.join('Notes', 'test.md'));
    expect(result.toFilename).toBe(path.join('Notes', 'Work', 'test.md'));
    expect(result.destinationFolder).toBe('Notes/Work');
  });

  it('validates source exists', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await expect(previewMoveLocalNote('Notes/nope.md', 'Notes/Work')).rejects.toThrow('Note not found');
  });

  it('rejects directories', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true, isFile: () => false } as any);
    await expect(previewMoveLocalNote('Notes/folder', 'Notes/Work')).rejects.toThrow('Not a note file');
  });

  it('rejects if source is outside Notes folder', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    await expect(previewMoveLocalNote('Calendar/20240101.md', 'Notes/Work')).rejects.toThrow(
      'must be inside Notes',
    );
  });

  it('rejects if already at destination', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Work/test.md') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    await expect(previewMoveLocalNote('Notes/Work/test.md', 'Notes/Work')).rejects.toThrow(
      'already in the destination',
    );
  });

  it('rejects if conflict at destination', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/test.md') return true;
      if (s === '/np/Notes/Work/test.md') return true; // conflict
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    await expect(previewMoveLocalNote('Notes/test.md', 'Notes/Work')).rejects.toThrow(
      'already exists at destination',
    );
  });

  it('handles folder input without Notes/ prefix', async () => {
    setupMovePreview();
    const result = await previewMoveLocalNote('Notes/test.md', 'Work');
    expect(result.destinationFolder).toBe('Notes/Work');
  });

  it('handles folder input with trailing slash', async () => {
    setupMovePreview();
    const result = await previewMoveLocalNote('Notes/test.md', 'Work/');
    expect(result.destinationFolder).toBe('Notes/Work');
  });

  it('rejects when destinationFolder looks like a different filename', async () => {
    setupMovePreview();
    await expect(previewMoveLocalNote('Notes/test.md', 'Work/other.md')).rejects.toThrow(
      'must be a folder path, not a filename',
    );
  });

  it('strips same filename from destination path', async () => {
    setupMovePreview();
    const result = await previewMoveLocalNote('Notes/test.md', 'Work/test.md');
    expect(result.destinationFolder).toBe('Notes/Work');
  });
});

// ---------------------------------------------------------------------------
// moveLocalNote
// ---------------------------------------------------------------------------
describe('moveLocalNote', () => {
  it('moves note between folders', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/test.md') return true;
      if (s === '/np/Notes/Work') return false; // will be created
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);

    const result = await moveLocalNote('Notes/test.md', 'Work');
    expect(result).toBe(path.join('Notes', 'Work', 'test.md'));
    expect(mockFs.mkdirSync).toHaveBeenCalledWith('/np/Notes/Work', { recursive: true });
    expect(mockFs.renameSync).toHaveBeenCalled();
  });

  it('creates destination folder if needed', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/test.md') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);

    await moveLocalNote('Notes/test.md', 'NewFolder');
    expect(mockFs.mkdirSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// previewRestoreLocalNoteFromTrash
// ---------------------------------------------------------------------------
describe('previewRestoreLocalNoteFromTrash', () => {
  it('returns preview for restoring from trash', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/@Trash/test.md') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);

    const result = await previewRestoreLocalNoteFromTrash('Notes/@Trash/test.md', 'Notes');
    expect(result.fromFilename).toBe(path.join('Notes', '@Trash', 'test.md'));
    expect(result.toFilename).toBe(path.join('Notes', 'test.md'));
  });

  it('throws if source not found', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await expect(previewRestoreLocalNoteFromTrash('Notes/@Trash/nope.md', 'Notes')).rejects.toThrow(
      'Note not found',
    );
  });

  it('throws if source is not inside @Trash', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    await expect(previewRestoreLocalNoteFromTrash('Notes/test.md', 'Notes')).rejects.toThrow(
      'must be inside @Trash',
    );
  });

  it('throws if conflict at destination', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/@Trash/test.md') return true;
      if (s === '/np/Notes/test.md') return true; // conflict
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    await expect(previewRestoreLocalNoteFromTrash('Notes/@Trash/test.md', 'Notes')).rejects.toThrow(
      'already exists at destination',
    );
  });
});

// ---------------------------------------------------------------------------
// restoreLocalNoteFromTrash
// ---------------------------------------------------------------------------
describe('restoreLocalNoteFromTrash', () => {
  it('restores note from trash to destination', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/@Trash/test.md') return true;
      if (s === '/np/Notes') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);

    const result = await restoreLocalNoteFromTrash('Notes/@Trash/test.md', 'Notes');
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

  it('returns preview with fromFilename and toFilename', async () => {
    setupRenamePreview();
    const result = await previewRenameLocalNoteFile('Notes/old.md', 'new');
    expect(result.fromFilename).toBe(path.join('Notes', 'old.md'));
    expect(result.toFilename).toBe(path.join('Notes', 'new.md'));
  });

  it('keepExtension=true preserves original extension', async () => {
    setupRenamePreview();
    const result = await previewRenameLocalNoteFile('Notes/old.md', 'new.txt', true);
    // keepExtension=true means keep .md
    expect(result.toFilename).toBe(path.join('Notes', 'new.md'));
  });

  it('keepExtension=false uses provided extension', async () => {
    setupRenamePreview();
    const result = await previewRenameLocalNoteFile('Notes/old.md', 'new.txt', false);
    expect(result.toFilename).toBe(path.join('Notes', 'new.txt'));
  });

  it('throws if new name matches current name', async () => {
    setupRenamePreview();
    await expect(previewRenameLocalNoteFile('Notes/old.md', 'old')).rejects.toThrow(
      'matches current filename',
    );
  });

  it('throws if new name already exists', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/old.md') return true;
      if (s === '/np/Notes/taken.md') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    await expect(previewRenameLocalNoteFile('Notes/old.md', 'taken')).rejects.toThrow(
      'already exists with filename',
    );
  });

  it('throws if source not found', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await expect(previewRenameLocalNoteFile('Notes/nope.md', 'new')).rejects.toThrow('Note not found');
  });

  it('throws if source is a directory', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true, isFile: () => false } as any);
    await expect(previewRenameLocalNoteFile('Notes/folder', 'new')).rejects.toThrow('Not a note file');
  });

  it('sanitizes special characters in rename', async () => {
    setupRenamePreview();
    const result = await previewRenameLocalNoteFile('Notes/old.md', 'he?lo');
    expect(result.toFilename).toBe(path.join('Notes', 'he-lo.md'));
  });

  it('rejects rename that changes folder', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/old.md') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    await expect(previewRenameLocalNoteFile('Notes/old.md', 'OtherFolder/new')).rejects.toThrow(
      'must stay in the same folder',
    );
  });
});

// ---------------------------------------------------------------------------
// renameLocalNoteFile
// ---------------------------------------------------------------------------
describe('renameLocalNoteFile', () => {
  it('renames file within same folder', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/old.md') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);
    const result = await renameLocalNoteFile('Notes/old.md', 'new');
    expect(result).toBe(path.join('Notes', 'new.md'));
    expect(mockFs.renameSync).toHaveBeenCalledWith('/np/Notes/old.md', '/np/Notes/new.md');
  });
});

// ---------------------------------------------------------------------------
// previewCreateFolder
// ---------------------------------------------------------------------------
describe('previewCreateFolder', () => {
  it('returns normalized folder path', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await previewCreateFolder('MyFolder');
    expect(result).toBe('MyFolder');
  });

  it('strips Notes/ prefix', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await previewCreateFolder('Notes/MyFolder');
    expect(result).toBe('MyFolder');
  });

  it('throws if folder already exists', async () => {
    mockFs.existsSync.mockReturnValue(true);
    await expect(previewCreateFolder('ExistingFolder')).rejects.toThrow('Folder already exists');
  });

  it('throws on empty folder path', async () => {
    await expect(previewCreateFolder('  ')).rejects.toThrow();
  });

  it('throws on invalid segments (..)', async () => {
    await expect(previewCreateFolder('a/../b')).rejects.toThrow('invalid');
  });
});

// ---------------------------------------------------------------------------
// createFolder
// ---------------------------------------------------------------------------
describe('createFolder', () => {
  it('creates folder under Notes and returns normalized path', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await createFolder('Projects');
    expect(result).toBe('Projects');
    expect(mockFs.mkdirSync).toHaveBeenCalledWith('/np/Notes/Projects', { recursive: true });
  });

  it('creates nested folder', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await createFolder('Projects/Work');
    expect(result).toBe('Projects/Work');
  });
});

// ---------------------------------------------------------------------------
// previewDeleteLocalFolder
// ---------------------------------------------------------------------------
describe('previewDeleteLocalFolder', () => {
  it('returns normalized folder path', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    const result = await previewDeleteLocalFolder('MyFolder');
    expect(result).toBe('MyFolder');
  });

  it('throws if folder does not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await expect(previewDeleteLocalFolder('Nope')).rejects.toThrow('Folder not found');
  });

  it('throws if target is not a directory', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => false } as any);
    await expect(previewDeleteLocalFolder('file.md')).rejects.toThrow('Not a folder');
  });

  it('cannot delete @Trash folder', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    await expect(previewDeleteLocalFolder('@Trash')).rejects.toThrow('Cannot delete the @Trash folder');
  });

  it('throws on empty path', async () => {
    await expect(previewDeleteLocalFolder('  ')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// deleteLocalFolder
// ---------------------------------------------------------------------------
describe('deleteLocalFolder', () => {
  it('moves folder to @Trash', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Old') return true;
      if (s === '/np/Notes/@Trash') return true;
      if (s === '/np/Notes/@Trash/Old') return false;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    const result = await deleteLocalFolder('Old');
    expect(result).toBe(path.join('Notes', '@Trash', 'Old'));
    expect(mockFs.renameSync).toHaveBeenCalled();
  });

  it('handles duplicate folder names in trash', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Old') return true;
      if (s === '/np/Notes/@Trash') return true;
      if (s === '/np/Notes/@Trash/Old') return true; // taken
      if (s === '/np/Notes/@Trash/Old-1') return false; // free
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    const result = await deleteLocalFolder('Old');
    expect(result).toBe(path.join('Notes', '@Trash', 'Old-1'));
  });

  it('creates @Trash if it does not exist', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Old') return true;
      if (s === '/np/Notes/@Trash') return false; // needs creation
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    await deleteLocalFolder('Old');
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

  it('returns preview with fromFolder and toFolder', async () => {
    setupFolderMove();
    const result = await previewMoveLocalFolder('Source', 'Dest');
    expect(result.fromFolder).toBe('Source');
    expect(result.toFolder).toBe('Dest/Source');
  });

  it('cannot move folder into itself', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    await expect(previewMoveLocalFolder('Source', 'Source')).rejects.toThrow(
      'Cannot move a folder into itself',
    );
  });

  it('cannot move folder into its descendants', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Source') return true;
      if (s === '/np/Notes/Source/Child') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    await expect(previewMoveLocalFolder('Source', 'Source/Child')).rejects.toThrow(
      'Cannot move a folder into itself',
    );
  });

  it('throws if source folder not found', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await expect(previewMoveLocalFolder('Nope', 'Dest')).rejects.toThrow('Source folder not found');
  });

  it('throws if destination folder not found', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Source') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    await expect(previewMoveLocalFolder('Source', 'NoDest')).rejects.toThrow(
      'Destination folder not found',
    );
  });

  it('throws if folder already at destination', async () => {
    // Source is already inside Dest, meaning the target path resolves to the same place
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Dest/Source') return true;
      if (s === '/np/Notes/Dest') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    await expect(previewMoveLocalFolder('Dest/Source', 'Dest')).rejects.toThrow(
      'already in the destination',
    );
  });

  it('throws if conflict at destination', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Source') return true;
      if (s === '/np/Notes/Dest') return true;
      if (s === '/np/Notes/Dest/Source') return true; // conflict
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    await expect(previewMoveLocalFolder('Source', 'Dest')).rejects.toThrow(
      'already exists at destination',
    );
  });

  it('allows moving to Notes root', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Sub/Source') return true;
      if (s === '/np/Notes') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    const result = await previewMoveLocalFolder('Sub/Source', 'Notes');
    expect(result.toFolder).toBe('Source');
    expect(result.destinationFolder).toBe('Notes');
  });
});

// ---------------------------------------------------------------------------
// moveLocalFolder
// ---------------------------------------------------------------------------
describe('moveLocalFolder', () => {
  it('moves folder to destination', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Source') return true;
      if (s === '/np/Notes/Dest') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    const result = await moveLocalFolder('Source', 'Dest');
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

  it('returns preview with fromFolder and toFolder', async () => {
    setupFolderRename();
    const result = await previewRenameLocalFolder('Old', 'New');
    expect(result.fromFolder).toBe('Old');
    expect(result.toFolder).toBe('New');
  });

  it('sanitizes new folder name', async () => {
    setupFolderRename();
    const result = await previewRenameLocalFolder('Old', 'He?lo');
    expect(result.toFolder).toBe('He-lo');
  });

  it('throws if new name matches current name', async () => {
    setupFolderRename();
    await expect(previewRenameLocalFolder('Old', 'Old')).rejects.toThrow('matches current name');
  });

  it('throws if new name already exists', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Old') return true;
      if (s === '/np/Notes/Taken') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    await expect(previewRenameLocalFolder('Old', 'Taken')).rejects.toThrow('already exists');
  });

  it('throws if source not found', async () => {
    mockFs.existsSync.mockReturnValue(false);
    await expect(previewRenameLocalFolder('Nope', 'New')).rejects.toThrow('Source folder not found');
  });

  it('throws on empty new name', async () => {
    setupFolderRename();
    await expect(previewRenameLocalFolder('Old', '  ')).rejects.toThrow('required');
  });

  it('must stay in same parent folder', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Old') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    await expect(previewRenameLocalFolder('Old', 'Other/New')).rejects.toThrow(
      'must stay in the same parent folder',
    );
  });
});

// ---------------------------------------------------------------------------
// renameLocalFolder
// ---------------------------------------------------------------------------
describe('renameLocalFolder', () => {
  it('renames folder and returns preview', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === '/np/Notes/Old') return true;
      return false;
    });
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    const result = await renameLocalFolder('Old', 'New');
    expect(result.fromFolder).toBe('Old');
    expect(result.toFolder).toBe('New');
    expect(mockFs.renameSync).toHaveBeenCalledWith('/np/Notes/Old', '/np/Notes/New');
  });
});
