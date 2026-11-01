// lmtools - language model tools (languageModelTools in package.json), so an
// AI agent in VS Code, such as Copilot's agent mode, can build a program and
// run it headless. They use the extension's own build, which reads unsaved
// editors and fills in Problems, and a hidden emulator worker per run, so the
// user's emulator panel is untouched.
//
// vscode.lm.registerTool arrived in VS Code 1.95 and image results
// (LanguageModelDataPart) later; the extension supports 1.90, so both are
// looked up at run time and typed here.

import * as vscode from 'vscode';
import type { BuildOutcome } from './buildcore';
import { urustErrorDocURL } from '../../src/common/toolmeta';
import type { ScriptResult } from './emuworker';

export interface ToolTarget {
  platform: string;
  main: vscode.Uri;
  tool?: string;
}

/** What the tools need from the extension. */
export interface ToolHost {
  /** The target for a file (the active editor's if none), or why there's none. */
  target(file: string | undefined, platform: string | undefined): ToolTarget | string;
  build(t: ToolTarget): Promise<BuildOutcome | undefined>;
  /** Load a successful build into a hidden emulator and run `script` on it. */
  run(t: ToolTarget, build: BuildOutcome, script: string, token: vscode.CancellationToken): Promise<ScriptResult>;
}

export interface BuildInput {
  file?: string;
  platform?: string;
}

export interface RunInput extends BuildInput {
  frames?: number;
  script?: string;
}

// the parts of the vscode.lm tool API we use
interface ToolInvocation<T> { input: T }
interface LanguageModelTool<T> {
  prepareInvocation?(options: ToolInvocation<T>, token: vscode.CancellationToken): { invocationMessage?: string } | undefined;
  invoke(options: ToolInvocation<T>, token: vscode.CancellationToken): Promise<unknown>;
}
interface LmApi {
  registerTool<T>(name: string, tool: LanguageModelTool<T>): vscode.Disposable;
}

export const DEFAULT_FRAMES = 60;

/** Register the tools, if this VS Code has the API. */
export function registerTools(host: ToolHost): vscode.Disposable[] {
  var lm: LmApi | undefined = (vscode as any).lm;
  if (!lm?.registerTool) return [];
  return [
    lm.registerTool<BuildInput>('8bitworkshop_build', {
      prepareInvocation: o => ({ invocationMessage: `Building ${o.input.file || 'the current program'}` }),
      invoke: async o => result(await buildTool(host, o.input)),
    }),
    lm.registerTool<RunInput>('8bitworkshop_run', {
      prepareInvocation: o => ({ invocationMessage: `Running ${o.input.file || 'the current program'}` }),
      invoke: async (o, token) => result(await runTool(host, o.input, token)),
    }),
  ];
}

/** Text, plus an image when there is one and this VS Code can return it. */
export interface ToolOutput {
  text: string;
  png?: Uint8Array;
}

function result(out: ToolOutput): unknown {
  var v = vscode as any;
  var parts: unknown[] = [new v.LanguageModelTextPart(out.text)];
  if (out.png && v.LanguageModelDataPart?.image) parts.push(v.LanguageModelDataPart.image(out.png, 'image/png'));
  return new v.LanguageModelToolResult(parts);
}

function relative(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false);
}

/** "Built ..." or the errors, one `file:line: message` each; warnings follow either. */
export function describeBuild(t: ToolTarget, r: BuildOutcome): string {
  var what = `${relative(t.main)} with ${r.tool} for ${t.platform}`;
  var nwarn = r.diagnostics.filter(d => d.severity === 'warning').length;
  var nerr = r.diagnostics.length - nwarn;
  var lines = [r.success ? `Built ${what}: ${r.output?.length ?? 0} bytes.` : `Build of ${what} failed with ${nerr} error(s):`];
  if (r.success && nwarn) lines[0] += ` ${nwarn} warning(s):`;
  for (var d of r.diagnostics) {
    lines.push(`${relative(vscode.Uri.joinPath(t.main, '..', d.path))}:${d.line}: ${d.severity === 'warning' ? 'warning: ' : ''}${d.msg}`);
    for (var h of d.help || []) lines.push(`  = help: ${h}`);
    var docsURL = urustErrorDocURL(d.topic);
    if (docsURL) lines.push(`  see ${docsURL}`);
  }
  return lines.join('\n');
}

/** The run-script: `run <frames>` first if asked, then the script; `run 60` if neither. */
export function runScriptFor(input: RunInput): string {
  var parts: string[] = [];
  if (input.frames) parts.push(`run ${Math.max(1, Math.floor(input.frames))}`);
  if (input.script) parts.push(input.script);
  return parts.length ? parts.join('\n') : `run ${DEFAULT_FRAMES}`;
}

async function buildTool(host: ToolHost, input: BuildInput): Promise<ToolOutput> {
  var t = host.target(input.file, input.platform);
  if (typeof t === 'string') return { text: t };
  var r = await host.build(t);
  if (!r) return { text: `Couldn't build ${relative(t.main)}; see the 8bitworkshop output channel.` };
  return { text: describeBuild(t, r) };
}

async function runTool(host: ToolHost, input: RunInput, token: vscode.CancellationToken): Promise<ToolOutput> {
  var t = host.target(input.file, input.platform);
  if (typeof t === 'string') return { text: t };
  var r = await host.build(t);
  if (!r) return { text: `Couldn't build ${relative(t.main)}; see the 8bitworkshop output channel.` };
  if (!r.success || !r.output) return { text: r.success ? `${describeBuild(t, r)} The build produced nothing to run.` : describeBuild(t, r) };
  var s = await host.run(t, r, runScriptFor(input), token);
  var lines = [`${describeBuild(t, r)} Ran it on ${t.platform} to frame ${s.frame}.`];
  if (s.output) lines.push('Script output:', s.output.trimEnd());
  if (s.error) lines.push(`Script stopped: ${s.error}`);
  if (s.png && !(vscode as any).LanguageModelDataPart?.image) lines.push('(This version of VS Code cannot return the screenshot.)');
  return { text: lines.join('\n'), png: s.png };
}
