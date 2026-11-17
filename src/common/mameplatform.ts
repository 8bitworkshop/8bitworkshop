
/// MAME SUPPORT

import { DisasmLine, EmuState, cpuStateToLongString_6502, cpuStateToLongString_Z80 } from "./baseplatform";
import { disassemble6502, disassemble65C02 } from "./cpu/disasm6502";
import { disassembleZ80 } from "./cpu/disasmz80";
import { AnimationTimer, RAM, RasterVideo } from "./emu";

declare var FS, ENV, Module; // mame emscripten

export abstract class BaseMAMEPlatform {

  loaded: boolean = false;
  preinitted: boolean = false;
  started: boolean = false;
  romfn: string;
  romdata: Uint8Array;
  romtype: string = 'cart';
  video;
  running = false;
  initluavars: boolean = false;
  luadebugscript: string;
  js_lua_string;
  onBreakpointHit;
  mainElement: HTMLElement;
  timer: AnimationTimer;

  constructor(mainElement) {
    this.mainElement = mainElement;
    this.timer = new AnimationTimer(20, this.poll.bind(this));
  }

  // http://docs.mamedev.org/techspecs/luaengine.html
  luacall(s: string): string {
    if (!this.js_lua_string) this.js_lua_string = Module.cwrap('_Z13js_lua_stringPKc', 'string', ['string']);
    return this.js_lua_string(s || "");
  }

  _pause() {
    this.running = false;
    this.timer.stop();
  }
  pause() {
    if (this.loaded && this.running) {
      this.luacall('emu.pause()');
      this._pause();
    }
  }

  _resume() {
    this.luacall('emu.unpause()');
    this.running = true;
    this.timer.start();
  }
  resume() {
    if (this.loaded && !this.running) { // TODO
      this._resume();
    }
  }

  reset() {
    if (this.loaded) {
      this.luacall('manager:machine():soft_reset()');
      this.running = true;
      this.initluavars = false;
    }
  }

  isRunning() {
    return this.running;
  }

  bufferConsoleOutput(s) {
    if (typeof s !== 'string') return;
    console.log(s);
  }

