/**
 * Source lines to interleave into the Disassembly window.
 *
 * The disassembly is generated from the emulated machine, but a build's
 * listings know which source line each address came from. This maps the
 * addresses where a source line starts to its file, line and text, so the
 * view can show the source next to the instructions it compiled to.
 *
 * Kept free of DOM / CodeMirror dependencies so it can be unit tested.
 */

import { CodeListingMap, SourceFile } from "../../common/workertypes";
import { getFilenameForPath } from "../../common/util";

export interface DisasmSourceLine {
  /** source path used to look up the file; may be relative to the main file */
  path: string;
  /** file name to show in the comment */
  file: string;
  line: number;
  text: string;
}

/** Read one line of a source file, or null if the file/line isn't available. */
export type SourceLineReader = (path: string, line: number) => string | null;

/** The source file a listing's lines came from, for listings that don't tag
 * each line with a path: SDCC's "hello.c.lst", for example, holds "hello.c". */
function sourcePathForListing(name: string): string {
  return name.replace(/\.lst$/i, '');
}

/**
 * Map instruction addresses to the source lines that start there. The first
 * listing that supplies real source text for an address wins; lines without
 * source text (e.g. a routine from a library that isn't part of the project)
 * are skipped so the disassembly stays readable. `includePath` filters out
 * sources that shouldn't be interleaved (the caller uses it for assemblers,
 * whose instructions are the disassembly already).
 */
export function buildSourceLineMap(listings: CodeListingMap, readLine: SourceLineReader,
  includePath?: (path: string) => boolean): Map<number, DisasmSourceLine> {
  const map = new Map<number, DisasmSourceLine>();
  if (!listings) return map;
  for (const lstfn in listings) {
    const lst = listings[lstfn];
    // a mixed listing (oscar64) has one SourceFile per source path; using the
    // combined sourcefile as well would add every line twice
    const files: [string, SourceFile][] = lst.sourcefiles
      ? Object.entries(lst.sourcefiles)
      : [[lstfn, lst.sourcefile]];
    for (const [key, sf] of files) {
      if (!sf) continue;
      for (const [addr, loc] of sf.offset2loc) {
        if (map.has(addr) || loc.line < 1) continue;
        const path = loc.path || sourcePathForListing(key);
        if (includePath && !includePath(path)) continue;
        const text = readLine(path, loc.line);
        if (text == null) continue;
        map.set(addr, { path, file: getFilenameForPath(path), line: loc.line, text });
      }
    }
  }
  return map;
}

/** A source line as a disassembly comment: "; file.c:12: int x = 1;" */
export function formatSourceComment(line: DisasmSourceLine): string {
  const text = line.text.replace(/\s+$/, '');
  return `; ${line.file}:${line.line}:${text.length ? ' ' + text : ''}`;
}

/** True for the source comments formatSourceComment() adds, so the view can
 * style them without mistaking a listing's own comment for one. */
export function isSourceComment(text: string): boolean {
  return /^; .+:\d+:/.test(text);
}
