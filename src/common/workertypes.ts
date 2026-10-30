import type { InternalError } from "./telemetry";

export type FileData = string | Uint8Array;

export interface SourceLocation {
  line: number;
  label?: string;
  path?: string; // TODO: make mandatory?
  start?: number;
  end?: number;
  segment?:string;
  func?:string;
}

// actually it's a kind of SourceSnippet .. can have multiple per line
export interface SourceLine extends SourceLocation {
  offset:number;
  insns?:string;
  iscode?:boolean;
  cycles?:number;
}

// objects that have source code position info
export interface SourceLocated {
  $loc?: SourceLocation;
}
// statements also have the 'offset' (pc) field from SourceLine
export interface SourceLineLocated {
  $loc?: SourceLine;
}

export class SourceFile {
  lines: SourceLine[];
  text: string;
  offset2loc: Map<number,SourceLine>; //{[offset:number]:number};
  line2offset: Map<number,number>; //{[line:number]:number};
  sortedOffsets: number[];
  
  constructor(lines:SourceLine[], text:string) {
    lines = lines || [];
    this.lines = lines;
    this.text = text;
    this.offset2loc = new Map();
    this.line2offset = new Map();
    for (var info of lines) {
      if (info.offset >= 0) {
        // first line wins (is assigned to offset)
        // TODO: handle macros/includes w/ multiple offsets per line
        if (!this.offset2loc.has(info.offset))
          this.offset2loc.set(info.offset, info);
        if (!this.line2offset.has(info.line))
          this.line2offset.set(info.line, info.offset);
      }
    }
    this.sortedOffsets = Array.from(this.offset2loc.keys()).sort((a,b)=>a-b);
  }
  // returns the line whose offset is nearest to (but not greater than) PC,
  // provided it is within `lookbehind` bytes; null otherwise.
  // `fnStart` (the start address of the function containing PC) clamps the
  // lookbehind: code after a function's label but before its first listed line
  // (a compiler prologue) belongs to that first line, and code that runs past
  // the end of the listing (e.g. into a library with no source) matches
  // nothing rather than the previous function's last line.
  findLineForOffset(PC:number, lookbehind:number, fnStart?:number|null) : SourceLine {
    const offsets = this.sortedOffsets;
    // binary search for last offset <= PC
    var lo = 0, hi = offsets.length-1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (offsets[mid] <= PC) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (ans < 0) return null;
    var off = offsets[ans];
    if (fnStart != null && off < fnStart) {
      // the only line this PC may belong to is the first one at/after fnStart
      var next = this.firstOffsetAtOrAfter(fnStart, offsets);
      return next != null && next - PC <= lookbehind ? this.offset2loc.get(next) : null;
    }
    if (PC - off > lookbehind) return null;
    return this.offset2loc.get(off);
  }

  private firstOffsetAtOrAfter(x:number, offsets:number[]) : number {
    var lo = 0, hi = offsets.length-1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (offsets[mid] >= x) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return ans < 0 ? null : offsets[ans];
  }
  lineCount():number { return this.lines.length; }
}

export interface Dependency {
  path:string
  filename:string
  link:boolean
  data:FileData // TODO: or binary?
}

export interface WorkerFileUpdate {
  path:string
  data:FileData
};
/** Per-phase raw argv overrides carried on a build step (CLI / project). */
export interface BuildArgLists {
  compiler?:string[]
  assembler?:string[]
  linker?:string[]
}

/** Per-phase symbol overrides carried on a build step (CLI / project). */
export interface BuildSymbolLists {
  compiler?:string[]
  assembler?:string[]
  linker?:string[]
}

export interface WorkerBuildStep {
  path?:string
  files?:string[]
  /** linked source files ("//#link") to compile in the same invocation as
   *  the main file, for single-pass tools -- see ToolMeta.compileLinkedSources */
  linkfiles?:string[]
  platform:string
  tool:string
  mainfile?:boolean
  /** extra symbols layered above platform defaults, below source directives */
  symbols?:BuildSymbolLists
  /** extra raw args layered above platform defaults, below source directives */
  buildArgs?:BuildArgLists
};
export interface WorkerItemUpdate {
  key:string
  value:object
};

