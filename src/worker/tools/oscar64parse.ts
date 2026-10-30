// Parser for the oscar64 compiler's auxiliary output files.
// oscar64 writes a .map (memory map), .lbl (label file), .asm (assembly
// listing with C source line markers) and, with -g, a .dbj (source-level
// debug JSON) next to the output.
// This module is shared by the browser/WASM tool (src/worker/tools/oscar64.ts)
// and the native server tool (src/worker/server/buildenv.ts).

import { SourceVariable } from "../../common/sourcevars";
import { CodeListingMap, Segment, SourceLine } from "../../common/workertypes";

export interface Oscar64ParseResult {
    segments: Segment[];
    symbolmap: { [sym: string]: number };
    symbolsizes?: { [sym: string]: number };
    listings: CodeListingMap;
}

/**
 * Parse an oscar64 .map file.
 * Returns segments (from the 'sections' section), and a symbol map
 * and symbol sizes (from the 'objects' section).
 *
 * Sample:
 *   sections
 *   0880 - 0889 : DATA, code
 *   0889 - 088a : DATA, data
 *   ...
 *   objects
 *   0801 - 0853 : startup, NATIVE_CODE:startup
 *   0880 - 0889 : main, NATIVE_CODE:code
 */
export function parseOscar64Map(mapout: string) {
    let segments: Segment[] = [];
    let symbolmap: { [sym: string]: number } = {};
    let symbolsizes: { [sym: string]: number } = {};
    let section = '';
    for (let line of mapout.split('\n')) {
        line = line.trim();
        if (line === 'sections' || line === 'regions' || line === 'objects' || line === 'objects by size') {
            section = line;
            continue;
        }
        // "0880 - 0889 : DATA, code"  or  "0801 - 0853 : startup, NATIVE_CODE:startup"
        // banked targets (NES) prefix the start address with the bank: "00:8000 - 8085 : main, NATIVE_CODE:code"
        let m = /^(?:[0-9a-f]{2}:)?([0-9a-f]+) - (?:[0-9a-f]{2}:)?([0-9a-f]+) : ([^,]+), (.+)$/.exec(line);
        if (m) {
            const start = parseInt(m[1], 16);
            const end = parseInt(m[2], 16);
            const name = m[4].trim();
            if (section === 'sections') {
                // derive rom/ram classification from the segment name
                let type = 'ram';
                if (/code/.test(m[4]) || m[4] === 'startup' || /rom/.test(m[4])) {
                    type = 'rom';
                }
                segments.push({ name: m[4], start, size: end - start, type });
            } else if (section === 'objects') {
                if (m[3] !== '*') {
                    symbolmap[m[3]] = start;
                    symbolsizes[m[3]] = end - start;
                }
            }
        }
    }
    return { segments, symbolmap, symbolsizes };
}

/**
 * Parse an oscar64 .lbl file (VICE label format), e.g. "al 0880 .main".
 * Used as a fallback when the .map has no "objects" section.
 */
export function parseOscar64Lbl(lblout: string) {
    let symbolmap: { [sym: string]: number } = {};
    for (let line of lblout.split('\n')) {
        let toks = line.trim().split(/\s+/);
        if (toks[0] == 'al' && toks.length >= 3) {
            const ofs = parseInt(toks[1], 16);
            const name = toks[2];
            // prefer the un-dotted form used by the assembler listing
            const clean = name.replace(/^\./, '');
            if (!symbolmap[clean]) symbolmap[clean] = ofs;
        }
    }
    return symbolmap;
}

/**
 * Parse an oscar64 .asm listing.
 * Returns source lines (each instruction offset mapped to its C source line)
 * and assembly lines (one entry per assembly line in the listing).
 *
 * Sample:
 *   ; Compiled with 1.32.266
 *   --------------------------------------------------------------------
 *   startup: ; startup
 *   0801 : 0b __ __ INV
 *   ...
 *   main: ; main()->i16
 *   ;   2, "/test.c"
 *   .s4:
 *   ;   2, "/test.c"
 *   0880 : a9 04 __ LDA #$04
 */
export function parseOscar64Listing(asmout: string, asmfn: string) {
    let srclines: SourceLine[] = [];
    let asmlines: SourceLine[] = [];
    let c_lineno = 0;
    let c_path = '';
    let asm_lineno = 0;
    // ;   2, "/test.c"
    let re_src = /^;\s*(\d+), "(.+?)"/;
    // "0801 : 0b __ __ INV" (single bank)
    // or banked (NES): "00:8000 : a9 00 __ LDA #$00"
    let re_insn = /^(?:([0-9a-f]{2}):)?([0-9a-f]{4}) : ([0-9a-f_]{2} [0-9a-f_]{2} [0-9a-f_]{2}) (.*)/;
    for (let line of asmout.split('\n')) {
        asm_lineno++;
        let m2 = re_src.exec(line);
        if (m2) {
            c_lineno = parseInt(m2[1]);
            // path may be absolute; use basename for source line mapping
            c_path = m2[2].split('/').pop();
        }
        let m = re_insn.exec(line);
        if (m) {
            let asm = m[4];
            // BSS declarations have no bytes; they are not instructions
            if (/^BSS\b/.test(asm)) continue;
            let offset = parseInt(m[2], 16);
            let hex = m[3];
            let insns = (hex + ' ' + asm).trim();
            asmlines.push({
                line: asm_lineno,
                path: asmfn,
                offset,
                insns,
                iscode: true,
            });
            if (c_path) {
                srclines.push({
                    line: c_lineno,
                    path: c_path,
                    offset,
                    iscode: true,
                });
                c_path = '';
            }
        }
    }
    return { srclines, asmlines };
}

