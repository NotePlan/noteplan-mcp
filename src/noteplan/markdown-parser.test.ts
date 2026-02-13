import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./preferences.js', () => ({
  getTaskMarkerConfigCached: vi.fn(() => ({
    isAsteriskTodo: true,
    isDashTodo: false,
    defaultTodoCharacter: '*',
    useCheckbox: true,
  })),
  getTaskPrefix: vi.fn(() => '* [ ] '),
}));

import {
  parseTasks,
  parseTaskLine,
  extractTags,
  extractMentions,
  extractTagsFromContent,
  extractScheduledDate,
  extractPriority,
  extractTitle,
  updateTaskStatus,
  updateTaskContent,
  addTask,
  extractHeadings,
  parseParagraphLine,
  buildParagraphLine,
  filterTasksByStatus,
} from './markdown-parser.js';

import { getTaskMarkerConfigCached } from './preferences.js';
import type { Task, TaskStatus } from './types.js';

// ---------------------------------------------------------------------------
// extractTags
// ---------------------------------------------------------------------------
describe('extractTags', () => {
  it('extracts a simple #tag', () => {
    expect(extractTags('hello #tag world')).toEqual(['#tag']);
  });

  it('extracts hierarchical #parent/child with expansion', () => {
    const result = extractTags('hello #parent/child');
    expect(result).toContain('#parent');
    expect(result).toContain('#parent/child');
  });

  it('extracts multiple tags', () => {
    const result = extractTags('#one #two #three');
    expect(result).toContain('#one');
    expect(result).toContain('#two');
    expect(result).toContain('#three');
    expect(result).toHaveLength(3);
  });

  it('ignores tags inside inline code', () => {
    expect(extractTags('some `#notag` text')).toEqual([]);
  });

  it('ignores tags in markdown link URLs', () => {
    const result = extractTags('[text](#anchor)');
    expect(result).not.toContain('#anchor');
  });

  it('does NOT extract purely numeric #123', () => {
    expect(extractTags('issue #123 here')).toEqual([]);
  });

  it('strips tag attributes #tag(value)', () => {
    const result = extractTags('hello #tag(value) world');
    expect(result).toEqual(['#tag']);
  });

  it('handles emoji/unicode in tags', () => {
    const result = extractTags('hello #caf\u00e9 world');
    expect(result).toEqual(['#caf\u00e9']);
  });

  it('extracts tags after allowed boundary chars', () => {
    // space, (, [, *
    expect(extractTags('(#inparens)')).toContain('#inparens');
    expect(extractTags('[#inbracket]')).toContain('#inbracket');
    expect(extractTags('*#afterstar')).toContain('#afterstar');
  });

  it('returns empty for no tags', () => {
    expect(extractTags('no tags here')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractMentions
// ---------------------------------------------------------------------------
describe('extractMentions', () => {
  it('extracts @person', () => {
    expect(extractMentions('hello @person')).toEqual(['@person']);
  });

  it('extracts hierarchical @team/member with expansion', () => {
    const result = extractMentions('hello @team/member');
    expect(result).toContain('@team');
    expect(result).toContain('@team/member');
  });

  it('strips attributes @repeat(daily)', () => {
    const result = extractMentions('task @repeat(daily)');
    expect(result).toEqual(['@repeat']);
  });

  it('extracts multiple mentions', () => {
    const result = extractMentions('@alice and @bob');
    expect(result).toContain('@alice');
    expect(result).toContain('@bob');
    expect(result).toHaveLength(2);
  });

  it('ignores mentions in inline code', () => {
    expect(extractMentions('use `@Injectable` here')).toEqual([]);
  });

  it('returns empty for no mentions', () => {
    expect(extractMentions('no mentions here')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractTagsFromContent
// ---------------------------------------------------------------------------
describe('extractTagsFromContent', () => {
  it('strips code fences before extracting', () => {
    const content = 'hello #visible\n```\n#hidden\n```\nworld';
    const result = extractTagsFromContent(content);
    expect(result).toContain('#visible');
    expect(result).not.toContain('#hidden');
  });

  it('excludes @done, @repeat, @final-repeat', () => {
    const content = '#keep @done(2024-01-01) @repeat(daily) @final-repeat';
    const result = extractTagsFromContent(content);
    expect(result).toContain('#keep');
    expect(result).not.toContain('@done');
    expect(result).not.toContain('@repeat');
    expect(result).not.toContain('@final-repeat');
  });

  it('includes both #tags and @mentions except excluded ones', () => {
    const content = '#project @person';
    const result = extractTagsFromContent(content);
    expect(result).toContain('#project');
    expect(result).toContain('@person');
  });

  it('handles multi-line content', () => {
    const content = 'line1 #tag1\nline2 @mention1\nline3 #tag2';
    const result = extractTagsFromContent(content);
    expect(result).toContain('#tag1');
    expect(result).toContain('#tag2');
    expect(result).toContain('@mention1');
  });

  it('expands hierarchies', () => {
    const content = '#a/b/c';
    const result = extractTagsFromContent(content);
    expect(result).toContain('#a');
    expect(result).toContain('#a/b');
    expect(result).toContain('#a/b/c');
  });
});

// ---------------------------------------------------------------------------
// extractScheduledDate
// ---------------------------------------------------------------------------
describe('extractScheduledDate', () => {
  it('extracts >2024-01-15', () => {
    expect(extractScheduledDate('task >2024-01-15')).toBe('2024-01-15');
  });

  it('returns undefined when no date', () => {
    expect(extractScheduledDate('no date here')).toBeUndefined();
  });

  it('extracts first match', () => {
    expect(extractScheduledDate('>2024-01-01 >2024-12-31')).toBe('2024-01-01');
  });

  it('works with surrounding text', () => {
    expect(extractScheduledDate('buy milk >2024-06-15 #shopping')).toBe('2024-06-15');
  });
});

// ---------------------------------------------------------------------------
// extractPriority
// ---------------------------------------------------------------------------
describe('extractPriority', () => {
  it('extracts ! as 1', () => {
    expect(extractPriority('task !')).toBe(1);
  });

  it('extracts !! as 2', () => {
    expect(extractPriority('task !!')).toBe(2);
  });

  it('extracts !!! as 3', () => {
    expect(extractPriority('task !!!')).toBe(3);
  });

  it('returns undefined when no priority', () => {
    expect(extractPriority('no priority')).toBeUndefined();
  });

  it('does not match ! followed by word char', () => {
    expect(extractPriority('!important')).toBeUndefined();
  });

  it('works with surrounding text', () => {
    expect(extractPriority('buy milk !! #shopping')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// extractTitle
// ---------------------------------------------------------------------------
describe('extractTitle', () => {
  it('extracts # My Title', () => {
    expect(extractTitle('# My Title')).toBe('My Title');
  });

  it('extracts ## Sub heading', () => {
    expect(extractTitle('## Sub heading')).toBe('Sub heading');
  });

  it('uses plain text first line', () => {
    expect(extractTitle('Plain title\nBody text')).toBe('Plain title');
  });

  it('returns Untitled for empty content', () => {
    expect(extractTitle('')).toBe('Untitled');
  });
});

// ---------------------------------------------------------------------------
// parseTaskLine
// ---------------------------------------------------------------------------
describe('parseTaskLine', () => {
  beforeEach(() => {
    vi.mocked(getTaskMarkerConfigCached).mockReturnValue({
      isAsteriskTodo: true,
      isDashTodo: false,
      defaultTodoCharacter: '*',
      useCheckbox: true,
      taskPrefix: '* [ ] ',
    });
  });

  it('parses checkbox open task', () => {
    const task = parseTaskLine('* [ ] Buy milk', 0);
    expect(task).not.toBeNull();
    expect(task!.status).toBe('open');
    expect(task!.content).toBe('Buy milk');
    expect(task!.marker).toBe('*');
    expect(task!.hasCheckbox).toBe(true);
  });

  it('parses done task', () => {
    const task = parseTaskLine('* [x] Done item', 1);
    expect(task).not.toBeNull();
    expect(task!.status).toBe('done');
    expect(task!.content).toBe('Done item');
  });

  it('parses cancelled task', () => {
    const task = parseTaskLine('- [-] Cancelled', 2);
    expect(task).not.toBeNull();
    expect(task!.status).toBe('cancelled');
  });

  it('parses scheduled task', () => {
    const task = parseTaskLine('* [>] Scheduled', 3);
    expect(task).not.toBeNull();
    expect(task!.status).toBe('scheduled');
  });

  it('parses plain marker task when isAsteriskTodo is true', () => {
    const task = parseTaskLine('* Do something', 0);
    expect(task).not.toBeNull();
    expect(task!.status).toBe('open');
    expect(task!.hasCheckbox).toBe(false);
    expect(task!.content).toBe('Do something');
  });

  it('returns null for dash list item when isDashTodo is false', () => {
    const task = parseTaskLine('- list item', 0);
    expect(task).toBeNull();
  });

  it('returns null for plain text', () => {
    expect(parseTaskLine('just some text', 0)).toBeNull();
  });

  it('extracts tags, mentions, scheduledDate, priority from task content', () => {
    const task = parseTaskLine('* [ ] Buy milk #shopping @store >2024-01-15 !!', 0);
    expect(task).not.toBeNull();
    expect(task!.tags).toContain('#shopping');
    expect(task!.mentions).toContain('@store');
    expect(task!.scheduledDate).toBe('2024-01-15');
    expect(task!.priority).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// parseParagraphLine
// ---------------------------------------------------------------------------
describe('parseParagraphLine', () => {
  beforeEach(() => {
    vi.mocked(getTaskMarkerConfigCached).mockReturnValue({
      isAsteriskTodo: true,
      isDashTodo: false,
      defaultTodoCharacter: '*',
      useCheckbox: true,
      taskPrefix: '* [ ] ',
    });
  });

  it('empty line -> type empty', () => {
    const result = parseParagraphLine('', 0, false);
    expect(result.type).toBe('empty');
    expect(result.indentLevel).toBe(0);
  });

  it('separator --- -> type separator', () => {
    expect(parseParagraphLine('---', 0, false).type).toBe('separator');
  });

  it('separator *** -> type separator', () => {
    expect(parseParagraphLine('***', 0, false).type).toBe('separator');
  });

  it('# Title on first line -> type title', () => {
    const result = parseParagraphLine('# Title', 0, true);
    expect(result.type).toBe('title');
    expect(result.headingLevel).toBe(1);
  });

  it('## Section on non-first line -> type heading', () => {
    const result = parseParagraphLine('## Section', 1, false);
    expect(result.type).toBe('heading');
    expect(result.headingLevel).toBe(2);
  });

  it('plain first line -> type title', () => {
    const result = parseParagraphLine('My Note Title', 0, true);
    expect(result.type).toBe('title');
    expect(result.headingLevel).toBe(1);
  });

  it('> text -> type quote', () => {
    const result = parseParagraphLine('> some quote', 1, false);
    expect(result.type).toBe('quote');
  });

  it('* [ ] task -> type task with checkbox', () => {
    const result = parseParagraphLine('* [ ] task content', 1, false);
    expect(result.type).toBe('task');
    expect(result.hasCheckbox).toBe(true);
    expect(result.taskStatus).toBe('open');
    expect(result.marker).toBe('*');
  });

  it('+ [ ] item -> type checklist', () => {
    const result = parseParagraphLine('+ [ ] checklist item', 1, false);
    expect(result.type).toBe('checklist');
    expect(result.hasCheckbox).toBe(true);
    expect(result.marker).toBe('+');
  });

  it('plain * item -> type task when isAsteriskTodo', () => {
    const result = parseParagraphLine('* item', 1, false);
    expect(result.type).toBe('task');
    expect(result.hasCheckbox).toBe(false);
    expect(result.taskStatus).toBe('open');
  });

  it('plain + item -> type checklist', () => {
    const result = parseParagraphLine('+ item', 1, false);
    expect(result.type).toBe('checklist');
    expect(result.hasCheckbox).toBe(false);
  });

  it('- item -> type bullet when isDashTodo is false', () => {
    const result = parseParagraphLine('- item', 1, false);
    expect(result.type).toBe('bullet');
    expect(result.marker).toBe('-');
  });

  it('plain text -> type text', () => {
    const result = parseParagraphLine('just some text', 1, false);
    expect(result.type).toBe('text');
  });

  it('correct indentLevel for tab-indented items', () => {
    const result = parseParagraphLine('\t\t* [ ] nested', 1, false);
    expect(result.indentLevel).toBe(2);
  });

  it('correct indentLevel for space-indented items (2 spaces = 1 level)', () => {
    const result = parseParagraphLine('    * [ ] nested', 1, false);
    expect(result.indentLevel).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// buildParagraphLine
// ---------------------------------------------------------------------------
describe('buildParagraphLine', () => {
  beforeEach(() => {
    vi.mocked(getTaskMarkerConfigCached).mockReturnValue({
      isAsteriskTodo: true,
      isDashTodo: false,
      defaultTodoCharacter: '*',
      useCheckbox: true,
      taskPrefix: '* [ ] ',
    });
  });

  it('title -> # content', () => {
    expect(buildParagraphLine('My Title', 'title')).toBe('# My Title');
  });

  it('heading level 3 -> ### content', () => {
    expect(buildParagraphLine('Section', 'heading', { headingLevel: 3 })).toBe('### Section');
  });

  it('task open with checkbox -> * [ ] content', () => {
    expect(buildParagraphLine('task', 'task', { taskStatus: 'open' })).toBe('* [ ] task');
  });

  it('task done -> * [x] content', () => {
    expect(buildParagraphLine('task', 'task', { taskStatus: 'done' })).toBe('* [x] task');
  });

  it('task without checkbox, open -> * content', () => {
    expect(buildParagraphLine('task', 'task', { hasCheckbox: false, taskStatus: 'open' })).toBe('* task');
  });

  it('checklist -> + [ ] content', () => {
    expect(buildParagraphLine('item', 'checklist', { taskStatus: 'open' })).toBe('+ [ ] item');
  });

  it('bullet -> - content', () => {
    expect(buildParagraphLine('item', 'bullet')).toBe('- item');
  });

  it('quote -> > content', () => {
    expect(buildParagraphLine('quoted', 'quote')).toBe('> quoted');
  });

  it('separator -> ---', () => {
    expect(buildParagraphLine('anything', 'separator')).toBe('---');
  });

  it('empty -> empty string', () => {
    expect(buildParagraphLine('anything', 'empty')).toBe('');
  });

  it('text -> raw content', () => {
    expect(buildParagraphLine('hello world', 'text')).toBe('hello world');
  });

  it('with indentLevel=2 -> tabs prefixed', () => {
    expect(buildParagraphLine('task', 'task', { taskStatus: 'open', indentLevel: 2 })).toBe('\t\t* [ ] task');
  });

  it('with priority=3 -> appends !!!', () => {
    expect(buildParagraphLine('task', 'task', { taskStatus: 'open', priority: 3 })).toBe('* [ ] task !!!');
  });
});

// ---------------------------------------------------------------------------
// updateTaskStatus
// ---------------------------------------------------------------------------
describe('updateTaskStatus', () => {
  it('changes [ ] to [x] for done', () => {
    const content = '# Title\n* [ ] Buy milk';
    const result = updateTaskStatus(content, 1, 'done');
    expect(result).toBe('# Title\n* [x] Buy milk');
  });

  it('changes [x] to [ ] for open', () => {
    const content = '* [x] Done task';
    const result = updateTaskStatus(content, 0, 'open');
    expect(result).toBe('* [ ] Done task');
  });

  it('adds checkbox to plain marker task', () => {
    const content = '* plain task';
    const result = updateTaskStatus(content, 0, 'done');
    expect(result).toBe('* [x] plain task');
  });

  it('throws for invalid lineIndex', () => {
    expect(() => updateTaskStatus('line', 5, 'done')).toThrow('Invalid line index');
  });

  it('throws for non-task line', () => {
    expect(() => updateTaskStatus('just text', 0, 'done')).toThrow('not a task');
  });
});

// ---------------------------------------------------------------------------
// updateTaskContent
// ---------------------------------------------------------------------------
describe('updateTaskContent', () => {
  it('updates content of checkbox task', () => {
    const content = '* [ ] Old content';
    const result = updateTaskContent(content, 0, 'New content');
    expect(result).toBe('* [ ] New content');
  });

  it('updates content of plain marker task', () => {
    const content = '* Old content';
    const result = updateTaskContent(content, 0, 'New content');
    expect(result).toBe('* New content');
  });

  it('throws for invalid lineIndex', () => {
    expect(() => updateTaskContent('line', 5, 'new')).toThrow('Invalid line index');
  });

  it('throws for non-task line', () => {
    expect(() => updateTaskContent('just text', 0, 'new')).toThrow('not a task');
  });
});

// ---------------------------------------------------------------------------
// addTask
// ---------------------------------------------------------------------------
describe('addTask', () => {
  it('adds task at end by default', () => {
    const content = '# Title\nSome text';
    const result = addTask(content, 'New task');
    expect(result).toBe('# Title\nSome text\n* [ ] New task');
  });

  it('adds task at start after frontmatter', () => {
    const content = '---\ntitle: note\n---\n# Title';
    const result = addTask(content, 'New task', 'start');
    expect(result).toBe('---\ntitle: note\n---\n* [ ] New task\n# Title');
  });

  it('adds task after heading', () => {
    const content = '# Title\n## Tasks\nExisting text';
    const result = addTask(content, 'New task', 'after-heading', 'Tasks');
    expect(result).toBe('# Title\n## Tasks\n* [ ] New task\nExisting text');
  });

  it('heading not found -> adds at end', () => {
    const content = '# Title\nSome text';
    const result = addTask(content, 'New task', 'after-heading', 'NonExistent');
    expect(result).toBe('# Title\nSome text\n* [ ] New task');
  });

  it('with status and priority options', () => {
    const content = '# Title';
    const result = addTask(content, 'Important', 'end', undefined, { status: 'open', priority: 3 });
    expect(result).toBe('# Title\n* [ ] Important !!!');
  });
});

// ---------------------------------------------------------------------------
// extractHeadings
// ---------------------------------------------------------------------------
describe('extractHeadings', () => {
  it('extracts ATX headings with levels', () => {
    const content = '# Title\nSome text\n## Section\n### Subsection';
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(3);
    expect(headings[0]).toEqual({ level: 1, text: 'Title', lineIndex: 0 });
    expect(headings[1]).toEqual({ level: 2, text: 'Section', lineIndex: 2 });
    expect(headings[2]).toEqual({ level: 3, text: 'Subsection', lineIndex: 3 });
  });

  it('extracts multiple headings', () => {
    const content = '## A\n## B\n## C';
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(3);
  });

  it('returns empty array when no headings', () => {
    expect(extractHeadings('no headings here\njust text')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filterTasksByStatus
// ---------------------------------------------------------------------------
describe('filterTasksByStatus', () => {
  const tasks: Task[] = [
    { lineIndex: 0, content: 'open', rawLine: '* [ ] open', status: 'open', indentLevel: 0, tags: [], mentions: [] },
    { lineIndex: 1, content: 'done', rawLine: '* [x] done', status: 'done', indentLevel: 0, tags: [], mentions: [] },
    { lineIndex: 2, content: 'cancelled', rawLine: '* [-] cancelled', status: 'cancelled', indentLevel: 0, tags: [], mentions: [] },
  ];

  it('filters by single status', () => {
    const result = filterTasksByStatus(tasks, 'open');
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('open');
  });

  it('filters by array of statuses', () => {
    const result = filterTasksByStatus(tasks, ['open', 'done']);
    expect(result).toHaveLength(2);
  });

  it('no filter returns all', () => {
    const result = filterTasksByStatus(tasks);
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// parseTasks (integration)
// ---------------------------------------------------------------------------
describe('parseTasks', () => {
  beforeEach(() => {
    vi.mocked(getTaskMarkerConfigCached).mockReturnValue({
      isAsteriskTodo: true,
      isDashTodo: false,
      defaultTodoCharacter: '*',
      useCheckbox: true,
      taskPrefix: '* [ ] ',
    });
  });

  it('parses multiple tasks from content', () => {
    const content = '# Title\n* [ ] Task one\nSome text\n* [x] Task two\n- list item';
    const tasks = parseTasks(content);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].content).toBe('Task one');
    expect(tasks[0].status).toBe('open');
    expect(tasks[0].lineIndex).toBe(1);
    expect(tasks[1].content).toBe('Task two');
    expect(tasks[1].status).toBe('done');
    expect(tasks[1].lineIndex).toBe(3);
  });

  it('returns empty array for no tasks', () => {
    expect(parseTasks('# Title\nJust text\n- bullet')).toEqual([]);
  });
});
