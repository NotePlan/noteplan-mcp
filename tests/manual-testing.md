# MCP AI Agent Testing Guide

This file defines test cases for the NotePlan MCP tools. Tests can be run
automatically by an AI agent (e.g. Claude Code) that has the MCP tools loaded.

## Automated Test Procedure

> **Test date:** All tests use the daily note for **2026-02-15** (not today).
> This avoids interfering with the user's real daily note while tests run.

When running these tests, follow this procedure exactly:

1. **Back up the test-date note** — read and store the current content of the 2026-02-15 daily note (if it exists).
2. **Set up fixtures** — replace the 2026-02-15 daily note content with the test fixture below, and create the "MCP Test Note" project note.
3. **Run all tests** — execute every test case sequentially. If a test fails, record the failure and continue to the next test. Do NOT stop on failure.
4. **Tear down** — restore the 2026-02-15 daily note from the backup (or delete it if it didn't exist before), delete any notes created during testing that still exist (e.g. "Weekly Review", "Q1 Goals", "MCP Test Note", "MCP Verified Note").
5. **Report** — write a complete results table into the chat showing pass/fail for each test, with notes on any failures.

### Important

- All references to "today's note" in test cases below mean the **2026-02-15 daily note**. When calling tools, use `date: "2026-02-15"` instead of `date: "today"`.
- Each test that modifies the test-date note should **reset** it to the fixture content before running, so tests are independent.
- Tests 22-24 form a chain (rename → move → delete) and should run in order without resetting the project note between them.
- Test 20 requires a special broken-frontmatter fixture — set it up inline before that test.

---

## Test Fixtures

### Test-date daily note (2026-02-15)

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
> Add a demo task "Buy groceries" at the top of the Tasks section in the 2026-02-15 daily note

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `add`)
- "Buy groceries" appears as the FIRST item under `## Tasks`, BEFORE "Existing task 1"
- Task marker matches user config (e.g. `* Buy groceries`, not `* [ ] Buy groceries`)
- No raw markdown written — tool uses auto-formatting

**Verify:** Read the 2026-02-15 daily note. The line immediately after `## Tasks` should be `* Buy groceries`.

---

### 2. Add task at BOTTOM of a heading section

**Prompt:**
> Add a task "Review PR" at the end of the NotePlan section in the 2026-02-15 daily note

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `add`)
- "Review PR" appears as the LAST item under `## NotePlan`, BEFORE `## Journal`
- Does NOT appear at the very bottom of the note

**Verify:** Read the 2026-02-15 daily note. "Review PR" should be between "Existing NP item" and `## Journal`.

---

### 3. Add task to the 2026-02-15 daily note (default — bottom of note)

**Prompt:**
> Add a task "End of day review" to the 2026-02-15 daily note

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `add`)
- "End of day review" appears at the bottom of the note
- Task marker matches user config

**Verify:** Read the 2026-02-15 daily note. Last line should contain "End of day review".

---

### 4. Add task at the very top of the 2026-02-15 daily note (after frontmatter)

**Prompt:**
> Add a task "Morning standup" at the very start of the 2026-02-15 daily note

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `add`) with position: `start`
- "Morning standup" appears right after the `---` frontmatter closer, BEFORE `# Daily Note`

**Verify:** Read the 2026-02-15 daily note. First content line after frontmatter should be the task.

---

### 5. Insert text content after a heading

**Prompt:**
> Add the text "Focus: ship MCP fixes" right under the Journal heading in the 2026-02-15 daily note

**Expected outcome:**
- Tool used: `noteplan_edit_content` (action: `insert`, position: `after-heading`, heading: `Journal`)
- Text appears as the first line after `## Journal`, before "Had a good morning."

**Verify:** Read the 2026-02-15 daily note. Line after `## Journal` should be "Focus: ship MCP fixes".

---

### 6. Append content at end of a section

**Prompt:**
> Append "Wrapped up testing" at the end of the Journal section in the 2026-02-15 daily note

**Expected outcome:**
- Tool used: `noteplan_edit_content` (action: `append` or `insert` with position: `end`/`in-section`, heading: `Journal`)
- Text appears at the end of the Journal section
- Since `## Journal` is the last heading, the section extends to the end of the note (thematic breaks `---` and text below them are part of the section, not a boundary)

**Verify:** Read the 2026-02-15 daily note. "Wrapped up testing" should be the last line of the note.

---

### 7. Append content to end of note (no heading)

**Prompt:**
> Append "-- End of notes --" to the 2026-02-15 daily note

**Expected outcome:**
- Tool used: `noteplan_edit_content` (action: `append`)
- Text appears at the very bottom of the note

