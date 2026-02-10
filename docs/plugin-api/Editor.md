NotePlans JavaScript API - Editor

<details>
<summary>API - Window Management</summary>
<p>
  
```javascript
// You can use `NotePlan.editors` to enumerate all editors.

/**
 * Get a unique ID for the editor to make it easier to identify it later
 * @type { String }
 */
.id

/**
 * Set / get a custom identifier, so you don't need to cache the unique id. 
 * If you are accessing this editor from the enumerator, you can set it like this: `NotePlan.editors[0].customId = "test"`
 * @type { String }
 */
.customId

/**
 * Type of window where the editor is embedded in. 
 * Possible values: main|split|floating|unsupported
 * It's unsupported on iOS at the moment.
 * @type { String }
 */
.windowType 

/**
 * Get the cursor into a specific editor and send the window to the front.
 */
.focus()

/**
 * Close the split view or window. If it's the main note, it will close the complete main window.
 */
.close()
  
  
/**
 * Set / get the position and size of the window that contains the editor. Returns an object with x, y, width, height values.
 * If you want to change the coordinates or size, save the rect in a variable, modify the variable, then assign it to windowRect. 
 * The position of the window might not be very intuitive, because the coordinate system of the screen works differently (starts at the bottom left for example). Recommended is to adjust the size and position of the window relatively to it's values or other windows.
 *
 * This works also by enumerating windows with NotePlan.editors and NotePlan.htmlWindows.
 *
 * Note this is available with v3.9.1
 * Example:
 *
 * const rect = Editor.windowRect
 * rect.height -= 50
 * Editor.windowRect = rect
 *
 * @type { x: Integer, y: Integer, width: Integer, height: Integer }
 */
.windowRect

 ```
</p>
</details>

<details>
<summary>API - Variables</summary>
<p>
  
  ```javascript
  
Editor

/**
 * Get the note object of the opened note in the editor
 * @type {NoteObject}
 */
.note

/**
 * Get or set the markdown text of the note (will be saved to file directly)
 * Contains also the raw frontmatter.
 * @type {String}
 */
.content

/**
 * Get title of the note (first line)
 * @type {String}
 */
.title

/**
 * Get the type of the note (indicates also where it is saved)
 * @type {"Notes" | "Calendar"}
 */
.type 		 

/**
 * Get the filename of the note. This includes the relative folder. So if the note is in the folder "Test". The filename will be `test/filename.txt` for example.
 * @type {String}
 */
.filename 

/**
 * Get or set the array of paragraphs contained in this note, such as tasks, bullets, etc. If you set the paragraphs, the content of the note will be updated.
 * Contains also the raw frontmatter (the paragraphs have accordingly ranges that are with frontmatter text offset, as opposed to the selection functions, which don't respect the frontmatter offset).
 * @type {[ParagraphObject]}
 */
.paragraphs

/**
 * Get an array of selected lines. The cursor doesn't have to select the full line, NotePlan returns all complete lines the cursor "touches".
 * Any frontmatter at the very top of the note is ignored. That means line 0 is the first line of the actual note body.
 * @type {[String]}
 */
.selectedLinesText

/**
 * Get an array of selected paragraphs. The cursor doesn't have to select the full paragraph, NotePlan returns all complete paragraphs the cursor "touches"
 * Any frontmatter at the very top of the note is ignored. That means line 0 is the first line of the actual note body. The paragraph ranges reflect this as well and will yield different results than the .paragraphs function, which includes the frontmatter into it's calculations.
 * @type {[ParagraphObject]}
 */
.selectedParagraphs

/**
 * Get the raw selection range (hidden Markdown is considered).
 * Any frontmatter at the very top of the note is ignored. That means line 0 is the first line of the actual note body.
 * @type {RangeObject}
 */
.selection

/**
 * Get the rendered selection range (hidden Markdown is NOT considered).
 * Any frontmatter at the very top of the note is ignored. That means line 0 is the first line of the actual note body.
 * @type {RangeObject}
 */
.renderedSelection

/**
 * Get the selected text.
 * Any frontmatter at the very top of the note is ignored. That means line 0 is the first line of the actual note body.
 * @type {String}
 */
.selectedText
  
 /**
  * Returns the frontmatter key-value pairs inside the note. To set a frontmatter attribute, use setFrontmatterAttribute or 
  updateFrontmatterAttributes.
  * You can also use the setter, but you will need to first read the complete frontmatter object (key-value pairs), change it and then 
  set it. Otherwise the setter won't be triggered if you set it directly like frontmatterAttributes["key"] = "value" (this won't work). 
  The setter is most useful when you want to replace all frontmatter attributes at once.
  * { get set }
  * @type {{[key: string]: string}}
  * Available from v3.16.3
  */
  .frontmatterAttributes

/**
* Returns all types assigned to this note in the frontmatter as an array of strings. 
* You can assign types to a note with frontmatter using `type: meeting-note, empty-note` for example (comma separated).
* { get }
* @type {[String]}
* Available from v3.16.3
*/
.frontmatterTypes
  
/**
 * Note: Available from NotePlan v3.6.2+
 * Get all supported themes (including custom themes imported into the Theme folder) as an array of theme objects having four keys: "name" (name of the theme as seen in the json file), "mode" (dark or light), "filename" (original filename with "json" as extension) and "values" (parsed json file of the theme as object, so you can access every value like `Editor.availableThemes[0].values["styles"]["body"]["color"]`)
 *
 * Use together with `.setTheme(theme.name)`
 * @type [
 *   {
 *      name: String, 
 *      mode: String ("dark", "light"),
 *      filename: String,
 *      values: {...}
 *   }
 * ]
 */
.availableThemes
  
/**
 * Note: Available from NotePlan v3.6.2+
 * Get the current theme as an object with four keys: "name" (name of the theme as seen in the json file), "mode" (dark or light), "filename" (original filename with "json" as extension) and "values" (parsed json file of the theme as object, so you can access every value like `Editor.currentTheme.values["styles"]["body"]["color"]`). To get the name access Editor.currentTheme.name, for the mode, call Editor.currentTheme.mode, etc.
 * @type {
 *    name: String, 
 *    mode: String ("dark", "light"),
 *    filename: String,
 *    values: {...}
 * }
 */
.currentTheme
  
/**
 * Note: Available from NotePlan v3.6.2+
 * Get the current system mode, either "dark" or "light.
 * @type { String }
 */
.currentSystemMode
  
/**
 * Prevents the next "Delete future todos" dialog when deleting a line with a @repeat tag. Will be reset automatically.
 * @type { Boolean }
 */
.skipNextRepeatDeletionCheck

```
</p>
</details>

