<details>
<summary>API</summary>
<p>

```javascript
DataStore

/**
* Get the preference for the default file (note) extension, such as "txt" or "md".
* @type {String}
*/
.defaultFileExtension

/**
* Get all folders as array of strings. Including the root "/". This includes folders that begin with "@" such as "@Archive" and "@Templates". It excludes the trash folder.
* @type {[String]}
*/
.folders

/**
* Get all calendar notes.
* @type {[NoteObject]}
*/
.calendarNotes

/**
* Get all regular, project notes. This includes notes and templates from folders that begin with "@" such as "@Archive" and "@Templates". It excludes notes in the trash folder though.
* @type {[NoteObject]}
*/
.projectNotes
    
/**
* Returns an array of teamspaces represented as Note Objects with title and filename populated. Example of a filename: `%%NotePlanCloud%%/275ce631-6c20-4f76-b5fd-a082a9ac5160`
* @type {[NoteObject]}
*/
.teamspaces

/**
* Get all cached hashtags (#tag) that are used across notes. It returns the tags with a leading '#'.
* @type {[String]}
*/
.hashtags

/**
* Get all cached mentions (@name) that are used across notes. It returns the tags with a leading '@'.
* @type {[String]}
*/
.mentions
    
/**
* Get the names of all available filters that can be used in the "Reviews" / "Filters" (renamed) view.
* Note: Available from v3.6
* @type {[String]}
*/
.filters
    
/**
* Returns the value of a given preference (can be undefined, if the setting was never set, so check for this case).
* Available keys:
* "themeLight"              // theme used in light mode
* "themeDark"               // theme used in dark mode
* "fontDelta"               // delta to default font size
* "firstDayOfWeek"          // first day of calendar week
* "isAgendaVisible"         // only iOS, indicates if the calendar and note below calendar are visible
* "isAgendaExpanded"        // only iOS, indicates if calendar above note is shown as week (true) or month (false)
* "isAsteriskTodo"          // "Recognize * as todo" = checked in markdown preferences
* "isDashTodo"              // "Recognize - as todo" = checked in markdown preferences
* "isNumbersTodo"           // "Recognize 1. as todo" = checked in markdown preferences
* "defaultTodoCharacter"    // returns * or -
* "isAppendScheduleLinks"   // "Append links when scheduling" checked in todo preferences
* "isAppendCompletionLinks" // "Append completion date" checked in todo preferences
* "isCopyScheduleGeneralNoteTodos" // "Only add date when scheduling in notes" checked in todo preferences
* "isSmartMarkdownLink"     // "Smart Markdown Links" checked in markdown preferences
* "fontSize"                // Font size defined in editor preferences (might be overwritten by custom theme)
* "fontFamily"              // Font family defined in editor preferences (might be overwritten by custom theme)
* "isRenderingMarkdown"     // "Render Markdown" in the preferences (means hiding markdown characters).
* @param {String} 
* @return {String?}
*/
.preference(key) 

/**
* Note: Available from NotePlan v3.1+
* Change a saved preference or create a new one. It will most likely be picked up by NotePlan after a restart, if you use one of the keys utilized by NotePlan. 
* To change a NotePlan preference, use the keys found in the description of the function `.preference(key)`.
* You can also save custom preferences specific to the plugin, if you need any. Prepend it with the plugin id or similar to avoid collisions with existing keys.
* Preferences are saved locally and won't be synced.
* @param {String}
* @param {Any} 
*/
.setPreference(key, value)

/**
* Returns the calendar note for the given date and timeframe (optional, the default is "day", see below for more options). Additionally, you can define a teamspace filename or ID as "parent" (third variable), to get the calendar note from that teamspace. By default, if undefined or empty, it will return the private calendar note. 
* @param {Date} 
* @param {String} - "day" (default), "week", "month", "quarter" or "year"
* @param {String?}
* @return {NoteObject}
*/
.calendarNoteByDate(date, timeframe, parent) 


/**
* Returns the calendar note for the given date string (can be undefined, if the calendar note was not created yet). See the date formats below for various types of calendar notes:
* Daily: "YYYYMMDD", example: "20210410"
* Weekly: "YYYY-Wwn", example: "2022-W24"
* Quarter: "YYYY-Qq", example: "2022-Q4"
* Monthly: "YYYY-MM", example: "2022-10"
* Yearly: "YYYY", example: "2022"
* Optionally define a teamspace with the "parent" variable using the ID or filename of the teamspace. By default it returns the private calendar note.
* @param {String} 
* @param {String?} 
* @return {NoteObject}
*/
.calendarNoteByDateString(dateString, parent)

/**
* Returns all regular notes with the given title (first line in editor). Since multiple notes can have the same title, an array is returned. Use 'caseSensitive' (default = false) to search for a note ignoring the case and set 'searchAllFolders' to true if you want to look for notes in trash and archive as well. By default NotePlan won't return notes in trash and archive.
* @param {String} 
* @param {Boolean} 
* @param {Boolean} 
* @return {[NoteObject]}
*/
.projectNoteByTitle(title, caseInsensitive, searchAllFolders)

/**
* Returns all regular notes with the given case insenstivie title (first line in editor). Since multiple notes can have the same title, an array is returned.
* @param {String} 
* @return {[NoteObject]}
*/
.projectNoteByTitleCaseInsensitive(title)
    

/**
* Returns the regular note for the given filename with file-extension, the filename has to include the relative folder such as `folder/filename.txt`. Use no folder if it's in the root (means without leading slash).
* @param {String} 
* @return {NoteObject}
*/
.projectNoteByFilename(filename)

/**
* Returns a regular or calendar note for the given filename. Type can be "Notes" or "Calendar". Include relative folder and file extension (`folder/filename.txt` for example).
* Use "YYYYMMDD.ext" for calendar notes, like "20210503.txt".
* Optionally define the teamspace using the "parent" variable. This should be the ID or filename of the teamspace, if empty or undefined, it will fetch the note from the private notes.
* @param {String} 
* @param {String} 
* @param {String?}
* @return {NoteObject}
*/
.noteByFilename(filename, type, parent)
     
/**
* Note: Available from v3.5.2
* Returns an array of paragraphs having the same blockID like the given one. You can use `paragraph[0].note` to access the note behind it and make updates via `paragraph[0].note.updateParagraph(paragraph[0])` if you make changes to the content, type, etc (like checking it off as type = "done")
* If you pass no paragraph as argument this will return all synced lines that are available.
* @param {ParagraphObject?}
* @return {[ParagraphObject]}
*/
.referencedBlocks(paragraph)
        
/**
* Move a regular note using the given filename (include extension and relative folder like `folder/filename.txt`, if it's in the root folder don't add a leading slash) to another folder. Use "/" for the root folder as destination.
* Returns the final filename (if the there is a duplicate, it will add a number).
* If you want to move a calendar note, use as type "calendar", by default it uses "note" (available from v3.9.3).
* @param {String} 
* @param {String} 
* @param {String} (default is "note")
* @return {String}
*/
.moveNote(filename, folder, type)
    
/**
* Available from v3.18.2
* Move a regular note using the given filename (include extension and relative folder like `folder/filename.txt`, if it's in the root folder don't add a leading slash) to the trash folder. 
* Returns true if successful.
* Calendar notes cannot be moved to trash.
* Teamspace notes are deleted immediately (teamspaces have no trash folder as of now), but a copy is made inside the system trash bin, if the user needs to recover the note.
* @param {String} 
* @return {Boolean}
*/
.trashNote(filename)

/**
* Creates a regular note using the given title and folder. Use "/" for the root folder. It will write the given title as "# title" into the new file.
* Returns the final filename with relative folder (`folder/filename.txt` for example). Ff the there is a duplicate, it will add a number.
* @param {String} 
* @param {String} 
* @return {String}
*/
.newNote(title, folder)
    
/**
* Creates a regular note using the given content and folder. Use "/" for the root folder. The content should ideally also include a note title at the top.
* Returns the final filename with relative folder (`folder/filename.txt` for example). Ff the there is a duplicate, it will add a number.
* Alternatively, you can also define the filename as the third optional variable (v3.5.2+)
* Note: Available from v3.5
* @param {String} 
* @param {String} 
* @param {String} (optional)
* @return {String}
*/
.newNoteWithContent(content, folder, filename) 

/**
* Note: Available from NotePlan v3.1+
* Save a JavaScript object as JSON file. The file will be saved under "[NotePlan Folder]/Plugins/data/[plugin-id]/[filename]".
* This can be used to save preferences or other persistent data. The JSON file will be synced by NotePlan.
* The filename is optional, if you don't use any filename, NotePlan will assume "settings.json".
* Returns true if the file could be saved, false if not and prints the error.
* @param {Object} 
* @param {String?} 
* @return {Boolean}
*/
.saveJSON(object, filename?)
    
/**
* Note: Available from NotePlan v3.1+
* Load a JavaScript object from a JSON file. The file has to be located in "[NotePlan Folder]/Plugins/data/[plugin-id]/[filename]".
* You can access the json files of other plugins as well, if the filename is known using relative paths "../[other plugin-id]/[filename]" or simply go into the "data"'s root directory "../[filename]" to access a global file.
* The filename is optional, if you don't use any filename, NotePlan will assume "settings.json".
* Returns undefined, if the JSON couldn't be loaded and prints an error message.
* @param {String?} 
* @return {Object?}
*/
.loadJSON(filename?)
    
/**
* Note: Available from NotePlan v3.3.2
* Loads the plugin related settings as a JavaScript object. If no settings file exists yet, this will create one from the settings schema in the plugin.json and use the default values. 
* The settings.json file is located in "[NotePlan Folder]/Plugins/data/[plugin-id]/[filename]".
* If no settings schema is available, it will return null.
* Read more about plugin settings here: https://help.noteplan.co/article/123-plugin-configuration
* this is a setter and getter, so you can also assign a JavaScript object and it will be saved in the settings file.
* @return {Object?}
*/
.settings
    
/**
* Note: Available from NotePlan v3.2+
* Save data to a file, as base64 string (optionally as plain string). The file will be saved under "[NotePlan Folder]/Plugins/data/[plugin-id]/[filename]".
* Returns true if the file could be saved, false if not and prints the error.
* @param {String} 
* @param {String}
* @param {Boolean} 
* @return {Boolean}
*/
.saveData(data, filename, saveAsString)
    
/**
* Note: Available from NotePlan v3.2+
* Load binary data from file encoded as base64 string (or optionally as plain string). 
* The file has to be located in "[NotePlan Folder]/Plugins/data/[plugin-id]/[filename]".
* You can access the files of other plugins as well, if the filename is known using relative paths "../[other plugin-id]/[filename]" or simply go into the "data"'s root directory "../[filename]" to access a global file.
* Returns undefined, if the file couldn't be loaded and prints an error message.
* @param {String} 
* @param {Boolean}
* @return {String?}
*/
.loadData(filename, loadAsString)
    
/**
* Note: Available from NotePlan v3.8.1+
* Checks the existence of a file in the data folder.
* The file has to be located in "[NotePlan Folder]/Plugins/data/[plugin-id]/[filename]".
* @param {String} 
* @return {Boolean}
*/
.fileExists(filename)
    
/**
 * Note: Available from NotePlan v3.5.2
 * Loads all available plugins asynchronously from the GitHub repository and returns a list. 
 * You can show a loading indicator using the first parameter (true) if this is part of some user interaction. Otherwise, pass "false" so it happens in the background.
 * Set `showHidden` to true if it should also load hidden plugins. Hidden plugins have a flag `isHidden`.
 * Set the third parameter `skipMatchingLocalPlugins` to true if you want to see only the available plugins from GitHub and not merge the data with the locally available plugins. Then the version will always be that of the plugin that is available online.
 * @param {Boolean} 
 * @param {Boolean} 
 * @param {Boolean} 
 * @return {Promise}
 */
.listPlugins(showLoading, showHidden, skipMatchingLocalPlugins)
    
/**
 * Note: Available from NotePlan v3.5.2
 * Installs a given plugin (load a list of plugins using `.listPlugins` first). If this is part of a user interfaction, pass "true" for `showLoading` to show a loading indicator.
 * @param {PluginObject} 
 * @param {Boolean} 
 * @return {Promise}
 */
.installPlugin(pluginObject, showLoading)
    
/**
 * Note: Available from NotePlan v3.5.2
 * Returns all installed plugins as PluginObject(s).
 * @return {[PluginObject]}
 */
.installedPlugins()
    
/**
 * Note: Available from NotePlan v3.6
 * Checks if the given pluginID is installed or not.
 * @param {String} 
 * @return {Boolean}
 */
.isPluginInstalledByID(pluginID)
    
/**
 * Note: Available from NotePlan v3.6
 * Installs a given array of pluginIDs if needed. It checks online if a new version is available and downloads it. 
 * Use it without `await` so it keeps running in the background or use it with `await` in "blocking mode" if you need to install a plugin as a dependency. In this case you can use `showPromptIfSuccessful = true` to show the user a message that a plugin was installed and `showProgressPrompt` will show a loading indicator beforehand. With both values set to false or not defined it will run in "silent" mode and show no prompts. Optionally display the user a failed prompt with the 4th variable.
 * Returns an object with the success/fail status and a description: `{ code: -1, message: "something went wrong" }` for example. Anything code >= 0 is a success.
 * @param {[String]} 
 * @param {Boolean} 
 * @param {Boolean} 
 * @param {Boolean} 
 * @return {Promise}
 */
.installOrUpdatePluginsByID([pluginID], showPromptIfSuccessful, showProgressPrompt, showFailedPrompt)
    
/**
 * Note: Available from NotePlan v3.5.2
 * Invoke a given command from a plugin (load a list of plugins using `.listPlugins` first, then get the command from the `.commands` list). 
 * If the command supports it, you can also pass an array of arguments which can contain any type (object, date, string, integer,...)
 * It returns the particular return value of that command which can be a Promise so you can use it with `await`.
 * @param {PluginCommandObject} 
 * @param {[Object]} 
 * @return {Return value of the command, like a Promise}
 */
.invokePluginCommand(command, arguments)
    
/**
 * Note: Available from NotePlan v3.5.2
 * Invoke a given command from a plugin using the name and plugin ID, so you don't need to load it from the list.
 * If the command doesn't exist locally null will be returned with a log message.
 * If the command supports it, you can also pass an array of arguments which can contain any type (object, date, string, integer,...)
 * This function expects that the called command returns some value. If it doesn't return anything naturally, you can return an empty object `{}`, or an error message will show up in the logs (which you can also ignore).
 * @param {String} 
 * @param {String} 
 * @param {[Object]} 
 * @return {Return value of the command, like a Promise}
 */
.invokePluginCommandByName(command, pluginId, arguments)
    
/**
 * Note: Available from NotePlan v3.6
 * This function is async, use it with `await`, so that the UI is not being blocked during a long search.
 * Searches all notes for a keyword in multiple threads to speed it up. By default it searches in project notes and in the calendar notes. Use the second parameters "types" to exclude a type. Otherwise, pass `null` or nothing.
 * Optionally pass a list of folders (`inNotes`) to limit the search to notes that ARE in those folders (applies only to project notes)
 * Optionally pass a list of folders (`notInFolders`) to limit the search to notes NOT in those folders (applies only to project notes)
 * Optionally include scheduled tasks (i.e. tasks with >today or >YYYY-MM-DD, etc.). This is by default off, if you turn it on with `true`, you might get results from excluded folders if they are referencing a calendar note.
 * Searches for keywords case-insensitive.
 * This supports advanced search (exact match, exclusions, groups, boolean OR) and search operators (so you can filter for tasks similar to the filters view), learn more here: https://help.noteplan.co/article/269-advanced-search
 * @param {String} = keyword to search for
 * @param {[String]?} = types: ["notes", "calendar"] (by default all, unless search operators are used, or pass `null`)
 * @param {[String]?} = array of folders
 * @param {[String]?} = array of folders
 * @param {Boolean}
 * @return {[ParagraphObject}
 */
.search(keyword, types, inFolders, notInFolders, shouldLoadDatedTodos)
    
/**
 * Note: Available from NotePlan v3.6
 * Convenience function for search
 * This function is async, use it with `await`, so that the UI is not being blocked during a long search.
 * Searches all project notes for a keyword in multiple threads to speed it up.
 * Optionally pass a list of folders (`inNotes`) to limit the search to notes that ARE in those folders (applies only to project notes)
 * Optionally pass a list of folders (`notInFolders`) to limit the search to notes NOT in those folders (applies only to project notes)
 * @param {String} = keyword to search for
 * @param {[String]?} = array of folders
 * @param {[String]?} = array of folders
 * @return {[ParagraphObject}
 */
.searchProjectNotes(keyword, inFolders, notInFolders)
    
/**
 * Note: Available from NotePlan v3.6
 * Convenience function for search
 * This function is async, use it with `await`, so that the UI is not being blocked during a long search.
 * Searches all calendar notes for a keyword in multiple threads to speed it up.
  * Optionally include scheduled tasks (i.e. tasks with >today or >YYYY-MM-DD, etc.). This is by default off, if you turn it on with `true`, you will get results from regular notes too.
 * @param {String} = keyword to search for
 * @param {Boolean}
 * @return {[ParagraphObject}
 */
.searchCalendarNotes(keyword, shouldLoadDatedTodos)
    
/**
 * Note: Available from NotePlan v3.7.1
 * Updates the cache, so you can access changes faster. And returns the updated note (from the update cache).
 * @param {NoteObject}
 * @param {Boolean}
 * @return {NoteObject}
 */
.updateCache(note, shouldUpdateTags)
    
/**
 * Note: Available from NotePlan v3.8
 * Creates a folder if it doesn't exist yet. Can be with subfolders like "main/sub1/sub2".
 * @param {String}
 * @return {Bool}
 */
.createFolder(folderPath)
    
/**
 * Note: Available from NotePlan v3.8.1
 * Returns all overdue tasks (i.e. tasks that are open and in the past). Use with await, it runs in the background. If there are a lot of tasks consider showing a loading bar.
 * You can optionally use a search keyword, if you are looking for a specific overdue task. It will search the content of the task for that string. Leave it blank otherwise.
 * @param {String} (optional)
 * @return {Promise - [Paragraph]}
 */
.listOverdueTasks(keyword)
```

