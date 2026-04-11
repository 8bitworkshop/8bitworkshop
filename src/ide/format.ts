import { indentRange, indentUnit } from "@codemirror/language";
import { ChangeSet, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { formatAsmLine } from "../common/format-asm";
import { tabStopsFacet } from "./settings";

export function formatDocument(view: EditorView, isAsm: boolean, mnemonics?: Set<string>) {
    let state = view.state;
    const changeSets: ChangeSet[] = [];

    function apply(cs: ChangeSet) {
        changeSets.push(cs);
        // Update state so subsequent passes have correct line positions.
        state = state.update({ changes: cs }).state;
    }

    function selectedLines(): Set<number> {
        const lines = new Set<number>();
        for (const range of sel.ranges) {
            const fromLine = state.doc.lineAt(range.from).number;
            const toLine = state.doc.lineAt(range.to).number;
            for (let i = fromLine; i <= toLine; i++) {
                lines.add(i);
            }
        }
        return lines;
    }

    function isTargetLine(lineNum: number): boolean {
        return targetLines === null || targetLines.has(lineNum);
    }

    // Determine which lines to format based on selections.
    const sel = state.selection;
    const hasSelection = sel.ranges.some(r => !r.empty);
    const targetLines = hasSelection ? selectedLines() : null;

    // If 'Tab key insert spaces' is set, convert tabs to spaces.
    const indent = state.facet(indentUnit);
    const tabSize = state.facet(EditorState.tabSize);
    if (indent !== '\t') {
        const specs: { from: number, to: number, insert: string }[] = [];
        for (let i = 1; i <= state.doc.lines; i++) {
            if (!isTargetLine(i)) continue;
            const line = state.doc.line(i);
            if (line.text.indexOf('\t') >= 0) {
                let col = 0;
                let newText = "";
                for (const char of line.text) {
                    if (char === '\t') {
                        const nextTab = col + tabSize - (col % tabSize);
                        newText += ' '.repeat(nextTab - col);
                        col = nextTab;
                    } else {
                        newText += char;
                        col++;
                    }
                }
                specs.push({ from: line.from, to: line.to, insert: newText });
            }
        }
        if (specs.length > 0) {
            apply(state.changes(specs));
        }
    }

    if (isAsm) {
        // Format asm languages using custom tab stops.
        const stops = state.facet(tabStopsFacet);
        if (stops.opcodes > 0 || stops.operands > 0 || stops.comments > 0) {
            const specs: { from: number, to: number, insert: string }[] = [];
            for (let i = 1; i <= state.doc.lines; i++) {
                if (!isTargetLine(i)) continue;
                const line = state.doc.line(i);
                const formatted = formatAsmLine(line.text, i, indent, tabSize, stops, mnemonics);
                if (formatted !== line.text) {
                    specs.push({ from: line.from, to: line.to, insert: formatted });
                }
            }
            if (specs.length > 0) {
                apply(state.changes(specs));
            }
        }
    } else {
        // Format non-asm languages using CodeMirror's built-in indentation.
        if (hasSelection) {
            for (const range of sel.ranges) {
                const fromLine = state.doc.lineAt(range.from);
                const toLine = state.doc.lineAt(range.to);
                const indentChanges = indentRange(state, fromLine.from, toLine.to);
                if (!indentChanges.empty) {
                    apply(indentChanges);
                }
            }
        } else {
            const indentChanges = indentRange(state, 0, state.doc.length);
            if (!indentChanges.empty) {
                apply(indentChanges);
            }
        }
    }

    // Strip trailing whitespace.
    const trimSpecs: { from: number, to: number, insert: string }[] = [];
    for (let i = 1; i <= state.doc.lines; i++) {
        if (!isTargetLine(i)) continue;
        const line = state.doc.line(i);
        const trimmed = line.text.replace(/\s+$/, "");
        if (trimmed !== line.text) {
            trimSpecs.push({ from: line.from + trimmed.length, to: line.to, insert: "" });
        }
    }
    if (trimSpecs.length > 0) {
        apply(state.changes(trimSpecs));
    }

    // Remove excess blank lines at end of file when formatting entire file.
    if (!hasSelection) {
        let lastNonEmpty = state.doc.lines;
        while (lastNonEmpty > 1 && state.doc.line(lastNonEmpty).text === '') {
            lastNonEmpty--;
        }
        if (lastNonEmpty < state.doc.lines) {
            const keepFrom = state.doc.line(lastNonEmpty + 1).to;
            const deleteTo = state.doc.length;
            apply(state.changes({ from: keepFrom, to: deleteTo }));
        }
    }

    // Compose and dispatch all changes; selections are mapped automatically.
    if (changeSets.length > 0) {
        view.dispatch({ changes: changeSets.reduce((a, b) => a.compose(b)) });
    }
}