<details>
<summary>Examples</summary>
<p>
  
  ```javascript
function noteInformation() {
    try {
      var title = Editor.title // First line of the note, typically the title
      var type = Editor.type // Can be 'Calendar' or 'Notes'
      var filename = Editor.filename // Actual filename as in Finder

      console.log("Note info:\n\ttitle = " + title + "\n\ttype = " + type + "\n\tfilename = " + filename)
    } catch (error) {
      console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}

function selectionExample() {
    try {
        // By default you deal with raw selections and text
        // Use the text "[link](https://noteplan.co) TEST" as a test to demonstrate the difference to rendered text and place the cursor before the "T" of "TEST".
        let rawPos = Editor.selection
        console.log("Raw selection: start = " + rawPos.start + " length = " + rawPos.length)

        // Alternatively, return the rendered selection. Means the URLs are compressed to a single character and folded text will be also ignored.
        let renderedPos = Editor.renderedSelection
        console.log("Rendered selection: start = " + renderedPos.start + " length = " + renderedPos.length)

        var selectedLines = Editor.selectedLinesText
        console.log("Selected lines: " + selectedLines)

        // Should select the "TEST" in "[link](https://noteplan.co) TEST"
        Editor.select(28, 4)
      } catch (error) {
          console.log("Plugin code error: \n"+JSON.stringify(error))
      }
}
  ```
  
</p>
</details>

