
// buildcore - compiles a project in-process with the worker build system.
// No vscode imports, so tests can run it under plain Node.

import * as fs from 'fs';
import * as path from 'path';
import type { BuildProducts, FileData, WorkerError, WorkerErrorResult, WorkerResult } from "../../src/common/workertypes";
import { buildProducts } from "../../src/common/workertypes";
import { toInternalError } from "../../src/common/telemetry";
import { getBasePlatform, isProbablyBinary } from "../../src/common/util";
import { getToolForPlatform } from "../../src/common/toolselect";
import { FileProvider, buildWorkerMessage, resolveDependencies } from "../../src/common/projectcore";
import { setupNodeEnvironment, handleMessage } from "../../src/worker/workerlib";
import { REMOTE_BUILDS } from "./projectinfo";
import { PLATFORM_PARAMS } from "../../src/worker/platforms";

export type { FileProvider };

export interface BuildRequest {
  platform: string;
  /** main file, relative to the project root (posix separators) */
  mainPath: string;
  mainText: string;
  files: FileProvider;
  /** overrides the tool for the main file */
  tool?: string;
}

export interface BuildDiagnostic {
  /** project-relative path */
  path: string;
  /** 1-based line number (0 = no line) */
  line: number;
  msg: string;
  /** a missing severity means 'error' */
  severity?: 'error' | 'warning';
  /** extra advice lines from the tool, with backticks for code */
  help?: string[];
  /** help-page slug for more information (urust's error topics) */
  topic?: string;
}

export interface BuildOutcome extends BuildProducts {
  success: boolean;
  tool: string;
  output?: Uint8Array;
  diagnostics: BuildDiagnostic[];
  /** every project path the build read */
  paths: string[];
  /**
   * The files the build read besides the main file, keyed by both worker
   * filename and project path. The emulator reads some at load time
   * (verilog's $readmem).
   */
  files?: { [path: string]: FileData };
  /** true when no inputs changed since the previous build */
  unchanged?: boolean;
  /** set when the tool crashed, for error reports */
  internal?: WorkerErrorResult['internal'];
}

/**
 * Runs builds against the toolchain assets under `rootDir/src/worker`.
 * The worker store is global, so builds run one at a time.
 */
export class Builder {
  private queue: Promise<any> = Promise.resolve();
  private initialized = false;
  private preloaded = new Set<string>();
  /** the platform the worker store was last built for */
  private storePlatform: string | null = null;
  /** the last successful outcome per main file, for unchanged builds */
  private last = new Map<string, BuildOutcome>();

  constructor(readonly rootDir: string) { }

  build(req: BuildRequest): Promise<BuildOutcome> {
    var next = this.queue.then(() => this.doBuild(req));
    this.queue = next.catch(() => { });
    return next;
  }

  private async doBuild(req: BuildRequest): Promise<BuildOutcome> {
    if (!this.initialized) {
      setupNodeEnvironment(this.rootDir);
      this.initialized = true;
    }
    var getTool = (fn: string) => (req.tool && fn === req.mainPath) ? req.tool : getToolForPlatform(req.platform, fn);
    var tool = getTool(req.mainPath);
    if (tool.startsWith('remote:') && !REMOTE_BUILDS) {
      var why = `${tool.replace(/^remote:/, '')} builds on the 8bitworkshop server, which the extension doesn't support yet.`;
      return { success: false, tool, paths: [req.mainPath], diagnostics: [{ path: req.mainPath, line: 0, msg: why }] };
    }
    var deps = await resolveDependencies(req.files, req.mainPath, req.mainText, req.platform, getTool);
    var { msg, filename2path, preloads } = buildWorkerMessage({
      mainPath: req.mainPath,
      mainData: req.mainText,
      platformId: req.platform,
      getToolForFilename: getTool,
    }, deps);
    var paths = [req.mainPath].concat(deps.map(d => d.path));
    var files: { [path: string]: FileData } = {};
    for (var d of deps) files[d.filename] = files[d.path] = d.data;
    var key = `${req.platform}/${tool}/${req.mainPath}`;
    var result: WorkerResult;
    try {
      // The store only tracks file contents, so a shared source (e.g. a
      // symlinked common.c) would keep its .rel from another platform's defines.
      if (this.storePlatform !== req.platform) {
        await handleMessage({ reset: true } as any);
        this.storePlatform = req.platform;
      }
      for (var t of preloads) {
        if (!this.preloaded.has(t + "/" + req.platform)) {
          await handleMessage({ preload: t, platform: req.platform } as any);
          this.preloaded.add(t + "/" + req.platform);
        }
      }
      result = await handleMessage(msg);
    } catch (e) {
      return {
        success: false, tool, paths, diagnostics: [{ path: req.mainPath, line: 0, msg: String(e && e.message || e) }],
        internal: { tool, platform: req.platform, ...toInternalError(e) },
      };
    }
    var toPath = (err: WorkerError) => (err.path && filename2path[err.path]) || err.path || req.mainPath;
    var toDiagnostic = (err: WorkerError): BuildDiagnostic =>
      ({
        path: toPath(err), line: err.line || 0, msg: err.msg, ...(err.severity && { severity: err.severity }),
        ...(err.help && { help: err.help }), ...(err.topic && { topic: err.topic })
      });
    if (!result || ('unchanged' in result && result.unchanged)) {
      // the worker skips unchanged builds, but Run still needs the output.
      // Keep the last success even after a failed build: reverting to the
      // source that built it makes the worker say unchanged again, and that
      // output is what Run (and the next unchanged build) must use.
      // the warnings of the build that made the output still apply
      var last = this.last.get(key);
      return { ...last, success: true, tool, paths, files, diagnostics: last?.diagnostics ?? [], unchanged: true };
    }
    if ('errors' in result && result.errors && result.errors.length) {
      return {
        success: false, tool, paths,
        diagnostics: result.errors.map(toDiagnostic),
        internal: result.internal,
      };
    }
    if ('output' in result) {
      // listings stay raw: SourceFile objects don't survive postMessage, so
      // the receiver runs projectcore.processListings on them
      var r = result as any;
      var outcome: BuildOutcome = {
        success: true, tool, paths, files, diagnostics: (r.warnings || []).map(toDiagnostic),
        output: r.output, ...buildProducts(r),
      };
      this.last.set(key, outcome);
      return outcome;
    }
    return { success: false, tool, paths, diagnostics: [{ path: req.mainPath, line: 0, msg: 'Unknown build result' }] };
  }
}

/**
 * Reads project files through `read`, then falls back to the bundled
 * presets/<base platform> directory (for shared headers and libraries).
 */
export class ProjectFileProvider implements FileProvider {
  constructor(
    readonly read: (relpath: string) => Promise<Uint8Array | null>,
    readonly rootDir: string,
    readonly platform: string) { }

  async readFile(relpath: string): Promise<FileData | null> {
    var data = await this.read(relpath);
    if (data == null) {
      var p = path.resolve(this.rootDir, 'presets', getBasePlatform(this.platform), relpath);
      try {
        if (fs.statSync(p).isFile()) data = new Uint8Array(fs.readFileSync(p));
      } catch (e) {
        return null;
      }
    }
    if (data == null) return null;
    // the extension list is only a hint; the bytes decide (an .hgr, say)
    return isProbablyBinary(relpath, data) ? data : new TextDecoder().decode(data);
  }
}

export function listPlatforms(): string[] {
  return Object.keys(PLATFORM_PARAMS).sort();
}
