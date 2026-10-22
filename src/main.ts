import {
  App, Editor, ItemView, MarkdownView, Modal, Notice, Plugin,
  PluginSettingTab, Setting, TAbstractFile, TFile, WorkspaceLeaf
} from "obsidian";
import { formatLocalDate, parseReminderDate, parseReminders, ParseResult, Reminder } from "./parser";
import { requestNotificationPermission, showDesktopNotification } from "./notifications";
import { dueReminders, loadState, renameState, SavedState, visibleReminders } from "./state";

const VIEW_TYPE = "inline-reminders-upcoming";

export default class InlineRemindersPlugin extends Plugin {
  state: SavedState = loadState(null);
  private index = new Map<string, ParseResult>();
  private versions = new Map<string, number>();
  private timers = new Map<string, number>();
  private pending = new Set<string>();
  private readErrors = new Set<string>();
  private notifications = new Set<Notification>();
  private saveChain: Promise<void> = Promise.resolve();
  private ready = false;
  private scanning = false;
  private checking = false;
  private contentRevision = 0;
  private stopped = false;
  private lastSaveWarning = 0;

  async onload(): Promise<void> {
    try {
      this.state = loadState(await this.loadData());
    } catch (error) {
      console.error("Inline Reminders: could not load saved state", error);
      new Notice("Inline Reminders could not load its saved state. Disable and re-enable the plugin to retry.", 12000);
      return;
    }
    this.registerView(VIEW_TYPE, leaf => new RemindersView(leaf, this));
    this.addRibbonIcon("bell", "Upcoming reminders", () => { void this.openView(); });
    this.addCommand({ id: "show-upcoming", name: "Show upcoming reminders", callback: () => { void this.openView(); } });
    this.addCommand({
      id: "insert-reminder", name: "Insert reminder",
      editorCallback: editor => new InsertReminderModal(this.app, editor).open()
    });
    this.addCommand({ id: "test-notification", name: "Enable and test desktop notifications", callback: () => { void this.testNotification(); } });
    this.addCommand({ id: "rescan", name: "Rescan reminders", callback: () => { void this.rescan(); } });
    this.addSettingTab(new RemindersSettings(this.app, this));

    this.registerEvent(this.app.vault.on("create", file => { if (isMarkdown(file)) this.queueFile(file); }));
    this.registerEvent(this.app.vault.on("modify", file => { if (isMarkdown(file)) this.queueFile(file); }));
    this.registerEvent(this.app.vault.on("delete", file => this.removePath(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.removePath(oldPath);
      renameState(this.state, oldPath, file.path);
      void this.saveState().catch(error => this.saveWarning(error));
      for (const note of this.app.vault.getMarkdownFiles()) {
        if (note.path === file.path || note.path.startsWith(file.path + "/")) this.queueFile(note);
      }
    }));
    this.registerEvent(this.app.workspace.on("editor-change", (_editor, info) => {
      if (info.file) this.queueFile(info.file);
    }));
    this.registerDomEvent(window, "focus", () => { this.refreshViews(); void this.checkDue(); });
    this.registerDomEvent(document, "visibilitychange", () => {
      if (!document.hidden) { this.refreshViews(); void this.checkDue(); }
    });
    this.registerInterval(window.setInterval(() => { this.refreshViews(); void this.checkDue(); }, 10000));
    this.app.workspace.onLayoutReady(() => { if (!this.stopped) void this.rescan(); });
  }

  onunload(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    for (const notification of this.notifications) notification.close();
    this.notifications.clear();
  }

  private nextVersion(path: string): number {
    const version = (this.versions.get(path) ?? 0) + 1;
    this.versions.set(path, version);
    return version;
  }

  private queueFile(file: TFile): void {
    if (this.stopped) return;
    this.contentRevision++;
    const path = file.path;
    const version = this.nextVersion(path);
    const timer = this.timers.get(path);
    if (timer !== undefined) window.clearTimeout(timer);
    this.pending.add(path);
    this.timers.set(path, window.setTimeout(() => {
      this.timers.delete(path);
      void this.readFile(file, path, version);
    }, 300));
  }

