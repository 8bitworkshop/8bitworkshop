// Source-level variables from a compiler's debug output, and the values they
// hold at a stop. urust writes them to its `--debug-out` JSON as a `variables`
// array: each definition records its home address and the [from, to) code
// range it is live over (cells are overlaid over time, so one address can hold
// different variables at different points of a function). oscar64's `.dbj`
// gives locals enter/leave source lines instead, which its parser turns into
// one or more code ranges; a stack- or frame-relative home is an offset from
// a zero-page pointer that is read at each stop.
//
// A debugger shows only the definitions whose range contains the PC, plus the
// ones the optimizer folded away (reported as "optimized out", never guessed).
// Globals (`static`, `const`, `reg!`) are always live, so urust lists them
// separately in `globalVariables`, with their type and home address.

import { hex } from "./util";

/** One source variable and where it lives for part of a function. */
export interface SourceVariable {
  name: string;
  /** the type as written in the source: `u8`, `bool`, `[u8; 4]` */
  type: string;
  /** its size in bytes */
  size: number;
  /** the function it belongs to */
  function: string;
  /** the address of its home, null when it has no storage. When `baseAddr`
   *  is set this is an offset from the pointer stored there. */
  addr?: number | null;
  /** the zero-page address of a pointer that `addr` is relative to, for
   *  variables on a call stack or in a frame */
  baseAddr?: number | null;
  /** the [from, to) code range it is live over, null when not known */
  range?: [number, number] | null;
  /** several disjoint live ranges, when the compiler only reports source
   *  line visibility (oscar64); `range` is the single-range urust form */
  ranges?: [number, number][] | null;
  codeBank?: number | null;
  file?: string | null;
  /** 1-based declaration position */
  line?: number | null;
  col?: number | null;
  /** `optimized out` when the compiler kept no storage for it */
  location?: string;
  /** the value, when the compiler folded the variable to a constant: it has
   *  no `addr`, but `range` is the code that uses it (little-endian over
   *  `size` bytes) */
  constant?: number | null;
}

/** A source-declared global: always live, so it has no function or range. */
export interface GlobalVariable {
  name: string;
  /** the type as written in the source: `u8`, `bool`, `[u8; 4]` */
  type: string;
  /** its size in bytes */
  size: number;
  /** the address of its home */
  addr: number;
  /** true when it lives in RAM, false for data in ROM */
  ram?: boolean;
  /** false when the program cannot write it (`const`, non-`mut` static) */
  mutable?: boolean;
  bank?: number | null;
  /** the name of the ROM region at `bank`, when the target names one */
  bankName?: string | null;
  file?: string | null;
  /** 1-based declaration position */
  line?: number | null;
  col?: number | null;
  /** an array, whose elements can be read from `addr` */
  expandable?: boolean;
}

/** The part of a variable that says where its value is. */
export interface VariableStorage {
  type?: string;
  size?: number;
  addr?: number | null;
  /** a zero-page pointer that `addr` is relative to */
  baseAddr?: number | null;
  /** the value of a variable folded to a constant, which has no `addr` */
  constant?: number | null;
}

/** The source variables a build put in `DebugSymbols.debuginfo`, if any. */
export function sourceVariablesOf(debuginfo: any): SourceVariable[] {
  const vars = debuginfo && debuginfo.sourceVariables;
  return Array.isArray(vars) ? vars : [];
}

/** The source-declared globals a build put in `DebugSymbols.debuginfo`, if any. */
export function globalVariablesOf(debuginfo: any): GlobalVariable[] {
  const vars = debuginfo && debuginfo.globalVariables;
  return Array.isArray(vars) ? vars : [];
}

/**
 * The globals the program can write: `mutable` is false for a read-only
 * global (`const`, non-`mut` static), which the debugger leaves out. Older
 * output without the flag keeps the global rather than hiding all of them.
 */
export function writableGlobalVariablesOf(debuginfo: any): GlobalVariable[] {
  return globalVariablesOf(debuginfo).filter(v => v.mutable !== false);
}

/** Read a byte through the platform's bus, as the debugger sees it. */
export function readSourceByte(platform: any, addr: number): number {
  try {
    let v: number;
    if (typeof platform.readAddress === "function") v = platform.readAddress(addr);
    else if (platform.machine && typeof platform.machine.read === "function") v = platform.machine.read(addr);
    return typeof v === "number" ? v & 0xff : 0;
  } catch (e) {
    return 0;
  }
}

