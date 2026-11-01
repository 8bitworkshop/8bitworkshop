
import { Platform, BasePlatform, Base6502MachinePlatform, cpuStateToLongString_6502, dumpStackToString, DisasmLine, CpuState, Preset } from "../common/baseplatform";
import { JavatariMachine } from "../machine/vcs";
import { getToolForFilename_vcs } from "../common/toolselect";
import { PLATFORMS, dumpRAM, EmuHalt, KeyFlags, __createCanvas, drawCrosshair } from "../common/emu";
import { hex, loadScript, lpad, tobin } from "../common/util";
import { CodeAnalyzer_vcs } from "../common/analysis";
import { disassemble6502 } from "../common/cpu/disasm6502";
import { ProbeRecorder } from "../common/probe";
import { NullProbe, ProbeAll } from "../common/devices";
import { BaseMAME6502Platform } from "../common/mameplatform";
import type { VideoOutput } from "../common/emucore";

declare var Javatari : any;
declare var jt : any; // 6502

const VCS_PRESETS : Preset[] = [
  {id:'examples/hello.a', chapter:4, name:'Hello 6502 and TIA'},
  {id:'examples/vsync.a', chapter:5, name:'Painting on the CRT', title:'Color Bars'},
  {id:'examples/playfield.a', chapter:6, name:'Playfield Graphics'},
  {id:'examples/sprite.a', chapter:7, name:'Players and Sprites'},
  {id:'examples/colorsprites.a', chapter:8, name:'Color Sprites'},
  {id:'examples/timing2.a', chapter:9, name:'Fine Positioning', title:'Fine Position'},
  {id:'examples/missiles.a', chapter:10, name:'Player/Missile Graphics', title:'Player/Missile'},
  {id:'examples/sethorizpos.a', chapter:11, name:'SetHorizPos Routine'},
  {id:'examples/piatimer.a', chapter:12, name:'PIA Timer'},
  {id:'examples/controls.a', chapter:13, name:'Joysticks'},
  {id:'examples/complexscene.a', chapter:15, name:'Complex Scene I'},
  {id:'examples/complexscene2.a', chapter:16, name:'Complex Scene II'},
  {id:'examples/scoreboard.a', chapter:18, name:'Scoreboard'},
  {id:'examples/collisions.a', chapter:19, name:'Collisions'},
  {id:'examples/bitmap.a', chapter:20, name:'Async Playfield: Bitmap', title:'Async PF Bitmap'},
  {id:'examples/brickgame.a', chapter:21, name:'Async Playfield: Bricks', title:'Async PF Bricks'},
//  {id:'examples/multisprite1.a', chapter:8, name:'Sprite Kernel'},
  {id:'examples/bigsprite.a', chapter:22, name:'A Big 48-Pixel Sprite', title:'48-Pixel Sprite'},
  {id:'examples/tinyfonts2.a', chapter:23, name:'Tiny Text'},
  {id:'examples/score6.a', chapter:24, name:'6-Digit Score'},
  {id:'examples/retrigger.a', chapter:26, name:'Sprite Formations'},
//  {id:'examples/tinyfonts.a', chapter:23, name:'Tiny Fonts, Slow'},
  {id:'examples/multisprite3.a', chapter:28, name:'Multisprites'},
  {id:'examples/procgen1.a', chapter:30, name:'Procedural Generation'},
  {id:'examples/lines.a', chapter:31, name:'Drawing Lines'},
//  {id:'examples/piatable.a', name:'Timer Table'},
  {id:'examples/musicplayer.a', chapter:32, name:'Music Player'},
  {id:'examples/road.a', chapter:33, name:'Pseudo 3D Road'},
  {id:'examples/bankswitching.a', chapter:35, name:'Bankswitching'},
  {id:'examples/wavetable.a', chapter:36, name:'Wavetable Sound'},
  {id:'examples/pal.a', name:'PAL Video Output'},
//  {id:'examples/testlibrary.a', name:'VCS Library Demo'},
//  {id:'examples/music2.a', name:'Pitch-Accurate Music'},
//  {id:'examples/fullgame.a', name:'Thru Hike: The Game', title:'Thru Hike'},
  {id:'examples/fracpitch.a', name:'Fractional Pitch', category:'BASIC and Other Languages'},
  {id:'bb/helloworld.bas', name:'Hello World (batariBASIC)'},
  {id:'bb/draw.bas', name:'Playfield Draw (batariBASIC)'},
  {id:'bb/sample.bas', name:'Sprite Test (batariBASIC)'},
  {id:'bb/FIFA1977.bas', name:'2P Soccer Game (batariBASIC)'},
  {id:'bb/duck_chase.bas', name:'Duck Chase (batariBASIC)'},
  {id:'wiz/finalduck.wiz', name:'Final Duck (Wiz)'},
//  {id:'bb/rblast106.bas', name:'Road Blasters (batariBASIC)'},
  {id:'vcslib/demo_vcslib.c', name:'VCSLib Demo (C)'},
  {id:'helloworld.cc2600', name:'Hello World (cc2600)'},
];


