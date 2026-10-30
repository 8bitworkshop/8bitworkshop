import { defaultKeymap, deleteLine, history, historyKeymap, isolateHistory, redo, undo, toggleComment } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput, indentService, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap, openSearchPanel, findNext, selectNextOccurrence } from "@codemirror/search";
import { Compartment, EditorState, Extension, StateEffect, StateField } from "@codemirror/state";
import { crosshairCursor, Decoration, DecorationSet, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, KeyBinding, rectangularSelection, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { CodeAnalyzer } from "../../common/analysis";
import { ProbeFlags, ProbeRecorder } from "../../common/probe";
import { getFilenameForPath, getFolderForPath, hex, rpad } from "../../common/util";
import { getIncludeDirs, getIncludePatterns, getLinkPatterns, getSharedFileSystemName, getSystemIncludePatterns, getToolMeta, getToolMetaForFilename } from "../../common/toolmeta";
import { WorkerMessage } from "../../common/workertypes";
import { SourceFile, SourceLocation, WorkerError } from "../../common/workertypes";
import { parserRegistry, getLanguageSupportForStyle, getDefaultLanguageParser } from "../../parser/registry";
import { cobalt } from "../../themes/cobalt";
import { disassemblyTheme } from "../../themes/disassemblyTheme";
import { editorTheme } from "../../themes/editorTheme";
import { mbo } from "../../themes/mbo";
import { loadSettings, registerEditor, settingsExtensions } from "../settings";
import { asmSpacesKeymap, detectIndentUnit, lineBasedEnterKeymap } from "./tabs";
import { current_project, lastDebugState, openHeaderFile, platform, qs, runToPC } from "../ui";
import { bpStore, canUseBreakpoints } from "../breakpoints";
import { IDE_RESERVED_KEYS, stripCMKeymap } from "../keys";

// Free the mod+shift+<letter> keys the IDE binds (see IDE_RESERVED_KEYS) so its
// debug shortcuts work while an editor is focused. CodeMirror claims two of
// them today: deleteLine ("Shift-Mod-k") and selectSelectionMatches
// ("Mod-Shift-l"); deleteLine keeps a home on Mod-Shift-Backspace.
const ideDefaultKeymap: KeyBinding[] = [...stripCMKeymap(defaultKeymap, IDE_RESERVED_KEYS), { key: "Mod-Shift-Backspace", run: deleteLine }];
const ideSearchKeymap: KeyBinding[] = stripCMKeymap(searchKeymap, IDE_RESERVED_KEYS);
import { createAssetHeaderPlugin } from "./assetdecorations";
import { createIncludeLinkPlugin } from "./includedecorations";
import { isMobileDevice, ProjectView } from "./baseviews";
import { Shortcut } from "../shortcutbar";
import { createTextTransformFilterEffect, textTransformFilterCompartment } from "./filters";
import { breakpointMarkers, bytes, clock, currentPcMarker, errorMarkers, ErrorInfo, offset, statusMarkers } from "./gutter";
import { currentPc, errorMessages, errorSpans, highlightLines, showValue, tracedLines } from "./visuals";
import { computeHeatLevels } from "./traceheat";
import { buildSourceLineMap, formatSourceComment, isSourceComment, SourceLineReader } from "./disasmsource";

// look ahead this many bytes when finding source lines for a PC
export const PC_LINE_LOOKAHEAD = 64;

// Asset range tracking. Positions are automatically remapped through
// document changes (edits, undo, redo) by CodeMirror's transaction system.
const setAssetRangesEffect = StateEffect.define<{id: string, from: number, to: number}[]>();
const clearAssetRangesEffect = StateEffect.define<void>();

const assetRangesField = StateField.define<Map<string, {from: number, to: number}>>({
  create() { return new Map(); },
  update(ranges, tr) {
    let result = ranges;
    for (let e of tr.effects) {
      if (e.is(clearAssetRangesEffect)) {
        result = new Map();
      } else if (e.is(setAssetRangesEffect)) {
        if (result === ranges) result = new Map(ranges);
        for (let r of e.value) {
          result.set(r.id, { from: r.from, to: r.to });
        }
      }
    }
    if (!tr.changes.empty) {
      const mapped = new Map<string, {from: number, to: number}>();
      for (const [id, r] of result) {
        mapped.set(id, {
          from: tr.changes.mapPos(r.from, -1),
          to: tr.changes.mapPos(r.to, 1)
        });
      }
      return mapped;
    }
    return result;
  }
});

const MAX_ERRORS = 200;

const MODEDEFS = {
  default: { theme: mbo }, // NOTE: Not merged w/ other modes
  '6502': { isAsm: true },
  z80: { isAsm: true },
  jsasm: { isAsm: true },
  gas: { isAsm: true },
  vasm: { isAsm: true },
  inform6: { theme: cobalt },
  dialog: { theme: cobalt, lineWrap: true },
  markdown: { lineWrap: true },
  fastbasic: { noGutters: true },
  basic: { noGutters: true, lineBased: true },
  ecs: { theme: mbo }, // TODO: is actually mixed-mode, as is verilog
}

export var textMapFunctions = {
  input: null as ((text: string) => string) | null
};

export function setUppercaseOnly(uppercaseOnly: boolean) {
  textMapFunctions.input = uppercaseOnly ? (s) => s.toUpperCase() : null;
}

/** Return the current selection text from a CodeMirror view ('' if none). */
function getEditorSelectionText(view: EditorView): string {
  if (!view) return '';
  const range = view.state.selection.main;
  if (range.empty) return '';
  return view.state.sliceDoc(range.from, range.to);
}

export class SourceEditor implements ProjectView {
  // Whether to highlight recently-executed lines from live trace data.
  // Off by default (probing has a runtime cost); toggled via toolbar button.
  static tracingEnabled = false;

  constructor(path: string, mode: string) {
    this.path = path;
    this.mode = mode;
  }
  path: string;
  mode: string;
  editor;
  updateTimer = null;
  indentUnitCompartment = new Compartment();
  isAsm = false;
  dirtylisting = true;
  sourcefile: SourceFile;
  currentDebugLine: SourceLocation;
  refreshDelayMsec = 300;
  probe: ProbeRecorder = null;
  // Cumulative executed-line counts for this tracing session. Only lines
  // executed in the last update are shown, but their color (hot/cold) comes
  // from these totals so it stays stable from tick to tick.
  tracedLineCounts = new Map<number, number>();

  createDiv(parent: HTMLElement) {
    var div = document.createElement('div');
    div.setAttribute("class", "editor");
    parent.appendChild(div);
    var text = current_project.getFile(this.path) as string;
    var asmOverride = text && this.mode == 'verilog' && /__asm\b([\s\S]+?)\b__endasm\b/.test(text);
    this.newEditor(div, text, asmOverride);
    this.editor.dispatch({
      effects: createTextTransformFilterEffect(textMapFunctions),
    });
    this.syncBreakpoints(); // render breakpoints from the shared store
    if (current_project.getToolForFilename(this.path).startsWith("remote:")) {
      this.refreshDelayMsec = 1000; // remote URLs get slower refresh
    }
    return div;
  }

  setVisible(showing: boolean): void {
    if (showing) {
      this.editor.focus(); // so that keyboard works when moving between files
      if (SourceEditor.tracingEnabled) this.startTracing();
    } else {
      this.stopTracing();
    }
  }

  // a few of the CodeMirror bindings available while editing;
  // chips are clickable and run the command on this editor
  getShortcuts(): Shortcut[] {
    if (!this.editor) return [];
    var ed = this.editor;
    var mk = (key: string, label: string, cmd: (v: EditorView) => boolean): Shortcut => ({
      key, label, fn: () => { cmd(ed); ed.focus(); }
    });
    return [
      mk('mod+f', 'Find', openSearchPanel),
      mk('mod+g', 'Find Next', findNext),
      mk('mod+d', 'Next Occurrence', selectNextOccurrence),
      //mk('mod+shift+backspace', 'Delete Line', deleteLine),
      //mk('mod+/', 'Toggle Comment', toggleComment),
      mk('mod+z', 'Undo', undo),
      mk('mod+shift+z', 'Redo', redo),
    ];
  }

  startTracing() {
    if (!this.probe && platform.startProbing) {
      this.probe = platform.startProbing();
      this.probe.singleFrame = false; // accumulate between our polls, we clear it ourselves
      this.probe.clear();
      this.tracedLineCounts.clear();
    }
  }

  stopTracing() {
    if (this.probe) {
      platform.stopProbing();
      this.probe = null;
    }
    this.tracedLineCounts.clear();
    this.editor.dispatch({ effects: tracedLines.effect.of([]) });
  }

  setTracingEnabled(enabled: boolean) {
    SourceEditor.tracingEnabled = enabled;
    if (enabled) this.startTracing();
    else this.stopTracing();
  }

  newEditor(parent: HTMLElement, text: string, isAsmOverride?: boolean) {
    var modedef = MODEDEFS[this.mode] || MODEDEFS.default;
    var isAsm = isAsmOverride || modedef.isAsm;
    var lineWrap = !!modedef.lineWrap;
    var theme = modedef.theme || MODEDEFS.default.theme;
    var lineNums = modedef.useLineNumbers && !isMobileDevice;
    if (qs['embed']) {
      lineNums = false; // no line numbers while embedded
      isAsm = false; // no opcode bytes either
    }
    this.isAsm = isAsm;
    const minimalGutters = modedef.noGutters || isMobileDevice;

    var parser: Extension;
    const registryEntry = parserRegistry[this.mode];
    if (registryEntry) {
      parser = registryEntry.language;
    } else {
      console.warn("Unknown mode: " + this.mode);
      parser = null;
    }
    this.editor = new EditorView({
      parent: parent,
      doc: text,
      extensions: [

        // Non-asm: indent unit detected from the file (placed before settings so it takes precedence over tabSize-based indentUnit)
        this.indentUnitCompartment.of(this.indentUnitFor(text)),
        // Asm: copy previous line's indentation since asm parsers lack proper indent rules
        isAsm ? indentService.of((context, pos) => {
          let lineNum = context.state.doc.lineAt(pos).number;
          if (lineNum >= 0) {
            let prevLine = context.state.doc.line(lineNum);
            if (prevLine.text.trim()) {
              return context.lineIndent(prevLine.from);
            }
          }
          return 0;
        }) : [],

        // Asm files: tab/backspace work on inferred tab stops when
        // "insert spaces when pressing tab" is enabled. Placed before the
        // settings keymap so it takes precedence over indentMore/insertTab.
        ...(isAsm ? [keymap.of(asmSpacesKeymap(() => loadSettings().tabsToSpaces))] : []),
        // Line-numbered BASIC: Enter doesn't auto-indent. Must precede the default keymap.
        modedef.lineBased ? keymap.of(lineBasedEnterKeymap) : [],
        // Keybindings from settings must appear before default keymap.
        ...settingsExtensions(loadSettings()),
        // https://codemirror.net/docs/ref/#commands.defaultKeymap includes
        // https://codemirror.net/docs/ref/#commands.standardKeymap
        keymap.of(ideDefaultKeymap),

        lineNums ? lineNumbers() : [],

        // Undo history.
        history(),
        keymap.of(historyKeymap),

        // Code fold gutter.
        foldGutter(),

        dropCursor(),

        EditorState.allowMultipleSelections.of(true),
        drawSelection(),

        indentOnInput(),
        bracketMatching(),

        // Rectangular selection and crosshair cursor.
        rectangularSelection(),
        crosshairCursor(),

        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),

        search({ top: true }),
        keymap.of(ideSearchKeymap),

        // lintGutter(),
        // autocompletion(),

        parser || [],
        theme,
        editorTheme,
        lineWrap ? EditorView.lineWrapping : [],

        currentPc.field,

        !minimalGutters ? [
          offset.field,
          offset.gutter,
        ] : [],

        isAsm && !minimalGutters ? [
          bytes.field,
          bytes.gutter,

          clock.field,
          clock.gutter,
        ] : [],

        breakpointMarkers.field,
        statusMarkers.gutter,

        EditorView.updateListener.of(update => {
          for (let effect of update.transactions.flatMap(tr => tr.effects)) {
            if (effect.is(breakpointMarkers.requestToggle)) {
              // the store notifies listeners, which syncs markers and re-arms
              bpStore.toggleSourceLine(this.path, effect.value);
            }
            if (effect.is(currentPcMarker.runToLine)) {
              const lineNum = effect.value;
              if (this.sourcefile && this.sourcefile.line2offset) {
                const pc = this.sourcefile.line2offset.get(lineNum);
                if (pc >= 0) {
                  runToPC([pc]);
                }
              }
            }
          }
        }),

        errorMarkers.field,

        errorMessages.field,

        errorSpans.field,

        currentPcMarker.field,
        currentPcMarker.gutter,

        highlightLines.field,

        tracedLines.field,

        assetRangesField,

        createAssetHeaderPlugin((lineNumber: number) => {
          window.location.hash = 'asseteditor/' + encodeURIComponent(this.path) + '/' + lineNumber;
        }),

        // badges on include lines (#include, .include, ...) -> read-only view
        qs['embed'] ? [] : createIncludeLinkPlugin(
          () => {
            var tool = current_project && current_project.getToolForFilename(this.path);
            var platform_id = current_project && current_project.platform_id;
            return [...getIncludePatterns(tool, platform_id),
                    ...getLinkPatterns(tool, platform_id),
                    ...getSystemIncludePatterns(tool)];
          },
          (filename: string, system: boolean) => {
            // quoted includes: project files (presets/local) link to their own
            // editor window; fall through to the read-only viewer otherwise
            if (!system) {
              var path = resolveIncludeFile(filename);
              if (path) {
                window.location.hash = '#' + encodeURIComponent(path);
                return;
              }
            }
            // system headers (<foo.h>) and unresolved files: toolchain
            // filesystem via the read-only viewer
            openHeaderFile(filename);
          },
          // one directive can offer several candidates (`mod foo;` -> foo.rs
          // or foo/mod.rs); link to whichever file exists
          (filename: string) => resolveIncludeFile(filename) != null,
        ),

        textTransformFilterCompartment.of([]),

        // update file in project (and recompile) when edits made
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            this.editorChanged();
          }
        }),

        // inspect symbol when it's highlighted (double-click)
        showValue.field,
        EditorView.updateListener.of(update => {
          if (update.selectionSet) {
            this.inspectUnderCursor(update);
          }
        }),
      ],
    });
    // TODO: unregister when editor is destroyed
    registerEditor(this.editor);
  }

  editorChanged() {
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      current_project.updateFile(this.path, this.editor.state.doc.toString());
    }, this.refreshDelayMsec);
  }

  flushChanges() {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
      current_project.updateFile(this.path, this.editor.state.doc.toString());
    }
  }

  inspectUnderCursor(update: ViewUpdate) {
    // TODO: handle multi-select
    const range = update.state.selection.main;
    const selectedText = update.state.sliceDoc(range.from, range.to).trim();

    var result;
    if (platform.inspect) {
      result = platform.inspect(selectedText);
    }

    if (!range.empty && result && result.length < 80) {
      update.view.dispatch({
        effects: showValue.effect.of({ range: range, val: result })
      });
    } else {
      update.view.dispatch({
        effects: showValue.effect.of(null)
      });
    }
  }

  indentUnitFor(text: string): Extension {
    return this.isAsm ? [] : indentUnit.of(detectIndentUnit(text));
  }

  setText(text: string) {
    var oldtext = this.editor.state.doc.toString();
    if (oldtext != text) {
      this.editor.dispatch({
        changes: { from: 0, to: this.editor.state.doc.length, insert: text },
        annotations: isolateHistory.of("full"),
        effects: this.indentUnitCompartment.reconfigure(this.indentUnitFor(text)),
      });
    }
  }

  replaceTextRange(from: number, to: number, text: string) {
    const lineStart = this.editor.state.doc.lineAt(from).from;
    this.editor.dispatch({
      changes: { from, to, insert: text },
      annotations: isolateHistory.of("full"),
      selection: { anchor: from + text.length, head: from },
      effects: [
        EditorView.scrollIntoView(lineStart, { y: "start", yMargin: 100/*pixels*/ }),
      ]
    });
  }

  setAssetRange(id: string, from: number, to: number) {
    this.editor.dispatch({
      effects: setAssetRangesEffect.of([{ id, from, to }])
    });
  }

  getAssetText(id: string): string | null {
    var range = this.editor.state.field(assetRangesField).get(id);
    if (!range) return null;
    return this.editor.state.doc.sliceString(range.from, range.to);
  }

  replaceAssetText(id: string, text: string) {
    var range = this.editor.state.field(assetRangesField).get(id);
    if (!range) return;
    this.replaceTextRange(range.from, range.to, text);
  }

  clearAssetRanges() {
    this.editor.dispatch({
      effects: clearAssetRangesEffect.of(undefined)
    });
  }

  insertLinesBefore(text: string) {
    const pos = this.editor.state.selection.main.from;
    const lineNum = this.editor.state.doc.lineAt(pos).number;
    const lineFrom = this.editor.state.doc.lineAt(pos).from;
    const insertedLineCount = text.split("\n").length - 1;
    this.editor.dispatch({
      changes: { from: lineFrom, insert: text },
    });
    this.highlightLines(lineNum - 1, lineNum + insertedLineCount - 2);
  }

  highlightLines(start: number, end: number) {
    const startLine = this.editor.state.doc.line(start + 1);
    this.editor.dispatch({
      effects: [
        highlightLines.effect.of({ start: start + 1, end: end + 1 }),
        EditorView.scrollIntoView(startLine.from, { y: "start", yMargin: 100/*pixels*/ }),
      ]
    });
  }

  navigateToLine(line: number) {
    if (line < 1 || line > this.editor.state.doc.lines) return;
    const targetLine = this.editor.state.doc.line(line);
    this.editor.dispatch({
      selection: { anchor: targetLine.from },
      effects: [
        highlightLines.effect.of({ start: line, end: line }),
        EditorView.scrollIntoView(targetLine.from, { y: "center" }),
      ],
    });
    this.editor.focus();
  }

  getValue(): string {
    return this.editor.state.doc.toString();
  }

  getSelectionText(): string {
    return getEditorSelectionText(this.editor);
  }

  getPath(): string { return this.path; }

  markErrors(errors: WorkerError[]) {
    // TODO: move cursor to error line if offscreen?
    this.clearErrors();
    errors = errors.slice(0, MAX_ERRORS);
    const newErrors = new Map<number, ErrorInfo>();
    const spans: { line: number, start: number, end: number, warning?: boolean }[] = [];
    for (var info of errors) {
      // only mark errors with this filename, or without any filename
      if (!info.path || this.path.endsWith(info.path)) {
        var numLines = this.editor.state.doc.lines;
        var line = info.line;
        if (isNaN(line) || line < 1 || line > numLines) line = 1;
        // an error on the line wins over a warning
        if (!(info.severity === 'warning' && newErrors.has(line))) {
          newErrors.set(line, { msg: info.msg, warning: info.severity === 'warning' });
        }
        // collect column-level spans
        if (info.start != null && info.end != null && info.end > info.start) {
          spans.push({ line, start: info.start, end: info.end, warning: info.severity === 'warning' });
        }
      }
    }
    this.editor.dispatch({
      effects: [
        errorMarkers.set.of(newErrors),
        errorSpans.effect.of(spans.length > 0 ? spans : null),
      ],
    });
  }

  clearErrors() {
    this.dirtylisting = true;
    this.editor.dispatch({
      effects: [
        errorMarkers.set.of(new Map()),
        errorMarkers.showMessage.of(null),
        errorSpans.effect.of(null),
      ],
    });
  }

  getSourceFile(): SourceFile { return this.sourcefile; }

  updateListing() {
    // update editor annotations
    // TODO: recreate editor if gutter-bytes is used (verilog)
    this.clearErrors();
    var lstlines = this.sourcefile.lines || [];

    const newOffsets = new Map();
    const newBytes = new Map();
    const newClocks = new Map();

    for (var info of lstlines) {
      //if (info.path && info.path != this.path) continue;
      if (info.offset >= 0) {
        newOffsets.set(info.line, hex(info.offset & 0xffff, 4));
      }
      if (info.insns) {
        var insnstr = info.insns.length > 9 ? ("...") : info.insns;
        newBytes.set(info.line, insnstr);
        if (info.iscode) {
          // TODO: labels trick this part?
          if (info.cycles) {
            newClocks.set(info.line, info.cycles + "");
          } else if (platform.getOpcodeMetadata) {
            var opcode = parseInt(info.insns.split(" ")[0], 16);
            var meta = platform.getOpcodeMetadata(opcode, info.offset);
            if (meta && meta.minCycles) {
              var clockstr = meta.minCycles + "";
              newClocks.set(info.line, clockstr);
            }
          }
        }
      }
    }
    this.editor.dispatch({
      effects: [
        offset.set.of(newOffsets),
        bytes.set.of(newBytes),
        clock.set.of(newClocks),
      ],
    });
  }

  setTimingResult(result: CodeAnalyzer): void {
    if (this.sourcefile == null) return;
    var newBytes = new Map<number, string>();
    for (const [line, pc] of this.sourcefile.line2offset) {
      let clocks = result.pc2clockrange[pc];
      var minclocks = clocks && clocks.minclocks;
      var maxclocks = clocks && clocks.maxclocks;
      if (minclocks >= 0 && maxclocks >= 0) {
        var s;
        if (maxclocks == minclocks)
          s = minclocks + "";
        else
          s = minclocks + "-" + maxclocks;
        if (maxclocks == result.MAX_CLOCKS)
          s += "+";
        newBytes.set(line, s);
      }
    }
    this.editor.dispatch({
      effects: [
        bytes.set.of(newBytes),
      ],
    });
  }

  setCurrentLine(line: SourceLocation, moveCursor: boolean) {
    var addCurrentMarker = (line: SourceLocation) => {
      this.editor.dispatch({
        effects: [
          currentPcMarker.set.of(line.line),
          // Follow the execution point when stepping/hitting breakpoints. A
          // passive halt (e.g. the program ends while the user is typing) only
          // shows the gutter arrow, so it doesn't repaint/highlight the line
          // out from under the user's cursor.
          currentPc.effect.of(moveCursor ? line.line : null),
          ...(moveCursor ? [EditorView.scrollIntoView(this.editor.state.doc.line(line.line).from, { y: "center" })] : []),
        ]
      });
    }

    this.clearCurrentLine(moveCursor);
    if (line) {
      // Validate line number is within document range (TODO: open disassembler)
      if (line.line < 1 || line.line > this.editor.state.doc.lines) {
        return;
      }
      addCurrentMarker(line);
      if (moveCursor) {
        const targetLine = this.editor.state.doc.line(line.line);
        const pos = targetLine.from + (line.start || 0);
        this.editor.dispatch({
          selection: { anchor: pos, head: pos },
          effects: EditorView.scrollIntoView(pos, { y: "center" })
        });
      }
      this.currentDebugLine = line;
    }
  }

  clearCurrentLine(moveCursor: boolean) {
    if (this.currentDebugLine) {
      if (moveCursor) {
        const pos = this.editor.state.selection.main.head;
        this.editor.dispatch({ selection: { anchor: pos, head: pos } });
      }
      this.currentDebugLine = null;
    }
    this.editor.dispatch({
      effects: [
        currentPcMarker.set.of(null),
        currentPc.effect.of(null),
      ]
    });
  }

  getActiveLine(): SourceLocation {
    if (this.sourcefile) {
      var cpustate = lastDebugState && lastDebugState.c;
      if (!cpustate && platform.getCPUState && !platform.isRunning())
        cpustate = platform.getCPUState();
      if (cpustate) {
        var EPC = (cpustate && (cpustate.EPC || cpustate.PC));
        var res = this.sourcefile.findLineForOffset(EPC, PC_LINE_LOOKAHEAD);
        return res;
      }
    }
  }

  refreshDebugState(moveCursor: boolean) {
    var line = this.getActiveLine();
    if (!moveCursor && (line === this.currentDebugLine || (!line && !this.currentDebugLine))) {
      return;
    }

    this.setCurrentLine(line, moveCursor);
  }

  refreshListing() {
    // lookup corresponding sourcefile for this file, using listing
    var lst = current_project.getListingForFile(this.path);
    if (lst && lst.sourcefile && lst.sourcefile !== this.sourcefile) {
      this.sourcefile = lst.sourcefile;
      this.dirtylisting = true;
    }
    if (!this.sourcefile || !this.dirtylisting) return;
    this.updateListing();
    this.dirtylisting = false;
  }

  refresh(moveCursor: boolean) {
    this.refreshListing();
    this.refreshDebugState(moveCursor);
  }

  tick() {
    this.refreshDebugState(false);
    this.updateTracedLines();
  }

  updateTracedLines() {
    const p = this.probe;
    if (!p || !p.idx || !this.sourcefile) return;
    // Accumulate per-line counts since tracing started, and remember which
    // lines ran in this update (those are the only ones we'll highlight).
    const activeLines = new Set<number>();
    for (let i = 0; i < p.idx; i++) {
      const word = p.buf[i];
      if ((word & 0xff000000) === ProbeFlags.EXECUTE) {
        const loc = this.sourcefile.findLineForOffset(word & 0xffff, PC_LINE_LOOKAHEAD);
        if (loc) {
          this.tracedLineCounts.set(loc.line, (this.tracedLineCounts.get(loc.line) || 0) + 1);
          activeLines.add(loc.line);
        }
      }
    }
    p.clear();
    this.editor.dispatch({
      effects: tracedLines.effect.of(computeHeatLevels(this.tracedLineCounts, activeLines)),
    });
  }

  getLine(line: number) {
    return this.editor.state.doc.line(line).text;
  }

  getCurrentLine(): number {
    const pos = this.editor.state.selection.main.head;
    return this.editor.state.doc.lineAt(pos).number;
  }

  getCursorPC(): number {
    var line = this.getCurrentLine();
    while (this.sourcefile && line >= 0) {
      var pc = this.sourcefile.line2offset.get(line);
      if (pc >= 0) return pc;
      line--;
    }
    return -1;
  }

  undoStep() {
    undo(this.editor);
  }

  redoStep() {
    redo(this.editor);
  }

  // push the store's breakpoints for this file into the gutter markers
  syncBreakpoints() {
    const markers = bpStore.getSourceBreakpointsForFile(this.path)
      .map(bp => ({ line: bp.line, enabled: bp.enabled }));
    this.editor.dispatch({ effects: breakpointMarkers.setAll.of(markers) });
  }
}

