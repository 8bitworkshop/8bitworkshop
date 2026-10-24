// 8bitworkshop VS Code extension entry point.
// Builds and emulation run in worker threads (buildworker, emuworker): both
// replace globals like fetch and window, which the shared extension host
// must not see. This module stays light.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { BuildOutcome } from './buildcore';
import type { BuildArgs } from './buildworker';
import type { AudioChunk, EmuStatus, ScriptResult, VcdEvent } from './emuworker';
import { WorkerHandle, WorkerDisposedError } from './engine';
import { EmulatorPanel, VIEW_TYPE } from './emulatorpanel';
import { DebugViews } from './views';
import { WorkerDebugBackend } from './debugbackend';
import { EmuDebugSession, LaunchArgs } from '../../src/tools/dapsession';
import { ASM_LANGUAGE_CPUS, Project, findRootDir, isHeaderFile, isInside, isOwnExtension, isSourceFile, languageFor } from './projectinfo';
import { CONFIG, ProjectScope } from './projectscope';
import { BuildReason, BuildScheduler } from './autobuild';
import { PRESET_SCHEME, PresetFileSystem, Templates } from './templates';
import { chooseForFile, detectDirectoryAt, detectionSummary, describeDetection, describeFinding, dontAskKey, FolderFinding, platformName, scanFolder } from './detection';
import { Detection, classifyFinding, isBuildableSource } from '../../src/common/detect';
import { buildProducts } from '../../src/common/workertypes';
import { TOOL_META } from '../../src/common/toolmeta';
import { getToolForPlatform } from '../../src/common/toolselect';
import { assetServers, AssetStore } from '../../src/tools/assets';
import { projectReadme, writeLauncher } from './terminalcli';
import type { PlatformInfo } from '../../src/tools/presettypes';
import { registerTools } from './lmtools';
import { RUST_ANALYZER_SETTINGS, hasRustAnalyzerSettings, isUrustProject, sameSetting, withRustAnalyzerSettings } from './rustanalyzer';
import { AssetManifest, packsForPlatform } from '../../src/tools/assetpacks';
import { ErrorTelemetry } from './telemetry';

let context: vscode.ExtensionContext;
let output: vscode.OutputChannel;
let telemetry: ErrorTelemetry;
let diagnostics: vscode.DiagnosticCollection;
let status: vscode.StatusBarItem;
let scope: ProjectScope;
let templates: Templates;
let scheduler: BuildScheduler;
let builds: WorkerHandle | undefined;
let emu: WorkerHandle | undefined;
let assets: AssetStore | undefined;
let panel: EmulatorPanel | undefined;
let emuStatus: EmuStatus | null = null;
/** The debug views in the panel container; the worker feeds the ones showing. */
const views = new DebugViews(ids => { if (emu?.started) emu.notify('setViews', ids); },
  (index, value) => { if (emu?.started) emu.notify('setSignal', index, value); });

/** A view the worker asked to open (a design with no video), once its view exists. */
let pendingReveal: string | undefined;
function flushReveal() {
  if (pendingReveal === 'waveform' && emuStatus?.waveform) {
    pendingReveal = undefined;
    vscode.commands.executeCommand('8bitworkshop.waveform.focus');
  }
}

/** Context keys for what the running program supports: which views and commands show. */
function setCapabilityContexts(s: EmuStatus | null | undefined) {
  vscode.commands.executeCommand('setContext', '8bitworkshop.hasDebugInfo', !!s?.debugInfo);
  vscode.commands.executeCommand('setContext', '8bitworkshop.hasWaveform', !!s?.waveform);
  vscode.commands.executeCommand('setContext', '8bitworkshop.canRecordVcd', !!s?.vcd);
}
let nextBuildId = 1;
const readers = new Map<number, (rel: string) => Promise<Uint8Array | null>>();

/** What Build and Run act on: a project's run target, or an example. */
interface Target {
  platform: string;
  main: vscode.Uri;
  tool?: string;
  project?: Project;
}

/** What the emulator runs, so a rebuild of the same thing reloads it. */
let running: Target | undefined;
/** The build it runs, so an identical rebuild (a comment edit) doesn't restart it. */
let runningBuild: BuildOutcome | undefined;
/** The target auto-build rebuilds: the last one changed or saved. */
let autoTarget: Target | undefined;
/** Diagnostics from a failed type-build, shown after a pause in typing. */
let heldDiagnostics: { timer: NodeJS.Timeout, show: () => void } | undefined;
/** Sound is muted; remembered across runs and webviews. */
let muted = false;
/** The debug session driving the emulator, if one is. */
let debugging: { session: vscode.DebugSession, backend: WorkerDebugBackend } | undefined;

export function activate(ctx: vscode.ExtensionContext) {
  context = ctx;
  output = vscode.window.createOutputChannel('8bitworkshop');
  telemetry = new ErrorTelemetry(msg => output.appendLine(msg));
  diagnostics = vscode.languages.createDiagnosticCollection('8bitworkshop');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  status.command = '8bitworkshop.projectMenu';
  scope = new ProjectScope(ctx.workspaceState);
  templates = new Templates(ctx.extensionPath, () => toolchainRoot());
  scheduler = new BuildScheduler(reason => autoBuild(reason));
  ctx.subscriptions.push(output, telemetry, diagnostics, status, scope);
  setupTerminalCommand();
  ctx.subscriptions.push(...registerTools({ target: toolTarget, build: t => runBuild(t, 'command'), run: runScriptHeadless }));
  ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (['terminalCommand', 'toolchainPath'].some(k => e.affectsConfiguration(`${CONFIG}.${k}`))) setupTerminalCommand();
  }));

  ctx.subscriptions.push(vscode.workspace.registerFileSystemProvider(PRESET_SCHEME, new PresetFileSystem(templates),
    { isCaseSensitive: true, isReadonly: PresetFileSystem.readonlyMessage() }));

  const command = (id: string, fn: (...args: any[]) => any) =>
    ctx.subscriptions.push(vscode.commands.registerCommand('8bitworkshop.' + id, async (...args) => {
      try {
        return await fn(...args);
      } catch (e) {
        output.appendLine(`${id}: ${e && e.stack || e}`);
        vscode.window.showErrorMessage(`8bitworkshop: ${e && e.message || e}`);
      }
    }));
  command('build', () => buildCommand(false));
  command('run', () => buildCommand(true));
  command('debug', () => debugCommand());
  command('runThisFile', (uri?: vscode.Uri) => runThisFile(uri));
  command('runMainFile', () => runMainFile());
  command('followActiveEditor', () => followActiveEditor());
  command('setMainFile', (uri?: vscode.Uri) => setMainFile(uri));
  command('changeMainFile', () => changeMainFile());
  command('selectPlatform', () => changePlatform());
  command('removeProject', () => removeProject());
  command('newProject', (platformId?: string) => newProject(platformId));
  command('openExample', () => openExample());
  command('copyToWorkspace', (uri?: vscode.Uri) => copyToWorkspace(uri));
  command('detectProjects', () => detectProjects(true));
  command('setupRustAnalyzer', () => setupRustAnalyzer());
  command('addLaunchConfiguration', () => addLaunchConfiguration());
  command('projectMenu', () => projectMenu());
  command('reset', () => emu?.started && emu.notify('reset'));
  command('pause', () => emu?.started && emu.notify('pause'));
  command('resume', () => emu?.started && emu.notify('resume'));
  command('stop', () => stopEmulator());
  command('downloadToolchains', () => prepareToolchains());
  command('mute', () => setMuted(true));
  command('unmute', () => setMuted(false));
  command('recordVcd', () => recordVcd());
  command('stopVcd', () => emu?.started && emu.notify('stopVcd'));
  command('showMachine', () => vscode.commands.executeCommand('8bitworkshop.machine.focus'));
  ctx.subscriptions.push(...views.register(ctx.extensionUri));
  muted = ctx.globalState.get<boolean>('muted', false);
  vscode.commands.executeCommand('setContext', '8bitworkshop.muted', muted);
  vscode.commands.executeCommand('setContext', '8bitworkshop.canDownloadToolchains', hasDownloadablePacks());

  // VS Code restores the emulator tab after a window reload, but the program
  // it showed is gone, so close it instead of leaving it blank
  ctx.subscriptions.push(vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
    deserializeWebviewPanel: async restored => restored.dispose(),
  }));

  // F5 on an 8bitworkshop launch configuration debugs it; Ctrl+F5 (Run
  // Without Debugging) just runs it in the emulator panel
  ctx.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('8bitworkshop', {
    resolveDebugConfiguration: async (folder, config) => {
      if (config.noDebug) {
        await runLaunchConfiguration(folder, config);
        return undefined;  // no debug session; the emulator panel runs it
      }
      // F5 with no launch.json: debug the current target
      return { type: '8bitworkshop', request: 'launch', name: 'Debug', ...config };
    },
  }));
  ctx.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('8bitworkshop', {
    createDebugAdapterDescriptor: session => new vscode.DebugAdapterInlineImplementation(newDebugSession(session)),
  }));
  ctx.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session => {
    if (debugging?.session === session) debugging = undefined;
  }));

  ctx.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(doc => onSave(doc)),
    vscode.workspace.onDidChangeTextDocument(e => onChange(e)),
    vscode.window.onDidChangeActiveTextEditor(() => { updateStatus(); detectForActiveFile(); }),
    vscode.workspace.onDidOpenTextDocument(doc => assignLanguage(doc)),
    scope.onDidChange(() => onProjectsChanged()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => detectProjects(false)),
    { dispose: () => { builds?.dispose(); emu?.dispose(); } },
  );
  folderScans = scope.loadReadmes().then(() => {
    welcomeProject().catch(e => output.appendLine(`welcome: ${e}`));
    return detectProjects(false);
  });
  vscode.workspace.textDocuments.forEach(assignLanguage);
  detectForActiveFile();
  updateStatus();
}

