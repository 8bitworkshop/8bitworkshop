
// 8bitworkshop IDE user interface

import * as localforage from "localforage";
import { BaseDebugPlatform, DebugEvalCondition, DebugSymbols, EmuState, isDebuggable, Platform, Preset } from "../common/baseplatform";
import { EmuHalt, PLATFORMS, setHaltHandler } from "../common/emu";
import { BOOKS, bookFor, firstVisitDemo } from "../common/books";
import { PLATFORM_CONTROLS } from "../common/controls";
import { isAudioBlocked, onAudioStateChange } from "../common/audio";
import { installHDLHost } from "./hdlhost";
import { StateRecorderImpl } from "../common/recorder";
import {
  arrayCompare, byteArrayToUTF8, bytesToFileData, decodeQueryString, getBasePlatform, getCookie, getFilenameForPath, getFilenamePrefix,
  getRootBasePlatform, getWithBinary, hex, highlightDifferences, isProbablyBinary, isProductionHost, loadScript, parseBool, stringToByteArray
} from "../common/util";
import { getSkeletonName, getPlatformToolHelpURL, getToolMeta, getToolVersionLabel, TOOL_META } from "../common/toolmeta";
import { getAppVersionLabel } from "../common/version";
import { PLATFORM_PARAMS } from "../worker/platforms";
import { hasErrors } from "../worker/listingutils";
import { CodeListingMap, FileData, WorkerError, WorkerResult, isErrorResult } from "../common/workertypes";
import { reportErrorToServer, reportInternalError } from "./errorreport";
import { importPlatform } from "../platform/_index";
import { alertError, alertInfo, fatalError, setWaitDialog } from "./dialogs";
import { openSettings, loadSettings } from "./settings";
import { getPersistStatusMessage, getQuotaExceededMessage, requestPersistentStorage } from "./storage";
import { CodeProject, createNewPersistentStore, LocalForageFilesystem, OverlayFilesystem, ProjectFilesystem, WebPresetsFileSystem } from "./project";
import { getRepos, parseGithubURL } from "./services";
import { _downloadAllFilesZipFile, _downloadCassetteFile, _downloadProjectZipFile, _downloadROMImage, _downloadSourceFile, _downloadSymFile, _getCassetteFunction, _recordVideo, _shareEmbedLink } from "./shareexport";
import { _importProjectFromGithub, _loginToGithub, _logoutOfGithub, _publishProjectToGithub, _pullProjectFromGithub, _pushProjectToGithub, _removeRepository, importProjectFromGithub } from "./sync";
import { Toolbar } from "./toolbar";
import { Shortcut, initShortcutBar, setGlobalShortcutsFn, setViewShortcutsFn, setBarVisible, refreshShortcutBar } from "./shortcutbar";
import { openSearchDialog } from "./search/searchview";
import { resolveDebuggerTarget } from "./search/debuggerhit";
import { setProjectProvider } from "./search/projectsource";
import { AssetEditorView } from "./views/asseteditor";
import { isMobileDevice } from "./views/baseviews";
import { AddressHeatMapView, BinaryFileView, BreakpointsView, MemoryMapView, MemoryView, ProbeLogView, ProbeSymbolView, RasterStackMapView, ScanlineIOView, VRAMMemoryView } from "./views/debugviews";
import { DisassemblerView, HeaderView, ListingView, PC_LINE_LOOKAHEAD, SourceEditor, setUppercaseOnly } from "./views/editors";
import { HELP_TOPICS, HelpView, helpDescriptionForView, helpTopicForView } from "./views/helpview";
import { elementHelpTopicForFocus } from "./helptopics";
import { CallGraphView, DebugBrowserView } from "./views/treeviews";
import { ProjectWindows } from "./windows";
import { setupSplits, showTab } from "./layout";
export { setupSplits, showTab };
import { bpStore, canUseBreakpoints, resolveBreakpoints } from "./breakpoints";
import { CondFn } from "../common/breakcond";
import { findListingLocation as findListingLocationPure } from "./search/listinglocation";
import DOMPurify = require("dompurify");

// external libs (TODO)
declare var __BUILD_ID__: string; // defined by scripts/build.mjs
declare var Tour;
declare var $: JQueryStatic; // use browser jquery

// query string

interface UIQueryString {
  platform?: string;
  options?: string;
  repo?: string;
  file?: string;
  electron?: string;
  importURL?: string;
  githubURL?: string;
  localfs?: string;
  newfile?: string;
  embed?: string;
  ignore?: string;
  force?: string;
  highlight?: string;
  file0_name?: string;
  file0_data?: string;
  file0_type?: string;
  tool?: string;
}

/// EXPORTED GLOBALS (TODO: remove)

export var qs = decodeQueryString(window.location.search || '?') as UIQueryString;

export var platform_id: string;	// platform ID string (platform)
export var store_id: string;		// store ID string (repo || platform)
export var repo_id: string;		// repository ID (repo)
export var platform: Platform;		// emulator object
export var current_project: CodeProject;	// current CodeProject object
export var projectWindows: ProjectWindows;	// window manager
export var lastDebugState: EmuState;	// last debug state (object)

// private globals

var compparams;			// received build params from worker
var platform_name: string;	// platform name (after setPlatformUI)
var toolbar = $("#controls_top");
var uitoolbar: Toolbar;
var stateRecorder: StateRecorderImpl;
var userPaused: boolean;		// did user explicitly pause?
var tabPausedEmulator = false;	// did a tab switch (mobile tab mode) pause the emulator?
var debugSessionActive: boolean;	// has the user entered a debug session? (drives debug shortcut chips)
var current_output: any;     // current ROM (or other object)
var current_preset: Preset;	// current preset object (if selected)
var store: LocalForage;			// persistent store

const isElectron = parseBool(qs.electron);
const isEmbed = parseBool(qs.embed);


type DebugCommandType = null
  | 'toline' | 'step' | 'stepout' | 'stepover'
  | 'tovsync' | 'stepback' | 'restart';

var lastDebugInfo;		// last debug info (CPU text)
var debugCategory;		// current debug category
var debugTickPaused = false;
var recorderActive = false;
var lastViewClicked: string = null;
var lastDebugCommand: DebugCommandType = null;
var errorWasRuntime = false;
var lastBreakExpr = "c.PC == 0x6000";

export function getPlatformStore() {
  return store;
}
export function getCurrentProject() {
  return current_project;
}
export function getCurrentOutput() {
  return current_output;
}
export function getWorkerParams() {
  return compparams;
}

// editor styles and help URLs live in the tool registry (src/common/toolmeta.ts)

function newWorker(): Worker {
  // TODO: return new Worker("https://8bitworkshop.com.s3-website-us-east-1.amazonaws.com/dev/gen/worker/bundle.js");
  // The build id in the query string makes Firefox refetch the bundle after a
  // rebuild (hard reload doesn't cover workers); the worker reuses it for its
  // own fetches via cacheBust().
  return new Worker("./gen/worker/bundle.js" + (typeof __BUILD_ID__ != 'undefined' ? '?v=' + __BUILD_ID__ : ''));
}

const hasLocalStorage: boolean = function () {
  try {
    const key = "__some_random_key_you_are_not_going_to_use__";
    localStorage.setItem(key, key);
    var has = localStorage.getItem(key) == key;
    localStorage.removeItem(key);
    return has;
  } catch (e) {
    return false;
  }
}();

// wrapper for localstorage
class UserPrefs {
  setLastPreset(id: string) {
    if (hasLocalStorage && !isEmbed) {
      if (repo_id && platform_id && !isElectron)
        localStorage.setItem("__lastrepo_" + platform_id, repo_id);
      else
        localStorage.removeItem("__lastrepo_" + platform_id);
      localStorage.setItem("__lastplatform", platform_id);
      localStorage.setItem("__lastid_" + store_id, id);
    }
  }
  unsetLastPreset() {
    if (hasLocalStorage && !isEmbed) {
      delete qs.file;
      localStorage.removeItem("__lastid_" + store_id);
    }
  }
  getLastPreset() {
    return hasLocalStorage && !isEmbed && localStorage.getItem("__lastid_" + store_id);
  }
  getLastPlatformID() {
    return hasLocalStorage && !isEmbed && localStorage.getItem("__lastplatform");
  }
  getLastRepoID(platform: string) {
    return hasLocalStorage && !isEmbed && platform && localStorage.getItem("__lastrepo_" + platform);
  }
  // no platform has ever been loaded in this browser, so this is a first launch
  isFirstVisit() {
    return hasLocalStorage && !isEmbed && !localStorage.getItem("__lastplatform");
  }
  shouldCompleteTour() {
    return hasLocalStorage && !isEmbed && !localStorage.getItem("8bitworkshop.hello");
  }
  completedTour() {
    if (hasLocalStorage && !isEmbed) localStorage.setItem("8bitworkshop.hello", "true");
  }
  // we only nag about non-persistent storage once per browser
  shouldWarnAboutPersistence() {
    return hasLocalStorage && !isEmbed && !localStorage.getItem("8bitworkshop.persistwarn");
  }
  warnedAboutPersistence() {
    if (hasLocalStorage && !isEmbed) localStorage.setItem("8bitworkshop.persistwarn", "true");
  }
}

var userPrefs = new UserPrefs();

// Ask the browser to keep our IndexedDB data around.
// A denial is normal (Chrome/Safari decide on their own and never prompt), so
// we treat it as advice rather than an error, and only say it once.
// https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
async function requestPersistPermission(interactive: boolean, failureonly: boolean) {
  if (isElectron) {
    // desktop version stores files in the local filesystem
    interactive && alertInfo("The desktop version keeps your files in the \"8bitworkshop\" directory, so browser storage permissions don't apply.");
    return;
  }
  if (isEmbed) {
    // third-party frames are always denied, so don't even ask
    interactive && alertInfo("Embedded pages can't be granted persistent storage. Open 8bitworkshop in its own tab to keep your edits.");
    return;
  }
  var status = await requestPersistentStorage();
  console.log("requestPersistPermission =", status);
  if (!interactive) return;
  if (status.persisted && failureonly) return; // nothing worth interrupting for
  // don't repeat the bad news on every new file, only when the user asks
  if (!status.persisted && failureonly) {
    if (!userPrefs.shouldWarnAboutPersistence()) return;
    userPrefs.warnedAboutPersistence();
  }
  alertInfo(getPersistStatusMessage(status, true));
}

var warnedQuotaExceeded = false;

async function storageQuotaExceeded() {
  if (warnedQuotaExceeded) return;
  warnedQuotaExceeded = true;
  // requesting persistence can expand the quota, so try that before complaining
  var status = await requestPersistentStorage();
  console.log("storageQuotaExceeded =", status);
  alertError(getQuotaExceededMessage(status));
}

function getCurrentPresetTitle(): string {
  if (!current_preset)
    return current_project.mainPath || "ROM";
  else
    return current_preset.title || current_preset.name || current_project.mainPath || "ROM";
}

async function newFilesystem() {
  var basefs: ProjectFilesystem = new WebPresetsFileSystem(platform_id);
  if (isElectron) {
    console.log('using electron with local filesystem', alternateLocalFilesystem);
    return new OverlayFilesystem(basefs, alternateLocalFilesystem);
  } else if (qs.localfs != null) {
    return new OverlayFilesystem(basefs, await getLocalFilesystem(qs.localfs));
  } else {
    return new OverlayFilesystem(basefs, new LocalForageFilesystem(store));
  }
}

async function initProject() {
  var filesystem = await newFilesystem();
  current_project = new CodeProject(newWorker(), platform_id, platform, filesystem);
  setProjectProvider(() => current_project);
  current_project.remoteTool = qs.tool || null;
  projectWindows = new ProjectWindows($("#workspace")[0] as HTMLElement, current_project);
  current_project.callbackBuildResult = (result: WorkerResult) => {
    if (isErrorResult(result) && result.internal && isProductionHost()) {
      reportInternalError('worker', result.internal, { tool: result.internal.tool, platform: result.internal.platform });
    }
    setCompileOutput(result);
  };
  current_project.callbackBuildStatus = (busy: boolean) => {
    setBusyStatus(busy);
  };
  // Update file views when file contents change.
  current_project.onFileChanged = (path: string, data: FileData) => {
    var wnd = projectWindows.id2window[path];
    if (wnd) {
      if (wnd instanceof SourceEditor && typeof data === 'string') {
        wnd.setText(data);
      } else if (wnd instanceof BinaryFileView && data instanceof Uint8Array) {
        wnd.setData(data);
      } else {
        console.warn('onFileChanged: unknown view or data type');
      }
    }
    // Also refresh the asset editor if it's the active view.
    var assetWnd = projectWindows.id2window['#asseteditor'];
    if (assetWnd && assetWnd === projectWindows.getActive()) {
      assetWnd.refresh(true);
    }
  };
}

