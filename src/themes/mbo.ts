import { EditorView } from "@codemirror/view"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags as t } from "@lezer/highlight"

export const mboTheme = EditorView.theme({
  "&": {
    backgroundColor: "#2c2c2c",
    color: "#ffffec"
  },
  ".cm-content": {
    caretColor: "#ffffec"
  },
  "&.cm-focused .cm-cursor": {
    borderLeft: "1px solid #ffffec"
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(113, 108, 98, .99) !important"
  },
  ".cm-gutters": {
    backgroundColor: "#4e4e4e",
    color: "#dadada",
    borderRight: "none"
  },
  ".cm-activeLine": {
    backgroundColor: "#494b4155"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#494b4155"
  },
  "&.cm-focused .cm-gutterElement.cm-activeLineGutter": {
    color: "#33ff33"
  },
  ".cm-linenumber": {
    color: "#dadada"
  },
  ".cm-matchingBracket": {
    color: "#33ff33 !important"
  },
  ".cm-highlightSpace": {
    backgroundImage: "radial-gradient(circle at 50% 55%, #aaaaaa45 11%, transparent 5%)"
  },
  ".cm-highlightTab": {
    backgroundImage: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"><path stroke="%23aaaaaa45" stroke-width="1" fill="none" d="M0 10H10L7 6M10 10L7 14"/></svg>')`,
    backgroundPosition: "left 50%"
  },
  ".cm-panels": {
    backgroundColor: "#4e4e4e" /* color left of tab stop ruler */,
  },
  ".tab-stop-ruler": {
    color: "rgba(255,255,255,0.25)",
    backgroundColor: "#202020",
    borderBottom: "2px solid #4e4e4e",
  },
}, { dark: true });

export const mboHighlightStyle = HighlightStyle.define([
  { tag: t.standard(t.keyword), color: "#ffb928" },
  { tag: [t.name, t.standard(t.name)], color: "#ffffec" },
  { tag: t.variableName, color: "#9ddfe9" },
  { tag: t.local(t.variableName), color: "#7eb8c4" },
  { tag: [t.deleted, t.macroName], color: "#00a8c6" },
  { tag: [t.processingInstruction, t.keyword, t.controlKeyword], color: "#c792ea" },
  { tag: [t.string, t.inserted], color: "#b4fdb7" },
  { tag: [t.number, t.modifier], color: "#33aadd" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: "#00a8c6" },
  { tag: t.definition(t.variableName), color: "#ffb928" },
  { tag: [t.propertyName, t.attributeName, t.tagName, t.self], color: "#9ddfe9" },
  { tag: t.definition(t.name), color: "#88eeff" },
  { tag: t.typeName, color: "#ffb928" },
  { tag: t.bracket, color: "#fffffc", fontWeight: "bold" },
  { tag: t.comment, color: "#95958a" },
  { tag: t.link, color: "#f54b07" },
  { tag: t.meta, color: "#aaddaa" },
  { tag: t.invalid, color: "#ffffec", borderBottom: "1px solid #636363" },
]);

export const mbo = [
  mboTheme,
  syntaxHighlighting(mboHighlightStyle),
];