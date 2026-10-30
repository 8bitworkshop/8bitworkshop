
import { CodeAnalyzer } from "./analysis";
import { disassemble6502 } from "./cpu/disasm6502";
import { disassembleZ80 } from "./cpu/disasmz80";
import { Z80 } from "./cpu/ZilogZ80";
import { AnimationTimer, ControllerPoller, EmuHalt, RasterVideo, drawCrosshair, dumpRAM } from "./emu";
import { byteToASCII, hex, invertMap, printFlags } from "./util";
import { FileData, Segment } from "./workertypes";
import { getToolForFilename_6502, getToolForFilename_6809, getToolForFilename_arm32, getToolForFilename_z80 } from "./toolselect";

// moved to toolselect.ts; re-exported for the platform modules
export { getToolForFilename_6502, getToolForFilename_6809, getToolForFilename_arm32, getToolForFilename_z80 };

import { SampledAudio } from "./audio";
import { CPU6809 } from "./cpu/6809";
import { _MOS6502 } from "./cpu/MOS6502";
import { AcceptsBIOS, AcceptsJoyInput, AcceptsKeyInput, AcceptsPaddleInput, AcceptsROM, Bus, FrameBased, HasCPU, HasSerialIO, Probeable, RasterFrameBased, Resettable, SampledAudioSource, SavesInputState, SavesState, SerialIOInterface, VideoSource } from "./devices";
import { ProbeRecorder } from "./probe";
import { BaseWASMMachine } from "./wasmplatform";
import { formatSourceVariableLine, liveSourceVariables, readSourceByte, sourceVariablesOf, sourceVariableTree } from "./sourcevars";

///

export interface OpcodeMetadata {
  minCycles: number;
  maxCycles: number;
  insnlength: number;
  opcode: number;
}

export interface CpuState {
  PC: number;
  EPC?: number; // effective PC (for bankswitching)
  o?: number;/*opcode*/
  SP?: number
  /*
  A:number, X:number, Y:number, SP:number, R:boolean,
  N,V,D,Z,C:boolean*/
};
export interface EmuState {
  c?: CpuState,	// CPU state
  b?: Uint8Array | number[], 	// RAM (TODO: not for vcs, support Uint8Array)
  ram?: Uint8Array,
  o?: {},				// verilog
};
export interface EmuControlsState {
}
export type DisasmLine = {
  line: string,
  nbytes: number,
  isaddr: boolean,
  iscall?: boolean	// true if instruction is a subroutine call
};

export type SymbolMap = { [ident: string]: number };
export type AddrSymbolMap = { [address: number]: string };

export class DebugSymbols {
  symbolmap: SymbolMap;	// symbol -> address
  addr2symbol: AddrSymbolMap;	// address -> symbol
  debuginfo: {}; // extra platform-specific debug info
  symbolsizes?: SymbolMap; // symbol -> size in bytes, if known
  symbolAddrs: number[]; // unique symbol addresses, sorted (function starts)

  constructor(symbolmap: SymbolMap, debuginfo: {}, symbolsizes?: SymbolMap) {
    this.symbolmap = symbolmap;
    this.debuginfo = debuginfo;
    this.symbolsizes = symbolsizes;
    this.addr2symbol = invertMap(symbolmap);
    this.symbolAddrs = [...new Set(Object.values(symbolmap || {}))].sort((a, b) => a - b);
    //// TODO: shouldn't be necc.
    if (!this.addr2symbol[0x0]) this.addr2symbol[0x0] = '$00'; // needed for ...
    this.addr2symbol[0x10000] = '__END__'; // ... dump memory to work
  }
}

type MemoryMapType = "main" | "vram";
type MemoryMap = { [type: string]: Segment[] };

export function isDebuggable(arg: any): arg is Debuggable {
  return arg && typeof arg.getDebugCategories === 'function';
}

export interface Debuggable {
  getDebugCategories?(): string[];
  getDebugInfo?(category: string, state: EmuState): string;
}

export interface Platform {
  start(): void | Promise<void>;
  reset(): void;
  isRunning(): boolean;
  getToolForFilename(s: string): string;
  getDefaultExtensions(): string[];
  getPresets?(): Preset[];
  pause(): void;
  resume(): void;
  loadROM(title: string, rom: any, origin?: number); // TODO: Uint8Array
  loadBIOS?(title: string, rom: Uint8Array);
  getROMExtension?(rom: FileData): string;

  loadState?(state: EmuState): void;
  saveState?(): EmuState;
  loadControlsState?(state: EmuControlsState): void;
  saveControlsState?(): EmuControlsState;

  inspect?(ident: string): string;
  disassemble?(addr: number, readfn: (addr: number) => number): DisasmLine;
  readAddress?(addr: number): number;
  readVRAMAddress?(addr: number): number;

  setFrameRate?(fps: number): void;
  getFrameRate?(): number;

  setupDebug?(callback: BreakpointCallback): void;
  clearDebug?(): void;
  step?(): void;
  runToVsync?(): void;
  runToPC?(pc: number[]): void;
  // like runToPC(), but each address may carry its own extra condition
  // (null = break unconditionally); handles debug-clock bookkeeping so
  // callers don't have to reach into internal fields to arm a runEval()
  runEvalAtPC?(targets: Map<number, DebugEvalCondition | null>): void;
  runUntilReturn?(): void;
  stepBack?(): void;
  runEval?(evalfunc: DebugEvalCondition): void;
  runToFrameClock?(clock: number): void;
  stepOver?(): void;
  hasCustomStepOver?(): boolean; // true if stepOver() is not the generic instruction-level implementation
  restartAtPC?(pc: number): boolean;

  getOpcodeMetadata?(opcode: number, offset: number): OpcodeMetadata; //TODO
  getSP?(): number;
  getPC?(): number;
  getOriginPC?(): number;
  /** Stop a program that has sat on a trap stub's spin for several frames. */
  checkTrapSpin?(): void;
  newCodeAnalyzer?(): CodeAnalyzer;

  getPlatformName?(): string;
  getMemoryMap?(): MemoryMap;

  setRecorder?(recorder: EmuRecorder): void;
  advance?(novideo?: boolean): number;
  advanceFrameClock?(trap: DebugCondition, step: number): number;
  showHelp?(): string;
  resize?(): void;

  getRasterScanline?(): number;
  getRasterLineClock?(): number;
  setBreakpoint?(id: string, cond: DebugCondition);
  clearBreakpoint?(id: string);
  hasBreakpoint?(id: string): boolean;
  getCPUState?(): CpuState;

