import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import * as codemirrorView from "@codemirror/view";
import * as codemirrorState from "@codemirror/state";
import { parseReminders, type ParseResult, type Reminder } from "../src/parser";
import type { SavedState } from "../src/state";

const bundle = buildSync({
	entryPoints: [resolve(__dirname, "../src/main.ts")],
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false,
	external: ["obsidian", "@codemirror/*"],
}).outputFiles[0].text;

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

class Events {
	private callbacks = new Map<string, Set<(...args: any[]) => void>>();
	on(name: string, callback: (...args: any[]) => void) {
		const listeners = this.callbacks.get(name) ?? new Set();
		listeners.add(callback);
		this.callbacks.set(name, listeners);
		return { off: () => listeners.delete(callback) };
	}
	emit(name: string, ...args: any[]) {
		for (const callback of this.callbacks.get(name) ?? []) callback(...args);
	}
}

class AbstractFile { constructor(public path: string) {} }
class File extends AbstractFile {
	get extension() { return this.path.split(".").pop() ?? ""; }
}
class MarkdownView {
  contentEl = { querySelectorAll: () => [] };
	constructor(public file: File, public editor: { getValue(): string }) {}
	getMode() { return "source"; }
}

interface PluginInstance {
	onload(): Promise<void>;
	onunload(): void;
	unload(): void;
	rescan(): Promise<void>;
	allReminders(): Reminder[];
	checkDue(): Promise<void>;
	testNotification(): Promise<void>;
	state: SavedState;
	index: Map<string, ParseResult>;
	pending: Set<string>;
	notifications: Set<{ close(): void }>;
	sendNotification(body: string, open: () => void): void;
	saveData(snapshot: SavedState): Promise<void>;
	saveState(): Promise<void>;
}

function harness(notes: Record<string, string>, saved: unknown = null, notificationAPI?: unknown) {
	const timers = new Map<number, () => void>();
	const intervals = new Map<number, () => void>();
	let nextTimer = 0;
	const window = {
		setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
		clearTimeout: (id: number) => timers.delete(id),
		setInterval: (callback: () => void) => { intervals.set(++nextTimer, callback); return nextTimer; },
		clearInterval: (id: number) => intervals.delete(id),
	};
	const files = new Map(Object.keys(notes).map(path => [path, new File(path)]));
	const vaultEvents = new Events();
	const workspaceEvents = new Events();
	const markdownLeaves: { view: MarkdownView }[] = [];
	let read: ((file: File) => Promise<string>) | undefined;
	const app = {
		vault: {
			on: vaultEvents.on.bind(vaultEvents),
			getMarkdownFiles: () => [...files.values()].filter(file => file.extension === "md"),
			getAbstractFileByPath: (path: string) => files.get(path),
			cachedRead: (file: File) => read ? read(file) : Promise.resolve(notes[file.path]),
		},
		workspace: {
			on: workspaceEvents.on.bind(workspaceEvents),
			onLayoutReady: (_callback: () => void) => {},
			getLeavesOfType: (type: string) => type === "markdown" ? markdownLeaves : [],
		},
	};
	const saves: SavedState[] = [];
	class Plugin {
		app = app;
		private events: { off(): void }[] = [];
		private intervalIds: number[] = [];
		async loadData() { return saved; }
		async saveData(snapshot: SavedState) { saves.push(JSON.parse(JSON.stringify(snapshot))); }
		registerView() {}
		addRibbonIcon() {}
		addCommand() {}
		addSettingTab() {}
		registerEditorExtension() {}
		registerMarkdownPostProcessor() {}
		registerEditorSuggest() {}
		registerDomEvent() {}
		registerEvent(event: { off(): void }) { this.events.push(event); }
		registerInterval(id: number) { this.intervalIds.push(id); }
		unload() {
			(this as unknown as PluginInstance).onunload();
			for (const event of this.events) event.off();
			for (const id of this.intervalIds) window.clearInterval(id);
		}
	}
	class EmptyClass {}
	class EditorSuggest {
		context = null;
		scope = { register() {} };
		constructor(public app: unknown) {}
		setInstructions() {}
		close() { this.context = null; }
	}
	const errors: unknown[][] = [];
	const module = { exports: {} as { default: new () => PluginInstance } };
	runInNewContext(bundle, {
		module,
		exports: module.exports,
		require: (name: string) => {
			if (name === "@codemirror/view") return codemirrorView;
			if (name === "@codemirror/state") return codemirrorState;
			assert.equal(name, "obsidian");
			return { Plugin, EditorSuggest, ItemView: EmptyClass, MarkdownView, Modal: EmptyClass, Notice: EmptyClass, PluginSettingTab: EmptyClass, Setting: EmptyClass, TAbstractFile: AbstractFile, TFile: File };
		},
		window,
		document: { hidden: false },
		Notification: notificationAPI,
		console: { ...console, error: (...args: unknown[]) => errors.push(args) },
	});
	const plugin = new module.exports.default();
	const nativeSendNotification = plugin.sendNotification.bind(plugin);
	const notifications: string[] = [];
	plugin.sendNotification = body => { notifications.push(body); };
	return {
		plugin, files, notes, timers, intervals, saves, notifications, errors, vaultEvents, workspaceEvents, markdownLeaves, nativeSendNotification,
		setRead: (callback: typeof read) => { read = callback; },
		async flushTimers() {
			for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
			for (let i = 0; i < 12; i++) await Promise.resolve();
		},
	};
}

