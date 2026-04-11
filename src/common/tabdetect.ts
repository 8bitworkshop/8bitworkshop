// Pure tab-detection and column utilities — no browser or CodeMirror dependencies.
// Used by both the IDE (via tabs.ts) and CLI tools (reformat.ts).

import { opcodes as opcodes6502 } from "../parser/tokens-6502";
import { opcodes as opcodes6809 } from "../parser/tokens-6809";
import { opcodes as opcodesZ80 } from "../parser/tokens-z80";

export interface AsmTabStops {
  opcodes?: number;
  operands?: number;
  comments?: number;
}

export function tabStopsEquals(a: AsmTabStops, b: AsmTabStops): boolean {
  return a.opcodes === b.opcodes && a.operands === b.operands && a.comments === b.comments;
}

export function findCommentIndex(text: string): number {
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ';') {
      return i;
    }
  }
  return text.length;
}

export function columnAt(text: string, offset: number, tabSize: number): number {
  let col = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\t') col = col + tabSize - (col % tabSize);
    else col++;
  }
  return col;
}

const MNEMONICS_6502 = new Set([...opcodes6502].map(s => s.toLowerCase()));
const MNEMONICS_6809 = new Set([...opcodes6809].map(s => s.toLowerCase()));
const MNEMONICS_Z80 = new Set([...opcodesZ80].map(s => s.toLowerCase()));

export const mnemonicsByMode: Record<string, Set<string>> = {
  '6502': MNEMONICS_6502,
  '6809': MNEMONICS_6809,
  'z80': MNEMONICS_Z80,
};

function mostCommon(counts: Map<number, number>): number | undefined {
  if (counts.size === 0) return undefined;
  let best: number | undefined;
  let bestCount = 0;
  counts.forEach((count, val) => {
    if (count > bestCount) { best = val; bestCount = count; }
  });
  return best;
}

function tally(map: Map<number, number>, key: number) {
  map.set(key, (map.get(key) || 0) + 1);
}

export function detectTabStopsFromAsm(mode: string, tabSize: number, text: string): AsmTabStops {
  const mnemonics = mnemonicsByMode[mode];
  if (!mnemonics) {
    return {};
  }

  // Pass 1: find most common opcode column
  const opcodeCols = new Map<number, number>();
  const lineInfos: [number, number?, number?][] = []; // [opcodeCol, operandCol?, commentCol?]

  const lines = text.split('\n');
  for (const line of lines) {
    const commentIdx = findCommentIndex(line);
    const code = line.substring(0, commentIdx);
    const indented = /^\s/.test(code);

    const opcodeMatch = indented ? code.match(/^\s+(\S+)/) : code.match(/^\S+\s+(\S+)/);
    if (!opcodeMatch) continue;
    const token = opcodeMatch[1];
    if (!mnemonics.has(token.toLowerCase())) continue;

    const col = columnAt(line, opcodeMatch[0].length - token.length, tabSize);
    tally(opcodeCols, col);
    const afterOpcode = opcodeMatch[0].length;
    const operandMatch = code.substring(afterOpcode).match(/^\s+\S/);
    const operandCol = operandMatch ? columnAt(line, afterOpcode + operandMatch[0].length - 1, tabSize) : undefined;
    const commentCol = commentIdx < line.length ? columnAt(line, commentIdx, tabSize) : undefined;
    lineInfos.push([col, operandCol, commentCol]);
  }

  const opcodeCol = mostCommon(opcodeCols);
  if (opcodeCol === undefined) return {};

  // Pass 2: from lines with opcode at winning column, find operand and comment columns
  const operandCols = new Map<number, number>();
  const commentCols = new Map<number, number>();
  for (const [oc, operandCol, commentCol] of lineInfos) {
    if (oc !== opcodeCol) continue;
    if (operandCol !== undefined) tally(operandCols, operandCol);
    if (commentCol !== undefined) tally(commentCols, commentCol);
  }

  const asmTabStops = { opcodes: opcodeCol } as AsmTabStops;
  const operandCol = mostCommon(operandCols);
  if (operandCol !== undefined) asmTabStops.operands = operandCol;
  const commentCol = mostCommon(commentCols);
  if (commentCol !== undefined) asmTabStops.comments = commentCol;
  return asmTabStops;
}

export function detectTabSizeFromSource(text: string): number | undefined {
  const cols = new Map<number, number>();
  for (const line of text.split('\n')) {
    const match = line.match(/^(\s+)\S/);
    if (!match) continue;
    const col = columnAt(line, match[1].length, 8);
    tally(cols, col);
  }
  // In our examples, this almost always returns the first tab stop,
  // though sometimes the second tab stop competes for the top count.
  let tabSize = mostCommon(cols);
  // Could tabSize be the second tab stop?
  if (tabSize >= 4) {
    // Check candidate tab stop at the half-way point.
    const halfTabSize = tabSize / 2;
    const countTabSize = cols.get(tabSize);
    const countHalfTabSize = cols.get(halfTabSize);
    // Does the candidate have at least half as many tallies?
    if (countHalfTabSize >= countTabSize / 2) {
      tabSize = halfTabSize;
    }
  }
  return tabSize;
}
