
import { Platform, Base6502Platform, getOpcodeMetadata_6502, getToolForFilename_6502, Preset } from "../common/baseplatform";
import { getToolForFilename_nes } from "../common/toolselect";
import { PLATFORMS, setKeyboardFromMap, AnimationTimer, RasterVideo, Keys, makeKeycodeMap, KeyFlags, EmuHalt, ControllerPoller } from "../common/emu";
import { hex, byteArrayToString, replaceAll } from "../common/util";
import { CodeAnalyzer_nes } from "../common/analysis";
import { SampleAudio } from "../common/audio";
import { ProbeRecorder } from "../common/probe";
import { NullProbe, Probeable, ProbeAll, TrapCondition } from "../common/devices";
// jsnes is an ES module; load its emulator core, not its browser front end
const JSNES_NES = require('../../jsnes/src/nes.js').default;

// Lazy mousetrap require: mousetrap references `document` at module load time,
// which crashes in Node-based tests (window is polyfilled, document is not).
function getMousetrap() {
    return require('mousetrap');
}
import { BaseMAME6502Platform } from "../common/mameplatform";

const JSNES_PRESETS : Preset[] = [
  {id:'hello.c', name:'Hello World'},
  {id:'attributes.c', name:'Attribute Table'},
  {id:'scroll.c', name:'Scrolling'},
  {id:'sprites.c', name:'Sprites'},
  {id:'metasprites.c', name:'Metasprites'},
  {id:'flicker.c', name:'Flickering Sprites'},
  {id:'metacursor.c', name:'Controllers'},
  {id:'vrambuffer.c', name:'VRAM Buffer'},
  {id:'statusbar.c', name:'Split Status Bar'},
  {id:'siegegame.c', name:'Siege Game'},
  {id:'tint.c', name:'Color Emphasis'},
  {id:'rletitle.c', name:'Title Screen RLE'},
  {id:'aputest.c', name:'Sound Tester'},
  {id:'music.c', name:'Music Player'},
  {id:'horizscroll.c', name:'Offscreen Scrolling'},
  {id:'monobitmap.c', name:'Monochrome Bitmap'},
  {id:'fami.c', name:'Famitone Demo'},
  {id:'shoot2.c', name:'Solarian Game'},
  {id:'climber.c', name:'Climber Game'},
  {id:'bankswitch.c', name:'Bank Switching'},
  {id:'irq.c', name:'IRQ Scanline Counter'},
  {id:'ex0.dasm', name:'Initialization', category:'Assembly'},
  {id:'ex1.dasm', name:'Hello World'},
  {id:'ex2.dasm', name:'Scrolling Demo'},
  {id:'ex3.dasm', name:'Sprite Demo'},
  {id:'ex4.dasm', name:'Controller Demo'},
  {id:'musicdemo.dasm', name:'Famitone Demo'},
  {id:'xyscroll.dasm', name:'XY Split Scrolling'},
//  {id:'scrollrt.dasm', name:'Line-by-line Scrolling'},
  {id:'road.dasm', name:'3-D Road Demo'},
  {id:'hello.cpp', name:'Hello Oscar64', category:'Oscar64'},
  {id:'chase/game.c', name:'Shiru\'s Chase Game', category:'Other'},
  {id:'hello.wiz', name:'Hello (Wiz)'},
  {id:'hello.bas', name:'Hello World (CVBasic)', category:'CVBasic'},
  {id:'happy_face.bas', name:'Bouncing Face (CVBasic)', category:'CVBasic'},
];

/// JSNES

const JSNES_KEYCODE_MAP = makeKeycodeMap([
  [Keys.A,        0, 0],
  [Keys.B,        0, 1],
  [Keys.GP_A,     0, 0],
  [Keys.GP_B,     0, 1],
  [Keys.SELECT,   0, 2],
  [Keys.START,    0, 3],
  [Keys.UP,       0, 4],
  [Keys.DOWN,     0, 5],
  [Keys.LEFT,     0, 6],
  [Keys.RIGHT,    0, 7],
  
  [Keys.P2_A,      1, 0],
  [Keys.P2_B,      1, 1],
  [Keys.P2_SELECT, 1, 2],
  [Keys.P2_START,  1, 3],
  [Keys.P2_UP,     1, 4],
  [Keys.P2_DOWN,   1, 5],
  [Keys.P2_LEFT,   1, 6],
  [Keys.P2_RIGHT,  1, 7],
]);