function setBusyStatus(busy: boolean) {
  if (busy) {
    toolbar.addClass("is-busy");
  } else {
    toolbar.removeClass("is-busy");
  }
  $('#compile_spinner').css('visibility', busy ? 'visible' : 'hidden');
}

function newDropdownListItem(id, text) {
  var li = document.createElement("li");
  var a = document.createElement("a");
  a.setAttribute("class", "dropdown-item");
  var hash = id.startsWith('#') ? id : '#' + encodeURIComponent(id);
  a.setAttribute("href", hash);
  if (id == projectWindows.getActiveID())
    $(a).addClass("dropdown-item-checked");
  a.appendChild(document.createTextNode(text));
  li.appendChild(a);
  return { li, a };
}

// Toolchain headers opened via include badges: each gets its own window
// entry (alongside the listings) so it shows in the window list.
var openHeaderViews: string[] = [];

export function openHeaderFile(fn: string) {
  if (!openHeaderViews.includes(fn)) {
    openHeaderViews.push(fn);
    projectWindows.setCreateFunc('#headerview/' + fn, () => new HeaderView(fn));
    refreshWindowList();
  }
  var hash = '#headerview/' + fn;
  if (window.location.hash !== hash) {
    window.location.hash = hash.substring(1);
  }
}

function refreshWindowList() {
  var ul = $("#windowMenuList").empty();
  var separate = false;

  function addWindowItem(id, name, createfn) {
    if (separate) {
      ul.append(document.createElement("hr"));
      separate = false;
    }
    let { li, a } = newDropdownListItem(id, name);
    // Tool windows get a one-line docs-derived tooltip; source files/listings
    // don't (helpDescriptionForView returns undefined for them).
    const desc = helpDescriptionForView(id);
    if (desc) a.setAttribute("title", desc);
    ul.append(li);
    if (createfn) {
      var onopen = (id, wnd) => {
        ul.find('a').removeClass("dropdown-item-checked");
        $(a).addClass("dropdown-item-checked");
      };
      projectWindows.setCreateFunc(id, createfn);
      projectWindows.setShowFunc(id, onopen);
      $(a).click((e) => {
        lastViewClicked = id;
      });
    }
  }

  function loadEditor(path: string) {
    var tool = platform.getToolForFilename(path);
    // hack because .h files can be DASM or CC65
    if (tool == 'dasm' && path.endsWith(".h") && getCurrentMainFilename().endsWith(".c")) {
      tool = 'cc65';
    }
    var mode = tool && getToolMeta(tool)?.editorStyle;
    return new SourceEditor(path, mode);
  }

  function addEditorItem(id: string) {
    addWindowItem(id, getFilenameForPath(id), () => {
      var data = current_project.getFile(id);
      if (typeof data === 'string')
        return loadEditor(id);
      else if (data instanceof Uint8Array)
        return new BinaryFileView(id, data as Uint8Array);
    });
  }

  // add main file editor
  addEditorItem(current_project.mainPath);

  // add other source files
  current_project.iterateFiles((id, text) => {
    if (text && id != current_project.mainPath) {
      addEditorItem(id);
    }
  });

  // add listings
  separate = true;
  var listings = current_project.getListings();
  if (listings) {
    for (var lstfn in listings) {
      var lst = listings[lstfn];
      // add listing if source/assembly file exists and has text
      if ((lst.assemblyfile && lst.assemblyfile.text) || (lst.sourcefile && lst.sourcefile.text) || lst.text) {
        addWindowItem(lstfn, getFilenameForPath(lstfn), (path) => {
          return new ListingView(path);
        });
      }
    }
  }

  // add opened toolchain headers (from include badges)
  for (let hdrfn of openHeaderViews) {
    let hdrid = '#headerview/' + hdrfn;
    projectWindows.setCreateFunc(hdrid, () => new HeaderView(hdrfn));
    addWindowItem(hdrid, getFilenameForPath(hdrfn), () => {
      return new HeaderView(hdrfn);
    });
  }

  // add other tools
  separate = true;
  if (platform.disassemble && platform.saveState) {
    addWindowItem("#disasm", "Disassembly", () => {
      return new DisassemblerView();
    });
  }
  if (platform.readAddress) {
    addWindowItem("#memory", "Memory Browser", () => {
      return new MemoryView();
    });
  }
  if (current_project.segments && current_project.segments.length) {
    addWindowItem("#memmap", "Memory Map", () => {
      return new MemoryMapView();
    });
  }
  if (platform.readVRAMAddress) {
    addWindowItem("#vram", "VRAM Browser", () => {
      return new VRAMMemoryView();
    });
  }
  if (platform.startProbing) {
    addWindowItem("#memprobe", "Memory Probe", () => {
      return new AddressHeatMapView();
    });
    // TODO: only if raster
    addWindowItem("#crtprobe", "CRT Probe", () => {
      //return new RasterPCHeatMapView();
      return new RasterStackMapView();
    });
    addWindowItem("#probelog", "Probe Log", () => {
      return new ProbeLogView();
    });
    addWindowItem("#scanlineio", "Scanline I/O", () => {
      return new ScanlineIOView();
    });
    addWindowItem("#symbols", "Symbol Profiler", () => {
      return new ProbeSymbolView();
    });
    addWindowItem("#callgraph", "Call Graph", () => {
      return new CallGraphView();
    });
    /*
    addWindowItem("#framecalls", "Frame Profiler", () => {
      return new FrameCallsView();
    });
    */
  }
  if (platform.getDebugTree) {
    addWindowItem("#debugtree", "Debug Tree", () => {
      return new DebugBrowserView();
    });
  }
  if (canUseBreakpoints()) {
    addWindowItem("#breakpoints", "Breakpoints", () => {
      return new BreakpointsView();
    });
  }
  addWindowItem('#asseteditor', 'Asset Editor', () => {
    return new AssetEditorView();
  });

  // Help: markdown docs shipped with the IDE. Only the index is listed in the
  // sidebar; every topic still gets a create fn so #help/<id> deep links work.
  //separate = true;
  addWindowItem('#help', 'Help', () => new HelpView('#help'));
  for (let topic of HELP_TOPICS) {
    projectWindows.setCreateFunc('#help/' + topic.id, () => new HelpView(topic.id));
  }
}

function highlightLines(path: string, hispec: string) {
  if (hispec) {
    var toks = qs.highlight.split(',');
    var start = parseInt(toks[0]) - 1;
    var end = parseInt(toks[1]) - 1;
    var editor = projectWindows.createOrShow(path) as SourceEditor;
    editor.highlightLines(start, end);
  }
}

async function loadMainWindow(preset_id: string) {
  // pre-load dependencies so refreshWindowList sees all files
  var maindata = current_project.getFile(preset_id);
  if (typeof maindata === 'string') {
    await current_project.loadFileDependencies(maindata);
  }
  // we need this to build create functions for the editor
  refreshWindowList();
  // show main file
  projectWindows.createOrShow(preset_id);
  // build project
  current_project.setMainFile(preset_id);
  // highlighting?
  highlightLines(preset_id, qs.highlight);
}

async function loadProject(preset_id: string) {
  // set current file ID
  // TODO: this is done twice (mainPath and mainpath!)
  current_project.mainPath = preset_id;
  // load persisted breakpoints for this platform/project
  bpStore.setContextFn(() => platform_id + '/' + current_project.mainPath);
  bpStore.load();
  userPrefs.setLastPreset(preset_id);
  // load files from storage or web URLs
  var result = await current_project.loadFiles([preset_id]);
  if (result && result.length) {
    // file found; continue
    await loadMainWindow(preset_id);
  } else {
    // file not found, look for skeleton file
    var tool = platform.getToolForFilename(preset_id);
    var skel = await getSkeletonFile(preset_id);
    current_project.filedata[preset_id] = skel || "\n";
    await loadMainWindow(preset_id);
    // don't alert if we selected "new file" unless there's a problem
    if (!qs.newfile) {
      alertInfo("Could not find file \"" + preset_id + "\"<br><br>" +
        "Creating new " + (skel ? tool : "blank") + " file.");
    } else if (!skel && !tool) {
      alertError("No build tool for \"" + preset_id + "\" on this platform; project will not build.");
    } else if (!skel) {
      alertInfo("No skeleton file for " + tool + " on this platform; using blank file.");
    } else {
      requestPersistPermission(true, true); // ask for persist permissions
    }
    delete qs.newfile;
    replaceURLState();
  }
}

function reloadProject(id: string) {
  // leave repository == '/'
  if (id == '/') {
    qs = { repo: '/' };
  } else if (id.indexOf('://') >= 0) {
    var urlparse = parseGithubURL(id);
    if (urlparse) {
      qs = { repo: urlparse.repopath };
    }
  } else {
    qs.platform = platform_id;
    qs.file = id;
  }
  gotoNewLocation();
}

async function getSkeletonFile(fileid: string): Promise<string> {
  var ext = getSkeletonName(platform.getToolForFilename(fileid));
  try {
    return await $.get("presets/" + getBasePlatform(platform_id) + "/skeleton." + ext, 'text');
  } catch (e) {
    console.log(e + "");
    return null;
  }
}

function checkEnteredFilename(fn: string): boolean {
  if (fn.indexOf(" ") >= 0) {
    alertError("No spaces in filenames, please.");
    return false;
  }
  return true;
}

interface ToolExtensions {
  tool: string;
  extensions: string[];
}

async function _getToolsWithSkeletons(extensions: string[]): Promise<ToolExtensions[]> {
  var basePlatform = getBasePlatform(platform_id);
  // group extensions by tool id to avoid duplicate requests
  var toolToExts: { [tool: string]: string[] } = {};
  var toolOrder: string[] = [];
  for (var ext of extensions) {
    var tool = platform.getToolForFilename("test" + ext);
    if (!toolToExts[tool]) {
      toolToExts[tool] = [];
      toolOrder.push(tool);
    }
    toolToExts[tool].push(ext);
  }
  // check each tool in parallel
  var checks = toolOrder.map(tool =>
    $.ajax({
      url: "presets/" + basePlatform + "/skeleton." + getSkeletonName(tool),
      type: "HEAD"
    }).then(() => tool, () => null)
  );
  var validTools = await Promise.all(checks);
  var results: ToolExtensions[] = [];
  for (var validTool of validTools) {
    if (validTool != null) {
      results.push({ tool: validTool, extensions: toolToExts[validTool] });
    }
  }
  return results;
}

async function _createNewFile(e) {
  // TODO: support spaces
  var toolExts = await _getToolsWithSkeletons(platform.getDefaultExtensions());
  var allExtensions: string[];
  var helpText: string;
  if (toolExts.length === 0) {
    allExtensions = platform.getDefaultExtensions();
    helpText = allExtensions.join(" ");
  } else {
    allExtensions = toolExts.reduce((acc, te) => acc.concat(te.extensions), [] as string[]);
    helpText = toolExts.map(te => te.extensions.join(' ')).join("<br>");
  }
  bootbox.prompt({
    title: "Enter the name of your new main source file.<br><br>" +
      "<span class='dialog-help'>" + helpText + "</span>",
    placeholder: "newfile" + allExtensions[0],
    callback: (filename) => {
      if (filename && filename.trim().length > 0) {
        if (!checkEnteredFilename(filename)) return;
        if (filename.indexOf(".") < 0) {
          filename += allExtensions[0];
        }
        var path = filename;
        qs.newfile = '1';
        reloadProject(path);
      }
    }
  } as any);
  return true;
}

function _uploadNewFile(e) {
  const uploadFileElem = $(`<input type="file" multiple accept="*" style="display:none">`);
  const file = uploadFileElem[0] as HTMLInputElement;
  uploadFileElem.change((e) => { handleFileUpload(file.files) });
  uploadFileElem.click();
}

