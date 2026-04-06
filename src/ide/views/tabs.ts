import { indentLess, insertTab } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorState, Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

export function tabExtension(tabSize: number, tabsToSpaces: boolean): Extension {
  return [
    EditorState.tabSize.of(tabSize),
    indentUnit.of(tabsToSpaces ? " ".repeat(tabSize) : "\t"),
    keymap.of([
      { key: "Tab", run: insertTab },
      { key: "Shift-Tab", run: indentLess }
    ]),
  ];
}
