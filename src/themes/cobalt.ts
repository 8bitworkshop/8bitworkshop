import { EditorView } from "@codemirror/view"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags as t } from "@lezer/highlight"

const cobaltTheme = EditorView.theme({
  "&": {
    backgroundColor: "#122c43",
    color: "white"
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "#9191fb30 !important"
  },
  ".cm-selectionMatch": {
    backgroundColor: "#445e8bc7"
  },
  ".cm-activeLine": {
    backgroundColor: "#99eeff12"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#57707b42",
  },
  "&.cm-focused .cm-matchingBracket": {
    outline: "1px solid grey",
  },
  ".cm-gutters , .cm-panels": {
    backgroundColor: "#00305b",
    borderRight: "1px solid #666"
  },
  ".cm-lineNumbers .cm-gutterElement": {
    color: "#dadada4d"
  },
  ".gutter-bytes .cm-gutterElement": {
    color: "#0fddeeb0"
  },
  ".cm-highlightSpace": {
    backgroundImage: "radial-gradient(circle at 50% 55%, #aaaaaa45 11%, transparent 5%)"
  },
  ".cm-highlightTab": {
    backgroundImage: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"><path stroke="%23aaaaaa45" stroke-width="1" fill="none" d="M0 10H10L7 6M10 10L7 14"/></svg>')`,
    backgroundPosition: "left 50%"
  },
  ".tab-stop-ruler": {
    color: "rgba(255,255,255,0.35)",
    backgroundColor: "#002240",
    borderBottom: "2px solid #0055ff88",
  },
}, { dark: true });

const cobaltHighlightStyle = HighlightStyle.define([
  { tag: t.standard(t.keyword), color: "#ffee80" }, // Bright Yellow
  { tag: [t.name, t.standard(t.name)], color: "#ff9e59" }, // Soft Orange
  { tag: t.variableName, color: "#9effff" }, // Cyan/Light Blue
  { tag: t.local(t.variableName), color: "#ffffff" }, // White for locals
  { tag: [t.deleted, t.macroName], color: "#ff628c" }, // Pinkish-red
  { tag: [t.processingInstruction, t.keyword, t.controlKeyword], color: "#ffee80" }, // Yellow
  { tag: [t.string, t.inserted], color: "#3ad900" }, // Vibrant Green
  { tag: [t.number, t.modifier], color: "#ff628c" }, // Pink/Rose
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: "#845dc4" }, // Purple
  { tag: t.definition(t.variableName), color: "#ffee80" }, // Yellow
  { tag: [t.propertyName, t.attributeName, t.tagName, t.self], color: "#9effff" }, // Light Blue
  { tag: t.definition(t.name), color: "#ff9e59" }, // Orange
  { tag: t.typeName, color: "#80ffbb" }, // Seafoam Green
  { tag: t.bracket, color: "#d8d8d8" },
  { tag: t.comment, color: "#0088ff" }, // Distinctive Cobalt Blue-Comment
  { tag: t.link, color: "#845dc4" },
  { tag: t.meta, color: "#ff9d00" },
  { tag: t.invalid, color: "#9d1e15" },
]);

export const cobalt = [
  cobaltTheme,
  syntaxHighlighting(cobaltHighlightStyle),
];