  private async readFile(file: TFile, path: string, version: number): Promise<void> {
    try {
      // Prefer current editor text so an unsaved edit cannot trigger an obsolete reminder.
      let content: string | undefined;
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file?.path === path && view.getMode() === "source") {
          content = view.editor.getValue();
          break;
        }
      }
      content ??= await this.app.vault.cachedRead(file);
      if (this.stopped || this.versions.get(path) !== version || file.path !== path || this.app.vault.getAbstractFileByPath(path) !== file) return;
      this.index.set(path, parseReminders(path, content));
      this.readErrors.delete(path);
    } catch (error) {
      if (this.stopped || this.versions.get(path) !== version) return;
      this.index.delete(path);
      this.readErrors.add(path);
      console.error(`Inline Reminders: could not read ${path}`, error);
    } finally {
      if (this.versions.get(path) === version) {
        this.pending.delete(path);
        this.refreshViews();
        void this.checkDue();
      }
    }
  }

  async rescan(): Promise<void> {
    if (this.scanning || this.stopped) return;
    this.contentRevision++;
    this.scanning = true;
    this.refreshViews();
    const files = this.app.vault.getMarkdownFiles();
    const paths = new Set(files.map(file => file.path));
    for (const path of this.index.keys()) if (!paths.has(path)) this.index.delete(path);
    for (const path of this.readErrors) if (!paths.has(path)) this.readErrors.delete(path);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
      while (next < files.length && !this.stopped) {
        const file = files[next++];
        if (this.pending.has(file.path)) continue;
        const path = file.path;
        this.pending.add(path);
        await this.readFile(file, path, this.nextVersion(path));
      }
    }));
    this.scanning = false;
    this.ready = true;
    this.refreshViews();
    await this.checkDue();
  }

  private removePath(path: string): void {
    this.contentRevision++;
    for (const candidate of new Set([...this.index.keys(), ...this.versions.keys(), ...this.timers.keys(), ...this.readErrors])) {
      if (candidate !== path && !candidate.startsWith(path + "/")) continue;
      this.nextVersion(candidate);
      this.index.delete(candidate);
      this.pending.delete(candidate);
      this.readErrors.delete(candidate);
      const timer = this.timers.get(candidate);
      if (timer !== undefined) window.clearTimeout(timer);
      this.timers.delete(candidate);
    }
    this.refreshViews();
  }

  allReminders(): Reminder[] {
    return [...this.index.values()].flatMap(result => result.reminders);
  }

  summary(): string {
    if (!this.ready || this.scanning) return "Scanning notes…";
    const invalid = [...this.index.values()].reduce((sum, item) => sum + item.invalidCount, 0);
    const messages = ["Dates without a timezone use this Mac’s local time."];
    if (invalid) messages.push(`${invalid} invalid reminder ${invalid === 1 ? "date was" : "dates were"} ignored. Use YYYY-MM-DD HH:mm.`);
    if (this.readErrors.size) messages.push(`${this.readErrors.size} notes could not be read. Use Rescan to retry.`);
    return messages.join(" ");
  }

  async saveState(): Promise<void> {
    const snapshot: SavedState = JSON.parse(JSON.stringify(this.state));
    const save = this.saveChain.catch(() => {}).then(() => this.saveData(snapshot));
    this.saveChain = save;
    return save;
  }

  private saveWarning(error: unknown): void {
    console.error("Inline Reminders: could not save state", error);
    if (Date.now() - this.lastSaveWarning > 30000) {
      this.lastSaveWarning = Date.now();
      new Notice("Inline Reminders could not save reminder status. Check that this vault is writable.", 12000);
    }
  }

  private async checkDue(): Promise<void> {
    if (!this.ready || this.scanning || this.checking || this.stopped) return;
    const due = dueReminders(this.allReminders().filter(item => !this.pending.has(item.path)), this.state, Date.now());
    if (!due.length) return;
    this.checking = true;
    const revision = this.contentRevision;
    const usedTimestamps = new Set(Object.values(this.state.notified));
    let recordedAt = Date.now();
    while (usedTimestamps.has(recordedAt)) recordedAt++;
    const rollback = () => {
      // Renames may have moved these keys while the batch was being saved.
      for (const [key, timestamp] of Object.entries(this.state.notified)) {
        if (timestamp === recordedAt) delete this.state.notified[key];
      }
    };
    for (const item of due) this.state.notified[item.key] = recordedAt;
    try {
      // Persist first so reloads cannot replay a delivered batch.
      await this.saveState();
    } catch (error) {
      rollback();
      this.saveWarning(error);
      // Follow any already queued settings save with the corrected delivery state.
      try { await this.saveState(); } catch (rollbackError) { this.saveWarning(rollbackError); }
      this.checking = false;
      return;
    }
    if (this.stopped || revision !== this.contentRevision) {
      rollback();
      try { await this.saveState(); } catch (error) { this.saveWarning(error); }
      this.checking = false;
      return;
    }
    if (!this.stopped) {
      if (due.length > 3) {
        this.sendNotification(`${due.length} reminders are due. Open Upcoming reminders to review them.`, () => { void this.openView(); });
      } else {
        for (const item of due) this.sendNotification(item.text, () => { void this.openReminder(item); });
      }
      this.refreshViews();
    }
    this.checking = false;
  }

  private sendNotification(body: string, open: () => void): void {
    if (this.stopped) return;
    const fallback = () => {
      if (this.stopped) return;
      const fragment = document.createDocumentFragment();
      fragment.createEl("div", { text: `Reminder: ${body}` });
      const button = fragment.createEl("button", { text: "Open" });
      const notice = new Notice(fragment, 15000);
      button.onclick = () => { notice.hide(); open(); };
    };
    if (!this.state.desktopNotifications) { fallback(); return; }
    const notification = showDesktopNotification("Obsidian reminder", body, () => { if (!this.stopped) open(); }, fallback);
    if (notification) {
      this.notifications.add(notification);
      notification.addEventListener("close", () => this.notifications.delete(notification), { once: true });
      notification.addEventListener("error", () => this.notifications.delete(notification), { once: true });
    }
  }

  async testNotification(): Promise<void> {
    const permission = await requestNotificationPermission();
    if (this.stopped) return;
    if (permission !== "granted") {
      new Notice("Desktop notifications are unavailable or blocked. Allow Obsidian in macOS System Settings → Notifications. In-app reminders still work.", 14000);
      return;
    }
    this.state.desktopNotifications = true;
    try { await this.saveState(); } catch (error) { this.saveWarning(error); }
    if (this.stopped) return;
    this.sendNotification("Inline Reminders is ready. Your reminders will appear here while Obsidian is running.", () => { void this.openView(); });
    new Notice("Test notification sent. If no banner appears, check macOS notification and Focus settings.", 8000);
  }

  async dismiss(item: Reminder): Promise<void> {
    this.contentRevision++;
    const usedTimestamps = new Set(Object.values(this.state.dismissed));
    let dismissedAt = Date.now();
    while (usedTimestamps.has(dismissedAt)) dismissedAt++;
    this.state.dismissed[item.key] = dismissedAt;
    const restore = () => {
      // Locate by action so Undo also works if the note was renamed.
      for (const [key, timestamp] of Object.entries(this.state.dismissed)) {
        if (timestamp === dismissedAt) delete this.state.dismissed[key];
      }
    };
    this.refreshViews();
    try {
      await this.saveState();
      if (this.stopped) return;
      const fragment = document.createDocumentFragment();
      fragment.createEl("span", { text: "Reminder dismissed. " });
      const button = fragment.createEl("button", { text: "Undo" });
      const notice = new Notice(fragment, 8000);
      button.onclick = () => {
        if (this.stopped) return;
        restore();
        notice.hide();
        this.refreshViews();
        void this.saveState().catch(error => this.saveWarning(error));
      };
    } catch (error) {
      restore();
      this.refreshViews();
      this.saveWarning(error);
    }
  }

  async openReminder(item: Reminder): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!(file instanceof TFile)) { new Notice("This reminder’s note was moved or deleted. Refresh the list."); return; }
    try {
      // Reparse before navigating because edits may have moved the reminder to another line.
      const content = await this.app.vault.cachedRead(file);
      const current = parseReminders(file.path, content).reminders.find(candidate => candidate.key === item.key) ?? item;
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file, { state: { mode: "source" }, eState: { line: current.line } });
      if (leaf.view instanceof MarkdownView) {
        leaf.view.editor.setCursor({ line: current.line, ch: current.column });
        leaf.view.editor.scrollIntoView({ from: { line: current.line, ch: current.column }, to: { line: current.line, ch: current.column } }, true);
        leaf.view.editor.focus();
      }
    } catch (error) {
      console.error("Inline Reminders: could not open note", error);
      new Notice("Could not open this reminder’s note.");
    }
  }

  async openView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  private refreshViews(): void {
    if (this.stopped) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof RemindersView) leaf.view.render();
    }
  }
}