**Verify:** Read the 2026-02-15 daily note. Last line should be "-- End of notes --".

---

### 8. Insert at a specific line number

**Prompt:**
> Insert the text "IMPORTANT NOTICE" at line 5 of the 2026-02-15 daily note

**Expected outcome:**
- Tool used: `noteplan_edit_content` (action: `insert`, position: `at-line`, line: 5)
- Text appears at line 5, pushing existing content down

**Verify:** Read the 2026-02-15 daily note. Line 5 (1-indexed, after frontmatter) should be "IMPORTANT NOTICE".

---

### 9. Edit a specific line

**Prompt:**
> Change line 1 of the 2026-02-15 daily note to "# Updated Title"

**Expected outcome:**
- Tool used: `noteplan_edit_content` (action: `edit_line`, line: 1)
- The first line (after frontmatter) changes to "# Updated Title"

**Verify:** Read the 2026-02-15 daily note. First content line should be "# Updated Title".

---

### 10. Delete lines from a note

**Prompt:**
> Delete lines 6 through 8 from the 2026-02-15 daily note

**Expected outcome:**
- Tool used: `noteplan_edit_content` (action: `delete_lines`)
- Should first do a dryRun showing what will be deleted
- After confirmation, those lines are removed

**Verify:** Read the 2026-02-15 daily note. The lines that were at positions 6-8 should be gone.

---

### 11. Complete a task

**Prompt:**
> Mark the task "Existing task 1" as done in the 2026-02-15 daily note

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `complete`)
- "Existing task 1" gets marked as done (checkbox changes to `[x]` or marker changes)

**Verify:** Read the 2026-02-15 daily note. Task should show as completed.

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

### 16. Get the test-date note

**Prompt:**
> Show me the 2026-02-15 daily note

**Expected outcome:**
- Tool used: `noteplan_get_notes` (date: `2026-02-15`, includeContent: true)
- Returns the full content of the 2026-02-15 daily note

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
> Add a task "Submit report" to the 2026-02-15 daily note under Tasks, scheduled for tomorrow

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `add`, scheduleDate: tomorrow's date)
- Task content includes `>YYYY-MM-DD` with tomorrow's date
- Task is under the Tasks heading

**Verify:** Read the 2026-02-15 daily note. Task under Tasks should contain tomorrow's date.

---

### 19. Add a task with priority

**Prompt:**
> Add a high-priority task "Fix critical bug" to the 2026-02-15 daily note under Tasks

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `add`, priority: 3)
- Task includes `!!!` priority marker
- Task is under the Tasks heading

**Verify:** Read the 2026-02-15 daily note. Task under Tasks should contain `!!!`.

---

### 20. Broken frontmatter resilience

**Setup:** Before this test, replace the 2026-02-15 daily note content with a version where the closing `---` of frontmatter is removed, but a thematic break `---` remains later in the note.

**Prompt:**
> Add a task "Resilience test" at the start of the 2026-02-15 daily note

**Expected outcome:**
- Tool used: `noteplan_paragraphs` (action: `add`, position: `start`)
- Task appears at the very top of the note (since frontmatter is broken/unclosed)
- Does NOT appear after the thematic break `---` deeper in the note

**Verify:** Read the 2026-02-15 daily note. Task should be at the top, not misplaced after the thematic break.

---

### 21. Multiple tasks in one request

**Prompt:**
> Add these tasks to the 2026-02-15 daily note under Tasks: "Write docs", "Run tests", "Deploy to staging"

**Expected outcome:**
- All three tasks appear under `## Tasks`
- Each is a separate task with proper formatting
- Order matches the request

**Verify:** Read the 2026-02-15 daily note. All three tasks present under Tasks heading in order.

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

### Test 25: Wildcard search with propertyFilters

**Tool:** `noteplan_search`

**Setup:** Ensure at least one note has frontmatter `type: book` and at least one note does NOT.

**Call:**
```json
{ "action": "search", "query": "*", "propertyFilters": { "type": "book" } }
```

**Verify:** Only notes with `type: book` in frontmatter are returned. Notes without that property are excluded.

---

### Test 26: Global paragraph search matching frontmatter content

**Tool:** `noteplan_paragraphs`

**Setup:** Ensure at least one note has frontmatter containing `type: book`.

**Call:**
```json
{ "action": "search_global", "query": "type: book" }
```

**Verify:** Results include matches from frontmatter lines (e.g., `type: book`). The search is not limited to task lines only.

---

### Test 27: Update task — content with marker is not duplicated

**Tool:** `noteplan_paragraphs`

**Setup:** Ensure the 2026-02-15 daily note has the fixture content with `* Existing task 1` under `## Tasks`.

