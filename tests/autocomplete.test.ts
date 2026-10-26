import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { parseReminderDate } from "../src/parser";

const bundle = buildSync({ entryPoints: [resolve(__dirname, "../src/autocomplete.ts")], bundle: true,
	platform: "node", format: "cjs", write: false, external: ["obsidian"] }).outputFiles[0].text;

interface Position { line: number; ch: number }
interface Item { label: string; timestamp: number | null }

class Element {
	children: Element[] = [];
	text = "";
	value = "";
	classes = new Set<string>();
	classList = { contains: (name: string) => this.classes.has(name) };
	onsubmit?: (event: { preventDefault(): void }) => void;
	onchange?: (value: string) => void;
	constructor(public tag = "div") {}
	createEl(tag: string, options?: { text?: string; cls?: string }) {
		const child = new Element(tag);
		child.text = options?.text ?? "";
		for (const name of options?.cls?.split(" ") ?? []) child.classes.add(name);
		this.children.push(child);
		return child;
	}
	createDiv(options?: { text?: string; cls?: string }) { return this.createEl("div", options); }
	setText(value: string) { this.text = value; }
	empty() { this.children = []; }
	setAttribute() {}
	focus() {}
	find(tag: string): Element | undefined {
		for (const child of this.children) {
			if (child.tag === tag) return child;
			const match = child.find(tag);
			if (match) return match;
		}
		return undefined;
	}
}

class Editor {
	cursor: Position;
	selected = false;
	focused = 0;
	transactions: { transaction: any; origin: string }[] = [];
	constructor(public content: string, ch = content.length) { this.cursor = { line: 0, ch }; }
	getValue() { return this.content; }
	getLine(line: number) { return this.content.split("\n")[line] ?? ""; }
	getCursor() { return { ...this.cursor }; }
	somethingSelected() { return this.selected; }
	focus() { this.focused++; }
	transaction(transaction: any, origin: string) {
		this.transactions.push({ transaction, origin });
		for (const change of transaction.changes) this.content = this.content.slice(0, change.from.ch) + change.text + this.content.slice(change.to.ch);
		this.cursor = { ...transaction.selection.from };
	}
}

function harness(content = "Call @remind", ch = content.length) {
	let now = Date.parse("2030-01-01T12:00:00Z");
	let enabled = true;
	const editor = new Editor(content, ch);
	const file = { path: "Tasks.md" };
	const files = new Map([[file.path, file]]);
	let active: { file: typeof file; editor: Editor } | null = { file, editor };
	const app = { vault: { getAbstractFileByPath: (path: string) => files.get(path) },
		workspace: { getActiveViewOfType: () => active } };
	const notices: string[] = [];
	const modals: Modal[] = [];
	class EditorSuggest {
		context: any = null;
		closed = 0;
		keys = new Map<string, (event: unknown) => unknown>();
		scope = { register: (_modifiers: string[], key: string, callback: (event: unknown) => unknown) => this.keys.set(key, callback) };
		constructor(public app: unknown) {}
		setInstructions() {}
		close() { this.closed++; this.context = null; }
	}
	class Modal {
		contentEl = new Element();
		titleEl = new Element();
		closed = false;
		constructor(public app: unknown) { modals.push(this); }
		open() { (this as unknown as { onOpen(): void }).onOpen(); }
		close() { this.closed = true; (this as unknown as { onClose(): void }).onClose(); }
	}
	class Setting {
		constructor(private parent: Element) {}
		setName() { return this; }
		setDesc() { return this; }
		addText(callback: (component: unknown) => void) {
			const input = this.parent.createEl("input");
			const component = { inputEl: input, setValue(value: string) { input.value = value; return component; },
				onChange(change: (value: string) => void) { input.onchange = change; return component; } };
			callback(component);
			return this;
		}
	}
	const module = { exports: {} as any };
	runInNewContext(bundle, { module, exports: module.exports, Date: class extends Date { static now() { return now; } },
		require: (name: string) => {
			assert.equal(name, "obsidian");
			return { EditorSuggest, Modal, Setting, MarkdownView: class {}, Notice: class { constructor(message: string) { notices.push(message); } } };
		} });
	const suggest = new module.exports.ReminderDateSuggest(app, () => enabled);
	function trigger() {
		const context = suggest.onTrigger(editor.cursor, editor, file);
		if (context) suggest.context = { ...context, editor, file };
		return context;
	}
	function suggestions(): Item[] { assert.ok(trigger()); return suggest.getSuggestions(suggest.context); }
	function select(item: Item) { suggest.selectSuggestion(item, {}); }
	function openPicker() { const picker = suggestions().find(item => item.timestamp === null)!; select(picker); return modals[modals.length - 1]; }
	function submit(modal: Modal, value: string) {
		const input = modal.contentEl.find("input")!;
		input.value = value;
		input.onchange?.(value);
		modal.contentEl.find("form")!.onsubmit!({ preventDefault() {} });
	}
	return { suggest, editor, file, files, notices, modals, trigger, suggestions, select, openPicker, submit,
		setNow: (value: number) => { now = value; }, now: () => now, disable: () => { enabled = false; },
		createPicker: (initial: number, choose: (timestamp: number) => boolean) => new module.exports.ReminderDatePicker(app, initial, choose) as Modal & { open(): void },
		setActive: (value: typeof active) => { active = value; } };
}

