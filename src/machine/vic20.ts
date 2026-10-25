
//// WASM Machine

// http://www.zimmers.net/anonftp/pub/cbm/documents/chipdata/VIC-I.txt
// http://www.zimmers.net/anonftp/pub/cbm/maps/Vic20.MemoryMap.txt
// http://sleepingelephant.com/denial/wiki/index.php/Autostart

import { Machine } from "../common/baseplatform";
import { Probeable, TrapCondition } from "../common/devices";
import { KeyFlags, dumpRAM } from "../common/emu";
import { hex, lpad } from "../common/util";
import { BaseWASMMachine } from "../common/wasmplatform";

// Offsets of the registers in the C structs that machine_get_debug_pointer()
// returns, for the debug panes. The chips structs only hold integers, so the
// offsets are the same in every WASM build of the machine.
const VIA_PA = 0x00;  // m6522_port_t { inpr, outr, ddr, pins }
const VIA_PB = 0x0a;
const VIA_T1 = 0x14;  // m6522_timer_t { latch, counter, ... }
const VIA_T2 = 0x1c;
const VIA_IER = 0x24; // m6522_int_t { ier, ifr, pip }
const VIA_IFR = 0x25;
const VIA_ACR = 0x28;
const VIA_PCR = 0x29;
const VIA_SIZE = 56;
// m6561_t starts with { uint64 pins, fetch_cb, user_data, bool debug_vis },
// and pointers are 32 bits in WASM32, so regs[16] starts at byte 17.
const VIC_REGS = 17;

// indexes into the machine's machine_get_debug_pointer()
const DEBUG_VIA1 = 1;
const DEBUG_VIA2 = 2;
const DEBUG_VIC = 3;
const DEBUG_RAM0 = 5;

export class VIC20_WASMMachine extends BaseWASMMachine implements Machine, Probeable {

  numTotalScanlines = 312;
  cpuCyclesPerLine = 71;
  // the VIC-I draws its 22x23 character window centered in the frame,
  // so no video offset is needed
  videoOffsetBytes = 0;

  prgstart : number;
  joymask0 = 0;
  joymask1 = 0;

  getBIOSLength() { return 0x5000 };