// TODO: split into different msg types
export interface WorkerMessage {
  preload?:string
  /** preload a filesystem package directly by name (e.g. 'sdcc', 'wasi:cc65-fs-nes.zip') */
  preload_fs?:string
  /** read a file from the preloaded filesystem package (path e.g. '/include/nes.h')
   *  requires preload_fs; result comes back as {output:Uint8Array} */
  readshared?:string
  /** read a header from the platform's library (one of its extra_compile_files,
   *  e.g. 'neslib.h'); requires platform; result comes back as {output:Uint8Array|null} */
  readlib?:string
  /** list files under a directory of the preloaded filesystem package
   *  requires preload_fs; result comes back as {output:string[]} */
  listshared?:string
  /** echo tag for ad-hoc queries (queryWorker); copied to the response */
  qid?:number
  platform?:string
  tool?:string
  updates:WorkerFileUpdate[]
  buildsteps:WorkerBuildStep[]
  reset?:boolean
  code?:string
  setitems?:WorkerItemUpdate[]
}

export interface WorkerError extends SourceLocation {
  msg:string,
  /** a missing severity means 'error'; only warnings leave a build successful */
  severity?:'error'|'warning',
}

export interface CodeListing {
  lines:SourceLine[]
  asmlines?:SourceLine[]
  text?:string
  sourcefile?:SourceFile   // not returned by worker
  assemblyfile?:SourceFile  // not returned by worker
  /** per-source-file views of `lines`, for tools (e.g. oscar64) whose single
   *  listing mixes lines from many sources tagged with a path; not returned
   *  by worker */
  sourcefiles?:{[path:string]:SourceFile}
}

export type CodeListingMap = {[path:string]:CodeListing};

// TODO
export type VerilogOutput =
  {program_rom_variable:string, program_rom:Uint8Array, code:string, name:string, ports:any[], signals:any[]};

export type Segment = {
  name:string,
  start:number,
  size:number,
  last?:number,
  type?:string,
  source?:'native'|'linker',
  modules?:{name:string, start:number, size:number}[] // each object file's slice, in link order
};

export type WorkerResult = WorkerErrorResult | WorkerOutputResult<any> | WorkerUnchangedResult;

export interface WorkerUnchangedResult {
  unchanged: true;
}

export interface WorkerErrorResult {
  errors: WorkerError[]
  listings?: CodeListingMap
  uppercaseOnly?: boolean
  /** set when a tool crashed rather than rejected the program, for error reports */
  internal?: InternalError & { tool: string, platform: string }
}

export interface WorkerOutputResult<T> {
  output: T
  /** non-fatal diagnostics from every step of the build */
  warnings?: WorkerError[]
  listings?: CodeListingMap
  symbolmap?: {[sym:string]:number}
  symbolsizes?: {[sym:string]:number} // object sizes in bytes, if the toolchain reports them
  params?: {}
  segments?: Segment[]
  debuginfo?: {} // optional info
  uppercaseOnly?: boolean
  origin?: number
}

/**
 * What a build produces for the debugger and the memory map, besides the ROM.
 * Types that carry a build's products extend this, and `buildProducts` copies
 * them, so a new field is added here and in that function only.
 */
export type BuildProducts = Pick<WorkerOutputResult<unknown>, 'listings' | 'symbolmap' | 'symbolsizes' | 'segments' | 'debuginfo'>;

export function buildProducts(r: BuildProducts): BuildProducts {
  const { listings, symbolmap, symbolsizes, segments, debuginfo } = r;
  return { listings, symbolmap, symbolsizes, segments, debuginfo };
}

export function isUnchanged(result: WorkerResult) : result is WorkerUnchangedResult {
  return ('unchanged' in result);
}

export function isErrorResult(result: WorkerResult) : result is WorkerErrorResult {
  return ('errors' in result);
}

export function isOutputResult(result: WorkerResult) : result is WorkerOutputResult<any> {
  return ('output' in result);
}

export interface WorkingStore {
  getFileData(path:string) : FileData;
}
