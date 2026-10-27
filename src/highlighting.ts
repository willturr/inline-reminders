import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { StateEffect } from "@codemirror/state";
import { HighlightRange, parseReminderDate, parseReminders, reminderHighlightRanges, reminderMarkerRanges } from "./parser";

const HIGHLIGHT_CLASS = "inline-reminders-highlight";
const mark = Decoration.mark({ class: HIGHLIGHT_CLASS });
const overdueMark = Decoration.mark({ class: `${HIGHLIGHT_CLASS} is-overdue`, attributes: { title: "Overdue reminder" } });
const refreshOverdue = StateEffect.define<void>();
const editors = new Set<EditorView>();

export function refreshEditorReminderHighlights(): void {
  for (const view of editors) view.dispatch({ effects: refreshOverdue.of() });
}

export class ReminderHighlighter {
  decorations: DecorationSet;
  private ranges: (HighlightRange & { time?: number })[];

  constructor(private view: EditorView) {
    this.ranges = this.readRanges(view);
    this.decorations = this.decorate(view);
    editors.add(view);
  }

  update(update: ViewUpdate): void {
    const refresh = update.transactions.some(transaction => transaction.effects.some(effect => effect.is(refreshOverdue)));
    if (update.docChanged || refresh) this.ranges = this.readRanges(update.view);
    if (update.docChanged || update.viewportChanged || refresh) this.decorations = this.decorate(update.view);
  }

  destroy(): void { editors.delete(this.view); }

  private readRanges(view: EditorView): (HighlightRange & { time?: number })[] {
    const text = view.state.doc.toString();
    const times = new Map(parseReminders("", text).reminders.map(reminder => [
      view.state.doc.line(reminder.line + 1).from + reminder.column, reminder.time
    ]));
    return reminderHighlightRanges(text).map(range => ({ ...range, time: times.get(range.from) }));
  }

  private decorate(view: EditorView): DecorationSet {
    const now = Date.now();
    return Decoration.set(this.ranges
      .filter(range => view.visibleRanges.some(visible => range.from < visible.to && range.to > visible.from))
      .map(range => (range.time !== undefined && range.time <= now ? overdueMark : mark).range(range.from, range.to)), true);
  }
}

export const reminderHighlighter = ViewPlugin.fromClass(ReminderHighlighter, {
  decorations: plugin => plugin.decorations
});

export function highlightRenderedReminders(element: HTMLElement): void {
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, 4);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest(`code, pre, script, style, textarea, .metadata-container, .${HIGHLIGHT_CLASS}`)) nodes.push(node as Text);
  }
  for (const node of nodes) {
    const text = node.data;
    const ranges = reminderMarkerRanges(text);
    if (!ranges.length) continue;
    const fragment = document.createDocumentFragment();
    let position = 0;
    for (const range of ranges) {
      fragment.append(document.createTextNode(text.slice(position, range.from)));
      const span = document.createElement("span");
      span.className = `${HIGHLIGHT_CLASS} inline-reminders-rendered`;
      span.textContent = text.slice(range.from, range.to);
      fragment.append(span);
      position = range.to;
    }
    fragment.append(document.createTextNode(text.slice(position)));
    node.parentNode?.replaceChild(fragment, node);
  }
  refreshRenderedReminderHighlights(element);
}

export function refreshRenderedReminderHighlights(element: HTMLElement): void {
  const now = Date.now();
  for (const span of element.querySelectorAll<HTMLElement>(".inline-reminders-rendered")) {
    const raw = /^@remind\(([^)]*)\)$/.exec(span.textContent ?? "")?.[1];
    const time = raw === undefined ? null : parseReminderDate(raw);
    const completed = span.closest("li.is-checked, li[data-task='x'], li[data-task='X']");
    const overdue = !completed && time !== null && time <= now;
    span.classList.toggle("is-overdue", overdue);
    span.title = overdue ? "Overdue reminder" : "";
  }
}