  debugSymbols?: DebugSymbols;
  getDebugTree?(): {};
  /** HDL platforms: the design's signals as a tree of values, nested by module (see debugtree.ts) */
  getSignals?(): {};
  /** can the program read paddles (or a mouse)? A host only sends them if so. */
  acceptsPaddles?(): boolean;
  /** x and y in 0..255, and the buttons held */
  setPaddles?(x: number, y: number, buttons: boolean[]): void;
  /** HDL platforms: clock cycles since power-up */
  getClockCount?(): number | undefined;
  /**
   * HDL platforms: call `sink` with the design's state before every clock
   * (null stops). Costs the fast frame path, so only while recording.
   */
  setTraceSink?(sink: ((state: {[name: string]: any}) => void) | null): void;

  startProbing?(): ProbeRecorder;
  stopProbing?(): void;

  isBlocked?(): boolean; // is blocked, halted, or waiting for input?

  readFile?(path: string): FileData;
  writeFile?(path: string, data: FileData): boolean;
  sourceFileFetch?: (path: string) => FileData;

  getDownloadFile?(): { extension: string, blob: Blob };
  getDebugSymbolFile?(): { extension: string, blob: Blob };
}

export interface Preset {
  id: string;
  name: string;
  chapter?: number;
  title?: string;
  category?: string;
}

export interface MemoryBus {
  read: (address: number) => number;
  write: (address: number, value: number) => void;
  contend?: (address: number, cycles: number) => number;
  isContended?: (address: number) => boolean;
}

export type DebugCondition = () => boolean;
export type DebugEvalCondition = (c: CpuState) => boolean;
export type BreakpointCallback = (s: EmuState, msg?: string) => void;
// for composite breakpoints w/ single debug function
export class BreakpointList {
  id2bp: { [id: string]: Breakpoint } = {};
  getDebugCondition(): DebugCondition {
    if (Object.keys(this.id2bp).length == 0) {
      return null; // no breakpoints
    } else {
      // evaluate all breakpoints
      return () => {
        var result = false;
        for (var id in this.id2bp)
          if (this.id2bp[id].cond())
            result = true;
        return result;
      };
    }
  }
}
export interface Breakpoint {
  cond: DebugCondition;
};

export interface EmuRecorder {
  frameRequested(): boolean;
  recordFrame(state: EmuState);
}

/////

export abstract class BasePlatform {
  recorder: EmuRecorder = null;
  debugSymbols: DebugSymbols;
  internalFiles: { [path: string]: FileData } = {};

  abstract loadState(state: EmuState): void;
  abstract saveState(): EmuState;
  abstract pause(): void;
  abstract resume(): void;
  abstract advance(novideo?: boolean): number;

  setRecorder(recorder: EmuRecorder): void {
    this.recorder = recorder;
  }
  updateRecorder() {
    // are we recording and do we need to save a frame?
    if (this.recorder && (<Platform><any>this).isRunning() && this.recorder.frameRequested()) {
      this.recorder.recordFrame(this.saveState());
    }
  }
  inspect(sym: string): string {
    return inspectSymbol((this as any) as Platform, sym);
  }
  getDebugTree(): {} {
    var o: any = {};
    o.state = this.saveState();
    if (this.debugSymbols?.debuginfo) {
      // source variables have their own live view; listing the raw records
      // here would only show where they are, not what they hold
      const info = { ...this.debugSymbols.debuginfo };
      delete info['sourceVariables'];
      if (Object.keys(info).length) o.debuginfo = info;
    }
    return o;
  }
  readFile(path: string): FileData {
    return this.internalFiles[path];
  }
  writeFile(path: string, data: FileData): boolean {
    this.internalFiles[path] = data;
    return true;
  }
}

// How many consecutive frame boundaries the CPU has to sit on a trap spin
// before the program is declared dead. A debugger can stop in the stub for a
// frame (a breakpoint, a single step), and one frame is not enough to tell a
// real hang from that.
export const TRAP_SPIN_FRAMES = 10;

function readTrapStackByte(platform: BaseDebugPlatform, addr: number): number | null {
  const p = <any>platform;
  if (typeof p.readAddress === 'function') return p.readAddress(addr) & 0xff;
  if (p.machine && typeof p.machine.readConst === 'function') return p.machine.readConst(addr) & 0xff;
  if (p.machine && typeof p.machine.read === 'function') return p.machine.read(addr) & 0xff;
  return null;
}

// A jsr pushes its last byte, so the return address on top of the stack is
// site + 2. SP points just below the last byte pushed.
function trapSite6502(platform: BaseDebugPlatform): number | null {
  const sp = platform.getSP();
  if (typeof sp !== 'number') return null;
  const lo = readTrapStackByte(platform, 0x100 + ((sp + 1) & 0xff));
  const hi = readTrapStackByte(platform, 0x100 + ((sp + 2) & 0xff));
  if (lo == null || hi == null) return null;
  return (((hi << 8) | lo) - 2) & 0xffff;
}

// A call pushes site + 3; SP points at the low byte of the return address.
function trapSiteZ80(platform: BaseDebugPlatform): number | null {
  const sp = platform.getSP() & 0xffff;
  const lo = readTrapStackByte(platform, sp);
  const hi = readTrapStackByte(platform, (sp + 1) & 0xffff);
  if (lo == null || hi == null) return null;
  return (((hi << 8) | lo) - 3) & 0xffff;
}

export abstract class BaseDebugPlatform extends BasePlatform {
  onBreakpointHit: BreakpointCallback;
  debugCallback: DebugCondition;
  debugSavedState: EmuState = null;
  debugBreakState: EmuState = null;
  debugTargetClock: number = 0;
  debugClock: number = 0;
  breakpoints: BreakpointList = new BreakpointList();
  frameCount: number = 0;
  private trapSpinFrames: number = 0;

  abstract getCPUState(): CpuState;

  // Some CPU cores save their program counter one byte before or after the
  // opcode they are on, so a raw PC lands on an operand or on the previous
  // instruction. debugPCDelta corrects it: getCPUState() and saveState()
  // report PC + delta, which is the address of the opcode, the same address
  // getPC() returns.
  debugPCDelta = 0;
  fixPC(c) { c.PC = (c.PC + this.debugPCDelta) & 0xffff; return c; }
  unfixPC(c) { c.PC = (c.PC - this.debugPCDelta) & 0xffff; return c; }

  // True if a breakpoint targets the effective PC (see EPC), which some
  // platforms use to fold a bank offset into the address. Those need the CPU
  // state to find, so they skip the cheap getPC() test in runEvalAtPC().
  debugUsesEPC(): boolean { return false; }