/** Replace every typed array in `o` with a copy, breaking aliasing. */
/**
 * The JSNES core seen as a Machine, so the headless debugger (EmuCore,
 * MachineCore) can stop between instructions and step. JSNES runs whole
 * instructions, so every stop is stable.
 */
class JSNESMachine {
  cpuCyclesPerLine = 114; // width of the probe scope
  cpu = {
    getPC: () => this.p.getPC(),
    getSP: () => this.p.getSP(),
    isStable: () => true,
  };

  constructor(readonly p: JSNESPlatform) { }

  advanceFrame(trap: TrapCondition): number {
    var steps = 0;
    // frame() asks the trap before each instruction, so count those
    this.p.nes.frame(() => {
      if (trap && trap()) return true;
      steps++;
      return false;
    });
    return steps;
  }
  saveState() { return this.p.saveState(); }
  loadState(s) { this.p.loadState(s); }
  read(a: number) { return this.p.readAddress(a); }
  readConst(a: number) { return this.p.readAddress(a); }
  // for the debugger: RAM, or the mapper, without cpu.write()'s bus cycle
  write(a: number, v: number) {
    if (a < 0x2000) this.p.nes.cpu.mem[a & 0x7ff] = v;
    else this.p.nes.mmap.write(a, v);
  }
  connectProbe(probe: ProbeAll) { this.p.connectProbe(probe); }
}

class JSNESPlatform extends Base6502Platform implements Platform, Probeable {

  mainElement : HTMLElement;
  nes;
  video: RasterVideo;
  audio;
  timer: AnimationTimer;
  poller : ControllerPoller;
  audioFrequency = 44030; //44100
  frameindex = 0;
  ntvideo: RasterVideo;
  ntlastbuf: Uint32Array;
  showDebugView = false;
  
  machine = new JSNESMachine(this);
  
  constructor(mainElement) {
    super();
    this.mainElement = mainElement;
  }

  getPresets() { return JSNES_PRESETS; }

  start() {
    this.debugPCDelta = 1;
    this.audio = new SampleAudio(this.audioFrequency);
    this.video = new RasterVideo(this.mainElement,256,224,{overscan:true});
    this.video.create();
    // debugging view
    this.ntvideo = new RasterVideo(this.mainElement,512,480,{overscan:false});
    this.ntvideo.create();
    this.ntvideo.canvas.style.display = 'none';
    this.ntlastbuf = new Uint32Array(0x1000);
    if (getMousetrap().bind) getMousetrap().bind('ctrl+shift+alt+n', () => {
      this.showDebugView = !this.showDebugView;
      this.video.canvas.style.display = !this.showDebugView ? '' : 'none';
      this.ntvideo.canvas.style.display = this.showDebugView ? '' : 'none';
    });
    // toggle buttons (TODO)
    /*
    var debugbar = $("<div>").appendTo(this.mainElement);
    $('<button>').text("Video").appendTo(debugbar).click(() => { $(this.video.canvas).toggle() });
    $('<button>').text("Nametable").appendTo(debugbar).click(() => { $(this.ntvideo.canvas).toggle() });
    */
    var idata = this.video.getFrameData();
    this.nes = new JSNES_NES({
      onFrame: (frameBuffer : number[]) => {
        for (var i=0; i<frameBuffer.length; i++)
          idata[i] = frameBuffer[i] | 0xff000000;
        this.video.updateFrame();
        this.frameindex++;
        this.updateDebugViews();
      },
      onAudioSample: (left:number, right:number) => {
        if (this.frameindex < 10)
          this.audio.feedSample(0, 1); // avoid popping at powerup
        else
          this.audio.feedSample((left+right)*0.5, 1);
      },
      onStatusUpdate: function(s) {
        console.log(s);
      },
      sampleRate: this.audioFrequency, // must match SampleAudio's rate
      //TODO: onBatteryRamWrite
    });
    //this.nes.ppu.showSpr0Hit = true;
    //this.nes.ppu.clipToTvSize = false;
    this.timer = new AnimationTimer(60, this.nextFrame.bind(this));
    // set keyboard map
    this.poller = setKeyboardFromMap(this.video, [], JSNES_KEYCODE_MAP, (o,key,code,flags) => {
      if (flags & KeyFlags.KeyDown)
        this.nes.buttonDown(o.index+1, o.mask); // controller, button
      else if (flags & KeyFlags.KeyUp)
        this.nes.buttonUp(o.index+1, o.mask); // controller, button
    });
    //var s = ''; nes.ppu.palTable.curTable.forEach((rgb) => { s += "0x"+hex(rgb,6)+", "; }); console.log(s);
  }
  