test("native trigger opens only for an active reminder and an unselected cursor", () => {
	const instance = harness("Call @remind(tomorrow)", 20);
	assert.equal(instance.trigger()?.query, "tomorro");
	instance.editor.selected = true;
	assert.equal(instance.trigger(), null);
	for (const text of ["`@remind`", "\\@remind", "@reminder", "<!-- @remind -->", "@remind(done) suffix"]) {
		const other = harness(text);
		assert.equal(other.trigger(), null);
	}
	instance.editor.selected = false;
	instance.disable();
	assert.equal(instance.trigger(), null);
});

test("suggestions include a calendar fallback and render an exact date preview", () => {
	const instance = harness();
	const items = instance.suggestions();
	assert.equal(items[items.length - 1]?.label, "Choose date…");
	assert.equal(items[items.length - 1]?.timestamp, null);
	const candidate = items.find(item => item.timestamp !== null)!;
	assert.ok(candidate);
	const row = new Element();
	instance.suggest.renderSuggestion(candidate, row);
	assert.equal(row.children[0].text, candidate.label);
	assert.match(row.children[1].text, /2030/);
	assert.ok(row.children[1].text.includes(":") && row.children[1].text.length > 10);
});

test("choosing a date replaces the whole existing marker and preserves surrounding prose", () => {
	const instance = harness("Call @remind(tomorrow) after breakfast", 17);
	const item = instance.suggestions().find(item => item.timestamp !== null)!;
	instance.select(item);
	assert.match(instance.editor.content, /^Call @remind\([^)]*\) after breakfast$/);
	assert.equal(instance.editor.transactions.length, 1);
	assert.equal(instance.editor.transactions[0].origin, "inline-reminders");
	assert.equal(instance.editor.cursor.ch, instance.editor.content.indexOf(")") + 1);
	assert.equal(parseReminderDate(instance.editor.content.match(/@remind\(([^)]*)\)/)![1]), item.timestamp);
});

test("accepting a preview keeps its shown instant even after the clock advances", () => {
	const instance = harness();
	const item = instance.suggestions().find(item => item.timestamp !== null && item.timestamp > instance.now() + 120_000)!;
	instance.setNow(instance.now() + 60_000);
	instance.select(item);
	assert.equal(parseReminderDate(instance.editor.content.match(/@remind\(([^)]*)\)/)![1]), item.timestamp);
});

test("a candidate whose time passed before acceptance is rejected", () => {
	const instance = harness();
	const item = instance.suggestions().find(item => item.timestamp !== null)!;
	instance.setNow(item.timestamp! + 1);
	instance.select(item);
	assert.equal(instance.editor.transactions.length, 0);
	assert.match(instance.notices[0], /time has passed/);
});

test("stale query context cannot replace a changed marker", () => {
	const instance = harness("@remind(tomorrow", 16);
	const item = instance.suggestions().find(item => item.timestamp !== null)!;
	instance.editor.content = "@remind(next week";
	instance.editor.cursor.ch = instance.editor.content.length;
	instance.select(item);
	assert.equal(instance.editor.transactions.length, 0);
	assert.ok(instance.suggest.closed > 0);
});

test("selecting text after suggestions open prevents acceptance", () => {
	const instance = harness();
	const item = instance.suggestions().find(item => item.timestamp !== null)!;
	instance.editor.selected = true;
	instance.select(item);
	assert.equal(instance.editor.transactions.length, 0);
});

