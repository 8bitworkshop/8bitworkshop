
// projectcore - build logic shared by the IDE (CodeProject), the CLI
// (testlib), and the VS Code extension: dependency resolution, worker-message
// assembly, and build-result post-processing. No DOM, no fs, no Worker;
// callers supply file access through a FileProvider.

import { getFilenameForPath, getFilenamePrefix, getFolderForPath } from "./util";
import { getCompileLinkedSources, getIncludePatterns, getLinkPatterns, matchDependencyPatterns } from "./toolmeta";
import { BuildArgLists, BuildSymbolLists, CodeListing, CodeListingMap, Dependency, FileData, Segment, SourceFile, SourceLine, WorkerBuildStep, WorkerItemUpdate, WorkerMessage } from "./workertypes";

export interface FileProvider {
  /** Return file contents, or null if missing. The search order is the provider's. */
  readFile(path: string): Promise<FileData | null>;
}

/** Remove the main file's folder from `path`; the worker sees paths relative to it. */
export function stripLocalPath(path: string, mainPath: string): string {
  if (mainPath) {
    var folder = getFolderForPath(mainPath);
    // TODO: kinda weird if folder is same name as file prefix
    if (folder != '' && path.startsWith(folder + '/')) {
      path = path.substring(folder.length + 1);
    }
  }
  return path;
}

/** Paths to try for a file named by a directive in `fromPath`, most specific first. */
export function candidatePaths(fn: string, fromPath: string): string[] {
  var dir = getFolderForPath(fromPath);
  if (dir.length > 0 && dir != 'local') // TODO
    return [dir + '/' + fn, fn];
  return [fn];
}

/**
 * The files a source names in its include and link directives. Patterns come
 * from the tool registry (toolmeta.ts), keyed by `tool`; the platform is only
 * a fallback. Each entry is a list of candidate paths (see candidatePaths).
 */
export function parseDependencies(text: string, fromPath: string, tool: string, platformId: string):
  { includes: string[][]; links: string[][] } {
  var find = (patterns) => matchDependencyPatterns(text, patterns).map((fn) => candidatePaths(fn, fromPath));
  return {
    includes: find(getIncludePatterns(tool, platformId)),
    links: find(getLinkPatterns(tool, platformId)),
  };
}

/**
 * Every file the main file depends on, following includes of includes.
 * Breadth-first, so the main file's own dependencies keep their order. Each
 * file appears once, keyed by its stripped filename; the first candidate path
 * that exists wins. Included files are scanned with the tool of the file that
 * includes them; linked files with their own tool.
 */
export async function resolveDependencies(fp: FileProvider, mainPath: string, mainText: string,
  platformId: string, getToolForFilename: (path: string) => string): Promise<Dependency[]> {
  var result: Dependency[] = [];
  var seen = new Set<string>([stripLocalPath(mainPath, mainPath)]);
  var queue: { path: string, text: string, tool: string }[] = [
    { path: mainPath, text: mainText, tool: getToolForFilename(mainPath) }
  ];
  while (queue.length) {
    var { path: fromPath, text, tool } = queue.shift();
    var deps = parseDependencies(text, fromPath, tool, platformId);
    var named = deps.includes.map((c) => ({ candidates: c, link: false }))
      .concat(deps.links.map((c) => ({ candidates: c, link: true })));
    for (var { candidates, link } of named) {
      for (var path of candidates) {
        var filename = stripLocalPath(path, mainPath);
        if (seen.has(filename)) break;
        var data = await fp.readFile(path);
        if (data == null) continue;
        seen.add(filename);
        result.push({ path, filename, link, data });
        if (typeof data === 'string') {
          queue.push({ path, text: data, tool: link ? getToolForFilename(path) : tool });
        }
        break;
      }
    }
  }
  return result;
}