export function deactivate() {
  scheduler?.cancel();
  if (heldDiagnostics) clearTimeout(heldDiagnostics.timer);
}

function config(uri?: vscode.Uri) {
  return vscode.workspace.getConfiguration(CONFIG, uri);
}

/** pixels along the longer side of a vector platform's screen */
function vectorSize(): number {
  return config().get<number>('vectorSize') || 512;
}

////// toolchains

/** A local copy (toolchainPath, or the repo in development), if there is one. */
function localRoot(): string | null {
  return config().get<string>('toolchainPath') || findRootDir(context.extensionPath);
}

/** Where downloaded and unpacked toolchains live. */
function toolchainCacheDir(): string {
  return path.join(context.globalStorageUri.fsPath, 'toolchains');
}

/** Toolchain packs shipped inside the extension (see .vscodeignore). */
function bundledAssetsDir(): string {
  return path.join(context.extensionPath, 'out', 'assets');
}

function hasBundledPack(manifest: AssetManifest, pack: string): boolean {
  var info = manifest.packs[pack];
  return !!info && fs.existsSync(path.join(bundledAssetsDir(), info.file));
}

/** True when some pack isn't bundled, so the user could download it. */
function hasDownloadablePacks(): boolean {
  try {
    var store = getAssets();
    return Object.keys(store.manifest.packs).some(p => !hasBundledPack(store.manifest, p));
  } catch (e) {
    return true;  // no manifest: the command reports the toolchainPath hint
  }
}

function getAssets(): AssetStore {
  if (!assets) {
    var file = path.join(context.extensionPath, 'out', 'assets.json');
    try {
      var manifest: AssetManifest = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
      throw new Error(`Cannot find toolchains: no ${file}. Set 8bitworkshop.toolchainPath.`);
    }
    // The bundled packs first, so a common platform needs no network; then the
    // 8bitworkshop servers (for packs not bundled).
    var urls: string[] = [];
    if (Object.keys(manifest.packs).some(p => hasBundledPack(manifest, p))) urls.push(bundledAssetsDir());
    urls.push(...assetServers(manifest));
    assets = new AssetStore(toolchainCacheDir(), manifest,
      urls, msg => output.appendLine(msg));
  }
  return assets;
}

/** The asset root, after installing any packs `platform` and build `tool` need. */
async function toolchainRoot(platform?: string, tool?: string, source?: string): Promise<string> {
  var local = localRoot();
  if (local) return local;
  return installPacks(packsForPlatform(platform, tool, source));
}

async function installPacks(packs: string[]): Promise<string> {
  var store = getAssets();
  if (packs.every(p => store.has(p))) return store.root;
  // Everything needed is in the extension: unpack it without a progress pop-up.
  if (packs.every(p => store.has(p) || hasBundledPack(store.manifest, p))) return store.ensure(packs);
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '8bitworkshop: Downloading toolchains' }, progress => {
    var shown = new Map<string, number>();
    return store.ensure(packs, (pack, n, total) => {
      var pct = total ? Math.floor(100 * n / total / packs.length) : 0;
      progress.report({ message: `${pack}: ${mb(n)} of ${mb(total)}`, increment: pct - (shown.get(pack) || 0) });
      shown.set(pack, pct);
    });
  });
}

/**
 * Put 8bws on the integrated terminal's PATH (8bitworkshop.terminalCommand):
 * a launcher in global storage runs out/8bws.js with VS Code's Node. It is
 * rewritten on each activation, since VS Code's and the extension's paths
 * change with updates.
 */
function setupTerminalCommand() {
  var env = context.environmentVariableCollection;
  env.clear();
  var script = path.join(context.extensionPath, 'out', '8bws.js');
  if (!config().get<boolean>('terminalCommand') || !fs.existsSync(script)) return;
  var vars: { [name: string]: string } = {};
  var local = localRoot();
  if (local) vars.EIGHTBITWORKSHOP_ROOT = local;
  else vars.EIGHTBITWORKSHOP_TOOLCHAINS = toolchainCacheDir();
  var bin = path.join(context.globalStorageUri.fsPath, 'bin');
  try {
    writeLauncher(bin, { node: process.execPath, script, env: vars });
  } catch (e) {
    output.appendLine(`Cannot write the 8bws launcher to ${bin}: ${e && e.message || e}`);
    return;
  }
  env.description = 'Adds the 8bws command, to build and run 8bitworkshop programs from the terminal.';
  env.prepend('PATH', bin + path.delimiter);
}

async function prepareToolchains() {
  if (localRoot()) {
    vscode.window.showInformationMessage(`8bitworkshop: using the toolchains in ${localRoot()}.`);
    return;
  }
  await installPacks(Object.keys(getAssets().manifest.packs));
  vscode.window.showInformationMessage('8bitworkshop: toolchains ready.');
}

function mb(n: number): string {
  return (n / 1048576).toFixed(1) + ' MB';
}

async function getBuilds(platform: string, tool?: string, source?: string): Promise<WorkerHandle> {
  var root = await toolchainRoot(platform, tool, source);
  if (!builds) {
    output.appendLine(`Toolchain root: ${root}`);
    builds = new WorkerHandle('buildworker.js', root, {
      readFile: (buildId: number, rel: string) => readers.get(buildId)?.(rel) ?? null,
    }, msg => output.appendLine(msg), err => telemetry.reportError('worker', err, { platform }));
  }
  return builds;
}

async function getEmu(platform: string): Promise<WorkerHandle> {
  var root = await toolchainRoot(platform);
  if (!emu) {
    emu = new WorkerHandle('emuworker.js', root, {}, msg => output.appendLine(msg),
      err => telemetry.reportError('emu', err, { platform }));
    emu.on('internalError', e => telemetry.reportInternal('emu', e, { platform: e.platform }));
    emu.on('frame', frame => panel?.showFrame(frame));
    emu.on('audio', (chunk: AudioChunk) => panel?.showAudio(chunk));
    emu.on('audioReset', () => panel?.resetAudio());
    emu.on('stopped', e => debugging?.backend.handleStop(e));
    emu.on('view', ev => views.show(ev));
    emu.on('reveal', (id: string) => { pendingReveal = id; flushReveal(); });
    emu.on('vcd', (ev: VcdEvent) => vcdEvent(ev));
    emu.on('status', (s: EmuStatus | null) => {
      emuStatus = s;
      panel?.showStatus(s);
      setCapabilityContexts(s);
      vscode.commands.executeCommand('setContext', '8bitworkshop.emuRunning', s?.state === 'running');
      if (s?.state === 'halted') output.appendLine(`Emulator halted at frame ${s.frame}: ${s.message}`);
    });
  }
  return emu;
}

////// targets

function activeUri(): vscode.Uri | undefined {
  return vscode.window.activeTextEditor?.document.uri;
}

/** The example behind an 8bws-preset: document, as a target. */
function presetTarget(uri: vscode.Uri): Target | undefined {
  var p = templates.fromUri(uri);
  if (!p) return undefined;
  return { platform: p.platform.id, main: uri };
}

/** What Build and Run use for the active editor, if anything. */
function currentTarget(): Target | undefined {
  var uri = activeUri();
  if (uri && uri.scheme === PRESET_SCHEME) return presetTarget(uri);
  var project = scope.projectFor(uri);
  if (!project) {
    // with no editor, the project that ran last
    if (!uri && running?.project) project = running.project;
    else return undefined;
  }
  return targetIn(project, uri);
}

function targetIn(project: Project, uri: vscode.Uri | undefined): Target | undefined {
  var file = scope.runTarget(project, uri);
  if (!file) return undefined;
  var tool = file === project.mainFile ? project.tool : undefined;
  return { platform: project.platform, main: vscode.Uri.file(file), tool, project };
}

function describeTarget(t: Target): string {
  return path.posix.basename(t.main.path);
}

////// language model tools (lmtools.ts)

/** A file named by an agent: absolute, or relative to a workspace folder. */
function resolveToolPath(file: string): vscode.Uri | undefined {
  if (path.isAbsolute(file)) return vscode.Uri.file(file);
  for (var folder of vscode.workspace.workspaceFolders || []) {
    var uri = vscode.Uri.joinPath(folder.uri, file);
    if (fs.existsSync(uri.fsPath)) return uri;
  }
  return undefined;
}

/**
 * The target for a tool call: the file's project (its program, when the file
 * is a header), else the file itself on `platform`. No settings are written.
 */