  setBreakpoint(id: string, cond: DebugCondition) {
    if (cond) {
      this.breakpoints.id2bp[id] = { cond: cond };
      this.restartDebugging();
    } else {
      this.clearBreakpoint(id);
    }
  }
  clearBreakpoint(id: string) {
    delete this.breakpoints.id2bp[id];
  }
  hasBreakpoint(id: string) {
    return this.breakpoints.id2bp[id] != null;
  }
  getDebugCallback(): DebugCondition {
    return this.breakpoints.getDebugCondition();
  }
  setupDebug(callback: BreakpointCallback): void {
    this.onBreakpointHit = callback;
  }
  clearDebug() {
    if (this.debugBreakState != null && this.debugSavedState != null) {
      this.loadState(this.debugSavedState);
    }
    this.debugSavedState = null;
    this.debugBreakState = null;
    this.debugTargetClock = -1;
    this.debugClock = 0;
    this.onBreakpointHit = null;
    this.clearBreakpoint('debug');
    this.frameCount = 0;
    this.trapSpinFrames = 0;
  }
  setDebugCondition(debugCond: DebugCondition) {
    this.setBreakpoint('debug', debugCond);
  }
  resetDebugging() {
    if (this.debugSavedState) {
      this.loadState(this.debugSavedState);
    } else {
      this.debugSavedState = this.saveState();
    }
    this.debugClock = 0;
    this.debugCallback = this.getDebugCallback();
    this.debugBreakState = null;
  }
  restartDebugging() {
    this.resetDebugging();
    this.resume();
  }
  preFrame() {
    // save state before frame, to record any inputs that happened pre-frame
    if (this.debugCallback && !this.debugBreakState) {
      // save state every frame and rewind debug clocks
      this.debugSavedState = this.saveState();
      this.debugTargetClock -= this.debugClock;
      this.debugClock = 0;
    }
  }
  postFrame() {
    // reload debug state at end of frame after breakpoint
    if (this.debugCallback && this.debugBreakState) {
      this.loadState(this.debugBreakState);
    }
    this.frameCount++;
  }
  pollControls() {
  }
  nextFrame(novideo: boolean): number {
    this.pollControls();
    this.updateRecorder();
    this.preFrame();
    var steps = this.advance(novideo);
    this.postFrame();
    this.checkTrapSpin();
    return steps;
  }
  // default debugging
  abstract getSP(): number;
  abstract getPC(): number;
  abstract isStable(): boolean;

  /** The PC a stop is at, including a banked effective PC where a platform
   *  reports one in EPC. */
  private debugPC(): number {
    const c = this.getCPUState();
    return c && c.EPC != null ? c.EPC : (c ? c.PC : this.getPC());
  }

  /** The source variables live at the current PC, from the build's debug
   *  info (urust, oscar64), keyed `name:type`; empty when there are none. */
  getSourceVariables(): { [name: string]: any } {
    const vars = sourceVariablesOf(this.debugSymbols?.debuginfo);
    if (!vars.length) return {};
    return sourceVariableTree(vars, this.debugPC(), this.debugSymbols.symbolmap,
      this.debugSymbols.symbolsizes, a => readSourceByte(this, a)) || {};
  }

  getDebugTree(): {} {
    const tree: any = super.getDebugTree();
    if (sourceVariablesOf(this.debugSymbols?.debuginfo).length) {
      tree.Locals = { $$: () => this.getSourceVariables() };
    }
    return tree;
  }

  inspect(sym: string): string {
    const vars = sourceVariablesOf(this.debugSymbols?.debuginfo);
    if (vars.length) {
      const v = liveSourceVariables(vars, this.debugPC(), this.debugSymbols.symbolmap,
        this.debugSymbols.symbolsizes).find(v => v.name === sym);
      if (v) return formatSourceVariableLine(v, a => readSourceByte(this, a));
    }
    return super.inspect(sym);
  }

  /**
   * The site of a trap the CPU is sitting on, read from the return address a
   * `jsr` (6502) or `call` (Z80) pushed. Null where there is no such stack.
   */
  getTrapSite(): number | null {
    return null;
  }

  /**
   * urust's trap stub ends in a jump-to-self at `__trap_spin`. A program that
   * reaches it has panicked and will never leave, but it is the program's way
   * of stopping, so hosts would otherwise run it forever. Ten consecutive
   * frame boundaries on the symbol is a hang; report the site the stub was
   * called from and stop.
   */
  checkTrapSpin(): void {
    const spin = this.debugSymbols?.symbolmap?.['__trap_spin'];
    if (typeof spin !== 'number') {
      this.trapSpinFrames = 0;
      return;
    }
    const pc = this.getPC();
    // A clock-based CPU can end a frame mid-instruction, and its PC then names
    // something other than the opcode (the VIC-20/C64 WASM cores do). Once a
    // stable frame has put us on the spin, an unstable frame keeps the count:
    // the CPU is still executing the jump-to-self.
    if (this.isStable() || this.trapSpinFrames === 0) {
      if (pc !== spin) {
        this.trapSpinFrames = 0;
        return;
      }
    }
    if (++this.trapSpinFrames < TRAP_SPIN_FRAMES) return;
    this.trapSpinFrames = 0;
    const site = this.getTrapSite();
    const halt = new EmuHalt(site != null ? `Program trapped at $${hex(site, 4)}` : 'Program trapped in __trap_spin');
    halt.pc = site != null ? site : spin;
    throw halt;
  }

