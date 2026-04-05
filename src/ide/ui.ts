
// 8bitworkshop IDE user interface

import * as localforage from "localforage";
import { DebugEvalCondition, DebugSymbols, EmuState, isDebuggable, Platform, Preset } from "../common/baseplatform";
import { EmuHalt, PLATFORMS } from "../common/emu";
import { StateRecorderImpl } from "../common/recorder";
import {
  byteArrayToUTF8, decodeQueryString, getBasePlatform, getCookie, getFilenameForPath, getFilenamePrefix,
  getRootBasePlatform, getWithBinary, hex, highlightDifferences, isProbablyBinary, loadScript, parseBool, stringToByteArray
} from "../common/util";
import { FileData, WorkerError, WorkerResult } from "../common/workertypes";
import { importPlatform } from "../platform/_index";
import { gaEvent, gaPageView } from "./analytics";
import { alertError, alertInfo, fatalError, setWaitDialog } from "./dialogs";
import { openSettings } from "./settings";
import { CodeProject, createNewPersistentStore, LocalForageFilesystem, OverlayFilesystem, ProjectFilesystem, WebPresetsFileSystem } from "./project";
import { getRepos, parseGithubURL } from "./services";
import { _downloadAllFilesZipFile, _downloadCassetteFile, _downloadProjectZipFile, _downloadROMImage, _downloadSourceFile, _downloadSymFile, _getCassetteFunction, _recordVideo, _shareEmbedLink } from "./shareexport";
import { _importProjectFromGithub, _loginToGithub, _logoutOfGithub, _publishProjectToGithub, _pullProjectFromGithub, _pushProjectToGithub, _removeRepository, importProjectFromGithub } from "./sync";
import { Toolbar } from "./toolbar";
import { AssetEditorView } from "./views/asseteditor";
import { isMobileDevice } from "./views/baseviews";
import { AddressHeatMapView, BinaryFileView, MemoryMapView, MemoryView, ProbeLogView, ProbeSymbolView, RasterStackMapView, ScanlineIOView, VRAMMemoryView } from "./views/debugviews";
import { DisassemblerView, ListingView, PC_LINE_LOOKAHEAD, SourceEditor, setUppercaseOnly } from "./views/editors";
import { CallStackView, DebugBrowserView } from "./views/treeviews";
import { ProjectWindows } from "./windows";
import Split = require('split.js');
import DOMPurify = require("dompurify");

// external libs (TODO)
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

// TODO: codemirror multiplex support?
// TODO: move to views.ts?
const TOOL_TO_SOURCE_STYLE = {
  'dasm': '6502',
  'acme': '6502',
  'cc65': 'text/x-csrc',
  'ca65': '6502',
  'nesasm': '6502',
  'z80asm': 'z80',
  'sdasz80': 'z80',
  'sdasgb': 'z80',
  'sdcc': 'text/x-csrc',
  'verilator': 'verilog',
  'jsasm': 'z80',
  'zmac': 'z80',
  'bataribasic': 'bataribasic',
  'markdown': 'markdown',
  'js': 'javascript',
  'xasm6809': '6809',
  'cmoc': 'text/x-csrc',
  'yasm': 'gas',
  'smlrc': 'text/x-csrc',
  'inform6': 'inform6',
  'fastbasic': 'fastbasic',
  'basic': 'basic',
  'silice': 'verilog',
  'wiz': 'text/x-wiz',
  'vasmarm': 'vasm',
  'armips': 'vasm',
  'ecs': 'ecs',
  'remote:llvm-mos': 'text/x-csrc',
  'cc2600': 'text/x-csrc',
  'cc7800': 'text/x-csrc',
  'armtcc': 'text/x-csrc',
  'oscar64': 'text/x-csrc',
}

// TODO: move into tool class
const TOOL_TO_HELPURL = {
  'dasm': 'https://raw.githubusercontent.com/sehugg/dasm/master/doc/dasm.txt',
  'cc65': 'https://cc65.github.io/doc/cc65.html',
  'ca65': 'https://cc65.github.io/doc/ca65.html',
  'sdcc': 'http://sdcc.sourceforge.net/doc/sdccman.pdf',
  'verilator': 'https://www.veripool.org/ftp/verilator_doc.pdf',
  'fastbasic': 'https://github.com/dmsc/fastbasic/blob/master/manual.md',
  'bataribasic': "help/bataribasic/manual.html",
  'wiz': "https://github.com/wiz-lang/wiz/blob/master/readme.md#wiz",
  'silice': "https://github.com/sylefeb/Silice",
  'zmac': "https://raw.githubusercontent.com/sehugg/zmac/master/doc.txt",
  'cmoc': "http://perso.b2b2c.ca/~sarrazip/dev/cmoc.html",
  'remote:llvm-mos': 'https://llvm-mos.org/wiki/Welcome',
  'acme': 'https://raw.githubusercontent.com/sehugg/acme/main/docs/QuickRef.txt',
}

