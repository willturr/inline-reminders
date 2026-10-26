import { reminderHighlightRanges, reminderMarkerRanges } from "./parser";

export interface ReminderTarget {
	from: { line: number; ch: number };
	to: { line: number; ch: number };
	query: string;
	text: string;
}

export function findReminderTarget(content: string, cursor: { line: number; ch: number }): ReminderTarget | null {
	if (!Number.isInteger(cursor.line) || !Number.isInteger(cursor.ch) || cursor.line < 0 || cursor.ch < 0) return null;
	const lines = content.split(/\r?\n/);
	const line = lines[cursor.line];
	if (line === undefined || cursor.ch > line.length || !line.slice(0, cursor.ch).includes("@remind")) return null;
	let offset = 0;
	for (let index = 0; index < cursor.line; index++) {
		offset += lines[index].length;
		if (content[offset] === "\r") offset++;
		if (content[offset] === "\n") offset++;
	}
	const position = offset + cursor.ch;
	const rawMarkers = reminderMarkerRanges(line);
	for (const range of reminderHighlightRanges(content)) {
		const keywordEnd = range.from + "@remind".length;
		if (range.from < offset || range.to > offset + line.length || position < keywordEnd || position > range.to) continue;
		const raw = rawMarkers.find(marker => marker.from === range.from - offset);
		// Never replace a prefix of a marker interrupted by code or a comment.
		if (!raw || raw.to !== range.to - offset) continue;
		let text = content.slice(range.from, range.to);
		const parenthesis = text["@remind".length] === "(";
		if (!parenthesis && position !== keywordEnd) continue;
		if (parenthesis && text.endsWith(")") && position === range.to) continue;
		if (parenthesis && !text.endsWith(")") && rawMarkers.some(marker => marker.from === raw.to)) text = text.trimEnd();
		if (position > range.from + text.length) continue;
		return {
			from: { line: cursor.line, ch: range.from - offset },
			to: { line: cursor.line, ch: range.from - offset + text.length },
			query: parenthesis && position > keywordEnd + 1 ? content.slice(keywordEnd + 1, position) : "",
			text,
		};
	}
	return null;
}

export function reminderEdit(target: ReminderTarget, marker: string): {
	from: { line: number; ch: number };
	to: { line: number; ch: number };
	text: string;
	selection: { line: number; ch: number };
} {
	return {
		from: { ...target.from },
		to: { ...target.to },
		text: marker,
		selection: { line: target.from.line, ch: target.from.ch + marker.length },
	};
}