function toolTarget(file: string | undefined, platform: string | undefined): Target | string {
  if (platform && !templates.platform(platform)) {
    return `Unknown platform "${platform}". Platforms: ${templates.get().platforms.map(p => p.id).join(', ')}.`;
  }
  if (!file) {
    var current = currentTarget();
    if (current && (!platform || current.platform === platform)) return current;
    return 'No 8bitworkshop program is open in the editor. Pass the path of a source file.';
  }
  var uri = resolveToolPath(file);
  if (!uri || !fs.existsSync(uri.fsPath)) return `No such file: ${file}`;
  var project = scope.projectFor(uri);
  if (project && (!platform || project.platform === platform)) {
    var t = targetIn(project, uri);
    if (t) return t;
  }
  if (platform) return { platform, main: uri };
  return `${file} isn't in an 8bitworkshop project, so its platform is unknown. Pass platform, one of: ${templates.get().platforms.map(p => p.id).join(', ')}.`;
}

const SCRIPT_TIMEOUT_MS = 60000;

/** Run a build in a hidden emulator of its own, for the run tool. */
async function runScriptHeadless(target: Target, build: BuildOutcome, script: string, token: vscode.CancellationToken): Promise<ScriptResult> {
  var worker = new WorkerHandle('emuworker.js', await toolchainRoot(target.platform), {}, msg => output.appendLine(msg),
    err => telemetry.reportError('emu', err, { platform: target.platform }));
  var timer: NodeJS.Timeout | undefined;
  var cancel: vscode.Disposable | undefined;
  try {
    var stop = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`the script ran longer than ${SCRIPT_TIMEOUT_MS / 1000} seconds`)), SCRIPT_TIMEOUT_MS);
      cancel = token.onCancellationRequested(() => reject(new Error('cancelled')));
    });
    var run = async () => {
      await worker.call('start', target.platform, build.output, build.files, { paused: true, vectorSize: vectorSize() });
      var mainPath = path.posix.basename(target.main.path);
      return worker.call<ScriptResult>('script', script, { ...buildProducts(build), mainPath, paths: build.paths });
    };
    return await Promise.race([run(), stop]);
  } finally {
    clearTimeout(timer);
    cancel?.dispose();
    // terminating also ends a script that's still running
    worker.dispose();
  }
}

////// languages

const OWN_LANGUAGES = [...ASM_LANGUAGE_CPUS.map(cpu => '8bws-' + cpu), '8bws-verilog', '8bws-rust'];

/**
 * Give a shared-extension file its project's language. Files no other
 * extension claimed open as plaintext; we leave the rest alone. That is
 * deliberate for .rs: when rust-analyzer (or any Rust extension) is
 * installed VS Code opens it as `rust`, which is not ours, so the 8bws-rust
 * fallback is only ever assigned when nothing else claims Rust.
 */
function assignLanguage(doc: vscode.TextDocument) {
  if (doc.languageId !== 'plaintext' && !OWN_LANGUAGES.includes(doc.languageId)) return;
  var platform = doc.uri.scheme === PRESET_SCHEME
    ? templates.fromUri(doc.uri)?.platform.id
    : scope.projectFor(doc.uri)?.platform;
  var lang = platform && languageFor(doc.uri.path, platform);
  if (lang && lang !== doc.languageId)
    vscode.languages.setTextDocumentLanguage(doc, lang).then(undefined, e => output.appendLine(`language: ${e}`));
}

////// status bar

function updateStatus() {
  var uri = activeUri();
  var target = currentTarget();
  var canRun = !!target || (!!uri && uri.scheme === 'file' && isSourceFile(uri.fsPath));
  vscode.commands.executeCommand('setContext', '8bitworkshop.canRun', canRun);
  vscode.commands.executeCommand('setContext', '8bitworkshop.isExample', uri?.scheme === PRESET_SCHEME);
  var project = target?.project;
  if (target) {
    var name = platformName(templates, target.platform);
    var follow = project && (!project.mainFile || scope.getTargetChoice(project) === 'follow');
    var notMain = project && project.mainFile && target.main.fsPath !== project.mainFile;
    status.text = `$(chip) ${name} · ${describeTarget(target)}${follow ? ' (active file)' : ''}`;
    var tip = new vscode.MarkdownString();
    tip.appendMarkdown(`**${name}** (\`${target.platform}\`)\n\n`);
    if (project?.mainFile) tip.appendMarkdown(`Main file: \`${path.relative(project.scope, project.mainFile)}\`\n\n`);
    if (notMain) tip.appendMarkdown(`Running \`${describeTarget(target)}\` instead of the main file.\n\n`);
    if (uri?.scheme === PRESET_SCHEME) tip.appendMarkdown('Read-only example.\n\n');
    if (lastTool(target)?.startsWith('remote:')) tip.appendMarkdown('This tool builds on a server, so it builds when you save.\n\n');
    tip.appendMarkdown('Click for project options.');
    status.tooltip = tip;
    status.show();
  } else if (uri && uri.scheme === 'file' && dirGuesses.get(path.dirname(uri.fsPath))) {
    var guess = dirGuesses.get(path.dirname(uri.fsPath))!;
    status.text = `$(chip) ${platformName(templates, guess.platform)}?`;
    status.tooltip = `Looks like ${platformName(templates, guess.platform)}: ${describeDetection(guess)}. Click to choose a platform.`;
    status.show();
  } else if (uri && uri.scheme === 'file' && isOwnExtension(uri.fsPath)) {
    status.text = '$(chip) No platform';
    status.tooltip = 'Choose a platform for this file';
    status.show();
  } else {
    status.hide();
  }
}

function lastTool(t: Target): string | undefined {
  return scope.lastBuildOf(t.main.fsPath)?.tool;
}

/** Settings changed, in the editor or by us: re-read, and drop what's stale. */
function onProjectsChanged() {
  // a project removed through settings.json shouldn't leave errors behind
  releaseHeldDiagnostics(false);
  clearOrphanDiagnostics();
  // a project that no longer exists can't keep running
  if (running?.project && !scope.projectFor(running.main)) stopEmulator();
  updateStatus();
  vscode.workspace.textDocuments.forEach(assignLanguage);
}

/** Delete diagnostics for files no project owns any more. */
function clearOrphanDiagnostics() {
  var orphans: vscode.Uri[] = [];
  diagnostics.forEach(uri => {
    if (uri.scheme === 'file' && !scope.projectFor(uri)) orphans.push(uri);
  });
  for (var uri of orphans) diagnostics.delete(uri);
}

async function projectMenu() {
  var target = currentTarget();
  var project = target?.project;
  type Item = vscode.QuickPickItem & { run?: () => any };
  var items: Item[] = [];
  if (!target) {
    items.push({ label: '$(file-code) Set as Main File', description: 'choose a platform for this file', run: () => setMainFile() });
    items.push({ label: '$(new-folder) New Project...', run: () => newProject() });
    items.push({ label: '$(book) Open Example', run: () => openExample() });
  } else if (!project) {
    items.push({ label: '$(copy) Copy to Workspace', run: () => copyToWorkspace() });
  } else {
    var choice = scope.getTargetChoice(project);
    if (project.mainFile && target.main.fsPath !== project.mainFile) {
      items.push({ label: '$(arrow-left) Run Main File', description: path.basename(project.mainFile), run: () => runMainFile() });
    }
    var recent = new Set<string>();
    for (var b of [scope.lastBuildIn(project)].filter(Boolean)) recent.add(b.target);
    for (var r of recent) {
      if (r !== target.main.fsPath && r !== project.mainFile)
        items.push({ label: `$(play) Run ${path.basename(r)}`, description: 'recent', run: () => runFile(project, r) });
    }
    if (choice !== 'follow' && project.mainFile)
      items.push({ label: '$(eye) Follow Active Editor', description: 'run whichever program is open', run: () => followActiveEditor() });
    items.push({ label: 'Project', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: '$(chip) Change Platform...', description: platformName(templates, project.platform), run: () => changePlatform() });
    items.push({ label: '$(file-code) Change Main File...', description: project.mainFile ? path.basename(project.mainFile) : 'none', run: () => changeMainFile() });
    if (project.mainFile && target.main.fsPath !== project.mainFile)
      items.push({ label: '$(debug-alt) Add Launch Configuration', description: `for ${describeTarget(target)}`, run: () => addLaunchConfiguration() });
    items.push({ label: '$(search) Detect Again', run: () => detectAgain(project) });
    if (isUrustProject(project.platform, project.tool))
      items.push({ label: '$(settings-gear) Set Up rust-analyzer', description: 'no cargo check or Run lenses', run: () => setupRustAnalyzer() });
    items.push({ label: '$(trash) Remove Project...', run: () => removeProject() });
  }
  var picked = await vscode.window.showQuickPick(items, { title: '8bitworkshop' });
  await picked?.run?.();
}

////// build and run

async function buildCommand(run: boolean) {
  var target = await ensureTarget();
  if (target) await buildAndMaybeRun(target, run, 'command');
}

/** Debug the current target, as F5 would with no launch configuration. */
async function debugCommand() {
  var target = await ensureTarget();
  if (!target) return;
  // no mainFile: the launch debugs the current target (see launchTarget)
  await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(target.main),
    { type: '8bitworkshop', request: 'launch', name: `Debug ${describeTarget(target)}` });
}

/** The current target; for a file no project owns yet, start one from it (case 2). */
async function ensureTarget(): Promise<Target | undefined> {
  var target = currentTarget();
  if (target) return target;
  var uri = activeUri();
  if (!uri || !isSourceFile(uri.fsPath)) {
    vscode.window.showWarningMessage('8bitworkshop: open a source file, or run "8bitworkshop: New Project...".');
    return undefined;
  }
  if (!await setMainFile(uri)) return undefined;
  return currentTarget();
}

