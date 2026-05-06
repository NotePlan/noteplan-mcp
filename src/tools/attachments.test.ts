import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// ── Mocks ──

vi.mock('fs', () => {
  const sync = {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    renameSync: vi.fn(),
    copyFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmdirSync: vi.fn(),
    rmSync: vi.fn(),
  };
  // bridge-fs / attachments use fs.promises after the async cascade. Each
  // promise variant forwards to the sync mock so existing assertions on
  // fs.*Sync still pass.
  const promises = {
    mkdir: vi.fn(async (p: any, opts?: any) => sync.mkdirSync(p, opts)),
    writeFile: vi.fn(async (p: any, content: any, opts?: any) => sync.writeFileSync(p, content, opts)),
    readFile: vi.fn(async (p: any, opts?: any) => {
      if (!sync.existsSync(p)) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return sync.readFileSync(p, opts);
    }),
    readdir: vi.fn(async (p: any, opts?: any) => sync.readdirSync(p, opts)),
    stat: vi.fn(async (p: any) => {
      if (!sync.existsSync(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const explicit: any = sync.statSync(p) ?? {};
      // bridge-fs.statPath calls stats.isDirectory(); ensure it exists even
      // when a test only mocked size/mtime.
      return {
        isDirectory: typeof explicit.isDirectory === 'function' ? explicit.isDirectory : () => false,
        isFile: typeof explicit.isFile === 'function' ? explicit.isFile : () => true,
        size: explicit.size ?? 0,
        mtime: explicit.mtime ?? new Date(0),
        birthtime: explicit.birthtime ?? new Date(0),
      };
    }),
    rename: vi.fn(async (a: any, b: any) => sync.renameSync(a, b)),
    copyFile: vi.fn(async (a: any, b: any) => sync.copyFileSync(a, b)),
    unlink: vi.fn(async (p: any) => sync.unlinkSync(p)),
    rm: vi.fn(async (p: any) => {
      if (sync.rmSync) sync.rmSync(p, { recursive: true });
      else sync.unlinkSync(p);
    }),
  };
  return { ...sync, promises };
});

vi.mock('../transport/bridge-availability.js', () => ({
  getBridgeClient: vi.fn(async () => null),
  invalidateBridgeClient: vi.fn(),
}));

vi.mock('../noteplan/unified-store.js', () => ({
  getNote: vi.fn(),
}));

vi.mock('../noteplan/file-reader.js', () => ({
  getNotePlanPath: vi.fn(),
}));

import * as fs from 'fs';
import { getNote } from '../noteplan/unified-store.js';
import { getNotePlanPath } from '../noteplan/file-reader.js';
import {
  addAttachment,
  listAttachments,
  getAttachment,
  moveAttachment,
  attachmentsSchema,
} from './attachments.js';

// ── Helpers ──

const NP_PATH = '/np';

function mockNote(overrides: Partial<{
  id: string;
  title: string;
  filename: string;
  content: string;
  type: string;
  source: string;
}> = {}) {
  return {
    id: '1',
    title: 'Test Note',
    filename: 'Notes/Test Note.md',
    content: '# Test\n',
    type: 'note' as const,
    source: 'local' as const,
    ...overrides,
  };
}

const validBase64 = Buffer.from('hello world').toString('base64'); // 'aGVsbG8gd29ybGQ='

// ── Setup ──

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getNotePlanPath).mockReturnValue(NP_PATH);
});

// ── Schema ──