// called from index.html
function handleFileUpload(files: FileList) {
  console.log(files);
  var index = 0;
  function uploadNextFile() {
    var f = files[index++];
    if (!f) {
      console.log("Done uploading", index);
      if (index > 2) {
        alertInfo("Files uploaded.");
        setTimeout(updateSelector, 1000); // TODO: wait for files to upload
      } else {
        qs.file = files[0].name;
        bootbox.confirm({
          message: "Open '" + DOMPurify.sanitize(qs.file) + "' as main project file?",
          buttons: {
            confirm: { label: "Open As New Project" },
            cancel: { label: "Include/Link With Project Later" },
          },
          callback: (result) => {
            if (result)
              gotoNewLocation();
            else
              setTimeout(updateSelector, 1000); // TODO: wait for files to upload
          }
        });
      }
    } else {
      var path = f.name;
      var reader = new FileReader();
      reader.onload = function (e) {
        var arrbuf = (<any>e.target).result as ArrayBuffer;
        var data: FileData = new Uint8Array(arrbuf);
        // convert to UTF8, unless it's a binary file
        if (isProbablyBinary(path, data)) {
          //gotoMainFile = false;
        } else {
          data = byteArrayToUTF8(data).replace('\r\n', '\n'); // convert CRLF to LF
        }
        // store in local forage
        projectWindows.updateFile(path, data);
        console.log("Uploaded " + path + " " + data.length + " bytes");
        uploadNextFile();
      }
      reader.readAsArrayBuffer(f); // read as binary
    }
  }
  if (files) uploadNextFile();
}

async function _openLocalDirectory(e) {
  var pickerfn = window['showDirectoryPicker'];
  if (!pickerfn) {
    alertError(`This browser can't open local files on your computer, yet. Try Chrome.`);
  }
  var dirHandle = await pickerfn();
  var repoid = dirHandle.name;
  var storekey = '__localfs__' + repoid;
  var fsdata = {
    handle: dirHandle,
  }
  var lstore = localforage.createInstance({
    name: storekey,
    version: 2.0
  });
  await lstore.setItem(storekey, fsdata);
  qs = { localfs: repoid };
  gotoNewLocation(true);
}

async function promptUser(message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    bootbox.prompt(DOMPurify.sanitize(message), (result) => {
      resolve(result);
    });
  });
}

