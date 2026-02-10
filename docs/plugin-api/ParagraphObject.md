<details>
<summary>API</summary>
<p>

```javascript
ParagraphObject

/**
* Get or set the type of the paragraph
* @type {"open", "done", "scheduled", "cancelled", "title", "quote", "list" (= bullet), "empty" (no content) or "text" (= plain text), "checklist", "checklistDone", "checklistCancelled", "checklistScheduled" }
*/
.type

/**
* Get or set the content of the paragraph (without the Markdown 'type' prefix, such as '* [ ]' for open task and without leading indents)
* @type {String}
*/
.content

/**
* Get the content of the paragraph (**with** the Markdown 'type' prefix, such as '* [ ]' for open task and **with** leading indents)
* @type {String}
*/
.rawContent

/**
* Get the Markdown prefix of the paragraph (like '* [ ]' for open task)
* @type {String}
*/
.prefix

/**
* Get the range of the paragraph.
* @type {RangeObject}
*/
.contentRange

/**
* Get the line index of the paragraph.
* @type {Int}
*/
.lineIndex

/**
* Get the date of the paragraph, if any (in case of scheduled tasks).
* @type {Date}
*/
.date

/**
* Get the heading of the paragraph (looks for a previous heading paragraph).
* @type {String}
*/
.heading

/**
* Get the heading range of the paragraph (looks for a previous heading paragraph).
* @type {RangeObject}
*/
.headingRange

/**
* Get the heading level of the paragraph ('# heading' = level 1).
* @type {Int}
*/
.headingLevel

/**
* If the task is a recurring one (contains '@repeat(...)')
* @type {Boolean}
*/
.isRecurring

/**
* Get or set the amount of indentations.
* @type {Int}
*/
.indents

/**
* Get the filename of the note this paragraph was loaded from (can be undefined).
* @type {String}
*/
.filename

/**
* Get the note type of the note this paragraph was loaded from (can be undefined).
* @type {String}
*/
.noteType

/**
* Get the linked note titles this paragraph contains, such as '[[Note Name]]' (will return names without the brackets).
* @type {[String]}
*/
.linkedNoteTitles

/**
* Creates a duplicate object, so you can change values without affecting the original object
* @return {ParagraphObject}
*/
.duplicate()
    
    
/**
* Note: Available from v3.3
* Returns indented paragraphs (children) underneath a task 
* This includes bullets, tasks, quotes, text. 
* Children are counted until a blank line, HR, title, or another item at the 
* same level as the parent task. So for items to be counted as children, they 
* need to be contiguous vertically.
* Important note: .children() for a task paragraph will return every child, 
* grandchild, greatgrandchild, etc. So a task that has a child task that has 
* a child task will have 2 children (and the first child will have one)
* It can return null, if there was a problem loading the text of the underlying note.
* @type {[ParagraphObject]?}
*/
.children()
    
/**
* Note: Available from v3.5.2
* Returns the NoteObject behind this paragraph. This is a convenience method, so you don't need to use DataStore.
* @type {NoteObject?}
*/
.note
    
/**
* Note: Available from v3.5.2
* Returns the given blockId if any.
* @type {String?}
*/
.blockId
    
/**
* Note: Available from v3.5.2
* Returns an array of all paragraphs having the same blockID. You can use `paragraph[0].note` to access the note behind it and make updates via `paragraph[0].note.updateParagraph(paragraph[0])` if you make changes to the content, type, etc (like checking it off as type = "done")
* @type {[ParagraphObject]} - getter
*/
.referencedBlocks
```

</p>
</details>  

<details>
<summary>Example</summary>
<p>
    
Load current paragraphs and let user modify one:
```javascript
async function modifyExistingParagraphs() {
    try {
        let paragraphs = Editor.paragraphs

        // Change the content and type of a paragraph
        let re = await CommandBar.showOptions(paragraphs.map(p => (p.lineIndex + ": " + p.content)), "Select a paragraph to modify")
        let newParagraphText = await CommandBar.showInput("New content of selected paragraph", "Change paragraph to '%@'")
        let newType = await CommandBar.showOptions(["open", "done", "scheduled", "cancelled", "quote", "empty", "list"], "Select the new type")

        paragraphs[re.index].content = newParagraphText
        paragraphs[re.index].type = newType.value
        Editor.paragraphs = paragraphs
    
    } catch (error) {
        console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}
```

Print a paragraph to console:
```javascript
function printParagraph(p) {
    if(p == undefined) {
        console.log("paragraph is undefined")
        return
    }
    
    console.log(
        "\n\ncontent: " + p.content +
        "\n\ttype: " + p.type +
        "\n\tprefix: " + p.prefix +
        "\n\tcontentRange: " + rangeToString(p.contentRange) +
        "\n\tlineIndex: " + p.lineIndex +
        "\n\tdate: " + p.date +
        "\n\theading: " + p.heading +
        "\n\theadingRange: " + rangeToString(p.headingRange) +
        "\n\theadingLevel: " + p.headingLevel +
        "\n\tisRecurring: " + p.isRecurring +
        "\n\tindents: " + p.indents +
        "\n\tfilename: " + p.filename +
        "\n\tnoteType: " + p.noteType +
        "\n\tlinkedNoteTitles: " + p.linkedNoteTitles
        )
}

function rangeToString(r) {
    if(r == undefined) {
        return "Range is undefined!"
        return
    }
    
    return "location: " + r.start + ", length: " + r.length
}
```
    
Get children from paragraph (indented items like bullets or sub-tasks):
```javascript
async function childrenOfSelectedParagraph() {
    try {
        let paragraphs = Editor.selectedParagraphs
        console.log(paragraphs[0].content)

        console.log("load children")
        let children = paragraphs[0].children()

        if(children) {
            console.log("found: " + children.length + " children")
            children.forEach(p => console.log(p.content))
        } else {
            console.log("couldn't load children")
        }
    } catch (error) {
        console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}
    
function updateReferencedBlocks() {
  let para = Editor.paragraphs
  let ref = para[0].referencedBlocks

  console.log("referenced blocks: " + ref.length)
  ref.forEach((todo, i) => {
    console.log(i + ": " + todo.filename)
    todo.type = "done"
    todo.note.updateParagraph(todo)
  });    
}
```
  
</p>
</details>  

