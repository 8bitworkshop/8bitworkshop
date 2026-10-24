/*
 * Tool metadata registry.
 *
 * Single source of truth for declarative (data-only) metadata about every
 * build tool, keyed by tool id. Both the IDE (src/ide) and the worker
 * (src/worker) import this module.
 *
 * What lives here:
 *   - extension -> tool selection hints
 *   - editor (CodeMirror) styles and help URLs        (was TOOL_TO_SOURCE_STYLE/HELPURL in src/ide/ui.ts)
 *   - preload filesystem names per platform            (was TOOL_PRELOADFS in src/worker/workertools.ts)
 *   - wasm module names                                (was loadNative() args in src/worker/tools/*.ts)
 *   - include/link dependency patterns                 (was parseIncludeDependencies in src/ide/project.ts)
 *   - remote/server tool config                        (was ServerBuildTool in src/worker/server/buildenv.ts)
 *
 * What stays OUT of this module (behavior cannot cross the worker boundary):
 *   - build functions (src/worker/workertools.ts `TOOLS` map)
 *   - error matchers, listing parsers (src/worker/tools/*.ts)
 *   - machine layout params (code_start, rom_size, ... -> src/worker/platforms.ts PLATFORM_PARAMS)
 *
 * A unit test cross-checks that every id in TOOL_META has a worker build fn
 * (unless noWorkerBuild) and vice versa.
 */

import { getRootBasePlatform } from "./util";

export type ToolKind =
  | 'compiler'      // source -> object/output (cc65, sdcc, cmoc, oscar64, ...)
  | 'assembler'     // asm -> object (dasm, acme, ca65, ...)
  | 'linker'        // object(s) -> binary (ld65, sdldz80, lwlink, ...)
  | 'interpreter'   // e.g. BASIC
  | 'hdl'           // hardware description (verilator, yosys, silice)
  | 'remote'        // builds on a remote server (llvm-mos)

export type ToolArch =
  | '6502' | 'z80' | '6809' | 'arm32' | 'x86' | 'gbz80' | 'verilog' | 'zmachine';

/**
 * Extra raw argv for one build phase. Source directives (`//#flag <phase> ...`)
 * and platform/ToolMeta defaults both land here; each tool picks the list
 * matching its ToolKind. Distinct from `defines` (symbols) because these are
 * opaque flags the build engine cannot interpret or validate.
 */
export interface BuildArgs {
  compiler?: string[];
  assembler?: string[];
  linker?: string[];
}

export interface PlatformToolConfig {
  /** preload filesystem name for this platform (was TOOL_PRELOADFS compound keys) */
  preloadFS?: string;
  /** WASI filesystem zip (in src/worker/fs/) for this platform, e.g. 'cc65-fs-nes.zip' */
  wasiFSZip?: string;
  /** skeleton filename override (defaults to tool id) */
  skeleton?: string;
  /** library args for this platform (was PLATFORM_PARAMS.libargs) */
  libargs?: string[];
  /** linker config filename (was PLATFORM_PARAMS.cfgfile) */
  cfgfile?: string;
  /** extra compiler args (was PLATFORM_PARAMS.extra_compile_args) */
  extraCompileArgs?: string[];
  /** preprocessor defines for this platform (NAME or NAME=VALUE) */
  defines?: string[];
  /** extra raw args per phase */
  buildArgs?: BuildArgs;
  /** default output filename (was server buildenv platform_configs.outfile) */
  defaultOutput?: string;
}

export interface ServerToolConfig {
  version?: string;
  /** platforms this tool supports on the remote server */
  platforms: string[];
  binpath: string;
  command: string;
  args: string[];
}

export interface ToolIncludePattern {
  re: RegExp;
  group?: number;
  suffix?: string;
  /** true for system includes (#include <foo.h>) -- resolved from the
   *  toolchain filesystem, not the project; used for UI links only,
   *  not for build dependency scanning */
  system?: boolean;
}
   
export interface ToolMeta {
  /** join key, e.g. 'cc65', 'dasm', 'llvm-mos'. Note: 'remote:' is a transport
   *  prefix, not part of the id -- getToolMeta() strips it. */
  id: string;
  /** human-readable display name */
  name: string;
  kind: ToolKind;
  /** CPU architecture the tool targets (helps disambiguate ambiguous extensions) */
  arch?: ToolArch;

  // ---- tool-global metadata (same on every platform) ----

  /** filename extensions this tool consumes (explicit ones; fallback/default
   *  selection is still the platform's job) */
  extensions: string[];
  /** CodeMirror editor mode (was TOOL_TO_SOURCE_STYLE) */
  editorStyle?: string;
  /** documentation URL (was TOOL_TO_HELPURL). Where upstream publishes
   *  version tags, link to the tag matching TOOL_META.version so docs stay
   *  accurate for the vendored binary; refresh when bumping version. */
  helpURL?: string;
  /** skeleton filename in presets/<platform>/, defaults to tool id */
  skeleton?: string;
  /** wasm/emscripten module name loaded by the worker (was loadNative() arg) */
  wasmModule?: string;

  // ---- symbol capability ----

  /** flag defining a preprocessor/assembler symbol, e.g. '-D'. Undefined means
   *  the tool has no command-line define mechanism (e.g. sdasz80). */
  defineFlag?: string;
  /** true if the value is joined to the flag ('-DFOO=1') rather than separate
   *  ('-D', 'FOO=1'). cc65/sdcc join, ca65 does not. */
  defineInline?: boolean;
  /** flag a linker uses to define a global symbol with an integer expression,
   *  e.g. '-D' (ld65) or '-g' (sdldz80). Undefined means no link symbols. */
  linkSymbolFlag?: string;
  /** true if the link symbol value is joined to the flag */
  linkSymbolInline?: boolean;

