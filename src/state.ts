import type { Reminder } from "./parser";

export interface SavedState {
	desktopNotifications: boolean;
	notified: Record<string, number>;
	dismissed: Record<string, number>;
}

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamps(value: unknown): Record<string, number> {
	const result: Record<string, number> = Object.create(null);
	if (!isRecord(value)) return result;
	for (const [key, timestamp] of Object.entries(value)) {
		if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
		if (typeof timestamp === "number" && Number.isFinite(timestamp)) result[key] = timestamp;
	}
	return result;
}

export function loadState(value: unknown): SavedState {
	const record = isRecord(value) ? value : {};
	return {
		desktopNotifications: hasOwn(record, "desktopNotifications") && typeof record.desktopNotifications === "boolean"
			? record.desktopNotifications : true,
		notified: timestamps(hasOwn(record, "notified") ? record.notified : null),
		dismissed: timestamps(hasOwn(record, "dismissed") ? record.dismissed : null),
	};
}

function chronological(a: Reminder, b: Reminder): number {
	return a.time - b.time || a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column;
}

export function dueReminders(reminders: Reminder[], state: SavedState, now: number): Reminder[] {
	return reminders.filter((reminder) => reminder.time <= now && !hasOwn(state.notified, reminder.key)
		&& !hasOwn(state.dismissed, reminder.key)).sort(chronological);
}

export function visibleReminders(reminders: Reminder[], state: SavedState): Reminder[] {
	return reminders.filter((reminder) => !hasOwn(state.dismissed, reminder.key)).sort(chronological);
}

export function renameState(state: SavedState, oldPath: string, newPath: string): void {
	if (oldPath === newPath) return;
	for (const map of [state.notified, state.dismissed]) {
		for (const [key, timestamp] of Object.entries(map)) {
			const separator = key.indexOf("\0");
			if (separator < 0) continue;
			const path = key.slice(0, separator);
			if (path !== oldPath && !path.startsWith(`${oldPath}/`)) continue;
			map[newPath + path.slice(oldPath.length) + key.slice(separator)] = timestamp;
			delete map[key];
		}
	}
}
