import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState, Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { AsmTabStops, columnAt } from "../../common/tabdetect";
import { tabStopsFacet } from "../settings";

export const MAX_COLS = 300;

export function tabStopsToColumns(asmTabStops: AsmTabStops, tabSize: number, useTabs?: boolean): number[] {
  if (!useTabs) {
    const asmCols = [asmTabStops.opcodes, asmTabStops.operands, asmTabStops.comments].filter((n): n is number => n > 0);
    if (asmCols.length > 0) return asmCols;
  }
  const cols: number[] = [];
  for (let col = tabSize; col < MAX_COLS; col += tabSize) {
    cols.push(col);
  }
  return cols;
}

function nextTabStop(col: number, columns: number[]): number {
  for (const stop of columns) {
    if (stop > col) return stop;
  }
  return col;
}

function prevTabStop(col: number, columns: number[]): number {
  for (let i = columns.length - 1; i >= 0; i--) {
    if (columns[i] < col) return columns[i];
  }
  return 0;
}

function indentTabStop(view: EditorView): boolean {
  const useTabs = view.state.facet(indentUnit) === '\t';
  const asmTabStop = view.state.facet(tabStopsFacet);
  const tabSize = view.state.facet(EditorState.tabSize);
  const columns = tabStopsToColumns(asmTabStop, tabSize, useTabs);

  // Indents lines for selected ranges.
  if (view.state.selection.ranges.some(r => !r.empty)) {
    const changes: { from: number; to: number; insert: string }[] = [];
    const seen = new Set<number>();
    for (const range of view.state.selection.ranges) {
      const fromLine = view.state.doc.lineAt(range.from).number;
      const toLine = view.state.doc.lineAt(range.to).number;
      for (let ln = fromLine; ln <= toLine; ln++) {
        if (seen.has(ln)) continue;
        seen.add(ln);
        const line = view.state.doc.line(ln);
        let wsEnd = 0, wsCol = 0;
        for (; wsEnd < line.text.length; wsEnd++) {
          if (line.text[wsEnd] === '\t') wsCol = wsCol + tabSize - (wsCol % tabSize);
          else if (line.text[wsEnd] === ' ') wsCol++;
          else break;
        }
        if (useTabs) {
          const insertAt = line.from + wsEnd;
          changes.push({ from: insertAt, to: insertAt, insert: '\t' });
        } else {
          const targetCol = nextTabStop(wsCol, columns);
          if (targetCol > wsCol) {
            changes.push({ from: line.from, to: line.from + wsEnd, insert: ' '.repeat(targetCol) });
          }
        }
      }
    }
    if (changes.length > 0) {
      view.dispatch({ changes });
    }
    return true;
  }

  // Otherwise, inserts whitespace to next tab stop.
  view.dispatch(view.state.changeByRange(range => {
    const line = view.state.doc.lineAt(range.head);
    const col = columnAt(line.text, range.head - line.from, tabSize);
    const insert = useTabs ? '\t' : ' '.repeat(nextTabStop(col, columns) - col);
    return {
      changes: { from: range.head, insert },
      range: EditorSelection.cursor(range.head + insert.length)
    };
  }));
  return true;
}

function deindentTabStop(view: EditorView): boolean {
  const useTabs = view.state.facet(indentUnit) === '\t';
  const asmTabStop = view.state.facet(tabStopsFacet);
  const tabSize = view.state.facet(EditorState.tabSize);
  const columns = tabStopsToColumns(asmTabStop, tabSize, useTabs);

  // Dedents lines for all ranges, regardless of selection.
  const changes: { from: number; to: number; insert: string }[] = [];
  const seen = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const fromLine = view.state.doc.lineAt(range.from).number;
    const toLine = view.state.doc.lineAt(range.to).number;
    for (let ln = fromLine; ln <= toLine; ln++) {
      if (seen.has(ln)) continue;
      seen.add(ln);
      const line = view.state.doc.line(ln);
      let wsEnd = 0, wsCol = 0;
      for (; wsEnd < line.text.length; wsEnd++) {
        if (line.text[wsEnd] === '\t') wsCol = wsCol + tabSize - (wsCol % tabSize);
        else if (line.text[wsEnd] === ' ') wsCol++;
        else break;
      }
      if (wsCol === 0) continue;
      const targetCol = prevTabStop(wsCol, columns);
      // Walk forward to find the offset where we reach or pass targetCol.
      let col = 0, prevCol = 0, off = 0;
      for (; off < wsEnd && col < targetCol; off++) {
        prevCol = col;
        if (line.text[off] === '\t') col = col + tabSize - (col % tabSize);
        else col++;
      }
      if (col > targetCol) {
        // A tab overshot targetCol — replace it with spaces to land exactly on targetCol.
        changes.push({ from: line.from + off - 1, to: line.from + wsEnd, insert: ' '.repeat(targetCol - prevCol) });
      } else {
        // Landed exactly on targetCol — just delete the rest.
        changes.push({ from: line.from + off, to: line.from + wsEnd, insert: '' });
      }
    }
  }
  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  return true;
}

export function tabExtension(tabSize: number, tabsToSpaces: boolean, asmTabStops: AsmTabStops): Extension {
  return [
    EditorState.tabSize.of(tabSize),
    indentUnit.of(tabsToSpaces ? " ".repeat(tabSize) : "\t"),
    keymap.of([
      { key: "Tab", run: indentTabStop },
      { key: "Shift-Tab", run: deindentTabStop }
    ]),
    tabStopsFacet.of(asmTabStops),
  ];
}