describe('attachmentsSchema', () => {
  it('accepts valid input with all fields', async () => {
    const result = attachmentsSchema.safeParse({
      action: 'add',
      id: '1',
      data: validBase64,
      attachmentFilename: 'photo.png',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', async () => {
    const result = attachmentsSchema.safeParse({ action: 'delete' });
    expect(result.success).toBe(false);
  });
});

// ── addAttachment ──

describe('addAttachment', () => {
  const baseParams: Parameters<typeof addAttachment>[0] = {
    action: 'add' as const,
    id: '1',
    attachmentFilename: 'photo.png',
    data: validBase64,
    insertLink: false,
    includeData: false,
  };

  it('returns error when data is missing', async () => {
    const result = await addAttachment({ ...baseParams, data: undefined });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/data.*required/i);
  });

  it('returns error when attachmentFilename is missing', async () => {
    const result = await addAttachment({ ...baseParams, attachmentFilename: undefined });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/attachmentFilename.*required/i);
  });

  it('returns error when note not found', async () => {
    vi.mocked(getNote).mockResolvedValue(null);
    const result = await addAttachment(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns error for space notes', async () => {
    vi.mocked(getNote).mockResolvedValue(mockNote({ source: 'space' }) as any);
    const result = await addAttachment(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/space/i);
  });

  it('returns error when filename sanitizes to empty', async () => {
    vi.mocked(getNote).mockResolvedValue(mockNote() as any);
    const result = await addAttachment({ ...baseParams, attachmentFilename: '()[]!' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid.*filename/i);
  });

  it('returns error for empty base64 (zero-length buffer)', async () => {
    vi.mocked(getNote).mockResolvedValue(mockNote() as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // Use padding-only base64 that decodes to zero bytes
    // Note: An empty string '' is falsy and caught by the !data check first,
    // so we use a whitespace-only string that passes truthiness but decodes to empty
    const result = await addAttachment({ ...baseParams, data: '  ' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('successfully writes attachment and returns correct markdownLink', async () => {
    const note = mockNote();
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = await addAttachment(baseParams);

    expect(result.success).toBe(true);
    expect(result).toHaveProperty('markdownLink');
    expect(result.markdownLink).toBe('![image](Test%20Note_attachments/photo.png)');
    expect(result).toHaveProperty('fileSize');
    expect(result.isImage).toBe(true);
    expect(result.noteFilename).toBe('Notes/Test Note.md');
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('ensures the _attachments parent folder exists when writing', async () => {
    const note = mockNote();
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await addAttachment(baseParams);

    // bridge-fs.writeFileBinary always mkdirs the parent (idempotent with
    // `recursive: true`) before the write, so the explicit existsSync gate
    // we used to have is no longer needed.
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join(NP_PATH, 'Notes', 'Test Note_attachments'),
      { recursive: true },
    );
  });

  it('generates correct image markdown link for png/jpg', async () => {
    const note = mockNote();
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic']) {
      const result = await addAttachment({ ...baseParams, attachmentFilename: `photo.${ext}` });
      expect(result.markdownLink).toMatch(/^!\[image\]/);
      expect(result.isImage).toBe(true);
    }
  });

  it('generates correct file markdown link for pdf/txt', async () => {
    const note = mockNote();
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    for (const ext of ['pdf', 'txt', 'csv', 'mp3']) {
      const result = await addAttachment({ ...baseParams, attachmentFilename: `doc.${ext}` });
      expect(result.markdownLink).toMatch(/^!\[file\]/);
      expect(result.isImage).toBe(false);
    }
  });

  it('insertLink=false (default) does NOT modify note content', async () => {
    const note = mockNote();
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = await addAttachment({ ...baseParams, insertLink: false });

    expect(result.success).toBe(true);
    expect(result.linkInserted).toBe(false);
    // writeFileSync should be called once (for the attachment), not for the note
    expect(vi.mocked(fs.writeFileSync).mock.calls.length).toBe(1);
  });

  it('insertLink=true appends link to note', async () => {
    const note = mockNote({ content: '# Test\n' });
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# Test\n');

    const result = await addAttachment({ ...baseParams, insertLink: true });

    expect(result.success).toBe(true);
    expect(result.linkInserted).toBe(true);
    // writeFileSync should be called twice: once for attachment, once for note
    expect(vi.mocked(fs.writeFileSync).mock.calls.length).toBe(2);
    const noteWriteCall = vi.mocked(fs.writeFileSync).mock.calls[1];
    const writtenContent = noteWriteCall[1] as string;
    expect(writtenContent).toContain('![image](Test%20Note_attachments/photo.png)');
  });

  it('cleans markdown-conflicting characters from filename', async () => {
    const note = mockNote();
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = await addAttachment({
      ...baseParams,
      attachmentFilename: 'photo (1) [copy]!.png',
    });

    expect(result.success).toBe(true);
    // Cleaned name should have removed ()[]!
    expect(result.markdownLink).toBe('![image](Test%20Note_attachments/photo%201%20copy.png)');
    expect(result.attachmentPath).toBe('Test Note_attachments/photo 1 copy.png');
  });

  it('percent-encodes special characters in the markdown link path', async () => {
    const note = mockNote({ filename: 'Notes/My (Special) Note.md' });
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = await addAttachment({ ...baseParams, attachmentFilename: 'file name.png' });

    expect(result.success).toBe(true);
    // Note name has special chars that get encoded in the path
    // "My (Special) Note_attachments/file name.png"
    // After encoding: "My%20%28Special%29%20Note_attachments/file%20name.png"
    expect(result.markdownLink).toBe(
      '![image](My%20%28Special%29%20Note_attachments/file%20name.png)',
    );
  });
});

// ── listAttachments ──

describe('listAttachments', () => {
  const baseParams: Parameters<typeof listAttachments>[0] = {
    action: 'list' as const,
    id: '1',
    insertLink: false,
    includeData: false,
  };

  it('returns error when note not found', async () => {
    vi.mocked(getNote).mockResolvedValue(null);
    const result = await listAttachments(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns empty list when _attachments folder does not exist', async () => {
    vi.mocked(getNote).mockResolvedValue(mockNote() as any);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await listAttachments(baseParams);

    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
    expect(result.attachments).toEqual([]);
  });

  it('lists attachments with correct metadata', async () => {
    const note = mockNote();
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const mockDate = new Date('2024-01-15T10:30:00Z');
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'photo.png', isFile: () => true, isDirectory: () => false } as any,
      { name: 'doc.pdf', isFile: () => true, isDirectory: () => false } as any,
    ]);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 1024,
      mtime: mockDate,
    } as any);

    const result = await listAttachments(baseParams);

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.noteFilename).toBe('Notes/Test Note.md');
    expect(result.noteTitle).toBe('Test Note');

    const attachments = result.attachments as any[];
    // sorted alphabetically: doc.pdf < photo.png
    expect(attachments[0].filename).toBe('doc.pdf');
    expect(attachments[0].isImage).toBe(false);
    expect(attachments[0].markdownLink).toBe('![file](Test%20Note_attachments/doc.pdf)');
    expect(attachments[0].size).toBe(1024);
    expect(attachments[0].modifiedAt).toBe(mockDate.toISOString());

    expect(attachments[1].filename).toBe('photo.png');
    expect(attachments[1].isImage).toBe(true);
    expect(attachments[1].markdownLink).toBe('![image](Test%20Note_attachments/photo.png)');
  });

  it('skips hidden files (starting with .)', async () => {
    const note = mockNote();
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: '.DS_Store', isFile: () => true, isDirectory: () => false } as any,
      { name: '.hidden', isFile: () => true, isDirectory: () => false } as any,
      { name: 'visible.png', isFile: () => true, isDirectory: () => false } as any,
    ]);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 100,
      mtime: new Date(),
    } as any);

    const result = await listAttachments(baseParams);

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect((result.attachments as any[])[0].filename).toBe('visible.png');
  });

  it('skips directories', async () => {
    const note = mockNote();
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'subfolder', isFile: () => false, isDirectory: () => true } as any,
      { name: 'photo.png', isFile: () => true, isDirectory: () => false } as any,
    ]);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 100,
      mtime: new Date(),
    } as any);

    const result = await listAttachments(baseParams);

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
  });
});