**Call (step 1 — add a checkbox task):**
```json
{ "action": "add", "content": "Marker test task", "heading": "Tasks", "date": "2026-02-15" }
```

**Call (step 2 — update it with content that includes a marker):**
```json
{ "action": "update", "content": "- [ ] Marker test updated", "lineIndex": "<line of task>", "date": "2026-02-15" }
```

**Verify:** Read the 2026-02-15 daily note. The task should be a single `* Marker test updated` (or `* [ ] Marker test updated` depending on config) — NOT `* [ ] - [ ] Marker test updated` or any double-marker variant.

---

### Test 28: Update task — content with different marker style is stripped

**Tool:** `noteplan_paragraphs`

**Setup:** Ensure the 2026-02-15 daily note has a task line like `- [ ] Some task` (dash-style).

**Call:**
```json
{ "action": "update", "content": "* [ ] Changed text", "lineIndex": "<line of task>", "date": "2026-02-15" }
```

**Verify:** The result should be `- [ ] Changed text` — preserving the original dash marker, NOT `- [ ] * [ ] Changed text`.

---

### Test 29: Update task — clean content (no marker) still works

**Tool:** `noteplan_paragraphs`

**Setup:** Ensure the 2026-02-15 daily note has a task under `## Tasks`.

**Call:**
```json
{ "action": "update", "content": "Clean content no markers", "lineIndex": "<line of task>", "date": "2026-02-15" }
```

**Verify:** Task text is updated to "Clean content no markers" with its original marker preserved.

---

### Test 30: Update task — completed marker in content is stripped

**Tool:** `noteplan_paragraphs`

**Setup:** Ensure the 2026-02-15 daily note has an open task `* [ ] Some task`.

**Call:**
```json
{ "action": "update", "content": "- [x] Should not duplicate", "lineIndex": "<line of task>", "date": "2026-02-15" }
```

**Verify:** The result should be `* [ ] Should not duplicate` — the `- [x]` from the content is stripped, and the original `* [ ]` open status is preserved.

---

### Test 31: Edit line with raw task marker does not double-format

**Tool:** `noteplan_edit_content`

**Setup:** Ensure the 2026-02-15 daily note has a task `* Existing task 1` at a known line.

**Call:**
```json
{ "action": "edit_line", "line": "<line number>", "content": "* [ ] Rewritten task", "date": "2026-02-15" }
```

**Verify:** The line should be exactly `* [ ] Rewritten task` — a straight replacement. Note: `edit_line` does raw line replacement, so the full line content is expected. This test confirms no extra formatting is applied on top.

---

### Test 32: Retrieve note using id from search results

**Tool:** `noteplan_search`, then `noteplan_get_notes`

**Setup:** Ensure at least one project note exists (e.g. "MCP Test Note").

**Call (step 1 — search):**
```json
{ "action": "search", "query": "MCP Test Note", "searchField": "title" }
```

**Call (step 2 — fetch by id):**
Take the `id` field from the first search result and pass it to `noteplan_get_notes`:
```json
{ "action": "get", "id": "<id from search result>" }
```

**Verify:** The note is returned successfully (not ERR_NOT_FOUND). Content matches the original note. This confirms the id/filename round-trip works for both local and space notes.

---

### Test 33: Search with colon in query

**Tool:** `noteplan_search`

**Setup:** Ensure at least one note has `type: book` in its frontmatter or content.

**Call:**
```json
{ "action": "search", "query": "type: book", "queryMode": "phrase" }
```

**Verify:** Results include notes containing the literal text `type: book`. The colon in the query does not cause an error or empty results.

---

### Test 34: Property-only search with round-trip fetch

**Tool:** `noteplan_search`, then `noteplan_get_notes`

**Setup:** Ensure at least one note has frontmatter `type: book`.

**Call (step 1 — search with wildcard + propertyFilters):**
```json
{ "action": "search", "query": "*", "propertyFilters": { "type": "book" } }
```

**Call (step 2 — fetch one result by id):**
Take the `id` from the first result and fetch it:
```json
{ "action": "get", "id": "<id from search result>" }
```

**Verify:** Step 1 returns only notes with `type: book` in frontmatter. Step 2 successfully returns the full note content using the `id` from step 1 (not ERR_NOT_FOUND).

---

### Test 35: Complete task using `date` parameter (no filename resolution needed)

**Tool:** `noteplan_paragraphs`

**Setup:** Ensure the 2026-02-15 daily note has the fixture content with `* Existing task 1` under `## Tasks`.

**Call:**
```json
{ "action": "complete", "date": "2026-02-15", "taskQuery": "Existing task 1" }
```