/** The function symbol whose code contains `pc`, if the build knows one. */
export function functionAtPC(pc: number, symbolmap: { [name: string]: number },
  symbolsizes?: { [name: string]: number }): string | null {
  if (!symbolmap) return null;
  let best: string | null = null;
  let bestAddr = -1;
  for (const name of Object.keys(symbolmap)) {
    const addr = symbolmap[name];
    const size = (symbolsizes && symbolsizes[name]) || 0;
    if (typeof addr === "number" && size > 0 && pc >= addr && pc < addr + size && addr >= bestAddr) {
      best = name;
      bestAddr = addr;
    }
  }
  return best;
}

/**
 * The variables that are live at `pc`: the definition whose code range
 * contains it, or, when the range is unknown, one belonging to the function
 * at `pc`. A variable with an unknown range from another function is not
 * shown, because its overlaid cell could name anything.
 */
export function liveSourceVariables(vars: SourceVariable[], pc: number,
  symbolmap: { [name: string]: number }, symbolsizes?: { [name: string]: number }): SourceVariable[] {
  const fn = functionAtPC(pc, symbolmap, symbolsizes);
  return vars.filter(v => {
    if (v.ranges && v.ranges.length) return v.ranges.some(r => pc >= r[0] && pc < r[1]);
    if (v.range) return pc >= v.range[0] && pc < v.range[1];
    return fn != null && v.function === fn;
  });
}

/**
 * The name of the local variable that lives at `operand`, for an instruction
 * at `instrAddr` (`name`, or `name+1` inside a multi-byte variable). Locals
 * are resolved in the frame of the instruction, not of the PC: a cell is
 * overlaid over time, so only a variable live at `instrAddr` may name it.
 * Frame-relative variables (`baseAddr`) have no fixed address and are skipped.
 */
export function localSymbolAt(vars: SourceVariable[], instrAddr: number, operand: number,
  symbolmap: { [name: string]: number }, symbolsizes?: { [name: string]: number }): string | null {
  const live = liveSourceVariables(vars.filter(v => v.addr != null && v.baseAddr == null),
    instrAddr, symbolmap, symbolsizes);
  for (const v of live) {
    const ofs = operand - (v.addr as number);
    if (ofs >= 0 && ofs < Math.max(1, v.size || 1)) {
      // inlined callees' variables are named `mangled_callee::name`
      const name = v.name.includes('::') ? v.name.slice(v.name.lastIndexOf('::') + 2) : v.name;
      return ofs ? `${name}+${ofs}` : name;
    }
  }
  return null;
}

/** The parts of `DebugSymbols` that symbol lookup in a disassembly needs. */
export interface OperandSymbols {
  addr2symbol?: { [addr: number]: string };
  symbolmap?: { [name: string]: number };
  symbolsizes?: { [name: string]: number };
  debuginfo?: any;
}

/**
 * Rewrite the `$ADDR` operand of a disassembled instruction at `instrAddr`
 * as a symbol: a local live at the instruction first (see `localSymbolAt`),
 * then a global, then a global one byte back (`name+1`). The text is returned
 * unchanged when nothing names it. Shared by the IDE's disassembly view, the
 * `8bws` run script and the debug service, so they all label operands alike.
 */
export function symbolizeOperand(text: string, instrAddr: number, syms: OperandSymbols | null | undefined): string {
  if (!syms) return text;
  const addr2symbol = syms.addr2symbol || {};
  const locals = sourceVariablesOf(syms.debuginfo);
  return text.replace(/([^#])[$]([0-9A-F]+)/, (substr: string, pre: string, digits: string): string => {
    const addr = parseInt(digits, 16);
    // a local of the function containing this instruction wins over a global at the same cell
    const local = locals.length ? localSymbolAt(locals, instrAddr, addr, syms.symbolmap || {}, syms.symbolsizes) : null;
    if (local) return pre + local;
    const sym = addr2symbol[addr];
    if (sym) return pre + sym;
    const prev = addr2symbol[addr - 1];
    if (prev) return pre + prev + "+1";
    return substr;
  });
}

/**
 * The address a variable's value is at right now. A stack- or frame-relative
 * variable (`baseAddr` set) moves as the program calls functions, so the
 * pointer has to be read at every stop instead of being baked into the var.
 */
export function sourceVariableAddress(v: VariableStorage, read: (addr: number) => number): number | null {
  if (v.addr == null) return null;
  if (v.baseAddr == null) return v.addr;
  const addr = (read(v.baseAddr) & 0xff) | ((read(v.baseAddr + 1) & 0xff) << 8);
  return addr + v.addr;
}

function isIntegerType(type: string): boolean {
  return /^[ui](8|16|32|64|size)$/.test(type);
}

function readInteger(bytes: Uint8Array, signed: boolean): number {
  let n = 0;
  for (let i = bytes.length - 1; i >= 0; i--) n = n * 256 + bytes[i];
  if (signed) {
    const sign = Math.pow(2, bytes.length * 8 - 1);
    if (n >= sign) n -= sign * 2;
  }
  return n;
}

function formatBytes(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => hex(b, 2)).join(' ');
}