class VCSPlatform extends BasePlatform {

  lastBreakState; // last breakpoint state
  canvas : HTMLCanvasElement;
  frame : VideoOutput | null = null; // see captureVideo()
  capturing = false;
  muted = false;

  // TODO: super hack for ProbeBitmap view
  machine = {
    cpuCyclesPerLine: 76 // NTSC
  };

  getPresets() { return VCS_PRESETS; }

  async start() {
    var self : VCSPlatform = this;
    // load Javatari and configure settings
    await loadScript("javatari/javatari.js");
    Javatari.AUTO_START = false;
    Javatari.SHOW_ERRORS = false;
    Javatari.CARTRIDGE_CHANGE_DISABLED = true;
    Javatari.DEBUG_SCANLINE_OVERFLOW = false; // TODO: integrate into probe API
    Javatari.AUDIO_BUFFER_SIZE = 256;
    // show console div and start
    const jadiv = document.getElementById("javatari-div");
    if (jadiv) jadiv.style.display = '';
    Javatari.start();
    var jaconsole = Javatari.room.console;
    // intercept clockPulse function
    jaconsole.oldClockPulse = jaconsole.clockPulse;
    jaconsole.clockPulse = function() {
      self.updateRecorder();
      self.probe.logNewFrame();
      this.oldClockPulse();
      // look for KIL instruction
      // Halt passively, like vcs.jt4, instead of stopping as a breakpoint would
      // (which moves the cursor). Throw outside Javatari's clock, since it
      // can't recover from an exception.
      if (Javatari.room.console.getCPUState().o == 0x02 && self.isRunning()) {
        self.pause();
        const pc = (Javatari.room.console.saveState().c.PC - 1) & 0xffff;
        setTimeout(() => { throw new EmuHalt(`CPU halted at $${pc.toString(16)}`); }, 0);
      }
    }
    // intercept TIA end of line
    var videoSignal = jaconsole.tia.getVideoOutput();
    videoSignal.oldNextLine = videoSignal.nextLine;
    videoSignal.nextLine = function(pixels, vsync) {
      self.probe.logNewScanline();
      if (self.capturing && pixels) self.captureLine(this.monitor, pixels);
      return this.oldNextLine(pixels, vsync);
    }
    // resize after added to dom tree
    var jacanvas = document.querySelector("#javatari-screen canvas") as HTMLCanvasElement;
    if (jacanvas && typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(entries => {
        this.resize();
      });
      resizeObserver.observe(jacanvas);
    }
    this.canvas = jacanvas;
  }

  /**
   * Javatari draws to its own screen, so hosts with no screen (EmuCore) call
   * this to get the visible part of each frame instead.
   */
  captureVideo() : () => VideoOutput | null {
    this.capturing = true;
    return () => this.frame;
  }
  captureLine(monitor, pixels : ArrayLike<number>) {
    const p = monitor.getDisplayParameters();
    const width = p.displayWidth, height = p.displayHeight;
    if (this.frame?.width != width || this.frame?.height != height) {
      this.frame = {
        pixels: new Uint32Array(width * height), width, height,
        aspect: (width * p.displayScaleX) / (height * p.displayScaleY),
      };
    }
    const y = monitor.currentLine() - p.displayOriginY;
    if (y < 0 || y >= height) return;
    const dest = this.frame.pixels;
    for (let x = 0, i = y * width; x < width; x++)
      dest[i++] = pixels[p.displayOriginX + x];
  }