  evalDebugCondition() {
    if (this.debugCallback && !this.debugBreakState) {
      this.debugCallback();
    }
  }
  wasBreakpointHit(): boolean {
    return this.debugBreakState != null;
  }
  breakpointHit(targetClock: number, reason?: string) {
    console.log(this.debugTargetClock, targetClock, this.debugClock, this.isStable());
    this.debugTargetClock = targetClock;
    this.debugBreakState = this.saveState();
    console.log("Breakpoint at clk", this.debugClock, "PC", this.debugBreakState.c.PC.toString(16));
    this.pause();
    if (this.onBreakpointHit) {
      this.onBreakpointHit(this.debugBreakState, reason);
    }
  }
  haltAndCatchFire(reason: string) {
    this.breakpointHit(this.debugClock, reason);
  }
  runEval(evalfunc: DebugEvalCondition) {
    this.setDebugCondition(() => {
      if (++this.debugClock >= this.debugTargetClock && this.isStable()) {
        var cpuState = this.getCPUState();
        if (evalfunc(cpuState)) {
          this.breakpointHit(this.debugClock);
          return true;
        } else {
          return false;
        }
      }
    });
  }
  runToPC(pc: number[]) {
    this.runEvalAtPC(new Map(pc.map((a) => [a, null])));
  }
  // Runs until a breakpoint is hit, which can be a whole frame away, so it
  // tests getPC() on its own rather than building a CPU state at every
  // instruction. The state is only wanted once an address matches, to run
  // that breakpoint's condition.
  runEvalAtPC(targets: Map<number, DebugEvalCondition | null>) {
    this.debugTargetClock++;
    const useEPC = this.debugUsesEPC();
    this.setDebugCondition(() => {
      if (++this.debugClock < this.debugTargetClock || !this.isStable()) return;
      if (!useEPC && !targets.has(this.getPC())) return;
      const c = this.getCPUState();
      const epc = c.EPC != null ? c.EPC : c.PC;
      if (!targets.has(epc)) return;
      const cond = targets.get(epc);
      if (cond && !cond(c)) return;
      this.breakpointHit(this.debugClock);
      return true;
    });
  }
  runUntilReturn() {
    var SP0 = this.getSP();
    this.runEval((c: CpuState): boolean => {
      return c.SP > SP0; // TODO: check for RTS/RET opcode
    });
  }
  // step over one CPU instruction; if it is a subroutine call,
  // run at full speed until the instruction following it
  stepOver() {
    var p = <Platform>(<unknown>this);
    var pc = this.getPC();
    var d = null;
    var readfn = p.readAddress?.bind(p);
    if (readfn && p.disassemble) {
      d = p.disassemble(pc, readfn);
    }
    if (d && d.iscall) {
      // run until we return from the subroutine call
      var nextPC = pc + d.nbytes;
      this.debugTargetClock++;
      this.runEval((c) => c.PC == nextPC);
    } else {
      // not a call, just single-step
      this.step();
    }
  }
  hasCustomStepOver() { return false; }
  runToFrameClock(clock: number): void {
    this.restartDebugging();
    this.debugTargetClock = clock;
    this.runEval((): boolean => { return true; });
  }
  step() {
    this.runToFrameClock(this.debugClock + 1);
  }
  stepBack() {
    var prevState;
    var prevClock;
    var clock0 = this.debugTargetClock;
    this.restartDebugging();
    this.debugTargetClock = clock0 - 25; // TODO: depends on CPU
    this.runEval((c: CpuState): boolean => {
      if (this.debugClock < clock0) {
        prevState = this.saveState();
        prevClock = this.debugClock;
        return false;
      } else {
        if (prevState) {
          this.loadState(prevState);
          this.debugClock = prevClock;
        }
        return true;
      }
    });
  }
  runToVsync() {
    this.restartDebugging();
    var frame0 = this.frameCount;
    this.runEval((): boolean => {
      return this.frameCount > frame0;
    });
  }
}

export function inspectSymbol(platform: Platform, sym: string): string {
  if (!platform.debugSymbols) return;
  var symmap = platform.debugSymbols.symbolmap;
  var addr2sym = platform.debugSymbols.addr2symbol;
  if (!symmap || !platform.readAddress) return null;
  var addr = symmap["_" + sym] || symmap[sym]; // look for C or asm symbol
  if (!(typeof addr == 'number')) return null;
  var b = platform.readAddress(addr);
  // don't show 2 bytes if there's a symbol at the next address
  if (addr2sym && addr2sym[addr + 1] != null) {
    return "$" + hex(addr, 4) + " = $" + hex(b, 2) + " (" + b + " decimal)"; // unsigned
  } else {
    let b2 = platform.readAddress(addr + 1);
    let w = b | (b2 << 8);
    return "$" + hex(addr, 4) + " = $" + hex(b, 2) + " $" + hex(b2, 2) + " (" + ((w << 16) >> 16) + " decimal)"; // signed
  }
}

////// 6502

// TODO: can merge w/ Z80?
export abstract class Base6502Platform extends BaseDebugPlatform {

  // the MOS6502 keeps its PC one byte past the opcode it fetched
  debugPCDelta = -1;
  getSP() { return this.getCPUState().SP };
  getPC() { return this.getCPUState().PC };
  isStable() { return !this.getCPUState()['T']; }
  abstract readAddress(addr: number): number;

  newCPU(membus: MemoryBus) {
    var cpu = new _MOS6502();
    cpu.connectBus(membus);
    return cpu;
  }

  getOpcodeMetadata(opcode, offset) {
    return getOpcodeMetadata_6502(opcode, offset);
  }

  getOriginPC(): number {
    return (this.readAddress(0xfffc) | (this.readAddress(0xfffd) << 8)) & 0xffff;
  }

  getTrapSite() {
    return trapSite6502(this);
  }

  disassemble(pc: number, read: (addr: number) => number): DisasmLine {
    return disassemble6502(pc, read(pc), read(pc + 1), read(pc + 2));
  }
  getToolForFilename = getToolForFilename_6502;
  getDefaultExtensions() { return [".c", ".sdcc", ".cpp", ".o64", ".acme", ".xa", ".ca65", ".dasm", ".ecs", ".wiz"]; };

  getDebugCategories() {
    return ['CPU', 'ZPRAM', 'Stack'];
  }
  getDebugInfo(category: string, state: EmuState): string {
    switch (category) {
      case 'CPU': return cpuStateToLongString_6502(state.c);
      case 'ZPRAM': return dumpRAM(state.b || state.ram, 0x0, 0x100);
      case 'Stack': return dumpStackToString(<Platform><any>this, state.b || state.ram, 0x100, 0x1ff, 0x100 + state.c.SP, 0x20);
    }
  }
}

export function cpuStateToLongString_6502(c): string {
  function decodeFlags(c) {
    var s = "";
    s += c.N ? " N" : " -";
    s += c.V ? " V" : " -";
    s += c.D ? " D" : " -";
    s += c.Z ? " Z" : " -";
    s += c.C ? " C" : " -";
    s += c.I ? " I" : " -";
    return s;
  }
  return "PC " + hex(c.PC, 4) + "  " + decodeFlags(c) + "\n"
    + " A " + hex(c.A) + "     " + (c.R ? "" : "BUSY") + "\n"
    + " X " + hex(c.X) + "\n"
    + " Y " + hex(c.Y) + "     " + "SP " + hex(c.SP) + "\n";
}

