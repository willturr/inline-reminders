import { formatLocalDate, parseReminderDate } from "./parser";

export interface DateSuggestion {
	label: string;
	timestamp: number;
}

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (value: number) => String(value).padStart(2, "0");

function supported(timestamp: number): boolean {
	const date = new Date(timestamp);
	return Number.isFinite(timestamp) && Number.isFinite(date.getTime()) && date.getFullYear() >= 0 && date.getFullYear() <= 9999;
}

/** The explicit offset keeps an autumn reminder on the selected repeated hour. */
export function formatReminderTimestamp(timestamp: number): string {
	const rounded = Math.floor(timestamp / 1000) * 1000;
	if (!supported(rounded)) throw new RangeError("Reminder timestamp is outside the supported date range");
	const date = new Date(rounded);
	const offset = -date.getTimezoneOffset();
	const minutes = Math.abs(offset);
	const seconds = date.getSeconds() ? `:${pad(date.getSeconds())}` : "";
	return `${formatLocalDate(date)}${seconds}${offset >= 0 ? "+" : "-"}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function parseTime(text: string): { hour: number; minute: number } | null {
	const twentyFour = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
	if (twentyFour) return { hour: Number(twentyFour[1]), minute: Number(twentyFour[2]) };
	const twelve = /^(0?[1-9]|1[0-2])(?::([0-5]\d))?\s*(am|pm)$/.exec(text);
	if (!twelve) return null;
	return { hour: Number(twelve[1]) % 12 + (twelve[3] === "pm" ? 12 : 0), minute: Number(twelve[2] ?? 0) };
}

function timeLabel(hour: number, minute: number): string {
	return `${hour % 12 || 12}${minute ? `:${pad(minute)}` : ""}${hour >= 12 ? "pm" : "am"}`;
}

function localTimes(date: Date, dayOffset: number, hour: number, minute: number): number[] {
	// Calendar arithmetic in UTC avoids silently crossing a local DST gap.
	const calendar = new Date(0);
	calendar.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset);
	if (calendar.getUTCFullYear() < 0 || calendar.getUTCFullYear() > 9999) return [];
	const wallTime = `${calendar.toISOString().slice(0, 10)} ${pad(hour)}:${pad(minute)}`;
	const first = parseReminderDate(wallTime);
	if (first === null) return [];
	const times = [first];
	const offsetChange = new Date(first + 86_400_000).getTimezoneOffset() - new Date(first).getTimezoneOffset();
	const repeated = first + offsetChange * 60_000;
	if (offsetChange > 0 && formatLocalDate(new Date(repeated)) === wallTime) times.push(repeated);
	return times;
}

export function getDateSuggestions(query: string, now: number): DateSuggestion[] {
	if (!supported(now)) return [];
	const date = new Date(now);
	const normalized = query.trim().replace(/\s+/g, " ").toLowerCase();
	const suggestion = (label: string, timestamp: number): DateSuggestion[] => {
		const rounded = Math.floor(timestamp / 1000) * 1000;
		return supported(rounded) && rounded > now ? [{ label, timestamp: rounded }] : [];
	};
	const daySuggestion = (name: string, hour: number, minute: number): DateSuggestion[] => {
		const weekday = weekdays.findIndex(day => day.toLowerCase() === name || day.slice(0, 3).toLowerCase() === name);
		const label = name === "today" ? "Today" : name === "tomorrow" ? "Tomorrow" : weekdays[weekday];
		let dayOffset = name === "today" ? 0 : name === "tomorrow" ? 1 : (weekday - date.getDay() + 7) % 7;
		let times = localTimes(date, dayOffset, hour, minute);
		const future = () => times.find(timestamp => timestamp > now);
		if (weekday >= 0 && dayOffset === 0 && future() === undefined) {
			// An already passed weekday moves to next week; an upcoming gap stays invalid.
			if (times.length || hour * 60 + minute <= date.getHours() * 60 + date.getMinutes()) {
				dayOffset = 7;
				times = localTimes(date, dayOffset, hour, minute);
			}
		}
		const timestamp = future();
		return timestamp === undefined ? [] : suggestion(`${label} at ${timeLabel(hour, minute)}`, timestamp);
	};
	const presets = (): DateSuggestion[] => [
		...suggestion("In 15 minutes", now + 15 * 60_000),
		...suggestion("In 1 hour", now + 60 * 60_000),
		...daySuggestion("tomorrow", 9, 0),
	];
	if (!normalized) return presets();

	const absolute = parseReminderDate(query.trim());
	if (absolute !== null) return supported(absolute) ? suggestion(formatReminderTimestamp(absolute), absolute) : [];
	const relative = /^in (\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/.exec(normalized);
	if (relative) {
		const count = Number(relative[1]);
		if (!Number.isSafeInteger(count) || count <= 0) return [];
		const unit = relative[2][0] === "m" ? "minute" : "hour";
		return suggestion(`In ${count} ${unit}${count === 1 ? "" : "s"}`, now + count * (unit === "minute" ? 60_000 : 3_600_000));
	}
	const day = /^(today|tomorrow|sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)(?: (?:at )?(.+))?$/.exec(normalized);
	if (day) {
		const time = day[2] ? parseTime(day[2]) : { hour: 9, minute: 0 };
		if (time) return daySuggestion(day[1], time.hour, time.minute);
	}

	const candidates = [
		...presets(),
		...daySuggestion("today", 9, 0),
		...weekdays.flatMap(weekday => daySuggestion(weekday.toLowerCase(), 9, 0)),
	].filter(candidate => candidate.label.toLowerCase().startsWith(normalized));
	return candidates.filter((candidate, index) => candidates.findIndex(other => other.label === candidate.label) === index);
}
