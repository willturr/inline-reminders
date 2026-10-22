import assert from "node:assert/strict";
import test from "node:test";
import { formatLocalDate, parseReminderDate, parseReminders } from "../src/parser";

test("validates leap days and rejects dates JavaScript would roll over", () => {
	assert.equal(parseReminderDate("2024-02-29T12:34:56Z"), Date.UTC(2024, 1, 29, 12, 34, 56));
	assert.notEqual(parseReminderDate("2000-02-29 12:34"), null);
	for (const value of ["2023-02-29 12:00", "1900-02-29 12:00", "2026-04-31 12:00", "2026-00-01 12:00", "2026-13-01 12:00", "2026-01-00 12:00", "2026-01-01 24:00", "2026-01-01 12:60", "2026-01-01T12:00:60Z"]) {
		assert.equal(parseReminderDate(value), null, value);
	}
});

test("accepts explicit timezone offsets and rejects incomplete or ambiguous input", () => {
	assert.equal(parseReminderDate("2026-10-21T09:30+01:00"), Date.UTC(2026, 9, 21, 8, 30));
	assert.equal(parseReminderDate("2026-10-21 09:30:12-05:30"), Date.UTC(2026, 9, 21, 15, 0, 12));
	for (const value of ["tomorrow", "2026-10-21", "2026-1-01 09:00", "2026-10-21 9:30", "2026-10-21T09:30+24:00", "2026-10-21T09:30+01:60", "2026-10-21T09:30+0100", "2026-10-21T09:30Z extra"]) {
		assert.equal(parseReminderDate(value), null, value);
	}
});

test("formats and parses local times, including DST gaps", () => {
	const previous = process.env.TZ;
	process.env.TZ = "Europe/London";
	try {
		assert.equal(parseReminderDate("2026-03-29 01:30"), null);
		assert.equal(parseReminderDate("2026-03-29 02:30"), Date.UTC(2026, 2, 29, 1, 30));
		assert.equal(formatLocalDate(new Date(2026, 9, 21, 9, 5)), "2026-10-21 09:05");
		assert.notEqual(parseReminderDate("2026-10-25 01:30"), null);
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});

test("extracts text, locations, duplicate keys, and CRLF lines", () => {
	const parsed = parseReminders("Notes/Shopping.md", "# Buy milk @remind(2026-10-21 09:30)\r\n- [ ] Call @remind( 2026-10-21 09:30 )\r\n- @remind(2026-10-22T10:00Z)");
	assert.equal(parsed.invalidCount, 0);
	assert.deepEqual(parsed.reminders.map(({ line, column, raw, text }) => ({ line, column, raw, text })), [
		{ line: 0, column: 11, raw: "2026-10-21 09:30", text: "Buy milk" },
		{ line: 1, column: 11, raw: "2026-10-21 09:30", text: "Call" },
		{ line: 2, column: 2, raw: "2026-10-22T10:00Z", text: "Shopping" },
	]);
	assert.equal(parsed.reminders[0].key, "Notes/Shopping.md\u00002026-10-21 09:30\u00000");
	assert.equal(parsed.reminders[1].key, "Notes/Shopping.md\u00002026-10-21 09:30\u00001");
});

test("checking a duplicate task preserves the other reminder's identity", () => {
	const first = "- [ ] First @remind(2026-10-21 09:30)";
	const second = "- [ ] Second @remind(2026-10-21 09:30)";
	const before = parseReminders("Tasks.md", `${first}\n${second}`);
	const after = parseReminders("Tasks.md", `${first.replace("[ ]", "[x]")}\n${second}`);
	assert.equal(after.reminders.length, 1);
	assert.equal(after.reminders[0].key, before.reminders[1].key);
	assert.equal(parseReminders("Tasks.md", "- [X] Done @remind(bad)").invalidCount, 0);
});

test("ignores frontmatter, fenced code, comments, and inline code examples", () => {
	const source = [
		"---", "reminder: '@remind(bad)'", "---",
		"```md", "@remind(bad)", "````",
		"~~~", "@remind(bad)", "~~~",
		"<!-- @remind(bad)", "```", "--> real @remind(2026-10-21 09:30)",
		"`@remind(bad)` and ``a ` @remind(bad)``",
		"`<!--` text @remind(2026-10-22 09:30)",
		"Code `spans", "@remind(bad)` multiple lines",
		"\\@remind(bad)",
	].join("\n");
	const parsed = parseReminders("Test.md", source);
	assert.equal(parsed.invalidCount, 0);
	assert.deepEqual(parsed.reminders.map(reminder => reminder.line), [11, 13]);
});

test("counts malformed markers only in active prose", () => {
	const parsed = parseReminders("Test.md", "Bad @remind(tomorrow) and @remind()\nMissing @remind(2026-10-21 09:30\nBare @remind\nFine @remind(2026-10-21 09:30) @remind(2026-10-22 09:30)");
	assert.equal(parsed.invalidCount, 4);
	assert.equal(parsed.reminders.length, 2);
});

test("keeps editor columns after non-BMP Unicode characters", () => {
	const parsed = parseReminders("Test.md", "🐈 `example` @remind(2026-10-21 09:30)");
	assert.equal(parsed.reminders.length, 1);
	assert.equal(parsed.reminders[0].column, 13);
});