  /** Keys from hosts that have no Javatari screen to type into. */
  setKeyInput(key:number, code:number, flags:number) {
    const press = (flags & KeyFlags.KeyDown) != 0;
    if (!press && !(flags & KeyFlags.KeyUp)) return;
    // Javatari's modifier masks
    const modifiers = (flags & KeyFlags.Ctrl ? 1 : 0) | (flags & KeyFlags.Alt ? 2 : 0) | (flags & KeyFlags.Shift ? 4 : 0);
    Javatari.room.controls.processKeyEvent(key, press, modifiers);
  }

  loadROM(title, data) {
    if (data.length == 0 || ((data.length & 0x3ff) != 0))
      throw new EmuHalt("Invalid ROM length: " + data.length);
    // TODO: parse Log messages from Javatari?
    var wasrunning = this.isRunning();
    Javatari.loadROM(title, data);
    if (!this.isRunning()) throw Error("Could not load ROM");
    if (!wasrunning) this.pause();
  }

  getOpcodeMetadata(opcode, offset) {
    return Javatari.getOpcodeMetadata(opcode, offset);
  }

  getRasterPosition() : {x:number,y:number,clk:number} {
    var clkfs = Javatari.room.console.getClocksFromFrameStart() - 1;
    var row = Math.floor(clkfs/76);
    var col = clkfs - row*76;
    var xpos = col*3;
    var ypos = row;
    return {x:xpos, y:ypos, clk:clkfs%76};
  }
  getRasterScanline() : number {
    return this.getRasterPosition().y;
  }
  getRasterLineClock() : number {
    return this.getRasterPosition().x;
  }
  getRasterCanvasPosition() : {x:number,y:number} {
    let p = Javatari.room.console.tia.getVideoOutput().monitor.getDisplayParameters();
    let {x,y} = this.getRasterPosition();
    let canvasPos = {
      x: (x - p.displayOriginX) * p.displayWidth * p.displayScaleX / (p.signalWidth - p.displayOriginX),
      y: (y - p.displayOriginY) * p.displayHeight * p.displayScaleY / p.displayHeight
    };
    console.log(x,y,canvasPos,p);
    return canvasPos;
  }

  // TODO: Clock changes this on event, so it may not be current
  isRunning() {
    //console.log(Javatari.room.console.isRunning(), Javatari.room.console.isPowerOn);
    return Javatari.room && Javatari.room.console.isRunning();
  }
  pause() {
    Javatari.room.console.pause();
    Javatari.room.speaker.mute();
  }
  resume() {
    Javatari.room.console.go();
    // for browser autostart
    Javatari.room.speaker.powerOff();
    Javatari.room.speaker.powerOn();
    this.applyMute();
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyMute();
  }
  private applyMute() {
    const speaker = Javatari.room && Javatari.room.speaker;
    if (!speaker) return;
    // pause/debug also mute Javatari's speaker; only play while running
    if (this.muted || !this.isRunning()) speaker.mute();
    else speaker.play();
  }
  advance() : number {
    Javatari.room.console.clockPulse();
    return 0; // TODO: advanceFrameClock() and return 76*262 (or PAL)
  }
  /*
  advanceFrameClock?(trap: DebugCondition, step: number) : number {
    this.runEval( (c) => {
      var clkfs = Javatari.room.console.getClocksFromFrameStart() - 1;
      return clkfs >= step;
    });
    return step;
  }
  */
  // for unit test
  nextFrame() {
    Javatari.room.console.clockPulse();
  }

  step() { Javatari.room.console.debugSingleStepCPUClock(); }
  stepBack() { Javatari.room.console.debugStepBackInstruction(); }
  runEval(evalfunc) { Javatari.room.console.debugEval(evalfunc); }

  setupDebug(callback) {
    Javatari.room.console.onBreakpointHit = (state) => {
      state.c.PC = (state.c.PC - 1) & 0xffff;
      this.fixState(state);
      Javatari.room.console.pause();
      Javatari.room.speaker.mute();
      this.lastBreakState = state;
      callback(state);
      // TODO: we have to delay because javatari timer is still running
      setTimeout(() => this.updateVideoDebugger(), 100);
    }
    Javatari.room.speaker.mute();
  }
  isDebugging() : boolean {
    // TODO: always true
    return Javatari.room.console.onBreakpointHit != null;
  }
  clearDebug() {
    this.lastBreakState = null;
    Javatari.room.console.disableDebug();
    Javatari.room.console.onBreakpointHit = null;
    this.applyMute();
  }