function isMarkdown(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension === "md";
}

class InsertReminderModal extends Modal {
  constructor(app: App, private editor: Editor) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Insert reminder");
    const next = new Date(Date.now() + 60 * 60 * 1000);
    next.setSeconds(0, 0);
    let date = formatLocalDate(next);
    const form = this.contentEl.createEl("form");
    const setting = new Setting(form).setName("When").setDesc("Local time. Example: 2026-10-23 09:00");
    let input!: HTMLInputElement;
    setting.addText(component => {
      input = component.inputEl;
      input.type = "datetime-local";
      input.required = true;
      input.setAttribute("aria-label", "Reminder date and time");
      component.setValue(date.replace(" ", "T")).onChange(value => { date = value; });
    });
    const error = form.createEl("p", { cls: "inline-reminders-error", attr: { role: "alert" } });
    form.createEl("button", { text: "Insert reminder", cls: "mod-cta", attr: { type: "submit" } });
    form.onsubmit = event => {
      event.preventDefault();
      if (parseReminderDate(date) === null) { error.setText("Choose a valid date and time."); return; }
      const cursor = this.editor.getCursor("to");
      const prefix = cursor.ch > 0 && !/\s/.test(this.editor.getLine(cursor.line).charAt(cursor.ch - 1)) ? " " : "";
      this.editor.replaceRange(`${prefix}@remind(${date.replace("T", " ")})`, cursor);
      this.close();
      this.editor.focus();
    };
    input.focus();
  }

  onClose(): void { this.contentEl.empty(); }
}