<details>
<summary>API - Functions (opening notes, inserting text, selection)</summary>
<p>
  
  ```javascript
  
Editor
  
/**
* Note: Available from NotePlan v3.2 (Mac Build: 662, iOS Build: 593)
* Selects the full text in the editor.
*/
.selectAll()
  
/**
* Note: Available from NotePlan v3.2 (Mac Build: 662, iOS Build: 593)
* Copies the currently selected text in the editor to the system clipboard.
*/
.copySelection()
  
/**
* Note: Available from NotePlan v3.2 (Mac Build: 662, iOS Build: 593)
* Pastes the current content in the system clipboard into the current selection in the editor.
*/
.pasteClipboard()
  
/**
* Inserts the given text at the given character position (index)
* @param {String} text 	  - Text to insert
* @param {Number} index   - Position to insert at (you can get this using 'renderedSelection' for example)
*/
.insertTextAtCharacterIndex(text, index)
  
/**
* Replaces the text at the given range with the given text
* @param {String} text 	    - Text to insert
* @param {Number} location  - Position to insert at (you can get this using 'renderedSelection' for example)
* @param {Number} length    - Amount of characters to replace from the location
*/
.replaceTextInCharacterRange(text, location, length)
  
/**
* Inserts the given text at the current cursor position
* @param {String} text 	  - Text to insert
*/
.insertTextAtCursor(text)
  
/**
* Replaces the current cursor selection with the given text
* @param {String} text 	  - Text to insert
*/
.replaceSelectionWithText(text)
  
  /**
  * Sets a single frontmatter attribute with the given key and value.
  * If the key already exists, updates its value. If it doesn't exist, adds a new key-value pair.
  * @param {string} key - The frontmatter key to set
  * @param {string} value - The value to set for the key
  * Available from v3.17
  */
  .setFrontmatterAttribute(key, value)

  /**
  * Updates multiple frontmatter attributes at once in a single operation.
  * More efficient than calling setFrontmatterAttribute multiple times as it only reads and writes the note content once.
  * Each attribute object should have "key" and "value" properties.
  * @param {Array<{key: string, value: string}>} attributes - Array of key-value pairs to update
  * @example
  * Editor.updateFrontmatterAttributes([
  *   { key: "title", value: "My Title" },
  *   { key: "type", value: "project" },
  *   { key: "status", value: "draft" }
  * ])
  * Available from v3.18.1
  */
  .updateFrontmatterAttributes(attributes)
  
  
// functions with promises as return values (use with await ... or .then())
/**
* Opens a note using the given filename
* @param {String} filename 	  - Filename of the note file (can be without extension), but has to include the relative folder such as `folder/filename.txt`.
* @param {Boolean} newWindow      - (optional) Open note in new window (default = false)?
* @param {Number} highlightStart  - (optional) Start position of text highlighting
* @param {Number} highlightEnd    - (optional) End position of text highlighting
* @param {Boolean} splitView      - (optional) Open note in a new split view (Note: Available from v3.4)
* @param {Boolean} createIfNeeded - (optional) Create the note with the given filename if it doesn't exist (only project notes, v3.5.2+)
* @param {String} content - Content to fill the note (replaces contents if the note already existed) (v3.7.2+)
* @return {Promise} Note?         - When the note has been opened, a promise will be returned with the note object
*/
.openNoteByFilename(filename, newWindow, highlightStart, highlightEnd, splitView, createIfNeeded, content)

/**
* Opens a note by searching for the give title (first line of the note)
* @param {String} title 	  - Title (case sensitive) of the note (first line)
* @param {Boolean} newWindow      - (optional) Open note in new window (default = false)?
* @param {Number} highlightStart  - (optional) Start position of text highlighting
* @param {Number} highlightEnd    - (optional) End position of text highlighting
* @param {Boolean} splitView      - (optional) Open note in a new split view (Note: Available from v3.4)
* @return {Promise} Note?         - When the note has been opened, a promise will be returned with the note object
*/
.openNoteByTitle(title, newWindow, highlightStart, highlightEnd, splitView)

/**
* Opens a note by searching for the give title (first line of the note)
* @param {String} title 	  - Title (case insensitive) of the note (first line)
* @param {Boolean} newWindow      - (optional) Open note in new window (default = false)?
* @param {Boolean} caseSensitive  - (optional) Should title be case sensitive (default = false)?
* @param {Number} highlightStart  - (optional) Start position of text highlighting
* @param {Number} highlightEnd    - (optional) End position of text highlighting
* @param {Boolean} splitView      - (optional) Open note in a new split view (Note: Available from v3.4)
* @return {Promise} Note?         - When the note has been opened, a promise will be returned with the note object
*/
.openNoteByTitleCaseInsensitive(title, newWindow, caseSensitive, highlightStart, highlightEnd, splitView)

/**
* Opens a calendar note by the given date
* @param {Date} date 	          - The date that should be opened, this is a normal JavaScript date object
* @param {Boolean} newWindow      - (optional) Open note in new window (default = false)?
* @param {Number} highlightStart  - (optional) Start position of text highlighting
* @param {Number} highlightEnd    - (optional) End position of text highlighting
* @param {Boolean} splitView      - (optional) Open note in a new split view (Note: Available from v3.4)
* @param {String} timeframe       - (optional) Use "week", "month", "quarter" or "year" to open a calendar note other than a daily one (Note: Available from v3.7.2)
* @param {String} parent          - (optional) Use the ID or filename of a teamspace here to open alternatively a teamspace calendar note. By default it opens the private calendar note.
* @return {Promise} Note?         - When the note has been opened, a promise will be returned with the note object
*/
.openNoteByDate(date, newWindow, highlightStart, highlightEnd, splitView, timeframe, parent)

/**
* Opens a calendar note by the given date string
* @param {String} dateString 	  - The date string that should be opened, in ISO format: "YYYYMMDD", like "20210501"
* @param {Boolean} newWindow      - (optional) Open note in new window (default = false)?
* @param {Number} highlightStart  - (optional) Start position of text highlighting
* @param {Number} highlightEnd    - (optional) End position of text highlighting
* @param {Boolean} splitView      - (optional) Open note in a new split view (Note: Available from v3.4)
* @return {Promise} Note?         - When the note has been opened, a promise will be returned with the note object
*/
.openNoteByDateString(dateString, newWindow, highlightStart, highlightEnd, splitView)
  
  
/**
* Opens a weekly calendar note by the given year and week number
* @param {Integer} year 	        - The year of the week
* @param {Integer} weeknumber 	  - The number of the week (0-52/53)
* @param {Boolean} newWindow      - (optional) Open note in new window (default = false)?
* @param {Number} highlightStart  - (optional) Start position of text highlighting
* @param {Number} highlightEnd    - (optional) End position of text highlighting
* @param {Boolean} splitView      - (optional) Open note in a new split view (Note: Available from v3.4)
* @return {Promise} Note?         - When the note has been opened, a promise will be returned with the note object
*/
.openWeeklyNote(year, weeknumber, newWindow, highlightStart, highlightEnd, splitView)

/**
* (Raw) select text in the editor (like select 10 characters = length from position 2 = start)
* Raw means here that the position is calculated with the Markdown revealed, including Markdown links and folded text.
* @param {Number} start   - Character start position
* @param {Number} length  - Character length
*/
.select(start, length)

/**
* (Rendered) select text in the editor (like select 10 characters = length from position 2 = start)
* Rendered means here that the position is calculated with the Markdown hidden, including Markdown links and folded text.
* @param {Number} start   - Character start position
* @param {Number} length  - Character length
*/
.renderedSelect(start, length)

/**
* Scrolls to and highlights the given paragraph. If the paragraph is folded, it will be unfolded.
* @param {ParagraphObject} paragraph 
*/
.highlight(paragraph)

/**
* Scrolls to and highlights the given character range. If the range exists in a folded heading, it will be unfolded.
* If a note contains frontmatter, the highlight position needs to be offsetted by the length of the frontmatter. To workaround this, you can set ignoreFrontmatter to true and it will subtract the frontmatter length automatically.
* @param { RangeObject } range 
* @param { Boolean } ignoreFrontmatter (Available from v3.18)
*/
.highlightByRange(range, ignoreFrontmatter)
  
/**
* Note: Available from v3.0.23
* Scrolls to and highlights the given range defined by the character index and the character length it should cover. If the paragraph is folded, it will be unfolded.
* If a note contains frontmatter, the highlight position needs to be offsetted by the length of the frontmatter. To workaround this, you can set ignoreFrontmatter to true and it will subtract the frontmatter length automatically.
* @param {Int} 
* @param {Int} 
* @param { Boolean } ignoreFrontmatter (Available from v3.18)
*/
.highlightByIndex(index, length, ignoreFrontmatter)

  
/**
* Note: Available from v3.4, macOS only
* Opens the print dialog for the current note, so the user can save it as PDF or print it.
* @param {Bool} 
*/
.printNote(withBacklinksAndEvents)
```

