import { indentUnit } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, Panel, ViewUpdate, showPanel } from "@codemirror/view";
import { AsmTabStops } from "../../common/tabdetect";
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

  function rebuild(update?: ViewUpdate) {
    if (update
      && update.startState.facet(tabStopsFacet) === update.state.facet(tabStopsFacet)
      && update.startState.facet(EditorState.tabSize) === update.state.facet(EditorState.tabSize)
      && update.startState.facet(indentUnit) === update.state.facet(indentUnit)) return;
    const asmTabStops = view.state.facet(tabStopsFacet);
    const tabSize = view.state.facet(EditorState.tabSize);
    const indent = view.state.facet(indentUnit);
    dom.innerHTML = buildContent(asmTabStops, tabSize, indent === '\t');
  }

  function resize() {
    const contentStyle = getComputedStyle(view.contentDOM);
    dom.style.font = contentStyle.font;
    const left = view.contentDOM.getBoundingClientRect().left - view.dom.getBoundingClientRect().left;
    dom.style.marginLeft = left + "px";
    const line = view.contentDOM.querySelector(".cm-line");
    dom.style.paddingLeft = line ? getComputedStyle(line).paddingLeft : "0";
  }

  rebuild();
  resize();

  // Removed in destroy().
  dom.addEventListener("click", openSettings);

  return {
    dom,
    top: true,
    update(update: ViewUpdate) {
      rebuild(update);
      if (update.geometryChanged) resize();
    },
    destroy() {
      dom.removeEventListener("click", openSettings);
    }
  };
}

export const tabStopRuler = showPanel.of(rulerPanel);
