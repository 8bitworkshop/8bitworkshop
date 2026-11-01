
import { errorMarkers } from "./gutter";
import { appendErrorHelp, appendErrorText } from "./errormarkup";
import { TRACED_HEAT_LEVELS } from "./traceheat";

import { SelectionRange, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";

// Highlight program counter line.
const currentPcEffect = StateEffect.define<number | null>();

const currentPcDecoration = Decoration.line({
  attributes: { class: "cm-currentpc" }
});

const currentPcLineField = StateField.define({
  create() { return Decoration.none },
  update(lines, tr) {
    lines = lines.map(tr.changes)

    for (let e of tr.effects) {
      if (e.is(currentPcEffect)) {
        if (e.value === null) return Decoration.none;

        const line = tr.state.doc.line(e.value);
        return Decoration.set([currentPcDecoration.range(line.from)]);
      }
    }
    return lines;
  },
  provide: f => EditorView.decorations.from(f),
});


// Error message widget to show below error lines
class ErrorMessageWidget extends WidgetType {
  constructor(readonly message: string, readonly warning?: boolean,
    readonly help?: string[], readonly topic?: string) { super() }

  toDOM() {
    let div = document.createElement("div");
    div.className = "cm-error-message";
    appendErrorText(div, this.message);
    appendErrorHelp(div, this.help, this.topic);
    div.style.cssText = this.warning ? `
      color: #ffcc44;
      background-color: #332900;
      padding: 4px 8px;
      margin: 2px 0;
      border-left: 3px solid #ffcc44;
      font-family: monospace;
    ` : `
      color: #ff6666;
      background-color: #330000;
      padding: 4px 8px;
      margin: 2px 0;
      border-left: 3px solid #ff0000;
      font-family: monospace;
    `;
    return div;
  }
}

interface ErrorMessageInfo { msg: string, warning?: boolean, help?: string[], topic?: string }

// State field to manage error message decorations (supports multiple messages)
const errorMessageField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(decorations, tr) {
    // Map existing decorations across document changes
    decorations = decorations.map(tr.changes);

    for (let e of tr.effects) {
      if (e.is(errorMarkers.showMessage)) {
        if (e.value === null || !e.value) {
          // Clear all messages
          return Decoration.none;
        } else if (e.value.toggle) {
          // Build new decoration set with toggled message
          const widgets: any[] = [];

          // Collect existing decorations
          const existingMessages = new Map<number, ErrorMessageInfo>();
          decorations.between(0, tr.state.doc.length, (from, to, value) => {
            try {
              const lineNum = tr.state.doc.lineAt(to).number;
              if (value.spec.widget instanceof ErrorMessageWidget) {
                const widget = value.spec.widget as ErrorMessageWidget;
                existingMessages.set(lineNum, {
                  msg: widget.message, warning: widget.warning, help: widget.help, topic: widget.topic
                });
              }
            } catch { }
          });

          // Check if we're adding or removing this line's message
          const isCurrentlyShown = existingMessages.has(e.value.line);

          if (isCurrentlyShown) {
            // Remove the message
            existingMessages.delete(e.value.line);
          } else {
            // Add the new message
            existingMessages.set(e.value.line, {
              msg: e.value.msg, warning: e.value.warning, help: e.value.help, topic: e.value.topic
            });
          }

          // Build sorted decorations
          const sortedLines = Array.from(existingMessages.keys()).sort((a, b) => a - b);
          sortedLines.forEach(lineNum => {
            try {
              const line = tr.state.doc.line(lineNum);
              const info = existingMessages.get(lineNum)!;
              widgets.push(
                Decoration.widget({
                  widget: new ErrorMessageWidget(info.msg, info.warning, info.help, info.topic),
                  block: true,
                  side: 1
                }).range(line.to)
              );
            } catch {
              // Line doesn't exist, skip
            }
          });

          return Decoration.set(widgets, true);
        }
      }
    }
    return decorations;
  },
  provide: f => EditorView.decorations.from(f),
});

// Decorator widget to show values.
class ShowValueWidget extends WidgetType {
  constructor(readonly value: string) { super() }

  toDOM() {
    let div = document.createElement("div");
    div.textContent = `${this.value}`;
    div.style.cssText = `
      color: #ccccff;
      background-color: #000066;
      display: inline-block;
    `;
    div.className = "cm-line";
    return div
  }
}

// Effect to pass the position and value to the state.
const showValueEffect = StateEffect.define<{ range: SelectionRange, val: any } | null>();