  reset() {
    Javatari.room.console.powerOff();
    Javatari.room.console.resetDebug();
    Javatari.room.console.powerOn();
    this.applyMute();
  }
  getOriginPC() {
    return (this.readAddress(0xfffc) | (this.readAddress(0xfffd) << 8)) & 0xffff;
  }
  newCodeAnalyzer() {
    return new CodeAnalyzer_vcs(this);
  }
  saveState() {
    var state = Javatari.room.console.saveState();
    this.fixState(state);
    return state;
  }
  fixState(state) {
    // TODO: DASM listing prevents us from using RORG offset
    // TODO: how to handle 1000/3000/etc vs overlapping addresses?
    if (state.ca?.f != '3E' && state.ca?.f != '3F')  {
      var ofs = (state.ca?.bo) || 0;
      // TODO: for batari BASIC
      state.c.EPC = state.c.PC + ofs; // EPC = effective PC for ROM
    }
  }
  loadState(state) {
    return Javatari.room.console.loadState(state);
  }
  getCPUState() : CpuState {
    return Javatari.room.console.getCPUState();
  }
  saveControlsState() {
    return Javatari.room.console.saveControlsState();
  }
  loadControlsState(state) {
    Javatari.room.console.loadControlsState(state);
  }
  readAddress(addr) {
    // TODO: shouldn't have to do this when debugging
    // TODO: don't read bank switch addresses
    if (this.lastBreakState && addr >= 0x80 && addr < 0x100)
      return this.getRAMForState(this.lastBreakState)[addr & 0x7f];
    else if ((addr & 0x1280) === 0x280)
      return 0; // don't read PIA
    else
      return Javatari.room.console.readAddress(addr);
  }
  writeAddress(addr,value) {
    Javatari.room.console.writeAddress(addr,value);
  }
  runUntilReturn() {
    var depth = 1;
    this.runEval( (c) => {
      if (depth <= 0 && c.T == 0)
        return true;
      if (c.o == 0x20)
        depth++;
      else if (c.o == 0x60 || c.o == 0x40)
        --depth;
      return false;
    });
  }
  runToVsync() {
    this.advance();
    this.runEval( (c) => { return true; } );
  }
  cpuStateToLongString(c) {
    return cpuStateToLongString_6502(c);
  }
  getRAMForState(state) {
    return jt.Util.byteStringToUInt8Array(atob(state.r.b));
  }
  ramStateToLongString(state) {
    var ram = this.getRAMForState(state);
    return "\n" + dumpRAM(ram, 0x80, 0x80);
  }
  getToolForFilename = getToolForFilename_vcs;
  getDefaultExtensions() { return [".dasm", ".a", ".bb", ".acme", ".xa", ".ca65", ".cc2600", ".ecs", ".wiz", ".c"]; }
  getROMExtension() { return ".a26"; }

