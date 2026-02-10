Global functions and variables for NotePlan

<details>
<summary>API</summary>
<p>

```javascript
/**
* Note: Available from v3.3.2
* Returns the environment information:
*   .languageCode {String?}
*   .regionCode {String?}
*   .is12hFormat {Bool}
*   .preferredLanguages {[String]}
*   .secondsFromGMT {Int}
*   .localTimeZoneAbbreviation {String}
*   .localTimeZoneIdentifier: {String} 
*   .isDaylightSavingTime {Bool}
*   .daylightSavingTimeOffset: {Double}
*   .nextDaylightSavingTimeTransition: {Date}
*   .platform: {String = "macOS" | "iPadOS" | "iOS"}
*   .hasSettings: {Bool}
*   .version: {String}, NotePlans version, for example "3.4.1"
*   .versionNumber: {Integer}, NotePlans version,for example 341
*   .buildVersion: {Integer}, NotePlans build number,for example 730
*   .templateFolder: {String}, relative path to the template folder = "@Templates"
*   .machineName: {String}, name of the device, like 'macbook-pro.local', available in v3.9.7
*   .screenWidth: {number}, available in v3.9.7
*   .screenHeight: {number}, available in v3.9.7
    .osVersion: {String}, available in v3.18.1
*/
.environment
    
/**
* Note: Available from v3.15.1
* This is an async function, use it with "await". Sends a prompt to OpenAI and returns the result. 
* Optionally send the content of notes as well to process by specifying them in the list 'filenames', which is an array. For example ["note1.md", "folder/note2.md"]. This needs to be the exact path to the note. Your note extension might differ, the default is .txt, if you haven't changed it.
* For calendar notes, you can use YYYYMMDD.md, like 20241101.md, or 2024-W10.md for weeks, etc. Natural language input is also supported like "this week", "today", "tomorrow", "this month", "next year", etc.
* Available from v3.16.3:
* Use a relative expression as filename to get the "last 7 days" for example. It will search for the daily notes of the last 7 days in this case. This string needs to have exactly this form: 1. use "next" or "last", 2. define a number, like "7", 3. define one of the timeframes: "days", "weeks", "months", "quarters", "years".
* Filenames also support folders, they need to be prefixed with a slash "/", like "/Projects/Work".
* Define an OpenAI model using the "model" variable. Works only if you set your own key. Then you can set it to "o1" for example and use one of the most advanced models.
* @param { String }
* @param { String[] }
* @param { Boolean }
* @param { String } 
* @return {Promise<String>}
*/
.ai(prompt, filenames, useStrictFilenames, model)
    
/**
* Note: Available from v3.5
* If a folder is selected in the sidebar on Mac, it returns the folder name as string, if something else is selected it returns nil.
* @return {String?}
*/
.selectedSidebarFolder  

/**
* Note: Available from v3.3.2
* Opens the configuration view for the currently executing plugin. If no settings are available in the plugin.json, the promise will fail.
* As of 3.3.2 this is only available on macOS. You can check if this particular plugin has settings and if the platform is macOS using the environment variable.
* See the examples section for more.
* @return {Promise}
*/
.showConfigurationView()
 
/**
* Note: Available from v3.5
* Reloads the cached files and rebuilds the sidebar. Use it in case there are inconsistencies in the sidebar.
*/
.resetCaches()
    
/**
* Note: Available from v3.5.2
* Opens the given URL using the default browser (x-callback-urls can also be triggered with this).
*/
.openURL(url)
    
    
/**
* Note: Available from v3.7.2
* Returns the ranges that have changed between the two versions.
* @param { String }
* @param { String }
* @return {[RangeObject]}
*/
.stringDiff(version1, version2)


/**
* Note: Available from v3.8.1
* Returns a list of all opened editors (in the main view, in split views and in floating windows). See more details in the "Editor" documentation.
* @return { [Editor] }
*/
.editors


/**
 * Returns a list of all opened HTML windows, including both standalone windows and embedded views
 * (main content area and split views).
 * 
 * An HTML window has the same window functions like an editor: focus(), close(), id { get }, customId { get set }
 * 
 * Properties:
 * - id {String}: Unique identifier for the window (UUID for embedded views, window UUID for standalone)
 * - customId {String}: The developer-assigned window ID (set via options when opening the view).
 *   Use this for finding windows by ID in helper functions like isHTMLWindowOpen().
 * - type {String}: Always returns "html"
 * - displayType {String}: The display type of the window. Returns one of:
 *   - "window": Standalone window
 *   - "sheet": Modal sheet presentation
 *   - "mainView": Embedded in main content area
 *   - "splitView": Embedded in split view
 * - windowRect {Object}: Window frame coordinates (only for standalone windows; returns {} for embedded views)
 * 
 * Methods:
 * - focus(): Brings the window to front and focuses it. For embedded views, this will open/show
 *   the view if it's not currently visible (same behavior as clicking the sidebar item).
 * - close(): Closes the window. For embedded views, this removes them from the sidebar and cleans up.
 * - runJavaScript(code: String): Executes JavaScript code in the window's WebView. Returns a Promise.
 * 
 * @return {Array<HTMLWindowObject>} Array of HTML window objects
 * 
 * @example
 * // Find a window by customId and interact with it
 * const myWindow = NotePlan.htmlWindows.find(w => w.customId === "my-plugin-window");
 * if (myWindow) {
 *   console.log(`Found window: ${myWindow.customId}, displayType: ${myWindow.displayType}`);
 *   myWindow.focus(); // Opens/focuses the window
 *   myWindow.runJavaScript("console.log('Hello from plugin!');"); // Execute JavaScript
 * }
 * 
 * @example
 * // Check if a window is open and close it
 * const targetWindow = NotePlan.htmlWindows.find(w => w.customId === "my-window-id");
 * if (targetWindow) {
 *   targetWindow.close(); // Closes standalone windows or removes embedded views from sidebar
 * }
 */
.htmlWindows
    
/**
 * Note: Available from v3.19.2
 * Toggles the sidebar visibility on iOS and macOS.
 * 
 * @param {boolean} forceCollapse - If true, forces the sidebar to hide/collapse.
 * @param {boolean} forceOpen - If true, forces the sidebar to show/expand.
 * @param {boolean} animated - If true (default), animates the sidebar toggle. If false, instantly shows/hides without animation (macOS only).
 * 
 * Note: If both forceCollapse and forceOpen are true, forceOpen takes precedence on macOS.
 * 
 * @example
 * // Toggle the sidebar (show if hidden, hide if shown)
 * NotePlan.toggleSidebar(false, false, true);
 * 
 * @example
 * // Force show/open the sidebar with animation
 * NotePlan.toggleSidebar(false, true, true);
 * 
 * @example
 * // Force hide/collapse the sidebar with animation
 * NotePlan.toggleSidebar(true, false, true);
 * 
 * @example
 * // Force hide the sidebar without animation (macOS only)
 * NotePlan.toggleSidebar(true, false, false);
 */
.toggleSidebar(forceCollapse, forceOpen, animated)
    
/**
 * Note: Available from v3.19.2 (macOS only)
 * Sets the width of the sidebar in pixels.
 * The width is persisted and will be applied when the sidebar is visible.
 * 
 * @param {number} width - The width in pixels (e.g., 250)
 * 
 * @example
 * // Set sidebar width to 300 pixels
 * NotePlan.setSidebarWidth(300);
 * 
 * @example
 * // Set sidebar to a narrow width
 * NotePlan.setSidebarWidth(200);
 */
.setSidebarWidth(width)

/**
 * Note: Available from v3.19.2 (macOS only)
 * Gets the current width of the sidebar in pixels.
 * Returns 0 on iOS/iPadOS or if the sidebar is not available.
 * 
 * @return {number} The current sidebar width in pixels
 * 
 * @example
 * // Get the current sidebar width
 * const currentWidth = NotePlan.getSidebarWidth();
 * console.log(`Sidebar width: ${currentWidth}px`);
 * 
 * @example
 * // Double the sidebar width
 * const currentWidth = NotePlan.getSidebarWidth();
 * NotePlan.setSidebarWidth(currentWidth * 2);
 */
.getSidebarWidth()
    

/**
 * Note: Available from v3.19.2 (macOS only)
 * Checks whether the sidebar is currently collapsed.
 * Returns false on iOS/iPadOS or if the sidebar is not available.
 * 
 * @return {boolean} true if the sidebar is collapsed, false otherwise
 * 
 * @example
 * // Check if sidebar is collapsed
 * if (NotePlan.isSidebarCollapsed()) {
 *   console.log("Sidebar is collapsed");
 * } else {
 *   console.log("Sidebar is visible");
 * }
 * 
 * @example
 * // Toggle sidebar only if it's currently collapsed
 * if (NotePlan.isSidebarCollapsed()) {
 *   NotePlan.toggleSidebar(false, true, true);
 * }
 */
.isSidebarCollapsed()
    
/**
 * Note: Available from v3.19.2
 * Fetches current weather data and forecast using OpenWeatherMap API.
 * Automatically detects location via IP geolocation or uses provided coordinates.
 * Returns formatted weather information with emojis and detailed weather data.
 * 
 * @param {string} units - Temperature units: "metric" (Celsius, m/s) or "imperial" (Fahrenheit, mph).
 *                          If empty or invalid, defaults to locale's measurement system preference.
 * @param {number} latitude - Latitude coordinate (use 0 or NaN for IP-based location detection)
 * @param {number} longitude - Longitude coordinate (use 0 or NaN for IP-based location detection)
 * @return {Promise<Object>} Promise that resolves to weather data object with formatted output and detailed information.
 *                           On error, still resolves with a formatted error message in the `formatted` field.
 * 
 * @example
 * // Get weather for current location (IP-based) using await
 * const weather = await NotePlan.getWeather("", 0, 0);
 * console.log(weather.formatted);
 * // Output:
 * // ### San Francisco Weather for Tue, 2025-10-28
 * // ☀️ **Clear Sky** - High: **18°C**, Low: **12°C**, Wind: **8m/s**, Visibility: **10km**
 * // 🌅 Sunrise: **7:15 AM**, Sunset: **6:30 PM**, Peak UVI: **5**
 * 
 * @example
 * // Get weather for specific location (New York City) with error handling
 * try {
 *   const weather = await NotePlan.getWeather("imperial", 40.7128, -74.0060);
 *   console.log(`${weather.emoji} ${weather.condition}`);
 *   console.log(`Temperature: ${weather.temperature}${weather.temperatureUnit}`);
 *   console.log(`High: ${weather.highTemp}, Low: ${weather.lowTemp}`);
 *   console.log(`Humidity: ${weather.humidity}%`);
 *   console.log(`Wind: ${weather.windSpeed}${weather.windSpeedUnit}`);
 *   console.log(`Location: ${weather.cityName}, ${weather.state}, ${weather.country}`);
 * } catch (error) {
 *   console.log("Error fetching weather:", error);
 * }
 * 
 * @example
 * // Get weather for London and insert into editor
 * const weather = await NotePlan.getWeather("metric", 51.5074, -0.1278);
 * Editor.insertTextAtCursor(weather.formatted);
 * 
 * @example
 * // Use locale-based units (empty string auto-detects)
 * const weather = await NotePlan.getWeather();
 * console.log(weather.formatted);
 * 
 * @returns {Object} weather - Weather data object
 * @returns {string} weather.formatted - Pre-formatted markdown weather output with emojis (or error message on failure)
 * 
 * @returns {string} weather.cityName - City name (from IP location or reverse geocoding)
 * @returns {string} weather.state - State/administrative area
 * @returns {string} weather.region - Region/sub-administrative area
 * @returns {string} weather.country - Country name
 * @returns {string} weather.countryCode - ISO country code
 * @returns {string} weather.postalCode - Postal/ZIP code
 * @returns {string} weather.subLocality - Sub-locality
 * @returns {string} weather.thoroughfare - Street address
 * 
 * @returns {string} weather.ipAddress - IP address used for geolocation (only when using IP-based detection)
 * @returns {number} weather.ipVersion - IP version (4 or 6, only when using IP-based detection)
 * @returns {string} weather.capital - Capital city of the country (only when using IP-based detection)
 * @returns {Array<string>} weather.phoneCodes - Phone country codes (only when using IP-based detection)
 * @returns {Array<string>} weather.timeZones - Time zones (only when using IP-based detection)
 * @returns {string} weather.continent - Continent name (only when using IP-based detection)
 * @returns {string} weather.continentCode - Continent code (only when using IP-based detection)
 * @returns {Array<string>} weather.currencies - Currency codes (only when using IP-based detection)
 * @returns {Array<string>} weather.languages - Language codes (only when using IP-based detection)
 * @returns {string} weather.asn - Autonomous System Number (only when using IP-based detection)
 * @returns {string} weather.asnOrganization - ASN organization name (only when using IP-based detection)
 * @returns {boolean} weather.isProxy - Whether the IP is a proxy (only when using IP-based detection)
 * 
 * @returns {number} weather.temperature - Current temperature
 * @returns {string} weather.temperatureUnit - Temperature unit symbol (°C or °F)
 * @returns {number} weather.apparentTemperature - Feels-like temperature
 * @returns {number} weather.humidity - Humidity percentage
 * @returns {number} weather.windSpeed - Wind speed
 * @returns {string} weather.windSpeedUnit - Wind speed unit (m/s or mph)
 * @returns {number} weather.windDirection - Wind direction in degrees
 * @returns {number} weather.uvIndex - UV index
 * @returns {string} weather.condition - Weather condition description
 * @returns {string} weather.emoji - Weather emoji based on condition
 * @returns {string} weather.iconCode - OpenWeatherMap icon code
 * @returns {number} weather.visibility - Visibility distance
 * @returns {string} weather.visibilityUnit - Visibility unit (km)
 * @returns {number} weather.highTemp - Today's high temperature
 * @returns {number} weather.lowTemp - Today's low temperature
 * @returns {string} weather.sunrise - Sunrise time (formatted as h:mm AM/PM)
 * @returns {string} weather.sunset - Sunset time (formatted as h:mm AM/PM)
 * 
 * @returns {Object} weather.location - Complete location information object
 * @returns {number} weather.location.latitude - Latitude
 * @returns {number} weather.location.longitude - Longitude
 * @returns {string} weather.location.cityName - City name
 * @returns {string} weather.location.state - State/administrative area
 * @returns {string} weather.location.region - Region/sub-administrative area
 * @returns {string} weather.location.country - Country name
 * @returns {string} weather.location.countryCode - ISO country code
 * @returns {string} weather.location.postalCode - Postal/ZIP code
 * @returns {string} weather.location.subLocality - Sub-locality
 * @returns {string} weather.location.thoroughfare - Street address
 * @returns {string} weather.location.ipAddress - IP address (only when using IP-based detection)
 * @returns {number} weather.location.ipVersion - IP version (only when using IP-based detection)
 * @returns {string} weather.location.capital - Capital city (only when using IP-based detection)
 * @returns {Array<string>} weather.location.phoneCodes - Phone country codes (only when using IP-based detection)
 * @returns {Array<string>} weather.location.timeZones - Time zones (only when using IP-based detection)
 * @returns {string} weather.location.continent - Continent name (only when using IP-based detection)
 * @returns {string} weather.location.continentCode - Continent code (only when using IP-based detection)
 * @returns {Array<string>} weather.location.currencies - Currency codes (only when using IP-based detection)
 * @returns {Array<string>} weather.location.languages - Language codes (only when using IP-based detection)
 * @returns {string} weather.location.asn - Autonomous System Number (only when using IP-based detection)
 * @returns {string} weather.location.asnOrganization - ASN organization name (only when using IP-based detection)
 * @returns {boolean} weather.location.isProxy - Whether the IP is a proxy (only when using IP-based detection)
 */
.getWeather(units, latitude, longitude)
```

