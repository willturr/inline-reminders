# Inline Reminders for Obsidian

Set reminders directly in note text, receive macOS notifications, and browse a list of upcoming and overdue reminders.

```markdown
Call the dentist @remind(2026-10-23 09:00)

- [ ] Send the proposal @remind(2026-10-24 14:30)
- [x] Completed tasks are ignored @remind(2026-10-24 14:30)
```

## Install

Requires desktop Obsidian 1.5.0 or newer. The release ZIP includes a compiled `main.js`; Node.js is only needed for development.

1. Extract `inline-reminders.zip`.
2. Copy the extracted `inline-reminders` folder into your vault’s `.obsidian/plugins/` folder. In Finder, press **⌘⇧.** to show hidden folders. Create `plugins` if needed.
3. Verify that `.obsidian/plugins/inline-reminders/main.js`, `manifest.json`, and `styles.css` exist directly inside that folder.
4. Reload Obsidian. Open **Settings → Community plugins**, turn on community plugins if necessary, and enable **Inline Reminders**.
5. Open **Settings → Inline Reminders** and click **Send test**. Allow notifications if prompted. In **macOS System Settings → Notifications → Obsidian**, enable notifications and your preferred banner style.

The plugin is a local installation; it has not been published to the Obsidian community directory.

To update an existing installation, replace `main.js`, `manifest.json`, and `styles.css`, then reload Obsidian. Keep `data.json` to preserve reminder history. Version 1.0.2 adds date autocomplete; no history migration is required.

## Set a reminder

Type `@remind(YYYY-MM-DD HH:mm)` anywhere in a Markdown note. The reminder message comes from the rest of that line. It works with plain text, headings, and unchecked tasks. A line containing only a reminder uses the note name as its message.

Reminder markers are highlighted in the editor (Live Preview and Source mode) and reading view using your theme’s highlight color. The highlight appears as soon as you type `@remind` and extends across the date while you type. Highlighting is visual; a valid date and time are still required to schedule a reminder.

Type `@remind` to open date suggestions, or enter a phrase inside `@remind(...)`. Arrow keys navigate; **Enter** or **Tab** accepts; **Escape** leaves the text unchanged. The popup starts with **In 15 minutes**, **In 1 hour**, **Tomorrow at 9am**, and **Choose date…**. Each date suggestion previews its exact local date and time.

Supported autocomplete phrases:

| Input inside `@remind(...)` | Suggested date |
| --- | --- |
| `today`, `tomorrow` | That day at 9am, if still in the future |
| `Friday`, `fri` | Next future Friday at 9am, including today if applicable |
| `tomorrow 9am`, `Friday at 14:00` | Specified day and time |
| `tomorrow 2:30pm` | Tomorrow at 14:30 |
| `in 30 minutes`, `in 2 hours` | That duration from when the suggestion was shown |
| `in 15m`, `in 2hr` | Abbreviated duration |

Phrases are case-insensitive. Date-only phrases default to **9am**. Times accept 24-hour `HH:mm` or 12-hour `h[:mm]am/pm`. Weekdays accept their full name or first three letters. Relative durations require a positive whole number of minutes or hours. Typing a prefix such as `tom` or `fri` filters day suggestions. Existing absolute timestamp formats below also work in autocomplete. Unsupported input still offers **Choose date…**.

Accepting a suggestion writes a complete absolute marker with an explicit timezone offset, for example `@remind(2026-11-02 09:00+00:00)`. The selected instant matches the preview and stays fixed if you later travel or change timezone. The popup does not save relative phrases or silently reschedule existing reminders. Past dates and invalid daylight-saving times are not suggested.

Choose **Choose date…**, or select **Inline Reminders: Insert reminder** in Obsidian’s command palette (**⌘P**), to open a future date and time picker. Autocomplete replaces the current marker, including an existing closing parenthesis. The command inserts after your selection or at the captured cursor position. Acceptance is a single undoable edit. If the note changes or you switch notes while the picker is open, close it and try again. Assign a command shortcut in **Settings → Hotkeys** if desired.

Supported timestamps:

| Example | Meaning |
| --- | --- |
| `@remind(2026-10-23 09:00)` | 9am in the Mac’s current local timezone |
| `@remind(2026-10-23T09:00)` | Same, with an ISO date separator |
| `@remind(2026-10-23T09:00Z)` | 9am UTC |
| `@remind(2026-10-23T09:00+01:00)` | 9am at a fixed UTC+1 offset |
| `@remind(2026-10-23 09:00:30)` | Includes optional seconds |