async function getLocalFilesystem(repoid: string): Promise<ProjectFilesystem> {
  const options = { mode: 'readwrite' };
  var storekey = '__localfs__' + repoid;
  var lstore = localforage.createInstance({
    name: storekey,
    version: 2.0
  });
  var fsdata: any = await lstore.getItem(storekey);
  var dirHandle = fsdata.handle as any;
  console.log(fsdata, dirHandle);
  var granted = await dirHandle.queryPermission(options);
  console.log(granted);
  if (granted !== 'granted') {
    await promptUser(`Request permissions to access filesystem?`);
    granted = await dirHandle.requestPermission(options);
  }
  if (granted !== 'granted') {
    alertError(`Could not get permission to access filesystem.`);
    return;
  }
  const lastWriteTime: { [path: string]: number } = {};
  return {
    getFileData: async (path) => {
      console.log('getFileData', path);
      let fileHandle = await dirHandle.getFileHandle(path, { create: false });
      let file = await fileHandle.getFile();
      // always read bytes, then sniff the content -- the extension alone can't
      // tell a binary resource (e.g. .vgr3) from text
      return bytesToFileData(path, new Uint8Array(await file.arrayBuffer()));
    },
    setFileData: async (path, data) => {
      lastWriteTime[path] = Date.now();
      const fileHandle = await dirHandle.getFileHandle(path, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
    },
    onFileSystemUpdate: (callback: (path: string) => void) => {
      // Experimental API:
      // https://developer.mozilla.org/docs/Web/API/FileSystemObserver
      if (typeof (window as any).FileSystemObserver === 'undefined') {
        return;
      }
      const observer = new (window as any).FileSystemObserver((records, observer) => {
        for (const record of records) {
          // TODO Handle different types of changes intelligently.
          // https://developer.mozilla.org/docs/Web/API/FileSystemChangeRecord#type
          if (record.changedHandle) {
            const path = record.changedHandle.name;
            // Ignore filesystem notifications that are likely from our own recent writes,
            // so that onFileChanged in ui.ts doesn't call assets editor's refresh(true).
            // TODO: Consider better options than a time based threshold.
            if (Date.now() - (lastWriteTime[path] || 0) < 2000) continue;
            callback(path);
          }
        }
      });
      observer.observe(dirHandle, { recursive: true });
    }
  }
}

export function getCurrentMainFilename(): string {
  return getFilenameForPath(current_project.mainPath);
}

export function getCurrentEditorFilename(): string {
  return getFilenameForPath(projectWindows.getActiveID());
}


function _revertFile(e) {
  var wnd = projectWindows.getActive();
  var fn = projectWindows.getActiveID();
  var isBinary = wnd && wnd.setData && !wnd.setText;
  if (wnd && (wnd.setText || wnd.setData)) {
    var url = "presets/" + getBasePlatform(platform_id) + "/" + fn;
    getWithBinary(url, (data) => {
      if (data == null) {
        if (repo_id) alertError("Can only revert built-in examples. If you want to revert all files, You can pull from the repository.");
        else alertError("Can only revert built-in examples.");
        return;
      }
      bootbox.confirm("Reset '" + DOMPurify.sanitize(fn) + "' to default?", (ok) => {
        if (ok) {
          if (isBinary) {
            wnd.setData(data as Uint8Array);
            current_project.updateFile(fn, data as Uint8Array);
          } else {
            wnd.setText(data as string);
          }
        }
      });
    }, isBinary ? 'arraybuffer' : 'text');
  } else {
    alertError("Cannot revert the active window. Please choose a text file.");
  }
}

function _deleteFile(e) {
  var wnd = projectWindows.getActive();
  if (wnd && wnd.getPath) {
    var fn = projectWindows.getActiveID();
    bootbox.confirm("Delete '" + DOMPurify.sanitize(fn) + "'?", (ok) => {
      if (ok) {
        store.removeItem(fn).then(() => {
          // if we delete what is selected
          if (qs.file == fn) {
            userPrefs.unsetLastPreset();
            gotoNewLocation();
          } else {
            updateSelector();
            alertInfo("Deleted " + fn);
          }
        });
      }
    });
  } else {
    alertError("Cannot delete the active window.");
  }
}

function _renameFile(e) {
  var wnd = projectWindows.getActive();
  if (wnd && wnd.getPath && current_project.getFile(wnd.getPath())) {
    var fn = projectWindows.getActiveID();
    bootbox.prompt({
      title: "Rename '" + DOMPurify.sanitize(fn) + "' to?",
      value: fn,
      callback: (newfn) => {
        var data = current_project.getFile(wnd.getPath());
        if (newfn && newfn != fn && data) {
          if (!checkEnteredFilename(newfn)) return;
          store.removeItem(fn).then(() => {
            return store.setItem(newfn, data);
          }).then(() => {
            updateSelector();
            alert("Renamed " + fn + " to " + newfn); // need alert() so it pauses
            if (fn == current_project.mainPath) {
              reloadProject(newfn);
            }
          });
        }
      }
    });
  } else {
    alertError("Cannot rename the active window.");
  }
}



function populateExamples(sel) {
  let files = {};
  let optgroup;
  const PRESETS = platform.getPresets ? platform.getPresets() : [];
  for (var i = 0; i < PRESETS.length; i++) {
    var preset = PRESETS[i];
    var name = preset.chapter ? (preset.chapter + ". " + preset.name) : preset.name;
    var isCurrentPreset = preset.id == current_project.mainPath;
    if (preset.category) {
      optgroup = $("<optgroup />").attr('label', 'Examples: ' + preset.category).appendTo(sel);
    } else if (!optgroup) {
      optgroup = $("<optgroup />").attr('label', 'Examples').appendTo(sel);
    }
    optgroup.append($("<option />").val(preset.id).text(name).attr('selected', isCurrentPreset ? 'selected' : null));
    if (isCurrentPreset) current_preset = preset;
    files[preset.id] = name;
  }
  return files;
}

function populateRepos(sel) {
  if (hasLocalStorage && !isElectron) {
    var n = 0;
    var repos = getRepos();
    if (repos) {
      let optgroup = $("<optgroup />").attr('label', 'Repositories').appendTo(sel);
      for (let repopath in repos) {
        var repo = repos[repopath];
        if (repo.platform_id && getBasePlatform(repo.platform_id) == getBasePlatform(platform_id)) {
          optgroup.append($("<option />").val(repo.url).text(repo.url.substring(repo.url.indexOf('/'))));
        }
      }
    }
  }
}

async function populateFiles(sel: JQuery, category: string, prefix: string, foundFiles: {}) {
  let keys = await store.keys();
  if (!keys) keys = [];
  let optgroup;
  for (var i = 0; i < keys.length; i++) {
    let key = keys[i];
    if (key.startsWith(prefix) && !foundFiles[key]) {
      if (!optgroup) optgroup = $("<optgroup />").attr('label', category).appendTo(sel);
      let name = key.substring(prefix.length);
      optgroup.append($("<option />").val(key).text(name).attr('selected', (key == current_project.mainPath) ? 'selected' : null));
    }
  }
}

function finishSelector(sel) {
  sel.css('visibility', 'visible');
  // create option if not selected
  var main = current_project.mainPath;
  if (sel.val() != main) {
    sel.append($("<option />").val(main).text(main).attr('selected', 'selected'));
  }
}

async function updateSelector() {
  var sel = $("#preset_select").empty();
  if (!repo_id) {
    // normal: populate repos, examples, and local files
    populateRepos(sel);
    var foundFiles = populateExamples(sel);
    await populateFiles(sel, "Local Files", "", foundFiles);
    finishSelector(sel);
  } else {
    sel.append($("<option />").val('/').text('Leave Repository'));
    $("#repo_name").text(getFilenameForPath(repo_id) + '/').show();
    // repo: populate all files
    await populateFiles(sel, repo_id, "", {});
    finishSelector(sel);
  }
  // set click handlers
  sel.off('change').change(function (e) {
    reloadProject($(this).val().toString());
  });
}

function getErrorElement(err: WorkerError) {
  var span = $('<p/>');
  if (err.path != null) {
    var s = err.line ? err.label ? `(${err.path} @ ${err.label})` : `(${err.path}:${err.line})` : `(${err.path})`
    var link = $('<a/>').text(s);
    var path = err.path;
    // TODO: hack because examples/foo.a only gets listed as foo.a
    if (path == getCurrentMainFilename()) path = current_project.mainPath;
    // click link to open file, if it's available...
    if (projectWindows.isWindow(path)) {
      link.click((ev) => {
        var wnd = projectWindows.createOrShow(path);
        if (wnd instanceof SourceEditor) {
          wnd.navigateToLine(err.line);
        }
      });
    }
    span.append(link);
    span.append('&nbsp;');
  }
  span.append($('<span/>').text(err.msg));
  return span;
}

function hideErrorAlerts() {
  $("#error_alert").hide();
  errorWasRuntime = false;
}

function showErrorAlert(errors: WorkerError[], runtime: boolean) {
  var div = $("#error_alert_msg").empty();
  for (var err of errors.slice(0, 10)) {
    div.append(getErrorElement(err));
  }
  $("#error_alert").show();
  errorWasRuntime = runtime;
  // status chip: click jumps to first error that has an openable path
  var jumpErr = errors.find((err) => err.path != null);
  var fn;
  if (jumpErr && projectWindows.isWindow(jumpErr.path == getCurrentMainFilename() ? current_project.mainPath : jumpErr.path)) {
    fn = () => { jumpToError(jumpErr); };
  }
}

function showExceptionAsError(err, msg: string) {
  if (msg != null) {
    var werr: WorkerError = { msg: msg, line: 0 };
    if (err instanceof EmuHalt && err.$loc) {
      werr = Object.create(err.$loc);
      werr.msg = msg;
      console.log(werr);
    }
    showErrorAlert([werr], true);
  }
}

// warnings of the build that made the current output, kept for unchanged rebuilds
var lastWarnings: WorkerError[] | null = null;

async function setCompileOutput(data: WorkerResult) {
  if ('uppercaseOnly' in data) {
    setUppercaseOnly(data.uppercaseOnly);
  }
  // errors? mark them in editor
  if ('errors' in data && data.errors.length > 0) {
    toolbar.addClass("has-errors");
    projectWindows.setErrors(data.errors);
    refreshWindowList(); // to make sure windows are created for showErrorAlert()
    // warnings only get gutter markers; a tool that failed with nothing but warnings still shows them
    showErrorAlert(hasErrors(data.errors) ? data.errors.filter((e) => e.severity !== 'warning') : data.errors, false);
  } else {
    toolbar.removeClass("has-errors"); // may be added in next callback
    projectWindows.setErrors(null);
    hideErrorAlerts();
    // exit if compile output unchanged; its warnings still apply
    if (data == null || ('unchanged' in data && data.unchanged)) {
      if (lastWarnings) projectWindows.setErrors(lastWarnings);
      return;
    }
    // make sure it's a WorkerOutputResult
    if (!('output' in data)) return;
    // warnings don't fail the build: mark them in the editor, without the alert
    lastWarnings = data.warnings && data.warnings.length > 0 ? data.warnings : null;
    if (lastWarnings) projectWindows.setErrors(lastWarnings);
    // process symbol map
    platform.debugSymbols = new DebugSymbols(data.symbolmap, data.debuginfo, data.symbolsizes);
    compparams = data.params;
    // load ROM
    var rom = data.output;
    if (rom != null) {
      if (current_output && arrayCompare(rom, current_output)) {
        console.log("unchanged, skipping loadROM");
      } else {
        try {
          clearBreakpoint(); // so we can replace memory (TODO: change toolbar btn)
          _resetRecording();
          await platform.loadROM(getCurrentPresetTitle(), rom, data.origin);
          current_output = rom;
          // re-arm breakpoints before the new ROM gets to run: clearBreakpoint()
          // above disarmed them, and code that only runs at startup (main() on the
          // C64, say) would race past them before anything else re-armed
          if (!userPaused) {
            if (bpStore.getEnabled().length == 0 || !armBreakpoints()) _resume();
          }
          writeOutputROMFile();
        } catch (e) {
          console.log(e);
          toolbar.addClass("has-errors");
          showExceptionAsError(e, e + "");
          current_output = null;
          refreshWindowList();
          return;
        }
      }
    }
    // update all windows (listings)
    refreshWindowList();
    projectWindows.refresh(false);
    // updating a listing clears the editor's markers, so mark the warnings again
    projectWindows.refreshErrors();
  }
}

async function loadBIOSFromProject() {
  if (platform.loadBIOS) {
    var biospath = platform_id + '.rom';
    var biosdata = await store.getItem(biospath);
    if (biosdata != null && biosdata instanceof Uint8Array) {
      console.log('loading BIOS', biospath, biosdata.length + " bytes")
      try {
        platform.loadBIOS(biospath, biosdata);
      } catch (e) {
        // A bad BIOS file must not lock us out of the IDE (and its file manager):
        // the platform keeps running with its built-in BIOS, so we warn and go on.
        console.log(e);
        alertError(`Could not load BIOS file "${biospath}": ${e.message || e + ''}<br><br>` +
          'The emulator will use its built-in BIOS. Delete or rename the file to fix this.');
      }
    } else {
      console.log('BIOS file must be binary')
    }
  }
}

function hideDebugInfo() {
  var meminfo = $("#mem_info");
  meminfo.hide();
  lastDebugInfo = null;
}

function showDebugInfo(state?) {
  if (!isDebuggable(platform)) return;
  var meminfo = $("#mem_info");
  var meminfomsg = $("#mem_info_msg");
  var allcats = platform.getDebugCategories();
  if (allcats && !debugCategory)
    debugCategory = allcats[0];
  var s = state && platform.getDebugInfo(debugCategory, state);
  if (typeof s === 'string') {
    var hs = lastDebugInfo ? highlightDifferences(lastDebugInfo, s) : s;
    meminfo.show();
    meminfomsg.html(hs);
    var catspan = $('<div class="mem_info_links">');
    var addCategoryLink = (cat: string) => {
      var catlink = $('<a>' + cat + '</a>');
      if (cat == debugCategory)
        catlink.addClass('selected');
      catlink.click((e) => {
        debugCategory = cat;
        lastDebugInfo = null;
        showDebugInfo(lastDebugState);
      });
      catspan.append(catlink);
      catspan.append('<span> </span>');
    }
    for (var cat of allcats) {
      addCategoryLink(cat);
    }
    meminfomsg.append('<br>');
    meminfomsg.append(catspan);
    lastDebugInfo = s;
  } else {
    hideDebugInfo();
  }
}

function setDebugButtonState(btnid: string, btnstate: string) {
  $("#debug_bar, #run_bar").find("button").removeClass("btn_active").removeClass("btn_stopped");
  $("#dbg_" + btnid).addClass("btn_" + btnstate);
  refreshShortcutBar();
}

// context-sensitive shortcut providers for the bottom bar

function jumpToError(err: WorkerError) {
  var path = err.path == getCurrentMainFilename() ? current_project.mainPath : err.path;
  if (!projectWindows.isWindow(path)) return;
  var wnd = projectWindows.createOrShow(path);
  if (wnd instanceof SourceEditor) {
    wnd.navigateToLine(err.line);
  }
}

// go-to-address (mod+shift+g): works while the Disassembly, Memory Browser,
// or VRAM Browser is the active view; accepts a hex address ("$1234", "0x1234",
// "1234") or a symbol name ("main")

function getGoToAddressView(): DisassemblerView | MemoryView | null {
  var wnd = projectWindows.getActive();
  if (wnd instanceof DisassemblerView || wnd instanceof MemoryView) return wnd;
  return null;
}

export function parseGoToTarget(s: string): number {
  var target = resolveDebuggerTarget(s, platform && platform.debugSymbols && platform.debugSymbols.symbolmap);
  return target ? target.addr : -1;
}

function promptGoToAddress(): boolean {
  var wnd = getGoToAddressView();
  if (!wnd) return false;
  var cur = (wnd as any).getCursorPC ? (wnd as any).getCursorPC() : -1;
  (bootbox as any).prompt({
    title: "Go to Address",
    placeholder: "address in hex",
    value: cur >= 0 ? hex(cur, 4) : "",
    callback: (result: string) => {
      if (!result) return; // canceled or empty
      var addr = parseGoToTarget(result);
      if (isNaN(addr) || addr < 0) {
        alertError("Can't find address or symbol: " + DOMPurify.sanitize(result));
        return;
      }
      wnd.goToAddress(addr);
    }
  });
  return true;
}

function getGlobalShortcuts(): Shortcut[] {
  var shortcuts: Shortcut[] = [];
  if (platform && isPlatformReady()) {
    shortcuts.push({ key: 'F1', label: 'Help', fn: showContextHelp });
    // single-key pause/resume toggle (works while the editor is focused);
    // mod+shift+h / mod+shift+g still work outside the editor.
    // pushed first so its position doesn't shift when other chips come and
    // go as the debug session starts
    if (platform.isRunning) {
      shortcuts.push({ key: 'F8', label: platform.isRunning() ? 'Pause' : 'Resume', fn: togglePauseResume });
    }
    // debug shortcuts appear only once a debug session has started
    if (platform.setupDebug && platform.runEval) // TODO??
        shortcuts.push({ key: 'mod+shift+d', label: 'Reset & Break', fn: resetAndDebug });
    if (!debugSessionActive) {
      shortcuts.push({ key: 'mod+shift+r', label: 'Reset & Run', fn: resetAndRun });
      shortcuts.push({ key: 'mod+shift+f', label: 'Search', fn: openSearchDialog });
    }
    if (getGoToAddressView()) {
      // mod+shift+g becomes "Go To Address" while a debug tool view is active
      shortcuts.push({ key: 'mod+shift+g', label: 'Go To Address', fn: promptGoToAddress });
    }
  }
  return shortcuts;
}

function getDebugShortcuts(): Shortcut[] {
  var shortcuts: Shortcut[] = [];
  if (!debugSessionActive || !platform || !isPlatformReady()) return shortcuts;
  var running = platform.isRunning && platform.isRunning();
  if (platform.step)
    shortcuts.push({ key: 'mod+shift+l', label: 'Step', fn: singleStep });
  if (platform.stepOver)
    shortcuts.push({ key: 'mod+shift+k', label: 'Step Over', fn: stepOver });
  if (platform.runUntilReturn)
    shortcuts.push({ key: 'mod+shift+i', label: 'Step Out', fn: runUntilReturn });
  if (platform.stepBack)
    shortcuts.push({ key: 'mod+shift+j', label: 'Step Back', fn: runStepBackwards });
  if (platform.runToVsync)
    shortcuts.push({ key: 'mod+shift+x', label: 'Next Frame', fn: singleFrameStep });
  if (platform.restartAtPC)
    shortcuts.push({ key: 'mod+shift+a', label: 'Restart at Cursor', fn: restartAtCursor });
  // TODO: check to see if line has debug info
  if ((platform.runEval || platform.runToPC) && !platform_id.startsWith('verilog'))
    shortcuts.push({ key: 'mod+shift+y', label: 'Run To Line', fn: runToCursor });
  // session-level actions are always available once debugging
  //shortcuts.push({ key: 'mod+shift+e', label: recorderActive ? 'Stop Recording' : 'Record', fn: _toggleRecording });
  return shortcuts;
}

function isPlatformReady() {
  return platform && current_output != null;
}

function checkRunReady() {
  if (!isPlatformReady()) {
    alertError("Can't do this until build successfully completes.");
    return false;
  } else
    return true;
}

// find the best known listing window + source line for a PC value, among
// listings with a window we can show (see ProjectWindows.isWindow -- this
// just means "known window id", not "currently open"). Pure logic lives in
// listinglocation.ts (unit tested); this just wires up the live IDE state.
function findListingLocation(pc: number): { wndid: string, line: number } | null {
  return findListingLocationPure(pc, {
    listings: current_project.getListings(),
    filename2path: current_project.filename2path,
    isWindow: (id) => projectWindows.isWindow(id),
    findWindowWithFilePrefix: (fn) => projectWindows.findWindowWithFilePrefix(fn),
    symbolAddrs: platform.debugSymbols && platform.debugSymbols.symbolAddrs,
  }, PC_LINE_LOOKAHEAD);
}

// true while the active stop request is a breakpoint run (see armBreakpoints)
var stoppingAtBreakpoint = false;

function openRelevantListing(state: EmuState) {
  // a breakpoint hit always shows its location, whatever view is open
  if (!stoppingAtBreakpoint) {
    // if we clicked on a specific tool, don't switch windows
    if (lastViewClicked && lastViewClicked.startsWith('#')) return;
    // don't switch windows for specific debug commands
    if (['toline', 'restart', 'tovsync', 'stepover'].includes(lastDebugCommand)) return;
  }
  // has to support disassembly, at least
  if (!platform.disassemble) return;
  let pc = state.c ? (state.c.EPC || state.c.PC) : 0;
  // a hit on a source breakpoint goes to the file/line it was set on (window
  // ids for source files are plain paths, e.g. the main file has no '#')
  if (stoppingAtBreakpoint) {
    let hit = resolveBreakpoints().find(r => r.bp.enabled && r.bp.type == 'source' && r.pc == pc && projectWindows.isWindow(r.bp.file));
    if (hit) {
      let wnd = projectWindows.createOrShow(hit.bp.file, true);
      if (wnd instanceof SourceEditor) wnd.highlightLines(hit.bp.line - 1, hit.bp.line - 1);
      return;
    }
  }
  let best = findListingLocation(pc);
  // if no appropriate listing found, use disassembly view
  projectWindows.createOrShow(best ? best.wndid : "#disasm", true);
}

// jump to (and highlight) the best known source line for an address --
// e.g. for a symbol/address breakpoint, which has no stored file/line of
// its own. Falls back to the disassembly view if no source line resolves.
export function openLocationForPC(pc: number) {
  if (!platform.disassemble) return;
  let best = findListingLocation(pc);
  let wnd = projectWindows.createOrShow(best ? best.wndid : "#disasm", true);
  if (best && wnd instanceof SourceEditor) {
    wnd.highlightLines(best.line - 1, best.line - 1);
  } else if (wnd instanceof DisassemblerView) {
    wnd.goToAddress(pc);
  }
}

function uiDebugCallback(state: EmuState) {
  debugSessionActive = true;
  lastDebugState = state;
  showDebugInfo(state);
  openRelevantListing(state);
  projectWindows.refresh(true); // move cursor
  debugTickPaused = true;
}

function setupDebugCallback(btnid?: DebugCommandType) {
  if (platform.setupDebug) {
    platform.setupDebug((state: EmuState, msg: string) => {
      uiDebugCallback(state);
      setDebugButtonState(btnid || "pause", "stopped");
      msg && showErrorAlert([{ msg: "STOPPED: " + msg, line: 0 }], true);
    });
    lastDebugCommand = btnid;
  }
}

export function setupBreakpoint(btnid?: DebugCommandType) {
  if (!checkRunReady()) return;
  stoppingAtBreakpoint = false;
  debugSessionActive = true;
  _disableRecording();
  setupDebugCallback(btnid);
  if (btnid) setDebugButtonState(btnid, "active");
  refreshShortcutBar();
}

function _pause() {
  debugSessionActive = true;
  if (platform && platform.isRunning()) {
    platform.pause();
    console.log("Paused");
  }
  setDebugButtonState("pause", "stopped");
}

function pause() {
  if (!checkRunReady()) return;
  clearBreakpoint();
  _pause();
  userPaused = true;
  refreshShortcutBar(); // debug chips appear once the session starts
}

// F8 pauses a running emulator and resumes a paused one. Unmodified and not
// bound by CodeMirror, so it always reaches the IDE -- even while typing in
// the editor, where mod+shift+g stays find-next/previous.
function togglePauseResume() {
  if (!checkRunReady()) return;
  if (platform.isRunning && platform.isRunning()) pause();
  else resume();
}

function _resume() {
  if (!platform.isRunning()) {
    platform.resume();
    console.log("Resumed");
  }
  setDebugButtonState("go", "active");
  if (errorWasRuntime) { hideErrorAlerts(); }
}

function resume() {
  if (!checkRunReady()) return;

  // If there are enabled breakpoints, resume with them armed; the debug
  // session stays active so the debug chips keep showing
  if (bpStore.getEnabled().length > 0 && armBreakpoints()) {
    if (!platform.isRunning()) {
      projectWindows.refresh(false);
    }
    userPaused = false;
    lastViewClicked = null;
    return;
  }

  clearBreakpoint();
  // plain run: end the debug session so the Reset & Run / Search chips return
  // (pause() set debugSessionActive; undo it here unless breakpoints were armed)
  debugSessionActive = false;
  if (!platform.isRunning()) {
    projectWindows.refresh(false);
  }
  _resume();
  userPaused = false;
  lastViewClicked = null;
  refreshShortcutBar();
}

function singleStep() {
  if (!checkRunReady()) return;
  setupBreakpoint("step");
  platform.step();
}

function stepOver() {
  if (!checkRunReady()) return;
  setupBreakpoint("stepover");
  // platform-specific step-over (e.g. BASIC statements) takes precedence
  if (platform.hasCustomStepOver && platform.hasCustomStepOver()) {
    platform.stepOver();
    return;
  }
  // source-level stepping: break at the first PC assigned to a source line,
  // unless we're in the disassembly view -- then assume no line info
  if (projectWindows.getActiveID() != '#disasm') {
    var pcs = getSourceLineStartPCs();
    if (pcs.size > 0 && stepOverSource(pcs)) {
      return;
    }
  }
  // fall back to instruction-level step-over
  if (platform.stepOver) {
    platform.stepOver();
  } else {
    platform.step();
  }
}

var sourcePcsCache: { listings: CodeListingMap, pcs: Set<number> } = null;

// build set of all PCs that begin a source line; cached until next build
function getSourceLineStartPCs(): Set<number> {
  var listings = current_project.getListings();
  if (!sourcePcsCache || sourcePcsCache.listings !== listings) {
    var pcs = new Set<number>();
    if (listings) {
      for (var lstfn in listings) {
        var sourcefile = listings[lstfn].sourcefile;
        if (!sourcefile) continue;
        for (var line of sourcefile.lines) {
          if (line.offset >= 0) pcs.add(line.offset);
        }
      }
    }
    sourcePcsCache = { listings: listings, pcs: pcs };
  }
  return sourcePcsCache.pcs;
}

// source-level step over: break at the next line-start PC, but skip over any
// subroutine call made by the current instruction (and interrupts it triggers).
// returns false if source-level stepping isn't possible here.
function stepOverSource(pcs: Set<number>): boolean {
  if (!platform.runEval || !lastDebugState || !lastDebugState.c) return false;
  var pc = lastDebugState.c.EPC || lastDebugState.c.PC;
  var sp0 = platform.getSP ? platform.getSP() : null;
  // if current instruction is a subroutine call, don't stop inside it
  var iscall = false;
  var readfn = platform.readAddress?.bind(platform);
  if (readfn && platform.disassemble) {
    var d = platform.disassemble(pc, readfn);
    iscall = !!(d && d.iscall);
  }
  platform.runEval((c) => {
    var cur = c.EPC || c.PC;
    if (cur == pc) return false;		// haven't left this instruction yet
    if (iscall && sp0 != null && c.SP < sp0) return false;	// inside called subroutine (or IRQ)
    return pcs.has(cur);
  });
  return true;
}

function singleFrameStep() {
  if (!checkRunReady()) return;
  setupBreakpoint("tovsync");
  platform.runToVsync();
}

function getEditorPC(): number {
  var wnd = projectWindows.getActive();
  return wnd && wnd.getCursorPC && wnd.getCursorPC();
}

// Arm all enabled breakpoints from the shared store: break when the CPU
// reaches any breakpoint location (and, for conditional breakpoints, when
// its condition evaluates true). Returns true if anything was armed.
export function armBreakpoints(): boolean {
  if (!checkRunReady()) return false;
  const rbps = resolveBreakpoints().filter(r => r.bp.enabled && !r.error && r.pc >= 0);
  if (rbps.length == 0) return false;
  lastDebugState = null;
  hideDebugInfo();
  projectWindows.refresh(false); // clear any "stopped here" highlight (e.g. Breakpoints window)
  setupBreakpoint("toline");
  stoppingAtBreakpoint = true;
  const targets = new Map<number, CondFn | null>();
  for (const r of rbps) targets.set(r.pc, r.condFn || null);
  if (platform.runEvalAtPC) {
    platform.runEvalAtPC(targets);
  } else if (platform.runToPC) {
    // platform can't arm per-address conditions: break on locations, ignore conditions
    if (rbps.some(r => r.condFn)) console.log("breakpoints: conditions not supported on this platform");
    platform.runToPC([...targets.keys()]);
  } else if (platform.runEval) {
    // platform has neither helper (e.g. vcs, which wraps its own emulator
    // core's debug API directly) -- fall back to a hand-rolled matcher,
    // same as the plain runToPC() function below does in this case
    platform.runEval((c) => {
      const epc = c.EPC != null ? c.EPC : c.PC;
      const cond = targets.get(epc);
      return cond !== undefined && (cond ? cond(c) : true);
    });
  } else {
    return false;
  }
  return true;
}

// push store state into every open editor's gutter markers
function syncEditorBreakpoints() {
  for (var id in projectWindows.id2window) {
    var wnd = projectWindows.id2window[id];
    if (wnd instanceof SourceEditor) {
      try { wnd.syncBreakpoints(); } catch (e) { }
    }
  }
}

// single store listener: persist, sync UI, and re-arm while running
// (mirrors the old gutter-toggle behavior)
bpStore.subscribe(() => {
  syncEditorBreakpoints();
  if (projectWindows.getActiveID() == '#breakpoints') {
    projectWindows.refresh(false);
  }
  if (isPlatformReady() && platform.isRunning()) {
    if (bpStore.getEnabled().length > 0) {
      armBreakpoints();
    } else {
      clearBreakpoint();
    }
  }
});

export function runToPC(pc: number[]) {
  if (!checkRunReady()) return;
  if (pc.length === 0 || pc.some(p => !(p >= 0))) return;
  lastDebugState = null;
  hideDebugInfo();
  projectWindows.refresh(false);
  setupBreakpoint("toline");
  console.log("runToPC", pc.map(p => p.toString(16)).join(" "));
  if (platform.runToPC) {
    platform.runToPC(pc);
  } else {
    const pcSet = new Set(pc);
    platform.runEval((c) => {
      return pcSet.has(c.PC);
    });
  }
}

function restartAtCursor() {
  if (platform.restartAtPC(getEditorPC())) {
    resume();
  } else alertError(`Could not restart program at selected line.`);
}

function runToCursor() {
  runToPC([getEditorPC()]);
}

function runUntilReturn() {
  if (!checkRunReady()) return;
  setupBreakpoint("stepout");
  platform.runUntilReturn();
}

function runStepBackwards() {
  if (!checkRunReady()) return;
  setupBreakpoint("stepback");
  platform.stepBack();
}

export function clearBreakpoint() {
  lastDebugState = null;
  if (platform.clearDebug) platform.clearDebug();
  setupDebugCallback(); // in case of BRK/trap
  showDebugInfo();
}

function resetPlatform() {
  platform.reset();
  _resetRecording();
  projectWindows.resetViews();
}

function resetAndRun() {
  if (!checkRunReady()) return;
  clearBreakpoint();
  resetPlatform();
  // if there are enabled breakpoints, restart with them armed
  if (bpStore.getEnabled().length > 0 && armBreakpoints()) {
    debugSessionActive = true;
  } else {
    debugSessionActive = false; // plain run: hide debug shortcut chips
    projectWindows.refresh(false); // clear any stale "stopped here" highlight
    _resume();
  }
  refreshShortcutBar();
}

function resetAndDebug() {
  if (!checkRunReady()) return;
  var wasRecording = recorderActive;
  _disableRecording();
  if (platform.setupDebug && platform.runEval) { // TODO??
    clearBreakpoint();
    _resume();
    resetPlatform();
    setupBreakpoint("restart");
    platform.runEval((c) => { return true; }); // break immediately
  } else {
    resetPlatform();
    _resume();
  }
  if (wasRecording) _enableRecording();
}

function updateDebugWindows() {
  if (platform.isRunning()) {
    projectWindows.tick();
    debugTickPaused = false;
  } else if (!debugTickPaused) { // final tick after pausing
    projectWindows.tick();
    debugTickPaused = true;
  }
  setTimeout(updateDebugWindows, 100);
}

export function setFrameRateUI(fps: number) {
  platform.setFrameRate(fps);
  if (fps > 0.01)
    $("#fps_label").text(fps.toFixed(2));
  else
    $("#fps_label").text("1/" + Math.round(1 / fps));
}

function _slowerFrameRate() {
  var fps = platform.getFrameRate();
  fps = fps / 2;
  if (fps > 0.00001) setFrameRateUI(fps);
}

function _fasterFrameRate() {
  var fps = platform.getFrameRate();
  fps = Math.min(60, fps * 2);
  setFrameRateUI(fps);
}

function _slowestFrameRate() {
  setFrameRateUI(60 / 65536);
}

function _fastestFrameRate() {
  _resume();
  setFrameRateUI(60);
}

function traceTiming() {
  projectWindows.refresh(false);
  var wnd = projectWindows.getActive();
  if (wnd.getSourceFile && wnd.setTimingResult) { // is editor active?
    var analyzer = platform.newCodeAnalyzer();
    analyzer.showLoopTimingForPC(0);
    wnd.setTimingResult(analyzer);
  }
}

function _disableRecording() {
  if (recorderActive) {
    platform.setRecorder(null);
    $("#dbg_record").removeClass("btn_recording");
    $("#replaydiv").hide();
    hideDebugInfo();
    recorderActive = false;
  }
}

function _resetRecording() {
  if (recorderActive) {
    stateRecorder.reset();
  }
}

function _enableRecording() {
  stateRecorder.reset();
  platform.setRecorder(stateRecorder);
  $("#dbg_record").addClass("btn_recording");
  $("#replaydiv").show();
  recorderActive = true;
}

function _toggleRecording() {
  if (recorderActive) {
    _disableRecording();
  } else {
    _enableRecording();
  }
  refreshShortcutBar();
}

function _toggleTraceLines() {
  var enabled = !SourceEditor.tracingEnabled;
  $("#dbg_tracelines").toggleClass("btn_active", enabled);
  var wnd = projectWindows.getActive();
  if (wnd instanceof SourceEditor) {
    wnd.setTracingEnabled(enabled);
  } else {
    SourceEditor.tracingEnabled = enabled;
  }
}

function addFileToProject(type, ext, linefn) {
  var wnd = projectWindows.getActive();
  if (wnd && wnd.insertLinesBefore) {
    bootbox.prompt({
      title: "Add " + DOMPurify.sanitize(type) + " File to Project",
      value: "filename" + DOMPurify.sanitize(ext),
      callback: (filename: string) => {
        if (filename && filename.trim().length > 0) {
          if (!checkEnteredFilename(filename)) return;
          var path = filename;
          var newline = "\n" + linefn(filename) + "\n";
          current_project.loadFiles([path]).then((result) => {
            if (result && result.length) {
              alertError(filename + " already exists; including anyway");
            } else {
              current_project.updateFile(path, "\n");
            }
            wnd.insertLinesBefore(newline);
            refreshWindowList();
          });
        }
      }
    });
  } else {
    alertError("Can't insert text in this window -- switch back to main file");
  }
}
// TODO: lwtools and smaller c
function _addIncludeFile() {
  var fn = getCurrentMainFilename();
  var tool = platform.getToolForFilename(fn);
  // TODO: more tools? make this a function of the platform / tool provider
  if (fn.endsWith(".c") || tool == 'sdcc' || tool == 'cc65' || tool == 'cmoc' || tool == 'smlrc' || tool == 'oscar64')
    addFileToProject("Header", ".h", (s) => { return '#include "' + s + '"' });
  else if (tool == 'dasm' || tool == 'zmac')
    addFileToProject("Include", ".inc", (s) => { return '\tinclude "' + s + '"' });
  else if (tool == 'ca65' || tool == 'sdasz80' || tool == 'vasm' || tool == 'armips')
    addFileToProject("Include", ".inc", (s) => { return '\t.include "' + s + '"' });
  else if (tool == 'verilator')
    addFileToProject("Verilog", ".v", (s) => { return '`include "' + s + '"' });
  else if (tool == 'wiz')
    addFileToProject("Include", ".wiz", (s) => { return 'import "' + s + '";' });
  else if (tool == 'ecs')
    addFileToProject("Include", ".ecs", (s) => { return 'import "' + s + '"' });
  else if (tool == 'acme')
    addFileToProject("Include", ".acme", (s) => { return '!src "' + s + '"' });
  else if (tool == 'xa')
    addFileToProject("Include", ".xa", (s) => { return '#include "' + s + '"' });
  else if (tool == 'dialog')
    addFileToProject("Include", ".dg", (s) => { return '%% #include "' + s + '"' });
  else
    alertError("Can't add include file to this project type (" + tool + ")");
}

function _addLinkFile() {
  var fn = getCurrentMainFilename();
  var tool = platform.getToolForFilename(fn);
  if (fn.endsWith(".c") || tool == 'sdcc' || tool == 'cc65' || tool == 'cmoc' || tool == 'smlrc')
    addFileToProject("Linked C (or .s)", ".c", (s) => { return '//#link "' + s + '"' });
  else if (fn.endsWith("asm") || fn.endsWith(".s") || tool == 'ca65' || tool == 'lwasm')
    addFileToProject("Linked ASM", ".inc", (s) => { return ';#link "' + s + '"' });
  else
    alertError("Can't add linked file to this project type (" + tool + ")");
}

function setupDebugControls() {
  // create toolbar buttons
  uitoolbar = new Toolbar($("#toolbar")[0], null);
  uitoolbar.grp.prop('id', 'run_bar');
  uitoolbar.add('mod+shift+r', 'Reset', 'glyphicon-refresh', resetAndRun).prop('id', 'dbg_reset');
  uitoolbar.add('mod+shift+h', 'Pause', 'glyphicon-pause', pause).prop('id', 'dbg_pause');
  // bound before Resume so it takes priority in the debug tool views;
  // falls through to Resume everywhere else
  uitoolbar.add('mod+shift+g', 'Go To Address', '', (e) => {
    if (!promptGoToAddress()) resume();
  });
  uitoolbar.add('mod+shift+g', 'Resume', 'glyphicon-play', resume).prop('id', 'dbg_go');
  // F8: single-key pause/resume toggle; chip shown via getGlobalShortcuts()
  uitoolbar.add('F8', 'Pause/Resume', '', togglePauseResume);
  // F1: context-sensitive help for the active view (editor/tool/platform)
  uitoolbar.add('F1', 'Help', '', showContextHelp);
  if (platform.restartAtPC) {
    uitoolbar.add('mod+shift+a', 'Restart at Cursor', 'glyphicon-play-circle', restartAtCursor).prop('id', 'dbg_restartatline');
  }
  uitoolbar.newGroup();
  uitoolbar.grp.prop('id', 'debug_bar');
  if (platform.runEval) {
    uitoolbar.add('mod+shift+d', 'Reset and Debug', 'glyphicon-fast-backward', resetAndDebug).prop('id', 'dbg_restart');
  }
  if (platform.stepBack) {
    uitoolbar.add('mod+shift+j', 'Step Backwards', 'glyphicon-step-backward', runStepBackwards).prop('id', 'dbg_stepback');
  }
  if (platform.step) {
    uitoolbar.add('mod+shift+l', 'Single Step', 'glyphicon-step-forward', singleStep).prop('id', 'dbg_step');
  }
  if (platform.stepOver) {
    uitoolbar.add('mod+shift+k', 'Step Over', 'glyphicon-hand-right', stepOver).prop('id', 'dbg_stepover');
  }
  if (platform.runUntilReturn) {
    uitoolbar.add('mod+shift+i', 'Step Out of Subroutine', 'glyphicon-hand-up', runUntilReturn).prop('id', 'dbg_stepout');
  }
  if (platform.runToVsync) {
    uitoolbar.add('mod+shift+x', 'Next Frame/Interrupt', 'glyphicon-forward', singleFrameStep).prop('id', 'dbg_tovsync');
  }
  if ((platform.runEval || platform.runToPC) && !platform_id.startsWith('verilog')) {
    uitoolbar.add('mod+shift+y', 'Run To Line', 'glyphicon-save', runToCursor).prop('id', 'dbg_toline');
  }
  uitoolbar.newGroup();
  uitoolbar.grp.prop('id', 'xtra_bar');
  uitoolbar.add('mod+shift+f', 'Search', 'glyphicon-search', openSearchDialog).prop('id', 'dbg_search');
  // add menu clicks
  $(".dropdown-menu").collapse({ toggle: false });
  $("#item_new_file").click(_createNewFile);
  $("#item_upload_file").click(_uploadNewFile);
  $("#item_open_directory").click(_openLocalDirectory);
  $("#item_github_login").click(_loginToGithub);
  $("#item_github_logout").click(_logoutOfGithub);
  $("#item_github_import").click(_importProjectFromGithub);
  $("#item_github_publish").click(_publishProjectToGithub);
  $("#item_github_push").click(_pushProjectToGithub);
  $("#item_github_pull").click(_pullProjectFromGithub);
  $("#item_repo_delete").click(_removeRepository);
  $("#item_share_file").click(_shareEmbedLink);
  $("#item_reset_file").click(_revertFile);
  $("#item_rename_file").click(_renameFile);
  $("#item_delete_file").click(_deleteFile);
  $("#item_download_rom").click(_downloadROMImage);
  $("#item_download_file").click(_downloadSourceFile);
  $("#item_download_zip").click(_downloadProjectZipFile);
  if (platform.getDebugSymbolFile) {
    $("#item_download_sym").click(_downloadSymFile);
  } else {
    $("#item_download_sym").hide();
  }
  $("#item_download_allzip").click(_downloadAllFilesZipFile);
  $("#item_record_video").click(_recordVideo);
  if (_getCassetteFunction())
    $("#item_export_cassette").click(_downloadCassetteFile);
  else
    $("#item_export_cassette").hide();
  if (platform.setFrameRate && platform.getFrameRate) {
    $("#dbg_slower").click(_slowerFrameRate);
    $("#dbg_faster").click(_fasterFrameRate);
    $("#dbg_slowest").click(_slowestFrameRate);
    $("#dbg_fastest").click(_fastestFrameRate);
  }
  $("#item_addfile_include").click(_addIncludeFile);
  $("#item_addfile_link").click(_addLinkFile);
  $("#item_request_persist").click(() => requestPersistPermission(true, false));
  $("#item_settings").click(openSettings);
  updateDebugWindows();
  // code analyzer?
  if (platform.newCodeAnalyzer) {
    uitoolbar.add(null, 'Analyze CPU Timing', 'glyphicon-time', traceTiming);
  }
  if (platform.startProbing) {
    uitoolbar.add(null, 'Highlight Executed Lines', 'glyphicon-fire', _toggleTraceLines).prop('id', 'dbg_tracelines');
  }
  // setup replay slider
  if (platform.setRecorder && platform.advance) {
    setupReplaySlider();
  }
  // help menu items
  if (platform.showHelp) {
    let { li, a } = newDropdownListItem('help__' + platform_id, platform_name + ' Info');
    $("#help_menu").append(li);
    // opens an external page; don't let the placeholder href change our URL hash
    $(a).click((e) => { e.preventDefault(); window.open(platform.showHelp(), '_8bws_help'); });
  }
  // tool help (one entry per tool this platform can build with)
  showToolHelp();
  // internal IDE help (markdown docs shipped with the IDE)
  {
    let { li } = newDropdownListItem('#help', 'IDE Help');
    $("#help_menu").prepend(li);
  }
  // all toolchain versions
  $("#item_tool_versions").click(openToolVersions);
}

// F1: open the help topic that matches whatever is focused right now.
// Going through the hash means Back returns to the previous view.
function showContextHelp() {
  if (!projectWindows) return;
  // widgets embedded outside ProjectWindows (e.g. the Verilog waveform
  // viewer) register their own topic; prefer that when it has focus
  var elId = elementHelpTopicForFocus();
  var isEditor = projectWindows.getActive() instanceof SourceEditor;
  var id = elId || helpTopicForView(projectWindows.getActiveID(), isEditor);
  var hash = '#help/' + id;
  if (window.location.hash === hash) {
    projectWindows.createOrShow(hash);
  } else {
    window.location.hash = hash;
  }
}

// Show the IDE's own version (from package.json) in the About menu.
function showAppVersion() {
  var label = getAppVersionLabel();
  if (!label) return;
  $("#item_app_version").text("8bitworkshop " + label).show();
}

function openToolVersions() {
  const esc = (s: any) => String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- current platform summary (params + the tools it can reach) ----
  const params = PLATFORM_PARAMS[platform_id]
    || PLATFORM_PARAMS[getBasePlatform(platform_id)]
    || PLATFORM_PARAMS[getRootBasePlatform(platform_id)];
  const arch = (params && params.arch) || '—';

  // extension -> tool, using the platform's own selector. The universe is the
  // tools' declared extensions (plus dasm's implicit .a), so this matches the
  // generated docs rather than just the new-file skeletons.
  const allExts = new Set<string>(['.a']);
  for (const id in TOOL_META) for (const e of TOOL_META[id].extensions || []) allExts.add(e);
  const toolExts: { [tool: string]: string[] } = {};
  const order: string[] = [];
  const add = (tool: string, ext: string) => {
    if (!tool) return;
    if (!toolExts[tool]) { toolExts[tool] = []; order.push(tool); }
    if (ext && toolExts[tool].indexOf(ext) < 0) toolExts[tool].push(ext);
  };
  if (platform.getDefaultExtensions) {
    for (const ext of allExts) {
      let tool = platform.getToolForFilename('test' + ext);
      let meta = tool && getToolMeta(tool);
      let claims = !!meta && (meta.extensions || []).indexOf(ext) >= 0;
      if (claims || (ext === '.a' && tool === 'dasm')) add(tool, ext);
    }
  }
  // always include the tool handling the file that's actually open
  const mainFile = getCurrentMainFilename();
  if (mainFile) {
    let mainTool = platform.getToolForFilename(mainFile);
    let dot = mainFile.lastIndexOf('.');
    add(mainTool, dot >= 0 ? mainFile.substring(dot) : '');
  }
  order.sort((a, b) => (getToolMeta(a)?.name || a).localeCompare(getToolMeta(b)?.name || b));

  const platformTable = `
    <table class="help">
      <tr><th>Architecture</th><td>${esc(arch)}</td></tr>
      ${params && params.cfgfile ? `<tr><th>Default config</th><td>${esc(params.cfgfile)}</td></tr>` : ''}
      ${params && params.libargs && params.libargs.length ? `<tr><th>Default libraries</th><td>${esc(params.libargs.join(' '))}</td></tr>` : ''}
      ${params && params.define && params.define.length ? `<tr><th>Defines</th><td>${esc(params.define.join(' '))}</td></tr>` : ''}
    </table>`;

  const toolTable = order.map(tool => {
    let meta = getToolMeta(tool);
    let version = getToolVersionLabel(meta);
    let kind = (meta && meta.kind) || '—';
    let exts = toolExts[tool].length ? toolExts[tool].map(e => `<code>${esc(e)}</code>`).join(' ') : '—';
    let name = (meta && meta.name) || tool;
    return `<tr><td>${esc(name)}</td><td>${esc(kind)}</td><td>${esc(version)}</td><td>${exts}</td></tr>`;
  }).join('\n');

  bootbox.dialog({
    title: 'Toolchain Info',
    onEscape: true,
    buttons: {
      docs: {
        label: 'Full reference',
        className: 'btn-link',
        callback: () => { window.location.hash = '#help/toolchains'; },
      },
      ok: { label: 'Close', className: 'btn-primary' },
    },
    message: `
    <div class="dialog-scroll">
      <h5 class="dialog-title">${esc(platform_name)} <small>${esc(platform_id)}</small></h5>
      ${platformTable}
      <h5 class="dialog-title">Tools for source files</h5>
      <table class="help">
        <tr><th>Tool</th><th>Kind</th><th>Version</th><th>Extensions</th></tr>
        ${toolTable}
      </table>
    </div>`,
  });
}

// Add Help entries for each tool that publishes a page specific to this
// platform (e.g. cc65's atari.html on atari8): the tool's main docs plus a
// "<tool> Help for <platform>" entry for the override. Tools with only
// generic docs are not listed here. Mirrors the extension sweep in
// openToolVersions().
function showToolHelp() {
  let tool = platform.getToolForFilename(getCurrentMainFilename());
  if (!tool) return;
  const meta = getToolMeta(tool);
  if (!meta) return;
  // include the vendored wasm version when we know it (TOOL_META.version)
  const version = meta.version ? ' (' + meta.version + ')' : '';
  const addEntry = (id: string, label: string, url: string) => {
    let { li, a } = newDropdownListItem(id, label);
    $("#help_menu").append(li);
    // opens an external page; don't let the placeholder href change our URL hash
    $(a).click((e) => { e.preventDefault(); window.open(url, '_8bws_help'); });
  };
  // the tool's main documentation page
  if (meta.helpURL) addEntry('help__' + tool, meta.name + ' Help' + version, meta.helpURL);
  // ...and the platform-specific page, if it has one
  const platformUrl = getPlatformToolHelpURL(tool, platform_id);
  if (platformUrl) {
    addEntry('help__' + tool + '__' + platform_id,
      meta.name + ' Help for ' + platform_name,
      platformUrl);
  }
}

function setupReplaySlider() {
  var replayslider = $("#replayslider");
  var clockslider = $("#clockslider");
  var replayframeno = $("#replay_frame");
  var clockno = $("#replay_clock");
  if (!platform.advanceFrameClock) $("#clockdiv").hide(); // TODO: put this test in recorder?
  var updateFrameNo = () => {
    replayframeno.text(stateRecorder.lastSeekFrame + "");
    clockno.text(stateRecorder.lastSeekStep + "");
  };
  var sliderChanged = (e) => {
    _pause();
    var frame: number = parseInt(replayslider.val().toString());
    var step: number = parseInt(clockslider.val().toString());
    if (stateRecorder.loadFrame(frame, step) >= 0) {
      clockslider.attr('min', 0);
      clockslider.attr('max', stateRecorder.lastStepCount);
      updateFrameNo();
      uiDebugCallback(platform.saveState());
    }
  };
  var setFrameTo = (frame: number) => {
    _pause();
    if (stateRecorder.loadFrame(frame) >= 0) {
      replayslider.val(frame);
      updateFrameNo();
      uiDebugCallback(platform.saveState());
    }
  };
  var setClockTo = (clock: number) => {
    _pause();
    var frame: number = parseInt(replayslider.val().toString());
    if (stateRecorder.loadFrame(frame, clock) >= 0) {
      clockslider.val(clock);
      updateFrameNo();
      uiDebugCallback(platform.saveState());
    }
  };
  stateRecorder.callbackStateChanged = () => {
    replayslider.attr('min', 0);
    replayslider.attr('max', stateRecorder.numFrames());
    replayslider.val(stateRecorder.currentFrame());
    clockslider.val(stateRecorder.currentStep());
    updateFrameNo();
    showDebugInfo(platform.saveState());
  };
  replayslider.on('input', sliderChanged);
  clockslider.on('input', sliderChanged);
  //replayslider.on('change', sliderChanged);
  $("#replay_min").click(() => { setFrameTo(1) });
  $("#replay_max").click(() => { setFrameTo(stateRecorder.numFrames()); });
  $("#replay_back").click(() => { setFrameTo(parseInt(replayslider.val().toString()) - 1); });
  $("#replay_fwd").click(() => { setFrameTo(parseInt(replayslider.val().toString()) + 1); });
  $("#clock_back").click(() => { setClockTo(parseInt(clockslider.val().toString()) - 1); });
  $("#clock_fwd").click(() => { setClockTo(parseInt(clockslider.val().toString()) + 1); });
  $("#replay_bar").show();
  uitoolbar.add('mod+shift+e', 'Start/Stop Replay Recording', 'glyphicon-record', _toggleRecording).prop('id', 'dbg_record');
}

async function showWelcomeMessage() {
  if (userPrefs.shouldCompleteTour()) {
    await loadScript('lib/bootstrap-tourist.js');
    var is_vcs = platform_id.startsWith('vcs');
    var steps = [
      {
        element: "#platformsMenuButton",
        placement: 'right',
        title: "Platform Selector",
        content: "You're currently on the \"<b>" + platform_id + "</b>\" platform. You can choose a different one from the menu."
      },
      {
        element: "#preset_select",
        title: "Project Selector",
        content: "You can choose different code examples, create your own files, or import projects from GitHub."
      },
      {
        element: "#workspace",
        title: "Code Editor",
        content: is_vcs ? "Type your 6502 assembly code into the editor, and it'll be assembled in real-time."
          : "Type your source code into the editor, and it'll be compiled in real-time."
      },
      {
        element: "#emulator",
        placement: 'left',
        title: "Emulator",
        content: "We'll load your compiled code into the emulator whenever you make changes."
      },
      {
        element: "#debug_bar",
        placement: 'bottom',
        title: "Debug Tools",
        content: "Use these buttons to set breakpoints, single step through code, pause/resume, and use debugging tools."
      },
      {
        element: "#dropdownMenuButton",
        title: "Main Menu",
        content: "Click the menu to create new files, download your code, or share your work with others."
      },
      {
        element: "#sidebar",
        title: "Sidebar",
        content: "Pull right to expose the sidebar. It lets you switch between source files, view assembly listings, and use other tools like Disassembler, Memory Browser, and Asset Editor."
      }
    ];
    if (isProductionHost()) {
      steps.unshift({
        element: "#dropdownMenuButton",
        placement: 'right',
        title: "Privacy Notice",
        content: 'Before we start: we store persistent data in your browser and send performance data to our server. Review our <a href="/privacy.html" target="_new">privacy policy</a>.'
      });
      steps.push({
        element: "#booksMenuButton",
        placement: 'left',
        title: "Books",
        content: "Get some books that explain how to program all of this stuff, and write some games!"
      });
    }
    var tour = new Tour({
      autoscroll: false,
      //storage:false,
      steps: steps,
      onEnd: () => {
        userPrefs.completedTour();
        //requestPersistPermission(false, true);
      }
    });
    setTimeout(() => { tour.start(); }, 2500);
  }
}

///////////////////////////////////////////////////

function globalErrorHandler(msgevent) {
  var msg = (msgevent.message || msgevent.error || msgevent) + "";
  // storage quota full? (Chrome) try to expand it
  if (msg.indexOf("QuotaExceededError") >= 0) {
    storageQuotaExceeded();
  } else {
    var err = msgevent.error || msgevent.reason;
    if (err != null && err instanceof EmuHalt) {
      haltEmulation(err);
    } else if (isProductionHost()) {
      // lightweight self-hosted error reporting
      reportErrorToServer(msg, err, {
        platform: platform_id,
        window: projectWindows ? projectWindows.getActiveID() : '',
        errors: projectWindows.lasterrors || [],
      });
    }
  }
}

export function haltEmulation(err?: EmuHalt) {
  console.log("haltEmulation");
  _pause();
  emulationHalted(err);
  // TODO: reset platform?
}

// catch errors
function installErrorHandler() {
  window.addEventListener('error', globalErrorHandler);
  window.addEventListener('unhandledrejection', globalErrorHandler);
}

function uninstallErrorHandler() {
  window.removeEventListener('error', globalErrorHandler);
  window.removeEventListener('unhandledrejection', globalErrorHandler);
}

export function gotoNewLocation(replaceHistory?: boolean, newQueryString?: {}) {
  if (newQueryString) {
    qs = newQueryString;
  }
  uninstallErrorHandler();
  if (replaceHistory)
    window.location.replace("?" + $.param(qs));
  else
    window.location.href = "?" + $.param(qs);
}

function replaceURLState() {
  if (platform_id) qs.platform = platform_id;
  delete qs['']; // remove null parameter
  history.replaceState({}, "", "?" + $.param(qs) + window.location.hash);
}

function hashToViewIdResolved(hash: string): string | null {
  if (!hash || hash === '#') return null;
  var id = decodeURIComponent(hash.substring(1));
  // check for extended asset editor hash (e.g. #asseteditor/filename/startline)
  if (id.startsWith('asseteditor/')) return '#asseteditor';
  // check for header viewer window (e.g. #headerview/nes.h); lazily register
  // so direct-hash navigation works too
  if (id.startsWith('headerview/')) {
    openHeaderFile(id.substring('headerview/'.length));
    return '#' + id;
  }
  // check if it's a registered tool window (e.g. #asseteditor)
  if (projectWindows.isWindow('#' + id)) return '#' + id;
  // otherwise treat as a file path (e.g. hello.asm)
  if (projectWindows.isWindow(id)) return id;
  return null;
}

function installHashChangeHandler() {
  function onHashChange() {
    const hash = window.location.hash;
    const viewId = (hash && hash !== '#') ? hashToViewIdResolved(hash) : null;
    if (viewId) {
      if (viewId !== projectWindows.getActiveID()) {
        projectWindows.createOrShow(viewId);
      }
    } else {
      // empty/unrecognized hash -- e.g. Back button from an extended hash like
      // #headerview/foo.h, since the main file's URL has no hash. Show main file.
      const mainFile = current_project.mainPath;
      if (mainFile && projectWindows.getActiveID() != mainFile) {
        projectWindows.createOrShow(mainFile);
      }
    }
  }
  window.addEventListener('popstate', onHashChange);
  window.addEventListener('hashchange', onHashChange);
}

function navigateToInitialHash(initialHash: string) {
  if (initialHash && initialHash !== '#') {
    const viewId = hashToViewIdResolved(initialHash) || current_project.mainPath;
    history.replaceState(null, '', initialHash);
    projectWindows.createOrShow(viewId);
  }
}

function addPageFocusHandlers() {
  var hidden = false;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState == 'hidden' && platform && platform.isRunning()) {
      _pause();
      hidden = true;
    } else if (document.visibilityState == 'visible' && hidden) {
      _resume();
      hidden = false;
    }
  });
  $(window).on("focus", () => {
    if (hidden) {
      _resume();
      hidden = false;
    }
  });
  $(window).on("blur", () => {
    if (platform && platform.isRunning()) {
      _pause();
      hidden = true;
    }
  });
  $(window).on("orientationchange", () => {
    if (platform && platform.resize) setTimeout(platform.resize.bind(platform), 200);
  });
}

