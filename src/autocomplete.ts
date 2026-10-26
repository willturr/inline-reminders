import {
  App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext,
  EditorSuggestTriggerInfo, MarkdownFileInfo, MarkdownView, Modal, Notice, Setting, TFile
} from "obsidian";
import { DateSuggestion, formatReminderTimestamp, getDateSuggestions } from "./date-suggestions";
import { formatLocalDate, parseReminderDate } from "./parser";
import { findReminderTarget, reminderEdit } from "./reminder-edit";

type Suggestion = DateSuggestion | { label: string; timestamp: null };

export class ReminderDateSuggest extends EditorSuggest<Suggestion> {
  private items: Suggestion[] = [];
  private rows = new Map<Suggestion, HTMLElement>();
  private picker: ReminderDatePicker | null = null;

  constructor(app: App, private enabled: () => boolean) {
    super(app);
    this.limit = 12;
    this.setInstructions([
      { command: "↑↓", purpose: "navigate" },
      { command: "↵ / Tab", purpose: "insert date" },
      { command: "Esc", purpose: "dismiss" }
    ]);
    this.scope.register([], "Tab", event => {
      if (!this.context) return;
      // The native popup marks its selected row with this class; keep its arrow-key behavior.
      const selected = this.items.find(item => this.rows.get(item)?.classList.contains("is-selected")) ?? this.items[0];
      if (selected) this.selectSuggestion(selected, event);
      return false;
    });
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    if (!this.enabled() || !file || editor.somethingSelected()) return null;
    if (!/@remind(?:\([^)]*)?$/.test(editor.getLine(cursor.line).slice(0, cursor.ch))) return null;
    const target = findReminderTarget(editor.getValue(), cursor);
    return target ? { start: target.from, end: cursor, query: target.query } : null;
  }

  getSuggestions(context: EditorSuggestContext): Suggestion[] {
    this.rows.clear();
    this.items = [...getDateSuggestions(context.query, Date.now()), { label: "Choose date…", timestamp: null }];
    return this.items;
  }

  renderSuggestion(item: Suggestion, element: HTMLElement): void {
    this.rows.set(item, element);
    element.createDiv({ text: item.label, cls: "inline-reminders-suggestion-title" });
    element.createDiv({
      text: item.timestamp === null ? "Open date and time picker" : new Date(item.timestamp).toLocaleString([], {
        weekday: "short", year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: item.timestamp % 60000 ? "2-digit" : undefined,
        timeZoneName: "short"
      }),
      cls: "inline-reminders-suggestion-detail"
    });
  }

  selectSuggestion(item: Suggestion, _event: MouseEvent | KeyboardEvent): void {
    const context = this.context;
    if (!this.enabled() || !context || !this.items.includes(item)) return;
    const { editor, file } = context;
    if (editor.somethingSelected()) { this.close(); return; }
    const target = findReminderTarget(editor.getValue(), editor.getCursor());
    if (!target || target.from.line !== context.start.line || target.from.ch !== context.start.ch || target.query !== context.query) {
      this.close();
      return;
    }
    const valid = this.capture(editor, file);
    this.close();
    const insert = (timestamp: number): boolean => {
      if (!valid()) { new Notice("The note changed. Open reminder suggestions again."); return false; }
      if (timestamp <= Date.now()) { new Notice("That time has passed. Choose a future date and time."); return false; }
      const edit = reminderEdit(target, `@remind(${formatReminderTimestamp(timestamp)})`);
      editor.transaction({ changes: [{ from: edit.from, to: edit.to, text: edit.text }], selection: { from: edit.selection } }, "inline-reminders");
      editor.focus();
      return true;
    };
    if (item.timestamp === null) this.openPicker(this.items.find(candidate => candidate.timestamp !== null)?.timestamp ?? nextHour(), insert);
    else insert(item.timestamp);
  }

  insertReminder(editor: Editor, info: MarkdownFileInfo): void {
    if (!info.file || !this.enabled()) return;
    const valid = this.capture(editor, info.file);
    const position = editor.getCursor("to");
    const prefix = position.ch > 0 && !/\s/.test(editor.getLine(position.line).charAt(position.ch - 1)) ? " " : "";
    this.openPicker(nextHour(), timestamp => {
      if (!valid()) { new Notice("The note changed. Run Insert reminder again."); return false; }
      const text = `${prefix}@remind(${formatReminderTimestamp(timestamp)})`;
      editor.transaction({ changes: [{ from: position, to: position, text }], selection: { from: { line: position.line, ch: position.ch + text.length } } }, "inline-reminders");
      editor.focus();
      return true;
    });
  }

  private capture(editor: Editor, file: TFile): () => boolean {
    const content = editor.getValue();
    const path = file.path;
    return () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      return this.enabled() && file.path === path && this.app.vault.getAbstractFileByPath(path) === file
        && view?.file === file && view.editor === editor && editor.getValue() === content;
    };
  }

  private openPicker(initial: number, choose: (timestamp: number) => boolean): void {
    this.close();
    this.picker?.close();
    this.picker = new ReminderDatePicker(this.app, initial, timestamp => this.enabled() && choose(timestamp));
    this.picker.open();
  }

  dispose(): void {
    this.close();
    this.picker?.close();
    this.picker = null;
    this.rows.clear();
    this.items = [];
  }
}

function nextHour(): number {
  return Math.floor((Date.now() + 60 * 60 * 1000) / 60000) * 60000;
}

export class ReminderDatePicker extends Modal {
  constructor(app: App, private initial: number, private choose: (timestamp: number) => boolean) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Choose reminder date");
    const initial = Math.floor(this.initial / 60000) * 60000;
    const initialValue = formatLocalDate(new Date(initial));
    let value = initialValue;
    const form = this.contentEl.createEl("form");
    const setting = new Setting(form).setName("When").setDesc("Choose a future date and time in your local timezone.");
    let input!: HTMLInputElement;
    setting.addText(component => {
      input = component.inputEl;
      input.type = "datetime-local";
      input.required = true;
      input.setAttribute("aria-label", "Reminder date and time");
      component.setValue(value.replace(" ", "T")).onChange(date => { value = date; });
    });
    const error = form.createEl("p", { cls: "inline-reminders-error", attr: { role: "alert" } });
    form.createEl("button", { text: "Insert reminder", cls: "mod-cta", attr: { type: "submit" } });
    form.onsubmit = event => {
      event.preventDefault();
      // Preserve the selected occurrence when the clocks repeat an autumn hour.
      const timestamp = value.replace("T", " ") === initialValue ? initial : parseReminderDate(value);
      if (timestamp === null || timestamp <= Date.now()) { error.setText("Choose a valid future date and time."); return; }
      if (this.choose(timestamp)) this.close();
      else { error.setText("The note changed. Close this picker and try again."); }
    };
    input.focus();
  }

  onClose(): void { this.contentEl.empty(); }
}
