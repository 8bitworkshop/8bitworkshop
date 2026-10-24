// detect - guesses the platform, main file, and tool for a directory of
// source files. No DOM, no Node, no vscode: the CLI, the VS Code extension,
// and the IDE all call it. Every guess carries the evidence behind it, so a
// host can show why it picked a platform and a wrong guess is easy to fix.

import { getToolForPlatform } from "./toolselect";
import { TOOL_META, getIncludePatterns, getLinkPatterns, matchDependencyPatterns } from "./toolmeta";

export interface DetectEvidence {
  file: string;
  line?: number;
  reason: string;
  /**
   * "code" for a program's own source or build file; "rom" for a ROM
   * image; "hint" for a header, a linker config, or the folder's name.
   */
  kind?: 'code' | 'rom' | 'hint';
}

export interface Detection {
  platform: string;
  /** set when one file stands out; unset for a directory of programs */
  mainFile?: string;
  /** set when the main file's dialect needs a tool toolselect wouldn't pick */
  tool?: string;
  /** 0..1 */
  score: number;
  /** the uncapped total the ranking uses */
  weight?: number;
  evidence: DetectEvidence[];
  /** the files that look like programs, best first */
  mainCandidates?: string[];
  /** set when a program's own source or build file points here, not just hints */
  hasCode?: boolean;
}

export interface DetectInput {
  /** paths relative to the directory, posix separators; may include subdirectories */
  files: string[];
  /** a file's text, or null if unreadable or binary */
  read(path: string): Promise<string | null> | string | null;
  /** platform ids to consider (base ids, like "nes" or "c64") */
  platforms: string[];
  /** header file name -> platforms whose presets have it (see headersFromPresets) */
  headers?: { [header: string]: string[] };
  /** the directory's own name, a weak hint ("nes", "c64") */
  dirName?: string;
}

/** ROM extensions that name exactly one platform. */
export const ROM_PLATFORMS: { [ext: string]: string } = {
  '.nes': 'nes', '.gb': 'gb', '.gbc': 'gb', '.a26': 'vcs', '.a78': 'atari7800',
  '.sms': 'sms', '.col': 'coleco', '.vec': 'vector',
};

// Headers the toolchains ship (not in presets/), and the platforms they mean.
const SYSTEM_HEADERS: { [header: string]: string[] } = {
  'nes.h': ['nes'],
  'neslib.h': ['nes'],
  'apu.h': ['nes'],
  'cv.h': ['coleco', 'msx-libcv', 'sms-sg1000-libcv', 'sms-sms-libcv', 'sms-gg-libcv'],
  'cvu.h': ['coleco', 'msx-libcv', 'sms-sg1000-libcv', 'sms-sms-libcv', 'sms-gg-libcv'],
  'c64.h': ['c64'],
  'vic20.h': ['vic20'],
  'cbm.h': ['c64', 'vic20'],
  'apple2.h': ['apple2'],
  'apple2enh.h': ['apple2'],
  'atari.h': ['atari8-800'],
  'atari5200.h': ['atari8-5200'],
  'atari7800.h': ['atari7800'],
  'pce.h': ['pce'],
  'gb/gb.h': ['gb'],
  'gb.h': ['gb'],
  'gbtext.h': ['gb'],
  'vcs.h': ['vcs'],
  'macro.h': ['vcs'],
  'vectrex.h': ['vectrex'],
};

// cc65 targets (cl65 -t / --target) and the platforms they build for
const CC65_TARGETS: { [target: string]: string } = {
  'nes': 'nes', 'c64': 'c64', 'vic20': 'vic20', 'apple2': 'apple2', 'apple2enh': 'apple2',
  'atari': 'atari8-800', 'atari5200': 'atari8-5200', 'atari7800': 'atari7800',
  'atari2600': 'vcs', 'pce': 'pce',
};