class RemindersView extends ItemView {
  private query = "";
  private list!: HTMLElement;
  private description!: HTMLElement;
  private count!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private plugin: InlineRemindersPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Upcoming reminders"; }
  getIcon(): string { return "bell"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("inline-reminders-view");
    const header = this.contentEl.createDiv({ cls: "inline-reminders-header" });
    header.createEl("h2", { text: "Upcoming reminders" });
    const refresh = header.createEl("button", { text: "Rescan", attr: { "aria-label": "Rescan all notes for reminders" } });
    this.registerDomEvent(refresh, "click", () => { void this.plugin.rescan(); });
    this.description = this.contentEl.createEl("p", { cls: "inline-reminders-help" });
    const search = this.contentEl.createEl("input", { type: "search", placeholder: "Filter reminders…", attr: { "aria-label": "Filter reminders by text or note" } });
    this.registerDomEvent(search, "input", () => { this.query = search.value.toLowerCase(); this.render(); });
    this.count = this.contentEl.createEl("p", { cls: "inline-reminders-count", attr: { "aria-live": "polite" } });
    this.list = this.contentEl.createDiv({ cls: "inline-reminders-list" });
    this.render();
  }

  render(): void {
    if (!this.list) return;
    this.description.setText(this.plugin.summary());
    const items = visibleReminders(this.plugin.allReminders(), this.plugin.state).filter(item => `${item.text} ${item.path}`.toLowerCase().includes(this.query));
    this.count.setText(`${items.length} ${items.length === 1 ? "reminder" : "reminders"}`);
    // Reconcile by key so the periodic time refresh preserves keyboard focus.
    const rows = new Map(Array.from(this.list.children).map(row => [(row as HTMLElement).dataset.key ?? "", row as HTMLElement]));
    const wanted = new Set(items.map(item => item.key));
    for (const [key, row] of rows) if (!wanted.has(key)) row.remove();
    const empty = this.list.querySelector(".inline-reminders-empty");
    if (items.length) empty?.remove();
    if (!items.length) {
      const message = this.query ? "No reminders match this filter." : "No pending reminders. Add @remind(YYYY-MM-DD HH:mm) to any note.";
      if (empty) empty.textContent = message;
      else this.list.createEl("p", { text: message, cls: "inline-reminders-empty" });
    }
    for (const [position, item] of items.entries()) {
      let row = rows.get(item.key);
      if (!row) {
        row = this.list.createEl("article", { cls: "inline-reminders-card" });
        row.dataset.key = item.key;
        row.createEl("button", { cls: "inline-reminders-title" });
        row.createEl("div", { cls: "inline-reminders-path" });
        row.createEl("time", { cls: "inline-reminders-time" });
        row.createEl("button", { text: "Dismiss", cls: "inline-reminders-dismiss" });
      }
      const overdue = item.time <= Date.now();
      row.toggleClass("is-overdue", overdue);
      const title = row.querySelector<HTMLButtonElement>(".inline-reminders-title")!;
      title.setText(item.text);
      title.onclick = () => { void this.plugin.openReminder(item); };
      row.querySelector<HTMLElement>(".inline-reminders-path")!.setText(`${item.path} · line ${item.line + 1}`);
      const time = row.querySelector<HTMLTimeElement>("time")!;
      time.dateTime = new Date(item.time).toISOString();
      time.setText(`${overdue ? "Overdue · " : ""}${new Date(item.time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`);
      const dismiss = row.querySelector<HTMLButtonElement>(".inline-reminders-dismiss")!;
      dismiss.setAttribute("aria-label", `Dismiss reminder: ${item.text}`);
      dismiss.onclick = () => { void this.plugin.dismiss(item); };
      if (this.list.children[position] !== row) this.list.insertBefore(row, this.list.children[position] ?? null);
    }
  }
}

