// Space operations

import { z } from 'zod';
import * as store from '../noteplan/unified-store.js';

export const listSpacesSchema = z.object({});

export const listTagsSchema = z.object({
  space: z.string().optional().describe('Space ID to list tags from'),
});

export const listFoldersSchema = z.object({
  space: z.string().optional().describe('Space ID to list folders from'),
});

export function listSpaces(_params: z.infer<typeof listSpacesSchema>) {
  const spaces = store.listSpaces();

  return {
    success: true,
    count: spaces.length,
    spaces: spaces.map((s) => ({
      id: s.id,
      name: s.name,
      noteCount: s.noteCount,
    })),
  };
}

export function listTags(params: z.infer<typeof listTagsSchema>) {
  const tags = store.listTags(params.space);

  return {
    success: true,
    count: tags.length,
    tags,
  };
}

export function listFolders(params: z.infer<typeof listFoldersSchema>) {
  const folders = store.listFolders(params.space);

  return {
    success: true,
    count: folders.length,
    folders: folders.map((f) => ({
      path: f.path,
      name: f.name,
      source: f.source,
      spaceId: f.spaceId,
    })),
  };
}