export interface BuildMessageSource {
  mainPath: string;
  mainData: FileData;
  platformId: string;
  /** may return "remote:<tool>" */
  getToolForFilename: (path: string) => string;
  symbols?: BuildSymbolLists;
  buildArgs?: BuildArgLists;
  dataItems?: WorkerItemUpdate[];
}

export interface BuildMessage {
  msg: WorkerMessage;
  /** stripped filename -> project path */
  filename2path: { [filename: string]: string };
  /** tools the build uses, for preloading */
  preloads: string[];
}

/**
 * Assemble the worker message for a build. The main file is one step; each
 * linked file is a step of its own, except for remote tools (which ship
 * everything in the main step) and single-pass tools like oscar64 (which
 * compile linked sources with the main file).
 */
export function buildWorkerMessage(src: BuildMessageSource, depends: Dependency[]): BuildMessage {
  var msg: WorkerMessage = { updates: [], buildsteps: [] };
  var filename2path = {};
  var preloads: string[] = [];
  var addPreload = (tool: string) => { if (tool && preloads.indexOf(tool) < 0) preloads.push(tool); };
  // TODO: add preproc directive for __MAINFILE__
  var mainfilename = stripLocalPath(src.mainPath, src.mainPath);
  msg.updates.push({ path: mainfilename, data: src.mainData });
  filename2path[mainfilename] = src.mainPath;
  var tool = src.getToolForFilename(src.mainPath);
  addPreload(tool);
  var usesRemoteTool = tool.startsWith('remote:');
  var compileLinkedSources = getCompileLinkedSources(tool);
  var depfiles: string[] = [];
  var linkfiles: string[] = [];
  for (var dep of depends) {
    if (!dep.link || usesRemoteTool || compileLinkedSources) {
      msg.updates.push({ path: dep.filename, data: dep.data });
      depfiles.push(dep.filename);
      if (dep.link && compileLinkedSources) linkfiles.push(dep.filename);
    }
    filename2path[dep.filename] = dep.path;
  }
  var mainstep: WorkerBuildStep = {
    path: mainfilename,
    files: [mainfilename].concat(depfiles),
    platform: src.platformId,
    tool: tool,
    mainfile: true,
  };
  if (linkfiles.length) mainstep.linkfiles = linkfiles;
  if (src.symbols) mainstep.symbols = src.symbols;
  if (src.buildArgs) mainstep.buildArgs = src.buildArgs;
  msg.buildsteps.push(mainstep);
  if (!usesRemoteTool && !compileLinkedSources) {
    for (var dep of depends) {
      if (dep.data && dep.link) {
        var linktool = src.getToolForFilename(dep.filename);
        addPreload(linktool);
        msg.updates.push({ path: dep.filename, data: dep.data });
        msg.buildsteps.push({
          path: dep.filename,
          files: [dep.filename].concat(depfiles),
          platform: src.platformId,
          tool: linktool,
        });
      }
    }
  }
  if (src.dataItems) msg.setitems = src.dataItems;
  return { msg, filename2path, preloads };
}

////// build results

/**
 * Attach SourceFile views to each listing. A single-pass tool (oscar64) emits
 * one listing that mixes source lines from the main file and every linked
 * library, each tagged with its own path; split those so each file can find
 * its own lines (see getListingForFile).
 */
export function processListings(listings: CodeListingMap) {
  if (!listings) return;
  for (var lstname in listings) {
    var lst = listings[lstname];
    if (lst.lines) {
      lst.sourcefile = new SourceFile(lst.lines, lst.text);
      var bypath: { [path: string]: SourceLine[] } = {};
      for (var info of lst.lines) {
        var p = info.path || '';
        (bypath[p] || (bypath[p] = [])).push(info);
      }
      var paths = Object.keys(bypath);
      if (paths.length > 1 || (paths.length == 1 && paths[0] != '')) {
        lst.sourcefiles = {};
        for (var p of paths)
          lst.sourcefiles[p] = new SourceFile(bypath[p], lst.text);
      }
    }
    if (lst.asmlines)
      lst.assemblyfile = new SourceFile(lst.asmlines, lst.text);
  }
}