class RemindersSettings extends PluginSettingTab {
  constructor(app: App, private plugin: InlineRemindersPlugin) { super(app, plugin); }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("Desktop notifications").setDesc("Use macOS notifications when permission is granted. Otherwise, reminders appear inside Obsidian.")
      .addToggle(toggle => toggle.setValue(this.plugin.state.desktopNotifications).onChange(async enabled => {
        this.plugin.state.desktopNotifications = enabled;
        try { await this.plugin.saveState(); } catch { new Notice("Could not save notification settings."); }
      }));
    new Setting(this.containerEl).setName("Enable and test notifications")
      .setDesc("Allow Obsidian in macOS System Settings → Notifications. Focus modes may silence banners.")
      .addButton(button => button.setButtonText("Send test").onClick(async () => { await this.plugin.testNotification(); this.display(); }));
    this.containerEl.createEl("p", { text: "Obsidian must be running with this vault open. Missed reminders are delivered when the vault is next opened or the Mac wakes. Four or more due reminders are grouped into one notification." });
    this.containerEl.createEl("p", { text: "Write @remind(2026-10-23 09:00) anywhere in a note. Use Z or an explicit offset for a fixed timezone, e.g. @remind(2026-10-23T09:00Z). Checked tasks and code examples are ignored." });
  }
}
