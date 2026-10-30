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
}

/** The source variables a build put in `DebugSymbols.debuginfo`, if any. */
export function sourceVariablesOf(debuginfo: any): SourceVariable[] {
  const vars = debuginfo && debuginfo.sourceVariables;
  return Array.isArray(vars) ? vars : [];
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
 * The address a variable's value is at right now. A stack- or frame-relative
 * variable (`baseAddr` set) moves as the program calls functions, so the
 * pointer has to be read at every stop instead of being baked into the var.
 */
export function sourceVariableAddress(v: SourceVariable, read: (addr: number) => number): number | null {
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
export function formatSourceValue(v: SourceVariable, read: (addr: number) => number): string | Uint8Array {
  const addr = sourceVariableAddress(v, read);
  if (addr == null) return '<optimized out>';
  // big arrays are shown by their first rows; the tree can chunk the rest
  const size = Math.max(1, Math.min(v.size || 1, 1024));
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = read(addr + i) & 0xff;
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
export function formatSourceVariableLine(v: SourceVariable, read: (addr: number) => number): string {
  const val = formatSourceValue(v, read);
  let text = `${v.name}: ${v.type} = ${typeof val === 'string' ? val : formatBytes(val)}`;
  if (text.length > 72) text = text.substring(0, 69) + '...';
  return text;
}

/**
 * The live variables as a Debug Tree object, keyed `name:type` (the type
 * without spaces, so a CLI path can name one). Null when none are live.
 */
export function sourceVariableTree(vars: SourceVariable[], pc: number,
  symbolmap: { [name: string]: number }, symbolsizes: { [name: string]: number } | undefined,
  read: (addr: number) => number): { [name: string]: any } | null {
  const live = liveSourceVariables(vars, pc, symbolmap, symbolsizes);
  if (!live.length) return null;
  const tree: { [name: string]: any } = {};
  live.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
  for (const v of live) {
    const type = (v.type || '').replace(/\s+/g, '');
    let key = type ? `${v.name}:${type}` : v.name;
    let n = 2;
    while (key in tree) key = `${v.name}#${n++}${type ? ':' + type : ''}`;
    tree[key] = formatSourceValue(v, read);
  }
  return tree;
}