</p>
</details>  

<details>
<summary>Examples</summary>
<p>

    
```javascript

function queryNotes() {
    try {
        // With note type parameters "Calendar" or "Notes"
    //    var note = DataStore.noteByFilename("20210411", "Calendar")

        // Using a date object
    //    var note = DataStore.calendarNoteByDate(new Date())

        // Using an ISO string "YYYYMMDD", with or without the file-extension
    //    var note = DataStore.calendarNoteByDateString("20210410")

        // Returns multiple notes potentially if the user has named multiple notes with the same title.
    //    var note = DataStore.projectNoteByTitle("TEST")[0]

        // Search for title - case insensitive
    //    var note = DataStore.projectNoteByTitleCaseInsensitive("test")[0]

        // Here the file-extension is important
        var note = DataStore.projectNoteByFilename("test.txt")
        // note.insertTodo("hello World", 9999) // Add a task at the end of the note
        printNote(note)

        // Get the default file extension for notes. It's a getter, the setter hasn't been implemented because it might cause chaos if it's not called through the preferences.
        var extension = DataStore.defaultFileExtension
        console.log("The default file extension for notes is: '" + extension + "'")
    } catch (error) {
      console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}

function createNewNote() {
    try {
        // DataStore.newNote(title, folder)
        let filename = DataStore.newNote("This is a test", "TEST")
        console.log("Created note with filename: " + filename)
    } catch (error) {
      console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}

// Note: Don't pass JS objects into the `CommandBar.show...` functions, NotePlan might crash. Only pass strings / array of strings.
async function createNoteWithCommandBarInput() {
    try {
        // CommandBar.showInput(placeholder, text of first result with variable for keyword, JS callback function)
        let title = await CommandBar.showInput("Enter title of the new note", "Create a new note with title = '%@'")
        let folder = (await CommandBar.showOptions(DataStore.folders, "Select a folder for '" + title + "'")).value

        if(title != undefined && title !== "") {
            var filename = DataStore.newNote(title, folder)
            console.log("Created note with filename: " + filename)
        } else {
            console.log("Reply undefined or empty: " + title)
            // Some error message
        }
    } catch (error) {
      console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}

function getPreferences() {
    console.log("isAsteriskTodo: " + DataStore.preference("isAsteriskTodo"))
}
    
function saveLoadJSON() {
    try {
        let filename = "pluginid-preferences.json"

        // Create an object
        let preferences = { a: "hello world", b: true }

        // Save object
        let success = DataStore.saveJSON(preferences, filename)

        // Load object
        let loadedObject = DataStore.loadJSON(filename)
        console.log(loadedObject.a)
    } catch (error) {
      console.log("Plugin code error: \n"+JSON.stringify(error))
    }
}

function testSettings() {
    let theSettings = DataStore.settings
    console.log(JSON.stringify(DataStore.settings))
    DataStore.settings = { hello: "world" }
    console.log(JSON.stringify(DataStore.settings))
    DataStore.settings = { }
    console.log(JSON.stringify(DataStore.settings))
}
    
function listTeamspaceCalendarNotes() {   
    // Get all teamspaces
  const teamspaces = DataStore.teamspaces
  console.log(`\n=== Found ${teamspaces.length} teamspaces ===\n`)

  // Use specific date string
  const dateString = "20250415"
  console.log(`Using date string: ${dateString}\n`)

  // For each teamspace, get the note and print content
  for (const teamspace of teamspaces) {
    console.log(`\nTeamspace: ${teamspace.title}`)

    // Get note for this teamspace
    const note = DataStore.calendarNoteByDateString(
      dateString,
      teamspace.filename
    )

    if (note) {
      // Print the first 100 characters of the note content
      const contentPreview = note.content
        ? note.content.substring(0, 100)
        : "No content"

      console.log(
        `\n"${contentPreview}${
          note.content && note.content.length > 100 ? "..." : ""
        }"`
      )
    } else {
      console.log(`No note found for this date in this teamspace`)
    }

    console.log(`\n${"=".repeat(50)}`)
  }
}
```
  
</p>
</details>
    
<details>
<summary>PluginObject</summary>
<p>
    
```javascript
/**
* ID of the plugin
* { get }
* @type {String}
*/
.id

