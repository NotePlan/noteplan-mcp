<details>
<summary>API</summary>
<p>

```javascript
NoteObject

/**
* Returns the relative path of the note (including the folder, like `folder/filename.txt`). 
* Can be also used to set the filename and NotePlan will rename it on disc (available from v3.6)
* If this note is from a teamspace, the filename will end with the ID of the note and the teamspace in the path will also be an ID, use "resolvedFilename" to display it in a human readable format.
* { get set }
* @type {String}
*/
.filename
  

/**
* Returns the relative, resolved path of the note (including the folder, like `folder/filename.txt`). 
* If it's a teamspace note, it replaces the IDs in the path with the name of the teamspace and the name of the note. Teamspace note filenames end otherwise with an ID, and the teamspace is also represented as an ID.
* Note: Don't use this filename to read or write the note. Use `.filename`, instead.
* { get }
* @type {String}
*/
.resolvedFilename
 
/**
* Returns true if it's a teamspace note, false if it's a private note.
* { get }
* @type {Boolean}
*/
.isTeamspaceNote
  
/**
* Returns the title of the teamspace this note belongs to.
* { get }
* @type {String}
*/
.teamspaceTitle
  
/**
* Returns the ID of the teamspace this note belongs to.
* { get }
* @type {String}
*/
.teamspaceID
  
/**
* Note: Available from v3.6.1
* Renames the note. You can also define a folder path. The note will be moved to that folder and the folder will be automatically created.
* It returns the actual filename. If the filename already exists, a number will be appended. If the filename begins with ".", it will be removed.
* @param {String} 
* @return {String}
*/
.rename(newFilename)

/**
* Type of the note, either "Notes" or "Calendar".
* { get }
* @type {String}
*/
.type

/**
* Title = first line of the note.
* { get }
* @type {String}
*/
.title

/**
* Optional date if it's a calendar note
* { get }
* @type {Date}
*/
.date

/**
* Date and time when the note was last modified.
* { get }
* @type {Date}
*/
.changedDate

/**
* Date and time of the creation of the note.
* { get }
* @type {Date}
*/
.createdDate

/**
* All #hashtags contained in this note.
* { get }
* @type {[String]}
*/
.hashtags

/**
* All @mentions contained in this note.
* { get }
* @type {[String]}
*/
.mentions

/**
* Get or set the raw text of the note (means there is no hidden or rendered Markdown). If you set the content, NotePlan will write it immediately to file. If you get the content, it will be read directly from the file.
* { get set }
* @type {String}
*/
.content
  
/**
* Same as content, but attached image and file paths are resolved to the absolute path, useful if the note is being copied, like in Templates, so the images are copied over, too. Don't use it by default, because it can cause conflicts due to the different paths in the file vs the variable.
* { get }
* @type {String}
*/
.contentWithAbsoluteAttachmentPaths

/**
* Get or set paragraphs contained in this note (these can be tasks, plain text, headings...). If you set the paragraph array, it will join them and save the new content to file.
* { get set }
* @type {[ParagraphObject]}
*/
.paragraphs
  
/**
* Note: Available from v3.2
* Get paragraphs contained in this note which contain a link to another (non day) note.
* @type {[ParagraphObject]}
* { get }
*/
.linkedItems
  
/**
* Note: Available from v3.2
* Get paragraphs contained in this note which contain a link to a daily note.
* { get }
* @type {[ParagraphObject]}
*/
.datedTodos
  
/**
* Note: Available from v3.2
* Get all backlinks pointing to the current note as Paragraph objects. In this array, the toplevel items are all notes linking to the current note and the 'subItems' attributes (of the paragraph objects) contain the paragraphs with a link to the current note. The headings of the linked paragraphs are also listed here, although they don't have to contain a link. 
* The content of the paragraphs has normalized indent hierarchy so items that appear without their parents don't look oddly indented
* { get }
* @type {[ParagraphObject]}
*/
.backlinks
  
/**
* Note: Available from v3.7.2
* Get all available versions of a note from the backup database. It returns an array with objects that have following attributes: `content` (full content of the note) and `date` (when this version was saved). You can use this in combination with note triggers and diffs to figure out what has changed inside the note. The first entry in the array is the current version and the second contains the content of the previous version, etc.
* { get }
* @type {[{ content: String, date: Date }]}
*/
.versions
  
/**
* Inserts the given text at the given character position (index)
* @param {String} text 	  - Text to insert
* @param {Number} index   - Position to insert at (you can get this using 'renderedSelection' for example)
*/
.insertTextInCharacterIndex(text, index)
  
/**
* Replaces the text at the given range with the given text
* @param {String} text 	    - Text to insert
* @param {Number} location  - Position to insert at (you can get this using 'renderedSelection' for example)
* @param {Number} length    - Amount of characters to replace from the location
*/
.replaceTextAtCharacterRange(text, location, length)
  
/**
* Note: Available from v3.4, macOS only
* Opens the print dialog for the current note, so the user can save it as PDF or print it.
* @param {Bool} 
*/
.printNote(withBacklinksAndEvents)
  
/**
* Note: Available from v3.5
* Returns all types assigned to this note in the frontmatter as an array of strings. 
* You can assign types to a note with frontmatter using `type: meeting-note, empty-note` for example (comma separated).
* { get }
* @type {[String]}
*/
.frontmatterTypes

/**
* Returns the frontmatter key-value pairs inside the note.
* { get }
* @type {[String:String]}
*/
.frontmatterAttributes
  
/**
* Returns the ordered frontmatter key-value pairs inside the note as individual objects inside an array with two values: "key" and "value". Ordered means they are ordered as they appear in the same order as inside the note.
* Example:
*   const note = DataStore.projectNoteByTitle("Stoicism")[0]
*  for (const attribute of note.frontmatterAttributesArray) {
*    console.log(attribute.key + ": " + attribute.value)
*  }
* { get }
* @type {[[String:String]]}
*/
.frontmatterAttributesArray
  
/**
* Sets a single frontmatter attribute with the given key and value.
* If the key already exists, updates its value. If it doesn't exist, adds a new key-value pair.
* @param {string} key - The frontmatter key to set
* @param {string} value - The value to set for the key
* Available from v3.18.1
*/
.setFrontmatterAttribute(key, value)

/**
* Updates multiple frontmatter attributes at once in a single operation.
* More efficient than calling setFrontmatterAttribute multiple times as it only reads and writes the note content once.
* Each attribute object should have "key" and "value" properties.
* @param {Array<{key: string, value: string}>} attributes - Array of key-value pairs to update
* @example
* note.updateFrontmatterAttributes([
*   { key: "title", value: "My Title" },
*   { key: "type", value: "project" },
*   { key: "status", value: "draft" }
* ])
* Available from v3.18.1
*/
.updateFrontmatterAttributes(attributes)
  
/**
* Note: Available from v3.9.1
* Returns the database record ID of the published note (on CloudKit). Returns null if the note is not published yet. 
* Use this to verify if a note has been published and to build the public link: https://noteplan.co/n/{publicRecordID} 
* { get }
* @type {String?}
*/
.publicRecordID
  
/**
* Note: Available from v3.9.1
* Publishes the note using CloudKit (inserts a record on the public database). Build the web-link to the note by using the publicRecordID.
* @return {Promise}
*/
.publish()
  
/**
* Note: Available from v3.9.1
* Unpublishes the note from CloudKit (deletes the database entry from the public database).
* @return {Promise}
*/
.unpublish()
  
/**
* Note: Available from v3.9.3
* Returns the conflicted version if any. Otherwise, returns undefined.
* @return { Object(filename: String, url: string, content: String) }
*/
.conflictedVersion
  
/**
* Note: Available from v3.9.3
* Resolves a conflict, if any, using the current version (which is version 1 in the conflict bar inside the UI). Once resolved you need to reload the note.
*/
.resolveConflictWithCurrentVersion()
  
  
/**
* Note: Available from v3.9.3
* Resolves a conflict, if any, using the other version (which is version 2 in the conflict bar inside the UI). Once resolved you need to reload the note.
*/
.resolveConflictWithOtherVersion()
```