// TODO: merge w/ player.html somehow?
function renderControls(div: JQuery) {
  div.empty();
  for (var hint of PLATFORM_CONTROLS[getRootBasePlatform(platform_id)] || []) {
    var def = $('<span class="control-def"/>').appendTo(div);
    for (var key of hint.keys) {
      // words get the small key cap, arrows the full-size one
      var cap = $('<span class="control-key"/>').toggleClass('small', /[a-z]/i.test(key)).appendTo(def);
      if (key.indexOf('\n') >= 0) {
        cap.css({ display: 'inline-block', 'font-family': 'monospace' });
        key.split('\n').forEach((line, i) => { if (i) cap.append('<br>'); cap.append(document.createTextNode(line)); });
      } else {
        cap.text(key);
      }
    }
    def.append(document.createTextNode(' ' + hint.action));
    div.append(' ');
  }
  return div.children().length > 0;
}

function showAudioHint() {
  const hint = $("#emuaudiohint");
  if (!hint.length) return;
  let wasBlocked = false;
  const update = () => {
    if (isAudioBlocked()) {
      wasBlocked = true;
      hint.show();
    } else {
      hint.hide();
      if (wasBlocked) unsubscribe();
    }
  };
  // AudioContext.resume() is async, so wait for the context to actually start
  // instead of hiding on the click that asked it to.
  const unsubscribe = onAudioStateChange(update);
  update();
}