// The .dbj is oscar64's source-level debug JSON (written by -g). Functions
// carry code-address ranges for their source lines and variables with a type
// id; a variable's home is either an absolute address or an offset from a
// zero-page pointer (`base`), because locals can live on the frame or stack.
// See "Complete debug information .dbj" in the oscar64 manual.
export interface Oscar64Type {
    name?: string;
    typeid: number;
    size: number;
    type?: string;
    eid?: number;
    members?: { name: string, offset: number, typeid: number }[];
}

export interface Oscar64Reference {
    source: string;
    line: number;
    column?: number;
}

export interface Oscar64Variable {
    name: string;
    start: number;
    end: number;
    base?: number;
    enter?: number;
    leave?: number;
    typeid: number;
    references?: Oscar64Reference[];
}

export interface Oscar64Function {
    name: string;
    start: number;
    end: number;
    source?: string;
    line?: number;
    lines?: { start: number, end: number, source: string, line: number }[];
    variables?: Oscar64Variable[];
}

export interface Oscar64Debug {
    variables?: Oscar64Variable[];
    functions?: Oscar64Function[];
    types?: Oscar64Type[];
}

function oscar64Basename(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

function sameOscar64Source(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) return true;
    return a === b || oscar64Basename(a) === oscar64Basename(b);
}

function oscar64TypeName(type: Oscar64Type | undefined, types: Map<number, Oscar64Type>,
    seen = new Set<number>()): string {
    if (!type) return 'u8';
    if (type.name) return type.name;
    if (seen.has(type.typeid)) return type.type || 'u8';
    seen.add(type.typeid);
    switch (type.type) {
        case 'uint': return 'u' + Math.max(8, type.size * 8);
        case 'int': return 'i' + Math.max(8, type.size * 8);
        case 'bool': return 'bool';
        case 'float': return type.size === 8 ? 'f64' : 'f32';
        case 'ptr':
        case 'ref':
            return '&' + oscar64TypeName(type.eid == null ? undefined : types.get(type.eid), types, seen);
        case 'array': {
            const elem = type.eid == null ? undefined : types.get(type.eid);
            const count = elem && elem.size > 0 ? Math.floor(type.size / elem.size) : type.size;
            return `[${oscar64TypeName(elem, types, seen)}; ${count}]`;
        }
        case 'struct': return 'struct';
        case 'union': return 'union';
        case 'enum': return 'enum';
    }
    return type.type || 'u8';
}

function mergeOscar64Ranges(ranges: [number, number][]): [number, number][] {
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: [number, number][] = [];
    for (const r of ranges) {
        if (r[1] <= r[0]) continue;
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
        else merged.push([r[0], r[1]]);
    }
    return merged;
}

/** The code ranges where oscar64 says a local is visible. The compiler
 *  records enter/leave source lines, not code addresses, so map those lines
 *  through the function's line table. */
function oscar64VariableRanges(fn: Oscar64Function, v: Oscar64Variable, source: string | undefined): [number, number][] | null {
    if (v.enter == null || v.leave == null || !fn.lines) return null;
    const enter = v.enter, leave = v.leave;
    // Inlined helpers add their own source lines to the table; the variable's
    // scope belongs to the function's source file, so ignore those.
    const sameSource = fn.lines.filter(l => sameOscar64Source(l.source, source || fn.source));
    const sourceLines = sameSource.length ? sameSource : fn.lines;
    let minLine = Infinity, maxLine = -Infinity;
    for (const l of sourceLines) {
        if (l.line < minLine) minLine = l.line;
        if (l.line > maxLine) maxLine = l.line;
    }
    // A variable declared before the first generated line and still visible on
    // the last one lives in the frame for the whole function. Using the line
    // ranges alone would lose it on branch tails and other instructions the
    // compiler did not attribute to a source line.
    if (minLine <= maxLine && enter <= minLine && leave >= maxLine) {
        return [[fn.start, fn.end]];
    }
    const line = (l: { line: number, source: string }) =>
        l.line >= enter && l.line <= leave && sameOscar64Source(l.source, source);
    let lines = fn.lines.filter(line);
    if (!lines.length) {
        // the declaration may be in an included file whose path is spelled
        // differently in the two tables; fall back to the line numbers alone
        lines = fn.lines.filter(l => l.line >= enter && l.line <= leave);
    }
    const ranges = mergeOscar64Ranges(lines.map(l => [l.start, l.end] as [number, number]));
    return ranges.length ? ranges : null;
}

/**
 * Turn the .dbj into the source variables the Debug Tree shows. Only function
 * locals and parameters are included: globals are live everywhere, but the
 * Locals node is about the frame a stop is in.
 */
export function parseOscar64Dbj(dbjout: string): { sourceVariables: SourceVariable[] } {
    const dbj = JSON.parse(dbjout) as Oscar64Debug;
    const types = new Map<number, Oscar64Type>();
    for (const t of dbj.types || []) types.set(t.typeid, t);
    const sourceVariables: SourceVariable[] = [];
    for (const fn of dbj.functions || []) {
        for (const v of fn.variables || []) {
            const type = types.get(v.typeid);
            const ref = v.references && v.references[0];
            const file = ref && ref.source ? oscar64Basename(ref.source) :
                fn.source ? oscar64Basename(fn.source) : null;
            const ranges = oscar64VariableRanges(fn, v, ref && ref.source);
            sourceVariables.push({
                name: v.name,
                type: oscar64TypeName(type, types),
                size: type && type.size ? type.size : Math.max(0, v.end - v.start),
                function: fn.name,
                addr: v.start,
                baseAddr: v.base ?? null,
                ranges,
                file,
                line: ref ? ref.line : v.enter ?? null,
                col: ref && ref.column != null ? ref.column : null,
            });
        }
    }
    return { sourceVariables };
}