/**
* Name of the plugin
* { get }
* @type {String}
*/
.name
    
/**
* Description of the plugin
* { get }
* @type {String}
*/
.desc
    
/**
* Author of the plugin
* { get }
* @type {String}
*/
.author
    
/**
* RepoUrl of the plugin
* { get }
* @type {String?}
*/
.repoUrl
    
/**
* Release page URL of the plugin (on GitHub)
* { get }
* @type {String?}
*/
.releaseUrl
    
/**
* Version of the plugin
* { get }
* @type {String}
*/
.version
    
/**
* This is the online data of the plugin. It might not be installed locally.
* { get }
* @type {Boolean}
*/
.isOnline
    
/**
* Script filename that contains the code for this plugin (like script.js)
* { get }
* @type {String}
*/
.script
    
/**
* If this is a locally installed plugin, you can use this variable to check if an updated version is available online.
* { get }
* @type {PluginObject}
*/
.availableUpdate
    
/**
* A list of available commands for this plugin.
* { get }
* @type {PluginCommandObject}
*/
.commands 
    
/**
* (Optional) Information about the last update.
* { get }
* @type {String?}
*/
.lastUpdateInfo
    
/**
* (Optional) List of required files.
* { get }
* @type {String?}
*/
.requiredFiles  
    
```
    
</p>
</details>
    
<details>
<summary>PluginCommandObject</summary>
<p>
    
```javascript
/**
* Name of the plugin command
* { get }
* @type {String}
*/
.name

/**
* Description of the plugin command
* { get }
* @type {String}
*/
.desc

/**
* ID of the plugin this command belongs to
* { get }
* @type {String}
*/
.pluginID
    
/**
* Name of the plugin this command belongs to.
* { get }
* @type {String}
*/
.pluginName
    
/**
* List of optional argument descriptions for the specific command. Use this if you want to invoke this command from another plugin to inform the user what he nees to enter for example.
* { get }
* @type {[String]}
*/
.arguments
```
    
</p>
</details>  