  pollControls() { this.poller.poll(); }

  advance(novideo : boolean) : number {
    this.nes.frame();
    return 29780; //TODO: PAL or NTSC?
  }

  updateDebugViews() {
   // don't update if view is hidden
   if (!this.showDebugView)
     return;
   var a = 0;
   var attraddr = 0;
   var idata = this.ntvideo.getFrameData();
   var baseTile = this.nes.ppu.regS === 0 ? 0 : 256;
   for (var row=0; row<60; row++) {
     for (var col=0; col<64; col++) {
       a = 0x2000 + (col&31) + ((row%30)*32);
       if (col >= 32) a += 0x400;
       if (row >= 30) a += 0x800;
       var name = this.nes.ppu.mirroredLoad(a) + baseTile;
       var t = this.nes.ppu.ptTile[name];
       attraddr = (a & 0x2c00) | 0x3c0 | (a & 0x0C00) | ((a >> 4) & 0x38) | ((a >> 2) & 0x07);
       var attr = this.nes.ppu.mirroredLoad(attraddr);
       var tag = name ^ (attr<<9) ^ 0x80000000;
       if (tag != this.ntlastbuf[a & 0xfff]) {
         this.ntlastbuf[a & 0xfff] = tag;
         var i = row*64*8*8 + col*8;
         var j = 0;
         var attrshift = (col&2) + ((a&0x40)>>4);
         var coloradd = ((attr >> attrshift) & 3) << 2;
         for (var y=0; y<8; y++) {
           for (var x=0; x<8; x++) {
             var color = t.pix[j++];
             if (color) color += coloradd;
             var rgb = this.nes.ppu.imgPalette[color];
             idata[i++] = rgb | 0xff000000;
           }
           i += 64*8-8;
         }
       }
     }
   }
   this.ntvideo.updateFrame();
  }

  loadROM(title, data) {
    var romstr = byteArrayToString(data);
    this.nes.loadROM(romstr);
    this.frameindex = 0;
    this.installIntercepts();
  }
  // nes.fromJSON() replaces the CPU, PPU and mapper, so this runs after every
  // load as well as after loadROM()
  installIntercepts() {
    // insert debug hook
    var cpu = this.nes.cpu;
    if (!cpu.haveProxied) {
      var old_emulate = cpu.emulate.bind(cpu);
      cpu.emulate = () => {
        if (cpu.irqRequested) this.probe.logInterrupt(cpu.irqType || 0);
        this.probe.logExecute(cpu.REG_PC+1, cpu.REG_SP);
        var cycles;
        try {
          cycles = old_emulate();
        } catch (e) {
          // jsnes throws on an invalid opcode
          if (e instanceof EmuHalt) throw e;
          this.haltAndCatchFire(e.message || "Illegal instruction");
          throw new EmuHalt("CPU STOPPED");
        }
        this.evalDebugCondition();
        this.probe.logClocks(cycles);
        return cycles > 0 ? cycles : 1;
      }
      // NMI fires at the end of emulate(), so log it there; the next execute is the handler
      var old_nmi = cpu.doNonMaskableInterrupt.bind(cpu);
      cpu.doNonMaskableInterrupt = (status) => {
        this.probe.logInterrupt(1);
        return old_nmi(status);
      }
      cpu.haveProxied = true;
    }
    // intercept bus calls, unless we did it already
    var mmap = this.nes.mmap;
    if (!mmap.haveProxied) {
      var oldload = mmap.load.bind(mmap);
      var oldwrite = mmap.write.bind(mmap);
      var oldregLoad = mmap.regLoad.bind(mmap);
      var oldregWrite = mmap.regWrite.bind(mmap);
      var lastioaddr = -1;
      mmap.load = (addr) => {
        var val = oldload(addr);
        if (addr != lastioaddr) this.probe.logRead(addr, val);
        return val;
      }
      mmap.write = (addr, val) => {
        if (addr != lastioaddr) this.probe.logWrite(addr, val);
        oldwrite(addr, val);
      }
      // try not to read/write then IOread/IOwrite at same time
      mmap.regLoad = (addr) => {
        var val = oldregLoad(addr);
        this.probe.logIORead(addr, val);
        lastioaddr = addr;
        return val;
      }
      mmap.regWrite = (addr, val) => {
        this.probe.logIOWrite(addr, val);
        lastioaddr = addr;
        oldregWrite(addr, val);
      }
      mmap.haveProxied = true;
    }
    var ppu = this.nes.ppu;
    if (!ppu.haveProxied) {
      var old_endScanline = ppu.endScanline.bind(ppu);
      var old_startFrame = ppu.startFrame.bind(ppu);
      var old_writeMem = ppu.writeMem.bind(ppu);
      ppu.endScanline = () => {
        old_endScanline();
        this.probe.logNewScanline();
      }
      ppu.startFrame = () => {
        old_startFrame();
        this.probe.logNewFrame();
      }
      ppu.writeMem = (a,v) => {
        old_writeMem(a,v);
        this.probe.logVRAMWrite(a,v);
      }
      ppu.haveProxied = true;
    }
  }
  newCodeAnalyzer() {
    return new CodeAnalyzer_nes(this);
  }
  getOriginPC() {	// TODO: is actually NMI
    return (this.readAddress(0xfffa) | (this.readAddress(0xfffb) << 8)) & 0xffff;
  }
  getDefaultExtensions() { return [...super.getDefaultExtensions(), ".nesasm", ".bas"]; }