async function buildAndMaybeRun(target: Target, run: boolean, reason: BuildReason) {
  var result = await runBuild(target, reason);
  if (!result) return;
  if (!result.success) {
    if (run) vscode.window.showErrorMessage('8bitworkshop: build failed; see Problems.');
    return;
  }
  if (run) {
    if (result.output) await startEmulator(target, result);
    else {
      output.appendLine('8bitworkshop: the build produced no ROM to run; see the output for the last build.');
      output.show(true);
    }
  } else if (!result.unchanged) {
    await reloadEmulator(target, reason, result);
  }
}

async function runFile(project: Project, file: string) {
  await scope.setTargetChoice(project, file);
  var target = targetIn(project, vscode.Uri.file(file));
  if (target) await buildAndMaybeRun(target, true, 'command');
}

async function runThisFile(uri?: vscode.Uri) {
  uri = uri || activeUri();
  if (!uri) return;
  if (uri.scheme === PRESET_SCHEME) {
    var pt = presetTarget(uri);
    if (pt) await buildAndMaybeRun(pt, true, 'command');
    return;
  }
  var project = scope.projectFor(uri);
  if (!project) {
    if (!await setMainFile(uri)) return;
    project = scope.projectFor(uri);
    if (!project) return;
  }
  await runFile(project, uri.fsPath);
}

async function runMainFile() {
  var project = currentTarget()?.project || running?.project;
  if (!project) return;
  await scope.setTargetChoice(project, undefined);
  var target = targetIn(project, activeUri());
  if (target) await buildAndMaybeRun(target, true, 'command');
}

async function followActiveEditor() {
  var project = currentTarget()?.project;
  if (!project) return;
  await scope.setTargetChoice(project, 'follow');
}

/** The emulator is running, with its screen or without (a program with only signals). */
function emulatorOpen() {
  return !!(panel || emuStatus);
}

/** End the program, closing its screen too. */
function stopEmulator() {
  if (panel) panel.dispose(); // which ends the program, in emulatorClosed
  else emulatorClosed();
}

/** The program ended: forget it, and anything debugging it. */
function emulatorClosed() {
  if (debugging) vscode.debug.stopDebugging(debugging.session);
  panel = undefined;
  emuStatus = null;
  running = undefined;
  // the next run starts a new worker anyway
  emu?.dispose();
  emu = undefined;
  views.clear();
  setCapabilityContexts(null);
  vscode.commands.executeCommand('setContext', '8bitworkshop.recordingVcd', false);
  vscode.commands.executeCommand('setContext', '8bitworkshop.emuRunning', false);
  vscode.commands.executeCommand('setContext', '8bitworkshop.emuOpen', false);
}

/** The emulator's screen: open it, or bring the open one forward for the new program. */
function openPanel(title: string, platform: string) {
  if (!panel) {
    panel = new EmulatorPanel({
      onKey: (key, code, flags) => { emu?.notify('key', key, code, flags); },
      onPaddle: (x, y, buttons) => { emu?.notify('paddle', x, y, buttons); },
      onControlsVisible: visible => context.globalState.update('controlsVisible', visible),
      // don't burn CPU on a hidden screen
      onVisible: visible => { emu?.notify('setVisible', visible); },
      onSeek: frame => { emu?.notify('seekFrame', frame); },
      // closing the emulator ends the program, and any session debugging it
      onDispose: () => emulatorClosed(),
    }, context.globalState.get<boolean>('controlsVisible', true));
  } else {
    panel.reveal();
  }
  panel.setTitle(`${title} (${platform})`);
  panel.setMuted(muted);
}

/**
 * Start `build` in the emulator panel. Returns false if it didn't start. A
 * program with no video (a Verilog design with only signals) gets no panel:
 * its Waveform view opens instead.
 */
async function startEmulator(target: Target, build: BuildOutcome, opts: { paused?: boolean } = {}): Promise<boolean> {
  // a plain Run replaces what the debugger was looking at
  if (debugging && !opts.paused) vscode.debug.stopDebugging(debugging.session);
  // each run gets a fresh worker: platforms keep global state (see emuworker)
  if (emu?.started) await emu.call('stopVcd').catch(() => { });
  emu?.dispose();
  emu = undefined;
  emuStatus = null;
  views.clear();
  var worker = await getEmu(target.platform);
  var title = describeTarget(target);
  try {
    emuStatus = await worker.call<EmuStatus>('start', target.platform, build.output, build.files, { ...opts, vectorSize: vectorSize() });
    // (the worker's first frame comes after this reply, so the panel is up in time)
    if (emuStatus.screen !== false || panel) openPanel(title, target.platform);
    vscode.commands.executeCommand('setContext', '8bitworkshop.emuOpen', true);
    worker.notify('setMuted', muted);
    worker.notify('setViews', views.subscriptions());
    setCapabilityContexts(emuStatus);
    flushReveal();
    panel?.showStatus(emuStatus);
    running = target;
    runningBuild = build;
    output.appendLine(`Running ${title} on ${target.platform}`);
    return true;
  } catch (e) {
    if (e instanceof WorkerDisposedError) return false; // replaced or closed mid-start
    telemetry.reportError('emu', e, { platform: target.platform });
    output.appendLine(`Emulator failed to start: ${e && e.stack || e}`);
    output.show(true);
    return false;
  }
}

/** After a rebuild of what the emulator runs, reload it (per reloadOnBuild). */
async function reloadEmulator(target: Target, reason: BuildReason, result: BuildOutcome) {
  if (!emulatorOpen() || !emuStatus || !running || !result.output) return;
  if (running.main.toString() !== target.main.toString()) return;
  // the code under the debugger doesn't change beneath it; F5 again rebuilds
  if (debugging) return;
  var mode = config(target.main).get<string>('reloadOnBuild', 'always');
  if (mode === 'never' || (mode === 'onSave' && reason === 'type')) return;
  if (emuStatus.platform !== target.platform) {
    await startEmulator(target, result);
  } else if (!sameBuild(runningBuild, result)) {
    runningBuild = result;
    try {
      emuStatus = await (await getEmu(target.platform)).call<EmuStatus>('loadROM', result.output, result.files);
    } catch (e) {
      output.appendLine(`Emulator failed to load: ${e && e.message || e}`);
      output.show(true);
    }
  }
}

/** Verilog designs: write the signals' changes for a few frames to a VCD file. */
async function recordVcd() {
  if (!emu?.started || !emuStatus?.vcd) {
    vscode.window.showInformationMessage('Run a Verilog design first; only designs with signals can be recorded.');
    return;
  }
  var dir = running ? vscode.Uri.joinPath(running.main, '..') : vscode.workspace.workspaceFolders?.[0]?.uri;
  var base = running ? path.basename(running.main.path).replace(/\.[^.]*$/, '') : 'trace';
  var file = await vscode.window.showSaveDialog({
    defaultUri: dir && vscode.Uri.joinPath(dir, base + '.vcd.gz'),
    filters: { 'Value change dump': ['vcd', 'gz'] },
    title: 'Record signals to a VCD file',
  });
  if (!file) return;
  // a VGA design writes about 3 MB a frame, so it stops by itself
  var answer = await vscode.window.showInputBox({
    title: 'Frames to record',
    prompt: 'Enter the number of frames to record. A design with video emits about 1-5 MB per frame, and runs more slowly while recording.',
    value: '2',
    validateInput: v => /^[1-9]\d*$/.test(v.trim()) ? undefined : 'Enter a whole number of frames',
  });
  if (!answer) return;
  try {
    await emu.call('startVcd', file.fsPath, Number(answer.trim()));
  } catch (e) {
    vscode.window.showErrorMessage(`Could not record: ${e && e.message || e}`);
  }
}

function vcdEvent(ev: VcdEvent) {
  vscode.commands.executeCommand('setContext', '8bitworkshop.recordingVcd', ev.recording);
  if (ev.recording) return;
  var limit = ev.full ? ', stopped at the 1 GB limit' : '';
  output.appendLine(`Wrote ${ev.clocks} clocks to ${ev.file} (${mb(ev.bytes || 0)}${limit})`);
  vscode.window.showInformationMessage(`Recorded ${ev.clocks} clocks (${mb(ev.bytes || 0)}) to ${path.basename(ev.file)}${limit}.`, 'Show in Folder')
    .then(choice => {
      if (choice) vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(ev.file));
    });
}

/** Turn sound on or off everywhere (the webview gain and the worker's push). */
function setMuted(m: boolean) {
  muted = m;
  context.globalState.update('muted', m);
  panel?.setMuted(m);
  if (emu?.started) emu.notify('setMuted', m);
  vscode.commands.executeCommand('setContext', '8bitworkshop.muted', m);
}

/** Same output and same load-time files (see BuildOutcome.files). */
function sameBuild(a: BuildOutcome | undefined, b: BuildOutcome): boolean {
  if (!a || !sameData(a.output, b.output)) return false;
  var af = a.files || {}, bf = b.files || {};
  var keys = Object.keys(bf);
  return keys.length === Object.keys(af).length && keys.every(k => sameData(af[k], bf[k]));
}

/** Compares ROM bytes, file text, or (verilog) the compiled unit. */
function sameData(a: any, b: any): boolean {
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  try {
    return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  } catch (e) {
    return false;  // not JSON (cycles): assume it changed
  }
}