Use a full date and time in saved notes. Ambiguous dates such as `10/11/26`, natural language left unaccepted such as `@remind(tomorrow)`, impossible dates, and local times skipped by a daylight-saving change are ignored by the scheduler. At a repeated autumn clock-change time, a manually written local timestamp selects the earlier occurrence; use an explicit offset to choose precisely. Local timestamps without offsets are interpreted when a note is indexed. After changing the Mac’s timezone, use **Rescan reminders** or reload the vault.

Reminders inside frontmatter, fenced code, inline code, and HTML comments are ignored. Checked `[x]` and `[X]` tasks do not notify or appear in the list. To cancel a plain-text reminder, remove its marker.

## View and manage reminders

Click the **bell icon** in the left ribbon or run **Inline Reminders: Show upcoming reminders**. The sidebar shows all undismissed reminders, earliest first, with overdue items marked. Filter by reminder text or note path. Click a reminder to jump to its line in the note.

**Dismiss** hides that reminder and prevents its future notification. It leaves your note unchanged. An **Undo** button is available for eight seconds. For a task, checking its checkbox is another way to remove the reminder. Alerts remain in the list after delivery until dismissed, checked off, or removed from the note.

Change the timestamp to reschedule a reminder. The new timestamp is treated as a new reminder, even if the previous one was delivered or dismissed.

## Notifications and timing

- Native notifications appear under **Obsidian** in macOS Notification Center. Click one to open the note. Four or more simultaneously due reminders are grouped into one alert that opens the list.
- The plugin checks every ten seconds and when the app regains focus. Notes are re-indexed shortly after edits. Background throttling can delay checks.
- **Obsidian must be running, the vault must be open, and the plugin must be enabled.** The plugin cannot alert while Obsidian is quit, the vault is closed, or the Mac is asleep. Missed reminders are caught up on the next check after reopening or waking.
- If desktop permission is blocked or the API fails, a clickable reminder appears inside Obsidian instead. Delivery is recorded once when an alert is attempted; macOS Focus modes or OS settings may suppress a banner without informing the plugin.
- Delivery and dismissal status are saved in `.obsidian/plugins/inline-reminders/data.json`, so normal restarts do not repeat alerts. Removing that file resets this history. Synced copies of the vault running on multiple devices each run their own scheduler and may both notify.
- Notes and reminder history remain local. The plugin makes no network requests and only modifies note content when you accept autocomplete or use **Insert reminder**. Notification previews contain reminder text; control lock-screen previews in macOS settings.

Reminder identity uses the note path, written timestamp, and occurrence of that same timestamp within the note. Moving a line or editing its message preserves status. File and folder renames inside Obsidian preserve status. If several reminders in one note have the exact same timestamp, deleting or reordering them can transfer status between those occurrences; use distinct timestamps to avoid that ambiguity. Moving a reminder to another note creates a new reminder.

## Commands

- **Show upcoming reminders** — open the list.
- **Insert reminder** — choose a date and insert a marker.
- **Enable and test desktop notifications** — request permission and send a sample alert.
- **Rescan reminders** — re-index all Markdown notes and retry unreadable notes.

## Develop

The source archive includes TypeScript, focused tests, and a lockfile. Use Node.js 20 or newer:

```sh
npm ci
npm test
npm run build
```

`npm run dev` watches and rebuilds `main.js`. The release bundles plugin code into a CommonJS file and leaves Obsidian and its CodeMirror editor modules external, as required by the host. There are no separately installed runtime packages.

Automated tests cover autocomplete phrases and offsets, marker replacement and keyboard acceptance, picker cancellation and stale-note protection, date validation and daylight saving, Markdown exclusions, reminder identity, saved-state validation, scheduling, notification permission and fallback behavior, and plugin lifecycle races. TypeScript checks use Obsidian 1.14.4 API definitions. Native macOS banner delivery requires a manual test in your installed Obsidian app.

Autocomplete was also verified in Obsidian 1.14.4 on macOS in an isolated test vault: popup previews, arrow navigation, Enter and Tab acceptance, Escape dismissal, single-step undo, date-picker cancellation and submission, and the existing Insert reminder command all passed. The test vault was closed after verification.

API references: [Obsidian plugin setup](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin), [plugin lifecycle](https://docs.obsidian.md/plugins/guides/lifecycle-management), [Electron desktop notifications](https://github.com/electron/electron/blob/main/docs/tutorial/notifications.md).

MIT licensed. See `LICENSE`.
