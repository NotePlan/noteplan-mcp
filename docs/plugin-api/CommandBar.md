<details>
<summary>API - CommandBar</summary>
<p>

```javascript
CommandBar

/**
* Get or set the current text input placeholder (what you can read when no input is typed in) of the Command Bar.
* @type {String}
*/
.placeholder

/**
* Get the current text input content of the Command Bar (what the user normally types in).
* @type {String}
*/
.searchText

/**
* Hides the Command Bar
*/
.hide() 

/**
* Display an array of choices as a list which the user can "fuzzy-search" filter by typing something.
* The user selection is returned as a Promise. So use it with "await CommandBar.showOptions(...)".
* The result is a CommandBarResultObject (as Promise success result), which has ".value" and ".index".
* 
* Options can be provided in two formats:
* 1. String array (for backward compatibility): ["Option 1", "Option 2", ...]
* 2. Object array (available from v3.18) with properties:
*    - text: string (required) - The display text
*    - icon: string (optional) - Icon to display (FontAwesome icon name)
*    - shortDescription: string (optional) - Text displayed on the right side
*    - color: string (optional) - Color for the icon (hex like "#FF0000" or tailwind color name)
*    - shortDescriptionColor: string (optional) - Color for the description text (hex or tailwind)
*    - alpha: number (optional) - Opacity for the icon and shortDescription (0-1). Default opacity will be used if not specified
*    - darkAlpha: number (optional) - Opacity for the icon and shortDescription for the dark theme (0-1). Default opacity will be used if not specified
* 
* Example object format:
* [
*   { text: "Option 1", icon: "star", color: "#FFD700" },
*   { text: "Option 2", icon: "check", shortDescription: "Premium", shortDescriptionColor: "#00FF00" },
*   { text: "Option 3", icon: "info", shortDescription: "Beta feature", alpha: 0.8, darkAlpha: 0.9 }
* ]
* 
* Use the ".index" attribute to refer back to the selected item in the original array.
* If you want to provide an existing search text that will be inserted into the command bar, use the third parameter.
* 
* @param {[String]|[Object]} options - Array of strings or objects with options
* @param {String} placeholder - Placeholder text for the search input
* @param {String} searchText - Initial search text to populate
* @return {Promise<CommandBarResultObject>} - Promise resolving to result with .value and .index
*/
.showOptions(options, placeholder, searchText) 

/**
* Asks the user to enter something into the CommandBar. 
* Use the "placeholder" value to display a question, like "Type the name of the task".
* Use the "submitText" to describe what happens with the selection, like "Create task named '%@'". 
* The "submitText" value supports the variable "%@" in the string, that NotePlan autofills with the typed text.
* It returns a Promise, so you can wait (using "await...") for the user input with the entered text as success result.
* If you want to provide an existing search text that will be inserted into the command bar, use the third variable.
* @param {String} 
* @param {String} 
* @param {String} 
* @return {Promise (String)}
*/
.showInput(placeholder, submitText, searchText)
    
/**
* Note: Available from v3.0.25
* Shows or hides a window with a loading indicator or a progress ring (if progress is defined) and an info text (optional).
* `text` is optional, if you define it, it will be shown below the loading indicator.
* `progress` is also optional. If it's defined, the loading indicator will change into a progress ring. Use float numbers from 0-1 to define how much the ring is filled.
* When you are done, call `showLoading(false)` to hide the window. See an example function in the example section below.
* @param {Bool} 
* @param {String?} 
* @param {Float?} 
*/
.showLoading(visible, text, progress)
    
/**
* Note: Available from v3.0.25
* If you call this, anything after `await CommandBar.onAsyncThread()` will run on an asynchronous thread. 
* Use this together with `showLoading`, so that the work you do is not blocking the user interface. 
* Otherwise the loading window will be also blocked.
*
* Warning: Don't use any user interface calls (other than showLoading) on an asynchronous thread. The app might crash. 
* You need to return to the main thread before you change anything in the window (such as Editor functions do).
* Do not call any functions from Editor.* on an async thread.
* Use `onMainThread()` to return to the main thread. See an example function in the example section below.
* @return {Promise}
*/
.onAsyncThread()
    
/**
* Note: Available from v3.0.25
* If you call this, anything after `await CommandBar.onMainThread()` will run on the main thread. 
* Call this after `onAsyncThread`, once your background work is done. 
* It is safe to call Editor and other user interface functions on the main thread.
* See an example function in the example section below.
* @return {Promise}
*/
.onMainThread()
    
/**
* Note: Available from v3.3.2
* Show a native prompt to the user with a title and a message text. Define at least one button for the user to select (the parameter is an array of strings, each string the title of a button). If you don't supply any buttons, an "OK" button will be displayed. The promise returns as value the pressed button index (i.e. "0" would be the first supplied button). 
* @param {String} 
* @param (String)
* @param ([String]?)
* @return {Promise<Int>}
*/
.prompt(title, message, buttons)
    
/**
* Note: Available from v3.3.2
* Show a native text input prompt to the user with a title and a message text. The buttons will be automatically "OK" and "Cancel". You can supply a default text which will be prefilled. If the user hits "Cancel", the promise returns false.
* @param {String} 
* @param (String)
* @param (String?)
* @return {Promise<Bool | String>}
*/
.textPrompt(title, message, defaultText)
```