test("Tab accepts the native row selected by arrow keys instead of the first row", () => {
	const instance = harness();
	const items = instance.suggestions().filter(item => item.timestamp !== null);
	assert.ok(items.length >= 2);
	for (const [index, item] of items.entries()) {
		const row = new Element();
		if (index === 1) row.classes.add("is-selected");
		instance.suggest.renderSuggestion(item, row);
	}
	assert.equal(instance.suggest.keys.get("Tab")!({}), false);
	assert.equal(parseReminderDate(instance.editor.content.match(/@remind\(([^)]*)\)/)![1]), items[1].timestamp);
});

test("calendar cancellation does not change the note", () => {
	const instance = harness();
	instance.openPicker().close();
	assert.equal(instance.editor.content, "Call @remind");
	assert.equal(instance.editor.transactions.length, 0);
});

test("calendar submission checks the date and inserts only a future valid selection", () => {
	const instance = harness();
	const modal = instance.openPicker();
	instance.submit(modal, "2000-01-01T09:00");
	assert.equal(instance.editor.transactions.length, 0);
	assert.equal(modal.closed, false);
	instance.submit(modal, "2030-01-02T09:00");
	assert.equal(instance.editor.transactions.length, 1);
	assert.equal(modal.closed, true);
	assert.match(instance.editor.content, /^Call @remind\([^)]*\)$/);
});

test("calendar capture rejects changed document, file identity, active view, or disabled plugin", () => {
	for (const invalidate of [
		(instance: ReturnType<typeof harness>) => { instance.editor.content += " changed"; },
		(instance: ReturnType<typeof harness>) => { instance.file.path = "Renamed.md"; },
		(instance: ReturnType<typeof harness>) => { instance.files.set("Tasks.md", { path: "Tasks.md" }); },
		(instance: ReturnType<typeof harness>) => { instance.setActive(null); },
		(instance: ReturnType<typeof harness>) => { instance.setActive({ file: instance.file, editor: new Editor("Other editor") }); },
		(instance: ReturnType<typeof harness>) => { instance.disable(); },
	]) {
		const instance = harness();
		const modal = instance.openPicker();
		invalidate(instance);
		instance.submit(modal, "2030-01-02T09:00");
		assert.equal(instance.editor.transactions.length, 0);
		assert.equal(modal.closed, false);
	}
});

test("the insert command uses its captured position even when the cursor moves", () => {
	const instance = harness("Call Sam");
	instance.suggest.insertReminder(instance.editor, { file: instance.file });
	instance.editor.cursor.ch = 0;
	instance.submit(instance.modals[instance.modals.length - 1], "2030-01-02T09:00");
	assert.match(instance.editor.content, /^Call Sam @remind\([^)]*\)$/);
	assert.equal(instance.editor.transactions.length, 1);
	assert.equal(instance.editor.cursor.ch, instance.editor.content.length);
});

test("an unchanged date picker preserves the second occurrence of a repeated autumn hour", () => {
	const previous = process.env.TZ;
	process.env.TZ = "Europe/London";
	try {
		const instance = harness();
		instance.setNow(Date.parse("2026-10-25T00:45:00Z"));
		const initial = Date.parse("2026-10-25T01:30:00Z");
		let chosen: number | null = null;
		const picker = instance.createPicker(initial, timestamp => { chosen = timestamp; return true; });
		picker.open();
		const input = picker.contentEl.find("input")!;
		assert.equal(input.value, "2026-10-25T01:30");
		instance.submit(picker, input.value);
		assert.equal(chosen, initial);
		assert.equal(picker.closed, true);
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});

test("the insert command's next-hour seed remains in the future during the autumn clock change", () => {
	const previous = process.env.TZ;
	process.env.TZ = "Europe/London";
	try {
		const instance = harness("Call Sam");
		instance.setNow(Date.parse("2026-10-25T00:45:30Z"));
		instance.suggest.insertReminder(instance.editor, { file: instance.file });
		const picker = instance.modals[instance.modals.length - 1];
		const input = picker.contentEl.find("input")!;
		assert.equal(input.value, "2026-10-25T01:45");
		instance.submit(picker, input.value);
		assert.equal(instance.editor.transactions.length, 1);
		assert.equal(parseReminderDate(instance.editor.content.match(/@remind\(([^)]*)\)/)![1]), Date.parse("2026-10-25T01:45:00Z"));
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});

test("disposing suggestions closes an open date picker", () => {
	const instance = harness();
	const modal = instance.openPicker();
	instance.suggest.dispose();
	assert.equal(modal.closed, true);
	assert.ok(instance.suggest.closed > 0);
	assert.equal(instance.editor.transactions.length, 0);
});