  async fetchBIOS() {
    // use the real VIC-20 ROM set (BASIC, character ROM and KERNAL) if it is
    // available, otherwise fall back to a tiny stub BIOS that only knows how
    // to start an autostart cartridge
    try {
      const resp = await fetch('res/vic20/vic20.bios');
      if (resp.status == 200) {
        const bios = new Uint8Array(await resp.arrayBuffer());
        if (bios.length == 0x5000) {
          this.allocateBIOS(bios);
          this.loadBIOS(bios);
          return;
        }
      }
    } catch (e) {
      // no ROM set available, use the stub BIOS below
    }
    let bios = new Uint8Array(20480);
    bios.set(DEFAULT_BIOS, bios.length - DEFAULT_BIOS.length);
    this.allocateBIOS(bios);
    this.loadBIOS(new Uint8Array(bios));
  }
  reset() {
    super.reset();
    // clear keyboard
    for (var ch=0; ch<128; ch++) {
      this.setKeyInput(ch, 0, KeyFlags.KeyUp);
    }
    // load rom
    if (this.romptr && this.romlen) {
      let rom = this.romarr;
      let iscart = rom[4+2]==0x41 && rom[5+2]==0x30 && rom[6+2]==0xC3 && rom[7+2]==0xC2 && rom[8+2]==0xCD;
      if (!iscart) {
        // boot first: the KERNAL's cold start clears $0000-$03FF and
        // initializes the BASIC pointers, so a PRG loaded before it
        // could be damaged
        this.exports.machine_exec(this.sys, 500000);
        this.exports.machine_load_rom(this.sys, this.romptr, this.romlen);
        this.prgstart = this.getPRGStart(rom);
        console.log("prgstart", hex(this.prgstart));
        if (this.hasBASIC()) {
          this.typeSYS(this.prgstart);
        } else {
          this.callAt(this.prgstart);
        }
      } else {
        this.exports.machine_load_rom(this.sys, this.romptr, this.romlen);
        // get out of reset
        //this.exports.machine_exec(this.sys, 100);
        // wait until cartridge start
        // TODO: detect ROM cartridge
        var warmstart = this.romarr[0x2+2] + this.romarr[0x3+2]*256;
        for (var i=0; i<10000 && this.getPC() != warmstart; i++) {
          this.exports.machine_tick(this.sys);
        }
        console.log('cart', i, hex(warmstart));
      }
      // TODO: shouldn't we return here @ start of frame?
      // and stop probing
    }
  }
  // where to start a PRG: the SYS address of its BASIC stub, or else its
  // load address. A BASIC program starts at $1001, or $0401 or $1201 with
  // memory expansion; a stub with no SYS is assumed to be followed by
  // machine code.
  getPRGStart(prg: Uint8Array) : number {
    let loadaddr = prg[0] + (prg[1]<<8);
    if (loadaddr != 0x1001 && loadaddr != 0x0401 && loadaddr != 0x1201) return loadaddr;
    // BASIC line: link(2) lineno(2) tokens... 0
    let i = 6;
    while (i < prg.length && (prg[i] == 0x20 || prg[i] == 0x3a)) i++;
    if (prg[i++] == 0x9e) {
      let addr = 0;
      for (; i < prg.length; i++) {
        let ch = prg[i];
        if (ch >= 0x30 && ch <= 0x39) addr = addr * 10 + (ch & 0xf);
        else if (ch != 0x20) break;
      }
      return addr;
    }
    return prg[2] + (prg[3]<<8) + 2; // point to after BASIC program
  }
  // does the BIOS have a BASIC ROM? ("CBMBASIC" signature at $C004)
  hasBASIC() : boolean {
    return "CBMBASIC".split('').every((ch, i) => this.exports.machine_mem_read(this.sys, 0xc004+i) == ch.charCodeAt(0));
  }
  // type in "SYS addr" at the BASIC prompt and run until the program starts
  typeSYS(addr: number) {
    var cmd = "SYS "+addr+"\r";
    console.log(cmd);
    for (var i=0; i<cmd.length; i++) {
      var key = cmd.charCodeAt(i);
      this.exports.machine_exec(this.sys, 10000);
      this.exports.machine_exec(this.sys, 10000);
      this.exports.machine_key_down(this.sys, key);
      this.exports.machine_exec(this.sys, 10000);
      this.exports.machine_exec(this.sys, 10000);
      this.exports.machine_key_up(this.sys, key);
    }
    // advance clock until program starts
    for (var i=0; i<200000 && this.getPC() != addr; i++) {
      this.exports.machine_tick(this.sys);
    }
    if (this.getPC() != addr) console.log("SYS did not start the program", hex(addr));
  }
  // no BASIC: call the program as if by JSR from the KERNAL's idle loop, so
  // returning from it goes back to the idle loop (the cc65 startup ends with
  // RTS). The CPU can't be pointed at an address from here, so hijack the
  // IRQ vector ($0314) with a stub in the BASIC input buffer: when the next
  // interrupt reaches it, it restores the registers and status the KERNAL
  // pushed and jumps to the program, with the interrupted address - 1 left
  // on the stack for the program's RTS.
  callAt(addr: number) {
    const STUB = 0x0200; // the BASIC input buffer, unused without BASIC
    const rd = (a: number) => this.exports.machine_mem_read(this.sys, a);
    const wr = (a: number, v: number) => this.exports.machine_mem_write(this.sys, a, v);
    const cinv = [rd(0x314), rd(0x315)];
    const stub = [
      0xa9, cinv[0], 0x8d, 0x14, 0x03,  // lda #<cinv; sta $0314
      0xa9, cinv[1], 0x8d, 0x15, 0x03,  // lda #>cinv; sta $0315
      0x68, 0xa8, 0x68, 0xaa, 0x68,     // pla; tay; pla; tax; pla
      0x28,                             // plp
      0x4c, addr & 0xff, addr >> 8,     // jmp addr
    ];
    stub.forEach((v, i) => wr(STUB + i, v));
    wr(0x314, STUB & 0xff);
    wr(0x315, STUB >> 8);
    // wait for the interrupt (the stub is entered with the SYNC pin set)
    for (var i=0; i<200000 && !(this.getPC() == STUB && this.isStable()); i++) {
      this.exports.machine_tick(this.sys);
    }
    if (i == 200000) {
      console.log("no interrupt, can't start", hex(addr));
      wr(0x314, cinv[0]);
      wr(0x315, cinv[1]);
      return;
    }
    // the stack holds Y, X, A, P, PCL, PCH (lowest address first)
    this.exports.machine_save_cpu_state(this.sys, this.cpustateptr);
    var sp = this.cpustatearr[9];
    var lo = 0x100 + ((sp + 5) & 0xff);
    var ret = rd(lo) + (rd(0x100 + ((sp + 6) & 0xff)) << 8) - 1;
    wr(lo, ret & 0xff);
    wr(0x100 + ((sp + 6) & 0xff), ret >> 8);
  }
  advanceFrame(trap: TrapCondition) : number {
    // TODO: does this sync with VSYNC?
    var scanline = this.getRasterY();
    var clocks = Math.floor((this.numTotalScanlines - scanline) * 22152 / this.numTotalScanlines);
    var probing = this.probe != null;
    if (probing) this.exports.machine_reset_probe_buffer();
    clocks = super.advanceFrameClock(trap, clocks);
    if (probing) this.copyProbeData();
    return clocks;
  }
  getRasterY() {
    return this.exports.machine_get_raster_line(this.sys);
  }
  getRasterCanvasPosition() {
    return {
      x: -1, // TODO?
      y: this.getRasterY() - 14,
    }
  }
  getCPUState() {
    this.exports.machine_save_cpu_state(this.sys, this.cpustateptr);
    var s = this.cpustatearr;
    var pc = s[2] + (s[3]<<8);
    return {
      PC:pc,
      SP:s[9],
      A:s[6],
      X:s[7],
      Y:s[8],
      C:s[10] & 1,
      Z:s[10] & 2,
      I:s[10] & 4,
      D:s[10] & 8,
      V:s[10] & 64,
      N:s[10] & 128,
      o:this.readConst(pc),
    }
  }
  getDebugStateOffset(index: number) {
    var p = this.exports.machine_get_debug_pointer(this.sys, index);
    return p - this.sys;
  }
  saveState() {
    this.exports.machine_save_state(this.sys, this.stateptr);
    // the debug panes want the chip registers at the moment of the save, so
    // they travel in the state instead of being read from the live machine
    let ram0 = this.getDebugStateOffset(DEBUG_RAM0);
    let via1 = this.getDebugStateOffset(DEBUG_VIA1);
    let via2 = this.getDebugStateOffset(DEBUG_VIA2);
    let vic = this.getDebugStateOffset(DEBUG_VIC) + VIC_REGS;
    return {
      c:this.getCPUState(),
      state:this.statearr.slice(0),
      ram:this.statearr.slice(ram0, ram0+0x200), // ZP and stack
      via1:this.statearr.slice(via1, via1+VIA_SIZE),
      via2:this.statearr.slice(via2, via2+VIA_SIZE),
      vic:this.statearr.slice(vic, vic+16),
      // the joystick mask lives on this object, not in the WASM state blob,
      // so it has to be saved explicitly or it leaks across a rewind
      joymask0: this.joymask0,
      joymask1: this.joymask1,
    };
  }
  loadState(state) : void {
    this.statearr.set(state.state);
    this.exports.machine_load_state(this.sys, this.stateptr);
    this.joymask0 = state.joymask0 | 0;
    this.joymask1 = state.joymask1 | 0;
    this.exports.vic20_joystick(this.sys, this.joymask0, this.joymask1);
  }
  getVideoParams() {
   return {width:232, height:272, overscan:true, videoFrequency:50, aspect:1.5};
  }
  getDebugCategories() {
    return ['CPU','ZPRAM','Stack','VIA','VIC'];
  }
  // translate an address as the VIC-I sees it (14 bits, its own memory map)
  // into the CPU address of the same memory, or "ROM" for the character ROM
  vicAddressToCPU(addr: number) {
    if (addr < 0x2000) return 'ROM $' + hex(0x8000 + (addr & 0xfff), 4);
    return '$' + hex((addr - 0x2000) & 0xffff, 4);
  }
  // format one VIA, in the style of the C64's CIA pane
  viaToString(name: string, m: Uint8Array) {
    let t1 = m[VIA_T1+2] + m[VIA_T1+3]*256;
    let t2 = m[VIA_T2+2] + m[VIA_T2+3]*256;
    let s = `${name}\n`;
    s += ` A: Out ${hex(m[VIA_PA+1])}  In ${hex(m[VIA_PA+0])}  DDR ${hex(m[VIA_PA+2])}`;
    s += `   T1 ${hex(t1, 4)}\n`;
    s += ` B: Out ${hex(m[VIA_PB+1])}  In ${hex(m[VIA_PB+0])}  DDR ${hex(m[VIA_PB+2])}`;
    s += `   T2 ${hex(t2, 4)}\n`;
    s += ` ACR ${hex(m[VIA_ACR])}  PCR ${hex(m[VIA_PCR])}`;
    s += `  IER ${hex(m[VIA_IER])}  IFR ${hex(m[VIA_IFR])}\n`;
    return s;
  }
  getDebugInfo(category: string, state: any) {
    switch (category) {
      case 'VIA': {
        let s = '';
        s += this.viaToString('VIA 1 ($9110)  joystick, cassette, NMI', state.via1);
        s += this.viaToString('VIA 2 ($9120)  keyboard, cassette, IRQ', state.via2);
        return s;
      }
      case 'VIC': {
        let m = state.vic;
        // screen memory is at A13..A9 from $9005 bits 4-7 and $9002 bit 7
        // (A8 must be 0, the screen needs a 512 byte page)
        let screen = ((m[5] & 0xf0) << 6) | ((m[2] & 0x80) << 2);
        // character memory is the $9005 low nibble, in 1K steps
        let charmem = (m[5] & 0x0f) << 10;
        let s = 'Mode: TEXT\n';
        s += `Raster: ${lpad(this.getRasterY(), 3)}`;
        s += `   Border ${m[15] & 7}  Background ${(m[15]>>4) & 0xf}  Aux ${(m[14]>>4) & 0xf}`;
        s += `  Volume ${m[14] & 0xf}\n`;
        s += `Screen: ${this.vicAddressToCPU(screen)}   `;
        s += `Char: ${this.vicAddressToCPU(charmem)}\n`;
        s += dumpRAM(m, 0x9000, 16);
        return s;
      }
    }
  }
  setKeyInput(key: number, code: number, flags: number): void {
    // TODO: handle shifted keys
    if (key == 16 || key == 17 || key == 18 || key == 224) return; // meta keys
    //console.log(key, code, flags);
    //if (flags & KeyFlags.Shift) { key += 64; }
    // convert to vic20
    var mask = 0;
    var mask2 = 0;
    if (key == 37) { key = 0x8; mask = 0x4; } // LEFT
    if (key == 38) { key = 0xb; mask = 0x1; } // UP
    if (key == 39) { key = 0x9; mask = 0x8; } // RIGHT
    if (key == 40) { key = 0xa; mask = 0x2; } // DOWN
    if (key == 32) { mask = 0x10; } // FIRE
    /* player 2 (TODO)
    if (key == 65) { key = 65; mask2 = 0x4; } // LEFT
    if (key == 87) { key = 87; mask2 = 0x1; } // UP
    if (key == 68) { key = 68; mask2 = 0x8; } // RIGHT
    if (key == 83) { key = 83; mask2 = 0x2; } // DOWN
    if (key == 69) { mask2 = 0x10; } // FIRE
    */
    if (key == 113) { key = 0xf1; } // F2
    if (key == 115) { key = 0xf3; } // F4
    if (key == 119) { key = 0xf5; } // F8
    if (key == 121) { key = 0xf7; } // F10
    if (flags & KeyFlags.KeyDown) {
      this.exports.machine_key_down(this.sys, key);
      this.joymask0 |= mask;
      this.joymask1 |= mask2;
    } else if (flags & KeyFlags.KeyUp) {
      this.exports.machine_key_up(this.sys, key);
      this.joymask0 &= ~mask;
      this.joymask1 &= ~mask2;
    }
    this.exports.vic20_joystick(this.sys, this.joymask0, this.joymask1);
  }

}

