// Teamspace operations

import { z } from 'zod';
import * as store from '../noteplan/unified-store.js';

export const listTeamspacesSchema = z.object({});

export const listTagsSchema = z.object({
  teamspace: z.string().optional().describe('Teamspace ID to list tags from'),
});

export const listFoldersSchema = z.object({
  teamspace: z.string().optional().describe('Teamspace ID to list folders from'),
});

export function listTeamspaces(_params: z.infer<typeof listTeamspacesSchema>) {
  const teamspaces = store.listTeamspaces();

  return {
    success: true,
    count: teamspaces.length,
    teamspaces: teamspaces.map((ts) => ({
      id: ts.id,
      name: ts.name,
      noteCount: ts.noteCount,
    })),
  };
}

export function listTags(params: z.infer<typeof listTagsSchema>) {
  const tags = store.listTags(params.teamspace);

  return {
    success: true,
    count: tags.length,
    tags,
  };
}

export function listFolders(params: z.infer<typeof listFoldersSchema>) {
  const folders = store.listFolders(params.teamspace);

  return {
    success: true,
    count: folders.length,
    folders: folders.map((f) => ({
      path: f.path,
      name: f.name,
      source: f.source,
      teamspaceId: f.teamspaceId,
    })),
  };
}