// Hardware names and addresses that give away a platform in source code.
const FINGERPRINTS: { re: RegExp, platforms: string[], reason: string }[] = [
  { re: /\b(RESP0|RESP1|GRP0|GRP1|COLUBK|COLUPF|HMOVE|ENAM0|ENABL|PF0|PF1|PF2)\b/, platforms: ['vcs'], reason: 'uses Atari 2600 TIA registers' },
  { re: /\b(PPUCTRL|PPUMASK|PPUSTATUS|PPUADDR|PPUDATA|OAMDMA|OAMADDR)\b/, platforms: ['nes'], reason: 'uses NES PPU registers' },
  { re: /\.segment\s+"(HEADER|CHARS|VECTORS|STARTUP)"[\s\S]*\.segment\s+"(HEADER|CHARS)"/, platforms: ['nes'], reason: 'has NES cartridge segments' },
  { re: /\$[dD]02[01]\b|\bVIC_|\bVIC\./, platforms: ['c64', 'vic20'], reason: 'writes the VIC registers' },
  { re: /\$[cC]030\b|\bCOUT\b/, platforms: ['apple2'], reason: 'uses Apple II soft switches or ROM calls' },
  { re: /\b(SDLSTL|COLPF[0-4]|DLISTL|ANTIC\.)\b|\$[dD]40[aA]\b/, platforms: ['atari8-800', 'atari8-5200'], reason: 'uses Atari 8-bit ANTIC/GTIA registers' },
  { re: /\bdisplay_off\(\)|\bSHOW_BKG\b|\bset_bkg_data\b/, platforms: ['gb'], reason: 'calls GBDK functions' },
  { re: /\bWait_Recal\b|\bIntensity_[0-9a-z]+\b/, platforms: ['vectrex'], reason: 'calls Vectrex BIOS routines' },
  // urust programs name one of rs8's per-platform register modules
  { re: /\brs8::nes\b/, platforms: ['nes'], reason: 'uses the rs8 NES library' },
  { re: /\brs8::vcs\b/, platforms: ['vcs'], reason: 'uses the rs8 Atari 2600 library' },
  { re: /\brs8::c64\b/, platforms: ['c64'], reason: 'uses the rs8 C64 library' },
  { re: /\brs8::atari8\b/, platforms: ['atari8-800', 'atari8-5200'], reason: 'uses the rs8 Atari 8-bit library' },
  { re: /\brs8::apple2\b/, platforms: ['apple2'], reason: 'uses the rs8 Apple II library' },
  { re: /\brs8::vic20\b/, platforms: ['vic20'], reason: 'uses the rs8 VIC-20 library' },
  { re: /\brs8::zx\b/, platforms: ['zx'], reason: 'uses the rs8 ZX Spectrum library' },
];

const HEADER_EXTS = ['.h', '.inc', '.i'];
const C_EXTS = ['.c', '.cpp'];
// a register or function name in a header is a declaration, not a use, so
// it points at the library rather than at a program written for the platform
const HEADER_FINGERPRINT_WEIGHT = 0.15;
// extensions so many tools use that they say nothing about the platform
const GENERIC_EXTS = ['.c', '.h', '.s', '.asm', '.a', '.inc', '.i', '.bas'];

/** The README badge the IDE writes when it pushes a repo to GitHub. */
export function parseReadmeBadge(readme: string): { platform: string, mainFile?: string } | null {
  var plat = /8bitworkshop\.com[^)\s]+platform=([A-Za-z0-9._\-]+)/.exec(readme);
  if (!plat) return null;
  var main = /8bitworkshop\.com[^)\s]+file=([^)&\s]+)/.exec(readme);
  return { platform: plat[1], mainFile: main ? decodeURIComponent(main[1]) : undefined };
}

/**
 * file name -> platforms whose presets have it, for recognizing includes
 * (headers, and assembler files like nesdefs.dasm). `listing` maps each
 * preset directory (a platform id) to the files in it.
 */
export function headersFromPresets(listing: { [platform: string]: string[] }): { [header: string]: string[] } {
  var table: { [header: string]: string[] } = {};
  for (var platform in listing) {
    for (var fn of listing[platform]) {
      if (fn.endsWith('~') || fn.startsWith('skeleton.') || !extname(fn)) continue;
      (table[fn] = table[fn] || []).push(platform);
    }
  }
  return table;
}

/**
 * The assembler a source file is written for, from its directives, or null
 * when nothing gives it away.
 */
export function detectDialect(text: string): string | null {
  if (/^\s*\.(segment|proc|endproc|importzp|exportzp|import|export|zeropage|scope)\b/m.test(text)) return 'ca65';
  if (/^\s+(processor\s+6502|seg(\.u)?\s+\w+)/mi.test(text)) return 'dasm';
  if (/^\s*!(to|cpu|source|binary)\b/m.test(text)) return 'acme';
  if (/^\s*\.(area|globl|module)\b/m.test(text)) return 'sdasz80';
  return null;
}

/**
 * If the text's dialect needs a different tool than toolselect picks for
 * this file on this platform, that tool; else undefined. Only tools the
 * platform builds with some extension count.
 */