const dueText = "Call Alex @remind(2001-01-01T09:00Z)";

test("startup delivers an overdue reminder once and honors persisted delivery on restart", async () => {
	const first = harness({ "Tasks.md": dueText });
	await first.plugin.onload();
	assert.equal(first.notifications.length, 0);
	await first.plugin.rescan();
	assert.deepEqual(first.notifications, ["Call Alex"]);
	await first.plugin.checkDue();
	assert.equal(first.notifications.length, 1);
	assert.equal(Object.keys(first.saves[first.saves.length - 1].notified).length, 1);
	first.plugin.unload();

	const restarted = harness({ "Tasks.md": dueText }, first.saves[first.saves.length - 1]);
	await restarted.plugin.onload();
	await restarted.plugin.rescan();
	assert.equal(restarted.notifications.length, 0);
	restarted.plugin.unload();
});

test("startup batches four or more overdue reminders after indexing all notes", async () => {
	const instance = harness(Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`${i}.md`, `Task ${i} @remind(2001-01-0${i + 1}T09:00Z)`])));
	await instance.plugin.onload();
	await instance.plugin.rescan();
	assert.equal(instance.notifications.length, 1);
	assert.match(instance.notifications[0], /4 reminders are due/);
	assert.equal(Object.keys(instance.plugin.state.notified).length, 4);
	instance.plugin.unload();
});

test("pending editor changes suppress stale due reminders and use unsaved editor text", async () => {
	const reminder = parseReminders("Tasks.md", dueText).reminders[0];
	const instance = harness({ "Tasks.md": dueText }, { dismissed: { [reminder.key]: 1 } });
	await instance.plugin.onload();
	await instance.plugin.rescan();
	instance.plugin.state.dismissed = {};
	const file = instance.files.get("Tasks.md")!;
	instance.markdownLeaves.push({ view: new MarkdownView(file, { getValue: () => "Reminder removed in the editor" }) });
	instance.workspaceEvents.emit("editor-change", {}, { file });
	await instance.plugin.checkDue();
	assert.equal(instance.notifications.length, 0);
	await instance.flushTimers();
	assert.equal(instance.plugin.allReminders().length, 0);
	assert.equal(instance.notifications.length, 0);
	instance.plugin.unload();
});

test("an edit during notification persistence cancels the stale delivery and rolls back its status", async () => {
	const instance = harness({ "Tasks.md": dueText });
	await instance.plugin.onload();
	const saveStarted = deferred<void>();
	const releaseSave = deferred<void>();
	const save = instance.plugin.saveData.bind(instance.plugin);
	let pause = true;
	instance.plugin.saveData = async snapshot => {
		await save(snapshot);
		if (pause) {
			pause = false;
			saveStarted.resolve();
			await releaseSave.promise;
		}
	};
	const scan = instance.plugin.rescan();
	await saveStarted.promise;
	instance.notes["Tasks.md"] = "Reminder removed";
	instance.vaultEvents.emit("modify", instance.files.get("Tasks.md"));
	releaseSave.resolve();
	await scan;
	assert.equal(instance.notifications.length, 0);
	assert.equal(Object.keys(instance.plugin.state.notified).length, 0);
	assert.equal(Object.keys(instance.saves[instance.saves.length - 1].notified).length, 0);
	await instance.flushTimers();
	assert.equal(instance.plugin.allReminders().length, 0);
	instance.plugin.unload();
});