export function getModeForPath(path: string) {
  var tool = platform.getToolForFilename(path);
  // hack because .h files can be DASM or CC65
  if (tool == 'dasm' && path.endsWith(".h") && getCurrentMainFilename().endsWith(".c")) {
    tool = 'cc65';
  }
  var mode = tool && TOOL_TO_SOURCE_STYLE[tool];
  return mode;
}

function newWorker(): Worker {
  // TODO: return new Worker("https://8bitworkshop.com.s3-website-us-east-1.amazonaws.com/dev/gen/worker/bundle.js");
  return new Worker("./gen/worker/bundle.js");
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
  shouldCompleteTour() {
    return hasLocalStorage && !isEmbed && !localStorage.getItem("8bitworkshop.hello");
  }
  completedTour() {
    if (hasLocalStorage && !isEmbed) localStorage.setItem("8bitworkshop.hello", "true");
  }
}

var userPrefs = new UserPrefs();

// https://developers.google.com/web/updates/2016/06/persistent-storage
function requestPersistPermission(interactive: boolean, failureonly: boolean) {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(persistent => {
      console.log("requestPersistPermission =", persistent);
      if (persistent) {
        interactive && !failureonly && alertInfo("Your browser says it will persist your local file edits, but you may want to back up your work anyway.");
      } else {
        interactive && alertError("Your browser refused to expand the peristent storage quota. Your edits may not be preserved after closing the page.");
      }
    });
  } else {
    interactive && alertError("Your browser may not persist edits after closing the page. Try a different browser.");
  }
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
  current_project.remoteTool = qs.tool || null;
  projectWindows = new ProjectWindows($("#workspace")[0] as HTMLElement, current_project);
  current_project.callbackBuildResult = (result: WorkerResult) => {
    setCompileOutput(result);
  };
  current_project.callbackBuildStatus = (busy: boolean) => {
    setBusyStatus(busy);
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

function refreshWindowList() {
  var ul = $("#windowMenuList").empty();
  var separate = false;

  function addWindowItem(id, name, createfn) {
    if (separate) {
      ul.append(document.createElement("hr"));
      separate = false;
    }
    let { li, a } = newDropdownListItem(id, name);
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

  function addEditorItem(id: string) {
    addWindowItem(id, getFilenameForPath(id), () => {
      var data = current_project.getFile(id);
      if (typeof data === 'string')
        return new SourceEditor(id, getModeForPath(id));
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
    addWindowItem("#callstack", "Call Stack", () => {
      return new CallStackView();
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
  addWindowItem('#asseteditor', 'Asset Editor', () => {
    return new AssetEditorView();
  });
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
  var ext = platform.getToolForFilename(fileid);
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
      url: "presets/" + basePlatform + "/skeleton." + tool,
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
        gaEvent('workspace', 'file', 'new');
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
      gaEvent('workspace', 'file', 'upload');
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
  return {
    getFileData: async (path) => {
      console.log('getFileData', path);
      let fileHandle = await dirHandle.getFileHandle(path, { create: false });
      console.log('getFileData', fileHandle);
      let file = await fileHandle.getFile();
      console.log('getFileData', file);
      let contents = await (isProbablyBinary(path) ? file.binary() : file.text());
      console.log(fileHandle, file, contents);
      return contents;
    },
    setFileData: async (path, data) => {
      //let vh = await dirHandle.getFileHandle(path, { create: true });
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
  if (wnd && wnd.setText) {
    var fn = projectWindows.getActiveID();
    $.get("presets/" + getBasePlatform(platform_id) + "/" + fn, (text) => {
      bootbox.confirm("Reset '" + DOMPurify.sanitize(fn) + "' to default?", (ok) => {
        if (ok) {
          wnd.setText(text);
        }
      });
    }, 'text')
      .fail(() => {
        if (repo_id) alertError("Can only revert built-in examples. If you want to revert all files, You can pull from the repository.");
        else alertError("Can only revert built-in examples.");
      });
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

async function setCompileOutput(data: WorkerResult) {
  if ('uppercaseOnly' in data) {
    setUppercaseOnly(data.uppercaseOnly);
  }
  // errors? mark them in editor
  if ('errors' in data && data.errors.length > 0) {
    toolbar.addClass("has-errors");
    projectWindows.setErrors(data.errors);
    refreshWindowList(); // to make sure windows are created for showErrorAlert()
    showErrorAlert(data.errors, false);
  } else {
    toolbar.removeClass("has-errors"); // may be added in next callback
    projectWindows.setErrors(null);
    hideErrorAlerts();
    // exit if compile output unchanged
    if (data == null || ('unchanged' in data && data.unchanged)) return;
    // make sure it's a WorkerOutputResult
    if (!('output' in data)) return;
    // process symbol map
    platform.debugSymbols = new DebugSymbols(data.symbolmap, data.debuginfo);
    compparams = data.params;
    // load ROM
    var rom = data.output;
    if (rom != null) {
      try {
        clearBreakpoint(); // so we can replace memory (TODO: change toolbar btn)
        _resetRecording();
        await platform.loadROM(getCurrentPresetTitle(), rom, data.origin);
        current_output = rom;
        if (!userPaused) _resume();
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
    // update all windows (listings)
    refreshWindowList();
    projectWindows.refresh(false);
  }
}

async function loadBIOSFromProject() {
  if (platform.loadBIOS) {
    var biospath = platform_id + '.rom';
    var biosdata = await store.getItem(biospath);
    if (biosdata instanceof Uint8Array) {
      console.log('loading BIOS', biospath, biosdata.length + " bytes")
      platform.loadBIOS(biospath, biosdata);
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

function openRelevantListing(state: EmuState) {
  // if we clicked on a specific tool, don't switch windows
  if (lastViewClicked && lastViewClicked.startsWith('#')) return;
  // don't switch windows for specific debug commands
  if (['toline', 'restart', 'tovsync', 'stepover'].includes(lastDebugCommand)) return;
  // has to support disassembly, at least
  if (!platform.disassemble) return;
  // search through listings
  let listings = current_project.getListings();
  let bestid = "#disasm";
  let bestscore = 256;
  if (listings) {
    let pc = state.c ? (state.c.EPC || state.c.PC) : 0;
    for (let lstfn in listings) {
      let lst = listings[lstfn];
      let file = lst.assemblyfile || lst.sourcefile;
      // pick either listing or source file
      let wndid = current_project.filename2path[lstfn] || lstfn;
      if (file == lst.sourcefile) wndid = projectWindows.findWindowWithFilePrefix(lstfn);
      // does this window exist?
      if (projectWindows.isWindow(wndid)) {
        // find the source line at the PC or closely before it
        let srcline1 = file && file.findLineForOffset(pc, PC_LINE_LOOKAHEAD);
        if (srcline1) {
          // try to find the next line and bound the PC
          let srcline2 = file.lines[srcline1.line + 1];
          if (!srcline2 || pc < srcline2.offset) {
            let score = pc - srcline1.offset;
            if (score < bestscore) {
              bestid = wndid;
              bestscore = score;
            }
          }
          //console.log(hex(pc,4), srcline1, srcline2, wndid, lstfn, bestid, bestscore);
        }
      }
    }
  }
  // if no appropriate listing found, use disassembly view
  projectWindows.createOrShow(bestid, true);
}

function uiDebugCallback(state: EmuState) {
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
  _disableRecording();
  setupDebugCallback(btnid);
  if (btnid) setDebugButtonState(btnid, "active");
}

function _pause() {
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

  // If the active editor has breakpoints, resume with them
  var wnd = projectWindows.getActive();
  if (wnd instanceof SourceEditor) {
    var bpPCs = wnd.getBreakpointPCs();
    if (bpPCs.length > 0) {
      if (!platform.isRunning()) {
        projectWindows.refresh(false);
      }
      runToPC(bpPCs);
      userPaused = false;
      lastViewClicked = null;
      return;
    }
  }

  clearBreakpoint();
  if (!platform.isRunning()) {
    projectWindows.refresh(false);
  }
  _resume();
  userPaused = false;
  lastViewClicked = null;
}

function singleStep() {
  if (!checkRunReady()) return;
  setupBreakpoint("step");
  platform.step();
}

function stepOver() {
  if (!checkRunReady()) return;
  setupBreakpoint("stepover");
  platform.stepOver();
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
}

function resetAndRun() {
  if (!checkRunReady()) return;
  clearBreakpoint();
  resetPlatform();
  _resume();
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

function _breakExpression() {
  var modal = $("#debugExprModal");
  var btn = $("#debugExprSubmit");
  $("#debugExprInput").val(lastBreakExpr);
  $("#debugExprExamples").text(getDebugExprExamples());
  modal.modal('show');
  btn.off('click').on('click', () => {
    var exprs = $("#debugExprInput").val() + "";
    modal.modal('hide');
    breakExpression(exprs);
  });
}

function getDebugExprExamples(): string {
  var state = platform.saveState && platform.saveState();
  var cpu = state.c;
  console.log(cpu, state);
  var s = '';
  if (cpu.PC) s += "c.PC == 0x" + hex(cpu.PC) + "\n";
  if (cpu.SP) s += "c.SP < 0x" + hex(cpu.SP) + "\n";
  if (cpu['HL']) s += "c.HL == 0x4000\n";
  if (platform.readAddress) s += "this.readAddress(0x1234) == 0x0\n";
  if (platform.readVRAMAddress) s += "this.readVRAMAddress(0x1234) != 0x80\n";
  if (platform['getRasterScanline']) s += "this.getRasterScanline() > 222\n";
  return s;
}

function breakExpression(exprs: string) {
  var fn = new Function('c', 'return (' + exprs + ');').bind(platform);
  setupBreakpoint();
  platform.runEval(fn as DebugEvalCondition);
  lastBreakExpr = exprs;
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
  if (fn.endsWith(".c") || tool == 'sdcc' || tool == 'cc65' || tool == 'cmoc' || tool == 'smlrc')
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
  uitoolbar.add('ctrl+alt+r', 'Reset', 'glyphicon-refresh', resetAndRun).prop('id', 'dbg_reset');
  uitoolbar.add('ctrl+alt+,', 'Pause', 'glyphicon-pause', pause).prop('id', 'dbg_pause');
  uitoolbar.add('ctrl+alt+.', 'Resume', 'glyphicon-play', resume).prop('id', 'dbg_go');
  if (platform.restartAtPC) {
    uitoolbar.add('ctrl+alt+/', 'Restart at Cursor', 'glyphicon-play-circle', restartAtCursor).prop('id', 'dbg_restartatline');
  }
  uitoolbar.newGroup();
  uitoolbar.grp.prop('id', 'debug_bar');
  if (platform.runEval) {
    uitoolbar.add('ctrl+alt+e', 'Reset and Debug', 'glyphicon-fast-backward', resetAndDebug).prop('id', 'dbg_restart');
  }
  if (platform.stepBack) {
    uitoolbar.add('ctrl+alt+b', 'Step Backwards', 'glyphicon-step-backward', runStepBackwards).prop('id', 'dbg_stepback');
  }
  if (platform.step) {
    uitoolbar.add('ctrl+alt+s', 'Single Step', 'glyphicon-step-forward', singleStep).prop('id', 'dbg_step');
  }
  if (platform.stepOver) {
    uitoolbar.add('ctrl+alt+t', 'Step Over', 'glyphicon-hand-right', stepOver).prop('id', 'dbg_stepover');
  }
  if (platform.runUntilReturn) {
    uitoolbar.add('ctrl+alt+o', 'Step Out of Subroutine', 'glyphicon-hand-up', runUntilReturn).prop('id', 'dbg_stepout');
  }
  if (platform.runToVsync) {
    uitoolbar.add('ctrl+alt+n', 'Next Frame/Interrupt', 'glyphicon-forward', singleFrameStep).prop('id', 'dbg_tovsync');
  }
  if ((platform.runEval || platform.runToPC) && !platform_id.startsWith('verilog')) {
    uitoolbar.add('ctrl+alt+l', 'Run To Line', 'glyphicon-save', runToCursor).prop('id', 'dbg_toline');
  }
  uitoolbar.newGroup();
  uitoolbar.grp.prop('id', 'xtra_bar');
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
  if (platform.runEval)
    $("#item_debug_expr").click(_breakExpression).show();
  else
    $("#item_debug_expr").hide();
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
  // setup replay slider
  if (platform.setRecorder && platform.advance) {
    setupReplaySlider();
  }
  // help menu items
  if (platform.showHelp) {
    let { li, a } = newDropdownListItem('help__' + platform_id, platform_name + ' Help');
    $("#help_menu").append(li);
    $(a).click(() => window.open(platform.showHelp(), '_8bws_help'));
  }
  // tool help
  let tool = platform.getToolForFilename(getCurrentMainFilename());
  let toolhelpurl = TOOL_TO_HELPURL[tool];
  if (toolhelpurl) {
    let { li, a } = newDropdownListItem('help__' + tool, tool + ' Help');
    $("#help_menu").append(li);
    $(a).click(() => window.open(toolhelpurl, '_8bws_help'));
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
  uitoolbar.add('ctrl+alt+0', 'Start/Stop Replay Recording', 'glyphicon-record', _toggleRecording).prop('id', 'dbg_record');
}


function isLandscape() {
  try {
    var object = window.screen['orientation'] || window.screen['msOrientation'] || window.screen['mozOrientation'] || null;
    if (object) {
      if (object.type.indexOf('landscape') !== -1) { return true; }
      if (object.type.indexOf('portrait') !== -1) { return false; }
    }
    if ('orientation' in window) {
      var value = window.orientation;
      if (value === 0 || value === 180) {
        return false;
      } else if (value === 90 || value === 270) {
        return true;
      }
    }
  } catch (e) { }
  // fallback to comparing width to height
  return window.innerWidth > window.innerHeight;
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
    if (!isLandscape()) {
      steps.unshift({
        element: "#controls_top",
        placement: 'bottom',
        title: "Portrait mode detected",
        content: "This site works best on desktop browsers. For best results, rotate your device to landscape orientation."
      });
    }
    if (window.location.host.endsWith('8bitworkshop.com')) {
      steps.unshift({
        element: "#dropdownMenuButton",
        placement: 'right',
        title: "Cookie Consent",
        content: 'Before we start, we should tell you that this website stores cookies and other data in your browser. You can review our <a href="/privacy.html" target="_new">privacy policy</a>.'
      });
      steps.push({
        element: "#booksMenuButton",
        placement: 'left',
        title: "Books",
        content: "Get some books that explain how to program all of this stuff, and write some games!"
      });
    }
    if (isElectron) {
      steps.unshift({
        element: "#dropdownMenuButton",
        placement: 'right',
        title: "Developer Analytics",
        content: 'BTW, we send stack traces to sentry.io when exceptions are thrown. Hope that\'s ok.'
      });
      steps.unshift({
        element: "#dropdownMenuButton",
        placement: 'right',
        title: "Welcome to 8bitworkshop Desktop!",
        content: 'The directory "~/8bitworkshop" contains all of your file edits and built ROM images. You can create new projects under the platform directories (e.g. "c64/myproject")'
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
    requestPersistPermission(false, false);
  } else {
    var err = msgevent.error || msgevent.reason;
    if (err != null && err instanceof EmuHalt) {
      haltEmulation(err);
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
    if (viewId && viewId !== projectWindows.getActiveID()) {
      projectWindows.createOrShow(viewId);
    }
  }
  window.addEventListener('popstate', onHashChange);
  window.addEventListener('hashchange', onHashChange);
}

function navigateToInitialHash(initialHash: string) {
  if (initialHash && initialHash !== '#') {
    const viewId = hashToViewIdResolved(initialHash) || getCurrentMainFilename();
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
function showInstructions() {
  var div = $(document).find(".emucontrols-" + getRootBasePlatform(platform_id));
  if (platform_id.endsWith(".mame")) div.show(); // TODO: MAME seems to eat the focus() event
  var vcanvas = $("#emulator").find("canvas");
  if (vcanvas) {
    vcanvas.on('focus', () => {
      if (platform.isRunning()) {
        div.fadeIn(200);
        // toggle sound for browser autoplay
        platform.pause();
        platform.resume();
      }
    });
    vcanvas.on('blur', () => {
      div.fadeOut(200);
    });
  }
}

function installGAHooks() {
  if (window['ga']) {
    $(".dropdown-item").click((e) => {
      if (e.target && e.target.id) {
        gaEvent('menu', e.target.id);
      }
    });
    gaPageView(location.pathname + '?platform=' + platform_id + (repo_id ? ('&repo=' + repo_id) : ('&file=' + qs.file)));
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
    var defaultfile = lastid || (repo_id ? null : PRESETS[0].id);
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
  installGAHooks();
  await platform.start();
  await loadBIOSFromProject();
  await initProject();
  await loadProject(qs.file);
  navigateToInitialHash(initialHash);
  installHashChangeHandler();
  platform.sourceFileFetch = (path) => current_project.filedata[path];
  setupDebugControls();
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
  if (getRootBasePlatform(platform_id) == 'nes') $(".book-nes").addClass("book-active");
  else if (getRootBasePlatform(platform_id) == 'vcs') $(".book-vcs").addClass("book-active");
  else if (getRootBasePlatform(platform_id) == 'verilog') $(".book-verilog").addClass("book-active");
  else if (getRootBasePlatform(platform_id) == 'c64') $(".book-c64").addClass("book-active");
  else if (platform.getToolForFilename(getCurrentMainFilename()) == 'sdcc') $(".book-arcade").addClass("book-active");
}

function revealTopBar() {
  setTimeout(() => { $("#controls_dynamic").css('visibility', 'inherit'); }, 250);
}

export function setupSplits() {
  var splitName = 'workspace-split3-' + platform_id;
  if (isEmbed) splitName = 'embed-' + splitName;
  var sizes;
  if (platform_id.startsWith('vcs'))
    sizes = [0, 50, 50];
  else if (isEmbed || isMobileDevice)
    sizes = [0, 55, 45];
  else
    sizes = [12, 44, 44];
  var sizesStr = hasLocalStorage && localStorage.getItem(splitName);
  if (sizesStr) {
    try {
      sizes = JSON.parse(sizesStr);
    } catch (e) { console.log(e); }
  }
  var split = Split(['#sidebar', '#workspace', '#emulator'], {
    sizes: sizes,
    minSize: [0, 250, 250],
    onDrag: () => {
      if (platform && platform.resize) platform.resize();
    },
    onDragEnd: () => {
      if (hasLocalStorage) localStorage.setItem(splitName, JSON.stringify(split.getSizes()))
      if (projectWindows) projectWindows.resize();
    },
  });
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
    platform_id = qs.platform = "vcs";
  }
}

// start
export async function startUI() {
  // import from github?
  if (qs.githubURL) {
    importProjectFromGithub(qs.githubURL, true);
    return;
  }
  getPlatformAndRepo();
  setupSplits();
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

// HTTPS REDIRECT

const useHTTPSCookieName = "__use_https";

function setHTTPSCookie(val: number) {
  document.cookie = useHTTPSCookieName + "=" + val + ";domain=8bitworkshop.com;path=/;max-age=315360000";
}

function shouldRedirectHTTPS(): boolean {
  // cookie set? either true or false
  var shouldRedir = getCookie(useHTTPSCookieName);
  if (typeof shouldRedir === 'string') {
    return !!shouldRedir; // convert to bool
  }
  // set a 10yr cookie, value depends on if it's our first time here
  var val = hasLocalStorage && !localStorage.getItem("__lastplatform") ? 1 : 0;
  setHTTPSCookie(val);
  return !!val;
}

function _switchToHTTPS() {
  bootbox.confirm('<p>Do you want to force the browser to use HTTPS from now on?</p>' +
    '<p>WARNING: This will make all of your local files unavailable, so you should "Download All Changes" first for each platform where you have done work.</p>' +
    '<p>You can go back to HTTP by setting the "' + useHTTPSCookieName + '" cookie to 0.</p>', (ok) => {
      if (ok) {
        setHTTPSCookie(1);
        redirectToHTTPS();
      }
    });
}

function redirectToHTTPS() {
  if (window.location.protocol == 'http:' && window.location.host == '8bitworkshop.com') {
    if (shouldRedirectHTTPS()) {
      uninstallErrorHandler();
      window.location.replace(window.location.href.replace(/^http:/, 'https:'));
    } else {
      $("#item_switch_https").click(_switchToHTTPS).show();
    }
  }
}

// redirect to HTTPS after script loads?
redirectToHTTPS();

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
  projectWindows.refresh(false); // don't mess with cursor
  if (platform.saveState) showDebugInfo(platform.saveState());
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
