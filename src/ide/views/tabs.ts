import { indentLess, insertTab } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorState, Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { tabStopsFacet } from "../settings";

export function tabExtension(tabSize: number, tabsToSpaces: boolean, asmTabStops: AsmTabStops): Extension {
  return [
    EditorState.tabSize.of(tabSize),
    indentUnit.of(tabsToSpaces ? " ".repeat(tabSize) : "\t"),
    keymap.of([
      { key: "Tab", run: insertTab },
      { key: "Shift-Tab", run: indentLess }
    ]),
    tabStopsFacet.of(asmTabStops),
  ];
}