/**
 * A source value as a tree leaf: a string for scalars, or a Uint8Array for an
 * array or struct too big to show inline (the Debug Tree splits it into rows).
 */
export function formatSourceValue(v: VariableStorage, read: (addr: number) => number): string | Uint8Array {
  const addr = sourceVariableAddress(v, read);
  if (addr == null && v.constant == null) return '<optimized out>';
  // big arrays are shown by their first rows; the tree can chunk the rest
  const size = Math.max(1, Math.min(v.size || 1, 1024));
  const bytes = new Uint8Array(size);
  if (addr != null) {
    for (let i = 0; i < size; i++) bytes[i] = read(addr + i) & 0xff;
  } else {
    // folded to a constant: the compiler knows the value, memory does not
    let c = v.constant as number;
    for (let i = 0; i < size && i < 8; i++) {
      bytes[i] = c % 256;
      c = Math.floor(c / 256);
    }
  }
  const type = (v.type || '').trim();
  if (type === 'bool') return bytes[0] ? 'true' : 'false';
  if (isIntegerType(type)) {
    const val = readInteger(bytes, type[0] === 'i');
    const raw = val < 0 ? Math.pow(2, size * 8) + val : val;
    return `$${hex(raw, size * 2)} (${val})`;
  }
  if ((type === 'f32' || type === 'f64') && (size === 4 || size === 8)) {
    const view = new DataView(bytes.buffer);
    return String(type === 'f32' ? view.getFloat32(0, true) : view.getFloat64(0, true));
  }
  // a pointer is its home contents; dereferencing it here would be a guess
  if (type.startsWith('&') || type.startsWith('*')) {
    return `$${hex(readInteger(bytes, false) >>> 0, size * 2)}`;
  }
  if (bytes.length > 16) return bytes;
  return formatBytes(bytes);
}

/** One live variable as `name: type = value` (for the editor's hover text). */
export function formatSourceVariableLine(v: VariableStorage & { name: string }, read: (addr: number) => number): string {
  const val = formatSourceValue(v, read);
  let text = `${v.name}: ${v.type} = ${typeof val === 'string' ? val : formatBytes(val)}`;
  if (text.length > 72) text = text.substring(0, 69) + '...';
  return text;
}

/**
 * The variables as a Debug Tree object, keyed `name:type` (the type without
 * spaces, so a CLI path can name one).
 */
function variablesToTree(vars: (SourceVariable | GlobalVariable)[],
  read: (addr: number) => number): { [name: string]: any } {
  const tree: { [name: string]: any } = {};
  const sorted = vars.slice().sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
  for (const v of sorted) {
    const type = (v.type || '').replace(/\s+/g, '');
    let key = type ? `${v.name}:${type}` : v.name;
    let n = 2;
    while (key in tree) key = `${v.name}#${n++}${type ? ':' + type : ''}`;
    tree[key] = formatSourceValue(v, read);
  }
  return tree;
}

/**
 * The live variables as a Debug Tree object. Null when none are live.
 */
export function sourceVariableTree(vars: SourceVariable[], pc: number,
  symbolmap: { [name: string]: number }, symbolsizes: { [name: string]: number } | undefined,
  read: (addr: number) => number): { [name: string]: any } | null {
  const live = liveSourceVariables(vars, pc, symbolmap, symbolsizes);
  return live.length ? variablesToTree(live, read) : null;
}

/**
 * The globals as a Debug Tree object. Unlike locals they have no live range,
 * so every one is shown. Null when the build has none.
 */
export function globalVariableTree(vars: GlobalVariable[],
  read: (addr: number) => number): { [name: string]: any } | null {
  return vars.length ? variablesToTree(vars, read) : null;
}

/** A source line and the address where its code starts (one entry per listed line). */
export interface LineOffset { line: number; offset: number; path?: string }

