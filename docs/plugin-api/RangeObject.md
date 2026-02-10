<details>
<summary>API</summary>
<p>

```javascript
RangeObject

/**
* Character start index of the range.
* @type {Int}
*/
.start

/**
* Character end index of the range.
* @type {Int}
*/
.end

/**
* Character length of the range (end - start).
* @type {Int}
*/
.length

/**
* Create an instance of a Range object with the start and end positions. The length variable is calculated automatically and doesn't have to be set.
* Example: Range.create(0, 10) 
* @param { Integer }
* @param { Integer }
* @return {RangeObject}
*/ 
.create(start, end)
```

</p>
</details>  

<details>
<summary>Examples</summary>
<p>

    
```javascript
function rangeOfParagraph() {
    let selection = Editor.selection
    let range = Editor.paragraphRangeAtCharacterIndex(selection.start)
    
    let text = "Location: " + range.start + ", length: " + range.length
    CommandBar.showOptions([text], "The paragraph range is:")
}
```
  
</p>
</details>  