</p>
</details>

<details>
<summary>Examples</summary>
<p>
  
  ```javascript
async function openNoteByDate() {
    try {
    //   await Editor.openNoteByDateString("20210411") // Opens 11th April 2021
    //   await Editor.openNoteByDateString("20210411.txt") // Opens 11th April 2021
    //   await Editor.openNoteByDate(new Date()) // Opens today using a Javascript date
    //   await Editor.openNoteByDate(new Date(), true) // date, isNewWindow
        await Editor.openNoteByDate(new Date(), false, 0, 10) // date, isNewWindow, highlightStart, highlightEnd
        console.log("Filename: " + Editor.filename)
      } catch (error) {
          console.log("Plugin code error: \n"+JSON.stringify(error))
      }
}

async function openNoteByFilename() {
    try {
    //   await Editor.openNoteByFilename("TEST.txt") // filename
    //   await Editor.openNoteByFilename("TEST.txt", true) // filename, isNewWindow
        await Editor.openNoteByFilename("TEST.txt", false, 0, 6) // filename, isNewWindow, highlightStart, highlightEnd
        console.log("Filename: " + Editor.filename)
      } catch (error) {
          console.log("Plugin code error: \n"+JSON.stringify(error))
      }
}

async function openNoteByTitle() {
    try {
        // Opens the first note it can find with that title
        await Editor.openNoteByTitle("Test") // title
    //    Editor.openNoteByTitleCaseInsensitive("test")
    //    Editor.openNoteByTitle("TEST", true) // title, isNewWindow
    //    Editor.openNoteByTitle("TEST", false, 0, 6) // title, isNewWindow, highlightStart, highlightEnd
        console.log("Filename: " + Editor.filename)
      } catch (error) {
          console.log("Plugin code error: \n"+JSON.stringify(error))
      }
}

async function highlight() {
    try {
        let paragraphs = Editor.paragraphs
        let re = await CommandBar.showOptions(paragraphs.map(p => (p.lineIndex + ": " + p.content)), "Select a paragraph to highlight")
        Editor.highlight(paragraphs[re.index])
      } catch (error) {
          console.log("Plugin code error: \n"+JSON.stringify(error))
      }
}

  ```
  