var OPMETA_6502 = {
  cycletime: [
    7, 6, 0, 8, 3, 3, 5, 5, 3, 2, 2, 2, 4, 4, 6, 6, 2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 0, 7, 4, 4, 7, 7, 6, 6, 0, 8, 3, 3, 5, 5, 4, 2, 2, 2, 4, 4, 6, 6, 2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 0, 7, 4, 4, 7, 7, 6, 6, 0, 8, 3, 3, 5, 5, 3, 2, 2, 2, 3, 4, 6, 6, 2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 0, 7, 4, 4, 7, 7, 6, 6, 0, 8, 3, 3, 5, 5, 4, 2, 2, 2, 5, 4, 6, 6, 2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 0, 7, 4, 4, 7, 7, 0, 6, 0, 6, 3, 3, 3, 3, 2, 0, 2, 0, 4, 4, 4, 4, 2, 6, 0, 0, 4, 4, 4, 4, 2, 5, 2, 0, 0, 5, 0, 0, 2, 6, 2, 6, 3, 3, 3, 3, 2, 2, 2, 0, 4, 4, 4, 4, 2, 5, 0, 5, 4, 4, 4, 4, 2, 4, 2, 0, 4, 4, 4, 4, 2, 6, 0, 8, 3, 3, 5, 5, 2, 2, 2, 2, 4, 4, 3, 6, 2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 0, 7, 4, 4, 7, 7, 2, 6, 0, 8, 3, 3, 5, 5, 2, 2, 2, 0, 4, 4, 6, 6, 2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 0, 7, 4, 4, 7, 7
  ],
  extracycles: [
    0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1
  ],
  insnlengths: [
    1, 2, 0, 2, 2, 2, 2, 2, 1, 2, 1, 2, 3, 3, 3, 3, 2, 2, 0, 2, 2, 2, 2, 2, 1, 3, 0, 3, 3, 3, 3, 3, 3, 2, 0, 2, 2, 2, 2, 2, 1, 2, 1, 2, 3, 3, 3, 3, 2, 2, 0, 2, 2, 2, 2, 2, 1, 3, 0, 3, 3, 3, 3, 3, 1, 2, 0, 2, 2, 2, 2, 2, 1, 2, 1, 2, 3, 3, 3, 3, 2, 2, 0, 2, 2, 2, 2, 2, 1, 3, 0, 3, 3, 3, 3, 3, 1, 2, 0, 2, 2, 2, 2, 2, 1, 2, 1, 2, 3, 3, 3, 3, 2, 2, 0, 2, 2, 2, 2, 2, 1, 3, 0, 3, 3, 3, 3, 3, 0, 2, 0, 2, 2, 2, 2, 2, 1, 0, 1, 0, 3, 3, 3, 3, 2, 2, 0, 0, 2, 2, 2, 3, 1, 3, 1, 0, 0, 3, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 1, 2, 1, 0, 3, 3, 3, 3, 2, 2, 0, 2, 2, 2, 2, 2, 1, 3, 1, 0, 3, 3, 3, 3, 2, 2, 0, 2, 2, 2, 2, 2, 1, 2, 1, 2, 3, 3, 3, 3, 2, 2, 0, 2, 2, 2, 2, 2, 1, 3, 0, 3, 3, 3, 3, 3, 2, 2, 0, 2, 2, 2, 2, 2, 1, 2, 1, 0, 3, 3, 3, 3, 2, 2, 0, 2, 2, 2, 2, 2, 1, 3, 0, 3, 3, 3, 3, 3
  ],
  validinsns: [
    1, 2, 0, 0, 0, 2, 2, 0, 1, 2, 1, 0, 0, 3, 3, 0, 2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0, 3, 2, 0, 0, 2, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0, 2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0, 1, 2, 0, 0, 0, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0, 2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0, 1, 2, 0, 0, 0, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0, 2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0, 0, 2, 0, 0, 2, 2, 2, 0, 1, 0, 1, 0, 3, 3, 3, 0, 2, 2, 0, 0, 2, 2, 2, 0, 1, 3, 1, 0, 0, 3, 0, 0, 2, 2, 2, 0, 2, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0, 2, 2, 0, 0, 2, 2, 2, 0, 1, 3, 1, 0, 3, 3, 3, 0, 2, 2, 0, 0, 2, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0, 2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0, 2, 2, 0, 0, 2, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0, 2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0
  ],
}

export function getOpcodeMetadata_6502(opcode, address) {
  // TODO: more intelligent maximum cycles
  // TODO: must always be new object, b/c we might modify it
  return {
    opcode: opcode,
    minCycles: OPMETA_6502.cycletime[opcode],
    maxCycles: OPMETA_6502.cycletime[opcode] + OPMETA_6502.extracycles[opcode],
    insnlength: OPMETA_6502.insnlengths[opcode]
  };
}

////// Z80

export function cpuStateToLongString_Z80(c) {
  function decodeFlags(flags) {
    return printFlags(flags, ["S", "Z", , "H", , "V", "N", "C"], true);
  }
  return "PC " + hex(c.PC, 4) + "  " + decodeFlags(c.AF) + " " + (c.iff1 ? "I" : "-") + (c.iff2 ? "I" : "-") + "\n"
    + "SP " + hex(c.SP, 4) + "  IR " + hex(c.IR, 4) + "\n"
    + "IX " + hex(c.IX, 4) + "  IY " + hex(c.IY, 4) + "\n"
    + "AF " + hex(c.AF, 4) + "  BC " + hex(c.BC, 4) + "\n"
    + "DE " + hex(c.DE, 4) + "  HL " + hex(c.HL, 4) + "\n"
    ;
}

export function cpuStateToLongString_SM83(c) {
  function decodeFlags(af) {
    return printFlags(af, ["Z", "N", "H", "C"], true);
  }
  return "PC " + hex(c.PC, 4) + "  " + decodeFlags(c.AF >> 4) + " " + (c.ime ? "I" : "-") + "\n"
    + "SP " + hex(c.SP, 4) + "\n"
    + "AF " + hex(c.AF, 4) + "  BC " + hex(c.BC, 4) + "\n"
    + "DE " + hex(c.DE, 4) + "  HL " + hex(c.HL, 4) + "\n"
    ;
}

export abstract class BaseZ80Platform extends BaseDebugPlatform {

  _cpu;
  waitCycles: number = 0;

  newCPU(membus: MemoryBus, iobus: MemoryBus) {
    this._cpu = new Z80();
    this._cpu.connectMemoryBus(membus);
    this._cpu.connectIOBus(iobus);
    return this._cpu;
  }

  getPC() { return this._cpu.getPC(); }
  getSP() { return this._cpu.getSP(); }
  isStable() { return true; }

  getTrapSite() {
    return trapSiteZ80(this);
  }

  // TODO: refactor other parts into here
  runCPU(cpu, cycles: number): number {
    this._cpu = cpu; // TODO?
    this.waitCycles = 0; // TODO: needs to spill over betwenn calls
    if (this.wasBreakpointHit())
      return 0;
    var debugCond = this.getDebugCallback();
    var n = 0;
    this.waitCycles += cycles;
    while (this.waitCycles > 0) {
      if (debugCond && debugCond()) {
        debugCond = null;
        break;
      }
      var cyc = cpu.advanceInsn();
      n += cyc;
      this.waitCycles -= cyc;
    }
    return n;
  }

