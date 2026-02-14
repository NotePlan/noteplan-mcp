# MCP AI Agent Testing Guide

This file defines test cases for the NotePlan MCP tools. Tests can be run
automatically by an AI agent (e.g. Claude Code) that has the MCP tools loaded.

## Automated Test Procedure

When running these tests, follow this procedure exactly:

1. **Back up today's note** — read and store the current content of today's daily note.
2. **Set up fixtures** — replace today's note content with the test fixture below, and create the "MCP Test Note" project note.
3. **Run all tests** — execute every test case sequentially. If a test fails, record the failure and continue to the next test. Do NOT stop on failure.
4. **Tear down** — restore today's note from the backup, delete any notes created during testing that still exist (e.g. "Weekly Review", "Q1 Goals", "MCP Test Note", "MCP Verified Note").
5. **Report** — write a complete results table into the chat showing pass/fail for each test, with notes on any failures.

### Important

- Each test that modifies today's note should **reset** the note to the fixture content before running, so tests are independent.
- Tests 22-24 form a chain (rename → move → delete) and should run in order without resetting the project note between them.
- Test 20 requires a special broken-frontmatter fixture — set it up inline before that test.

---

## Test Fixtures

### Today's daily note

```
---
bg-color: amber-50
---
# Daily Note

## Tasks
* Existing task 1
* Existing task 2

## NotePlan
* Existing NP item

## Journal
Had a good morning.

---

Some notes at the bottom.
```

### Project note: "MCP Test Note" (root folder)

```
# MCP Test Note

## Ideas
- Idea 1
- Idea 2

## Done
- Completed item
```

---

## Test Cases

### 1. Add task at TOP of a heading section

**Prompt:**
> Add a demo task "Buy groceries" at the top of the Tasks section in today's note

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `add`)
- "Buy groceries" appears as the FIRST item under `## Tasks`, BEFORE "Existing task 1"
- Task marker matches user config (e.g. `* Buy groceries`, not `* [ ] Buy groceries`)
- No raw markdown written — tool uses auto-formatting

**Verify:** Read today's note. The line immediately after `## Tasks` should be `* Buy groceries`.

---

### 2. Add task at BOTTOM of a heading section

**Prompt:**
> Add a task "Review PR" at the end of the NotePlan section in today's note

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `add`)
- "Review PR" appears as the LAST item under `## NotePlan`, BEFORE `## Journal`
- Does NOT appear at the very bottom of the note

**Verify:** Read today's note. "Review PR" should be between "Existing NP item" and `## Journal`.

---

### 3. Add task to today's note (default — bottom of note)

**Prompt:**
> Add a task "End of day review" to today's note

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `add`)
- "End of day review" appears at the bottom of the note
- Task marker matches user config

**Verify:** Read today's note. Last line should contain "End of day review".

---

### 4. Add task at the very top of today's note (after frontmatter)

**Prompt:**
> Add a task "Morning standup" at the very start of today's note

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `add`) with position: `start`
- "Morning standup" appears right after the `---` frontmatter closer, BEFORE `# Daily Note`

**Verify:** Read today's note. First content line after frontmatter should be the task.

---

### 5. Insert text content after a heading

**Prompt:**
> Add the text "Focus: ship MCP fixes" right under the Journal heading in today's note

**Expected outcome:**
- Tool used: `noteplan_edit_content` (action: `insert`, position: `after-heading`, heading: `Journal`)
- Text appears as the first line after `## Journal`, before "Had a good morning."

**Verify:** Read today's note. Line after `## Journal` should be "Focus: ship MCP fixes".

---

### 6. Append content at end of a section

**Prompt:**
> Append "Wrapped up testing" at the end of the Journal section in today's note

**Expected outcome:**
- Tool used: `noteplan_edit_content` (action: `append` or `insert` with position: `end`/`in-section`, heading: `Journal`)
- Text appears at the end of the Journal section
- Since `## Journal` is the last heading, the section extends to the end of the note (thematic breaks `---` and text below them are part of the section, not a boundary)

**Verify:** Read today's note. "Wrapped up testing" should be the last line of the note.

---

### 7. Append content to end of note (no heading)

**Prompt:**
> Append "-- End of notes --" to today's note

**Expected outcome:**
- Tool used: `noteplan_edit_content` (action: `append`)
- Text appears at the very bottom of the note

**Verify:** Read today's note. Last line should be "-- End of notes --".

---

### 8. Insert at a specific line number

**Prompt:**
> Insert the text "IMPORTANT NOTICE" at line 5 of today's note

**Expected outcome:**
- Tool used: `noteplan_edit_content` (action: `insert`, position: `at-line`, line: 5)
- Text appears at line 5, pushing existing content down

**Verify:** Read today's note. Line 5 (1-indexed, after frontmatter) should be "IMPORTANT NOTICE".

---

### 9. Edit a specific line

**Prompt:**
> Change line 1 of today's note to "# Updated Title"

**Expected outcome:**
- Tool used: `noteplan_edit_content` (action: `edit_line`, line: 1)
- The first line (after frontmatter) changes to "# Updated Title"

**Verify:** Read today's note. First content line should be "# Updated Title".

---

### 10. Delete lines from a note

**Prompt:**
> Delete lines 6 through 8 from today's note

**Expected outcome:**
- Tool used: `noteplan_edit_content` (action: `delete_lines`)
- Should first do a dryRun showing what will be deleted
- After confirmation, those lines are removed

**Verify:** Read today's note. The lines that were at positions 6-8 should be gone.

---

### 11. Complete a task

**Prompt:**
> Mark the task "Existing task 1" as done in today's note

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `complete`)
- "Existing task 1" gets marked as done (checkbox changes to `[x]` or marker changes)