function showInstructions() {
  showAudioHint();
  var div = $("#emucontrols");
  if (!renderControls(div)) return;
  if (platform_id.endsWith(".mame")) div.show(); // TODO: MAME seems to eat the focus() event
  var vcanvas = $("#emulator").find("canvas");
  if (vcanvas) {
    vcanvas.on('focus', () => {
      if (platform.isRunning()) {
        div.fadeIn(200);
        // unlock audio for browser autoplay policy (resume() no-ops if already running;
        // don't pair with pause() first -- suspend()/resume() are async and racing them
        // here left the AudioContext stuck suspended)
        platform.resume();
      }
    });
    vcanvas.on('blur', () => {
      div.fadeOut(200);
    });
  }
}

async function startPlatform() {
  if (!PLATFORMS[platform_id]) throw Error("Invalid platform '" + platform_id + "'.");
  let emudiv = $("#emuscreen")[0];
  let options = decodeQueryString(qs.options || '');
  platform = new PLATFORMS[platform_id](emudiv, options);
  setPlatformUI();
  stateRecorder = new StateRecorderImpl(platform);
  const PRESETS = platform.getPresets ? platform.getPresets() : [];
  if (!qs.file) {
    // try to load last file (redirect)
    var lastid = userPrefs.getLastPreset();
    // load first preset file, unless we're in a repo
    var defaultfile = lastid || (repo_id ? null : (PRESETS[0] && PRESETS[0].id));
    qs.file = defaultfile || 'DEFAULT';
    if (!defaultfile) {
      alertError("There is no default main file for this project. Try selecting one from the pulldown.");
    }
  }
  // legacy vcs stuff
  if (platform_id == 'vcs' && qs.file.startsWith('examples/') && !qs.file.endsWith('.a')) {
    qs.file += '.a';
  }
  // start platform and load file
  var initialHash = window.location.hash;
  replaceURLState();
  installErrorHandler();
  setHaltHandler(haltEmulation);
  installHDLHost();
  await platform.start();
  await loadBIOSFromProject();
  await initProject();
  await loadProject(qs.file);
  navigateToInitialHash(initialHash);
  installHashChangeHandler();
  platform.sourceFileFetch = (path) => current_project.filedata[path];
  setupDebugControls();
  // context-sensitive shortcuts/status bar (hidden by CSS on small windows)
  if (!isMobileDevice && $("#shortcuts_bar").length) {
    initShortcutBar($("#shortcuts_bar")[0]);
    setGlobalShortcutsFn(getGlobalShortcuts);
    setViewShortcutsFn(() => {
      // view-specific keys (CodeMirror bindings) only apply while that view has
      // focus; e.g. clicking the verilog waveform keeps the editor active but blurs it
      var div = projectWindows.id2div[projectWindows.activeid];
      var viewHasFocus = div && document.activeElement && div.contains(document.activeElement);
      var wnd = projectWindows.getActive();
      var shortcuts = viewHasFocus && wnd && wnd.getShortcuts ? wnd.getShortcuts() : [];
      // debug chips ride along with the view zone (they're gated on debugSessionActive)
      return [...getDebugShortcuts(), ...shortcuts];
    });
    // focus changes can invalidate view-specific shortcuts
    $(document).on('focusin focusout', () => refreshShortcutBar());
    refreshShortcutBar();
    setBarVisible(loadSettings().showStatusBar);
  }
  addPageFocusHandlers();
  showInstructions();
  if (isEmbed) {
    hideControlsForEmbed();
  } else {
    updateSelector();
    updateBooksMenu();
    showWelcomeMessage();
  }
  revealTopBar();
}