  getDebugCategories() {
    return ['CPU','Stack','PIA','TIA'];
  }
  getDebugInfo(category, state) {
    switch (category) {
      case 'CPU':    return this.cpuStateToLongString(state.c) + this.bankSwitchStateToString(state);
      case 'Stack':	 return dumpStackToString(this, this.getRAMForState(state), 0x100, 0x1ff, 0x100+state.c.SP, 0x20);
      case 'PIA':    return this.ramStateToLongString(state) + "\n" + this.piaStateToLongString(state.p);
      case 'TIA':    return this.tiaStateToLongString(state.t);
    }
  }
  bankSwitchStateToString(state) {
    if (state.ca?.ro >= 0) return "RAMOffset "+hex(state.ca.ro,4)+"\n";
    return (state.ca?.bo >= 0) ? "BankOffset "+hex(state.ca.bo,4)+"\n" : "";
  }
  piaStateToLongString(p) {
    return "Timer  " + p.t + "/" + p.c + "\nINTIM  $" + hex(p.IT,2) + " (" + p.IT + ")\nINSTAT $" + hex(p.IS,2) + "\n";
  }
  tiaStateToLongString(t) {
    var pos = this.getRasterPosition();
    var s = '';
    s += "H" + lpad(pos.x.toString(),5) + " (clk " + lpad(pos.clk.toString(),3) + ") V" + lpad(pos.y.toString(),5) + "   ";
    s += (t.vs?"VSYNC ":"- ") + (t.vb?"VBLANK ":"- ") + "\n";
    s += "\n";
    s += "Playfield " + t.f + "\n";
    s += "          " + (t.fr?"REFLECT ":"- ") + (t.fs?"SCOREMODE ":"- ") + (t.ft?"PRIORITY ":"- ") + "\n";
    for (var j=0; j<2; j++) {
      var i = "p"+j;
      s += "Player"+j+ lpad(tobin(t[i]),11) + lpad(tobin(t[i+'d']),11) + "\n";
    }
    s += "\n";
    // TODO? s += "    Color {color:0x" + hex(t.fc)  + "} {color:0x" + hex(t.fb) + "}\n";
    s += "          Count Scan Speed\n";
    for (var j=0; j<2; j++) {
      var i = "p"+j;
      s += "Player"+j+ lpad(t[i+'co'],8) + lpad(nonegstr(t[i+'sc']),5) + lpad(t[i+'ss'],6);
      s += " " + (t[i+'rr']?"RESET":"") + " " + (t[i+'v']?"DELAY":"") + " " + (t[i+'cc']?"CLOSECOPY":"") + " " + (t[i+'mc']?"MEDCOPY":"") + " " + (t[i+'wc']?"WIDECOPY":"") + " " + (t[i+'r']?"REFLECT":"") + "\n";
    }
    for (var j=0; j<2; j++) {
      var i = "m"+j;
      s += "Missile"+j+ lpad(t[i+'co'],7) + lpad(nonegstr(t[i+'sc']),5) + lpad(t[i+'ss'],6);
      s += " " + (t[i+'rr']?"RESET":"") + " " + (t[i+'r']?"RESET2PLAYER":"") + "\n";
    }
    s += "Ball"+ lpad(t['bco'],11) + lpad(nonegstr(t['bsc']),5) + lpad(t['bss'],6) + "\n";
    return s;
  }

  disassemble(pc:number, read:(addr:number)=>number) : DisasmLine {
    return disassemble6502(pc, read(pc), read(pc+1), read(pc+2));
  }

  showHelp() {
    return "https://8bitworkshop.com/docs/platforms/vcs/";
  }

  getMemoryMap = function() { return {main:[
      {name:'TIA Registers',start:0x00,size:0x80,type:'io'},
      {name:'PIA RAM',start:0x80,size:0x80,type:'ram'},
      {name:'PIA Ports and Timer',start:0x280,size:0x18,type:'io'},
      {name:'Cartridge ROM',start:0xf000,size:0x1000-6,type:'rom'},
      {name:'CPU Vectors',start:0xfffa,size:0x6,type:'rom'},
  ]}};

  // probing
  nullProbe = new NullProbe();
  probe : ProbeAll = this.nullProbe;

  startProbing?() : ProbeRecorder {
    var self : VCSPlatform = this;
    var rec = new ProbeRecorder(this);
    this.connectProbe(rec);
    var probe = this.probe;
    // intercept CPU clock pulse
    var cpu = Javatari.room.console.cpu;
    if (cpu.oldCPUClockPulse == null) {
      cpu.oldCPUClockPulse = cpu.clockPulse;
      cpu.clockPulse = function() {
        if (cpu.isPCStable())
          probe.logExecute(cpu.getPC(), cpu.getSP());
        this.oldCPUClockPulse();
        probe.logClocks(1);
      }
    }
    // intercept bus read/write
    var bus = Javatari.room.console.bus;
    if (bus.oldRead == null) {
      bus.oldRead = bus.read;
      bus.read = function(a) {
        var v = this.oldRead(a);
        if (a > 0 && a < 0x80) probe.logIORead(a,v); // (00),x reads $00?
        else if (a > 0x280 && a < 0x300) probe.logIORead(a,v);
        else probe.logRead(a,v);
        return v;
      }
      bus.oldWrite = bus.write;
      bus.write = function(a,v) {
        this.oldWrite(a,v);
        if (a == 0x02) probe.logWait(a); // WSYNC
        else if (a < 0x80) probe.logIOWrite(a,v);
        else if (a > 0x280 && a < 0x300) probe.logIOWrite(a,v);
        else probe.logWrite(a,v);
      }
    }
    return rec;
  }
  stopProbing?() : void {
    this.connectProbe(null);
    var cpu = Javatari.room.console.cpu;
    if (cpu.oldCPUClockPulse != null) {
      cpu.clockPulse = cpu.oldCPUClockPulse;
      cpu.oldCPUClockPulse = null;
    }
    var bus = Javatari.room.console.bus;
    if (bus.oldRead) {
      bus.read = bus.oldRead;
      bus.oldRead = null;
    }
    if (bus.oldWrite) {
      bus.write = bus.oldWrite;
      bus.oldWrite = null;
    }
  }
  connectProbe(probe:ProbeAll) {
    this.probe = probe || this.nullProbe;
  }