**Verify:** Task is completed successfully using `date` + `taskQuery` without needing to resolve the filename or line number first. The response should include `success: true`.

---

### Test 36: Complete task using `taskQuery` (find by text)

**Tool:** `noteplan_paragraphs`

**Setup:** Ensure the 2026-02-15 daily note has the fixture content with `* Existing task 2` under `## Tasks`.

**Call:**
```json
{ "action": "complete", "date": "2026-02-15", "taskQuery": "Existing task 2" }
```

**Verify:** "Existing task 2" is marked as done. No lineIndex or line was needed — the task was found by content text.

---

### Test 37: Update task using `date` parameter

**Tool:** `noteplan_paragraphs`

**Setup:** Ensure the 2026-02-15 daily note has the fixture content with tasks under `## Tasks`. First call `noteplan_paragraphs(action: "get", date: "2026-02-15")` to discover the actual lineIndex of "Existing task 1".

**Call:**
```json
{ "action": "update", "date": "2026-02-15", "lineIndex": "<lineIndex from get>", "content": "Updated via date param" }
```

**Verify:** Task content is updated successfully using `date` instead of `filename`. Note: use the lineIndex from the `get` call — line numbers are absolute and include frontmatter.

---

### Test 38: Set frontmatter property using `title` parameter

**Tool:** `noteplan_manage_note`

**Setup:** Ensure "MCP Test Note" exists in root folder.

**Call:**
```json
{ "action": "set_property", "title": "MCP Test Note", "key": "status", "value": "tested" }
```

**Verify:** Property is set successfully without needing to resolve the filename first. Read the note and confirm `status: tested` appears in frontmatter.

---

### Test 39: Set frontmatter property using `date` parameter

**Tool:** `noteplan_manage_note`

**Setup:** Ensure the 2026-02-15 daily note exists.

**Call:**
```json
{ "action": "set_property", "date": "2026-02-15", "key": "test-run", "value": "true" }
```

**Verify:** Property `test-run: true` is set on the 2026-02-15 daily note. No filename resolution needed.

---

### Test 40: Remove frontmatter property using `title` parameter

**Tool:** `noteplan_manage_note`

**Setup:** Ensure "MCP Test Note" has `status: tested` from Test 38.

**Call:**
```json
{ "action": "remove_property", "title": "MCP Test Note", "key": "status" }
```

**Verify:** The `status` property is removed from "MCP Test Note" without needing filename resolution.

---

### Test 41: Get paragraphs using `date` parameter

**Tool:** `noteplan_paragraphs`

**Setup:** Ensure the 2026-02-15 daily note has the fixture content.

**Call:**
```json
{ "action": "get", "date": "2026-02-15" }
```

**Verify:** Returns paragraph data for the 2026-02-15 daily note without needing to resolve the filename first. Each line should include lineIndex, content, and type metadata.

---

### Test 42: Move a note using `title` parameter

**Tool:** `noteplan_manage_note`

**Setup:** Ensure "MCP Verified Note" exists (renamed from "MCP Test Note" in test 22).

**Call (dryRun):**
```json
{ "action": "move", "title": "MCP Verified Note", "destinationFolder": "@Archive", "dryRun": true }
```

**Call (confirm):**
```json
{ "action": "move", "title": "MCP Verified Note", "destinationFolder": "@Archive", "confirmationToken": "<token from dryRun>" }
```

**Verify:** Note is moved to @Archive using `title` instead of `filename`. No filename resolution step needed.

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
| 16 | Get the test-date note | | |
| 17 | Search by title | | |
| 18 | Task with scheduled date | | |
| 19 | Task with priority | | |
| 20 | Broken frontmatter resilience | | |
| 21 | Multiple tasks | | |
| 22 | Rename a note | | |
| 23 | Move a note | | |
| 24 | Delete a note | | |
| 25 | Wildcard search with propertyFilters | | |
| 26 | Global paragraph search matching frontmatter | | |
| 27 | Update task — marker not duplicated | | |
| 28 | Update task — different marker style stripped | | |
| 29 | Update task — clean content works | | |
| 30 | Update task — completed marker stripped | | |
| 31 | Edit line — no double formatting | | |
| 32 | Retrieve note using id from search | | |
| 33 | Search with colon in query | | |
| 34 | Property-only search with round-trip fetch | | |
| 35 | Complete task using `date` param | | |
| 36 | Complete task using `taskQuery` | | |
| 37 | Update task using `date` param | | |
| 38 | Set property using `title` param | | |
| 39 | Set property using `date` param | | |
| 40 | Remove property using `title` param | | |
| 41 | Get paragraphs using `date` param | | |
| 42 | Move note using `title` param | | |
