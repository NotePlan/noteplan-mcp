Clipboard.md

<details>
<summary>API</summary>
<p>

```javascript
Clipboard

/**
* Get or set the current text of the clipboard.
* @type {String}
*/
.string

/**
* Returns a list of types. 
* @type {[String]}
*/
.types

/**
* Set the text of the clipboard using a specific type.
* @param {String} 
* @param {String} 
*/
.setStringForType(string, type)

/**
* Get the text in the clipboard accessing a specific type.
* @param {String} 
* @return {String}
*/
.stringForType(type)
    
/**
* Set the data as base64 string for a specific type like an image or RTF.
* @param {String} 
* @param {String} 
*/
.setBase64DataStringForType(base64String, type)
    
/**
* Get the base64 data string for a specific type like an image or RTF from the clipboard.
* @param {String} 
* @return {String}
*/
.base64DataStringForType(type)

/**
* Get the data in the clipboard accessing a specific type.
* @param {String} 
* @return {Data}
*/
.dataForType(type)

/**
* Set the data in the clipboard for a specific type.
* @param {Data}
* @param {String} 
*/
.setDataForType(data, type)

/**
* Clears the contents of the clipboard.
*/
.clearContents()

/**
* Pass in the types you are interested in and get the available type back.
* @param {[String]} 
* @return {String}
*/
.availableType(fromTypes)

```

</p>
</details>  

<details>
<summary>Examples</summary>
<p>

    
```javascript

function test() {
    console.log("inside the clipboard: " + Clipboard.string)
    Clipboard.string = "hello world"
}

function seeTypes() {
    console.log("types: " + Clipboard.types)
}

```
  
</p>
</details>  

