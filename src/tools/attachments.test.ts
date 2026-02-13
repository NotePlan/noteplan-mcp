import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// ── Mocks ──

vi.mock('fs', () => ({
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
  it('accepts valid input with all fields', () => {
    const result = attachmentsSchema.safeParse({
      action: 'add',
      id: '1',
      data: validBase64,
      attachmentFilename: 'photo.png',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', () => {
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

  it('returns error when data is missing', () => {
    const result = addAttachment({ ...baseParams, data: undefined });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/data.*required/i);
  });

  it('returns error when attachmentFilename is missing', () => {
    const result = addAttachment({ ...baseParams, attachmentFilename: undefined });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/attachmentFilename.*required/i);
  });

  it('returns error when note not found', () => {
    vi.mocked(getNote).mockReturnValue(null);
    const result = addAttachment(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns error for space notes', () => {
    vi.mocked(getNote).mockReturnValue(mockNote({ source: 'space' }) as any);
    const result = addAttachment(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/space/i);
  });

  it('returns error when filename sanitizes to empty', () => {
    vi.mocked(getNote).mockReturnValue(mockNote() as any);
    const result = addAttachment({ ...baseParams, attachmentFilename: '()[]!' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid.*filename/i);
  });

  it('returns error for empty base64 (zero-length buffer)', () => {
    vi.mocked(getNote).mockReturnValue(mockNote() as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // Use padding-only base64 that decodes to zero bytes
    // Note: An empty string '' is falsy and caught by the !data check first,
    // so we use a whitespace-only string that passes truthiness but decodes to empty
    const result = addAttachment({ ...baseParams, data: '  ' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('successfully writes attachment and returns correct markdownLink', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = addAttachment(baseParams);

    expect(result.success).toBe(true);
    expect(result).toHaveProperty('markdownLink');
    expect(result.markdownLink).toBe('![image](Test%20Note_attachments/photo.png)');
    expect(result).toHaveProperty('fileSize');
    expect(result.isImage).toBe(true);
    expect(result.noteFilename).toBe('Notes/Test Note.md');
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('creates the _attachments folder if it does not exist', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    addAttachment(baseParams);

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join(NP_PATH, 'Notes', 'Test Note_attachments'),
      { recursive: true },
    );
  });

  it('does NOT create folder when it already exists', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    addAttachment(baseParams);

    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  it('generates correct image markdown link for png/jpg', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic']) {
      const result = addAttachment({ ...baseParams, attachmentFilename: `photo.${ext}` });
      expect(result.markdownLink).toMatch(/^!\[image\]/);
      expect(result.isImage).toBe(true);
    }
  });

  it('generates correct file markdown link for pdf/txt', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    for (const ext of ['pdf', 'txt', 'csv', 'mp3']) {
      const result = addAttachment({ ...baseParams, attachmentFilename: `doc.${ext}` });
      expect(result.markdownLink).toMatch(/^!\[file\]/);
      expect(result.isImage).toBe(false);
    }
  });

  it('insertLink=false (default) does NOT modify note content', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = addAttachment({ ...baseParams, insertLink: false });

    expect(result.success).toBe(true);
    expect(result.linkInserted).toBe(false);
    // writeFileSync should be called once (for the attachment), not for the note
    expect(vi.mocked(fs.writeFileSync).mock.calls.length).toBe(1);
  });

  it('insertLink=true appends link to note', () => {
    const note = mockNote({ content: '# Test\n' });
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# Test\n');

    const result = addAttachment({ ...baseParams, insertLink: true });

    expect(result.success).toBe(true);
    expect(result.linkInserted).toBe(true);
    // writeFileSync should be called twice: once for attachment, once for note
    expect(vi.mocked(fs.writeFileSync).mock.calls.length).toBe(2);
    const noteWriteCall = vi.mocked(fs.writeFileSync).mock.calls[1];
    const writtenContent = noteWriteCall[1] as string;
    expect(writtenContent).toContain('![image](Test%20Note_attachments/photo.png)');
  });

  it('cleans markdown-conflicting characters from filename', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = addAttachment({
      ...baseParams,
      attachmentFilename: 'photo (1) [copy]!.png',
    });

    expect(result.success).toBe(true);
    // Cleaned name should have removed ()[]!
    expect(result.markdownLink).toBe('![image](Test%20Note_attachments/photo%201%20copy.png)');
    expect(result.attachmentPath).toBe('Test Note_attachments/photo 1 copy.png');
  });

  it('percent-encodes special characters in the markdown link path', () => {
    const note = mockNote({ filename: 'Notes/My (Special) Note.md' });
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = addAttachment({ ...baseParams, attachmentFilename: 'file name.png' });

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

  it('returns error when note not found', () => {
    vi.mocked(getNote).mockReturnValue(null);
    const result = listAttachments(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns empty list when _attachments folder does not exist', () => {
    vi.mocked(getNote).mockReturnValue(mockNote() as any);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = listAttachments(baseParams);

    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
    expect(result.attachments).toEqual([]);
  });

  it('lists attachments with correct metadata', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const mockDate = new Date('2024-01-15T10:30:00Z');
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'photo.png', isFile: () => true } as any,
      { name: 'doc.pdf', isFile: () => true } as any,
    ]);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 1024,
      mtime: mockDate,
    } as any);

    const result = listAttachments(baseParams);

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

  it('skips hidden files (starting with .)', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: '.DS_Store', isFile: () => true } as any,
      { name: '.hidden', isFile: () => true } as any,
      { name: 'visible.png', isFile: () => true } as any,
    ]);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 100,
      mtime: new Date(),
    } as any);

    const result = listAttachments(baseParams);

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect((result.attachments as any[])[0].filename).toBe('visible.png');
  });

  it('skips directories', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'subfolder', isFile: () => false } as any,
      { name: 'photo.png', isFile: () => true } as any,
    ]);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 100,
      mtime: new Date(),
    } as any);

    const result = listAttachments(baseParams);

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

  it('returns error when attachmentFilename is missing', () => {
    const result = getAttachment({ ...baseParams, attachmentFilename: undefined });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/attachmentFilename.*required/i);
  });

  it('returns error when note not found', () => {
    vi.mocked(getNote).mockReturnValue(null);
    const result = getAttachment(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns error when attachment file does not exist', () => {
    vi.mocked(getNote).mockReturnValue(mockNote() as any);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = getAttachment(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns metadata without data when includeData is false', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 2048,
      mtime: new Date('2024-06-01T12:00:00Z'),
    } as any);

    const result = getAttachment({ ...baseParams, includeData: false });

    expect(result.success).toBe(true);
    expect(result.filename).toBe('photo.png');
    expect(result.isImage).toBe(true);
    expect(result.mimeType).toBe('image/png');
    expect(result.size).toBe(2048);
    expect(result.markdownLink).toBe('![image](Test%20Note_attachments/photo.png)');
    expect(result).not.toHaveProperty('data');
  });

  it('returns base64 data when includeData is true', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 100,
      mtime: new Date('2024-06-01T12:00:00Z'),
    } as any);
    const fileBuffer = Buffer.from('file content');
    vi.mocked(fs.readFileSync).mockReturnValue(fileBuffer);

    const result = getAttachment({ ...baseParams, includeData: true });

    expect(result.success).toBe(true);
    expect(result.data).toBe(fileBuffer.toString('base64'));
  });

  it('respects maxDataSize - returns dataTruncated=true for large images', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 5000,
      mtime: new Date('2024-06-01T12:00:00Z'),
    } as any);
    // Create a buffer larger than maxDataSize
    const largeBuffer = Buffer.alloc(5000, 'x');
    vi.mocked(fs.readFileSync).mockReturnValue(largeBuffer);

    const result = getAttachment({
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

  it('does NOT truncate non-image files even if over maxDataSize', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 5000,
      mtime: new Date('2024-06-01T12:00:00Z'),
    } as any);
    const largeBuffer = Buffer.alloc(5000, 'x');
    vi.mocked(fs.readFileSync).mockReturnValue(largeBuffer);

    const result = getAttachment({
      ...baseParams,
      attachmentFilename: 'doc.pdf',
      includeData: true,
      maxDataSize: 1000,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe(largeBuffer.toString('base64'));
    expect(result.dataTruncated).toBeUndefined();
  });

  it('returns correct MIME type mapping', () => {
    const note = mockNote();
    vi.mocked(getNote).mockReturnValue(note as any);
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
      const result = getAttachment({
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

  it('returns error when attachmentFilename is missing', () => {
    const result = moveAttachment({ ...baseParams, attachmentFilename: undefined });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/attachmentFilename.*required/i);
  });

  it('returns error when source note not found', () => {
    vi.mocked(getNote).mockReturnValue(null);
    const result = moveAttachment(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns error when destination note not found', () => {
    // First call for source returns note, second call for destination returns null
    vi.mocked(getNote)
      .mockReturnValueOnce(sourceNote as any)
      .mockReturnValueOnce(null);

    const result = moveAttachment(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns error when attachment file does not exist at source', () => {
    vi.mocked(getNote)
      .mockReturnValueOnce(sourceNote as any)
      .mockReturnValueOnce(destNote as any);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = moveAttachment(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found.*source/i);
  });

  it('successfully moves file and returns new markdownLink', () => {
    vi.mocked(getNote)
      .mockReturnValueOnce(sourceNote as any)
      .mockReturnValueOnce(destNote as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '# Source\n![image](Source%20Note_attachments/photo.png)\n',
    );
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    const result = moveAttachment(baseParams);

    expect(result.success).toBe(true);
    expect(result.markdownLink).toBe('![image](Dest%20Note_attachments/photo.png)');
    expect(result).toHaveProperty('movedFrom', 'Source Note_attachments/photo.png');
    expect(result).toHaveProperty('movedTo', 'Dest Note_attachments/photo.png');
    expect(fs.renameSync).toHaveBeenCalled();
  });

  it('removes old markdown link from source note content', () => {
    vi.mocked(getNote)
      .mockReturnValueOnce(sourceNote as any)
      .mockReturnValueOnce(destNote as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '# Source\n![image](Source%20Note_attachments/photo.png)\nMore text\n',
    );
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    const result = moveAttachment(baseParams);

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

  it('creates destination folder if needed', () => {
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

    moveAttachment(baseParams);

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join(NP_PATH, 'Notes', 'Dest Note_attachments'),
      { recursive: true },
    );
  });

  it('cleans up empty source folder after move', () => {
    vi.mocked(getNote)
      .mockReturnValueOnce(sourceNote as any)
      .mockReturnValueOnce(destNote as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# Source\n');
    // Empty remaining files after move
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    moveAttachment(baseParams);

    expect(fs.rmdirSync).toHaveBeenCalledWith(
      path.join(NP_PATH, 'Notes', 'Source Note_attachments'),
    );
  });

  it('does NOT remove source folder when other files remain', () => {
    vi.mocked(getNote)
      .mockReturnValueOnce(sourceNote as any)
      .mockReturnValueOnce(destNote as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# Source\n');
    // Other files remain
    vi.mocked(fs.readdirSync).mockReturnValue(['other.png'] as any);

    moveAttachment(baseParams);

    expect(fs.rmdirSync).not.toHaveBeenCalled();
  });

  it('falls back to copy+unlink when renameSync throws EXDEV', () => {
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

    const result = moveAttachment(baseParams);

    expect(result.success).toBe(true);
    expect(fs.copyFileSync).toHaveBeenCalled();
    expect(fs.unlinkSync).toHaveBeenCalled();
  });
});
