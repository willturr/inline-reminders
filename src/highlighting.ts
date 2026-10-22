import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { HighlightRange, reminderHighlightRanges, reminderMarkerRanges } from "./parser";

const HIGHLIGHT_CLASS = "inline-reminders-highlight";
const mark = Decoration.mark({ class: HIGHLIGHT_CLASS });

export class ReminderHighlighter {
  decorations: DecorationSet;
  private ranges: HighlightRange[];

  constructor(view: EditorView) {
    this.ranges = reminderHighlightRanges(view.state.doc.toString());
    this.decorations = this.decorate(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) this.ranges = reminderHighlightRanges(update.view.state.doc.toString());
    if (update.docChanged || update.viewportChanged) this.decorations = this.decorate(update.view);
  }

  private decorate(view: EditorView): DecorationSet {
    return Decoration.set(this.ranges
      .filter(range => view.visibleRanges.some(visible => range.from < visible.to && range.to > visible.from))
      .map(range => mark.range(range.from, range.to)), true);
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
      span.className = HIGHLIGHT_CLASS;
      span.textContent = text.slice(range.from, range.to);
      fragment.append(span);
      position = range.to;
    }
    fragment.append(document.createTextNode(text.slice(position)));
    node.parentNode?.replaceChild(fragment, node);
  }
}