</p>
</details>

<details>
<summary>API - Functions (paragraphs)</summary>
<p>
  
  ```javascript
  
Editor


/* When you are changing the text in the editor through the functions below, 
* they are updated live but not saved immediately. The editor saves changes 
* to the next after 1-2 seconds of inactivity.
* When you get the list of paragraphs from the editor and then make changes that 
* alter the line indeces of other paragraphs (like in the case of insert..., 
* remove..., etc.), you need to get a new array of paragraphs to keep 
* changing them. Paragraphs have no IDs and so NotePlan relies on the 
* line index to match them up. So if the index changes, the reference is lost.
*/
  
/**
* Returns a range object of the full paragraph of the given character position.
* @param {Number} pos   - Character position
* @return {RangeObject} - The range of the paragraph = { .start, .end, .length }
*/
.paragraphRangeAtCharacterIndex(pos)

/**
* Inserts a plain paragrah at the given line index
* @param {String} content - Text of the paragraph
* @param {Number} lineIndex - Line index where the todo should be inserted
* @param {"open", "done", "scheduled", "cancelled", "quote", "title", "title", "list" (= bullet), "text" (= plain text) or "empty" (= no text)} type
*/
.insertParagraph(content, lineIndex, type)
  
/**
* Inserts a plain paragrah before the selected paragraph (or the paragraph the cursor is currently positioned)
* @param {String} content - Text of the paragraph
* @param {"open", "done", "scheduled", "cancelled", "quote", "title", "title", "list" (= bullet), "text" (= plain text) or "empty" (= no text)} type
* @param {Number} indents - How much it should be indented
*/
.insertParagraphAtCursor(content, type, indents)

/**
* Inserts a todo at the given line index
* @param {String} content - Name of the todo (without the todo '* [ ] ' Markdown)
* @param {Number} lineIndex - Line index where the todo should be inserted
*/
.insertTodo(content, lineIndex)

/**
* Inserts a completed todo at the given line index
* @param {String} content - Text of the completed todo (without the todo '* [x] ' Markdown)
* @param {Number} lineIndex - Line index where the todo should be inserted
*/
.insertCompletedTodo(content, lineIndex)

/**
* Inserts a cancelled todo at the given line index
* @param {String} content - Text of the cancelled todo (without the todo '* [-] ' Markdown)
* @param {Number} lineIndex - Line index where the todo should be inserted
*/
.insertCancelledTodo(content, lineIndex)

/**
* Inserts a scheduled todo at the given line index
* @param {String} content - Text of the scheduled todo (without the todo '* [>] ' Markdown)
* @param {Number} lineIndex - Line index where the todo should be inserted
* @param {Date} date - (optional) JavaScript date object if you need the date link '>YYYY-MM-DD'
*/
.insertScheduledTodo(content, lineIndex, date)

/**
* Inserts a quote at the given line index
* @param {String} content - Text of the quote (without the quote '> ' Markdown)
* @param {Number} lineIndex - Line index where the todo should be inserted
*/
.insertQuote(content, lineIndex)

/**
* Inserts a list (bullet) item at the given line index
* @param {String} content - Text of the bullet (without the bullet '- ' Markdown)
* @param {Number} lineIndex - Line index where the todo should be inserted
*/
.insertList(content, lineIndex)

/**
* Inserts a heading at the given line index
* @param {String} content - Text of the heading (without the heading '## ' Markdown)
* @param {Number} lineIndex - Line index where the todo should be inserted
* @param {Number} level - Heading level, 1 - based, for example 2 = "## <text>"
*/
.insertHeading(content, lineIndex, level)

/**
* Appends a todo at the end of the note
* @param {String} content - Text of the todo (without the heading '* [ ] ' Markdown)
*/
.appendTodo(content)

/**
* Prepends a todo at the beginning of the note (after the title heading)
* @param {String} content - Text of the todo (without the heading '* [ ] ' Markdown)
*/
.prependTodo(content)

/**
* Appends a paragraph at the end of the note
* @param {String} content - Text of the paragaraph
* @param {"open", "done", "scheduled", "cancelled", "quote", "title", "list" (= bullet), "text" (= plain text) or "empty" (= no text)} type
*/
.appendParagraph(content, type)

/**
* Prepends a paragraph at the beginning of the note (after the title heading)
* @param {String} content - Text of the paragaraph
* @param {"open", "done", "scheduled", "cancelled", "quote", "title", "list" (= bullet), "text" (= plain text) or "empty" (= no text)} type
*/
.prependParagraph(content, type)

/**
* Inserts a todo below the given title of a heading (at the beginning or end of existing text)
* @param {String} content - Text of the todo
* @param {String} headingTitle 	- Title of the heading (without '#  Markdown)
* @param {Boolean} shouldAppend - If the todo should be appended at the bottom of existing text
* @param {Boolean} shouldCreate - If the heading should be created if non-existing
*/
.addTodoBelowHeadingTitle(content, headingTitle, shouldAppend, shouldCreate)

/**
* Inserts a paragraph below the given title of a heading (at the beginning or end of existing text)
* @param {String} content - Text of the paragraph
* @param {"open", "done", "scheduled", "cancelled", "quote", "title", "list" (= bullet), "text" (= plain text) or "empty" (= no text)} paragraphType
* @param {String} headingTitle 	- Title of the heading (without '#  Markdown)
* @param {Boolean} shouldAppend - If the todo should be appended at the bottom of existing text
* @param {Boolean} shouldCreate - If the heading should be created if non-existing
*/
.addParagraphBelowHeadingTitle(content, paragraphType, headingTitle, shouldAppend: Bool, shouldCreate)

/**
* Appends a todo below the given heading index (at the end of existing text)
* @param {String} content - Text of the todo
* @param {Number} headinLineIndex - Line index of the heading (get the line index from a paragraph object)
*/
.appendTodoBelowHeadingLineIndex(content, headinLineIndex)

/**
* Appends a paragraph below the given heading index (at the end of existing text)
* @param {String} content - Text of the paragraph
* @param {"open", "done", "scheduled", "cancelled", "quote", "title", "list" (= bullet), "text" (= plain text) or "empty" (= no text)} paragraphType
* @param {Number} headinLineIndex - Line index of the heading (get the line index from a paragraph object)
*/
.appendParagraphBelowHeadingLineIndex(content, paragraphType, headinLineIndex)

/**
* Inserts a todo after a given paragraph
* @param {String} content - Text of the paragraph
* @param {ParagraphObject} otherParagraph - Another paragraph, get it from `.paragraphs`
*/
.insertTodoAfterParagraph(content, otherParagraph)

/**
* Inserts a todo before a given paragraph
* @param {String} content - Text of the paragraph
* @param {ParagraphObject} otherParagraph - Another paragraph, get it from `.paragraphs`
*/
.insertTodoBeforeParagraph(content, otherParagraph)

/**
* Inserts a paragraph after a given paragraph
* @param {String} content - Text of the paragraph
* @param {ParagraphObject} otherParagraph - Another paragraph, get it from `.paragraphs`
* @param {"open", "done", "scheduled", "cancelled", "quote", "title", "list" (= bullet), "text" (= plain text) or "empty" (= no text)} paragraphType
*/
.insertParagraphAfterParagraph(content, otherParagraph, paragraphType)

/**
* Inserts a paragraph before a given paragraph
* @param {String} content - Text of the paragraph
* @param {ParagraphObject} otherParagraph - Another paragraph, get it from `.paragraphs`
* @param {"open", "done", "scheduled", "cancelled", "quote", "title", "list" (= bullet), "text" (= plain text) or "empty" (= no text)} paragraphType
*/
.insertParagraphBeforeParagraph(content, otherParagraph, paragraphType)

/**
* Removes a paragraph at a given line index
* @param {Number} lineIndex - Line index of the paragraph
*/
.removeParagraphAtIndex(lineIndex)

/**
* Removes a given paragraph. If you need to remove multiple paragraphs, prefer using `.removeParagraphs(ps)`, which is safer.
* @param {ParagraphObject} paragraph - Paragraph object to remove, get it from `.paragraphs`
*/
.removeParagraph(paragraph)
  
/**
* Removes an array paragraphs
* @param {[ParagraphObject]} paragraphs - Paragraph objects to remove, get it from `.paragraphs`
*/
.removeParagraphs(paragraphs)

/**
* Updates a given paragraph. Get the paragraph, then modify it and update the text in the note or editor using this method.
* @param {ParagraphObject} paragraph - Paragraph object to update, get it from `.paragraphs`
*/
.updateParagraph(paragraph)
  
/**
* Updates an array paragraphs. Get the paragraphs, then modify them and update the text in the note or editor using this method.
* @param {[ParagraphObject]} paragraphs - Paragraph objects to update, get it from `.paragraphs`
*/
.updateParagraphs(paragraphs)
  
/**
* Generates a unique block ID and adds it to the content of this paragraph. Remember to call .updateParagraph(p) to write it to the note. You can call this on the Editor or note you got the paragraph from.
* @param {ParagraphObject}
*/
.addBlockID(paragraph)
```

