# Inline Reminders for Obsidian

Set reminders in note text, receive macOS notifications, and view upcoming reminders.

<img width="619" height="338" alt="Screenshot 2026-10-26 at 15 31 53" src="https://github.com/user-attachments/assets/a0ae33d7-fa9a-4a1e-960d-15a199245844" />

<br>
<br>

```markdown
Call the dentist @remind(2026-11-02 09:00)
- [ ] Send the proposal @remind(tomorrow)
```

## Install or update

Requires **desktop Obsidian 1.5.0+**. This plugin is installed manually.

1. Extract `inline-reminders.zip` into your vault’s `.obsidian/plugins/` folder. The resulting `inline-reminders` folder must contain `main.js`, `manifest.json`, and `styles.css`. In Finder, **⌘⇧.** shows hidden folders.
2. Reload Obsidian and enable **Inline Reminders** in **Settings → Community plugins**.
3. In **Settings → Inline Reminders**, click **Send test**. Allow Obsidian notifications in **macOS System Settings → Notifications**.

To update, replace those three files and reload. **Keep `data.json`** to preserve reminder history.

## Set reminders

Type `@remind` for date suggestions, or enter a phrase inside `@remind(...)`:

| Input | Result |
| --- | --- |
| `today`, `tomorrow` | That day at **9am** |
| `Friday`, `fri` | Next future Friday at 9am, including today if applicable |
| `tomorrow 9am`, `Friday at 14:00` | The specified day and time |
| `in 30 minutes`, `in 2hr` | A relative duration |

Phrases are case-insensitive. Times accept 24-hour `HH:mm` or 12-hour `h[:mm]am/pm`; durations use positive whole minutes or hours. Prefixes such as `tom` filter suggestions. Only future, valid times are offered.

Use arrow keys to navigate, **Enter/Tab** to accept, and **Escape** to dismiss. Each suggestion previews the exact date and time. Acceptance writes a fixed timestamp with a timezone offset; **unaccepted phrases do not schedule reminders**.

Choose **Choose date…** or run **Inline Reminders: Insert reminder** (**⌘P**) for the date picker. Completion replaces the current marker; the command inserts at the captured cursor position. Both support single-step undo. If the note changes while the picker is open, reopen it.

You can also write timestamps directly:

- `@remind(2026-11-02 09:00)` — local time.
- `@remind(2026-11-02T09:00Z)` — UTC.
- `@remind(2026-11-02 09:00+01:00)` — fixed offset.

`T` may replace the space; seconds are optional. Invalid dates and daylight-saving gaps are ignored. Local timestamps in a repeated autumn hour choose its earlier occurrence. Use an explicit offset for precision; run **Rescan reminders** after changing timezone if using offset-free timestamps.

The rest of the line becomes the reminder message, or the note name if empty. Markers highlight in editing and reading views, even before a valid date is entered. Checked tasks, frontmatter, fenced/inline code, and HTML comments are ignored by the scheduler.

## View and manage

Click the **bell icon** or run **Show upcoming reminders**. The sidebar sorts reminders by date, marks overdue items, filters by text or note path, and opens a reminder’s line when clicked.

**Dismiss** hides a reminder without editing the note; **Undo** is available for eight seconds. Delivered reminders stay listed until dismissed, checked off, or removed. Remove the marker to cancel; change its timestamp to reschedule.

## Notifications and limits

- **Obsidian must be running with the vault open and plugin enabled.** Checks run every ten seconds; background throttling can delay them. Missed reminders catch up after reopening or waking the Mac.
- Notifications appear under **Obsidian**. Individual alerts open their note; grouped alerts (four or more due reminders) open the list.
- Blocked or failed desktop notifications fall back to an in-app alert. Focus modes can suppress banners without triggering a retry.
- Delivery/dismissal history lives in `data.json`; deleting it resets history. Multiple devices running the same synced vault may each notify.
- Everything stays local; there are no network requests. Notification previews contain reminder text.

Editing messages, moving lines, and renaming files/folders inside Obsidian preserve status. Moving a reminder to another note creates a new reminder. Reordering/deleting reminders with identical timestamps in one note can transfer their status; use distinct timestamps to avoid this.

## Develop

Use Node.js 20+ in the source folder:

```sh
npm ci
npm test
npm run build
```

`npm run dev` watches for changes. Autocomplete was tested in Obsidian 1.14.4 on macOS; native notification banners still require a manual check.

MIT licensed; see `LICENSE`.