</p>
</details>  

<details>
<summary>Examples</summary>
<p>

    
```javascript
function showEnvironment() {
  console.log("NotePlan.environment.languageCode: " + NotePlan.environment.languageCode)
  console.log("NotePlan.environment.preferredLanguages: " + NotePlan.environment.preferredLanguages)
  console.log("NotePlan.environment.regionCode: " + NotePlan.environment.regionCode)
  console.log("NotePlan.environment.is12hFormat: " + NotePlan.environment.is12hFormat)
  console.log("NotePlan.environment.secondsFromGMT: " + NotePlan.environment.secondsFromGMT)
  console.log("NotePlan.environment.localTimeZoneAbbreviation: " + NotePlan.environment.localTimeZoneAbbreviation)
  console.log("NotePlan.environment.localTimeZoneIdentifier: " + NotePlan.environment.localTimeZoneIdentifier)
  console.log("NotePlan.environment.isDaylightSavingTime: " + NotePlan.environment.isDaylightSavingTime)
  console.log("NotePlan.environment.daylightSavingTimeOffset: " + NotePlan.environment.daylightSavingTimeOffset)
  console.log("NotePlan.environment.nextDaylightSavingTimeTransition: " + NotePlan.environment.nextDaylightSavingTimeTransition)
  console.log("NotePlan.environment.hasSettings: " + NotePlan.environment.hasSettings)
  console.log("NotePlan.environment.platform: " + NotePlan.environment.platform)
}
  
function showConfiguration() {
  if(NotePlan.environment.hasSettings && NotePlan.environment.platform == "macOS") {
    await NotePlan.showConfigurationView().catch(e => console.log(e))
    console.log("user finished configuring")
  } else {
    console.log("this plugin has no settings or we are running iOS")
  }  
}
    
async function onEdit(note) {
  console.log("\n")
  console.log("onEdit triggered, note: '" + note.filename + "'")

  // Get changed ranges
  const ranges = NotePlan.stringDiff(note.versions[1].content, note.versions[0].content)
  console.log("Changed content from index: " + ranges[0].start + " to: " + ranges[0].end)
  console.log("\n")
}

function randomBulletWithAI() {
    // Calls OpenAI with the given prompt and the content of this year's note to fetch a random bullet
    const text = await NotePlan.ai("Return a bullet. Not just the first one, make it random", ["this year"])
    return text
}
```
  
</p>
</details>  

