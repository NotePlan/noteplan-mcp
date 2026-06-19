# Swift bridge gaps — to eliminate the remaining macOS permission prompts

Context: the MCP server should never read NotePlan's sandboxed **container**
directly while the bridge is reachable, because for a sandboxed app that means
reaching into `~/Library/Containers/co.noteplan.NotePlan3/…` — which triggers
the macOS *"<app> would like to access data from other apps"* (TCC) prompt.

The MCP side already routes notes, calendar, search, tags, attachments,
filters, themes/plugins file I/O, storage-path/extension detection, and space
**reads** through the bridge. Two gaps remain that still touch the container.
Both are closed entirely by the Swift additions below. **No MCP update is
needed once these ship** — the current MCP already consumes them (optional
fields) and falls back gracefully when they're absent, so this MCP build is
compatible with both the current and the updated NotePlan.

---

## Gap 1 — Preferences in `GET /config` (HIGH priority)

The MCP needs first-day-of-week, task-marker config, and the active themes.
Today it reads them via `defaults read co.noteplan.NotePlan3 …`, which hits the
container. With a re-spawning client this can prompt on nearly every message.

**Add these OPTIONAL fields to the existing `/config` JSON response:**

| Field                  | Type            | Value / convention                                                                 |
|------------------------|-----------------|------------------------------------------------------------------------------------|
| `firstDayOfWeek`       | Int             | Raw NSCalendar weekday: **1 = Sunday … 7 = Saturday**. Same value `defaults read … firstDayOfWeek` returns. (MCP converts to JS `(v-1)%7`.) |
| `isAsteriskTodo`       | Bool            | Mirror of the `isAsteriskTodo` pref.                                               |
| `isDashTodo`           | Bool            | Mirror of the `isDashTodo` pref.                                                   |
| `defaultTodoCharacter` | String          | `"*"` or `"-"`.                                                                    |
| `themeLight`           | String          | Active light-mode theme filename, e.g. `"claude-light.json"`.                      |
| `themeDark`            | String          | Active dark-mode theme filename, e.g. `"claude-dark.json"`.                        |

Notes:
- All additive/optional. The MCP already tolerates their absence (it falls back
  to a disk-cached `defaults` read with a 3h TTL). Once present, the MCP uses
  them and **stops reading the container** for these values.
- Send the **raw** `firstDayOfWeek` (NSCalendar 1–7), not a pre-converted value
  — the MCP applies the conversion in one place for both sources.

MCP consumption: `BridgeConfig` (src/transport/bridge-client.ts) already declares
these as optional; `primePreferencesFromBridge` (src/noteplan/preferences.ts)
and `primeConfigFromBridge` read them at startup.

---

## Gap 2 — Teamspace write endpoints (LOWER priority)

Space **reads** already go through `/spaces/*` (GET). Space **writes** still open
`teamspace.db` read-write directly via `sqlite-writer.ts` (only on space-note /
space-folder mutations — not at startup or idle).

**Add POST endpoints mirroring these `sqliteWriter.*` operations** (consumed in
`src/noteplan/unified-store.ts`):

| MCP operation              | Suggested endpoint            | Params                                  |
|----------------------------|-------------------------------|-----------------------------------------|
| `createSpaceNote`          | `POST /spaces/note`           | `spaceId`, `title`, `content`           |
| `updateSpaceNote`          | `POST /spaces/note/update`    | `id`/`filename`, `content`              |
| `deleteSpaceNote`          | `POST /spaces/note/delete`    | `id`/`filename` (→ space @Trash)        |
| `moveSpaceNote`            | `POST /spaces/note/move`      | `id`, `destinationParentId`             |
| `updateSpaceNoteTitle`     | `POST /spaces/note/title`     | `id`, `newTitle`                        |
| `createSpaceCalendarNote`  | `POST /spaces/calendar`       | `spaceId`, `dateStr`, `content`         |
| `restoreSpaceNote`         | `POST /spaces/note/restore`   | `fromIdentifier`, `toIdentifier`        |
| `createSpaceFolder`        | `POST /spaces/folder`         | `spaceId`, `parentId`, `name`           |
| `moveSpaceFolder`          | `POST /spaces/folder/move`    | `folderId`, `destinationParentId`       |
| `deleteSpaceFolder`        | `POST /spaces/folder/delete`  | `folderId`                              |
| `renameSpaceFolder`        | `POST /spaces/folder/rename`  | `folderId`, `name`                      |

Each should return the affected row(s) in the existing `BridgeSpaceRow` shape so
the MCP's converter consumes them unchanged. The MCP would then route space
writes through `bridgeOrFallback`, the same pattern space reads already use.

---

## Summary of MCP-side state (already shipped in this build)

- **Startup / idle:** no container access (space-DB gate + config priming).
- **Notes / calendar / search / tags / attachments / filters / themes / plugins:**
  bridge-first; container only when the bridge is down.
- **Preferences (first-day-of-week, task markers):** bridge → 3h disk cache →
  lazy `defaults`. Worst case on the current NotePlan: **one prompt per ~3h**,
  persisted across re-spawns. Gap 1 takes this to **zero**.
- **Themes current light/dark:** from the bridge when available, else `null`
  (no container read). Gap 1 restores the real values with zero prompts.
- **Space writes:** still direct (Gap 2).
