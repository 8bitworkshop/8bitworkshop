// What a source view needs to take part in debugging: the gutter fields, the
// current-line (PC) marker and the breakpoint markers. Shared by SourceEditor
// and HeaderView (urust rs8 modules), so the two can't drift apart.

import { EditorView } from "@codemirror/view";
import { SourceLocation } from "../../common/workertypes";
import { bpStore } from "../breakpoints";
import { breakpointMarkers, currentPcMarker, errorMarkers, statusMarkers } from "./gutter";
import { currentPc } from "./visuals";

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
