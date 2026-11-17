
// testlib - Clean async API for compiling and testing 8bitworkshop projects
// Wraps the worker build system for use in tests and CLI tools
// FOR TESTING ONLY

import * as fs from 'fs';
import * as path from 'path';
import type { WorkerResult, WorkerError, WorkerErrorResult, WorkerMessage, BuildArgLists, BuildSymbolLists, FileData, BuildProducts } from "../common/workertypes";
import { buildProducts } from "../common/workertypes";
import { isProbablyBinary, getBasePlatform } from "../common/util";
import { getToolForPlatform } from "../common/toolselect";
import { FileProvider, buildWorkerMessage, resolveDependencies } from "../common/projectcore";
import { setupNodeEnvironment, handleMessage, store } from "../worker/workerlib";
import { PLATFORM_PARAMS } from "../worker/platforms";
import { TOOLS } from "../worker/workertools";
import { toolRoot } from "./toolroot";

export { store, PLATFORM_PARAMS, TOOLS };

export interface CompileOptions {
  tool: string;
  platform: string;
  code?: string;
  path?: string;
  files?: { path: string; data: string | Uint8Array }[];
  buildsteps?: { path: string; platform: string; tool: string }[];
  mainfile?: boolean;
  /** extra symbols layered above platform defaults, below source directives */
  symbols?: BuildSymbolLists;
  /** extra raw args per phase, layered above platform defaults */
  buildArgs?: BuildArgLists;
}

export interface CompileResult extends BuildProducts {
  success: boolean;
  output?: Uint8Array | any;
  errors?: WorkerError[];
  /** non-fatal diagnostics of a successful build */
  warnings?: WorkerError[];
  params?: any;
  unchanged?: boolean;
  /** every file the build read, by worker filename (verilog's $readmem reads them at load time) */
  files?: { [path: string]: FileData };
  /** the tool crashed: the IDE and extension report this to us (common/telemetry) */
  internal?: WorkerErrorResult['internal'];
}

let initialized = false;

/**
 * Initialize the Node.js environment for compilation.
 * Must be called once before any compile/preload calls.
 */
export async function initialize(): Promise<void> {
  if (initialized) return;
  setupNodeEnvironment(toolRoot());
  // The worker tools are already registered through the import chain:
  // workerlib -> workertools -> tools/* and builder -> TOOLS
  // No need to load the esbuild bundle.
  initialized = true;
}

/**
 * Preload a tool's filesystem (e.g. CC65 standard libraries).
 */
export async function preload(tool: string, platform?: string): Promise<void> {
  await initialize();
  var msg: WorkerMessage = { preload: tool } as any;
  if (platform) (msg as any).platform = platform;
  await handleMessage(msg);
}

/**
 * Compile source code with the specified tool and platform.
 */
export async function compile(options: CompileOptions): Promise<CompileResult> {
  await initialize();

  // Reset the store for a clean build
  await handleMessage({ reset: true } as any);

  let result: WorkerResult;

  if (options.files && options.buildsteps) {
    // Multi-file build
    var msg: any = {
      updates: options.files.map(f => ({ path: f.path, data: f.data })),
      buildsteps: options.buildsteps
    };
    result = await handleMessage(msg);
  } else {
    // Single-file build
    var msg: any = {
      code: options.code,
      platform: options.platform,
      tool: options.tool,
      path: options.path || ('src.' + options.tool),
      mainfile: options.mainfile !== false,
    };
    if (options.symbols) msg.symbols = options.symbols;
    if (options.buildArgs) msg.buildArgs = options.buildArgs;
    result = await handleMessage(msg);
  }

  return workerResultToCompileResult(result);
}

/**
 * Compile a file from the presets directory.
 */
export async function compileFile(tool: string, platform: string, presetPath: string): Promise<CompileResult> {
  await initialize();

  // presets are served from presets/<base platform>/ (see WebPresetsFileSystem), so
  // a variant like 'apple2.enh' reads the same files as its parent
  var code = fs.readFileSync(path.join(toolRoot(), 'presets', getBasePlatform(platform), presetPath), 'utf-8');
  return compile({
    tool: tool,
    platform: platform,
    code: code,
    path: presetPath,
  });
}

/**
 * Reads files for a build from the source file's directory, then
 * presets/<base platform> under the tool root, then the current directory.
 */
