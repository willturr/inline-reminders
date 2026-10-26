import assert from "node:assert/strict";
import test from "node:test";
import { formatReminderTimestamp, getDateSuggestions } from "../src/date-suggestions";
import { parseReminderDate } from "../src/parser";

function london(run: () => void): void {
	const previous = process.env.TZ;
	process.env.TZ = "Europe/London";
	try { run(); } finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
}

const mondayMorning = Date.UTC(2026, 9, 26, 8);

test("empty query offers three frozen presets rounded down to seconds", () => london(() => {
	const now = Date.UTC(2026, 9, 26, 12, 0, 37, 999) + 0.5;
	assert.deepEqual(getDateSuggestions("  ", now), [
		{ label: "In 15 minutes", timestamp: Date.UTC(2026, 9, 26, 12, 15, 37) },
		{ label: "In 1 hour", timestamp: Date.UTC(2026, 9, 26, 13, 0, 37) },
		{ label: "Tomorrow at 9am", timestamp: Date.UTC(2026, 9, 27, 9) },
	]);
}));

test("day expressions accept case, optional at, 24-hour times, and 12-hour times", () => london(() => {
	for (const query of ["tomorrow", "TOMORROW AT 9AM", " Tomorrow   09:00 ", "tomorrow 9 am"]) {
		assert.deepEqual(getDateSuggestions(query, mondayMorning), [{ label: "Tomorrow at 9am", timestamp: Date.UTC(2026, 9, 27, 9) }], query);
	}
	assert.equal(getDateSuggestions("today at 12am", mondayMorning).length, 0);
	assert.equal(getDateSuggestions("today at 12pm", mondayMorning)[0].timestamp, Date.UTC(2026, 9, 26, 12));
	assert.deepEqual(getDateSuggestions("tomorrow 14:05", mondayMorning), [{ label: "Tomorrow at 2:05pm", timestamp: Date.UTC(2026, 9, 27, 14, 5) }]);
	assert.equal(getDateSuggestions("tomorrow at 1:05 pm", mondayMorning)[0].timestamp, Date.UTC(2026, 9, 27, 13, 5));
}));

test("weekdays choose today when future and otherwise advance a calendar week", () => london(() => {
	assert.equal(getDateSuggestions("mon", mondayMorning)[0].timestamp, Date.UTC(2026, 9, 26, 9));
	assert.equal(getDateSuggestions("Monday at 08:00", mondayMorning)[0].timestamp, Date.UTC(2026, 10, 2, 8));
	assert.equal(getDateSuggestions("monday at 7am", mondayMorning)[0].timestamp, Date.UTC(2026, 10, 2, 7));
	assert.equal(getDateSuggestions("FRIDAY", mondayMorning)[0].timestamp, Date.UTC(2026, 9, 30, 9));
	assert.equal(getDateSuggestions("sun at 10:15", mondayMorning)[0].timestamp, Date.UTC(2026, 10, 1, 10, 15));
}));

test("day and preset labels support incomplete prefix queries without duplicates", () => london(() => {
	assert.deepEqual(getDateSuggestions("tom", mondayMorning), [{ label: "Tomorrow at 9am", timestamp: Date.UTC(2026, 9, 27, 9) }]);
	assert.equal(getDateSuggestions("fr", mondayMorning)[0].label, "Friday at 9am");
	assert.equal(getDateSuggestions("tomorrow at", mondayMorning)[0].label, "Tomorrow at 9am");
	assert.equal(getDateSuggestions("in 15 min", mondayMorning)[0].label, "In 15 minutes");
	assert.equal(getDateSuggestions("in 1 h", mondayMorning)[0].label, "In 1 hour");
	assert.deepEqual(getDateSuggestions("in", mondayMorning).map(candidate => candidate.label), ["In 15 minutes", "In 1 hour"]);
	assert.ok(getDateSuggestions("t", mondayMorning).every(candidate => candidate.label.toLowerCase().startsWith("t")));
}));

test("relative expressions accept documented minute and hour aliases", () => london(() => {
	for (const unit of ["m", "min", "mins", "minute", "minutes"]) {
		assert.deepEqual(getDateSuggestions(`in 2 ${unit}`, mondayMorning), [{ label: "In 2 minutes", timestamp: mondayMorning + 120_000 }]);
	}
	for (const unit of ["h", "hr", "hrs", "hour", "hours"]) {
		assert.deepEqual(getDateSuggestions(`IN 2${unit}`, mondayMorning), [{ label: "In 2 hours", timestamp: mondayMorning + 7_200_000 }]);
	}
	assert.equal(getDateSuggestions("in 1 minute", mondayMorning)[0].label, "In 1 minute");
}));

test("invalid, unsupported, and past expressions never yield a suggestion", () => london(() => {
	for (const query of [
		"yesterday", "next friday", "tues at 9am", "in 0 hours", "in -1 hour", "in 1.5 hours", "in 1e2 minutes", "in Infinity hours",
		"in 9007199254740992 minutes", "in 9999999999999 hours", "in 15 seconds", "tomorrow at 24:00", "tomorrow at 9:00",
		"tomorrow at 13pm", "tomorrow at 00am", "tomorrow at 9:60am", "tomorrow at 09:00 extra", "today at 8am",
		"2026-02-30 09:00", "2026-10-26T08:00Z", "2020-01-01T09:00Z",
	]) assert.deepEqual(getDateSuggestions(query, mondayMorning), [], query);
	for (const now of [NaN, Infinity, -Infinity, 8.64e15 + 1]) assert.deepEqual(getDateSuggestions("tomorrow", now), []);
}));

