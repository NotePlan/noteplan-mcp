// NotePlan Types

export type NoteType = 'calendar' | 'note' | 'trash';
export type NoteSource = 'local' | 'teamspace';

export type TaskStatus = 'open' | 'done' | 'cancelled' | 'scheduled';

export interface Note {
  id: string;
  title: string;
  filename: string;
  content: string;
  type: NoteType;
  source: NoteSource;
  teamspaceId?: string;
  teamspaceName?: string;
  folder?: string;
  date?: string; // For calendar notes: YYYYMMDD or YYYY-Www
  modifiedAt?: Date;
  createdAt?: Date;
}

export interface Task {
  lineIndex: number;
  content: string;
  rawLine: string;
  status: TaskStatus;
  indentLevel: number;
  hasCheckbox?: boolean; // Whether task has [ ] checkbox style
  marker?: '*' | '-' | '+'; // The marker character used
  tags: string[];
  mentions: string[];
  scheduledDate?: string;
  priority?: number;
}

export interface Teamspace {
  id: string;
  name: string;
  noteCount: number;
}

export interface SearchResult {
  note: Note;
  matches: SearchMatch[];
  score: number;
}

export interface SearchMatch {
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

export interface Folder {
  path: string;
  name: string;
  source: NoteSource;
  teamspaceId?: string;
}

// SQLite row types
export interface SQLiteNoteRow {
  id: string;
  content: string;
  note_type: number;
  title: string;
  filename: string;
  parent: string | null;
  is_dir: number;
  created_at?: string;
  updated_at?: string;
}

// Note type constants from SQLite
export const SQLITE_NOTE_TYPES = {
  TEAMSPACE: 10,
  TEAMSPACE_NOTE: 11,
  TEAMSPACE_CALENDAR: 12,
} as const;

// Task markers
export const TASK_MARKERS = {
  OPEN: '* [ ]',
  DONE: '* [x]',
  CANCELLED: '* [-]',
  SCHEDULED: '* [>]',
  CHECKLIST_OPEN: '+ [ ]',
  CHECKLIST_DONE: '+ [x]',
} as const;

export const TASK_STATUS_MAP: Record<string, TaskStatus> = {
  '[ ]': 'open',
  '[x]': 'done',
  '[-]': 'cancelled',
  '[>]': 'scheduled',
};

export const STATUS_TO_MARKER: Record<TaskStatus, string> = {
  'open': '[ ]',
  'done': '[x]',
  'cancelled': '[-]',
  'scheduled': '[>]',
};
