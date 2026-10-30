import { EditorView } from "@codemirror/view";

export const disassemblyTheme = EditorView.theme({
    "&": {
        maxHeight: "100%"
    },
    // source lines interleaved into the disassembly (see disasmsource.ts)
    ".cm-disasm-source": {
        color: "#9fd3b4",
    },
});
