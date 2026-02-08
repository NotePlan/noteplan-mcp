#!/usr/bin/env node

import * as notes from '../dist/tools/notes.js';
import * as tasks from '../dist/tools/tasks.js';
import * as search from '../dist/tools/search.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function pickLocalNote(listed) {
  return listed?.notes?.find((note) => note.source === 'local' && typeof note.filename === 'string');
}

async function run() {
  const listed = notes.listNotes({ limit: 400 });
  assert(listed.success === true, 'listNotes failed');

  const local = pickLocalNote(listed);
  assert(local, 'No local note available for smoke checks');

  const blockedUpdate = notes.updateNote({
    filename: local.filename,
    content: 'smoke-check',
  });
  assert(blockedUpdate.success === false, 'updateNote should require fullReplace=true');

  const dryDeleteNote = notes.deleteNote({
    filename: local.filename,
    dryRun: true,
  });
  assert(dryDeleteNote.success === true && dryDeleteNote.dryRun === true, 'deleteNote dryRun failed');

  const dryDeleteLines = notes.deleteLines({
    filename: local.filename,
    startLine: 1,
    endLine: 2,
    dryRun: true,
  });
  assert(dryDeleteLines.success === true && dryDeleteLines.dryRun === true, 'deleteLines dryRun failed');

  const paragraphs = notes.getParagraphs({ filename: local.filename, limit: 5 });
  assert(paragraphs.success === true, 'getParagraphs failed');
  assert(typeof paragraphs.hasMore === 'boolean', 'getParagraphs missing pagination');

  const paragraphSearch = notes.searchParagraphs({
    filename: local.filename,
    query: 'the',
    limit: 2,
  });
  assert(paragraphSearch.success === true, 'searchParagraphs failed');
  assert(typeof paragraphSearch.totalCount === 'number', 'searchParagraphs missing totalCount');

  const taskPage = tasks.getTasks({
    filename: local.filename,
    limit: 5,
  });
  assert(taskPage.success === true, 'getTasks failed');
  assert(typeof taskPage.totalCount === 'number', 'getTasks missing totalCount');

  const taskSearch = tasks.searchTasks({
    filename: local.filename,
    query: 'the',
    limit: 2,
  });
  assert(taskSearch.success === true, 'searchTasks failed');
  assert(typeof taskSearch.totalCount === 'number', 'searchTasks missing totalCount');

  const searchResult = await search.searchNotes({
    query: 'meeting',
    limit: 3,
  });
  assert(searchResult.success === true, 'searchNotes failed');
  assert(typeof searchResult.partialResults === 'boolean', 'searchNotes missing partialResults');
  assert(typeof searchResult.searchBackend === 'string', 'searchNotes missing searchBackend');
  assert(Array.isArray(searchResult.warnings), 'searchNotes missing warnings array');

  console.log(
    JSON.stringify(
      {
        success: true,
        checked: [
          'updateNote fullReplace safety',
          'deleteNote dryRun',
          'deleteLines dryRun',
          'paragraph pagination/search',
          'task pagination/search',
          'search diagnostics',
        ],
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
