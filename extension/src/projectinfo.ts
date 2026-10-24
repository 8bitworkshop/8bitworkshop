
// projectinfo - file and path helpers with no side effects, safe to load in
// the extension host (unlike buildcore, whose worker imports set globals).
// projectFor() decides which project owns a file; it takes settings as plain
// data so tests can drive it without VS Code.

import * as fs from 'fs';
import * as path from 'path';
import { TOOL_META, urustPlatformName } from "../../src/common/toolmeta";
import { getToolForPlatform } from "../../src/common/toolselect";
import { RUST_LANGUAGE } from './rustsyntax';

/** Tools that build on the 8bitworkshop server ("remote:llvm-mos"). Off for now. */
export const REMOTE_BUILDS = false;

var sourceExtensions: Set<string>;

/** True if some tool consumes files with this name's extension. */
export function isSourceFile(fn: string): boolean {
  if (!sourceExtensions) {
    sourceExtensions = new Set(['.asm', '.a', '.inc', '.h', '.s', '.c', '.bas']);
    for (var id in TOOL_META)
      for (var ext of TOOL_META[id].extensions || [])
        sourceExtensions.add(ext.toLowerCase());
  }
  return sourceExtensions.has(path.extname(fn).toLowerCase());
}

// extensions many other tools and extensions use too. .rs belongs to the
// installed Rust extension (rust-analyzer), never to ours.
const SHARED_EXTENSIONS = new Set(['.c', '.h', '.s', '.asm', '.a', '.inc', '.bas', '.v', '.cpp', '.cc', '.i', '.rs']);

/** True for extensions only 8bitworkshop's tools use (.dasm, .ca65, ...). */
export function isOwnExtension(fn: string): boolean {
  var ext = path.extname(fn).toLowerCase();
  return isSourceFile(fn) && !SHARED_EXTENSIONS.has(ext);
}

// assembler extensions several CPUs share; package.json leaves them unclaimed
const SHARED_ASM_EXTENSIONS = new Set(['.s', '.asm', '.inc', '.a']);

/** CPUs with an 8bws-<cpu> language (syntaxgen's ASM_LANGUAGES). */
export const ASM_LANGUAGE_CPUS = ['6502', 'z80', '6809'];

/** The 8bws-<cpu> language for a shared assembler extension on `platform`, if it has one. */
export function asmLanguageFor(fn: string, platform: string): string | undefined {
  if (!SHARED_ASM_EXTENSIONS.has(path.extname(fn).toLowerCase())) return undefined;
  var style = TOOL_META[getToolForPlatform(platform, fn)]?.editorStyle;
  return ASM_LANGUAGE_CPUS.includes(style) ? '8bws-' + style : undefined;
}

/** The 8bws-verilog language for a .v file on a Verilog platform. */
export function verilogLanguageFor(fn: string, platform: string): string | undefined {
  if (path.extname(fn).toLowerCase() !== '.v') return undefined;
  return TOOL_META[getToolForPlatform(platform, fn)]?.editorStyle === 'verilog' ? '8bws-verilog' : undefined;
}

/**
 * The fallback 8bws-rust language for a .rs file on a urust platform. It is
 * assigned only when the document opened as plaintext -- that is, when no
 * installed Rust extension claimed .rs; with rust-analyzer, VS Code's own
 * `rust` language and grammar stay in charge.
 */
export function rustLanguageFor(fn: string, platform: string): string | undefined {
  if (path.extname(fn).toLowerCase() !== '.rs') return undefined;
  // .rs selects urust on every 6502/Z80 platform, but urust only has
  // targets for some of them (see URUST_PLATFORM_NAMES)
  if (!urustPlatformName(platform)) return undefined;
  return TOOL_META[getToolForPlatform(platform, fn.toLowerCase())]?.editorStyle === 'rust' ? RUST_LANGUAGE.id : undefined;
}

/** The language to assign a shared-extension file in a project on `platform`, if any. */
export function languageFor(fn: string, platform: string): string | undefined {
  return asmLanguageFor(fn, platform) ?? verilogLanguageFor(fn, platform) ?? rustLanguageFor(fn, platform);
}

/** Headers and include files: never a main file. */
export function isHeaderFile(fn: string): boolean {
  return /\.(h|inc|i)$/i.test(fn);
}

/** The asset root: a directory with src/worker, searched upward from `start`. */
export function findRootDir(start: string): string | null {
  var dir = path.resolve(start);
  for (var i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'src', 'worker', 'wasm'))) return dir;
    var parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

////// projects

/** One project's settings: top-level, or one entry of 8bitworkshop.folders. */
export interface ProjectSettings {
  platform?: string;
  mainFile?: string;
  tool?: string;
}