/**
 * Write the build's ROM to <main dir>/<exportRomPath>/<main>.<romext>.
 * Off by default; only successful command/save builds export.
 */
async function exportRom(target: Target, rom: Uint8Array) {
  var cfg = config(target.main);
  if (!target.project || !cfg.get<boolean>('exportRom')) return;
  var dir = path.dirname(target.main.fsPath);
  var folder = cfg.get<string>('exportRomPath') || 'bin';
  var ext = templates.platform(target.platform)?.romext || '.bin';
  var name = path.basename(target.main.fsPath, path.extname(target.main.fsPath)) + ext;
  var out = path.resolve(dir, folder, name);
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(out)));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(out), rom);
    output.appendLine(`Exported ${path.relative(dir, out)} (${rom.length} bytes)`);
  } catch (e) {
    output.appendLine(`Cannot export ROM to ${out}: ${e && e.message || e}`);
  }
}

/** Build a target; unsaved editor contents win over disk. */
async function runBuild(target: Target, reason: BuildReason): Promise<BuildOutcome | undefined> {
  var main = target.main;
  // paths are relative to the main file's directory, like the IDE's project root
  var rootUri = vscode.Uri.joinPath(main, '..');
  var toUri = (rel: string) => vscode.Uri.joinPath(rootUri, rel);
  var read = async (rel: string): Promise<Uint8Array | null> => {
    var uri = toUri(rel);
    var doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (doc) return new TextEncoder().encode(doc.getText());
    try {
      return await vscode.workspace.fs.readFile(uri);
    } catch (e) {
      return null;
    }
  };
  var mainPath = path.posix.basename(main.path);
  var mainData = await read(mainPath);
  if (mainData == null) {
    vscode.window.showErrorMessage(`8bitworkshop: cannot read ${main.fsPath}`);
    return;
  }
  var t0 = Date.now();
  var buildId = nextBuildId++;
  readers.set(buildId, read);
  var args: BuildArgs = {
    buildId,
    platform: target.platform,
    mainPath,
    mainText: new TextDecoder().decode(mainData),
    tool: target.tool,
  };
  var result: BuildOutcome;
  if (reason !== 'type') status.text = '$(sync~spin) ' + platformName(templates, target.platform);
  try {
    var tool = target.tool || getToolForPlatform(target.platform, mainPath);
    result = await (await getBuilds(target.platform, tool, args.mainText)).call<BuildOutcome>('build', args);
  } catch (e) {
    if (e instanceof WorkerDisposedError) return;
    telemetry.reportError('worker', e, { platform: target.platform, tool: target.tool });
    output.appendLine(`Build crashed: ${e && e.stack || e}`);
    output.show(true);
    return;
  } finally {
    readers.delete(buildId);
    updateStatus();
  }
  if (result.internal) {
    telemetry.reportInternal('worker', result.internal, { tool: result.internal.tool, platform: result.internal.platform });
  }
  if (main.scheme === 'file' && target.project) {
    scope.recordBuild({
      project: target.project, target: main.fsPath, tool: result.tool,
      paths: result.paths.map(p => toUri(p).fsPath),
    });
  }
  if (result.unchanged) {
    // no rebuild: the last successful outcome stands. Clear any errors a later
    // failed build showed (the IDE does the same in ui.ts setCompileOutput),
    // and drop a held type-build error that would otherwise reappear.
    if (result.success) {
      releaseHeldDiagnostics();
      showDiagnostics(result, toUri);
    }
    return result;
  }
  var elapsed = Date.now() - t0;
  if (result.success) {
    releaseHeldDiagnostics();
    showDiagnostics(result, toUri);
    var size = result.output?.length ?? 0;
    var nwarn = result.diagnostics.length;
    output.appendLine(`${mainPath}: built with ${result.tool} for ${target.platform}, ${size} bytes${nwarn ? `, ${nwarn} warning(s)` : ''} (${elapsed} ms)`);
    for (var d of result.diagnostics) output.appendLine(`  ${d.path}:${d.line}: warning: ${d.msg}`);
    if (result.output && reason !== 'type') await exportRom(target, result.output);
  } else if (reason === 'type') {
    // half-typed code fails; hold the errors until the typing pauses
    holdDiagnostics(() => {
      showDiagnostics(result, toUri);
      logErrors(mainPath, result, elapsed);
    });
  } else {
    showDiagnostics(result, toUri);
    logErrors(mainPath, result, elapsed);
    output.show(true);
  }
  return result;
}

function logErrors(mainPath: string, result: BuildOutcome, elapsed: number) {
  var nerr = result.diagnostics.filter(d => d.severity !== 'warning').length;
  output.appendLine(`${mainPath}: ${nerr} error(s) from ${result.tool} (${elapsed} ms)`);
  for (var d of result.diagnostics) output.appendLine(`  ${d.path}:${d.line}: ${d.severity === 'warning' ? 'warning: ' : ''}${d.msg}`);
}

const HOLD_ERRORS_MS = 1000;

function holdDiagnostics(show: () => void) {
  releaseHeldDiagnostics(false);
  var wait = Math.max(0, scheduler.lastChange + HOLD_ERRORS_MS - Date.now());
  heldDiagnostics = { show, timer: setTimeout(() => releaseHeldDiagnostics(true), wait) };
}

function releaseHeldDiagnostics(show = false) {
  if (!heldDiagnostics) return;
  clearTimeout(heldDiagnostics.timer);
  if (show) heldDiagnostics.show();
  heldDiagnostics = undefined;
}

function showDiagnostics(result: BuildOutcome, toUri: (rel: string) => vscode.Uri) {
  diagnostics.clear();
  var byFile = new Map<string, { uri: vscode.Uri, diags: vscode.Diagnostic[] }>();
  for (var d of result.diagnostics) {
    var uri = toUri(d.path);
    var key = uri.toString();
    if (!byFile.has(key)) byFile.set(key, { uri, diags: [] });
    var line = Math.max(0, d.line - 1);
    var range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
    var severity = d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
    var diag = new vscode.Diagnostic(range, d.msg, severity);
    diag.source = result.tool;
    byFile.get(key)!.diags.push(diag);
  }
  for (var { uri, diags } of byFile.values()) diagnostics.set(uri, diags);
}

////// auto-build

/** The target a change to this document should rebuild, if any. */
function targetForDocument(doc: vscode.TextDocument): Target | undefined {
  if (doc.uri.scheme !== 'file') return undefined;
  var file = doc.uri.fsPath;
  // a file the running program or a recent build reads rebuilds that build
  if (running && running.main.scheme === 'file' && (running.main.fsPath === file || scope.lastBuildOf(running.main.fsPath)?.paths.includes(file)))
    return running;
  var reading = scope.buildsReading(file)[0];
  if (reading) {
    return { platform: reading.project.platform, main: vscode.Uri.file(reading.target), project: reading.project,
      tool: reading.target === reading.project.mainFile ? reading.project.tool : undefined };
  }
  // no build has read it yet: a source file in a project builds its target
  var project = scope.projectFor(doc.uri);
  if (project && isSourceFile(file)) return targetIn(project, doc.uri);
  return undefined;
}

function autoBuildMode(t: Target): string {
  var mode = config(t.main).get<string>('autoBuild', 'onType');
  // server tools cost the server and the network; build those on save
  var tool = lastTool(t) || t.tool || '';
  if (mode === 'onType' && (tool.startsWith('remote:') || TOOL_META[tool]?.remote)) return 'onSave';
  return mode;
}

function onChange(e: vscode.TextDocumentChangeEvent) {
  if (!e.contentChanges.length) return;
  var t = targetForDocument(e.document);
  if (!t || autoBuildMode(t) !== 'onType') return;
  // a header only matters once a build has read it
  if (isHeaderFile(e.document.fileName) && !scope.buildsReading(e.document.uri.fsPath).length) return;
  autoTarget = t;
  scheduler.changed();
  if (heldDiagnostics) holdDiagnostics(heldDiagnostics.show);
}

function onSave(doc: vscode.TextDocument) {
  var t = targetForDocument(doc);
  if (!t || autoBuildMode(t) === 'off') return;
  autoTarget = t;
  scheduler.now('save');
}

async function autoBuild(reason: BuildReason) {
  var t = autoTarget;
  if (!t) return;
  await buildAndMaybeRun(t, false, reason);
}

////// projects

/**
 * Case 2: make `uri` a project's main file. With no project, detect the
 * platform and save it. Returns false if the user backed out.
 */