</p>
</details>  

<details>
<summary>API - CommandBarObject</summary>
<p>

```javascript
CommandBarObject

/**
* Get the index of the selected option based on the list used in `CommandBar.showOptions(...)`.
* @type {Int}
*/
.index

/**
* Get the value of the selected option based on the list used in `CommandBar.showOptions(...)`.
* @type {String}
*/
.value

/**
* Available in v3.7
* Get the keyboard modifier ("cmd", "opt", "shift", "ctrl") that were pressed while selecting a result.
* @type {[String]}
*/
.keyModifiers
```

</p>
</details>  

<details>
<summary>Examples</summary>
<p>

    
```javascript

async function createNote() {
    try {
        let title = await CommandBar.showInput("Enter title of the new note", "Create a new note with title = '%@'")
        let folder = await CommandBar.showOptions(DataStore.folders, "Select a folder for '" + title + "'")

        if(title != undefined && title !== "") {
            var filename = DataStore.newNote(title, folder.value)
            console.log("Created note with filename: " + filename)
        } else {
            console.log("Title undefined or empty: " + title)
        }
    } catch (error) {
        console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}

async function inputTest() {
    try {
        var reply = await CommandBar.showInput("1. Enter something", "Submit '%@'")
        console.log("Reply: " + reply)
    } catch (error) {
        console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}

async function addTaskToNote() {
    try {
        let notes = DataStore.projectNotes

        // CommandBar.showOptions only takes [string] as input
        let re = await CommandBar.showOptions(notes.map(n => n.title), "Select note for new todo")
        let note = notes[re.index] // Use .index to refer to the original array

        let todoTitle = await CommandBar.showInput("Type the task", "Add task '%@' to '" + note.title + "'")
        note.insertTodo(todoTitle, 1)
    } catch (error) {
       console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}

async function loadingDemo() {
    try {
        // Show the loading indicator with text
        CommandBar.showLoading(true, "doing some work")

        // Begin an asynchronous thread, so the loading indicator won't be blocked
        await CommandBar.onAsyncThread()

        // Do some arbitrary work
        let total = 50000000
        for (let i = 0; i < total; i++) { 
            let a = i * i

            if(i % 1000000 == 0) {
                // Show progress
                CommandBar.showLoading(true, "doing some work", i / total)
            }
        }

        // Switch back to the main thread, so we can make edits to the Editor
        await CommandBar.onMainThread()
        CommandBar.showLoading(false)
    } catch (error) {
        console.log("Plugin code error: \n"+JSON.stringify(error))
    }
} 
                              
async function demoPrompt() {
    try {
        let typedText = await CommandBar.textPrompt("Your dialog title", "Your detailed message", "some default text")
        console.log("typedText: " + typedText) // Will be 1 if user hits cancel

        let buttonIndex = await CommandBar.prompt("Your dialog title", "Your message", ["OK", "Cancel", "third", "fourth"])
        console.log("buttonIndex: " + buttonIndex)
    } catch (error) {
        console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}
```
  
</p>
</details>  