**Verify:** Read today's note. Task should show as completed.

---

### 12. Create a new project note

**Prompt:**
> Create a new note called "Weekly Review" with the content "# Weekly Review\n\n## Wins\n\n## Improvements"

**Expected outcome:**
- Tool used: `noteplan_manage_note` (action: `create`)
- A new note titled "Weekly Review" appears in the root folder
- Content has the heading and two sections

**Verify:** Search for "Weekly Review" and confirm it exists with correct content.

---

### 13. Create a note in a specific folder

**Prompt:**
> Create a note called "Q1 Goals" in the Projects folder

**Expected outcome:**
- Tool used: `noteplan_manage_note` (action: `create`, folder: `Projects`)
- Note appears in the Projects folder

**Verify:** Search for "Q1 Goals" and confirm it's in the Projects folder.

---

### 14. Set a frontmatter property

**Prompt:**
> Set the frontmatter property "status" to "in-progress" on the note "MCP Test Note"

**Expected outcome:**
- Tool used: `noteplan_manage_note` (action: `set_property`, key: `status`, value: `in-progress`)
- The note's frontmatter now contains `status: in-progress`

**Verify:** Read the note content and check frontmatter contains `status: in-progress`.

---

### 15. Remove a frontmatter property

**Prompt:**
> Remove the "status" property from "MCP Test Note"

**Expected outcome:**
- Tool used: `noteplan_manage_note` (action: `remove_property`)
- The `status` field is gone from frontmatter

**Verify:** Read the note content and confirm `status` is no longer in frontmatter.

---

### 16. Get today's note

**Prompt:**
> Show me today's note

**Expected outcome:**
- Tool used: `noteplan_get_notes` (date: `today`, includeContent: true)
- Returns the full content of today's daily note

**Verify:** Returned content matches the fixture.

---

### 17. Search for a note by title

**Prompt:**
> Find the note called "MCP Test Note"

**Expected outcome:**
- Tool used: `noteplan_search` or `noteplan_get_notes` (title: `MCP Test Note`)
- Returns the note with its content

**Verify:** Content matches the test note fixture.

---

### 18. Add a task with a scheduled date

**Prompt:**
> Add a task "Submit report" to today's note under Tasks, scheduled for tomorrow

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `add`, scheduleDate: tomorrow's date)
- Task content includes `>YYYY-MM-DD` with tomorrow's date
- Task is under the Tasks heading

**Verify:** Read today's note. Task under Tasks should contain tomorrow's date.

---

### 19. Add a task with priority

**Prompt:**
> Add a high-priority task "Fix critical bug" to today's note under Tasks

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `add`, priority: 3)
- Task includes `!!!` priority marker
- Task is under the Tasks heading

**Verify:** Read today's note. Task under Tasks should contain `!!!`.

---

### 20. Broken frontmatter resilience

**Setup:** Before this test, replace today's note content with a version where the closing `---` of frontmatter is removed, but a thematic break `---` remains later in the note.

**Prompt:**
> Add a task "Resilience test" at the start of today's note

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `add`, position: `start`)
- Task appears at the very top of the note (since frontmatter is broken/unclosed)
- Does NOT appear after the thematic break `---` deeper in the note

**Verify:** Read today's note. Task should be at the top, not misplaced after the thematic break.

---

### 21. Multiple tasks in one request

**Prompt:**
> Add these tasks to today's note under Tasks: "Write docs", "Run tests", "Deploy to staging"

**Expected outcome:**
- All three tasks appear under `## Tasks`
- Each is a separate task with proper formatting
- Order matches the request

**Verify:** Read today's note. All three tasks present under Tasks heading in order.

---

### 22. Rename a note

**Prompt:**
> Rename the note "MCP Test Note" to "MCP Verified Note"

**Expected outcome:**
- Tool used: `noteplan_manage_note` (action: `rename`)
- Should do a dryRun first, then execute with confirmationToken
- The note's filename/title changes

**Verify:** Search for "MCP Verified Note" — it should exist. "MCP Test Note" should not.

---

### 23. Move a note to a different folder

**Prompt:**
> Move "MCP Verified Note" to the Archive folder

**Expected outcome:**
- Tool used: `noteplan_manage_note` (action: `move`)
- Should do a dryRun first
- Note moves to the @Archive folder

**Verify:** Search for the note — it should be in @Archive.

---

### 24. Delete a note

**Prompt:**
> Delete the note "MCP Verified Note"

**Expected outcome:**
- Tool used: `noteplan_manage_note` (action: `delete`)
- Should do a dryRun first showing what will be deleted
- Note moves to @Trash

**Verify:** Note should no longer appear in normal search results.

---

## Results Tracker

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | Task at top of heading | | |
| 2 | Task at bottom of heading | | |
| 3 | Task at bottom of note | | |
| 4 | Task at start of note | | |
| 5 | Insert after heading | | |
| 6 | Append at end of section | | |
| 7 | Append at end of note | | |
| 8 | Insert at line number | | |
| 9 | Edit a line | | |
| 10 | Delete lines | | |
| 11 | Complete a task | | |
| 12 | Create project note | | |
| 13 | Create note in folder | | |
| 14 | Set frontmatter property | | |
| 15 | Remove frontmatter property | | |
| 16 | Get today's note | | |
| 17 | Search by title | | |
| 18 | Task with scheduled date | | |
| 19 | Task with priority | | |
| 20 | Broken frontmatter resilience | | |
| 21 | Multiple tasks | | |
| 22 | Rename a note | | |
| 23 | Move a note | | |
| 24 | Delete a note | | |