async function setMainFile(uri?: vscode.Uri): Promise<boolean> {
  uri = uri || activeUri();
  if (!uri || uri.scheme !== 'file') return false;
  var file = uri.fsPath;
  var project = scope.projectFor(uri);
  if (project && project.origin !== 'build') {
    if (project.mainFile === file) return true;
    var dir = path.dirname(file);
    type Item = vscode.QuickPickItem & { id: string };
    var items: Item[] = [
      { id: 'main', label: `Make ${path.basename(file)} the main file`, detail: `Build and Run use it instead of ${project.mainFile ? path.basename(project.mainFile) : 'the active file'}.` },
      dir === project.scope
        ? { id: 'dir', label: 'Run each program in this folder on its own', detail: 'Build and Run use whichever program is open.' }
        : { id: 'sub', label: `Start a second project in ${path.relative(project.scope, dir)}`, detail: `A separate ${platformName(templates, project.platform)} project with ${path.basename(file)} as its main file.` },
    ];
    var picked = await vscode.window.showQuickPick(items, { title: `Set ${path.basename(file)} as Main File` });
    if (!picked) return false;
    if (picked.id === 'main') await scope.updateProject(project, { mainFile: file });
    else if (picked.id === 'dir') await scope.updateProject(project, { mainFile: null });
    else await scope.saveProject(dir, { platform: project.platform, mainFile: file });
    var next = scope.projectFor(uri) || project;
    if (isUrustProject(next.platform, next.tool)) await writeRustAnalyzerSettings(next.scope);
    await scope.setTargetChoice(next, undefined);
    return true;
  }
  var choice = await chooseForFile(templates, uri);
  if (!choice) return false;
  var dir = path.dirname(file);
  var saved = await scope.saveProject(dir, { platform: choice.platform, mainFile: file, tool: choice.tool });
  if (saved && isUrustProject(choice.platform, choice.tool)) await writeRustAnalyzerSettings(dir);
  if (!saved) {
    // no folder to save to: keep it for this window, and offer the folder
    scope.addWindowProject({ scope: dir, root: dir, platform: choice.platform, mainFile: file, tool: choice.tool, origin: 'window' });
    vscode.window.showInformationMessage(`${path.basename(file)} uses ${platformName(templates, choice.platform)} until you close this window.`, 'Open Containing Folder')
      .then(async a => {
        if (a !== 'Open Containing Folder') return;
        // write the settings first, so the folder opens as a project
        await writeFolderSettings(vscode.Uri.file(dir), { platform: choice.platform, mainFile: path.basename(file), tool: choice.tool });
        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir));
      });
  }
  return true;
}

/** .vscode/settings.json in `dir`: its contents, {} if there is none, or
 *  undefined if the file exists and can't be parsed (it has comments). */
async function readFolderSettings(dir: vscode.Uri): Promise<{ [key: string]: any } | undefined> {
  var file = vscode.Uri.joinPath(dir, '.vscode', 'settings.json');
  try {
    return JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(file)));
  } catch (e) {
    // no settings yet, or comments we can't parse: start fresh only if missing
    try { await vscode.workspace.fs.stat(file); return undefined; } catch (e2) { return {}; }
  }
}

async function writeFolderSettingsFile(dir: vscode.Uri, json: { [key: string]: any }) {
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(dir, '.vscode'));
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, '.vscode', 'settings.json'),
    new TextEncoder().encode(JSON.stringify(json, null, 2) + '\n'));
}

/**
 * Turn off rust-analyzer's cargo check, proc-macro expansion and Run/Debug
 * lenses for a urust project in `dir`. An open workspace folder is written
 * through VS Code's configuration API, so a settings.json with comments
 * survives and the change applies at once; a folder that isn't open gets a
 * merged .vscode/settings.json instead.
 */
async function writeRustAnalyzerSettings(dir: string): Promise<boolean> {
  var folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(dir));
  if (folder) {
    var cfg = vscode.workspace.getConfiguration('rust-analyzer', folder.uri);
    var target = (vscode.workspace.workspaceFolders || []).length > 1
      ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace;
    for (var key in RUST_ANALYZER_SETTINGS) {
      var name = key.replace(/^rust-analyzer\./, '');
      var i = cfg.inspect(name);
      var current = target === vscode.ConfigurationTarget.WorkspaceFolder ? i?.workspaceFolderValue : i?.workspaceValue;
      if (!sameSetting(current, RUST_ANALYZER_SETTINGS[key])) await cfg.update(name, RUST_ANALYZER_SETTINGS[key], target);
    }
    return true;
  }
  var uri = vscode.Uri.file(dir);
  var json = await readFolderSettings(uri);
  if (!json) return false;
  if (hasRustAnalyzerSettings(json)) return true;
  await writeFolderSettingsFile(uri, withRustAnalyzerSettings(json));
  return true;
}

/** Write .vscode/settings.json in a folder that isn't open yet. */
async function writeFolderSettings(dir: vscode.Uri, s: { platform: string, mainFile?: string, tool?: string }) {
  var json = await readFolderSettings(dir);
  if (!json) return;
  json[CONFIG + '.platform'] = s.platform;
  if (s.mainFile) json[CONFIG + '.mainFile'] = s.mainFile;
  if (s.tool) json[CONFIG + '.tool'] = s.tool;
  // urust has no Cargo target, so rust-analyzer's check only reports errors
  if (isUrustProject(s.platform, s.tool)) Object.assign(json, RUST_ANALYZER_SETTINGS);
  await writeFolderSettingsFile(dir, json);
  await writeExtensionRecommendations(dir);
}

/**
 * Command: write the rust-analyzer settings for the current urust project,
 * or (with a confirmation) for the folder of the Rust file in the editor.
 * rust-analyzer keeps parsing, highlighting, hover and navigation; it stops
 * running cargo check, expanding the rs8 macros and offering Run/Debug.
 */
async function setupRustAnalyzer() {
  var project = currentTarget()?.project || scope.projectFor(activeUri());
  var inProject = !!project && isUrustProject(project.platform, project.tool);
  var uri = activeUri();
  var dir = inProject ? project!.scope
    : uri && uri.scheme === 'file' && /\.rs$/i.test(uri.fsPath) ? path.dirname(uri.fsPath) : undefined;
  if (!dir) {
    vscode.window.showInformationMessage('8bitworkshop: open a Rust file or set a urust project as the main file first.');
    return;
  }
  if (!inProject) {
    // a plain Rust folder may hold crates of its own, so ask once
    var answer = await vscode.window.showWarningMessage(
      "Turn off rust-analyzer's cargo check, unresolved-name diagnostics, rs8 macro expansion and Run/Debug lenses for this workspace folder? " +
      'Every Rust project in the workspace folder is affected.', { modal: true }, 'Turn Off');
    if (answer !== 'Turn Off') return;
  }
  if (!await writeRustAnalyzerSettings(dir)) {
    vscode.window.showWarningMessage(`8bitworkshop: could not update the rust-analyzer settings for ${dir}.`);
    return;
  }
  vscode.window.showInformationMessage(
    '8bitworkshop: rust-analyzer will parse Rust without running cargo, expanding the rs8 macros, ' +
    'or showing urust errors in this workspace folder.');
}

/**
 * VS Code offers the C/C++ extension for every .c file, but its IntelliSense
 * can't find cc65/SDCC headers and only adds false errors. Declining it in
 * .vscode/extensions.json is the only way to stop the prompt for a folder.
 */
async function writeExtensionRecommendations(dir: vscode.Uri) {
  var file = vscode.Uri.joinPath(dir, '.vscode', 'extensions.json');
  try { await vscode.workspace.fs.stat(file); return; } catch (e) { }  // leave the user's alone
  var json = {
    recommendations: ['8bitworkshop.8bitworkshop'],
    unwantedRecommendations: ['ms-vscode.cpptools', 'ms-vscode.cpptools-extension-pack'],
  };
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(json, null, 2) + '\n'));
}

async function changeMainFile() {
  var project = currentTarget()?.project;
  if (!project) return setMainFile();
  var files = await vscode.workspace.findFiles(new vscode.RelativePattern(project.scope, '**/*'), '{**/node_modules/**,**/.git/**}', 500);
  var mains = files.filter(u => isSourceFile(u.fsPath) && !isHeaderFile(u.fsPath));
  type Item = vscode.QuickPickItem & { file?: string };
  var items: Item[] = mains.map(u => ({ label: path.relative(project.scope, u.fsPath), file: u.fsPath,
    description: u.fsPath === project.mainFile ? 'current' : undefined }));
  items.push({ label: '(none: run whichever program is open)' });
  var picked = await vscode.window.showQuickPick(items, { title: 'Main file' });
  if (!picked) return;
  await scope.updateProject(project, { mainFile: picked.file || null });
  await scope.setTargetChoice(project, undefined);
}

async function changePlatform() {
  var uri = activeUri();
  var project = currentTarget()?.project || scope.projectFor(uri);
  if (!project) {
    if (uri && uri.scheme === 'file') await setMainFile(uri);
    return;
  }
  var picked = await templates.pickPlatform('Change platform', project.platform);
  if (!picked || picked.id === project.platform) return;
  await scope.updateProject(project, { platform: picked.id });
  vscode.window.showInformationMessage(`Now building for ${picked.name}.`);
  var target = currentTarget();
  if (target) await buildAndMaybeRun(target, emulatorOpen(), 'command');
}

async function detectAgain(project: Project) {
  var main = project.mainFile || running?.main.fsPath || activeUri()?.fsPath;
  if (!main) return;
  var choice = await chooseForFile(templates, vscode.Uri.file(main));
  if (choice) await scope.updateProject(project, { platform: choice.platform, tool: choice.tool || null });
}

/**
 * Remove a project's settings, so it stops building and detection can offer
 * it again. A project that comes from a README badge lives in the README.
 */