///

const disasmWindow = 1024; // disassemble this many bytes around cursor

// Assembly sources are already what the disassembly shows; interleaving them
// would repeat every instruction. Compiled and interpreted sources (C, BASIC,
// Rust, ...) are the ones whose lines are useful next to the disassembly.
function isAssemblerSource(path: string): boolean {
  const meta = getToolMeta(current_project.getToolForFilename(path));
  return meta != null && meta.kind === 'assembler';
}

// Give the source lines interleaved into the disassembly their own color.
// They are the only lines that start with "; file.c:12:", so a listing's or
// instruction's comments on the same line stay the normal color.
const disasmSourceDecoration = Decoration.line({ attributes: { class: "cm-disasm-source" } });

function highlightDisasmSourceLines() {
  function build(view: EditorView): DecorationSet {
    const ranges: any[] = [];
    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos <= to) {
        const line = view.state.doc.lineAt(pos);
        if (isSourceComment(line.text)) ranges.push(disasmSourceDecoration.range(line.from));
        pos = line.to + 1;
      }
    }
    return Decoration.set(ranges, true);
  }
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
    }
  }, {
    decorations: v => v.decorations,
  });
}

// Read source lines for the disassembly view. Source paths from a listing are
// relative to the build (e.g. "main.c"), so resolve them against the project
// files first. Caches both path lookups and file contents: one disassembly
// refresh asks for the same file many times.
function makeSourceLineReader(): SourceLineReader {
  const pathCache = new Map<string, string | null>();
  const textCache = new Map<string, string[] | null>();
  const resolvePath = (path: string): string | null => {
    if (pathCache.has(path)) return pathCache.get(path);
    const candidates = [
      path,
      current_project.filename2path && current_project.filename2path[path],
      current_project.stripLocalPath(path),
    ];
    let found: string | null = null;
    for (const candidate of candidates) {
      if (candidate && typeof current_project.getFile(candidate) === 'string') {
        found = candidate;
        break;
      }
    }
    if (!found) {
      // the compiler may name the file without its folder (e.g. "main.c");
      // fall back to a project file with the same name
      const want = getFilenameForPath(path);
      current_project.iterateFiles((fn, data) => {
        if (found || typeof data !== 'string') return;
        if (getFilenameForPath(fn) === want) found = fn;
      });
    }
    pathCache.set(path, found);
    return found;
  };
  return (path: string, line: number): string | null => {
    const resolved = resolvePath(path);
    if (!resolved) return null;
    let lines = textCache.get(resolved);
    if (lines === undefined) {
      const text = current_project.getFile(resolved);
      lines = typeof text === 'string' ? text.split(/\r?\n/) : null;
      textCache.set(resolved, lines);
    }
    return lines && line >= 1 && line <= lines.length ? lines[line - 1] : null;
  };
}