  getToolForFilename = getToolForFilename_z80;
  getDefaultExtensions() { return [".c", ".sdcc", ".ns", ".s", ".scc", ".sgb", ".z", ".wiz"]; };
  // TODO: Z80 opcode metadata
  //this.getOpcodeMetadata = function() { }

  getDebugCategories() {
    return ['CPU', 'Stack'];
  }
  getDebugInfo(category: string, state: EmuState): string {
    switch (category) {
      case 'CPU': return cpuStateToLongString_Z80(state.c);
      case 'Stack': {
        var sp = (state.c.SP - 1) & 0xffff;
        var start = sp & 0xff00;
        var end = start + 0xff;
        if (sp == 0) sp = 0x10000;
        console.log(sp, start, end);
        return dumpStackToString(<Platform><any>this, [], start, end, sp, 0xcd);
      }
    }
  }
  disassemble(pc: number, read: (addr: number) => number): DisasmLine {
    return disassembleZ80(pc, read(pc), read(pc + 1), read(pc + 2), read(pc + 3));
  }
}

////// 6809

export function cpuStateToLongString_6809(c) {
  function decodeFlags(flags) {
    return printFlags(flags, ["E", "F", "H", "I", "N", "Z", "V", "C"], true);
  }
  return "PC " + hex(c.PC, 4) + "  " + decodeFlags(c.CC) + "\n"
    + "SP " + hex(c.SP, 4) + "\n"
    + "DP " + hex(c.DP, 2) + "\n"
    + " A " + hex(c.A, 2) + "\n"
    + " B " + hex(c.B, 2) + "\n"
    + " X " + hex(c.X, 4) + "\n"
    + " Y " + hex(c.Y, 4) + "\n"
    + " U " + hex(c.U, 4) + "\n"
    ;
}

export abstract class Base6809Platform extends BaseZ80Platform {

  // The 6809's stack layout is not the Z80's; urust does not target it.
  getTrapSite() { return null; }

  newCPU(membus: MemoryBus) {
    var cpu = Object.create(CPU6809());
    cpu.init(membus.write, membus.read, 0);
    return cpu;
  }

  cpuStateToLongString(c: CpuState) {
    return cpuStateToLongString_6809(c);
  }
  disassemble(pc: number, read: (addr: number) => number): DisasmLine {
    // TODO: don't create new CPU
    return Object.create(CPU6809()).disasm(read(pc), read(pc + 1), read(pc + 2), read(pc + 3), read(pc + 4), pc);
  }
  getDefaultExtensions() { return [".c", ".lwasm", ".xasm"]; };
  //this.getOpcodeMetadata = function() { }
  getToolForFilename = getToolForFilename_6809;
  getDebugCategories() {
    return ['CPU', 'Stack'];
  }
  getDebugInfo(category: string, state: EmuState): string {
    switch (category) {
      case 'CPU': return cpuStateToLongString_6809(state.c);
      default: return super.getDebugInfo(category, state);
    }
  }
}


//TODO: how to get stack_end?
export function dumpStackToString(platform: Platform, mem: Uint8Array | number[], start: number, end: number, sp: number, jsrop: number, bigendian?: boolean): string {
  var s = "";
  var nraw = 0;
  //s = dumpRAM(mem.slice(start,start+end+1), start, end-start+1);
  function read(addr) {
    if (addr < mem.length) return mem[addr];
    else return platform.readAddress(addr);
  }
  while (sp < end) {
    sp++;
    // see if there's a JSR on the stack here
    // TODO: make work with roms and memory maps
    var addr = read(sp) + read(sp + 1) * 256;
    if (bigendian) { addr = ((addr & 0xff) << 8) | ((addr & 0xff00) >> 8) }
    var jsrofs = jsrop == 0x20 ? -2 : -3; // 6502 vs Z80
    var opcode = read(addr + jsrofs); // might be out of bounds
    if (opcode == jsrop) { // JSR
      s += "\n$" + hex(sp) + ": ";
      s += hex(addr, 4) + " " + lookupSymbol(platform, addr, true);
      sp++;
      nraw = 0;
    } else {
      if (nraw == 0)
        s += "\n$" + hex(sp) + ": ";
      s += hex(read(sp)) + " ";
      if (++nraw == 8) nraw = 0;
    }
  }
  return s + "\n";
}

// TODO: slow, funky, uses global
export function lookupSymbol(platform: Platform, addr: number, extra: boolean) {
  var start = addr;
  var addr2symbol = platform.debugSymbols && platform.debugSymbols.addr2symbol;
  while (addr2symbol && addr >= 0) {
    var sym = addr2symbol[addr];
    if (sym) { // return first symbol we find
      var sym = addr2symbol[addr];
      return extra ? (sym + " + $" + hex(start - addr)) : sym;
    }
    if (!extra) break;
    addr--;
  }
  return "";
}

/// new Machine platform adapters

export interface Machine extends Bus, Resettable, FrameBased, AcceptsROM, HasCPU, SavesState<EmuState>, SavesInputState<any> {
}

export function hasVideo(arg: any): arg is VideoSource {
  return typeof arg.connectVideo === 'function';
}
export function hasAudio(arg: any): arg is SampledAudioSource {
  return typeof arg.connectAudio === 'function';
}
export function hasKeyInput(arg: any): arg is AcceptsKeyInput {
  return typeof arg.setKeyInput === 'function';
}
export function hasJoyInput(arg: any): arg is AcceptsJoyInput {
  return typeof arg.setJoyInput === 'function';
}
export function hasPaddleInput(arg: any): arg is AcceptsPaddleInput {
  return typeof arg.setPaddleInput === 'function';
}
export function isRaster(arg: any): arg is RasterFrameBased {
  return typeof arg.getRasterY === 'function';
}
export function hasProbe(arg: any): arg is Probeable {
  return typeof arg.connectProbe == 'function';
}
export function hasBIOS(arg: any): arg is AcceptsBIOS {
  return typeof arg.loadBIOS == 'function';
}
export function hasSerialIO(arg: any): arg is HasSerialIO {
  return typeof arg.connectSerialIO === 'function';
}

export abstract class BaseMachinePlatform<T extends Machine> extends BaseDebugPlatform implements Platform {
  machine: T;
  mainElement: HTMLElement;
  options: any; // URL options (?options=key%3Dvalue), if any
  timer: AnimationTimer;
  video: RasterVideo;
  audio: SampledAudio;
  poller: ControllerPoller;
  serialIOInterface: SerialIOInterface;
  serialVisualizer: SerialIOVisualizer;

