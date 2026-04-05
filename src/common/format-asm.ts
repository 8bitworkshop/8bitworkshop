// Pure formatting logic — no browser or CodeMirror dependencies.

import { AsmTabStops, columnAt, findCommentIndex } from "./tabdetect";

function splitFirst(text: string): [string, string] {
    const i = text.search(/\s/);
    if (i < 0) return [text, ''];
    return [text.substring(0, i), text.substring(i).trim()];
}

function padToColumn(s: string, targetCol: number, indentUnit: string, tabSize: number): string {
    const col = columnAt(s, s.length, tabSize);
    if (col >= targetCol) return s + ' ';
    if (indentUnit === '\t') {
        const nextTabCol = col + tabSize - (col % tabSize);
        if (nextTabCol === targetCol) return s + '\t';
    }
    return s + ' '.repeat(targetCol - col);
}

function buildFormattedLine(indented: boolean, label: string, opcode: string, operand: string, comment: string, indentUnit: string, tabSize: number, asmTabStops: AsmTabStops): string {
    let result = '';

    if (label) {
        result = label;
    }

    if (opcode) {
        if (label || indented) {
            result = padToColumn(result, asmTabStops.opcodes, indentUnit, tabSize);
        }
        result += opcode;
        if (operand) {
            if (asmTabStops.operands !== undefined) {
                result = padToColumn(result, asmTabStops.operands, indentUnit, tabSize);
            } else {
                result += ' ';
            }
            result += operand;
        }
    }

    if (comment) {
        if (result) {
            if (asmTabStops.comments !== undefined) {
                result = padToColumn(result, asmTabStops.comments, indentUnit, tabSize);
            } else {
                result += ' ';
            }
        }
        result += comment;
    }

    return result;
}

export function formatAsmLine(raw: string, lineNum: number, indentUnit: string, tabSize: number, asmTabStops: AsmTabStops): string {
    const text = raw.trimEnd();
    if (text === '') return '';

    const firstNonSpace = text.search(/\S/);
    if (text[firstNonSpace] === ';') return text;

    const indented = firstNonSpace > 0;
    const commentIdx = findCommentIndex(text);
    const comment = text.substring(commentIdx);
    const content = text.substring(indented ? firstNonSpace : 0, commentIdx).trimEnd();

    let label = '';
    let opcode = '';
    let operand = '';

    if (!indented) {
        [label, opcode] = splitFirst(content);
        if (opcode) [opcode, operand] = splitFirst(opcode);
    } else {
        [opcode, operand] = splitFirst(content);
    }

    const newText = buildFormattedLine(indented, label, opcode, operand, comment, indentUnit, tabSize, asmTabStops);
    if (newText.replace(/\s/g, '') !== text.replace(/\s/g, '')) {
        console.warn(`format: skipping line ${lineNum}, mangles non-whitespace characters\n- before: ${JSON.stringify(text)}\n- after:  ${JSON.stringify(newText)}`);
        return text;
    }
    return newText;
}

export function formatText(text: string, tabSize: number, asmTabStops: AsmTabStops): string {
    if (!asmTabStops) return text;
    const indent = ' '.repeat(tabSize);
    const lines = text.split('\n');
    const formatted = lines.map((line, i) => formatAsmLine(line, i + 1, indent, tabSize, asmTabStops));
    return formatted.join('\n');
}