/**
 * The code range of each source line: from its first listed address to the
 * next listed address after it. Compilers list a line once per code run, so
 * a line can have several ranges.
 */
export function lineCodeRanges(lines: LineOffset[]): Map<number, [number, number][]> {
  const sorted = lines.filter(l => l.offset >= 0).sort((a, b) => a.offset - b.offset);
  const out = new Map<number, [number, number][]>();
  for (let i = 0; i < sorted.length; i++) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].offset === sorted[i].offset) j++;
    const end = j < sorted.length ? sorted[j].offset : sorted[i].offset + 1;
    const list = out.get(sorted[i].line) || [];
    list.push([sorted[i].offset, end]);
    out.set(sorted[i].line, list);
  }
  return out;
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/** Does `name` appear in `text` as a whole identifier? */
function mentions(text: string, name: string): boolean {
  const re = new RegExp(`(^|[^A-Za-z0-9_])${name.replace(/[^A-Za-z0-9_]/g, '\\$&')}($|[^A-Za-z0-9_])`);
  return re.test(text);
}

/** Is the build-relative path `a` the same file as `b`, allowing a leading directory difference? */
function samePath(a: string, b: string): boolean {
  return a === b || a.endsWith('/' + b) || b.endsWith('/' + a);
}

/**
 * The name a variable goes by in the source. The compiler names the variables
 * of an inlined function `mangled_callee::name`, but the line only says `name`.
 */
function sourceName(v: SourceVariable): string {
  const i = v.name.lastIndexOf('::');
  return i >= 0 ? v.name.slice(i + 2) : v.name;
}

/**
 * The variables to show at the end of source lines while stopped at `pc`, as
 * `name = value` text keyed by 1-based line number.
 *
 * A variable is a candidate on a line when it is live at `pc` (so its home
 * holds its value now), the line's own code lies in its live range (or the
 * line has no known code), and the line's text names it. The live range
 * alone would list nearly every variable on every line of a function; the
 * name test keeps it to the lines that touch a variable.
 *
 * Each variable is then shown once, on its candidate line nearest `stopLine`
 * (ties go to the earlier line), so a loop index is not repeated on every
 * line that uses it. Without a `stopLine` the first candidate wins.
 *
 * When `lines` all come from one named source path (a module of a multi-file
 * build), only that file's variables are drawn, so a declaration line in
 * another module is not taken for a line here.
 */
export function inlineSourceValues(vars: SourceVariable[], pc: number,
  symbolmap: { [name: string]: number }, symbolsizes: { [name: string]: number } | undefined,
  lines: LineOffset[], lineText: (line: number) => string | null,
  read: (addr: number) => number, stopLine?: number | null): Map<number, string> {
  const paths = new Set(lines.map(l => l.path || ''));
  const filePath = paths.size === 1 ? [...paths][0] : '';
  const live = liveSourceVariables(vars, pc, symbolmap, symbolsizes)
    .filter(v => !filePath || !v.file || samePath(v.file, filePath));
  const result = new Map<number, string>();
  if (!live.length) return result;
  const codeRanges = lineCodeRanges(lines);
  const candidates = [...new Set<number>([...codeRanges.keys(), ...live.map(v => v.line || 0)])]
    .filter(l => l > 0).sort((a, b) => a - b);
  const distance = (l: number) => stopLine == null ? 0 : Math.abs(l - stopLine);
  const parts = new Map<number, string[]>();
  for (const v of live) {
    const val = formatSourceValue(v, read);
    // a long array is the Locals tree's job, not a line's
    if (typeof val !== 'string') continue;
    const vr: [number, number][] = v.ranges && v.ranges.length ? v.ranges : v.range ? [v.range] : [];
    let best = -1;
    for (const line of candidates) {
      const text = lineText(line);
      if (!text || !mentions(text, sourceName(v))) continue;
      const ranges = codeRanges.get(line);
      if (ranges && vr.length && !ranges.some(r => vr.some(x => overlaps(r, x)))) continue;
      if (best < 0 || distance(line) < distance(best)) best = line;
    }
    if (best < 0) continue;
    const list = parts.get(best) || [];
    // inlined copies of one function share short names; say each `name = value` once
    const text = `${sourceName(v)} = ${val.replace(/^\$[0-9a-f]+ \((-?\d+)\)$/i, '$1')}`;
    if (!list.includes(text)) list.push(text);
    parts.set(best, list);
  }
  for (const [line, list] of parts) result.set(line, list.join(', '));
  return result;
}