// look up the per-source-file view (see processListings) for `path`
export function findSourceFileForPath(lst: CodeListing, path: string): SourceFile {
  if (!lst || !lst.sourcefiles) return null;
  // a path that ends the same way wins (urust's rs8/console.rs vs
  // rs8/apple2/console.rs), before the bare filename is compared
  for (var p in lst.sourcefiles) {
    if (p == path || p.endsWith('/' + path)) return lst.sourcefiles[p];
  }
  var want = getFilenameForPath(getFilenamePrefix(path));
  for (var p in lst.sourcefiles) {
    if (getFilenameForPath(getFilenamePrefix(p)) == want) return lst.sourcefiles[p];
  }
  return null;
}

// a copy of `lst` whose sourcefile holds only the lines for `path`, or `lst`
// unchanged if it has no per-source-file views
function withSourceFileForPath(lst: CodeListing, path: string): CodeListing {
  var sf = findSourceFileForPath(lst, path);
  return sf ? Object.assign({}, lst, { sourcefile: sf }) : lst;
}

/** The listing for a project file: by exact name, then by filename prefix, then by source path within a mixed listing. */
export function getListingForFile(listings: CodeListingMap, path: string, mainPath: string): CodeListing {
  if (!listings) return undefined;
  var stripped = stripLocalPath(path, mainPath);
  var fnprefix = getFilenamePrefix(stripped);
  for (var lstfn in listings) {
    if (lstfn == path || lstfn == stripped)
      return withSourceFileForPath(listings[lstfn], stripped);
  }
  for (var lstfn in listings) {
    if (lstfn.endsWith('/' + stripped)) // e.g. a urust header `gfx/span.rs` for rs8/gfx/span.rs
      return withSourceFileForPath(listings[lstfn], stripped);
  }
  for (var lstfn in listings) {
    if (getFilenamePrefix(lstfn) == fnprefix)
      return withSourceFileForPath(listings[lstfn], stripped);
  }
  // no listing named after this file; it may be one source among many in a
  // single mixed listing (e.g. an oscar64 "//#link"ed source)
  for (var lstfn in listings) {
    var sf = findSourceFileForPath(listings[lstfn], stripped);
    if (sf) return Object.assign({}, listings[lstfn], { sourcefile: sf });
  }
}

/** The platform's native memory map merged with the linker's segments, sorted by address. */
export function mergeSegments(nativeSegs: Segment[], linkerSegs: Segment[]): Segment[] {
  var segs: Segment[] = nativeSegs || [];
  segs.forEach(seg => seg.source = 'native');
  if (linkerSegs) {
    linkerSegs.forEach(seg => seg.source = 'linker');
    segs = segs.concat(linkerSegs);
  }
  segs.sort((a, b) => a.start - b.start);
  return segs;
}

/**
 * The set of PCs that begin a source line, for source-level step over.
 * Compilers like urust emit one entry per expression, so one source line can
 * have many entries at consecutive addresses. Only the first entry of each run
 * (in address order) on the same file+line counts, or step over would stop
 * after nearly every instruction.
 */
export function sourceLineStartPCs(listings: CodeListingMap): Set<number> {
  var entries: SourceLine[] = [];
  for (var lstfn in listings || {}) {
    var sourcefile = listings[lstfn].sourcefile;
    if (!sourcefile) continue;
    for (var line of sourcefile.lines) {
      if (line.offset >= 0) entries.push(line);
    }
  }
  entries.sort((a, b) => a.offset - b.offset);
  var pcs = new Set<number>();
  var prev: SourceLine = null;
  for (var e of entries) {
    if (!prev || prev.line != e.line || prev.path != e.path) pcs.add(e.offset);
    prev = e;
  }
  return pcs;
}