</p>
</details>

<details>
<summary>Examples</summary>
<p>
  
  ```javascript
async function insertTodo() {
    try {
        // Ask user to type the name
        let text = await CommandBar.showInput("Type the name of the task", "Create task named '%@'")
        let lines = Editor.paragraphs

        let re = await CommandBar.showOptions(lines.map(p => p.lineIndex.toString() + ": " + p.content),
                                                "Select line for the new task")
        let line = lines[re.index]
        console.log("selected line: " + line.content)

        if(line != undefined) {
            Editor.insertTodo(text, line.lineIndex)
        } else {
            console.log("index undefined")
        }
      } catch (error) {
          console.log("Plugin code error: \n"+JSON.stringify(error))
      }
}

async function appendTodo() {
    try {
        let text = await CommandBar.showInput("Type the name of the task", "Create task named '%@'")
        Editor.prependTodo(text)
      } catch (error) {
          console.log("Plugin code error: \n"+JSON.stringify(error))
      }
}

async function addTaskToNote() {
    try {
        let notes = DataStore.projectNotes

        // CommandBar.showOptions only takes [string] as input
        let re = await CommandBar.showOptions(notes.map(n => n.title), "Select note for new todo")
        let note = notes[re.index]

        let todoTitle = await CommandBar.showInput("Type the task", "Add task '%@' to '" + note.title + "'")
        note.insertTodo(todoTitle, 1)
      } catch (error) {
          console.log("Plugin code error: \n"+JSON.stringify(error))
      }
}

async function addTaskToHeading() {
    try {
      // First ask for the note we want to add the todo
      let notes = DataStore.projectNotes

      // CommandBar.showOptions only takes [string] as input
      let re = await CommandBar.showOptions(notes.map(n => n.title), "Select note for new todo")
      let note = notes[re.index]
      printNote(note)

      // Ask to which heading to add the todo
      let headings = note.paragraphs.filter(p => p.type == "title")
      let re2 = await CommandBar.showOptions(headings.map(p => (p.prefix + p.content)), "Select a heading")

      let heading = headings[re2.index]
      console.log("Selected heading: " + heading.content)

      // Ask for the todo title finally
      let todoTitle = await CommandBar.showInput("Type the task", "Add task '%@' to '" + note.title + "'")
      console.log("Adding todo: " + todoTitle + " to " + note.title + " in heading: " + heading.content)

      // Add todo to the heading in the note
     note.appendTodoBelowHeadingLineIndex(todoTitle, heading.lineIndex) // This works also if there are duplicate headings

  //  Alternative implementations
  //    note.appendParagraphBelowHeadingLineIndex(todoTitle, "quote", heading.lineIndex)
  //    note.addTodoBelowHeadingTitle(todoTitle, heading.content, false, true)
  //    note.addParagraphBelowHeadingTitle(todoTitle, "done", heading.content, true, true)
  //    note.insertTodoAfterParagraph(todoTitle, heading.content)
  //    note.insertTodoBeforeParagraph(todoTitle, heading.content)
  //    note.insertParapgrahBeforeParagraph(todoTitle, heading.content, "list")
  //    note.insertParagraphAfterParagraph(todoTitle, heading.content, "list")
      } catch (error) {
          console.log("Plugin code error: \n"+JSON.stringify(error))
      }
}

function rangeOfParagraph() {
    try {
        let selection = Editor.selection
        let range = Editor.paragraphRangeAtCharacterIndex(selection.start)

        let text = "Location: " + range.start + ", length: " + range.length
        CommandBar.showOptions([text], "The paragraph range is:")
      } catch (error) {
          console.log("Plugin code error: \n"+JSON.stringify(error))
      }
}

async function modifyExistingParagraphs() {
    try {
      let paragraphs = Editor.paragraphs

      // Change the content and type of a paragraph
      let re = await CommandBar.showOptions(paragraphs.map(p => (p.lineIndex + ": " + p.content)), "Select a paragraph to modify")
      let newParagraphText = await CommandBar.showInput("New content of selected paragraph", "Change paragraph to '%@'")
      let newType = await CommandBar.showOptions(["open", "done", "scheduled", "cancelled", "quote", "text", "empty", "list", "title"], "Select the new type")

      paragraphs[re.index].content = newParagraphText
      paragraphs[re.index].type = newType.value
      Editor.paragraphs = paragraphs

  //  Alternative implementation
  //    let paragraph = paragraphs[re.index]
  //    paragraph.content = newParagraphText
  //    paragraph.type = newType.value
  //    Editor.updateParagraph(paragraph)

      } catch (error) {
          console.log("Plugin code error: \n"+JSON.stringify(error))
      }
}

async function removeParagraph() {
    try {
        let paragraphs = Editor.paragraphs

        let re = await CommandBar.showOptions(paragraphs.map(p => (p.lineIndex + ": " + p.content)), "Select a paragraph to remove")

        Editor.removeParagraphAtIndex(re.index)

    //    Alternative implementations
    //    Editor.removeParagraph(paragraphs[re.index])

    //    or...
    //    paragraphs.splice(re.index, 1)
    //    Editor.paragraphs = paragraphs
      } catch (error) {
          console.log("Plugin code error: \n"+JSON.stringify(error))
      }
}
  
async function assignBlockID() {
    try {
        let paragraphs = Editor.paragraphs
        Editor.addBlockID(paragraphs[0])
        Editor.updateParagraph(paragraphs[0])
    } catch (error) {
        console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}

  
```
  