test("a failed delivery commit cannot leak provisional status through a queued settings save", async () => {
	const instance = harness({ "Tasks.md": dueText });
	await instance.plugin.onload();
	const saveStarted = deferred<void>();
	const releaseSave = deferred<void>();
	const save = instance.plugin.saveData.bind(instance.plugin);
	let fail = true;
	instance.plugin.saveData = async snapshot => {
		if (fail) {
			fail = false;
			saveStarted.resolve();
			await releaseSave.promise;
			throw new Error("Simulated transient save failure");
		}
		await save(snapshot);
	};
	const scan = instance.plugin.rescan();
	await saveStarted.promise;
	instance.plugin.state.desktopNotifications = false;
	const settingsSave = instance.plugin.saveState();
	releaseSave.resolve();
	await Promise.all([scan, settingsSave]);
	assert.equal(instance.notifications.length, 0);
	assert.equal(Object.keys(instance.plugin.state.notified).length, 0);
	assert.equal(Object.keys(instance.saves[instance.saves.length - 1].notified).length, 0);
	assert.equal(instance.errors.length, 1);
	instance.plugin.unload();
});

test("rename migrates delivered and dismissed keys; deletion removes indexed reminders", async () => {
	const text = `${dueText}\nSecond @remind(2001-01-02T09:00Z)`;
	const reminders = parseReminders("Tasks.md", text).reminders;
	const instance = harness({ "Tasks.md": text }, { notified: { [reminders[0].key]: 1 }, dismissed: { [reminders[1].key]: 1 } });
	await instance.plugin.onload();
	await instance.plugin.rescan();
	const file = instance.files.get("Tasks.md")!;
	instance.files.delete(file.path);
	delete instance.notes[file.path];
	file.path = "Moved/Tasks.md";
	instance.files.set(file.path, file);
	instance.notes[file.path] = text;
	instance.vaultEvents.emit("rename", file, "Tasks.md");
	assert.equal(instance.plugin.allReminders().length, 0);
	assert.equal(Object.keys(instance.plugin.state.notified)[0], reminders[0].key.replace("Tasks.md", file.path));
	assert.equal(Object.keys(instance.plugin.state.dismissed)[0], reminders[1].key.replace("Tasks.md", file.path));
	await instance.flushTimers();
	assert.equal(instance.plugin.allReminders().length, 2);
	assert.equal(instance.plugin.allReminders()[0].path, file.path);
	assert.equal(instance.notifications.length, 0);
	instance.files.delete(file.path);
	delete instance.notes[file.path];
	instance.vaultEvents.emit("delete", file);
	assert.equal(instance.plugin.allReminders().length, 0);
	await instance.plugin.checkDue();
	assert.equal(instance.notifications.length, 0);
	instance.plugin.unload();
});

test("unload cancels queued reads and closes owned desktop notifications", async () => {
	const instance = harness({ "Tasks.md": "Future @remind(2999-01-01T09:00Z)" });
	await instance.plugin.onload();
	await instance.plugin.rescan();
	instance.vaultEvents.emit("modify", instance.files.get("Tasks.md"));
	assert.equal(instance.timers.size, 1);
	let closed = 0;
	instance.plugin.notifications.add({ close: () => { closed++; } });
	instance.plugin.unload();
	assert.equal(instance.timers.size, 0);
	assert.equal(instance.intervals.size, 0);
	assert.equal(closed, 1);
	assert.equal(instance.plugin.notifications.size, 0);
	instance.vaultEvents.emit("modify", instance.files.get("Tasks.md"));
	assert.equal(instance.timers.size, 0);
});

test("an asynchronous read completing after unload cannot populate the index or notify", async () => {
	const instance = harness({ "Tasks.md": dueText });
	const started = deferred<void>();
	const read = deferred<string>();
	instance.setRead(async () => { started.resolve(); return read.promise; });
	await instance.plugin.onload();
	const scan = instance.plugin.rescan();
	await started.promise;
	instance.plugin.unload();
	read.resolve(dueText);
	await scan;
	assert.equal(instance.plugin.allReminders().length, 0);
	assert.equal(instance.notifications.length, 0);
});

test("notification permission resolving after unload cannot save settings or display a notification", async () => {
	const permission = deferred<"granted">();
	let created = 0;
	class PendingNotification {
		static permission = "default";
		static async requestPermission() {
			const result = await permission.promise;
			this.permission = result;
			return result;
		}
		constructor() { created++; }
	}
	const instance = harness({}, null, PendingNotification);
	instance.plugin.sendNotification = instance.nativeSendNotification;
	await instance.plugin.onload();
	const request = instance.plugin.testNotification();
	instance.plugin.unload();
	permission.resolve("granted");
	await request;
	instance.nativeSendNotification("Closed plugin", () => {});
	assert.equal(instance.saves.length, 0);
	assert.equal(created, 0);
});