  startModule(mainElement, opts) {
    this.started = true;
    var romfn = this.romfn = this.romfn || opts.romfn;
    var romdata = this.romdata = this.romdata || opts.romdata || new RAM(opts.romsize).mem;
    var romtype = this.romtype = this.romtype || opts.romtype;
    // create canvas
    var video = this.video = new RasterVideo(this.mainElement, opts.width, opts.height);
    video.create();
    $(video.canvas).attr('id', 'canvas');
    // load asm.js module
    console.log("loading", opts.jsfile);
    var modargs = [opts.driver,
      '-debug',
      '-debugger', 'none',
      '-verbose', '-window', '-nokeepaspect',
      '-resolution', video.canvas.width + 'x' + video.canvas.height
    ];
    if (romfn) {
      modargs.push('-' + romtype, romfn);
    }
    if (opts.extraargs) {
      modargs = modargs.concat(opts.extraargs);
    }
    console.log(modargs);
    window['JSMESS'] = {};
    window['Module'] = {
      arguments: modargs,
      screenIsReadOnly: true,
      print: this.bufferConsoleOutput,
      canvas: video.canvas,
      doNotCaptureKeyboard: true,
      keyboardListeningElement: video.canvas,
      preInit: () => {
        console.log("loading FS");
        ENV.SDL_EMSCRIPTEN_KEYBOARD_ELEMENT = 'canvas';
        if (opts.cfgfile) {
          FS.mkdir('/cfg');
          FS.writeFile('/cfg/' + opts.cfgfile, opts.cfgdata, { encoding: 'utf8' });
        }
        if (opts.biosfile) {
          FS.mkdir('/roms');
          FS.mkdir('/roms/' + opts.driver);
          FS.writeFile('/roms/' + opts.biosfile, opts.biosdata, { encoding: 'binary' });
        }
        FS.mkdir('/emulator');
        if (romfn) {
          FS.writeFile(romfn, romdata, { encoding: 'binary' });
        }
        //FS.writeFile('/debug.ini', 'debugger none\n', {encoding:'utf8'});
        if (opts.preInit) {
          opts.preInit(self);
        }
        this.preinitted = true;
      },
      preRun: [
        () => {
          $(video.canvas).click((e) => {
            video.canvas.focus();
          });
          this.loaded = true;
          console.log("about to run...");
        }
      ]
    };
    // preload files
    // TODO: ensure loaded
    var fetch_cfg, fetch_lua;
    var fetch_bios = $.Deferred();
    var fetch_wasm = $.Deferred();
    // fetch config file
    if (opts.cfgfile) {
      fetch_cfg = $.get('mame/cfg/' + opts.cfgfile, (data) => {
        opts.cfgdata = data;
        console.log("loaded " + opts.cfgfile);
      }, 'text');
    }
    // fetch BIOS file
    if (opts.biosfile) {
      var oReq1 = new XMLHttpRequest();
      oReq1.open("GET", 'mame/roms/' + opts.biosfile, true);
      oReq1.responseType = "arraybuffer";
      oReq1.onload = (oEvent) => {
        opts.biosdata = new Uint8Array(oReq1.response);
        console.log("loaded " + opts.biosfile); // + " (" + oEvent.total + " bytes)");
        fetch_bios.resolve();
      };
      oReq1.ontimeout = function (oEvent) {
        throw Error("Timeout loading " + opts.biosfile);
      }
      oReq1.send();
    } else {
      fetch_bios.resolve();
    }
    // load debugger Lua script
    fetch_lua = $.get('mame/debugger.lua', (data) => {
      this.luadebugscript = data;
      console.log("loaded debugger.lua");
    }, 'text');
    // load WASM
    {
      var oReq2 = new XMLHttpRequest();
      oReq2.open("GET", 'mame/' + opts.jsfile.replace('.js', '.wasm'), true);
      oReq2.responseType = "arraybuffer";
      oReq2.onload = (oEvent) => {
        console.log("loaded WASM file");
        window['Module'].wasmBinary = new Uint8Array(oReq2.response);
        fetch_wasm.resolve();
      };
      oReq2.ontimeout = function (oEvent) {
        throw Error("Timeout loading " + opts.jsfile);
      }
      oReq2.send();
    }
    // start loading script
    $.when(fetch_lua, fetch_cfg, fetch_bios, fetch_wasm).done(() => {
      var script = document.createElement('script');
      script.src = 'mame/' + opts.jsfile;
      document.getElementsByTagName('head')[0].appendChild(script);
      console.log("created script element");
    });
    // for debugging via browser console
    window['mamelua'] = (s: string) => {
      this.initlua();
      return [s, this.luacall(s)];
    };
  }

  loadROMFile(data) {
    this.romdata = data;
    if (this.preinitted && this.romfn) {
      FS.writeFile(this.romfn, data, { encoding: 'binary' });
    }
  }

  loadRegion(region, data) {
    if (this.loaded && data.length > 0) {
      //this.luacall('cart=manager:machine().images["cart"]\nprint(cart:filename())\ncart:load("' + region + '")\n');
      var s = 'rgn = manager:machine():memory().regions["' + region + '"]\n';
      //s += 'print(rgn.size)\n';
      for (var i = 0; i < data.length; i += 4) {
        var v = data[i] + (data[i + 1] << 8) + (data[i + 2] << 16) + (data[i + 3] << 24);
        s += 'rgn:write_u32(' + i + ',' + v + ')\n'; // TODO: endian?
      }
      this.luacall(s);
      this.reset();
    }
  }

  // DEBUGGING SUPPORT

  initlua() {
    if (!this.initluavars) {
      this.luacall(this.luadebugscript);
      this.luacall('mamedbg.init()')
      this.initluavars = true;
    }
  }

  readAddress(a: number): number {
    this.initlua();
    return parseInt(this.luacall('return mem:read_u8(' + a + ')'));
  }

  getCPUReg(reg: string) {
    if (!this.loaded) return 0; // TODO
    this.initlua();
    return parseInt(this.luacall('return cpu.state.' + reg + '.value'));
  }

  grabState(expr: string) {
    this.initlua();
    return {
      c: this.getCPUState(),
      buf: this.luacall("return string.tohex(" + expr + ")")
    }
  }