</p>
</details>  

<details>
<summary>API - Paragraphs</summary>
<p>
  
  ```javascript
 
/* When you are changing the text in the note through the functions below, 
* they are saved immediately. But it takes a few seconds for NotePlan to register
* the file changes and update the UI. So the editor content will update with a delay.
* If you want the changes to appear immediately, use the `Editor.*` functions.  
  
* When you get the list of paragraphs from the note and then make changes that 
* alter the line indeces of other paragraphs (like in the case of insert..., 
* remove..., etc.), you need to get a new array of paragraphs to keep 
* changing them. Paragraphs have no IDs and so NotePlan relies on the 
* line index to match them up. So if the index changes, the reference is lost.
*/
  
NoteObject
  
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
* @param {"open", "done", "scheduled", "cancelled", "quote", "title", "list" (= bullet), "text" (= plain text) or "empty" (= no text)} type
*/
.insertParagraph(content, lineIndex, type)

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
* @param {String} headingTitle  - Title of the heading (without '#  Markdown)
* @param {Boolean} shouldAppend - If the todo should be appended at the bottom of existing text
* @param {Boolean} shouldCreate - If the heading should be created if non-existing
*/
.addTodoBelowHeadingTitle(content, headingTitle, shouldAppend, shouldCreate)

/**
* Inserts a paragraph below the given title of a heading (at the beginning or end of existing text)
* @param {String} content - Text of the paragraph
* @param {"open", "done", "scheduled", "cancelled", "quote", "title", "list" (= bullet), "text" (= plain text) or "empty" (= no text)} paragraphType
* @param {String} headingTitle  - Title of the heading (without '#  Markdown)
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
* Note: Available from v3.5.2
* Generates a unique block ID and adds it to the content of this paragraph. Remember to call .updateParagraph(p) to write it to the note. You can call this on the Editor or note you got the paragraph from.
* @param {ParagraphObject}
*/
.addBlockID(paragraph)
  
/**
* Note: Available from v3.5.2
* Removes the unique block ID, if it exists in the content. Remember to call .updateParagraph(p) to write it to the note afterwards. You can call this on the Editor or note you got the paragraph from.
* @param {ParagraphObject}
*/
.removeBlockID(paragraph)
```

</p>
</details>

<details>
<summary>Examples</summary>
<p>

    
```javascript
function overwriteNote() {
    var note = DataStore.projectNoteByFilename("TEST.txt")
    if(note != undefined) {
        note.content = "# TEST\nThis is new content with random number: " + Math.floor(Math.random() * 100)
    } else {
        console.log("Note not found! - Create a note 'TEST.txt'.")
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
    // addTodoBelowHeading(todoTitle, headingTitle, true or false = should append, true or false = should create if non-existing)
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
  
async function assignBlockID() {
  try {
      let note = DataStore.projectNoteByTitle("Note A")[0]
      let para = note.paragraphs
      note.addBlockID(para[1])
      note.updateParagraph(para[1])
  } catch (error) {
      console.log("Plugin code error: \n"+JSON.stringify(error))
  }
}
  
// See more Paragraph examples under "Editor" in the documentation.

```
  
</p>
</details>  