</p>
</details>


<details>
<summary>API - Functions (other)</summary>
<p>
  
```javascript
/**
* Note: Available from NotePlan v3.6.2+
* Change the current theme. Get all available theme names using `.availableThemes`. Custom themes are also supported (works only with the filename). This will not save the theme, it will just set it. If the system switched from light to dark mode, NotePlan will automatically load up the default (saved) theme for that mode.
* @param {String}
*/
.setTheme(filename)  
  
/**
* Note: Available from NotePlan v3.6.2+
* Saves the default theme for a specific mode. It will not set the currently used theme, but just save it. So if you restart NotePlan or the system mode changes, it will use this saved default theme (if it's the same mode you saved it for). As mode use "dark", "light" or "auto" (uses the current system mode).
* @param {String}
* @param {String}
*/
.saveDefaultTheme(filename, mode) 
  
/**
* Note: Available from NotePlan v3.1+
* Add a new theme using the raw json string. It will be added as a custom theme and you can load it right away with `.setTheme(name)` using the filename defined as second parameter. Use ".json" as file extension.
* It returns true if adding was successful and false if not. An error will be also printed into the console.
* Adding a theme might fail, if the given json text was invalid. Make sure to stringify the json using `JSON.stringify(theme)`.
* @param {String}
* @param {String}
* @return {Boolean}
*/
.addTheme(stringifiedJSON, filename)  
  
/**
* Note: Available from NotePlan v3.9.3+
* Saves the content of the editor into the note file, so you can work with the updated cache later (you might need to call DataStore.updateCache(note, true) to update tags etc.).
* @param {Float} - optional timeout in seconds, default is 2.0 seconds (v3.18.2)
* @return {Promise}
*/
.save(timeout)  
```
  
</p>
</details>

<details>
<summary>Examples</summary>
<p>
  
```javascript
function customTheme() {
  let json = `
  {
    "name": "Monospace-Light",
    "style": "Light",
    "author": {
      "name": "David - Not really author, more like surgeon",
      "email": "hello@noteplan.co"
    },
    "editor": {
      "backgroundColor": "#ffffff",
      "altBackgroundColor": "#FAFFFF",
      "tintColor": "#DD4C4F",
      "tintColor2": "#DD4C4F",
      "textColor": "#333333",
      "toolbarBackgroundColor": "#F3F5F7",
      "toolbarIconColor": "#dd4c4f",
      "menuItemColor": "#dd4c4f",
      "shouldOverwriteFont": false,
      "font": "Menlo-Regular",
    },
      "styles": {
        "body": {
          "font": "Menlo-Regular",
          "size": 16,
          "color": "#444444"
        }
      }
  }
  `
  if (Editor.addTheme(json, "plain-text.json")) {
    console.log(Editor.availableThemes)
    Editor.setTheme("plain-text.json")
  }
}
```
  
</p>
</details>
