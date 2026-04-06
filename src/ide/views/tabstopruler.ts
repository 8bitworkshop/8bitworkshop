import { indentUnit } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, Panel, showPanel } from "@codemirror/view";
import { AsmTabStops, tabStopsEquals } from "../../common/tabdetect";
import { openSettings, tabStopsFacet } from "../settings";
import { MAX_COLS, tabStopsToColumns } from "../views/tabs";

function buildContent(asmTabStops: AsmTabStops, tabSize: number, useTabs: boolean): string {
  const chars = new Array(MAX_COLS);
  chars.fill(useTabs ? " " : "<span class='cm-highlightSpace'> </span>");
  for (const col of tabStopsToColumns(asmTabStops, tabSize, useTabs)) {
    chars[col] = "▾";
  }
  return chars.join("");
}

function rulerPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "tab-stop-ruler";
  dom.setAttribute("aria-hidden", "true");
  let currentAsmTabStops: AsmTabStops = {};
  let currentTabSize = 0;
  let currentIndent = "";

  function rebuild() {
    const asmTabStops = view.state.facet(tabStopsFacet);
    const tabSize = view.state.facet(EditorState.tabSize);
    const indent = view.state.facet(indentUnit);
    if (tabStopsEquals(asmTabStops, currentAsmTabStops) && tabSize === currentTabSize && indent === currentIndent) return;
    currentAsmTabStops = asmTabStops;
    currentTabSize = tabSize;
    currentIndent = indent;
    dom.innerHTML = buildContent(asmTabStops, tabSize, indent === '\t');
  }

  function sync() {
    const contentStyle = getComputedStyle(view.contentDOM);
    dom.style.font = contentStyle.font;
    const left = view.contentDOM.getBoundingClientRect().left - view.dom.getBoundingClientRect().left;
    dom.style.marginLeft = left + "px";
    const line = view.contentDOM.querySelector(".cm-line");
    if (line) dom.style.paddingLeft = getComputedStyle(line).paddingLeft;
  }

  rebuild();
  dom.addEventListener("click", openSettings);
  sync();

  return {
    dom,
    top: true,
    update() {
      rebuild();
      sync();
    }
  };
}

export const tabStopRuler = showPanel.of(rulerPanel);