export class DisassemblerView implements ProjectView {
  disasmview: EditorView;

  getSelectionText(): string {
    return getEditorSelectionText(this.disasmview);
  }

  createDiv(parent: HTMLElement) {
    var div = document.createElement('div');
    div.setAttribute("class", "editor");
    parent.appendChild(div);
    this.newEditor(div);
    return div;
  }

  newEditor(parent: HTMLElement) {
    this.disasmview = new EditorView({
      parent: parent,
      extensions: [
        rectangularSelection(),
        crosshairCursor(),
        EditorState.allowMultipleSelections.of(true),
        drawSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        disassemblyTheme,
        cobalt,
        highlightDisasmSourceLines(),
        currentPc.field,
        EditorState.tabSize.of(8),
        EditorState.readOnly.of(true),
      ],
      // mode: 'z80', // TODO: pick correct one
    });
  }

  // TODO: too many globals
  refresh(moveCursor: boolean, centerAddr?: number) {
    let state = lastDebugState || platform.saveState(); // TODO?
    let pc = centerAddr !== undefined ? centerAddr : (state.c ? state.c.PC : 0);
    let curline = 0;
    let selline = 0;
    let lastSource = '';
    let addr2symbol = (platform.debugSymbols && platform.debugSymbols.addr2symbol) || {};
    const sourcelines = current_project
      ? buildSourceLineMap(current_project.getListings(), makeSourceLineReader(), path => !isAssemblerSource(path))
      : null;
    // TODO: not perfect disassembler
    let disassemble = (start, len) => {
      // TODO: use pc2visits
      let s = "";
      let ofs = 0;
      while (ofs < len) {
        let a = (start + ofs) | 0;
        let disasm = platform.disassemble(a, platform.readAddress.bind(platform));
        if (sourcelines) {
          const srcline = sourcelines.get(a);
          if (srcline) {
            const sourcekey = srcline.path + '\0' + srcline.line;
            if (sourcekey !== lastSource) {
              s += formatSourceComment(srcline) + "\n";
              curline++;
              lastSource = sourcekey;
            }
          }
        }
        let bytes = "";
        let comment = "";
        for (let i = 0; i < disasm.nbytes; i++)
          bytes += hex(platform.readAddress(a + i));
        while (bytes.length < 14)
          bytes += ' ';
        let dstr = disasm.line;
        if (addr2symbol && disasm.isaddr) { // TODO: move out
          dstr = dstr.replace(/([^#])[$]([0-9A-F]+)/, (substr: string, ...args: any[]): string => {
            let addr = parseInt(args[1], 16);
            let sym = addr2symbol[addr];
            if (sym) return (args[0] + sym);
            sym = addr2symbol[addr - 1];
            if (sym) return (args[0] + sym + "+1");
            return substr;
          });
        }
        if (addr2symbol) {
          let sym = addr2symbol[a];
          if (sym) {
            comment = "; " + sym;
          }
        }
        let dline = hex(a, 4) + "\t" + rpad(bytes, 14) + "\t" + rpad(dstr, 30) + comment + "\n";
        s += dline;
        if (a == pc) selline = curline;
        curline++;
        ofs += disasm.nbytes || 1;
      }
      return s;
    }
    var startpc = pc < 0 ? pc - disasmWindow : Math.max(0, pc - disasmWindow); // for 32-bit PCs w/ hi bit set
    let text = disassemble(startpc, pc - startpc) + disassemble(pc, disasmWindow);
    this.disasmview.dispatch({
      changes: { from: 0, to: this.disasmview.state.doc.length, insert: text }
    })
    if (moveCursor) {
      const line = this.disasmview.state.doc.line(selline + 1);
      this.disasmview.dispatch({
        selection: { anchor: line.from, head: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      });
    }
  }

  // jump to an address (or symbol), via the Go To Address prompt
  goToAddress(addr: number) {
    addr |= 0;
    if (!this.findAndSelectAddress(addr)) {
      // re-center the disassembly window on this address
      this.refresh(false, addr);
      this.findAndSelectAddress(addr);
    }
    this.disasmview.focus();
  }

  private findAndSelectAddress(addr: number): boolean {
    const h = hex(addr, 4); // every line starts with the address + tab
    const doc = this.disasmview.state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (line.text.startsWith(h + "\t")) {
        // select the address so the line stays highlighted; scrollIntoView
        // centers it in the viewport
        this.disasmview.dispatch({
          selection: { anchor: line.from, head: line.from + h.length },
          effects: EditorView.scrollIntoView(line.from, { y: "center" }),
        });
        return true;
      }
    }
    return false;
  }

  getCursorPC(): number {
    const pos = this.disasmview.state.selection.main.head;
    const lineNum = this.disasmview.state.doc.lineAt(pos).number;
    if (lineNum >= 0) {
      const lineText = this.disasmview.state.doc.line(lineNum).text;
      const toks = lineText.trim().split(/\s+/);
      if (toks && toks.length >= 1) {
        const pc = parseInt(toks[0], 16);
        console.log("getCursorPC", pc);
        if (pc >= 0) return pc;
      }
    }
    return -1;
  }
}

///

export class ListingView extends DisassemblerView implements ProjectView {
  assemblyfile: SourceFile;
  path: string;

