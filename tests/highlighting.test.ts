import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { ReminderHighlighter } from "../src/highlighting";

function viewFor(doc: string, visibleRanges?: { from: number; to: number }[]): EditorView {
	const state = EditorState.create({ doc });
	return { state, visibleRanges: visibleRanges ?? [{ from: 0, to: state.doc.length }] } as unknown as EditorView;
}

function spans(highlighter: ReminderHighlighter, view: EditorView): { from: number; to: number; text: string }[] {
	const result: { from: number; to: number; text: string }[] = [];
	highlighter.decorations.between(0, view.state.doc.length, (from, to, decoration) => {
		assert.ok(String(decoration.spec.class).split(/\s+/).includes("inline-reminders-highlight"));
		result.push({ from, to, text: view.state.doc.sliceString(from, to) });
	});
	return result;
}

function update(highlighter: ReminderHighlighter, view: EditorView, docChanged: boolean, viewportChanged = false): void {
	highlighter.update({ view, state: view.state, docChanged, viewportChanged } as ViewUpdate);
}

test("initial editor content highlights the complete reminder marker", () => {
	const doc = "Call Sam @remind(2026-10-23 09:00) tomorrow";
	const view = viewFor(doc);
	const highlighter = new ReminderHighlighter(view);
	const from = doc.indexOf("@remind");
	const to = doc.indexOf(")") + 1;
	assert.deepEqual(spans(highlighter, view), [{ from, to, text: doc.slice(from, to) }]);
});

test("a bare keyword highlights as soon as it is typed", () => {
	const doc = "Call Sam @remind";
	const view = viewFor(doc);
	assert.deepEqual(spans(new ReminderHighlighter(view), view), [{ from: 9, to: doc.length, text: "@remind" }]);
});

test("an unfinished date highlights through the end of its line", () => {
	const doc = "Call Sam @remind(2026-10-\nNext line";
	const view = viewFor(doc);
	const to = doc.indexOf("\n");
	assert.deepEqual(spans(new ReminderHighlighter(view), view), [{ from: 9, to, text: doc.slice(9, to) }]);
});

test("typing and full document edits rebuild ranges, and deleting a marker removes its highlight", () => {
	let view = viewFor("Call Sam @remind");
	const highlighter = new ReminderHighlighter(view);
	view = viewFor("Call Sam @remind(2026-10-23 09:00)");
	update(highlighter, view, true);
	assert.deepEqual(spans(highlighter, view), [{ from: 9, to: view.state.doc.length, text: "@remind(2026-10-23 09:00)" }]);
	view = viewFor("New prefix: Call Sam @remind(2026-10-23 09:00)");
	update(highlighter, view, true);
	assert.equal(spans(highlighter, view)[0]?.from, 21);
	view = viewFor("New prefix: Call Sam");
	update(highlighter, view, true);
	assert.deepEqual(spans(highlighter, view), []);
});

test("code examples remain undecorated while an active marker is highlighted", () => {
	const doc = "```md\n@remind(2026-10-23 09:00)\n```\nInline `@remind` and active @remind";
	const view = viewFor(doc);
	const from = doc.lastIndexOf("@remind");
	assert.deepEqual(spans(new ReminderHighlighter(view), view), [{ from, to: doc.length, text: "@remind" }]);
});

test("scrolling updates decorations for newly visible ranges", () => {
	const doc = "First @remind\n\nSecond @remind";
	const endOfFirstLine = doc.indexOf("\n");
	let view = viewFor(doc, [{ from: 0, to: endOfFirstLine }]);
	const highlighter = new ReminderHighlighter(view);
	assert.deepEqual(spans(highlighter, view), [{ from: 6, to: endOfFirstLine, text: "@remind" }]);
	view = viewFor(doc, [{ from: endOfFirstLine + 2, to: doc.length }]);
	update(highlighter, view, false, true);
	assert.deepEqual(spans(highlighter, view), [{ from: doc.lastIndexOf("@remind"), to: doc.length, text: "@remind" }]);
});

test("emoji before and inside reminders preserve CodeMirror UTF-16 positions", () => {
	const doc = "🙂 Plan @remind(🙂 pending)";
	const view = viewFor(doc);
	const from = doc.indexOf("@remind");
	assert.equal(from, 8);
	assert.deepEqual(spans(new ReminderHighlighter(view), view), [{ from, to: doc.length, text: doc.slice(from) }]);
});

test("selection-only updates retain existing decorations", () => {
	const view = viewFor("Call Sam @remind");
	const highlighter = new ReminderHighlighter(view);
	const decorations = highlighter.decorations;
	update(highlighter, view, false);
	assert.equal(highlighter.decorations, decorations);
});