async function removeProject() {
  var uri = activeUri();
  var project = currentTarget()?.project || scope.projectFor(uri);
  if (!project) {
    vscode.window.showInformationMessage("8bitworkshop: this file isn't part of a project.");
    return;
  }
  if (project.origin === 'readme') {
    var readme = vscode.Uri.joinPath(vscode.Uri.file(project.folder || project.scope), 'README.md');
    var open = await vscode.window.showInformationMessage(
      'This project comes from the 8bitworkshop link in README.md, not from settings.', 'Open README.md');
    if (open === 'Open README.md') vscode.window.showTextDocument(readme).then(undefined, e => output.appendLine(`readme: ${e}`));
    return;
  }
  var where = project.origin === 'settings' ? 'this folder'
    : project.folder ? path.relative(project.folder, project.scope) : project.scope;
  var answer = await vscode.window.showWarningMessage(
    `Remove the ${platformName(templates, project.platform)} project for ${where}?`,
    { modal: true, detail: 'Build and Run stop treating these files as 8bitworkshop. Detection may offer the project again when the folder reopens.' },
    'Remove Project');
  if (answer !== 'Remove Project') return;
  if (await scope.removeProject(project)) vscode.window.showInformationMessage('8bitworkshop: project removed.');
  else vscode.window.showWarningMessage("8bitworkshop: couldn't remove this project from settings.");
}

////// templates

async function newProject(platformId?: string) {
  var platform = platformId ? templates.platform(platformId) : await templates.pickPlatform('New 8bitworkshop Project', currentTarget()?.platform);
  if (!platform) return;
  var template = await templates.pickTemplate(platform, `New ${platform.name} Project`);
  if (!template) return;
  await createFromTemplate(platform.id, template.id);
}

async function openExample() {
  var platform = await templates.pickPlatform('Open Example', currentTarget()?.platform);
  if (!platform) return;
  var template = await templates.pickTemplate(platform, `${platform.name} Examples`);
  if (!template) return;
  await vscode.window.showTextDocument(templates.presetUri(platform, template), { preview: false });
}

async function copyToWorkspace(uri?: vscode.Uri) {
  uri = uri && uri.scheme === PRESET_SCHEME ? uri : activeUri();
  var found = uri && templates.fromUri(uri);
  if (!found || !found.template) {
    vscode.window.showWarningMessage('8bitworkshop: open an example first.');
    return;
  }
  await createFromTemplate(found.platform.id, found.template.id, uri);
}

async function createFromTemplate(platformId: string, templateId: string, replacing?: vscode.Uri) {
  var platform = templates.platform(platformId);
  var t = platform.templates.find(x => x.id === templateId);
  var name = t.saveAs ? `${platform.dir}-project` : t.id;
  var dest = await templates.pickDestination(name);
  if (!dest) return;
  var withLibraries = false;
  if (t.shared.length) {
    var answer = await vscode.window.showQuickPick([
      { label: 'Copy the program', description: 'recommended', detail: `Library files (${t.shared.slice(0, 3).join(', ')}${t.shared.length > 3 ? ', ...' : ''}) still build from the examples.`, lib: false },
      { label: 'Also copy library files', detail: 'To edit them, or to build without the extension.', lib: true },
    ], { title: `Copy ${t.name}` });
    if (!answer) return;
    withLibraries = answer.lib;
  }
  var main = await templates.copy(platform, t, dest.dir, withLibraries);
  if (!main) return;
  if (isUrustProject(platform.id, t.tool)) await writeRustAnalyzerSettings(dest.dir.fsPath);
  await writeReadme(dest.dir, platform, path.relative(dest.dir.fsPath, main.fsPath).split(path.sep).join('/'));
  var settings = { platform: platform.id, mainFile: main.fsPath };
  if (dest.open) {
    await writeFolderSettings(dest.dir, { platform: platform.id, mainFile: path.basename(main.fsPath) });
    await vscode.commands.executeCommand('vscode.openFolder', dest.dir, { forceNewWindow: !!vscode.workspace.workspaceFolders?.length });
    return;
  }
  await scope.saveProject(dest.dir.fsPath, settings);
  if (replacing) await closeEditor(replacing);
  await openAndBuild(main.fsPath, false);
}

/** A README with build instructions, unless the folder has one. */
async function writeReadme(dir: vscode.Uri, platform: PlatformInfo, mainFile: string) {
  var readme = vscode.Uri.joinPath(dir, 'README.md');
  try {
    await vscode.workspace.fs.stat(readme);
    return;
  } catch (e) {
    // none yet
  }
  var text = projectReadme(path.basename(dir.fsPath), platform, mainFile);
  await vscode.workspace.fs.writeFile(readme, new TextEncoder().encode(text));
}

async function closeEditor(uri: vscode.Uri) {
  for (var group of vscode.window.tabGroups.all) {
    for (var tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()) await vscode.window.tabGroups.close(tab);
    }
  }
}

////// detection on open (case 3)

interface FolderOffer {
  folder: vscode.WorkspaceFolder;
  strong: FolderFinding[];
  potential: FolderFinding[];
}

// resolves when the latest folder scan is done (not its prompts)
let folderScans: Promise<void> = Promise.resolve();

/**
 * Scan the workspace folders and offer what they hold. Resolves once the
 * scans are done; the prompts carry on.
 */
function detectProjects(asked: boolean): Promise<void> {
  var scans = scanForOffers(asked);
  scans.then(offers => offerFindings(offers, asked)).catch(e => output.appendLine(`detect: ${e}`));
  return folderScans = scans.then(() => undefined, () => undefined);
}

async function scanForOffers(asked: boolean): Promise<FolderOffer[]> {
  var offers: FolderOffer[] = [];
  for (var folder of vscode.workspace.workspaceFolders || []) {
    if (folder.uri.scheme !== 'file') continue;
    if (!asked && (scope.folderHasProject(folder) || context.workspaceState.get(dontAskKey(folder)))) continue;
    var scan = await scanFolder(templates, folder);
    // folders with settings keep them
    var findings = scan.findings.filter(f => !scope.projects().some(p => p.origin !== 'build' && isInside(p.scope, f.dir.fsPath)));
    var strong = findings.filter(f => !f.potential);
    // weak evidence is offered only when the user asks
    var potential = asked ? findings.filter(f => f.potential) : [];
    // unasked, a big repo with projects scattered through it isn't ours;
    // opening a file in one of them still asks
    if (!asked && (scan.truncated || !scan.madeOfProjects)) continue;
    if (!strong.length && !potential.length) {
      if (asked) vscode.window.showInformationMessage(`No 8bitworkshop projects found in ${folder.name}.`);
      continue;
    }
    // this prompt speaks for the folder; opening a file in it won't ask again
    for (var f of findings) dirGuesses.set(f.dir.fsPath, f.detection);
    quietFolders.add(folder.uri.toString());
    offers.push({ folder, strong, potential });
  }
  return offers;
}

async function offerFindings(offers: FolderOffer[], asked: boolean) {
  for (var { folder, strong, potential } of offers) {
    if (strong.length === 1 && !potential.length) {
      await offerProject(folder, strong[0].dir, strong[0].detection, asked);
      continue;
    }
    var plural = (n: number) => n === 1 ? '' : 's';
    var message = strong.length
      ? `Found ${strong.length} 8bitworkshop project${plural(strong.length)}${potential.length ? ` and ${potential.length} potential` : ''} in ${folder.name}.`
      : `Found ${potential.length} potential 8bitworkshop project${plural(potential.length)} in ${folder.name}.`;
    // "Don't Ask" only makes sense on a prompt the user didn't ask for
    var review = await vscode.window.showInformationMessage(message, 'Review', 'Not Now', ...(asked ? [] : ["Don't Ask"]));
    if (review === "Don't Ask") await context.workspaceState.update(dontAskKey(folder), true);
    if (review === 'Review') await reviewFindings(folder, [...strong, ...potential]);
  }
}

/**
 * Offer one directory as a project. `prefer` is a program the user opened:
 * it becomes the main file in place of the detector's pick. Returns true if
 * the user took the offer.
 */
async function offerProject(folder: vscode.WorkspaceFolder | undefined, dir: vscode.Uri, d: Detection, asked: boolean, prefer?: string): Promise<boolean> {
  var where = folder ? path.relative(folder.uri.fsPath, dir.fsPath) : '';
  var name = platformName(templates, d.platform);
  // a sure thing needs no clue; just say what it found
  var why = d.score >= 1 ? detectionSummary(d) : describeFinding(d);
  var answer = await vscode.window.showInformationMessage(
    `This looks like a${/^[aeiou]/i.test(name) ? 'n' : ''} ${name} project${where ? ' in ' + where : ''}${why ? ` (${why})` : ''}.`,
    'Use It', 'Choose...', 'Not Now', ...(asked || !folder ? [] : ["Don't Ask"]));
  if (answer === 'Use It') {
    await openAndBuild(await acceptFinding(dir.fsPath, d, d.platform, prefer), true);
    return true;
  }
  if (answer === 'Choose...') {
    var picked = await templates.pickPlatform('Platform for this folder', d.platform);
    if (picked) await openAndBuild(await acceptFinding(dir.fsPath, d, picked.id, prefer), true);
    return !!picked;
  }
  if (answer === "Don't Ask" && folder) await context.workspaceState.update(dontAskKey(folder), true);
  return false;
}

////// detection on opening a file

// directories detected this session, with the best guess if any
const dirGuesses = new Map<string, Detection | undefined>();
// workspace folders not to prompt in again this session
const quietFolders = new Set<string>();