  constructor(lstfn: string) {
    super();
    this.path = lstfn;
  }

  refreshListing() {
    // lookup corresponding assemblyfile for this file, using listing
    var lst = current_project.getListingForFile(this.path);
    // TODO?
    this.assemblyfile = lst && (lst.assemblyfile || lst.sourcefile);
  }

  refresh(moveCursor: boolean) {
    this.refreshListing();
    // load listing text into editor
    if (!this.assemblyfile) return;
    var asmtext = this.assemblyfile.text;

    // TODO: sometimes it picks one without a text file
    this.disasmview.dispatch({
      changes: { from: 0, to: this.disasmview.state.doc.length, insert: asmtext }
    })
    // go to PC
    if (!platform.saveState) return;
    var state = lastDebugState || platform.saveState();
    var pc = state.c ? (state.c.EPC || state.c.PC) : 0;
    if (pc >= 0 && this.assemblyfile) {
      var res = this.assemblyfile.findLineForOffset(pc, PC_LINE_LOOKAHEAD);
      if (res) {
        // set cursor while debugging
        if (moveCursor) {
          const line = this.disasmview.state.doc.line(res.line);
          this.disasmview.dispatch({
            selection: { anchor: line.from, head: line.from },
            effects: EditorView.scrollIntoView(line.from, { y: "center" }),
          });
        }
      }
    }
  }

