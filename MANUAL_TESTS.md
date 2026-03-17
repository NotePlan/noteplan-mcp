# Manual Tests

## Recurring Task Deletion (`delete_recurring`)

### Setup
1. Create a daily note for today with a recurring task:
   ```
   noteplan_paragraphs(action: "add", target: "today", content: "Buy groceries @repeat(1/5)")
   ```
2. Create 4 more daily notes for the next days with the same task (incrementing repeat count):
   ```
   noteplan_paragraphs(action: "add", target: "tomorrow", content: "Buy groceries @repeat(2/5)")
   ```
   Repeat for the next 3 days with `@repeat(3/5)`, `@repeat(4/5)`, `@repeat(5/5)`.

### Test 1: Delete recurring task and all future occurrences
1. Call `noteplan_paragraphs(action: "delete_recurring", date: "today", taskQuery: "Buy groceries")`
2. Verify:
   - [ ] The task is removed from today's note
   - [ ] The task is removed from all future daily notes (tomorrow through day 5)
   - [ ] Other content in those notes is preserved
   - [ ] Response shows `deletedFutureCount` matching the number of future notes affected
   - [ ] Response lists `affectedNotes` with the correct filenames

### Test 2: Delete recurring task but keep source
1. Re-create the setup above
2. Call `noteplan_paragraphs(action: "delete_recurring", date: "today", taskQuery: "Buy groceries", deleteSource: false)`
3. Verify:
   - [ ] The task remains in today's note
   - [ ] The task is removed from all future daily notes
   - [ ] `sourceDeleted` is `false` in the response

### Test 3: Non-recurring task rejection
1. Add a normal task without `@repeat`: `noteplan_paragraphs(action: "add", target: "today", content: "Normal task")`
2. Call `noteplan_paragraphs(action: "delete_recurring", date: "today", taskQuery: "Normal task")`
3. Verify:
   - [ ] Returns `success: false`
   - [ ] Error message says task does not contain `@repeat`

### Test 4: delete_lines dryRun asks user about recurring tasks
1. Create a daily note with a recurring task
2. Get the line number of the task using `noteplan_paragraphs(action: "get", date: "today")`
3. Call `noteplan_edit_content(action: "delete_lines", date: "today", startLine: <line>, endLine: <line>, dryRun: true)`
4. Verify:
   - [ ] Response includes `hasRecurringTasks: true`
   - [ ] Response includes `recurringTaskLines` listing the line number(s)
   - [ ] Warning presents the user with two choices:
     - (1) Delete only this occurrence (confirm the delete_lines)
     - (2) Delete this and all future occurrences (use `delete_recurring`)
   - [ ] The AI asks the user which option they want before proceeding

### Test 5: Empty note cleanup after deletion
1. Create a future daily note that ONLY contains a recurring task line
2. Delete the recurring task from a prior note
3. Verify:
   - [ ] The future note that became empty is cleaned up (deleted/trashed)