function hideControlsForEmbed() {
  $('#dropdownMenuButton').hide();
  $('#platformsMenuButton').hide();
  $('#booksMenuButton').hide();
}

function updateBooksMenu() {
  var active = bookFor(platform_id);
  for (var book of BOOKS) {
    var link = $('<a class="dropdown-item dropdown-link">')
      .attr({ href: book.url, target: '_book_' + book.id })
      .toggleClass('book-active', book === active)
      .append($('<img>').attr('src', 'images/' + book.image))
      .append('&nbsp;&nbsp;', $('<span class="book-title">').text(book.title));
    $('#booksMenuList').append($('<li>').append(link));
  }
}

function revealTopBar() {
  setTimeout(() => { $("#controls_dynamic").css('visibility', 'inherit'); }, 250);
}

function loadImportedURL(url: string) {
  // TODO: zip file?
  const ignore = parseBool(qs.ignore) || isEmbed;
  setWaitDialog(true);
  getWithBinary(url, async (data) => {
    if (data) {
      var path = getFilenameForPath(url);
      console.log("Importing " + data.length + " bytes as " + path);
      try {
        var olddata = await store.getItem(path);
        setWaitDialog(false);
        if (olddata != null && ignore) {
          // ignore=1, do nothing
        } else if (olddata == null || confirm("Replace existing file '" + path + "'?")) {
          await store.setItem(path, data);
        }
        delete qs.importURL;
        qs.file = path;
        replaceURLState();
        loadAndStartPlatform();
      } finally {
        setWaitDialog(false);
      }
    } else {
      alertError("Could not load source code from URL: " + url);
      setWaitDialog(false);
    }
  }, 'text');
}

