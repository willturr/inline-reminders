export interface Reminder {
	key: string;
	path: string;
	line: number;
	column: number;
	raw: string;
	time: number;
	text: string;
}

export interface ParseResult {
	reminders: Reminder[];
	invalidCount: number;
}

/** Parse an explicit timestamp; reject JavaScript's automatic date rollover. */
export function parseReminderDate(input: string): number | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:(Z)|([+-])(\d{2}):(\d{2}))?$/.exec(input.trim());
	if (!match) return null;
	const [, yearText, monthText, dayText, hourText, minuteText, secondText, zulu, sign, offsetHourText, offsetMinuteText] = match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const hour = Number(hourText);
	const minute = Number(minuteText);
	const second = Number(secondText ?? 0);
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return null;

	const date = new Date(0);
	if (zulu || sign) {
		const offsetHour = Number(offsetHourText ?? 0);
		const offsetMinute = Number(offsetMinuteText ?? 0);
		if (offsetHour > 23 || offsetMinute > 59) return null;
		date.setUTCFullYear(year, month - 1, day);
		date.setUTCHours(hour, minute, second, 0);
		const offset = (offsetHour * 60 + offsetMinute) * 60_000 * (sign === "-" ? -1 : 1);
		return date.getTime() - offset;
	}

	date.setFullYear(year, month - 1, day);
	date.setHours(hour, minute, second, 0);
	// A local time inside the spring DST gap would silently move forward.
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) return null;
	return date.getTime();
}

export function formatLocalDate(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface MaskState {
	comment: boolean;
	codeEnd: { line: number; column: number } | null;
}

function escaped(text: string, index: number): boolean {
	let slashes = 0;
	while (index > 0 && text[--index] === "\\") slashes++;
	return slashes % 2 === 1;
}

function fence(line: string): RegExpExecArray | null {
	return /^\s*(`{3,}|~{3,})(.*)$/.exec(line.replace(/^(?: {0,3}>[ \t]?)+/, ""));
}

function codeSpanEnd(lines: string[], line: number, column: number, length: number): MaskState["codeEnd"] {
	for (let current = line; current < lines.length; current++) {
		const text = lines[current];
		if (current > line && (/^\s*$/.test(text) || fence(text) || /^\s*(?:#{1,6}(?:\s|$)|>|(?:[-+*]|\d+[.)])\s+)/.test(text))) break;
		const ticks = /`+/g;
		ticks.lastIndex = current === line ? column + length : 0;
		for (let match = ticks.exec(text); match; match = ticks.exec(text)) {
			if (match[0].length === length) return { line: current, column: match.index + length };
		}
	}
	return null;
}

function maskInline(line: string, lineNumber: number, lines: string[], state: MaskState): string {
	const chars = line.split("");
	// Indexing uses UTF-16 columns, like the Obsidian editor.
	const mask = (start: number, end: number) => {
		for (let i = start; i < end; i++) chars[i] = " ";
	};
	let index = 0;
	if (state.codeEnd) {
		if (state.codeEnd.line > lineNumber) return " ".repeat(line.length);
		index = state.codeEnd.column;
		mask(0, index);
		state.codeEnd = null;
	}
	while (index < line.length) {
		if (state.comment) {
			const end = line.indexOf("-->", index);
			mask(index, end < 0 ? line.length : end + 3);
			if (end < 0) break;
			state.comment = false;
			index = end + 3;
		} else if (line.startsWith("<!--", index)) {
			state.comment = true;
		} else if (line[index] === "`" && !escaped(line, index)) {
			const length = /^`+/.exec(line.slice(index))![0].length;
			const end = codeSpanEnd(lines, lineNumber, index, length);
			if (!end) {
				index += length;
				continue;
			}
			mask(index, end.line === lineNumber ? end.column : line.length);
			if (end.line > lineNumber) {
				state.codeEnd = end;
				break;
			}
			index = end.column;
		} else {
			index++;
		}
	}
	return chars.join("");
}

function reminderText(path: string, line: string): string {
	const text = line.replace(/@remind\([^)]*\)/g, "")
		.replace(/^\s*(?:>\s*)*/, "")
		.replace(/^(?:[-+*]|\d+[.)])\s+/, "")
		.replace(/^\[[ xX]\]\s*/, "")
		.replace(/^#{1,6}(?:\s+|$)/, "")
		.replace(/[ \t]+/g, " ").trim();
	return text || path.split("/").pop()?.replace(/\.md$/i, "") || "Reminder";
}

export function parseReminders(path: string, content: string): ParseResult {
	const result: ParseResult = { reminders: [], invalidCount: 0 };
	const occurrences = new Map<string, number>();
	const lines = content.split(/\r?\n/);
	const state: MaskState = { comment: false, codeEnd: null };
	let frontmatter = /^\uFEFF?---\s*$/.test(lines[0] ?? "");
	let activeFence: { character: string; length: number } | null = null;
	for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
		const line = lines[lineNumber];
		if (frontmatter) {
			if (lineNumber > 0 && /^(?:---|\.\.\.)\s*$/.test(line)) frontmatter = false;
			continue;
		}
		const boundary = !state.comment && !state.codeEnd ? fence(line) : null;
		if (activeFence) {
			if (boundary && boundary[1][0] === activeFence.character && boundary[1].length >= activeFence.length && /^\s*$/.test(boundary[2])) activeFence = null;
			continue;
		}
		if (boundary) {
			activeFence = { character: boundary[1][0], length: boundary[1].length };
			continue;
		}
		const visible = maskInline(line, lineNumber, lines, state);
		const completed = /^\s*(?:>\s*)*(?:(?:[-+*]|\d+[.)])\s+)?\[[xX]\](?:\s|$)/.test(visible);
		const marker = /@remind\b/g;
		for (let match = marker.exec(visible); match; match = marker.exec(visible)) {
			if (escaped(visible, match.index)) continue;
			const start = match.index + match[0].length;
			const end = visible.indexOf(")", start + 1);
			const next = visible.indexOf("@remind", start);
			if (visible[start] !== "(" || end < 0 || (next >= 0 && next < end)) {
				if (!completed) result.invalidCount++;
				continue;
			}
			const raw = visible.slice(start + 1, end).trim();
			const time = parseReminderDate(raw);
			marker.lastIndex = end + 1;
			if (time === null) {
				if (!completed) result.invalidCount++;
				continue;
			}
			const occurrence = occurrences.get(raw) ?? 0;
			occurrences.set(raw, occurrence + 1);
			if (completed) continue;
			result.reminders.push({ key: `${path}\u0000${raw}\u0000${occurrence}`, path, line: lineNumber, column: match.index, raw, time, text: reminderText(path, line) });
		}
	}
	return result;
}