  // jump to an arbitrary address in this listing. Overrides the
  // DisassemblerView version, which looks for lines starting with a plain
  // "XXXX\t" hex address -- that's the synthetic disassembly text format,
  // not this raw compiler-generated listing, so it never matches here.
  goToAddress(addr: number) {
    this.refreshListing();
    const res = this.assemblyfile && this.assemblyfile.findLineForOffset(addr, PC_LINE_LOOKAHEAD);
    if (res) {
      const line = this.disasmview.state.doc.line(res.line);
      this.disasmview.dispatch({
        selection: { anchor: line.from, head: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      });
    }
    this.disasmview.focus();
  }

}

///

// Resolve an include filename (e.g. from `#include "foo.h"`) against the files
// loaded in the current project. Tries the bare filename, then relative to the
// main file's folder (same logic as CodeProject.pushAllFiles).
export function resolveIncludeFile(fn: string): string | null {
  let candidates = [fn];
  try {
    var dir = getFolderForPath(current_project.mainPath);
    if (dir.length > 0 && dir != 'local') candidates.push(dir + '/' + fn);
  } catch (e) {
    // no main path yet; bare filename only
  }
  for (var c of candidates) {
    var data = current_project && current_project.getFile(c);
    if (typeof data === 'string') return c;
  }
  return null;
}

// Pick a syntax highlighting language for a read-only file view based on its
// filename. Uses whichever registered tool claims the file's extension
// (e.g. .inc -> ca65 -> 6502 asm, .h -> cc65 -> C). Returns null if no
// tool/language matches.
export function getLanguageForFilename(fn: string): Extension | null {
  for (var meta of getToolMetaForFilename(fn)) {
    if (!meta.editorStyle) continue;
    var lang = getLanguageSupportForStyle(meta.editorStyle);
    if (lang) return lang;
  }
  return null;
}

// Look up an include file the build gets from outside the project, via the
// worker: first the platform's library (src/worker/lib, e.g. neslib.h or
// gb/gb.h), then the toolchain's preload filesystem (e.g. /include/nes.h
// inside the cc65 package). Results are cached per source+filename.
const sharedFileCache = new Map<string, Promise<string | null>>();

async function queryWorkerText(msg: WorkerMessage): Promise<string | null> {
  var result = await current_project.queryWorker(msg);
  var output = result && (result as any).output;
  return output instanceof Uint8Array && output.length > 0 ? new TextDecoder().decode(output) : null;
}

function lookupLibraryFileText(fn: string): Promise<string | null> {
  const platform = current_project.platform_id;
  const key = 'lib:' + platform + ':' + fn;
  if (!sharedFileCache.has(key)) {
    sharedFileCache.set(key, queryWorkerText({ platform, readlib: fn, updates: [], buildsteps: [] }));
  }
  return sharedFileCache.get(key);
}

function lookupToolchainFileText(fn: string): Promise<string | null> {
  const tool = current_project.getToolForFilename(current_project.mainPath);
  const fsName = getSharedFileSystemName(tool, current_project.platform_id);
  const dirs = getIncludeDirs(tool, current_project.platform_id);
  if (!fsName || !dirs.length) return Promise.resolve(null);
  const key = fsName + ':' + fn;
  if (!sharedFileCache.has(key)) {
    sharedFileCache.set(key, (async () => {
      // try the include under each known dir (e.g. /headers/vcs.h for "vcs.h"),
      // then the filename as-is (some includes already carry the dir,
      // e.g. "headers/vcs.h")
      var candidates = [...dirs.map(dir => dir + '/' + fn), fn];
      for (var path of candidates) {
        var text = await queryWorkerText({ preload_fs: fsName, readshared: path, updates: [], buildsteps: [] });
        if (text != null) return text;
      }
      return null;
    })());
  }
  return sharedFileCache.get(key);
}

export async function lookupSharedFileText(fn: string): Promise<string | null> {
  return (await lookupLibraryFileText(fn)) ?? lookupToolchainFileText(fn);
}

// Read-only viewer for include files from outside the project (the platform
// library in src/worker/lib, or the tool's preload filesystem), opened by
// clicking the badge next to an #include line.
// Project files are linked to their own editor windows instead.
// Each opened header gets its own window, id '#headerview/<filename>'.
export class HeaderView implements ProjectView {
  view: EditorView;