async function loadFormDataUpload() {
  var ignore = parseBool(qs.ignore);
  var force = parseBool(qs.force);
  if (isEmbed) {
    ignore = !force; // ignore is default when embed=1 unless force=1
  } else {
    force = false; // can't use force w/o embed=1
  }
  for (var i = 0; i < 20; i++) {
    let path = qs['file' + i + '_name'];
    let dataenc = qs['file' + i + '_data'];
    if (path == null || dataenc == null) break;
    var olddata = await store.getItem(path);
    if (!(ignore && olddata)) {
      let value = dataenc;
      if (qs['file' + i + '_type'] == 'binary') {
        value = stringToByteArray(atob(value));
      }
      if (!olddata || force || confirm("Replace existing file '" + path + "'?")) {
        await store.setItem(path, value);
      }
    }
    if (i == 0) { qs.file = path; } // set main filename
    delete qs['file' + i + '_name'];
    delete qs['file' + i + '_data'];
    delete qs['file' + i + '_type'];
  }
  delete qs.ignore;
  delete qs.force;
  replaceURLState();
}

function setPlatformUI() {
  var name = platform.getPlatformName && platform.getPlatformName();
  var menuitem = $('a[href="?platform=' + platform_id + '"]');
  if (menuitem.length) {
    menuitem.addClass("dropdown-item-checked");
    name = name || menuitem.text() || name;
  }
  platform_name = name || platform_id;
  $(".platform_name").text(platform_name);
}

export function getPlatformAndRepo() {
  // lookup repository for this platform (TODO: enable cross-platform repos)
  platform_id = qs.platform || userPrefs.getLastPlatformID();
  repo_id = qs.repo;
  // only look at cached repo_id if file= is not present, so back button works
  if (!qs.repo && !qs.file)
    repo_id = userPrefs.getLastRepoID(platform_id);
  // are we in a repo?
  if (hasLocalStorage && repo_id && repo_id !== '/') {
    var repo = getRepos()[repo_id];
    // override query string params w/ repo settings
    if (repo) {
      console.log(platform_id, qs, repo);
      qs.repo = repo_id;
      if (repo.platform_id && !qs.platform)
        qs.platform = platform_id = repo.platform_id;
      if (repo.mainPath && !qs.file)
        qs.file = repo.mainPath;
      // TODO: update repo definition if new main file compiles successfully
      //requestPersistPermission(true, true);
    }
  } else {
    repo_id = '';
    delete qs.repo;
  }
  // add default platform
  if (!platform_id) {
    if (isEmbed) fatalError(`The 'platform' must be specified when embed=1`);
    // first launch: open a random demo from the books instead of Hello World
    const demo = firstVisitDemo(qs, userPrefs.isFirstVisit());
    if (demo) {
      console.log(`first launch: opening book demo ${demo.platform}/${demo.file}`);
      platform_id = qs.platform = demo.platform;
      qs.file = demo.file;
    } else {
      platform_id = qs.platform = "vcs";
    }
  }
}

// start
export async function startUI() {
  showAppVersion();
  // import from github?
  if (qs.githubURL) {
    importProjectFromGithub(qs.githubURL, true);
    return;
  }
  // repo= given, but not imported yet? offer to import it from github
  // (repo can be "user/repo" or "user/repo/tree/branch/...")
  if (hasLocalStorage && qs.repo && !getRepos()[qs.repo] && qs.repo !== '/') {
    if (confirm(`Repository '${qs.repo}' was not found locally. Import it from GitHub?`)) {
      importProjectFromGithub('https://github.com/' + qs.repo, true);
      return;
    }
    delete qs.repo; // continue without repo
  }
  getPlatformAndRepo();
  setupSplits({
    getPlatformId: () => platform_id,
    isEmbed: isEmbed,
    hasLocalStorage: hasLocalStorage,
    resizePlatform: () => { if (platform && platform.resize) platform.resize(); },
    resizeWindows: () => { if (projectWindows) projectWindows.resize(); },
    // in tab mode only one pane is visible; pause the emulator when the
    // emulator tab isn't on screen, and resume it when it comes back
    onTabChanged: (tab) => {
      if (!isPlatformReady()) return;
      if (tab !== 'emulator') {
        if (platform.isRunning()) {
          _pause();
          tabPausedEmulator = true; // remember it was us, not the user
        }
      } else if (tabPausedEmulator) {
        tabPausedEmulator = false;
        if (!platform.isRunning()) _resume();
      }
    },
  });
  // get store ID, repo id or platform id
  store_id = repo_id || getBasePlatform(platform_id);
  // are we embedded?
  if (isEmbed) {
    store_id = (document.referrer || document.location.href) + store_id;
  }
  // create store
  store = createNewPersistentStore(store_id);
  // is this an importURL?
  if (qs.importURL) {
    loadImportedURL(qs.importURL);
    return; // TODO: make async
  }
  // is this a file POST?
  if (qs.file0_name) {
    await loadFormDataUpload();
  }
  // load and start platform object
  loadAndStartPlatform();
}

async function loadAndStartPlatform() {
  try {
    var module = await importPlatform(getRootBasePlatform(platform_id));
    console.log("starting platform", platform_id); // loaded required <platform_id>.js file
    await startPlatform();
    projectWindows.titlePrefix = document.title + " [" + platform_id + "] - " + (repo_id ? ('[' + repo_id + '] - ') : '');
    projectWindows.updateTitle(projectWindows.getActiveID() || current_project.mainPath);
  } catch (e) {
    console.log(e);
    alertError('Platform "' + platform_id + '" failed to load.');
  } finally {
    revealTopBar();
  }
}

//// ELECTRON (and other external) STUFF

export function setTestInput(path: string, data: FileData) {
  platform.writeFile(path, data);
}

export function getTestOutput(path: string): FileData {
  return platform.readFile(path);
}

export function getSaveState() {
  return platform.saveState();
}

export function emulationHalted(err: EmuHalt) {
  var msg = (err && err.message) || msg;
  showExceptionAsError(err, msg);
  const state = platform.saveState ? platform.saveState() : null;
  // A trap halts with the PC on the compiler's spin stub; the address that
  // faulted is on the stack. Show the arrow there, and keep it there: the
  // final debug tick refreshes the editor from lastDebugState after we return.
  if (state && state.c && err && err.pc != null) {
    lastDebugState = { ...state, c: { ...state.c, PC: err.pc } };
  } else {
    lastDebugState = state;
  }
  // passive refresh: show the PC gutter arrow but don't move the cursor or
  // repaint the current line, since the user may be typing
  projectWindows.refresh(false);
  if (state) {
    showDebugInfo(state);
    // don't do this because it'll mess with user selected window!
    //openRelevantListing(state);
  }
}

// get remote file from local fs
declare var alternateLocalFilesystem: ProjectFilesystem;

export async function reloadWorkspaceFile(path: string) {
  var oldval = current_project.filedata[path];
  if (oldval != null) {
    projectWindows.updateFile(path, await alternateLocalFilesystem.getFileData(path));
    console.log('updating file', path);
  }
}
function writeOutputROMFile() {
  if (isElectron && current_output instanceof Uint8Array) {
    var prefix = getFilenamePrefix(getCurrentMainFilename());
    var suffix = (platform.getROMExtension && platform.getROMExtension(current_output))
      || "-" + getBasePlatform(platform_id) + ".bin";
    alternateLocalFilesystem.setFileData(`bin/${prefix}${suffix}`, current_output);
  }
}

// Start UI

function startUIWhenVisible() {
  let started = false;
  let observer = new IntersectionObserver((entries, observer) => {
    for (var entry of entries) {
      if (entry.isIntersecting && !started) {
        startUI();
        started = true;
      }
      if (entry.intersectionRatio == 0 && isPlatformReady() && platform.isRunning()) {
        _pause();
      }
      if (entry.intersectionRatio > 0 && isPlatformReady() && !platform.isRunning()) {
        _resume();
      }
    }
  }, {});
  observer.observe($("#emulator")[0]); //window.document.body);
}

/// start UI if in browser (not node)
if (typeof process === 'undefined') {
  // if embedded, do not start UI until we scroll past it
  if (isEmbed && typeof IntersectionObserver === 'function') {
    startUIWhenVisible();
  } else {
    startUI();
  }
}
