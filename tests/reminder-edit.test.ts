import assert from "node:assert/strict";
import { test } from "node:test";
import { findReminderTarget, reminderEdit, type ReminderTarget } from "../src/reminder-edit";

function at(content: string, cursor: number, line = 0): ReminderTarget | null {
	return findReminderTarget(content, { line, ch: cursor });
}

test("targets a bare keyword only when the cursor follows the fully typed word", () => {
	assert.deepEqual(at("Call @remind", 12), {
		from: { line: 0, ch: 5 }, to: { line: 0, ch: 12 }, query: "", text: "@remind",
	});
	for (const ch of [0, 5, 6, 11, 13]) assert.equal(at("Call @remind later", ch), null);
	assert.equal(at("Call @reminde", 13), null);
	assert.equal(at("Call @remin", 11), null);
});

test("targets a whole existing marker while querying only the date prefix before the cursor", () => {
	const content = "Call @remind(2026-10-26 09:00) after breakfast";
	const cursor = content.indexOf("26 09") + 2;
	const target = at(content, cursor)!;
	assert.deepEqual(target, {
		from: { line: 0, ch: 5 }, to: { line: 0, ch: content.indexOf(")") + 1 },
		query: "2026-10-26", text: "@remind(2026-10-26 09:00)",
	});
	assert.equal(at(content, 12)?.query, "");
	assert.equal(at(content, 13)?.query, "");
	assert.equal(at(content, content.indexOf(")"))?.query, "2026-10-26 09:00");
	assert.equal(at(content, content.indexOf(")") + 1), null);
	assert.equal(at(content, content.length), null);
});

test("targets empty and unfinished parentheses through end of the same line", () => {
	assert.deepEqual(at("@remind()", 8), {
		from: { line: 0, ch: 0 }, to: { line: 0, ch: 9 }, query: "", text: "@remind()",
	});
	const content = "Call @remind(tomorrow at 9\nNext paragraph";
	assert.deepEqual(at(content, 21), {
		from: { line: 0, ch: 5 }, to: { line: 0, ch: 26 }, query: "tomorrow", text: "@remind(tomorrow at 9",
	});
	assert.equal(at(content, 26)?.query, "tomorrow at 9");
	assert.equal(at(content, 0, 1), null);
});

test("sibling markers stay separate and an existing closing parenthesis protects suffix text", () => {
	const content = "@remind(tomorrow) then @remind(next Monday) suffix";
	const first = at(content, 12)!;
	assert.equal(first.text, "@remind(tomorrow)");
	const secondStart = content.lastIndexOf("@remind");
	const second = at(content, secondStart + 12)!;
	assert.equal(second.from.ch, secondStart);
	assert.equal(second.text, "@remind(next Monday)");
	assert.equal(second.query, "next");
	const unfinished = "@remind(tomorrow @remind(next Monday)";
	const unfinishedTarget = at(unfinished, 12)!;
	assert.equal(unfinishedTarget.text, "@remind(tomorrow");
	const edit = reminderEdit(unfinishedTarget, "@remind(2026-10-27 09:00)");
	assert.equal(edit.text + unfinished.slice(edit.to.ch), "@remind(2026-10-27 09:00) @remind(next Monday)");
	assert.equal(at(unfinished, unfinished.lastIndexOf("@remind") + 8)?.text, "@remind(next Monday)");
});

test("replacement consumes the original marker once and positions the cursor after its new text", () => {
	const content = "Call @remind(tomorrow) after breakfast";
	const target = at(content, 15)!;
	const marker = "@remind(2026-10-27T09:00:00Z)";
	const edit = reminderEdit(target, marker);
	assert.deepEqual(edit, { from: { line: 0, ch: 5 }, to: { line: 0, ch: 22 }, text: marker, selection: { line: 0, ch: 5 + marker.length } });
	assert.equal(content.slice(0, edit.from.ch) + edit.text + content.slice(edit.to.ch), `Call ${marker} after breakfast`);
	assert.equal(target.text, "@remind(tomorrow)");
	assert.notEqual(edit.from, target.from);
});

test("UTF-16 positions and CRLF line offsets match the editor's line and character coordinates", () => {
	const content = "🙂 Intro\r\nPlan 🙂 @remind(tomorrow) suffix\r\nEnd";
	const line = content.split("\r\n")[1];
	const start = line.indexOf("@remind");
	const target = at(content, start + 12, 1)!;
	assert.equal(start, 8);
	assert.deepEqual(target, { from: { line: 1, ch: 8 }, to: { line: 1, ch: line.indexOf(")") + 1 }, query: "tomo", text: "@remind(tomorrow)" });
	assert.equal(reminderEdit(target, "@remind(2026-10-27 09:00)").selection.line, 1);
});

test("Markdown examples, frontmatter, comments, and escaped markers cannot trigger autocomplete", () => {
	for (const [content, line, ch] of [
		["`@remind(tomorrow)`", 0, 12],
		["```md\n@remind(tomorrow)\n```", 1, 12],
		["~~~\n@remind(tomorrow)\n~~~", 1, 12],
		["---\ndate: @remind(tomorrow)\n---", 1, 18],
		["<!-- @remind(tomorrow) -->", 0, 17],
		["\\@remind(tomorrow)", 0, 12],
	] as const) assert.equal(findReminderTarget(content, { line, ch }), null);
	assert.ok(at("\\\\@remind(tomorrow)", 14));
	assert.ok(at("- [x] Done @remind(tomorrow)", 23));
});

test("markers interrupted by excluded code or comments cannot replace text across those regions", () => {
	for (const content of ["@remind(tomorrow `code`)", "@remind(tomorrow <!-- comment -->)", "@remind(tomorrow `code` suffix"]) {
		assert.equal(at(content, 12), null);
		assert.equal(at(content, content.indexOf("code") + 2), null);
	}
});

test("invalid cursor coordinates and cursors outside a marker are rejected", () => {
	for (const cursor of [{ line: -1, ch: 8 }, { line: 1, ch: 8 }, { line: 0, ch: -1 }, { line: 0, ch: 100 }, { line: 0.5, ch: 8 }, { line: 0, ch: NaN }]) {
		assert.equal(findReminderTarget("@remind()", cursor), null);
	}
	assert.equal(at("@remind()", 9), null);
	assert.equal(at("@remind done", 8), null);
	assert.equal(at("", 0), null);
});

test("long lines and long unfinished queries preserve the entire replacement boundary", () => {
	const prefix = "x".repeat(20_000) + " ";
	const query = "tomorrow ".repeat(2_000);
	const content = `${prefix}@remind(${query}`;
	const target = at(content, content.length)!;
	assert.equal(target.from.ch, prefix.length);
	assert.equal(target.to.ch, content.length);
	assert.equal(target.query, query);
	assert.equal(target.text, `@remind(${query}`);
});