  getSelectionText(): string {
    return getEditorSelectionText(this.view);
  }
  currentPath: string;
  languageCompartment = new Compartment();

  constructor(public fn?: string) {
  }

  createDiv(parent: HTMLElement) {
    var div = document.createElement('div');
    div.setAttribute("class", "editor");
    parent.appendChild(div);
    // language based on filename when known; reconfigured in setHeaderText
    var lang = getLanguageForFilename(this.fn || this.currentPath || '') || getDefaultLanguageParser();
    this.view = new EditorView({
      parent: div,
      extensions: [
        rectangularSelection(),
        crosshairCursor(),
        EditorState.allowMultipleSelections.of(true),
        drawSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        keymap.of(ideSearchKeymap),
        this.languageCompartment.of(lang),
        mbo,
        editorTheme,
        EditorState.readOnly.of(true),
      ],
    });
    this.refresh(false);
    return div;
  }

  setVisible(showing: boolean) {
    if (showing) this.refresh(false);
  }

  setHeaderText(text: string) {
    // (re)configure highlighting now that we know the actual path
    var lang = getLanguageForFilename(this.currentPath || this.fn || '') || getDefaultLanguageParser();
    this.view.dispatch({
      effects: this.languageCompartment.reconfigure(lang),
      changes: { from: 0, to: this.view.state.doc.length, insert: text }
    });
  }

