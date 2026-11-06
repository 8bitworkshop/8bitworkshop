// What a source view needs to take part in debugging: the gutter fields, the
// current-line (PC) marker and the breakpoint markers. Shared by SourceEditor
// and HeaderView (urust rs8 modules), so the two can't drift apart.

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { SourceLocation } from "../../common/workertypes";
import { bpStore } from "../breakpoints";
import { breakpointMarkers, currentPcMarker, errorMarkers, statusMarkers } from "./gutter";
import { currentPc } from "./visuals";

// Variable values drawn at the end of the source lines that name them, while
// the program is stopped. Replaced wholesale on every stop; cleared on run.
const setInlineValues = StateEffect.define<Map<number, string>>();

class InlineValueWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(o: InlineValueWidget) { return o.text === this.text; }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-inline-value";
    el.textContent = this.text;
    return el;
  }
  ignoreEvent() { return true; }
}

export const inlineValuesField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setInlineValues)) continue;
      const doc = tr.state.doc;
      const ranges = [];
      for (const [line, text] of [...e.value].sort((a, b) => a[0] - b[0])) {
        if (line < 1 || line > doc.lines) continue;
        ranges.push(Decoration.widget({ widget: new InlineValueWidget(text), side: 1 }).range(doc.line(line).to));
      }
      deco = Decoration.set(ranges);
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

/** Fields and gutters for breakpoints and the current PC line. The status
 *  gutter reads the error field too, so it comes along even in views that
 *  never show errors. Gutter order is the order here: put it after the
 *  offset gutter. */
export const debugGutterExtensions = [
  currentPc.field,
  breakpointMarkers.field,
  errorMarkers.field,
  statusMarkers.gutter,
  currentPcMarker.field,
  currentPcMarker.gutter,
  inlineValuesField,
  EditorView.baseTheme({
    ".cm-inline-value": {
      marginLeft: "2em", padding: "0 0.4em", borderRadius: "3px",
      color: "#8ec6a0", background: "rgba(142, 198, 160, 0.12)",
      fontStyle: "italic", fontSize: "90%", pointerEvents: "none", userSelect: "none",
    },
  }),
];

/** Mark `line` (which must be inside the document) as where the CPU is.
 *  With `moveCursor` (stepping, a breakpoint hit) also follow it: highlight
 *  the line, put the cursor on it and scroll it to the center. A passive halt
 *  only shows the gutter arrow, so the user's cursor isn't taken away. */
export function showDebugLine(view: EditorView, line: SourceLocation, moveCursor: boolean) {
  const pos = view.state.doc.line(line.line).from + (line.start || 0);
  view.dispatch({
    selection: moveCursor ? { anchor: pos, head: pos } : undefined,
    effects: [
      currentPcMarker.set.of(line.line),
      currentPc.effect.of(moveCursor ? line.line : null),
      ...(moveCursor ? [EditorView.scrollIntoView(pos, { y: "center" })] : []),
    ],
  });
}

export function clearDebugLine(view: EditorView) {
  view.dispatch({ effects: [currentPcMarker.set.of(null), currentPc.effect.of(null)] });
}

/** Push the breakpoint store's breakpoints for `path` into the gutter markers. */
export function syncBreakpointMarkers(view: EditorView, path: string) {
  const markers = bpStore.getSourceBreakpointsForFile(path)
    .map(bp => ({ line: bp.line, enabled: bp.enabled }));
  view.dispatch({ effects: breakpointMarkers.setAll.of(markers) });
}

/** Show `values` (line number to `name = value` text) at the end of their
 *  lines; an empty map removes them. */
export function showInlineValues(view: EditorView, values: Map<number, string>) {
  view.dispatch({ effects: setInlineValues.of(values) });
}