  /** tool version string, as reported by the vendored wasm binary.
   *  Static per committed binary -- refresh with `npm run toolversions`. */
  version?: string;
  /** alternate version also selectable at build time (e.g. SDCC 4.x via
   *  `//#tooldef c sdcc=4`), shown next to `version` in the tool info. */
  versionAlt?: string;
  /** regexes matching include directives, used for dependency parsing */
  includePatterns?: (RegExp | ToolIncludePattern)[];
  /** regexes matching link directives, used for dependency parsing */
  linkPatterns?: (RegExp | ToolIncludePattern)[];
  /** true if "//#link" dependencies are compiled together with the main
   *  source in one tool invocation (single-pass compilers like oscar64)
   *  rather than built separately and linked. */
  compileLinkedSources?: boolean;
  /** directories inside the shared filesystem containing searchable shared code
   *  (headers, asm includes). Paths are relative to the FS root as they appear
   *  in the filesystem metadata, e.g. ['/include', '/asminc', '/headers'].
   *  Used with platforms[].preloadFS or wasiFSZip. */
  includeDirs?: string[];
  /** name of a WASI filesystem zip (in src/worker/fs/) that contains the
   *  toolchain's headers, for tools that don't use an emscripten preloadFS
   *  package (e.g. cc2600/cc7800). Referenced as 'wasi:<name>' in worker msgs. */
  wasiFSZip?: string;

  // ---- per-platform metadata (was TOOL_PRELOADFS / PLATFORM_PARAMS) ----

  /** platform id -> config overrides */
  platforms?: { [platform: string]: PlatformToolConfig };

  // ---- remote/server metadata (was ServerBuildTool in buildenv.ts) ----

  /** true if this tool builds on a remote server (llvm-mos) */
  remote?: boolean;
  /** remote server build config */
  server?: ServerToolConfig;

  /** true if the id is registered here but has no worker build fn yet
   *  (sccz80, naken) -- tolerated by the TOOLS <-> TOOL_META cross-check */
  noWorkerBuild?: boolean;
}

//// shared dependency-parsing patterns (from src/ide/project.ts)