  refresh(moveCursor: boolean) {
    var fn = this.fn;
    if (!fn) {
      // direct hash navigation: get filename from #headerview/<filename>
      var hash = window.location.hash;
      if (!hash || !hash.startsWith('#headerview/')) return;
      fn = this.fn = decodeURIComponent(hash.substring('#headerview/'.length));
    }
    this.loadIncludeFile(fn);
  }

  async loadIncludeFile(fn: string) {
    this.requestedFn = fn;
    // 1) project files (local storage / presets)
    var path = resolveIncludeFile(fn);
    if (path) {
      this.currentPath = path;
      this.setHeaderText(current_project.getFile(path) as string);
      return;
    }
    // 2) platform library, then toolchain preload filesystem (via worker)
    var text = await lookupSharedFileText(fn);
    if (this.requestedFn !== fn) return; // a newer request superseded us
    if (text != null) {
      this.currentPath = fn;
      this.setHeaderText(text);
      return;
    }
    // not found
    this.currentPath = fn;
    this.setHeaderText('// ' + fn + ' was not found.\n'
      + '// Project include files are loaded during a build -- try building first.\n'
      + '// Library and toolchain headers are only available when the platform or tool bundles them.');
  }

  /** Jump to a line in the header (after content loads). */
  navigateToLine(line: number) {
    if (!this.view || line < 1) return;
    if (line <= this.view.state.doc.lines) {
      const target = this.view.state.doc.line(line);
      this.view.dispatch({
        selection: { anchor: target.from },
        effects: [EditorView.scrollIntoView(target.from, { y: "center" })],
      });
      this.view.focus();
    }
  }
  // track the most recent request so stale async lookups don't overwrite it
  private requestedFn: string;
}