  getROMExtension() { return ".nes"; }

  reset() {
    //this.nes.cpu.reset(); // doesn't work right, crashes
    this.nes.crashed = false; // jsnes won't run after an invalid opcode until this is cleared
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
    this.installIntercepts();
  }
  isRunning() {
    return this.timer.isRunning();
  }
  pause() {
    this.timer.stop();
    this.audio.stop();
  }
  resume() {
    this.timer.start();
    this.audio.start();
  }

  runToVsync() {
    var frame0 = this.frameindex;
    this.runEval((c) => { return this.frameindex>frame0; });
  }

  getRasterScanline() : number {
    return this.nes.ppu.scanline;
  }
  getRasterLineClock() : number {
    return this.nes.ppu.curX;
  }

  // the debugger asks for these before every instruction; skip toJSON()
  getPC() { return (this.nes.cpu.REG_PC + this.debugPCDelta) & 0xffff; }
  getSP() { return this.nes.cpu.REG_SP & 0xff; }
  isStable() { return true; }

  getCPUState() {
    var c = this.nes.cpu.toJSON();
    this.copy6502REGvars(c);
    return c;
  }
  // TODO don't need to save ROM?
  saveState() {
    //var s = $.extend(true, {}, this.nes);
    var s;
    if (this.nes.mmap) {
      s = this.nes.toJSON();
    } else {
      console.log("no nes.mmap!");
      s = { cpu: this.nes.cpu.toJSON(), ppu: this.nes.ppu.toJSON() };
    }
    s.c = s.cpu;
    this.copy6502REGvars(s.c);
    // our jsnes fork's toJSON() copies every array, so the state doesn't
    // change as the emulator runs on
    s.b = s.cpu.mem;
    s.ctrl = this.saveControlsState();
    return s;
  }
  loadState(state) {
    this.unfixPC(state.cpu);
    this.nes.fromJSON(state);
    this.fixPC(state.cpu);
    //this.nes.cpu.fromJSON(state.cpu);
    //this.nes.mmap.fromJSON(state.mmap);
    //this.nes.ppu.fromJSON(state.ppu);
    // fromJSON() copies arrays in, so nothing here aliases the state
    this.loadControlsState(state.ctrl);
    //$.extend(this.nes, state);
    this.installIntercepts();
  }
  saveControlsState() {
    return {
      c1: this.nes.controllers[1].state.slice(0),
      c2: this.nes.controllers[2].state.slice(0),
    };
  }
  loadControlsState(state) {
    // copy, or later button presses would change the saved state
    this.nes.controllers[1].state = state.c1.slice(0);
    this.nes.controllers[2].state = state.c2.slice(0);
  }
  readAddress(addr) {
    return this.nes.cpu.mem[addr];
  }
  readVRAMAddress(addr : number) : number {
    return this.nes.ppu.vramMem[addr];
  }
  copy6502REGvars(c) {
    c.T = 0;
    c.PC = c.REG_PC;
    this.fixPC(c);
    c.A = c.REG_ACC;
    c.X = c.REG_X;
    c.Y = c.REG_Y;
    c.SP = c.REG_SP & 0xff;
    c.Z = c.F_ZERO;
    c.N = c.F_SIGN;
    c.V = c.F_OVERFLOW;
    c.D = c.F_DECIMAL;
    c.C = c.F_CARRY;
    c.I = c.F_INTERRUPT;
    c.R = 1;
    c.o = this.readAddress(c.PC+1);
    return c;
  }