export class NodeFileProvider implements FileProvider {
  constructor(readonly sourceDir: string, readonly platform: string) { }
  async readFile(filePath: string): Promise<FileData | null> {
    var searchPaths = [];
    if (this.sourceDir) searchPaths.push(path.resolve(this.sourceDir, filePath));
    searchPaths.push(path.resolve(toolRoot(), 'presets', getBasePlatform(this.platform), filePath));
    searchPaths.push(path.resolve(filePath));
    for (var p of searchPaths) {
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          const buf = fs.readFileSync(p);
          // sniff content, not just the filename -- resources such as .lzh
          // have no registered extension but are not valid UTF-8
          return isProbablyBinary(filePath, buf) ? new Uint8Array(buf) : buf.toString('utf-8');
        }
      } catch (e) {
        // continue searching
      }
    }
    return null;
  }
}

/**
 * Select the appropriate tool for a filename on a platform.
 */
export function getToolForFilename(fn: string, platform: string): string {
  return getToolForPlatform(platform, fn);
}

/**
 * The ROM image in a build result, or null when the output isn't one (verilog's
 * compiled unit). Throws when the tool produced nothing at all.
 */
export function romBytes(result: CompileResult): Uint8Array | null {
  const out = result.output?.code ?? result.output;
  if (out instanceof Uint8Array) return out;
  if (typeof out === 'string') return new TextEncoder().encode(out);
  if (out == null) throw new Error('compiler produced no output');
  return null;
}

/**
 * Compile an arbitrary source file path.
 * Parses include/link/resource directives and loads dependent files.
 * `buildAs` renames the file for the build, for sources whose name on disk
 * isn't one the tool accepts (the IDE's skeleton.<tool> templates).
 */
export async function compileSourceFile(tool: string, platform: string, filePath: string, buildAs?: string,
  opts?: { symbols?: BuildSymbolLists; buildArgs?: BuildArgLists }): Promise<CompileResult> {
  await initialize();
  var msg = await buildSourceFileMessage(tool, platform, filePath, buildAs, opts);
  await handleMessage({ reset: true } as any);
  var result = workerResultToCompileResult(await handleMessage(msg));
  result.files = {};
  for (var u of msg.updates) result.files[u.path] = u.data;
  return result;
}

/**
 * The worker message compileSourceFile sends for a source file -- the same
 * one the IDE builds (src/common/projectcore.ts). A `tool` overrides the
 * main file's tool; linked files get the platform's tool for their name.
 */
export async function buildSourceFileMessage(tool: string, platform: string, filePath: string, buildAs?: string,
  opts?: { symbols?: BuildSymbolLists; buildArgs?: BuildArgLists }): Promise<WorkerMessage> {
  var code = fs.readFileSync(filePath, 'utf-8');
  var basename = buildAs || path.basename(filePath);
  var getTool = (fn: string) => (tool && fn === basename) ? tool : getToolForPlatform(platform, fn);
  var fp = new NodeFileProvider(path.dirname(path.resolve(filePath)), platform);
  var deps = await resolveDependencies(fp, basename, code, platform, getTool);
  return buildWorkerMessage({
    mainPath: basename,
    mainData: code,
    platformId: platform,
    getToolForFilename: getTool,
    symbols: opts && opts.symbols,
    buildArgs: opts && opts.buildArgs,
  }, deps).msg;
}

function workerResultToCompileResult(result: WorkerResult): CompileResult {
  if (!result) {
    return { success: true, unchanged: true };
  }
  if ('unchanged' in result && result.unchanged) {
    return { success: true, unchanged: true };
  }
  if ('errors' in result && result.errors && result.errors.length > 0) {
    return {
      success: false,
      errors: result.errors,
      internal: result.internal,
    };
  }
  if ('output' in result) {
    return {
      success: true,
      output: result.output,
      warnings: result.warnings,
      params: (result as any).params,
      ...buildProducts(result),
    };
  }
  return { success: false, errors: [{ line: 0, msg: 'Unknown result format' }] };
}

/**
 * List available compilation tools.
 */
export function listTools(): string[] {
  return Object.keys(TOOLS);
}

/**
 * List available target platforms.
 */
export function listPlatforms(): string[] {
  return Object.keys(PLATFORM_PARAMS);
}

/**
 * Convert a binary buffer to a hex string for display.
 */
export function ab2str(buf: Buffer | ArrayBuffer): string {
  return String.fromCharCode.apply(null, new Uint16Array(buf));
}

// Platform test harness utilities

/**
 * Create a mock localStorage for tests that need it.
 */
export function createMockLocalStorage(): Storage {
  var items: { [key: string]: string } = {};
  return {
    get length() {
      return Object.keys(items).length;
    },
    clear() {
      items = {};
    },
    getItem(k: string) {
      return items[k] || null;
    },
    setItem(k: string, v: string) {
      items[k] = v;
    },
    removeItem(k: string) {
      delete items[k];
    },
    key(i: number) {
      return Object.keys(items)[i] || null;
    }
  };
}