// C / most assemblers: [.#%]?include|incbin|embed "file", //#resource "file"
// The resource form is also useful to tools whose own include syntax has no
// way to name a non-source file (e.g. urust's custom board TOML).
export const SHARED_RESOURCE_PATTERNS: RegExp[] = [
  /^\s*([;']|[/][/])#(resource)\s+"(.+?)"/gm,
];
export const SHARED_INCLUDE_PATTERNS: RegExp[] = [
  /^\s*[.#%]?(include|incbin|embed)\s+"(.+?)"/gmi,
  ...SHARED_RESOURCE_PATTERNS,
];

// dasm accepts include/incbin file names without quotes as well as quoted
// ones (v_include() -> getfilename()), e.g. `INCLUDE VCS.h`. The shared pattern
// only matches the quoted form, so scan the unquoted form here too; the
// character class excludes a leading quote so quoted names stay with the
// shared pattern (and dasm allows a leading dot on pseudo-ops, e.g. .include).
export const DASM_INCLUDE_PATTERNS: RegExp[] = [
  ...SHARED_INCLUDE_PATTERNS,
  /^\s*[.]?(include|incbin)\s+([^\s;"]+)/gmi,
];

// oscar64: #pragma compile("file.c") pulls another source file into the build
// (the compiler's equivalent of a link). The compiler handles it itself, so the
// file just has to be a build dependency copied into the tool filesystem.
export const OSCAR64_INCLUDE_PATTERNS: (RegExp | ToolIncludePattern)[] = [
  ...SHARED_INCLUDE_PATTERNS,
  /^\s*#pragma\s+compile\s*\(\s*"([^"]+)"\s*\)/gmi,
];

// C / most assemblers: //#link "file" (or ;link)
export const SHARED_LINK_PATTERNS: RegExp[] = [
  /^\s*([;]|[/][/])#link\s+"(.+?)"/gm,
];

// Verilog family: `include/.include, $include/$dofile/$write_image_in_table,
// .arch json, $readmem[bh]
export const VERILOG_INCLUDE_PATTERNS: (RegExp | ToolIncludePattern)[] = [
  /^\s*(`include|[.]include)\s+"(.+?)"/gmi,
  /^\s*\$(include|\$dofile|\$write_image_in_table)\('(.+?)'/gmi,
  { re: /^\s*([.]arch)\s+(\w+)/gmi, suffix: '.json' },
  /\$readmem[bh]\("(.+?)"/gmi,
];

// C system includes: #include <file.h> -- resolved from the toolchain
// preload filesystem rather than the project. Deliberately NOT part of
// SHARED_INCLUDE_PATTERNS, so build dependency scanning skips them.
export const SYSTEM_INCLUDE_PATTERNS: ToolIncludePattern[] = [
  { re: /^\s*[.#%]?\s*include\s+<(.+?)>/gmi, system: true },
];

/**
 * System include patterns (#include <foo.h>) for UI linking, for tools that
 * have a bundled filesystem to search. Empty otherwise.
 */
export function getSystemIncludePatterns(tool?: string): ToolIncludePattern[] {
  let meta = tool && getToolMeta(tool);
  return (meta && meta.includeDirs && meta.includeDirs.length) ? SYSTEM_INCLUDE_PATTERNS : [];
}

// xasm6809 (USE) and merlin32 (ASM): "  USE file.ext"
export const USE_ASM_INCLUDE_PATTERNS: RegExp[] = [
  /^\s+(USE|ASM)\s+(\S+[.]\S+)/gm,
];

// acme: !src "file"
export const ACME_INCLUDE_PATTERNS: RegExp[] = [
  /^[!]src\s+"(.+?)"/gmi,
];

// wiz: import "file"; (implicit .wiz extension) / embed "file";
export const WIZ_INCLUDE_PATTERNS: (RegExp | ToolIncludePattern)[] = [
  { re: /^\s*import\s*"(.+?)";/gmi, suffix: '.wiz' },
  /^\s*embed\s*"(.+?)";/gmi,
];

// ecs: import "file"
export const ECS_INCLUDE_PATTERNS: RegExp[] = [
  /^\s*(import)\s*"(.+?)"/gmi,
];

// dialog: %% #include "file" (comment directive)
export const DIALOG_INCLUDE_PATTERNS: RegExp[] = [
  /^\s*%%\s*#include\s+"(.+?)"/gm,
];

// urust: include_bytes!("file") and include_str!("file"); the path is relative
// to the including source file, like the other tools' include directives.
// `mod foo;` pulls in foo.rs (or foo/mod.rs) beside the including file, the
// way rustc resolves a module, so those files ride along as includes. `use
// foo::...;` only names a module `mod` already declared; it is still scanned
// so the editor can link it. The rs8 register modules resolve to the sources
// shipped in urust-fs.zip (see the tool's includeDirs): urust splices them in
// from its .wasm, so they're copied out again for the editor to read; path
// keywords (self/super/crate) stay out. urust loads modules itself -- no
// separate link step is involved.
const URUST_MOD_PATTERN = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gm;
// the modules in crates/rs8/src (and the io shim) that urust bundles
const URUST_RS8_MODULE_PATTERN = /\brs8::(apple2|atari8|c64|conio|io|nes|rand|vcs|vic20|zx)\b/g;
export const URUST_INCLUDE_PATTERNS: (RegExp | ToolIncludePattern)[] = [
  /\binclude_(?:bytes|str)!\s*\(\s*"(.+?)"\s*\)/g,
  ...SHARED_RESOURCE_PATTERNS,
  { re: URUST_MOD_PATTERN, suffix: '.rs' },
  { re: URUST_MOD_PATTERN, suffix: '/mod.rs' },
  { re: URUST_RS8_MODULE_PATTERN, suffix: '.rs' },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+(?!self\b|super\b|crate\b|rs8\b)([A-Za-z_][A-Za-z0-9_]*)\s*::/gm, suffix: '.rs' },
];

//// preload filesystem names per tool/platform (was TOOL_PRELOADFS)

/**
 * Platform-specific documentation pages, keyed by tool id then platform id.
 * These override the tool's generic `helpURL` on that platform -- e.g. cc65
 * publishes an Atari-specific manual page at /doc/atari.html. Only tools with
 * a platform-specific page need an entry here; everything else falls back to
 * ToolMeta.helpURL.
 */
const TOOL_PLATFORM_HELPURL: { [tool: string]: { [platform: string]: string } } = {
  cc65: {
    apple2: 'https://cc65.github.io/doc/apple2.html',
    atari8: 'https://cc65.github.io/doc/atari.html',
    c64: 'https://cc65.github.io/doc/c64.html',
    nes: 'https://cc65.github.io/doc/nes.html',
    pce: 'https://cc65.github.io/doc/pce.html',
    vic20: 'https://cc65.github.io/doc/vic20.html',
    lynx: 'https://cc65.github.io/doc/lynx.html',
  },
};

/**
 * Which SDCC a program gets unless it says `//#tooldef c sdcc=3|4`. To make
 * 4.x the default, change this to 4: nothing else needs editing.
 *   3 = 3.6.5, Emscripten, preloadFS 'sdcc' (builds several times faster)
 *   4 = 4.x, WASI, sdcc-fs.zip (smaller code)
 */
export const SDCC_DEFAULT_VERSION: 3 | 4 = 3;

/**
 * 'default' lists both filesystems; the one for SDCC_DEFAULT_VERSION leads
 * (getSharedFileSystemName prefers preloadFS). Platforms whose prebuilt
 * libraries were compiled by SDCC 3.x (libcv, gb.lib, cpctelera) have only
 * preloadFS: 4.x's default calling convention, sdcccall(1), can't call them.
 */
const SDCC_FS: { [platform: string]: PlatformToolConfig } = {
  'default': SDCC_DEFAULT_VERSION === 3
    ? { preloadFS: 'sdcc', wasiFSZip: 'sdcc-fs.zip' }
    : { wasiFSZip: 'sdcc-fs.zip' },
  'coleco': { preloadFS: 'sdcc' },
  'msx-libcv': { preloadFS: 'sdcc' },
  'sms': { preloadFS: 'sdcc' },
  'gb': { preloadFS: 'sdcc' },
  'cpc': { preloadFS: 'sdcc' },
};

const CC65_WASIFS: { [platform: string]: PlatformToolConfig } = {
  'apple2': { wasiFSZip: 'cc65-fs-apple2.zip' },
  'c64': { wasiFSZip: 'cc65-fs-c64.zip' },
  'vic20': { wasiFSZip: 'cc65-fs-vic20.zip' },
  'nes': { wasiFSZip: 'cc65-fs-nes.zip' },
  'atari8': { wasiFSZip: 'cc65-fs-atari8.zip' },
  'vector': { wasiFSZip: 'cc65-fs-none.zip' },
  'atari7800': { wasiFSZip: 'cc65-fs-none.zip' },
  'devel': { wasiFSZip: 'cc65-fs-none.zip' },
  'vcs': { wasiFSZip: 'cc65-fs-atari2600.zip' },
  'pce': { wasiFSZip: 'cc65-fs-pce.zip' },
  'exidy': { wasiFSZip: 'cc65-fs-none.zip' },
};

//// tool registry

export const TOOL_META: { [id: string]: ToolMeta } = {

  // ---- 6502 assemblers ----

  dasm: {
    id: 'dasm', name: 'DASM', kind: 'assembler', arch: '6502',
    extensions: ['.dasm'],
    editorStyle: '6502',
    helpURL: 'https://raw.githubusercontent.com/dasm-assembler/dasm/refs/tags/v2.20.17/docs/dasm.txt',
    wasmModule: 'dasm-wasisdk',
    version: '2.20.17',
    includePatterns: DASM_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  acme: {
    id: 'acme', name: 'ACME', kind: 'assembler', arch: '6502',
    extensions: ['.acme'],
    editorStyle: '6502',
    helpURL: 'https://raw.githubusercontent.com/8bitworkshop/acme/main/docs/QuickRef.txt',
    wasmModule: 'acme',
    version: '0.97.1',
    includePatterns: [...SHARED_INCLUDE_PATTERNS, ...ACME_INCLUDE_PATTERNS],
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  xa: {
    id: 'xa', name: 'XA', kind: 'assembler', arch: '6502',
    extensions: ['.xa'],
    editorStyle: '6502',
    helpURL: 'https://www.floodgap.com/retrotech/xa/',
    wasmModule: 'xa',
    version: '2.4.1',
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  nesasm: {
    id: 'nesasm', name: 'NESASM', kind: 'assembler', arch: '6502',
    extensions: ['.nesasm'],
    editorStyle: '6502',
    helpURL: 'https://github.com/camsaul/nesasm',
    wasmModule: 'nesasm',
    version: '3.1',
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  merlin32: {
    id: 'merlin32', name: 'Merlin 32', kind: 'assembler', arch: '6502',
    extensions: ['.lnk'],
    editorStyle: '6502',
    helpURL: 'https://github.com/apple2accumulator/merlin32',
    wasmModule: 'merlin32',
    version: '1.1.1',
    includePatterns: [...SHARED_INCLUDE_PATTERNS, ...USE_ASM_INCLUDE_PATTERNS],
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  // ---- cc65 toolchain ----

  cc65: {
    id: 'cc65', name: 'cc65', kind: 'compiler', arch: '6502',
    extensions: ['.c', '.h'],
    includeDirs: ['/share/cc65/include', '/share/cc65/asminc'],
    editorStyle: 'text/x-csrc',
    helpURL: 'https://cc65.github.io/doc/cc65.html',
    wasmModule: 'cc65',
    version: '2.19',
    defineFlag: '-D', defineInline: true,
    platforms: CC65_WASIFS,
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  ca65: {
    id: 'ca65', name: 'ca65', kind: 'assembler', arch: '6502',
    extensions: ['.s', '.ca65', '.inc'],
    includeDirs: ['/share/cc65/include', '/share/cc65/asminc'],
    editorStyle: '6502',
    helpURL: 'https://cc65.github.io/doc/ca65.html',
    wasmModule: 'ca65',
    version: '2.19',
    defineFlag: '-D', defineInline: false,
    platforms: CC65_WASIFS,
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  ld65: {
    id: 'ld65', name: 'ld65', kind: 'linker', arch: '6502',
    extensions: [],
    wasmModule: 'ld65',
    version: '2.19',
    linkSymbolFlag: '-D', linkSymbolInline: false,
  },

  // ---- SDCC toolchain (z80) ----

  sdcc: {
    id: 'sdcc', name: 'SDCC', kind: 'compiler', arch: 'z80',
    extensions: ['.c', '.h', '.sdcc'],
    includeDirs: ['/share/sdcc/include', '/include'],
    editorStyle: 'text/x-csrc',
    helpURL: 'http://sdcc.sourceforge.net/doc/sdccman.pdf',
    wasmModule: 'sdcc4',
    version: SDCC_DEFAULT_VERSION === 3 ? '3.6.5' : '4.6.0',
    versionAlt: SDCC_DEFAULT_VERSION === 3 ? '4.6.0' : '3.6.5',
    defineFlag: '-D', defineInline: true,
    platforms: SDCC_FS,
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  sdasz80: {
    id: 'sdasz80', name: 'sdasz80', kind: 'assembler', arch: 'z80',
    extensions: ['.s'],
    includeDirs: ['/share/sdcc/include', '/include'],
    editorStyle: 'z80',
    wasmModule: 'sdasz80-4',
    version: '05.50.4+',
    platforms: SDCC_FS,
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  sdasgb: {
    id: 'sdasgb', name: 'sdasgb', kind: 'assembler', arch: 'gbz80',
    extensions: ['.sgb'],
    includeDirs: ['/include'],
    editorStyle: 'z80',
    wasmModule: 'sdasgb',
    platforms: { default: { preloadFS: 'sdcc' } },
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  sdldz80: {
    id: 'sdldz80', name: 'sdldz80', kind: 'linker', arch: 'z80',
    extensions: [],
    wasmModule: 'sdld4',
    version: '05.50.4-',
    linkSymbolFlag: '-g', linkSymbolInline: false,
  },

  // SDCC 4.x mos6502 backend (compile with `-sdcc.c`); sdld6808 is the
  // 6502 personality of the sdld4 binary
  sdas6500: {
    id: 'sdas6500', name: 'sdas6500', kind: 'assembler', arch: '6502',
    extensions: [],
    wasmModule: 'sdas6500',
    version: '05.50.4+',
    platforms: SDCC_FS,
  },

  sdld6808: {
    id: 'sdld6808', name: 'sdld6808', kind: 'linker', arch: '6502',
    extensions: [],
    wasmModule: 'sdld4',
    version: '05.50.4-',
    linkSymbolFlag: '-g', linkSymbolInline: false,
  },

  sccz80: {
    id: 'sccz80', name: 'sccz80', kind: 'compiler', arch: 'z80',
    extensions: ['.scc'],
    platforms: { default: { preloadFS: 'sccz80' } },
    noWorkerBuild: true,
  },

  naken: {
    id: 'naken', name: 'Naken', kind: 'assembler',
    extensions: ['.ns'],
    helpURL: 'https://github.com/mikeakohn/naken_asm',
    noWorkerBuild: true,
  },

  // ---- z80 assemblers ----

  zmac: {
    id: 'zmac', name: 'zmac', kind: 'assembler', arch: 'z80',
    extensions: ['.z'],
    editorStyle: 'z80',
    helpURL: 'https://raw.githubusercontent.com/8bitworkshop/zmac/master/doc.txt',
    wasmModule: 'zmac',
    version: '28jul2018',
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  jsasm: {
    id: 'jsasm', name: 'JSASM', kind: 'assembler',
    extensions: ['.asm'],
    editorStyle: 'z80',
    // pure JS assembler, no wasm module. Only used on the verilog platform,
    // where .asm files pull in .v modules and name a CPU with '.arch'.
    includePatterns: VERILOG_INCLUDE_PATTERNS,
    linkPatterns: [],
  },

  // ---- 6809 toolchain ----

  xasm6809: {
    id: 'xasm6809', name: 'XASM6809', kind: 'assembler', arch: '6809',
    extensions: ['.xasm'],
    editorStyle: '6809',
    wasmModule: 'xasm6809',
    includePatterns: [...SHARED_INCLUDE_PATTERNS, ...USE_ASM_INCLUDE_PATTERNS],
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  cmoc: {
    id: 'cmoc', name: 'CMOC', kind: 'compiler', arch: '6809',
    extensions: ['.c', '.h'],
    // NOTE: no bundled filesystem -- the compiler passes -I/share/include but
    // never mounts one, so system headers can't be linked in the UI
    editorStyle: 'text/x-csrc',
    helpURL: 'https://github.com/stahta01/cmoc/',
    wasmModule: 'cmoc',
    version: '0.1.67',
    defineFlag: '-D', defineInline: false,
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  lwasm: {
    id: 'lwasm', name: 'LWASM', kind: 'assembler', arch: '6809',
    extensions: ['.lwasm'],
    editorStyle: '6809',
    wasmModule: 'lwasm',
    version: '4.17',
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  lwlink: {
    id: 'lwlink', name: 'LWLINK', kind: 'linker', arch: '6809',
    extensions: [],
    wasmModule: 'lwlink',
    version: '4.17',
  },

  // ---- ARM ----

  vasmarm: {
    id: 'vasmarm', name: 'vasm (ARM)', kind: 'assembler', arch: 'arm32',
    extensions: ['.vasm'],
    editorStyle: 'vasm',
    wasmModule: 'vasmarm_std',
    version: '1.8k',
    defineFlag: '-D', defineInline: false,
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  armips: {
    id: 'armips', name: 'armips', kind: 'assembler', arch: 'arm32',
    extensions: ['.armips'],
    editorStyle: 'vasm',
    wasmModule: 'armips',
    version: '0.11.0',
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  armtcc: {
    id: 'armtcc', name: 'TCC (ARM)', kind: 'compiler', arch: 'arm32',
    extensions: ['.c', '.s'],
    includeDirs: ['/include'],
    wasiFSZip: 'arm32-fs.zip',
    editorStyle: 'text/x-csrc',
    wasmModule: 'arm-tcc',
    defineFlag: '-D', defineInline: false,
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  armtcclink: {
    id: 'armtcclink', name: 'TCC (ARM) link', kind: 'linker', arch: 'arm32',
    extensions: [],
    wasmModule: 'arm-tcc',
  },

  // ---- x86 ----

  smlrc: {
    id: 'smlrc', name: 'SmallerC', kind: 'compiler', arch: 'x86',
    extensions: ['.c'],
    helpURL: 'https://github.com/alexfru/SmallerC/blob/master/v0100/doc/smlrc.md',
    // NOTE: no bundled filesystem and no -I arg -- no headers to link in the UI
    editorStyle: 'text/x-csrc',
    wasmModule: 'smlrc',
    defineFlag: '-D', defineInline: false,
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  yasm: {
    id: 'yasm', name: 'YASM', kind: 'assembler', arch: 'x86',
    extensions: ['.asm'],
    editorStyle: 'gas',
    helpURL: 'https://www.tortall.net/projects/yasm/manual/html/manual.html',
    wasmModule: 'yasm',
    version: '1.3.0',
    defineFlag: '-D', defineInline: false,
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  // ---- 6502 C compilers / BASIC dialects ----

  oscar64: {
    id: 'oscar64', name: 'Oscar64', kind: 'compiler', arch: '6502',
    extensions: ['.c', '.cpp', '.cc', '.o64'],
    includeDirs: ['/include'],
    wasiFSZip: 'oscar64-fs.zip',
    editorStyle: 'text/x-csrc',
    helpURL: 'https://github.com/drmortalwombat/oscar64/blob/v1.32.266/oscar64.md',
    defineFlag: '-d', defineInline: true,
    wasmModule: 'oscar64',
    version: '1.32.266',
    includePatterns: OSCAR64_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
    compileLinkedSources: true,
    platforms: {
      // oscar64 defaults to the C64 target machine
      c64: {},
      atari8: { buildArgs: { compiler: ['-tm=atari'] } },
      nes: { buildArgs: { compiler: ['-tm=nes'] } },
    },
  },

  bataribasic: {
    id: 'bataribasic', name: 'batari Basic', kind: 'compiler', arch: '6502',
    extensions: ['.bb', '.bas'],
    includeDirs: ['/includes'],
    editorStyle: 'bataribasic',
    helpURL: 'help/bataribasic/manual.html',
    wasiFSZip: 'bb-fs.zip',
    platforms: { default: {} },
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  fastbasic: {
    id: 'fastbasic', name: 'FastBasic', kind: 'compiler', arch: '6502',
    extensions: ['.bas', '.fb', '.fbi'],
    editorStyle: 'fastbasic',
    helpURL: 'https://github.com/dmsc/fastbasic/blob/v4.4/manual.md',
    wasmModule: 'fastbasic-int',
    version: '4.4',
    platforms: { default: { wasiFSZip: 'cc65-fs-atari8.zip' } },
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  cc2600: {
    id: 'cc2600', name: 'CC2600', kind: 'compiler', arch: '6502',
    extensions: ['.cc2600'],
    editorStyle: 'text/x-csrc',
    helpURL: 'https://github.com/steux/cc2600',
    wasmModule: 'cc2600',
    version: '0.4.5',
    wasiFSZip: 'cc2600-fs.zip',
    includeDirs: ['/headers'],
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  cc7800: {
    id: 'cc7800', name: 'CC7800', kind: 'compiler', arch: '6502',
    extensions: ['.cc7800', '.c78'],
    editorStyle: 'text/x-csrc',
    helpURL: 'https://github.com/steux/cc7800',
    wasmModule: 'cc7800',
    version: '0.2.28',
    wasiFSZip: 'cc7800-fs.zip',
    includeDirs: ['/headers'],
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
  },

  // ---- other languages ----

  basic: {
    id: 'basic', name: 'BASIC', kind: 'interpreter',
    extensions: ['.bas'],
    editorStyle: 'basic',
  },

  wiz: {
    id: 'wiz', name: 'wiz', kind: 'compiler',
    extensions: ['.wiz'],
    includeDirs: ['/common/$platform'],
    editorStyle: 'text/x-wiz',
    helpURL: 'https://github.com/wiz-lang/wiz/blob/master/readme.md#wiz',
    wasmModule: 'wiz',
    version: '0.1.2',
    platforms: { default: { preloadFS: 'wiz' } },
    includePatterns: WIZ_INCLUDE_PATTERNS,
  },

  ecs: {
    id: 'ecs', name: 'ECS', kind: 'assembler', arch: '6502',
    extensions: ['.ecs'],
    editorStyle: 'ecs',
    platforms: {
      vcs: { wasiFSZip: 'cc65-fs-atari2600.zip' },
      nes: { wasiFSZip: 'cc65-fs-nes.zip' },
      c64: { wasiFSZip: 'cc65-fs-c64.zip' },
    },
    includePatterns: [...SHARED_INCLUDE_PATTERNS, ...ECS_INCLUDE_PATTERNS],
  },

  inform6: {
    id: 'inform6', name: 'Inform 6', kind: 'compiler', arch: 'zmachine',
    extensions: ['.inf'],
    editorStyle: 'inform6',
    wasmModule: 'inform',
    version: '6.34',
    platforms: { default: { preloadFS: 'inform' } },
  },

  dialog: {
    id: 'dialog', name: 'Dialog', kind: 'compiler', arch: 'zmachine',
    extensions: ['.dg'],
    editorStyle: 'dialog',
    helpURL: 'https://linusakesson.net/dialog/docs/',
    wasmModule: 'dialogc',
    // self-reported build tag, not a numeric release
    version: '1c/03-dev',
    wasiFSZip: 'dialog-fs.zip',
    includeDirs: ['/'],
    includePatterns: DIALOG_INCLUDE_PATTERNS,
  },

  // Rust subset for 8-bit CPUs (github.com/sehugg/urust); one WASI binary
  // builds for devel-6502, nes, c64, atari8, vcs, apple2, vic20 and
  // zx-spectrum (see URUST_PLATFORM_NAMES below)
  urust: {
    id: 'urust', name: 'urust', kind: 'compiler', arch: '6502',
    extensions: ['.rs'],
    editorStyle: 'rust',
    wasmModule: 'urust',
    version: '0.0.1',
    // the compiler embeds the rs8 sources; ship them as a WASI filesystem so
    // the editor can open them (view-only -- the build uses the embedded ones)
    wasiFSZip: 'urust-fs.zip',
    includeDirs: ['/rs8'],
    includePatterns: URUST_INCLUDE_PATTERNS,
  },

  // ---- verilog / HDL ----

  verilator: {
    id: 'verilator', name: 'Verilator', kind: 'hdl', arch: 'verilog',
    extensions: ['.v'],
    editorStyle: 'verilog',
    helpURL: 'https://verilator.org/guide/4.205/',
    wasmModule: 'verilator_bin',
    version: '4.205',
    includePatterns: VERILOG_INCLUDE_PATTERNS,
    linkPatterns: [],
  },

  yosys: {
    id: 'yosys', name: 'Yosys', kind: 'hdl', arch: 'verilog',
    extensions: [],
    wasmModule: 'yosys',
    includePatterns: VERILOG_INCLUDE_PATTERNS,
    linkPatterns: [],
  },

  silice: {
    id: 'silice', name: 'Silice', kind: 'hdl', arch: 'verilog',
    extensions: ['.ice'],
    editorStyle: 'verilog',
    helpURL: 'https://github.com/sylefeb/Silice',
    wasmModule: 'silice',
    version: '0.1',
    platforms: { default: { preloadFS: 'Silice' } },
    includePatterns: VERILOG_INCLUDE_PATTERNS,
    linkPatterns: [],
  },

  // ---- remote / server ----

  'llvm-mos': {
    id: 'llvm-mos', name: 'LLVM-MOS', kind: 'compiler', arch: '6502',
    extensions: ['.c', '.cpp', '.s', '.S', '.C'],
    editorStyle: 'text/x-csrc', // used as 'remote:llvm-mos' in the IDE
    helpURL: 'https://llvm-mos.org/wiki/Welcome',
    remote: true,
    includePatterns: SHARED_INCLUDE_PATTERNS,
    linkPatterns: SHARED_LINK_PATTERNS,
    server: {
      version: 'latest',
      platforms: ['atari8', 'c64', 'nes', 'pce', 'vcs'],
      binpath: 'llvm-mos/bin',
      command: 'mos-clang',
      args: ['-Os', '-g', '-D', '__8BITWORKSHOP__', '-o', '$OUTFILE', '$INFILES'],
    },
  },

  // TODO: do we need this too?
  remote: {
    id: 'remote', name: 'Remote build', kind: 'remote',
    extensions: [],
    remote: true,
  },
};

//// helpers

/**
 * Look up tool metadata by tool id. Tolerates the 'remote:' transport prefix
 * used in build steps (e.g. 'remote:llvm-mos' -> 'llvm-mos').
 */
export function getToolMeta(id: string): ToolMeta | undefined {
  return TOOL_META[id.replace(/^remote:/, '')];
}

/**
 * Platform-specific documentation page for a tool, or undefined if the tool
 * only has a generic page. Suffixed platform ids resolve through their root
 * base (e.g. 'atari8-800' -> 'atari8').
 */
export function getPlatformToolHelpURL(tool: string, platform: string): string | undefined {
  let meta = getToolMeta(tool);
  if (!meta || !platform) return undefined;
  let overrides = TOOL_PLATFORM_HELPURL[meta.id];
  if (!overrides) return undefined;
  let url = overrides[platform];
  if (!url) {
    let base = getRootBasePlatform(platform);
    if (base && base !== platform) url = overrides[base];
  }
  return url;
}

/**
 * Documentation URL for a tool on a platform. A platform-specific page (e.g.
 * cc65's atari.html on atari8) wins over the tool's generic helpURL. Undefined
 * if the tool has no docs at all.
 */
export function getToolHelpURL(tool: string, platform?: string): string | undefined {
  let meta = getToolMeta(tool);
  if (!meta) return undefined;
  return (platform && getPlatformToolHelpURL(tool, platform)) || meta.helpURL;
}

/**
 * Return all tools that consume the given filename (longest extension match
 * first). Ambiguity is resolved by the platform, which picks from these.
 */
export function getToolMetaForFilename(fn: string): ToolMeta[] {
  let matches: { meta: ToolMeta, len: number }[] = [];
  for (let id in TOOL_META) {
    let meta = TOOL_META[id];
    for (let ext of meta.extensions) {
      if (ext && fn.endsWith(ext)) {
        matches.push({ meta, len: ext.length });
        break;
      }
    }
  }
  return matches.sort((a, b) => b.len - a.len).map(m => m.meta);
}

/**
 * The per-platform ToolMeta config for a tool, resolving suffixed platform ids
 * to their root base and falling back to 'default'. Used by the Builder to
 * layer platform-level defines/buildArgs under source directives.
 */
export function getPlatformToolConfig(tool: string, platform?: string): PlatformToolConfig | undefined {
  let meta = tool && getToolMeta(tool);
  if (!meta || !meta.platforms) return undefined;
  if (platform) {
    let p = meta.platforms[platform];
    if (p) return p;
    let base = getRootBasePlatform(platform);
    if (base && base !== platform && meta.platforms[base]) return meta.platforms[base];
  }
  return meta.platforms['default'];
}

/**
 * Resolve the preload filesystem name for a tool on a platform
 * (was TOOL_PRELOADFS, including compound 'tool-platform' keys).
 */
export function getPreloadFSName(tool: string, platform?: string): string | undefined {
  let meta = getToolMeta(tool);
  if (!meta) return undefined;
  if (meta.platforms) {
    if (platform) {
      // Try the exact id, then the root base id so suffixed platform ids
      // (e.g. 'atari8-800', 'atari8-5200.xlmame') resolve to the shared
      // filesystem registered under the root (e.g. 'atari8-800' -> 'atari8').
      let p = meta.platforms[platform];
      if (p && p.preloadFS) return p.preloadFS;
      let base = getRootBasePlatform(platform);
      if (base && base !== platform) {
        let b = meta.platforms[base];
        if (b && b.preloadFS) return b.preloadFS;
      }
    }
    let d = meta.platforms['default'];
    if (d && d.preloadFS) return d.preloadFS;
  }
  return undefined;
}

/** Skeleton filename in presets/<platform>/, defaults to tool id. */
export function getSkeletonName(tool: string): string {
  let meta = getToolMeta(tool);
  return (meta && meta.skeleton) ? meta.skeleton : tool.replace(/^remote:/, '');
}

/**
 * urust's `--platform` names, keyed by the 8bitworkshop platform root (the id
 * without a `.emulator` suffix or a `-specialization`). A root that isn't here
 * has no urust target, even though .rs selects urust on every 6502/Z80
 * platform (see toolselect.ts).
 */
export const URUST_PLATFORM_NAMES: { [root: string]: string } = {
  'bare': 'bare',
  'devel': 'devel-6502',
  'nes': 'nes',
  'c64': 'c64',
  'atari8': 'atari8',
  'vcs': 'vcs',
  'apple2': 'apple2',
  'vic20': 'vic20',
  'zx': 'zx-spectrum',
};

/** urust's `--platform` name for an 8bitworkshop platform id, if it has one. */
export function urustPlatformName(platform: string): string | undefined {
  return URUST_PLATFORM_NAMES[platform.split(/[.-]/)[0]];
}

/**
 * Version string for display, e.g. '3.6.5 (default) / 4.6.0' for SDCC or
 * '—' when the tool has no recorded version.
 */
export function getToolVersionLabel(meta?: ToolMeta): string {
  if (!meta || !meta.version) return '—';
  return meta.versionAlt ? meta.version + ' (default) / ' + meta.versionAlt : meta.version;
}

/**
 * Include patterns to use when scanning a source file for dependencies.
 * Falls back to the platform (verilog vs. everything else) when the tool is
 * unknown or declares no patterns of its own, which is how dependency parsing
 * worked before this registry. A tool that really has no include directives
 * says so with an explicit empty list.
 */
export function getIncludePatterns(tool: string, platform?: string): (RegExp | ToolIncludePattern)[] {
  let meta = tool && getToolMeta(tool);
  if (meta && meta.includePatterns) return meta.includePatterns;
  if (platform && platform.startsWith('verilog')) return VERILOG_INCLUDE_PATTERNS;
  return SHARED_INCLUDE_PATTERNS;
}

/**
 * Format a list of preprocessor/assembler defines as argv for a tool, using
 * the flag and joining style declared in its ToolMeta. Returns [] when the
 * tool has no command-line define mechanism (e.g. sdasz80).
 */
export function defineArgs(tool: string, defines?: string[]): string[] {
  let meta = tool && getToolMeta(tool);
  if (!meta || !meta.defineFlag || !defines || !defines.length) return [];
  let out: string[] = [];
  for (let d of defines) {
    if (meta.defineInline) out.push(meta.defineFlag + d);
    else out.push(meta.defineFlag, d);
  }
  return out;
}

/**
 * Format link-time global symbols as argv for a linker tool, using the flag
 * declared in its ToolMeta ('-D' for ld65, '-g' for sdldz80). Returns [] when
 * the tool cannot define symbols on the command line.
 */
export function linkSymbolArgs(tool: string, symbols?: string[]): string[] {
  let meta = tool && getToolMeta(tool);
  if (!meta || !meta.linkSymbolFlag || !symbols || !symbols.length) return [];
  let out: string[] = [];
  for (let s of symbols) {
    if (meta.linkSymbolInline) out.push(meta.linkSymbolFlag + s);
    else out.push(meta.linkSymbolFlag, s);
  }
  return out;
}

/**
 * Extra raw args from params.buildArgs for the phase matching the tool's kind
 * (compiler/assembler/linker). Interpreter/hdl/remote tools get nothing.
 */
export function extraArgsFor(tool: string, buildArgs?: BuildArgs): string[] {
  let meta = tool && getToolMeta(tool);
  if (!meta || !buildArgs) return [];
  let kind = meta.kind;
  if (kind === 'compiler' || kind === 'assembler' || kind === 'linker')
    return buildArgs[kind] || [];
  return [];
}

/** Link patterns ("//#link") to use when scanning a source file. */
export function getLinkPatterns(tool: string, platform?: string): (RegExp | ToolIncludePattern)[] {
  let meta = tool && getToolMeta(tool);
  if (meta && meta.linkPatterns) return meta.linkPatterns;
  if (platform && platform.startsWith('verilog')) return [];
  return SHARED_LINK_PATTERNS;
}

/**
 * True if "//#link" dependencies are compiled together with the main source in
 * one tool invocation (single-pass compilers like oscar64) rather than built
 * separately and linked. The build message then carries them as `linkfiles`
 * on the main step so the tool can pass them all to one invocation.
 */
export function getCompileLinkedSources(tool: string): boolean {
  let meta = tool && getToolMeta(tool);
  return !!(meta && meta.compileLinkedSources);
}

/**
 * Directories containing shared code (headers etc.) for this tool's shared
 * filesystem, e.g. ['/include','/asminc','/headers'] -- empty if none/unknown.
 */
export function getIncludeDirs(tool: string, platform_id: string): string[] {
  platform_id = platform_id && getRootBasePlatform(platform_id);
  let meta = tool && getToolMeta(tool);
  let out = (meta && meta.includeDirs) || [];
  out = out.map(s => s.replace('$platform', platform_id));
  return out;
}

/**
 * Name of the shared filesystem to query for this tool's bundled files:
 * either the emscripten preloadFS package name (e.g. 'sdcc') or, for tools
 * with a WASI filesystem zip (e.g. cc2600), 'wasi:<zipname>'.
 * Undefined if the tool has no bundled filesystem.
 */
export function getSharedFileSystemName(tool: string, platform?: string): string | undefined {
  var fsName = getPreloadFSName(tool, platform);
  if (fsName) return fsName;
  let config = getPlatformToolConfig(tool, platform);
  if (config && config.wasiFSZip) return 'wasi:' + config.wasiFSZip;
  let meta = tool && getToolMeta(tool);
  return (meta && meta.wasiFSZip) ? 'wasi:' + meta.wasiFSZip : undefined;
}

/**
 * Run a set of include/link patterns over source text, returning the
 * referenced filenames. The filename comes from the pattern's `group`, or
 * from the last capture group if unspecified, plus any implicit `suffix`.
 */
export function matchDependencyPatterns(text: string, patterns: (RegExp | ToolIncludePattern)[]): string[] {
  let files: string[] = [];
  let lines = text.split('\n');
  for (let pat of patterns || []) {
    let p: ToolIncludePattern = pat instanceof RegExp ? { re: pat } : pat;
    for (let line of lines) {
      let m;
      p.re.lastIndex = 0; // patterns are shared and global, so rewind first
      // matched per line, not over the whole file, so the `^`+`m`+`g`
      // anchored patterns don't make the regex engine recurse (on its
      // native call stack) at every line of a large source file
      while (m = p.re.exec(line)) {
        let fn = m[p.group != null ? p.group : m.length - 1];
        if (fn) files.push(p.suffix ? fn + p.suffix : fn);
      }
    }
  }
  return files;
}