  saveState() {
    return this.grabState("manager:machine():buffer_save()");
  }

  loadState(state) {
    this.initlua();
    return this.luacall("manager:machine():buffer_load(string.fromhex('" + state.buf + "'))");
  }

  poll() {
    if (this.onBreakpointHit && this.luacall("return tostring(mamedbg.is_stopped())") == 'true') {
      this._pause();
      //this.luacall("manager:machine():buffer_load(lastBreakState)");
      var state = this.grabState("lastBreakState");
      this.onBreakpointHit(state);
    }
  }
  clearDebug() {
    this.onBreakpointHit = null;
    if (this.loaded) {
      this.initlua();
      this.luacall('mamedbg.reset()');
    }
  }
  getDebugCallback() {
    return this.onBreakpointHit;// TODO?
  }
  setupDebug(callback) {
    this.onBreakpointHit = callback;
  }
  debugcmd(s) {
    this.initlua()
    this.luacall(s);
    this._resume();
  }
  runToPC(pc: number[]) {
    this.debugcmd('mamedbg.runTo(' + pc.join(',') + ')');
  }
  runToVsync() {
    this.debugcmd('mamedbg.runToVsync()');
  }
  runUntilReturn() {
    this.debugcmd('mamedbg.runUntilReturn()');
  }
  // TODO
  runEval() {
    this.reset();
    this.step();
  }
  step() {
    this.debugcmd('mamedbg.step()');
  }
  getDebugCategories() {
    return ['CPU'];
  }
  getDebugInfo(category: string, state: EmuState): string {
    switch (category) {
      case 'CPU': return this.cpuStateToLongString(state.c);
    }
  }
  getDebugTree() {
    this.initlua();
    var devices = JSON.parse(this.luacall(`return table.tojson(manager:machine().devices)`));
    var images = JSON.parse(this.luacall(`return table.tojson(manager:machine().images)`));
    var regions = JSON.parse(this.luacall(`return table.tojson(manager:machine():memory().regions)`));
    return {
      devices: devices,
      images: images,
      regions: regions,
    }
  }

  abstract cpuStateToLongString(c): string;
  abstract getCPUState(): any;
}

export abstract class BaseMAME6502Platform extends BaseMAMEPlatform {
  getPC(): number {
    return this.getCPUReg('PC');
  }
  getSP(): number {
    return this.getCPUReg('SP');
  }
  isStable() { return true; }
  getCPUState() {
    return {
      PC: this.getPC(),
      SP: this.getSP(),
      A: this.getCPUReg('A'),
      X: this.getCPUReg('X'),
      Y: this.getCPUReg('Y'),
      flags: this.getCPUReg('P'),
    };
  }
  /** True when the emulated machine's CPU has the 65C02's extra opcodes. */
  cpu65c02 = false;

  disassemble(pc: number, read: (addr: number) => number): DisasmLine {
    var b0 = read(pc), b1 = read(pc + 1), b2 = read(pc + 2);
    return this.cpu65c02 ? disassemble65C02(pc, b0, b1, b2) : disassemble6502(pc, b0, b1, b2);
  }
  cpuStateToLongString(c) {
    return cpuStateToLongString_6502(c);
  }
}

export abstract class BaseMAMEZ80Platform extends BaseMAMEPlatform {
  getPC(): number {
    return this.getCPUReg('PC');
  }
  getSP(): number {
    return this.getCPUReg('SP');
  }
  isStable() { return true; }
  getCPUState() {
    return {
      PC: this.getPC(),
      SP: this.getSP(),
      AF: this.getCPUReg('AF'),
      BC: this.getCPUReg('BC'),
      DE: this.getCPUReg('DE'),
      HL: this.getCPUReg('HL'),
      IX: this.getCPUReg('IX'),
      IY: this.getCPUReg('IY'),
      IR: this.getCPUReg('R') + (this.getCPUReg('I') << 8),
    };
  }
  disassemble(pc: number, read: (addr: number) => number): DisasmLine {
    return disassembleZ80(pc, read(pc), read(pc + 1), read(pc + 2), read(pc + 3));
  }
  cpuStateToLongString(c) {
    return cpuStateToLongString_Z80(c);
  }
}