/** What projectFor needs to know about one workspace folder. */
export interface FolderInfo {
  /** the workspace folder's path */
  path: string;
  /** 8bitworkshop.platform / mainFile / tool */
  settings: ProjectSettings;
  /** 8bitworkshop.folders: directory relative to the folder -> settings */
  folders?: { [dir: string]: ProjectSettings };
  /** the README badge, if the folder's README has one */
  readme?: { platform: string, mainFile?: string };
}

export type ProjectOrigin = 'folders' | 'settings' | 'readme' | 'window' | 'build';

export interface Project {
  /** files under this directory belong to the project */
  scope: string;
  /** the main file's directory, which include paths resolve from */
  root: string;
  platform: string;
  /** absolute; unset for a directory of programs */
  mainFile?: string;
  tool?: string;
  origin: ProjectOrigin;
  /** the workspace folder that holds its settings, if any */
  folder?: string;
  /** its key in 8bitworkshop.folders, when origin is 'folders' */
  folderKey?: string;
}

export interface ProjectContext {
  folders: FolderInfo[];
  /** choices made in a window with no folder */
  window?: Project[];
  /** the last builds: a file one read belongs to its project */
  builds?: { project: Project, paths: string[] }[];
}

/** True if `file` is `dir` or under it. */
export function isInside(dir: string, file: string): boolean {
  var rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function makeProject(scope: string, s: ProjectSettings, origin: ProjectOrigin, folder?: string, folderKey?: string): Project {
  var mainFile = s.mainFile ? path.resolve(scope, s.mainFile) : undefined;
  return {
    scope, root: mainFile ? path.dirname(mainFile) : scope,
    platform: s.platform, mainFile, tool: s.tool || undefined,
    origin, folder, folderKey,
  };
}

/** Every project the settings describe, most specific first. */
export function listProjects(ctx: ProjectContext): Project[] {
  var out: Project[] = [];
  for (var f of ctx.folders) {
    var keys = Object.keys(f.folders || {}).sort((a, b) => b.length - a.length);
    for (var key of keys) {
      var s = f.folders[key];
      if (s && s.platform) out.push(makeProject(path.resolve(f.path, key), s, 'folders', f.path, key));
    }
    if (f.settings.platform) out.push(makeProject(f.path, f.settings, 'settings', f.path));
    else if (f.readme) out.push(makeProject(f.path, f.readme, 'readme', f.path));
  }
  return out;
}

/**
 * A folder's settings with project `p` removed: the settings and folders to
 * persist. Undefined when `p` isn't stored in this folder -- it comes from a
 * README badge, a window with no folder, or another folder. A top-level
 * project clears the folder's settings; a subproject drops its `folders` entry.
 */
export function withoutProject(folder: FolderInfo, p: Project): { settings: ProjectSettings, folders: { [dir: string]: ProjectSettings } } | undefined {
  if (p.folder !== folder.path) return undefined;
  if (p.origin === 'settings') return { settings: {}, folders: folder.folders || {} };
  if (p.origin === 'folders' && p.folderKey) {
    var folders = { ...(folder.folders || {}) };
    delete folders[p.folderKey];
    return { settings: folder.settings, folders };
  }
  return undefined;
}

/**
 * The project that owns `file`, or undefined if it isn't ours. In order: the
 * most specific 8bitworkshop.folders entry, the folder's settings, its README
 * badge, a choice made in a window with no folder, then the last build that
 * read the file.
 */
export function projectFor(file: string, ctx: ProjectContext): Project | undefined {
  file = path.resolve(file);
  var best: Project | undefined;
  for (var p of listProjects(ctx)) {
    if (!isInside(p.scope, file)) continue;
    // the deepest scope wins, then the order listProjects gives
    if (!best || p.scope.length > best.scope.length) best = p;
  }
  if (best) return best;
  for (var w of ctx.window || []) {
    if (isInside(w.scope, file)) return w;
  }
  for (var b of ctx.builds || []) {
    if (b.paths.some(p => path.resolve(p) === file)) return b.project;
  }
  return undefined;
}

////// run target

/** Stored per user: a file to run, or 'follow' for the active editor. */
export type RunTargetChoice = string | 'follow' | undefined;

/**
 * The file Build and Run use. A stored choice wins while its file is in the
 * project; 'follow', or a project with no main file, uses the active editor
 * when it could be a program, else the last target.
 */
export function resolveRunTarget(project: Project, choice: RunTargetChoice,
  active: string | undefined, last: string | undefined, isDependency: (file: string) => boolean): string | undefined {
  if (choice && choice !== 'follow') {
    var chosen = path.resolve(project.root, choice);
    if (isInside(project.scope, chosen)) return chosen;
  }
  if (choice === 'follow' || !project.mainFile) {
    if (active && isInside(project.scope, active) && isSourceFile(active) && !isHeaderFile(active) && !isDependency(active))
      return active;
    return last || project.mainFile;
  }
  return project.mainFile;
}
