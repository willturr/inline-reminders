import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { ReminderHighlighter, refreshEditorReminderHighlights } from "../src/highlighting";

const originalNow = Date.now;
let now = Date.parse("2026-10-27T12:00:00Z");
const highlighters = new Set<ReminderHighlighter>();
const plugins = new Map<EditorView, ReminderHighlighter>();
const dispatches = new WeakMap<EditorView, number>();

beforeEach(() => {
	now = Date.parse("2026-10-27T12:00:00Z");
	Date.now = () => now;
});

afterEach(() => {
	for (const highlighter of highlighters) highlighter.destroy();
	highlighters.clear();
	plugins.clear();
	Date.now = originalNow;
});

function highlighterFor(view: EditorView): ReminderHighlighter {
	const highlighter = new ReminderHighlighter(view);
	highlighters.add(highlighter);
	plugins.set(view, highlighter);
	return highlighter;
}

function viewFor(doc: string, visibleRanges?: { from: number; to: number }[]): EditorView {
	const state = EditorState.create({ doc });
	const stub = {
		state,
		visibleRanges: visibleRanges ?? [{ from: 0, to: state.doc.length }],
		destroyed: false,
		dispatch(spec: TransactionSpec) {
			dispatches.set(view, (dispatches.get(view) ?? 0) + 1);
			const transaction = stub.state.update(spec);
			stub.state = transaction.state;
			if (!visibleRanges) stub.visibleRanges = [{ from: 0, to: stub.state.doc.length }];
			plugins.get(view)?.update({ view, state: stub.state, docChanged: transaction.docChanged,
				viewportChanged: false, transactions: [transaction] } as unknown as ViewUpdate);
		},
	};
	const view = stub as unknown as EditorView;
	return view;
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
	highlighter.update({ view, state: view.state, docChanged, viewportChanged, transactions: [] } as unknown as ViewUpdate);
}

test("initial editor content highlights the complete reminder marker", () => {
	const doc = "Call Sam @remind(2026-10-23 09:00) tomorrow";
	const view = viewFor(doc);
	const highlighter = highlighterFor(view);
	const from = doc.indexOf("@remind");
	const to = doc.indexOf(")") + 1;
	assert.deepEqual(spans(highlighter, view), [{ from, to, text: doc.slice(from, to) }]);
});

test("a bare keyword highlights as soon as it is typed", () => {
	const doc = "Call Sam @remind";
	const view = viewFor(doc);
	assert.deepEqual(spans(highlighterFor(view), view), [{ from: 9, to: doc.length, text: "@remind" }]);
});

test("an unfinished date highlights through the end of its line", () => {
	const doc = "Call Sam @remind(2026-10-\nNext line";
	const view = viewFor(doc);
	const to = doc.indexOf("\n");
	assert.deepEqual(spans(highlighterFor(view), view), [{ from: 9, to, text: doc.slice(9, to) }]);
});

test("typing and full document edits rebuild ranges, and deleting a marker removes its highlight", () => {
	let view = viewFor("Call Sam @remind");
	const highlighter = highlighterFor(view);
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
	assert.deepEqual(spans(highlighterFor(view), view), [{ from, to: doc.length, text: "@remind" }]);
});

test("scrolling updates decorations for newly visible ranges", () => {
	const doc = "First @remind\n\nSecond @remind";
	const endOfFirstLine = doc.indexOf("\n");
	let view = viewFor(doc, [{ from: 0, to: endOfFirstLine }]);
	const highlighter = highlighterFor(view);
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
	assert.deepEqual(spans(highlighterFor(view), view), [{ from, to: doc.length, text: doc.slice(from) }]);
});

test("selection-only updates retain existing decorations", () => {
	const view = viewFor("Call Sam @remind");
	const highlighter = highlighterFor(view);
	const decorations = highlighter.decorations;
	update(highlighter, view, false);
	assert.equal(highlighter.decorations, decorations);
});

function styles(highlighter: ReminderHighlighter, view: EditorView): { text: string; overdue: boolean; title: unknown }[] {
	const result: { text: string; overdue: boolean; title: unknown }[] = [];
	highlighter.decorations.between(0, view.state.doc.length, (from, to, decoration) => {
		const classes = String(decoration.spec.class).split(/\s+/);
		assert.ok(classes.includes("inline-reminders-highlight"));
		result.push({ text: view.state.doc.sliceString(from, to), overdue: classes.includes("is-overdue"), title: decoration.spec.attributes?.title });
	});
	return result;
}

test("past and exactly due reminders are red, while future and incomplete markers retain default styling", () => {
	const view = viewFor([
		"Past @remind(2026-10-27T11:59:59Z)", "Now @remind(2026-10-27T12:00:00Z)",
		"Future @remind(2026-10-27T12:00:01Z)", "Invalid @remind(2026-02-30T12:00Z)", "Bare @remind", "Unfinished @remind(2026-",
	].join("\n"));
	const marks = styles(highlighterFor(view), view);
	assert.deepEqual(marks.map(mark => mark.overdue), [true, true, false, false, false, false]);
	assert.equal(marks[0].title, "Overdue reminder");
	assert.equal(marks[1].title, "Overdue reminder");
});

test("rescheduling an overdue reminder clears red without removing its highlight", () => {
	const view = viewFor("Call @remind(2026-10-27T11:00Z)");
	const highlighter = highlighterFor(view);
	assert.equal(styles(highlighter, view)[0].overdue, true);
	view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "Call @remind(2026-10-28T11:00Z)" } });
	assert.equal(styles(highlighter, view)[0].overdue, false);
	assert.equal(spans(highlighter, view).length, 1);
});

test("checked task markers keep default styling even when their date is past", () => {
	const view = viewFor("- [x] Done @remind(2026-10-27T11:00Z)\n- [ ] Pending @remind(2026-10-27T11:00Z)");
	const highlighter = highlighterFor(view);
	assert.deepEqual(styles(highlighter, view).map(mark => mark.overdue), [false, true]);
	view.dispatch({ changes: { from: 3, to: 4, insert: " " } });
	assert.deepEqual(styles(highlighter, view).map(mark => mark.overdue), [true, true]);
});

test("clock refresh turns a newly due marker red without a document edit", () => {
	const view = viewFor("Call @remind(2026-10-27T12:00:01Z)");
	const highlighter = highlighterFor(view);
	assert.equal(styles(highlighter, view)[0].overdue, false);
	now += 1000;
	refreshEditorReminderHighlights();
	assert.equal(styles(highlighter, view)[0].overdue, true);
	assert.equal(dispatches.get(view), 1);
	now -= 2000;
	refreshEditorReminderHighlights();
	assert.equal(styles(highlighter, view)[0].overdue, false);
});

test("destroying an editor highlighter removes it from clock refresh dispatches", () => {
	const view = viewFor("Call @remind(2026-10-27T12:00:01Z)");
	const highlighter = highlighterFor(view);
	refreshEditorReminderHighlights();
	assert.equal(dispatches.get(view), 1);
	highlighter.destroy();
	highlighters.delete(highlighter);
	plugins.delete(view);
	refreshEditorReminderHighlights();
	assert.equal(dispatches.get(view), 1);
});