/**
 * Opening a source file in a directory with no project detects that
 * directory, once a session: a strong guess prompts, a weaker one only
 * shows in the status bar.
 */
async function detectForActiveFile() {
  var uri = activeUri();
  if (!uri || uri.scheme !== 'file' || currentTarget() || !isBuildableSource(uri.fsPath)) return;
  await folderScans;
  var dir = path.dirname(uri.fsPath);
  if (dirGuesses.has(dir) || currentTarget()) return;
  dirGuesses.set(dir, undefined);
  var found = await detectDirectoryAt(templates, vscode.Uri.file(dir));
  var kind = classifyFinding(found);
  if (!kind) return;
  dirGuesses.set(dir, found[0]);
  updateStatus();
  if (kind !== 'project') return;
  var folder = vscode.workspace.getWorkspaceFolder(uri);
  var key = folder?.uri.toString() || dir;
  if (quietFolders.has(key) || (folder && context.workspaceState.get(dontAskKey(folder)))) return;
  // the file the user opened wins over the detector's pick, when it's a program
  var name = path.basename(uri.fsPath);
  var prefer = found[0].mainCandidates?.includes(name) ? name : undefined;
  // one prompt at a time; turning it down quiets the folder for the session
  quietFolders.add(key);
  if (await offerProject(folder, vscode.Uri.file(dir), found[0], false, prefer)) quietFolders.delete(key);
}

/** Let the user pick which findings to keep as projects. */
async function reviewFindings(folder: vscode.WorkspaceFolder, findings: FolderFinding[]) {
  type Item = vscode.QuickPickItem & { f: FolderFinding };
  var items: Item[] = findings.map(f => ({
    label: path.relative(folder.uri.fsPath, f.dir.fsPath) || '.',
    description: `${platformName(templates, f.detection.platform)}${detectionSummary(f.detection) ? ' · ' + detectionSummary(f.detection) : ''}${f.potential ? ' · potential' : ''}`,
    detail: describeFinding(f.detection), picked: !f.potential, f,
  }));
  var chosen = await vscode.window.showQuickPick(items, { canPickMany: true, title: 'Use these as 8bitworkshop projects', matchOnDetail: true });
  if (!chosen?.length) return;
  var files: (string | undefined)[] = [];
  for (var c of chosen) files.push(await acceptFinding(c.f.dir.fsPath, c.f.detection));
  // build the rest in the background of the first, which opens
  for (var file of files.slice(1)) if (file) await buildFile(file);
  await openAndBuild(files[0], true);
}

/**
 * Save a detected project, on the platform the user chose if not the
 * detected one. Returns the file to open: the main file, or a folder of
 * programs' first program.
 */
async function acceptFinding(dir: string, d: Detection, platform = d.platform, prefer?: string): Promise<string | undefined> {
  var tool = platform === d.platform ? d.tool : undefined;
  // a program the user opened is the main file, even when the detector
  // preferred another one (or saw a folder of programs with none)
  var file = prefer && d.mainCandidates?.includes(prefer) ? prefer : d.mainFile || d.mainCandidates?.[0];
  var mainFile = prefer && file === prefer ? file : d.mainFile;
  await scope.saveProject(dir, { platform, mainFile: mainFile ? path.join(dir, mainFile) : undefined, tool });
  if (isUrustProject(platform, tool)) await writeRustAnalyzerSettings(dir);
  return file && path.join(dir, file);
}

////// after a project appears

// set once this workspace has shown the user a project's file
const WELCOMED = 'welcomed';

/**
 * Open a project's file and build it, so the Run button and the result
 * are in view. The emulator never starts unasked; with `offerRun`, a good
 * build offers it.
 */
async function openAndBuild(file: string | undefined, offerRun: boolean) {
  if (!file) return;
  await context.workspaceState.update(WELCOMED, true);
  var uri = vscode.Uri.file(file);
  await vscode.window.showTextDocument(uri, { preview: false });
  var project = scope.projectFor(uri);
  var target = project && targetIn(project, uri);
  if (!target) return;
  // with the emulator open, the new program just replaces what it runs
  if (emulatorOpen()) return buildAndMaybeRun(target, false, 'command');
  var result = await runBuild(target, 'command');
  if (!offerRun || !result?.success) return;
  var answer = await vscode.window.showInformationMessage(
    `Built ${describeTarget(target)} for ${platformName(templates, target.platform)}.`, 'Run');
  if (answer === 'Run') await buildAndMaybeRun(target, true, 'command');
}

/** Build a project's file without opening it; errors go to Problems. */
async function buildFile(file: string) {
  var uri = vscode.Uri.file(file);
  var project = scope.projectFor(uri);
  var target = project && targetIn(project, uri);
  if (target) await runBuild(target, 'command');
}

/**
 * The first time a folder with a project opens (a README badge, or a new
 * project opened in a new window), open its main file and build it,
 * unless the user already has editors open.
 */
async function welcomeProject() {
  if (context.workspaceState.get(WELCOMED)) return;
  var project = scope.projects().find(p => p.mainFile && (p.origin === 'settings' || p.origin === 'folders' || p.origin === 'readme'));
  if (!project) return;
  await context.workspaceState.update(WELCOMED, true);
  if (vscode.window.tabGroups.all.some(g => g.tabs.length)) return;
  await openAndBuild(project.mainFile, false);
}

////// launch configurations

async function addLaunchConfiguration() {
  var target = currentTarget();
  var project = target?.project;
  if (!target || !project?.folder) return;
  var folderUri = vscode.Uri.file(project.folder);
  var launch = vscode.workspace.getConfiguration('launch', folderUri);
  var configs = (launch.get<any[]>('configurations') || []).slice();
  var rel = path.relative(project.folder, target.main.fsPath).split(path.sep).join('/');
  var name = `Run ${path.basename(rel)} (${platformName(templates, target.platform)})`;
  if (configs.some(c => c.type === '8bitworkshop' && c.mainFile === rel && c.platform === target.platform)) {
    vscode.window.showInformationMessage(`"${name}" is already in launch.json.`);
    return;
  }
  var entry: any = { type: '8bitworkshop', request: 'launch', name, platform: target.platform, mainFile: rel };
  if (target.tool) entry.tool = target.tool;
  configs.push(entry);
  await launch.update('configurations', configs, vscode.ConfigurationTarget.WorkspaceFolder);
  vscode.window.showInformationMessage(`Added "${name}" to launch.json. Choose it in Run and Debug, then press F5.`);
}

async function runLaunchConfiguration(folder: vscode.WorkspaceFolder | undefined, cfg: vscode.DebugConfiguration) {
  if (!cfg.mainFile) {
    // Ctrl+F5 with no launch.json: run the current target
    return buildCommand(true);
  }
  var target = await launchTarget(folder, cfg);
  await buildAndMaybeRun(target, true, 'command');
}

/** What a launch configuration runs: its mainFile, or the current target. */
async function launchTarget(folder: vscode.WorkspaceFolder | undefined, cfg: { name?: string, mainFile?: string, platform?: string, tool?: string }): Promise<Target> {
  var base = folder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cfg.mainFile || !base) {
    var current = currentTarget();
    if (!current) throw new Error('open a program to debug, or set mainFile in the launch configuration');
    return current;
  }
  var file = path.resolve(base, cfg.mainFile);
  var project = scope.projectFor(vscode.Uri.file(file));
  var platform = cfg.platform || project?.platform;
  if (!platform) throw new Error(`launch configuration "${cfg.name}" needs a platform`);
  if (project) await scope.setTargetChoice(project, file);
  return { platform, main: vscode.Uri.file(file), tool: cfg.tool, project };
}

/**
 * A debug session over the emulator worker. The adapter (shared with
 * `8bws dap`) runs here in the extension host; the debugger itself runs in
 * the worker, next to the emulator.
 */
function newDebugSession(session: vscode.DebugSession): EmuDebugSession {
  // the worker this session launched; a later Run starts another
  var worker: WorkerHandle | undefined;
  var backend = new WorkerDebugBackend(
    (method, ...args) => {
      if (!worker || worker !== emu) throw new Error('the emulator this session started has stopped');
      return worker.call('debug', method, ...args);
    },
    async args => {
      var r = await launchForDebug(session.workspaceFolder, args);
      worker = emu;
      return r;
    },
    async () => {
      if (debugging?.session === session) debugging = undefined;
      // stopping the debugger leaves the program running, as Run would,
      // unless another run has replaced it since
      if (worker && worker === emu) {
        await worker.call('debug', 'setBreakpoints', []);
        await worker.call('resume');
      }
    });
  debugging = { session, backend };
  return new EmuDebugSession(backend);
}

/** Build the program and load it stopped, with its listings for the debugger. */
async function launchForDebug(folder: vscode.WorkspaceFolder | undefined, args: LaunchArgs): Promise<{ root: string }> {
  var target = await launchTarget(folder, args);
  var result = await runBuild(target, 'command');
  if (!result || !result.success) throw new Error('the build failed; see Problems');
  if (!result.output) throw new Error('the build produced no ROM to run');
  if (!await startEmulator(target, result, { paused: true })) throw new Error('the emulator failed to start; see Output');
  var mainPath = path.posix.basename(target.main.path);
  await emu!.call('debug', 'setBuild', { ...buildProducts(result), mainPath, paths: result.paths });
  return { root: path.dirname(target.main.fsPath) };
}