// ── getAttachment ──

describe('getAttachment', () => {
  const baseParams: Parameters<typeof getAttachment>[0] = {
    action: 'get' as const,
    id: '1',
    attachmentFilename: 'photo.png',
    insertLink: false,
    includeData: false,
  };

  it('returns error when attachmentFilename is missing', async () => {
    const result = await getAttachment({ ...baseParams, attachmentFilename: undefined });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/attachmentFilename.*required/i);
  });

  it('returns error when note not found', async () => {
    vi.mocked(getNote).mockResolvedValue(null);
    const result = await getAttachment(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns error when attachment file does not exist', async () => {
    vi.mocked(getNote).mockResolvedValue(mockNote() as any);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await getAttachment(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns metadata without data when includeData is false', async () => {
    const note = mockNote();
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 2048,
      mtime: new Date('2024-06-01T12:00:00Z'),
    } as any);

    const result = await getAttachment({ ...baseParams, includeData: false });

    expect(result.success).toBe(true);
    expect(result.filename).toBe('photo.png');
    expect(result.isImage).toBe(true);
    expect(result.mimeType).toBe('image/png');
    expect(result.size).toBe(2048);
    expect(result.markdownLink).toBe('![image](Test%20Note_attachments/photo.png)');
    expect(result).not.toHaveProperty('data');
  });

  it('returns base64 data when includeData is true', async () => {
    const note = mockNote();
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 100,
      mtime: new Date('2024-06-01T12:00:00Z'),
    } as any);
    const fileBuffer = Buffer.from('file content');
    vi.mocked(fs.readFileSync).mockReturnValue(fileBuffer);

    const result = await getAttachment({ ...baseParams, includeData: true });

    expect(result.success).toBe(true);
    expect(result.data).toBe(fileBuffer.toString('base64'));
  });

  it('respects maxDataSize - returns dataTruncated=true for large images', async () => {
    const note = mockNote();
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 5000,
      mtime: new Date('2024-06-01T12:00:00Z'),
    } as any);
    // Create a buffer larger than maxDataSize
    const largeBuffer = Buffer.alloc(5000, 'x');
    vi.mocked(fs.readFileSync).mockReturnValue(largeBuffer);

    const result = await getAttachment({
      ...baseParams,
      includeData: true,
      maxDataSize: 1000,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
    expect(result.dataTruncated).toBe(true);
    expect(result.originalSize).toBe(5000);
    expect(result.hint).toBeDefined();
  });

  it('does NOT truncate non-image files even if over maxDataSize', async () => {
    const note = mockNote();
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 5000,
      mtime: new Date('2024-06-01T12:00:00Z'),
    } as any);
    const largeBuffer = Buffer.alloc(5000, 'x');
    vi.mocked(fs.readFileSync).mockReturnValue(largeBuffer);

    const result = await getAttachment({
      ...baseParams,
      attachmentFilename: 'doc.pdf',
      includeData: true,
      maxDataSize: 1000,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe(largeBuffer.toString('base64'));
    expect(result.dataTruncated).toBeUndefined();
  });

  it('returns correct MIME type mapping', async () => {
    const note = mockNote();
    vi.mocked(getNote).mockResolvedValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 100,
      mtime: new Date(),
    } as any);

    const mimeTests: [string, string][] = [
      ['photo.png', 'image/png'],
      ['photo.jpg', 'image/jpeg'],
      ['photo.jpeg', 'image/jpeg'],
      ['photo.gif', 'image/gif'],
      ['photo.webp', 'image/webp'],
      ['photo.heic', 'image/heic'],
      ['doc.pdf', 'application/pdf'],
      ['song.mp3', 'audio/mpeg'],
      ['video.mp4', 'video/mp4'],
      ['notes.txt', 'text/plain'],
      ['data.csv', 'text/csv'],
      ['config.json', 'application/json'],
      ['unknown.xyz', 'application/octet-stream'],
    ];

    for (const [filename, expectedMime] of mimeTests) {
      const result = await getAttachment({
        ...baseParams,
        attachmentFilename: filename,
        includeData: false,
      });
      expect(result.mimeType).toBe(expectedMime);
    }
  });
});