  getDebugCategories() {
    return super.getDebugCategories().concat(['PPU','Mapper']);
  }
  getDebugInfo(category, state) {
    switch (category) {
      case 'PPU': return this.ppuStateToLongString(state.ppu, state.b);
      case 'Mapper': return this.mapperStateToLongString(state.mmap, state.b);
      default: return super.getDebugInfo(category, state);
    }
  }
  ppuStateToLongString(ppu, mem) {
    var s = '';
    var PPUFLAGS = [
      ["f_nmiOnVblank","NMI_ON_VBLANK"],
      ["f_spVisibility","SPRITES"],
      ["f_spClipping","NO_CLIP_SPRITES"],
      ["f_dispType","MONOCHROME"],
      ["f_bgVisibility","BACKGROUND"],
      ["f_bgClipping","NO_CLIP_BACKGROUND"],
    ];
    for (var i=0; i<PPUFLAGS.length; i++) {
      var flag = PPUFLAGS[i];
      s += (ppu[flag[0]] ? flag[1] : "-") + " ";
      if (i==2 || i==5) s += "\n";
    }
    var status = mem[0x2002];
    s += "\n Status ";
    s += (status & 0x80) ? "VBLANK " : "- ";
    s += (status & 0x40) ? "SPRITE0HIT " : "- ";
    s += "\n";
    if (ppu.f_color)
      s += "   Tint " + ((ppu.f_color&1)?"RED ":"") + ((ppu.f_color&2)?"BLUE ":"") + ((ppu.f_color&4)?"GREEN ":"") + "\n";
    if (ppu.f_spVisibility) {
      s += "SprSize " + (ppu.f_spriteSize ? "8x16" : "8x8") + "\n";
      s += "SprBase $" + (ppu.f_spPatternTable ? "1000" : "0000") + "\n";
    }
    if (ppu.f_bgVisibility) {
      s += " BgBase $" + (ppu.f_bgPatternTable ? "1000" : "0000") + "\n";
      s += " NTBase $" + hex(ppu.f_nTblAddress*0x400+0x2000) + "\n";
      s += "AddrInc " + (ppu.f_addrInc ? "32" : "1") + "\n";
    }
    var scrollX = ppu.regFH + ppu.regHT*8;
    var scrollY = ppu.regFV + ppu.regVT*8;
    s += "ScrollX $" + hex(scrollX) + " (" + ppu.regHT + " * 8 + " + ppu.regFH + " = " + scrollX + ")\n";
    s += "ScrollY $" + hex(scrollY) + " (" + ppu.regVT + " * 8 + " + ppu.regFV + " = " + scrollY + ")\n";
    s += "\n";
    s += "   Scan Y: " + ppu.scanline + "  X: " + ppu.curX + "\n";
    s += "VramCur" + (ppu.firstWrite?" ":"?") + "$" + hex(ppu.vramAddress,4) + "\n";
    s += "VramTmp $" + hex(ppu.vramTmpAddress,4) + "\n";
    /*
    var PPUREGS = [
      'cntFV',
      'cntV',
      'cntH',
      'cntVT',
      'cntHT',
      'regV',
      'regH',
      'regS',
    ];
    s += "\n";
    for (var i=0; i<PPUREGS.length; i++) {
      var reg = PPUREGS[i];
      s += lpad(reg.toUpperCase(),7) + " $" + hex(ppu[reg]) + " (" + ppu[reg] + ")\n";
    }
    */
    return s;
  }
  mapperStateToLongString(mmap, mem) {
    //console.log(mmap, mem);
    var s = "";
    if (this.nes.rom) {
      s += "Mapper " + this.nes.rom.mapperType + "\n";
    }
    if (mmap.irqCounter !== undefined) {
      s += "\nIRQ Counter: " + mmap.irqCounter;
      s += "\n  IRQ Latch: " + mmap.irqLatchValue;
      s += "\n IRQ Reload: " + mmap.irqReload;
      s += "\n IRQ Enable: " + mmap.irqEnable;
      s += "\n PRG Select: " + mmap.prgAddressSelect;
      s += "\n CHR Select: " + mmap.chrAddressSelect;
    }
    s += "\n";
    return s;
  }
  getToolForFilename = getToolForFilename_nes;
  