  // resizing
  resize() {
    const emulator = document.getElementById('emulator');
    const jadiv = document.getElementById('javatari-div');
    if (!emulator || !jadiv) return;
    var scale = Math.min(1, (emulator.clientWidth - 24) / 640);
    var xt = (1 - scale) * 50;
    jadiv.style.transform = `translateX(-${xt}%) translateY(-${xt}%) scale(${scale})`;
  }
  updateVideoDebugger() {
    const {x,y} = this.getRasterCanvasPosition();
    if (x >= 0 || y >= 0) {
      const ctx = this.canvas?.getContext('2d');
      if (ctx) {
        drawCrosshair(ctx, x, y, 2);
      }
    }
  }
};

// TODO: mixin for Base6502Platform?

function nonegstr(n) {
  return n < 0 ? "-" : n.toString();
}

///////////////

class VCSMAMEPlatform extends BaseMAME6502Platform implements Platform {

//  MCFG_SCREEN_RAW_PARAMS( MASTER_CLOCK_NTSC, 228, 26, 26 + 160 + 16, 262, 24 , 24 + 192 + 31 )

  start = function() {
    this.startModule(this.mainElement, {
      jsfile:'mame8bitws.js',
      driver:'a2600',
      width:176*2,
      height:223,
      romfn:'/emulator/cart.rom',
      romsize:0x1000,
    });
  }

  loadROM = function(title, data) {
    this.loadROMFile(data);
    this.loadRegion(":cartslot:cart:rom", data);
  }

  getPresets = function() { return VCS_PRESETS; }

  getToolForFilename = getToolForFilename_vcs;
  getDefaultExtensions() { return [".c", ".bb", ".acme", ".xa", ".ca65", ".dasm", ".cc2600", ".ecs", ".wiz"]; }
  getROMExtension() { return ".a26"; }

  getOriginPC = function() {
    return (this.readAddress(0xfffc) | (this.readAddress(0xfffd) << 8)) & 0xffff;
  }
  
}

////////////////

class VCSStellaPlatform implements Platform {

  mainElement: HTMLElement;
  Stellerator;
  stellerator;
  running: boolean = false;

  constructor(mainElement: HTMLElement) {
    this.mainElement = mainElement;
  }
  async start() {
    await loadScript('lib/stellerator/stellerator-embedded.min.js');
    const $6502 : any = window['$6502'];
    this.Stellerator = $6502.Stellerator;
    // create a canvas, stellerator will override width/height but we need CSS aspect ratio
    const canvas = __createCanvas(window.document, this.mainElement, 28, 20);
    // stellerator adds overscan, we don't need as much
    canvas.style.padding = '10px';
    this.stellerator = new this.Stellerator(canvas, 'lib/stellerator/stellerator.min.js',
      {
          gamma: 0.8,
          scalingMode: this.Stellerator.ScalingMode.qis,
          tvEmulation: this.Stellerator.TvEmulation.composite,
          phosphorLevel: 0.25,
          scanlineLevel: 0.2,
          keyboardTarget: this.mainElement
      }
    );
  }
  loadROM(title, data) {
    this.stellerator.run(data, this.Stellerator.TvMode.ntsc);
  }
  reset() {
    this.stellerator.reset();
  }
  pause() {
    this.running = false;
    this.stellerator.pause();
  }
  resume() {
    this.running = true;
    this.stellerator.resume();
  }
  isRunning() {
    return this.running;
  }
  getToolForFilename = getToolForFilename_vcs;
  getDefaultExtensions() { return [".c", ".bb", ".acme", ".xa", ".ca65", ".dasm", ".cc2600", ".ecs", ".wiz"]; }
  getROMExtension() { return ".a26"; }
  getPresets() { return VCS_PRESETS }
}

