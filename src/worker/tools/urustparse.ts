// Adapter for urust's machine-readable output: `--error-format json` on
// stderr and the `--debug-out` file. Shared shape with the browser/WASI tool
// (src/worker/tools/urust.ts); kept free of worker imports so tests can use it.

import { CodeListingMap, Segment, SourceLine, WorkerError } from "../../common/workertypes";
import { urustPlatformName } from "../../common/toolmeta";

export { urustPlatformName };

/** One entry of urust's `--error-format json` array (1-based, end exclusive). */
export interface UrustDiagnostic {
    level: 'error' | 'warning';
    message: string;
    file: string | null;
    line: number;
    col: number;
    endLine: number;
    endCol: number;
}

/** urust's `--debug-out` / `--emit debug` document. `bank` is null when unbanked. */
export interface UrustDebug {
    files: string[];
    symbols: { name: string, addr: number, size: number, kind: 'code' | 'data' | 'register', bank: number | null, ram: boolean }[];
    lines: { addr: number, size: number, bank: number | null, file: string, line: number, col: number, endLine: number, endCol: number, func: string | null }[];
    segments: { name: string, start: number, size: number, bank: number | null, type: 'rom' | 'ram' }[];
}

export interface UrustDebugResult {
    listings: CodeListingMap;
    symbolmap: { [sym: string]: number };
    symbolsizes: { [sym: string]: number };
    segments: Segment[];
    /** true if anything lives in a switchable bank: addresses there are
     *  ambiguous to the debugger, which has no bank in its line/symbol tables */
    banked: boolean;
}

/**
 * Parse stderr from `urust --error-format json`. The JSON array is on one
 * line; anything else (`urust: ...` usage/IO failures, panics) becomes a
 * location-less error so nothing is dropped silently.
 */
export function parseUrustDiagnostics(stderr: string, defaultPath: string): { errors: WorkerError[], warnings: WorkerError[] } {
    const errors: WorkerError[] = [];
    const warnings: WorkerError[] = [];
    for (const text of stderr.split(/\r?\n/)) {
        if (!text.trim()) continue;
        let diags: UrustDiagnostic[] | null = null;
        if (text.startsWith('[')) {
            try { diags = JSON.parse(text); } catch (e) { /* fall through */ }
        }
        if (!diags) {
            errors.push({ line: 0, path: defaultPath, msg: text.replace(/^urust: /, '') });
            continue;
        }
        for (const d of diags) {
            const e: WorkerError = { line: d.line, path: d.file ?? defaultPath, msg: d.message };
            if (d.line > 0) {
                e.start = d.col - 1;
                if (d.endLine === d.line) e.end = d.endCol - 1;
            }
            if (d.level === 'warning') {
                e.severity = 'warning';
                warnings.push(e);
            } else {
                errors.push(e);
            }
        }
    }
    return { errors, warnings };
}

/**
 * Convert the debug document to what the debugger and memory map consume.
 * `start`/`end` are 0-based columns; `end` is only set when the range ends on
 * the line it starts on (SourceLine has no end line).
 */
export function urustDebugToResult(dbg: UrustDebug, paths: string[]): UrustDebugResult {
    const listings: CodeListingMap = {};
    for (const path of paths) listings[path] = { lines: [] };
    let banked = false;
    for (const l of dbg.lines) {
        const listing = listings[l.file] || (listings[l.file] = { lines: [] });
        const sl: SourceLine = { line: l.line, offset: l.addr, path: l.file, start: l.col - 1, iscode: true };
        if (l.endLine === l.line) sl.end = l.endCol - 1;
        if (l.func) sl.func = l.func;
        if (l.bank != null) banked = true;
        listing.lines.push(sl);
    }
    const symbolmap: { [sym: string]: number } = {};
    const symbolsizes: { [sym: string]: number } = {};
    for (const s of dbg.symbols) {
        symbolmap[s.name] = s.addr;
        if (s.size > 0) symbolsizes[s.name] = s.size;
        if (s.bank != null) banked = true;
    }
    const segments: Segment[] = dbg.segments.map(g => ({
        name: g.name,
        start: g.start,
        size: g.size,
        type: g.type,
        source: 'native' as const,
    }));
    if (dbg.segments.some(g => g.bank != null)) banked = true;
    return { listings, symbolmap, symbolsizes, segments, banked };
}