const showValueDecorationField = StateField.define({
  create() { return Decoration.none },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);

    for (let e of tr.effects) {
      if (e.is(showValueEffect)) {
        if (e.value === null || !e.value) {
          return Decoration.none;
        }
        const line = tr.state.doc.lineAt(e.value.range.to);
        return Decoration.set([
          Decoration.widget({
            widget: new ShowValueWidget(e.value.val),
            block: true,
            side: 1 // Appears after the line
          }).range(line.to)
        ])
      }
    }
    return decorations;
  },
  provide: f => EditorView.decorations.from(f),
});

// Error/warning span decorations for inline column-range highlighting
const errorSpansEffect = StateEffect.define<{ line: number, start: number, end: number, warning?: boolean }[] | null>();

const errorSpanDecoration = Decoration.mark({
  attributes: { class: "cm-error-span" }
});

const warningSpanDecoration = Decoration.mark({
  attributes: { class: "cm-warning-span" }
});

const errorSpansField = StateField.define({
  create() { return Decoration.none },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);

    for (let e of tr.effects) {
      if (e.is(errorSpansEffect)) {
        if (e.value === null) return Decoration.none;

        const ranges: any[] = [];
        for (const span of e.value) {
          try {
            const line = tr.state.doc.line(span.line);
            const from = line.from + span.start;
            const to = line.from + span.end;
            // Clamp to line boundaries
            if (from >= line.from && to <= line.to && from < to) {
              ranges.push((span.warning ? warningSpanDecoration : errorSpanDecoration).range(from, to));
            }
          } catch {
            // Line doesn't exist, skip
          }
        }

        return Decoration.set(ranges, true);
      }
    }
    return decorations;
  },
  provide: f => EditorView.decorations.from(f),
});

const highlightLinesEffect = StateEffect.define<{ start: number, end: number } | null>();

const highlightLinesDecoration = Decoration.line({
  attributes: { class: "highlight-lines" }
});

const highlightLinesField = StateField.define({
  create() { return Decoration.none },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);

    for (let e of tr.effects) {
      if (e.is(highlightLinesEffect)) {
        if (e.value === null) return Decoration.none;

        const { start, end } = e.value;
        const decorationRanges: any[] = [];

        // Highlight all lines in the range
        for (let lineNum = start; lineNum <= end; lineNum++) {
          try {
            const line = tr.state.doc.line(lineNum);
            decorationRanges.push(highlightLinesDecoration.range(line.from));
          } catch {
            // Line doesn't exist, skip
          }
        }

        return Decoration.set(decorationRanges);
      }
    }
    // dismiss highlights on user interaction
    if (decorations !== Decoration.none && (tr.docChanged || tr.selection)) {
      return Decoration.none;
    }
    return decorations;
  },
  provide: f => EditorView.decorations.from(f),
});

export const errorMessages = {
  field: errorMessageField,
  widget: ErrorMessageWidget,
};

export const currentPc = {
  effect: currentPcEffect,
  decoration: currentPcDecoration,
  field: currentPcLineField,
};

export const showValue = {
  effect: showValueEffect,
  field: showValueDecorationField,
};

export const errorSpans = {
  effect: errorSpansEffect,
  field: errorSpansField,
};

export const highlightLines = {
  effect: highlightLinesEffect,
  field: highlightLinesField,
};

// Highlight recently-executed lines, colored by execution frequency (hot/cold).
// A line's level is 0 (coldest) .. TRACED_HEAT_LEVELS-1 (hottest).
export interface TracedLine {
  line: number;
  level: number;
}

const tracedLinesEffect = StateEffect.define<TracedLine[]>();

// one line decoration per heat level
const tracedLineDecorations = [];
for (let i = 0; i < TRACED_HEAT_LEVELS; i++) {
  tracedLineDecorations.push(Decoration.line({
    attributes: { class: `cm-traced-line cm-traced-line-h${i}` }
  }));
}

const tracedLinesField = StateField.define({
  create() { return Decoration.none },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);

    for (let e of tr.effects) {
      if (e.is(tracedLinesEffect)) {
        const ranges: any[] = [];
        for (const { line: lineNum, level } of e.value) {
          try {
            const line = tr.state.doc.line(lineNum);
            const deco = tracedLineDecorations[Math.max(0, Math.min(TRACED_HEAT_LEVELS - 1, level | 0))];
            ranges.push(deco.range(line.from));
          } catch {
            // Line doesn't exist, skip
          }
        }
        return Decoration.set(ranges, true); // sort=true, line numbers may be unordered
      }
    }
    return decorations;
  },
  provide: f => EditorView.decorations.from(f),
});

export const tracedLines = {
  effect: tracedLinesEffect,
  field: tracedLinesField,
};
