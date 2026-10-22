import assert from "node:assert/strict";
import { test } from "node:test";
import type { Reminder } from "../src/parser";
import { dueReminders, loadState, renameState, visibleReminders } from "../src/state";

function reminder(key: string, time: number, path = "Note.md", line = 0, column = 0): Reminder {
	return { key, time, path, line, column, raw: "@remind(2026-10-21)", text: "Call Sam" };
}

test("corrupted saved state uses safe defaults", () => {
	for (const value of [null, undefined, false, 10, "oops", [], { desktopNotifications: "false", notified: [], dismissed: "bad" }]) {
		const state = loadState(value);
		assert.equal(state.desktopNotifications, true);
		assert.deepEqual(Object.keys(state.notified), []);
		assert.deepEqual(Object.keys(state.dismissed), []);
		assert.equal(Object.getPrototypeOf(state.notified), null);
		assert.equal(Object.getPrototypeOf(state.dismissed), null);
	}
});

test("saved state keeps booleans and finite own timestamps including zero", () => {
	const inherited = Object.assign(Object.create({ inherited: 8 }), { good: 7, zero: 0, text: "7", nan: NaN, infinity: Infinity });
	const state = loadState({ desktopNotifications: false, notified: inherited, dismissed: { done: 9 } });
	assert.equal(state.desktopNotifications, false);
	assert.deepEqual(Object.entries(state.notified), [["good", 7], ["zero", 0]]);
	assert.deepEqual(Object.entries(state.dismissed), [["done", 9]]);
	assert.notEqual(state.notified, inherited);
});

test("prototype keys and inherited settings cannot alter state", () => {
	const state = loadState(JSON.parse('{"notified":{"__proto__":1,"constructor":2,"prototype":3,"good":4}}'));
	assert.deepEqual(Object.entries(state.notified), [["good", 4]]);
	assert.equal(Object.getPrototypeOf(state.notified), null);
	const inherited = loadState(Object.create({ desktopNotifications: false, notified: { fake: 1 }, dismissed: { fake: 1 } }));
	assert.equal(inherited.desktopNotifications, true);
	assert.deepEqual(Object.keys(inherited.notified), []);
	assert.deepEqual(Object.keys(inherited.dismissed), []);
});

test("due reminders catch up overdue items and exclude future items", () => {
	const reminders = [reminder("future", 11), reminder("now", 10), reminder("overdue", 1)];
	assert.deepEqual(dueReminders(reminders, loadState(null), 10).map((item) => item.key), ["overdue", "now"]);
	assert.equal(reminders[0]?.key, "future");
});

test("notified and dismissed reminders never notify again, including timestamp zero", () => {
	const state = loadState({ notified: { sent: 0 }, dismissed: { done: 0 } });
	const reminders = [reminder("sent", 1), reminder("done", 2), reminder("fresh", 3)];
	assert.deepEqual(dueReminders(reminders, state, 10).map((item) => item.key), ["fresh"]);
	state.notified.fresh = 10;
	assert.deepEqual(dueReminders(reminders, state, 11), []);
});

test("visible reminders retain notified reminders but exclude dismissed ones", () => {
	const state = loadState({ notified: { sent: 0 }, dismissed: { done: 0 } });
	const reminders = [reminder("future", 100), reminder("done", 1), reminder("sent", 2)];
	assert.deepEqual(visibleReminders(reminders, state).map((item) => item.key), ["sent", "future"]);
});

test("reminder ordering breaks time ties by path, line, and column", () => {
	const reminders = [
		reminder("later", 2, "A.md"), reminder("path", 1, "B.md"), reminder("line", 1, "A.md", 2),
		reminder("column", 1, "A.md", 1, 3), reminder("first", 1, "A.md", 1, 2),
	];
	const expected = ["first", "column", "line", "path", "later"];
	assert.deepEqual(visibleReminders(reminders, loadState(null)).map((item) => item.key), expected);
	assert.deepEqual(dueReminders(reminders, loadState(null), 10).map((item) => item.key), expected);
});

test("renaming a file preserves the full reminder identity suffix in both maps", () => {
	const suffix = ["", "call", "2026-10-21T12:00", "2"].join("\0");
	const state = loadState({ notified: { [`Old.md${suffix}`]: 7 }, dismissed: { [`Old.md${suffix}`]: 0 } });
	renameState(state, "Old.md", "New.md");
	assert.deepEqual(Object.entries(state.notified), [[`New.md${suffix}`, 7]]);
	assert.deepEqual(Object.entries(state.dismissed), [[`New.md${suffix}`, 0]]);
	renameState(state, "New.md", "New.md");
	assert.deepEqual(Object.entries(state.notified), [[`New.md${suffix}`, 7]]);
});

test("renaming a folder includes descendants and excludes unrelated prefixes", () => {
	const suffix = ["", "raw reminder", "2026-10-21", "0"].join("\0");
	const state = loadState({
		notified: { [`Work/Note.md${suffix}`]: 1, [`Work/Nested/Note.md${suffix}`]: 2, [`Workplace/Note.md${suffix}`]: 3, malformed: 4 },
		dismissed: { [`Work/Other.md${suffix}`]: 0 },
	});
	renameState(state, "Work", "Archive");
	assert.deepEqual(Object.entries(state.notified).sort(), [
		[`Archive/Note.md${suffix}`, 1], [`Archive/Nested/Note.md${suffix}`, 2], [`Workplace/Note.md${suffix}`, 3], ["malformed", 4],
	].sort());
	assert.deepEqual(Object.entries(state.dismissed), [[`Archive/Other.md${suffix}`, 0]]);
});