  // probing
  nullProbe = new NullProbe();
  probe : ProbeAll = this.nullProbe;

  startProbing?() : ProbeRecorder {
    var rec = new ProbeRecorder(this);
    this.connectProbe(rec);
    return rec;
  }
  stopProbing?() : void {
    this.connectProbe(null);
  }
  connectProbe(probe:ProbeAll) {
    this.probe = probe || this.nullProbe;
  }

  getMemoryMap = function() { return { main:[
      {name:'Zero Page RAM',start:0x0,size:0x100,type:'ram'},
      {name:'OAM Buffer',start:0x200,size:0x100,type:'ram'},
      {name:'Work RAM',start:0x300,size:0x1000-0x300,type:'ram'},
      {name:'PPU Registers',start:0x2000,last:0x2008,size:0x2000,type:'io'},
      {name:'APU Registers',start:0x4000,last:0x4020,size:0x2000,type:'io'},
      {name:'Optional Cartridge RAM',start:0x6000,size:0x2000,type:'ram'},
  ] } };

  showHelp() {
    return "https://8bitworkshop.com/docs/platforms/nes/";
  }

  getDebugSymbolFile() {
    var sym = this.debugSymbols.addr2symbol;
    var text = "";
    for (let [k, v] of Object.entries(sym)) {
      let numK = Number(k);
      let symType;
      if (numK < 0x2000) {
        numK = numK % 0x800;
        symType = "R";
      } else if (numK < 0x6000) symType = "G";
      else if (numK < 0x8000) {
        numK = numK - 0x6000;
        symType = "S";
      } else {
        numK = numK - 0x8000;
        symType = "P";
      }
      let addr = numK.toString(16).padStart(4, '0').toUpperCase();
      // Mesen doesn't allow lables to start with digits
      if ((v as string)[0] >= '0' && (v as string)[0] <= '9') {
        v = "L" + v;
      }
      // nor does it allow dots
      v = replaceAll(v, '.', '_');
      text += `${symType}:${addr}:${v}\n`;
    }
    return {
      extension:".mlb", 
      blob: new Blob([text], {type:"text/plain"})
    };
  }
}

/// MAME support

class NESMAMEPlatform extends BaseMAME6502Platform implements Platform {

  start() {
  }

  loadROM(title, data) {
    if (!this.started) {
      this.startModule(this.mainElement, {
        jsfile:'mame8bitws.js',
        //cfgfile:'nes.cfg',
        driver:'nes',
        width:256,
        height:240,
        romfn:'/emulator/cart.nes',
        romdata:new Uint8Array(data),
        preInit:function(_self) {
        },
      });
    } else {
      // look at iNES header for PRG and CHR ROM lengths
      var prgromlen = data[4] * 0x4000;
      var chrromlen = data[5] * 0x2000;
      this.loadROMFile(data);
      this.loadRegion(":nes_slot:cart:prg_rom", data.slice(0x10, 0x10+prgromlen));
      this.loadRegion(":nes_slot:cart:chr_rom", data.slice(0x10+prgromlen, 0x10+prgromlen+chrromlen));
    }
  }

  getPresets() { return JSNES_PRESETS; }
  getToolForFilename = getToolForFilename_nes;
  getOpcodeMetadata = getOpcodeMetadata_6502;
  getDefaultExtensions() { return [".c", ".cpp", ".acme", ".xa", ".ca65", ".dasm", ".ecs", ".wiz", ".bas"]; }

}

///

PLATFORMS['nes'] = JSNESPlatform;
PLATFORMS['nes.mame'] = NESMAMEPlatform;