////////////////

// the ROM itself, and the cartridge format properties that never change
const CART_CONTENT_KEYS = 'f r b ra e rnd'.split(' ');
const CART_STATIC_KEYS = 'bb es tb sm m fo s sa'.split(' ');
const CART_BANK_LABELS: { [k: string]: string } = {
  bo: 'BankOffset', s0: 'Slice0', s1: 'Slice1', s2: 'Slice2',
  b0o: 'Bank0Offset', b1o: 'Bank1Offset',
};

/**
 * The headless Javatari core (src/machine/vcs.ts) as a Platform, registered
 * as "vcs.jt4" so it runs beside VCSPlatform, which still drives the Javatari
 * room UI. The two share presets, tools and the memory map, and differ only in
 * the core underneath.
 *
 * Because this one is built on a Machine, EmuCore drives it with MachineCore:
 * it stops mid-frame and mid-instruction, and it can rewind, which is what
 * the room UI could not do.
 */
class VCSMachinePlatform extends Base6502MachinePlatform<JavatariMachine> {

  newMachine() { return new JavatariMachine(); }
  getPresets() { return VCS_PRESETS; }

  // Javatari's 6502 saves its PC one past the opcode it has fetched, though
  // its getPC() returns the opcode's address
  debugPCDelta = -1;

  /**
   * A 2600 takes joysticks or paddles in the same ports, and the core reads the
   * paddle triggers as the joystick directions, so the paddles stay off until
   * this is set. See JavatariMachine.setPaddlesConnected.
   */
  paddles = false;
  pollControls() {
    this.machine.setPaddlesConnected(this.paddles);
    super.pollControls();
  }

  getToolForFilename = getToolForFilename_vcs;
  getDefaultExtensions() { return [".c", ".bb", ".acme", ".xa", ".ca65", ".dasm", ".cc2600", ".ecs", ".wiz"]; }
  getROMExtension() { return ".a26"; }

  // readConst() has no side effects: it skips the TIA and PIA registers and
  // undoes a bank switch, so reading memory for a view cannot change the run
  readAddress(addr: number) { return this.machine.readConst(addr); }
  writeAddress(addr: number, value: number) { this.machine.write(addr, value); }

  getOriginPC() {
    return (this.machine.readConst(0xfffc) | (this.machine.readConst(0xfffd) << 8)) & 0xffff;
  }
  newCodeAnalyzer() { return new CodeAnalyzer_vcs(this); }
  showHelp() { return "https://8bitworkshop.com/docs/platforms/vcs/"; }

  getDebugCategories() { return ['CPU', 'Stack', 'PIA RAM', 'PIA', 'TIA']; }
  getDebugInfo(category, state) {
    switch (category) {
      case 'CPU':     return this.cpuStateToLongString(state.c) + this.bankSwitchStateToString(state);
      case 'Stack':   return dumpStackToString(this, this.getRAMForState(state), 0x100, 0x1ff, 0x100 + state.c.SP, 0x20);
      case 'PIA RAM': return this.ramStateToLongString(state);
      case 'PIA':     return this.piaStateToLongString(state.p);
      case 'TIA':     return this.tiaStateToLongString(state);
    }
  }
  cpuStateToLongString(c) { return cpuStateToLongString_6502(c); }
  bankSwitchStateToString(state) {
    const ca = state.ca;
    if (!ca) return '';
    // The cartridge formats keep their live bank selection under different
    // keys, and ro/rs mean something different in each of them, so the ones
    // that are unambiguous get a name and the rest are shown as the core
    // spells them. The ROM contents and the fixed format properties are noise.
    let s = 'Cart ' + ca.f + '\n';
    for (const k of Object.keys(ca)) {
      if (CART_CONTENT_KEYS.indexOf(k) >= 0 || CART_STATIC_KEYS.indexOf(k) >= 0) continue;
      const v = ca[k];
      if (typeof v !== 'number') continue;  // e.g. the AR rom page offsets
      s += lpad(CART_BANK_LABELS[k] || k, 12) + ' ' + (v < 0 ? String(v) : '$' + hex(v, 4)) + '\n';
    }
    return s;
  }
  piaStateToLongString(p) {
    return "Timer  " + p.t + "/" + p.c + "\nINTIM  $" + hex(p.IT, 2) + " (" + p.IT + ")\nINSTAT $" + hex(p.IS, 2)
      + "\nSWCHA $" + hex(p.SA, 2) + "  SWCHB $" + hex(p.SB, 2) + "\n";
  }