test("absolute timestamps retain their resolved future instant", () => london(() => {
	for (const query of ["2026-10-26 13:00Z", "2026-10-26T14:00+01:00", "2026-10-26T08:00-05:00"]) {
		assert.deepEqual(getDateSuggestions(query, mondayMorning), [{ label: "2026-10-26 13:00+00:00", timestamp: Date.UTC(2026, 9, 26, 13) }], query);
	}
}));

test("calendar days cross month, leap-day, and year boundaries", () => london(() => {
	assert.equal(getDateSuggestions("tomorrow", Date.UTC(2026, 0, 31, 12))[0].timestamp, Date.UTC(2026, 1, 1, 9));
	assert.equal(getDateSuggestions("tomorrow", Date.UTC(2028, 1, 28, 12))[0].timestamp, Date.UTC(2028, 1, 29, 9));
	assert.equal(getDateSuggestions("tomorrow", Date.UTC(2026, 11, 31, 12))[0].timestamp, Date.UTC(2027, 0, 1, 9));
	assert.equal(getDateSuggestions("fri", Date.UTC(2026, 11, 31, 12))[0].timestamp, Date.UTC(2027, 0, 1, 9));
}));

test("spring DST gaps are rejected and surrounding days use calendar time", () => london(() => {
	const saturday = Date.UTC(2026, 2, 28, 12);
	assert.deepEqual(getDateSuggestions("tomorrow at 1:30am", saturday), []);
	assert.deepEqual(getDateSuggestions("sunday at 1:30am", saturday), []);
	assert.equal(getDateSuggestions("tomorrow at 2:30am", saturday)[0].timestamp, Date.UTC(2026, 2, 29, 1, 30));
	assert.equal(getDateSuggestions("tomorrow", saturday)[0].timestamp, Date.UTC(2026, 2, 29, 8));
	const beforeGap = Date.UTC(2026, 2, 29, 0, 45);
	assert.equal(getDateSuggestions("in 1 hour", beforeGap)[0].timestamp, Date.UTC(2026, 2, 29, 1, 45));
	assert.equal(formatReminderTimestamp(getDateSuggestions("in 1 hour", beforeGap)[0].timestamp), "2026-03-29 02:45+01:00");
}));

test("an autumn repeated hour can resolve to its remaining future occurrence", () => london(() => {
	const beforeRepeat = Date.UTC(2026, 9, 25, 0, 45);
	assert.equal(getDateSuggestions("today at 1:30am", beforeRepeat)[0].timestamp, Date.UTC(2026, 9, 25, 1, 30));
	assert.equal(getDateSuggestions("sunday at 1:30am", beforeRepeat)[0].timestamp, Date.UTC(2026, 9, 25, 1, 30));
	assert.equal(getDateSuggestions("in 1 hour", Date.UTC(2026, 9, 25, 0, 30))[0].timestamp, Date.UTC(2026, 9, 25, 1, 30));
	assert.equal(getDateSuggestions("sunday at 1:30am", Date.UTC(2026, 9, 25, 1, 45))[0].timestamp, Date.UTC(2026, 10, 1, 1, 30));
}));

test("serialization retains seconds, offsets, and both repeated autumn instants", () => london(() => {
	for (const [timestamp, expected] of [
		[Date.UTC(2026, 9, 25, 0, 30), "2026-10-25 01:30+01:00"],
		[Date.UTC(2026, 9, 25, 1, 30), "2026-10-25 01:30+00:00"],
		[Date.UTC(2026, 6, 1, 12, 5, 7, 999), "2026-07-01 13:05:07+01:00"],
	] as const) {
		assert.equal(formatReminderTimestamp(timestamp), expected);
		assert.equal(parseReminderDate(expected), Math.floor(timestamp / 1000) * 1000);
	}
	const frozen = getDateSuggestions("in 15 minutes", Date.UTC(2026, 9, 26, 12, 0, 37, 999))[0];
	assert.equal(parseReminderDate(formatReminderTimestamp(frozen.timestamp)), frozen.timestamp);
	for (const timestamp of [NaN, Infinity, 8.64e15 + 1, Date.UTC(10000, 0, 1)]) assert.throws(() => formatReminderTimestamp(timestamp), RangeError);
}));

test("serialization supports positive and negative fractional-hour local offsets", () => {
	const previous = process.env.TZ;
	const timestamp = Date.UTC(2026, 0, 1, 12, 5, 7);
	try {
		for (const [timezone, expected] of [
			["America/St_Johns", "2026-01-01 08:35:07-03:30"],
			["Asia/Kolkata", "2026-01-01 17:35:07+05:30"],
		]) {
			process.env.TZ = timezone;
			assert.equal(formatReminderTimestamp(timestamp), expected);
			assert.equal(parseReminderDate(expected), timestamp);
		}
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});