export function toolForDialect(platform: string, file: string, text: string): string | undefined {
  var dialect = detectDialect(text);
  if (!dialect) return undefined;
  var chosen = getToolForPlatform(platform, file);
  if (chosen === dialect) return undefined;
  // sdasz80 on a gbz80 platform is sdasgb; don't second-guess that
  if (dialect === 'sdasz80' && /^sdas/.test(chosen)) return undefined;
  var meta = TOOL_META[dialect];
  var exts = meta && meta.extensions || [];
  if (!exts.some(ext => getToolForPlatform(platform, 'x' + ext) === dialect)) return undefined;
  return dialect;
}

/** True if some tool builds files with this name's extension. */
export function isBuildableSource(fn: string): boolean {
  var ext = extname(fn);
  if (!ext || HEADER_EXTS.includes(ext)) return false;
  if (ext === '.asm' || ext === '.a') return true;
  for (var id in TOOL_META)
    if ((TOOL_META[id].extensions || []).includes(ext)) return true;
  return false;
}

/**
 * Ranked platform guesses for a directory, each with its evidence.
 * Empty when nothing points anywhere.
 */
export async function detectProject(input: DetectInput): Promise<Detection[]> {
  var scores = new Map<string, Detection>();
  var raw = new Map<string, number>();
  var platforms = new Set(input.platforms);
  // each kind of evidence counts once per platform, however many files show it
  var add = (platform: string, score: number, ev: DetectEvidence) => {
    if (!platforms.has(platform)) return;
    var d = scores.get(platform);
    if (!d) scores.set(platform, d = { platform, score: 0, evidence: [] });
    if (d.evidence.some(e => e.reason === ev.reason)) return;
    if (ev.kind === 'code') d.hasCode = true;
    raw.set(platform, (raw.get(platform) || 0) + score);
    if (d.evidence.length < 8) d.evidence.push(ev);
  };
  var addAll = (list: string[], total: number, ev: DetectEvidence) => {
    var hits = list.filter(p => platforms.has(p));
    for (var p of hits) add(p, total / hits.length, ev);
  };
  var texts = new Map<string, string>();

  // the README badge names the platform and main file outright
  var readme = input.files.find(f => /^readme(\.md)?$/i.test(f));
  if (readme) {
    var badge = parseReadmeBadge((await input.read(readme)) || '');
    if (badge) {
      return [{
        platform: badge.platform, mainFile: badge.mainFile, score: 1, hasCode: true,
        evidence: [{ file: readme, reason: 'has an 8bitworkshop link naming the platform', kind: 'code' }],
      }];
    }
  }

  var headers = { ...(input.headers || {}) };
  for (var h in SYSTEM_HEADERS) headers[h] = SYSTEM_HEADERS[h];

  for (var file of input.files) {
    var ext = extname(file);
    var rom = ROM_PLATFORMS[ext];
    if (rom) add(rom, 0.6, { file, reason: `is a ${ext} ROM`, kind: 'rom' });
    var base = basename(file);
    if (/^makefile$/i.test(base) || ext === '.mk') {
      var mk = await input.read(file);
      var m = mk && /(?:\s-t\s+|--target[\s=]+)([a-z0-9]+)/.exec(mk);
      if (m && CC65_TARGETS[m[1]]) add(CC65_TARGETS[m[1]], 0.6, { file, reason: `builds for the cc65 "${m[1]}" target`, kind: 'code' });
      continue;
    }
    if (ext === '.cfg' && CC65_TARGETS[base.replace(/\.cfg$/, '')]) {
      add(CC65_TARGETS[base.replace(/\.cfg$/, '')], 0.3, { file, reason: 'is a cc65 linker config', kind: 'hint' });
      continue;
    }
    if (!isBuildableSource(file) && !HEADER_EXTS.includes(ext)) continue;
    var text = await input.read(file);
    if (text == null) continue;
    texts.set(file, text);
    // a header declares things for programs; it isn't one
    var kind: DetectEvidence['kind'] = HEADER_EXTS.includes(ext) ? 'hint' : 'code';
    // includes, with their line numbers for the evidence. Quoted (C, ca65),
    // angle-bracketed (C), or bare (DASM, bB) -- name is whichever matched.
    var re = /^[ \t]*[#.]?[ \t]*include\s+(?:"([^"]+)"|<([^>]+)>|([^\s;]+))/gim;
    var inc: RegExpExecArray | null;
    while ((inc = re.exec(text)) != null) {
      var name = inc[1] || inc[2] || inc[3];
      // a local copy of a library header (neslib.h) still counts
      var list = headers[name] || headers[basename(name)];
      if (!list) continue;
      var line = text.substring(0, inc.index).split('\n').length;
      // a header a family shares (cv.h) points at each member, less strongly
      var weight = 0.6 / Math.sqrt(list.length);
      for (var p of list) add(p, weight, { file, line, reason: `includes "${name}"`, kind });
    }
    for (var fp of FINGERPRINTS) {
      var fm = fp.re.exec(text);
      if (fm) {
        var fline = text.substring(0, fm.index).split('\n').length;
        var fweight = HEADER_EXTS.includes(ext) ? HEADER_FINGERPRINT_WEIGHT : 0.5;
        addAll(fp.platforms, fweight, { file, line: fline, reason: fp.reason, kind });
      }
    }
  }

  // extensions only a few platforms build narrow it down
  for (var file of input.files) {
    if (!isBuildableSource(file)) continue;
    var ext = extname(file);
    if (GENERIC_EXTS.includes(ext)) continue;
    var accepting = input.platforms.filter(p => {
      var tool = getToolForPlatform(p, file);
      var meta = tool && TOOL_META[tool.replace(/^remote:/, '')];
      return meta && (meta.extensions || []).includes(ext);
    });
    if (accepting.length > 0 && accepting.length <= 3)
      addAll(accepting, 0.5, { file, reason: `has the ${ext} extension`, kind: 'code' });
  }

  if (input.dirName && platforms.has(input.dirName))
    add(input.dirName, 0.2, { file: '.', reason: `is in a folder named "${input.dirName}"`, kind: 'hint' });

  var result = [...scores.values()];
  // rank on the uncapped total, so two strong candidates still differ
  result.sort((a, b) => raw.get(b.platform) - raw.get(a.platform) || a.platform.localeCompare(b.platform));
  for (var d of result) {
    d.weight = Math.round(raw.get(d.platform) * 100) / 100;
    d.score = Math.min(1, d.weight);
  }
  // main file and dialect for the leader and anyone close to it
  for (var d of result) {
    if (d.weight < result[0].weight - 0.2) break;
    var mains = findMainCandidates(d.platform, input.files, texts);
    d.mainCandidates = mains.candidates;
    d.mainFile = mains.mainFile;
    if (d.mainFile && texts.has(d.mainFile))
      d.tool = toolForDialect(d.platform, d.mainFile, texts.get(d.mainFile));
  }
  return result;
}

/** A clear winner: strong enough, and well ahead of the next. */
export function isClearWinner(detections: Detection[]): boolean {
  if (!detections.length || detections[0].score < 0.5) return false;
  var w = (d: Detection) => d.weight ?? d.score;
  // weights are rounded for display, so allow for the rounding error when the
  // lead lands exactly on the threshold (e.g. a 0.2 folder-name hint)
  return detections.length == 1 || w(detections[0]) - w(detections[1]) >= 0.2 - 1e-9;
}

/**
 * Strong enough to bring up unasked, on opening a folder: a high score,
 * and at least some of it from a program's own code. Headers, linker
 * configs, ROMs, and folder names alone don't make a project.
 */
export function isStrongDetection(d: Detection): boolean {
  return d.score >= 0.5 && !!d.hasCode;
}

/**
 * How a directory counts when scanning a folder for projects: "project"
 * for a strong, clear detection; "potential" for weaker or ambiguous
 * evidence around something to build or run, which is offered only when
 * the user asks; undefined for nothing worth mentioning.
 */
export function classifyFinding(detections: Detection[]): 'project' | 'potential' | undefined {
  var d = detections[0];
  if (!d) return undefined;
  if (isStrongDetection(d) && isClearWinner(detections)) return 'project';
  var runnable = !!d.mainFile || (d.mainCandidates?.length || 0) > 0 || d.evidence.some(e => e.kind === 'rom');
  if (runnable && d.score > 0.1) return 'potential';
  return undefined;
}

/** A directory's finding in a folder scan; `dir` is relative, with posix separators, '' for the folder itself. */
export interface DirFinding {
  dir: string;
  detection: Detection;
  potential?: boolean;
}

function isInsideDir(parent: string, child: string): boolean {
  return parent !== child && (parent === '' || child.startsWith(parent + '/'));
}

/**
 * Drop findings that belong to another: anything inside a project with a
 * main file (its code and data folders), and a library folder inside a
 * folder of programs. A nested project with its own main file stays.
 */
export function dropNestedFindings<T extends DirFinding>(findings: T[]): T[] {
  return findings.filter(f => !findings.some(p => isInsideDir(p.dir, f.dir) && (
    (!p.potential && !!p.detection.mainFile) ||
    (isFolderOfPrograms(p.detection) && !f.detection.mainFile))));
}

// unasked, this many projects anywhere in a folder is still worth a prompt
const FEW_PROJECTS = 5;

/**
 * True if a folder is made of projects, so a prompt nobody asked for is
 * welcome: a few projects, or projects in at least half its top-level
 * folders (a folder of cloned repos). Projects scattered through a big
 * codebase don't count. `allDirs` is every directory the scan saw.
 */
export function isMadeOfProjects(projectDirs: string[], allDirs: string[]): boolean {
  if (projectDirs.length <= FEW_PROJECTS) return true;
  var top = (d: string) => d.split('/')[0];
  var tops = new Set(allDirs.filter(d => d).map(top));
  var covered = new Set(projectDirs.filter(d => d).map(top));
  return covered.size * 2 >= tops.size;
}

/** True for a header or include file: a declaration, not a program. */
export function isHeaderFile(fn: string): boolean {
  return HEADER_EXTS.includes(extname(fn));
}

/** The clue to show first: a program source's, unless only a header matches. */
export function mainEvidence(d: Detection): DetectEvidence | undefined {
  return d.evidence.find(e => e.file !== '.' && !isHeaderFile(e.file)) || d.evidence[0];
}

/** "game.c", or "26 programs" for a directory of programs. */
export function detectionSummary(d: Detection): string {
  if (d.mainFile) return d.mainFile;
  var n = d.mainCandidates?.length || 0;
  return n > 1 ? `${n} programs` : '';
}

/** True for a directory that holds several programs and no single main file. */
export function isFolderOfPrograms(d: Detection): boolean {
  return !d.mainFile && (d.mainCandidates?.length || 0) > 1;
}

/** A one-line description of the clue behind a detection. */
export function describeDetection(d: Detection): string {
  var ev = mainEvidence(d);
  if (!ev) return '';
  return `${ev.file === '.' ? 'folder' : ev.file}${ev.line ? ':' + ev.line : ''} ${ev.reason}`;
}

/** The clue, and for a folder of programs the number of programs it holds. */
export function describeFinding(d: Detection): string {
  var text = describeDetection(d);
  if (isFolderOfPrograms(d)) {
    var n = d.mainCandidates!.length;
    text = `${n} programs${text ? ' — ' + text : ''}`;
  }
  return text;
}

/**
 * The files that look like programs: buildable sources no other file
 * includes or links. `mainFile` is set when one stands out; when several
 * are equally likely (each has its own main()), it's a directory of
 * programs and stays unset.
 */
export function findMainCandidates(platform: string, files: string[], texts: Map<string, string>):
  { candidates: string[], mainFile?: string } {
  var used = new Set<string>();
  for (var [file, text] of texts) {
    var tool = getToolForPlatform(platform, file);
    var deps = matchDependencyPatterns(text, getIncludePatterns(tool, platform))
      .concat(matchDependencyPatterns(text, getLinkPatterns(tool, platform)));
    for (var dep of deps) used.add(dep);
  }
  // a crt0 is the startup code a toolchain links in, not a program; a C
  // program has a main(), so C without one is a library
  var isProgram = (f: string) => !/^crt0\b/i.test(basename(f))
    && (!C_EXTS.includes(extname(f)) || /\bmain\s*\(/.test(texts.get(f)));
  var candidates = files.filter(f => isBuildableSource(f) && texts.has(f) && !used.has(f) && !used.has(basename(f)) && isProgram(f));
  var rank = (f: string) => {
    var t = texts.get(f) || '';
    var r = 0;
    if (/^main\./i.test(basename(f))) r += 4;
    if (/\bmain\s*\(/.test(t)) r += 2;
    if (/\b(reset|start)\s*:|\.org\s+\$?[fF][fF][fF][aAcC]|\bRESET\b/i.test(t)) r += 1;
    return r;
  };
  candidates.sort((a, b) => rank(b) - rank(a) || a.localeCompare(b));
  if (candidates.length <= 1) return { candidates, mainFile: candidates[0] };
  var top = rank(candidates[0]), next = rank(candidates[1]);
  return { candidates, mainFile: top > next ? candidates[0] : undefined };
}

function extname(fn: string): string {
  var base = basename(fn);
  var i = base.lastIndexOf('.');
  return i > 0 ? base.substring(i).toLowerCase() : '';
}

function basename(fn: string): string {
  return fn.substring(fn.lastIndexOf('/') + 1);
}