  // The core's raw states are plain signed byte arrays, not base64 strings.
  // Mask to unsigned: toradix() would print a negative byte as "-1".
  getRAMForState(state) {
    const b = state.r?.b;
    if (!b) return new Uint8Array(0);
    return Uint8Array.from(b, (v: number) => v & 0xff);
  }
  ramStateToLongString(state) {
    return "\n" + dumpRAM(this.getRAMForState(state), 0x80, 0x80);
  }

  /**
   * The new TIA keeps per-object fields (p0e, p0lp, p0c, ...) and also saves
   * every register by name, so the registers are listed from whatever the
   * state happens to carry rather than from a hand-written list that the next
   * core change would invalidate.
   */
  tiaStateToLongString(state) {
    const t = state.t;
    let s = "H" + lpad(this.machine.getRasterX().toString(), 5)
      + "   V" + lpad(this.machine.getRasterY().toString(), 5) + "   "
      + (t.vs ? "VSYNC " : "- ") + (t.vb ? "VBLANK " : "- ") + "\n\n";
    // pfl is the 20-bit pattern ((PF2<<12)|(rev PF1<<4)|(PF0&f0)>>4); pfr
    // only differs from it while the playfield is reflected
    s += "Playfield " + lpad(tobin(t.pfl & 0xfffff), 21) + "\n";
    if ((t.pfr | 0) !== (t.pfl | 0)) s += "          " + lpad(tobin(t.pfr & 0xfffff), 21) + "\n";
    s += "          " + (t.pfe ? "ON " : "- ") + (t.pfrl ? "REFLECT " : "- ")
      + (t.pfsc ? "SCOREMODE " : "- ") + (t.pfp ? "PRIORITY " : "- ") + "\n";
    s += "\n          Graphics Copy\n";
    for (let j = 0; j < 2; j++) {
      const i = "p" + j;
      s += "Player" + j + lpad(tobin(t[i + "lp"]), 9) + lpad(tobin(t["GRP" + j + "d"]), 9) + "\n";
      s += "          NUSIZ " + t["NUSIZ" + j]
        + "  Alt " + t[i + "a"] + "/" + t[i + "af"] + "/" + t[i + "al"] + "/" + t[i + "ao"]
        + (t[i + "e"] ? "  ON" : "") + "\n";
    }
    s += "\n";
    for (let j = 0; j < 2; j++) {
      const i = "m" + j;
      s += "Missile" + j + lpad(t[i + "e"] ? "ON" : "-", 3) + lpad(tobin(t[i + "lp"]), 9)
        + "   HMP" + hex(t["HMP" + j] & 0xff, 2) + (t["HMM" + j] ? "  HM" : "") + "\n";
    }
    s += "Ball" + lpad(t.be ? "ON" : "-", 6) + lpad(tobin(t.bx), 9) + "\n";
    const regs = Object.keys(t).filter((k) => /^[A-Z][A-Z0-9]*d?$/.test(k) && typeof t[k] == "number");
    if (regs.length) {
      s += "\nRegisters\n";
      regs.forEach((k, i) => {
        s += lpad(k, 7) + hex(t[k] & 0xff, 2);
        if (i % 4 == 3) s += "\n";
      });
      if (regs.length % 4) s += "\n";
    }
    return s;
  }

  getMemoryMap = function() { return {main:[
      {name:'TIA Registers',start:0x00,size:0x80,type:'io'},
      {name:'PIA RAM',start:0x80,size:0x80,type:'ram'},
      {name:'PIA Ports and Timer',start:0x280,size:0x18,type:'io'},
      {name:'Cartridge ROM',start:0xf000,size:0x1000-6,type:'rom'},
      {name:'CPU Vectors',start:0xfffa,size:0x6,type:'rom'},
  ]}};
}

////////////////

PLATFORMS['vcs'] = VCSPlatform;
PLATFORMS['vcs.jt4'] = VCSMachinePlatform;
PLATFORMS['vcs.mame'] = VCSMAMEPlatform;
PLATFORMS['vcs.stellerator'] = VCSStellaPlatform;