// ── moveAttachment ──

describe('moveAttachment', () => {
  const sourceNote = mockNote({
    id: '1',
    title: 'Source Note',
    filename: 'Notes/Source Note.md',
    content: '# Source\n![image](Source%20Note_attachments/photo.png)\n',
  });

  const destNote = mockNote({
    id: '2',
    title: 'Dest Note',
    filename: 'Notes/Dest Note.md',
    content: '# Dest\n',
  });

  const baseParams: Parameters<typeof moveAttachment>[0] = {
    action: 'move' as const,
    id: '1',
    attachmentFilename: 'photo.png',
    destinationId: '2',
    insertLink: false,
    includeData: false,
  };

  it('returns error when attachmentFilename is missing', async () => {
    const result = await moveAttachment({ ...baseParams, attachmentFilename: undefined });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/attachmentFilename.*required/i);
  });

  it('returns error when source note not found', async () => {
    vi.mocked(getNote).mockResolvedValue(null);
    const result = await moveAttachment(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns error when destination note not found', async () => {
    // First call for source returns note, second call for destination returns null
    vi.mocked(getNote)
      .mockResolvedValueOnce(sourceNote as any)
      .mockResolvedValueOnce(null);

    const result = await moveAttachment(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns error when attachment file does not exist at source', async () => {
    vi.mocked(getNote)
      .mockReturnValueOnce(sourceNote as any)
      .mockReturnValueOnce(destNote as any);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await moveAttachment(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found.*source/i);
  });

  it('successfully moves file and returns new markdownLink', async () => {
    vi.mocked(getNote)
      .mockReturnValueOnce(sourceNote as any)
      .mockReturnValueOnce(destNote as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '# Source\n![image](Source%20Note_attachments/photo.png)\n',
    );
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    const result = await moveAttachment(baseParams);

    expect(result.success).toBe(true);
    expect(result.markdownLink).toBe('![image](Dest%20Note_attachments/photo.png)');
    expect(result).toHaveProperty('movedFrom', 'Source Note_attachments/photo.png');
    expect(result).toHaveProperty('movedTo', 'Dest Note_attachments/photo.png');
    expect(fs.renameSync).toHaveBeenCalled();
  });

  it('removes old markdown link from source note content', async () => {
    vi.mocked(getNote)
      .mockReturnValueOnce(sourceNote as any)
      .mockReturnValueOnce(destNote as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '# Source\n![image](Source%20Note_attachments/photo.png)\nMore text\n',
    );
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    const result = await moveAttachment(baseParams);

    expect(result.success).toBe(true);
    expect(result.oldLinkRemoved).toBe(true);
    // Check that writeFileSync was called for the source note with link removed
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(
      (call) => call[0] === path.join(NP_PATH, 'Notes/Source Note.md'),
    );
    expect(writeCall).toBeDefined();
    const writtenContent = writeCall![1] as string;
    expect(writtenContent).not.toContain('![image](Source%20Note_attachments/photo.png)');
    expect(writtenContent).toContain('More text');
  });

  it('creates destination folder if needed', async () => {
    vi.mocked(getNote)
      .mockReturnValueOnce(sourceNote as any)
      .mockReturnValueOnce(destNote as any);
    // Source file exists, dest folder does not
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p);
      if (s.includes('Dest Note_attachments')) return false;
      return true;
    });
    vi.mocked(fs.readFileSync).mockReturnValue('# Source\n');
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    await moveAttachment(baseParams);

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join(NP_PATH, 'Notes', 'Dest Note_attachments'),
      { recursive: true },
    );
  });

  it('cleans up empty source folder after move', async () => {
    vi.mocked(getNote)
      .mockReturnValueOnce(sourceNote as any)
      .mockReturnValueOnce(destNote as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# Source\n');
    // Empty remaining files after move
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    await moveAttachment(baseParams);

    expect(fs.rmSync).toHaveBeenCalledWith(
      path.join(NP_PATH, 'Notes', 'Source Note_attachments'),
      { recursive: true },
    );
  });

  it('does NOT remove source folder when other files remain', async () => {
    vi.mocked(getNote)
      .mockReturnValueOnce(sourceNote as any)
      .mockReturnValueOnce(destNote as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# Source\n');
    // Other files remain
    vi.mocked(fs.readdirSync).mockReturnValue(['other.png'] as any);

    await moveAttachment(baseParams);

    expect(fs.rmdirSync).not.toHaveBeenCalled();
  });

  it('falls back to copy+unlink when renameSync throws EXDEV', async () => {
    vi.mocked(getNote)
      .mockReturnValueOnce(sourceNote as any)
      .mockReturnValueOnce(destNote as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# Source\n');
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    const exdevError = Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
    vi.mocked(fs.renameSync).mockImplementation(() => {
      throw exdevError;
    });

    const result = await moveAttachment(baseParams);

    expect(result.success).toBe(true);
    expect(fs.copyFileSync).toHaveBeenCalled();
    expect(fs.unlinkSync).toHaveBeenCalled();
  });
});