// pretty much just runs autostart ROM and not much else...
const DEFAULT_BIOS = [
  0xA2, 0x10, 0xA0, 0x91, 0x60, 0x71, 0xFF, 0x71, 0xFF, 0x5C, 0xFF, 0xA2, 0xFF, 0x78, 0x9A, 0xD8, 
  0x6C, 0x00, 0xA0, 0xA2, 0x45, 0xA0, 0xFF, 0x18, 0x78, 0x6C, 0x18, 0x03, 0x48, 0x8A, 0x48, 0x98, 
  0x48, 0xAD, 0x1D, 0x91, 0x10, 0x03, 0x6C, 0x02, 0xA0, 0x4C, 0x6C, 0xFF, 0x68, 0xA8, 0x68, 0xAA, 
  0x68, 0x40, 0x48, 0x8A, 0x48, 0x98, 0x48, 0xBA, 0xBD, 0x04, 0x01, 0x29, 0x10, 0xF0, 0x03, 0x6C, 
  0x16, 0x03, 0x6C, 0x14, 0x03, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x4C, 0x53, 0xFF, 0x4C, 0x44, 0xFF, 
  0x4C, 0x44, 0xFF, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 0xFF, 0x4C, 
  0x44, 0xFF, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 
  0xFF, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 0xFF, 
  0x6C, 0x1A, 0x03, 0x6C, 0x1C, 0x03, 0x6C, 0x1E, 0x03, 0x6C, 0x20, 0x03, 0x6C, 0x22, 0x03, 0x6C, 
  0x24, 0x03, 0x6C, 0x26, 0x03, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 
  0xFF, 0x6C, 0x28, 0x03, 0x6C, 0x2A, 0x03, 0x6C, 0x2C, 0x03, 0x4C, 0x44, 0xFF, 0x4C, 0x44, 0xFF, 
  0x4C, 0x44, 0xFF, 0x4C, 0x40, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x58, 0xFF, 0x4B, 0xFF, 0x72, 0xFF
];