  probeRecorder: ProbeRecorder;
  startProbing;
  stopProbing;
  // The probe's singleFrame flag saved while runToVsync() holds a frame open,
  // restored by pause() when the run stops (the run is timer-driven, so the
  // stop happens after runToVsync() has returned).
  probeSingleFrame: boolean = null;

  abstract newMachine(): T;
  abstract getToolForFilename(s: string): string;
  abstract getDefaultExtensions(): string[];
  abstract getPresets(): Preset[];

  constructor(mainElement: HTMLElement, options?: any) {
    super();
    this.mainElement = mainElement;
    this.options = options || {};
  }

  reset() {
    this.machine.reset();
    if (this.serialVisualizer != null) this.serialVisualizer.reset();
  }
  // The machine's CPU state is the core's own, so debugPCDelta corrects its PC
  // on the way out and restores it on the way in. The machine's cpu.getPC()
  // already names the opcode, so getPC() is left alone.
  loadState(s) {
    if (!this.debugPCDelta || !s.c) return this.machine.loadState(s);
    this.unfixPC(s.c);
    try { this.machine.loadState(s); } finally { this.fixPC(s.c); }
  }
  saveState() {
    const s = this.machine.saveState();
    if (this.debugPCDelta && s.c) this.fixPC(s.c);
    return s;
  }
  getSP() { return this.machine.cpu.getSP(); }
  getPC() { return this.machine.cpu.getPC(); }
  isStable() { return this.machine.cpu.isStable(); }
  getCPUState() { return this.fixPC(this.machine.cpu.saveState()); }
  loadControlsState(s) { this.machine.loadControlsState(s); }
  saveControlsState() { return this.machine.saveControlsState(); }

  async start() {
    this.machine = this.newMachine();
    const m = this.machine;
    // block on WASM loading
    if (m instanceof BaseWASMMachine) {
      await m.loadWASM();
    }
    var videoFrequency;
    if (hasVideo(m)) {
      var vp = m.getVideoParams();
      this.video = new RasterVideo(this.mainElement, vp.width, vp.height,
        {
          overscan: !!vp.overscan,
          rotate: vp.rotate | 0,
          aspect: vp.aspect
        });
      this.video.create();
      m.connectVideo(this.video.getFrameData());
      // TODO: support keyboard w/o video?
      if (hasKeyInput(m)) {
        this.video.setKeyboardEvents(m.setKeyInput.bind(m));
        this.poller = new ControllerPoller(m.setKeyInput.bind(m));
      }
      videoFrequency = vp.videoFrequency;
    }
    this.timer = new AnimationTimer(videoFrequency || 60, this.nextFrame.bind(this));
    if (hasAudio(m)) {
      var ap = m.getAudioParams();
      this.audio = new SampledAudio(ap.sampleRate);
      this.audio.start();
      m.connectAudio(this.audio);
    }
    if (hasPaddleInput(m)) {
      this.video.setupMouseEvents();
    }
    if (hasProbe(m)) {
      this.probeRecorder = new ProbeRecorder(m);
      this.startProbing = () => {
        m.connectProbe(this.probeRecorder);
        return this.probeRecorder;
      };
      this.stopProbing = () => {
        m.connectProbe(null);
      };
    }
    if (hasBIOS(m)) {
      this.loadBIOS = (title, data) => {
        m.loadBIOS(data, title);
      };
    }
    if (hasSerialIO(m)) {
      if (this.serialIOInterface == null) {
        this.serialVisualizer = new SerialIOVisualizer(this.mainElement, m);
      } else {
        m.connectSerialIO(this.serialIOInterface);
      }
    }
  }

  loadROM(title, data, origin?: number) {
    this.machine.loadROM(data, title, origin);
    this.reset();
  }

  loadBIOS: (title, data) => void; // only set if hasBIOS() is true

  acceptsPaddles() {
    return hasPaddleInput(this.machine);
  }

  setPaddles(x: number, y: number, buttons: boolean[]) {
    // pollControls() passes these on to the machine at the next frame
    this.video.paddle_x = x;
    this.video.paddle_y = y;
    buttons.forEach((b, i) => this.video.paddle_buttons[i] = b);
  }

  pollControls() {
    this.poller && this.poller.poll();
    if (hasPaddleInput(this.machine)) {
      this.machine.setPaddleInput(0, this.video.paddle_x);
      this.machine.setPaddleInput(1, this.video.paddle_y);
      if (this.machine.setPaddleButton && this.video.paddle_buttons != null) {
        this.machine.setPaddleButton(0, this.video.paddle_buttons[0]);
        this.machine.setPaddleButton(1, this.video.paddle_buttons[1]);
        this.machine.setPaddleButton(2, this.video.paddle_buttons[2]);
      }
    }
    // TODO: put into interface
    if (this.machine['pollControls']) {
      this.machine['pollControls']();
    }
  }

  advance(novideo: boolean) {
    let trap = this.getDebugCallback();
    try {
      var steps = this.machine.advanceFrame(trap);
      return steps;
    } finally {
      // in case EmuHalt is thrown...
      if (!novideo && this.video) {
        this.video.updateFrame();
        this.updateVideoDebugger();
      }
      if (!novideo && this.serialVisualizer) {
        this.serialVisualizer.refresh();
      }
    }
  }

  updateVideoDebugger() {
    if (!this.isRunning() && isRaster(this.machine) && this.machine.getRasterCanvasPosition) {
      const { x, y } = this.machine.getRasterCanvasPosition();
      if (x >= 0 || y >= 0) {
        const ctx = this.video?.getContext();
        if (ctx) {
          drawCrosshair(ctx, x, y, 1);
        }
      }
    }
  }

  advanceFrameClock(trap, step) {
    if (!(step > 0)) return;
    if (this.machine instanceof BaseWASMMachine) {
      return this.machine.advanceFrameClock(trap, step);
    } else {
      return this.machine.advanceFrame(() => {
        return --step <= 0;
      });
    }
  }

  isRunning() {
    return this.timer && this.timer.isRunning();
  }

  resume() {
    this.timer.start();
    this.audio && this.audio.start();
    this.poller && this.poller.start();
  }

  pause() {
    this.timer.stop();
    this.audio && this.audio.stop();
    this.poller && this.poller.stop();
    // runToVsync() holds a frame open for the probe; put the probe's own
    // setting back now that the run has stopped.
    if (this.probeRecorder && this.probeSingleFrame != null) {
      this.probeRecorder.singleFrame = this.probeSingleFrame;
      this.probeSingleFrame = null;
    }
  }

  // so probe views stick around TODO: must be a better way?
  runToVsync() {
    // A single-frame step stops on the next frame boundary -- exactly where
    // ProbeRecorder.logNewFrame() clears a singleFrame buffer -- which would
    // leave the probe views blank. Clear here and hold the frame open until
    // the run stops instead. pause() restores the saved setting.
    if (this.probeRecorder) {
      this.probeSingleFrame = this.probeRecorder.singleFrame;
      this.probeRecorder.reset();
      this.probeRecorder.singleFrame = false;
    }
    this.restartDebugging();
    var flag = false;
    this.runEval((): boolean => {
      if (this.getRasterScanline() > 0) flag = true;
      else return flag;
    });
  }

  // TODO: reset target clock counter
  getRasterScanline() {
    return isRaster(this.machine) && this.machine.getRasterY ? this.machine.getRasterY() : -1;
  }
  getRasterLineClock() {
    return isRaster(this.machine) && this.machine.getRasterX ? this.machine.getRasterX() : -1;
  }

  readAddress(addr: number): number {
    return this.machine.read(addr);
  }

  getDebugCategories() {
    if (isDebuggable(this.machine))
      return this.machine.getDebugCategories();
  }
  getDebugInfo(category: string, state: EmuState): string {
    return isDebuggable(this.machine) && this.machine.getDebugInfo(category, state);
  }
}

// TODO: move debug info into CPU?

export abstract class Base6502MachinePlatform<T extends Machine> extends BaseMachinePlatform<T> {

  getTrapSite() {
    return trapSite6502(this);
  }

  getOpcodeMetadata = getOpcodeMetadata_6502;
  getToolForFilename(fn) { return getToolForFilename_6502(fn); }
  getDefaultExtensions() { return [".c", ".cpp", ".o64", ".acme", ".xa", ".ca65", ".dasm", ".ecs", ".wiz"]; }

  disassemble(pc: number, read: (addr: number) => number): DisasmLine {
    return disassemble6502(pc, read(pc), read(pc + 1), read(pc + 2));
  }
  getDebugCategories() {
    if (isDebuggable(this.machine))
      return this.machine.getDebugCategories();
    else
      return ['CPU', 'ZPRAM', 'Stack'];
  }
  getDebugInfo(category: string, state: EmuState): string {
    switch (category) {
      case 'CPU': return cpuStateToLongString_6502(state.c);
      case 'ZPRAM': return dumpRAM(state.b || state.ram, 0x0, 0x100);
      case 'Stack': return dumpStackToString(<Platform><any>this, state.b || state.ram, 0x100, 0x1ff, 0x100 + state.c.SP, 0x20);
      default: return isDebuggable(this.machine) && this.machine.getDebugInfo(category, state);
    }
  }
}

export abstract class BaseZ80MachinePlatform<T extends Machine> extends BaseMachinePlatform<T> {

  getTrapSite() {
    return trapSiteZ80(this);
  }

  //getOpcodeMetadata     = getOpcodeMetadata_z80;
  getToolForFilename = getToolForFilename_z80;
  getDefaultExtensions() { return [".c", ".ns", ".s", ".scc", ".sgb", ".z", ".wiz"]; }

  getDebugCategories() {
    if (isDebuggable(this.machine))
      return this.machine.getDebugCategories();
    else
      return ['CPU', 'Stack'];
  }
  getDebugInfo(category: string, state: EmuState): string {
    switch (category) {
      case 'CPU': return cpuStateToLongString_Z80(state.c);
      case 'Stack': {
        var sp = (state.c.SP - 1) & 0xffff;
        var start = sp & 0xff00;
        var end = start + 0xff;
        if (sp == 0) sp = 0x10000;
        return dumpStackToString(<Platform><any>this, [], start, end, sp, 0xcd);
      }
      default: return isDebuggable(this.machine) && this.machine.getDebugInfo(category, state);
    }
  }
  disassemble(pc: number, read: (addr: number) => number): DisasmLine {
    return disassembleZ80(pc, read(pc), read(pc + 1), read(pc + 2), read(pc + 3));
  }

}

export abstract class Base6809MachinePlatform<T extends Machine> extends BaseMachinePlatform<T> {

  getToolForFilename = getToolForFilename_6809;
  getDefaultExtensions() { return [".c", ".lwasm", ".xasm"]; }

  getDebugCategories() {
    if (isDebuggable(this.machine))
      return this.machine.getDebugCategories();
    else
      return ['CPU', 'Stack'];
  }
  getDebugInfo(category: string, state: EmuState): string {
    switch (category) {
      case 'CPU': return cpuStateToLongString_6809(state.c);
      case 'Stack': {
        var sp = (state.c.SP - 1) & 0xffff;
        var start = sp & 0xff00;
        var end = start + 0xff;
        if (sp == 0) sp = 0x10000;
        return dumpStackToString(<Platform><any>this, [], start, end, sp, 0x17, true);
      }
      default: return super.getDebugInfo(category, state);
    }
  }
  disassemble(pc: number, read: (addr: number) => number): DisasmLine {
    // TODO: don't create new CPU
    return Object.create(CPU6809()).disasm(read(pc), read(pc + 1), read(pc + 2), read(pc + 3), read(pc + 4), pc);
  }
}

///

class SerialIOVisualizer {

  textarea: HTMLTextAreaElement;
  //vlist: VirtualTextScroller;
  device: HasSerialIO;
  lastOutCount = -1;
  lastInCount = -1;

  constructor(parentElement: HTMLElement, device: HasSerialIO) {
    this.device = device;
    this.textarea = document.createElement("textarea");
    this.textarea.classList.add('transcript');
    this.textarea.classList.add('transcript-style-2');
    this.textarea.style.display = 'none';
    parentElement.appendChild(this.textarea);
    /*
    this.vlist = new VirtualTextScroller(parentElement);
    this.vlist.create(parentElement, 1024, this.getMemoryLineAt.bind(this));
    this.vlist.maindiv.style.height = '8em';
    this.vlist.maindiv.style.overflow = 'clip';
    */
  }
  reset() {
    this.lastOutCount = 0;
    this.lastInCount = 0;
    this.textarea.style.display = 'none';
  }
  refresh() {
    var lastop = '';
    if (this.device.serialOut.length != this.lastOutCount) {
      var s = '';
      for (var ev of this.device.serialOut) {
        if (lastop != ev.op) {
          if (s != '') s += '\n';
          if (ev.op === 'read') s += '<< ';
          else if (ev.op === 'write') s += '>> ';
          lastop = ev.op;
        }
        if (ev.value == 10) { s += '\u21b5'; lastop = ''; }
        else { s += byteToASCII(ev.value); }
      }
      this.textarea.value = s;
      this.lastOutCount = this.device.serialOut.length;
      this.textarea.style.display = 'block';
    }
  }
}
