// Tandy Color Computer 1/2 (TRS-80 Color Computer, Dragon-like architecture).
//
//   MC6809E CPU at 0.895 MHz
//   MC6883 SAM    address multiplexer, video address generator, memory map
//   MC6847 VDG    video (32x16 text, semigraphics, 8 graphics modes)
//   2 x MC6821 PIA  keyboard, joysticks, DAC sound, VDG mode pins, cassette
//
// Memory map (SAM map type 0; with TY = 1 the whole 64K is RAM):
//   $0000-$7FFF  RAM (the other 32K of a 64K machine appears with TY = 1)
//   $8000-$9FFF  Extended Color BASIC ROM
//   $A000-$BFFF  Color BASIC ROM
//   $C000-$FEFF  cartridge ROM
//   $FF00-$FF1F  PIA0 (keyboard, joysticks, HS/FS interrupts)
//   $FF20-$FF3F  PIA1 (DAC, VDG mode pins, cassette)
//   $FF40-$FF5F  cartridge / disk controller I/O
//   $FFC0-$FFDF  SAM control bits
//   $FFE0-$FFFF  vectors (the ROM at $BFE0-$BFFF)
//
// There is no Microsoft BASIC here: `cocorom.ts` is our own small boot ROM
// that provides the entry points CMOC's runtime calls (POLCAT, CHROUT, CLS...).
// A real Color BASIC / Extended BASIC ROM can be loaded over it with loadBIOS().
//
// Programs are DECB ".bin" files (what CMOC produces). They are loaded
// straight into RAM and the boot ROM runs them through the EXEC vector at $009D.

import { CPU6809 } from "../common/cpu/6809";
import { MemoryBus } from "../common/baseplatform";
import { BasicScanlineMachine } from "../common/devices";
import { KeyFlags } from "../common/emu";
import { MC6821 } from "./chips/mc6821";
import { MC6847, VDG_HEIGHT, VDG_WIDTH } from "./chips/mc6847";
import { MC6883, SAM_BASE, SAM_END } from "./chips/mc6883";
import { COCO_BOOT_ROM } from "./cocorom";

const COCO_CPU_FREQ = 894886;         // 14.31818 MHz / 16
const COCO_TOTAL_LINES = 262;
const COCO_CYCLES_PER_LINE = 57;      // 14934 per frame, ~60 Hz
const ROM_BASE = 0x8000;
const BOOT_ROM_BASE = 0xa000;         // where Color BASIC lives
const CART_BASE = 0xc000;
const EXEC_VECTOR = 0x009d;           // BASIC's EXEC address, our load-and-go hand-off

// --- keyboard ------------------------------------------------------------
//
// The matrix is 7 rows (read on PIA0 port A bits 0-6) by 8 columns (strobed
// by PIA0 port B bits 0-7, active low). A key is (row, column). Each string
// below is one row; the character's index is its column.

// \x0b UP  \x0a DOWN  \x08 LEFT  \x09 RIGHT  \x0d ENTER  \x0c CLEAR  \x03 BREAK
const KEY_ROWS = [
  '@ABCDEFG',
  'HIJKLMNO',
  'PQRSTUVW',
  'XYZ\x0b\x0a\x08\x09 ',
  '01234567',
  '89:;,-./',
  '\x0d\x0c\x03\0\0\0\0\0', // column 7 of this row is SHIFT
];
const SHIFT_ROW = 6;
const SHIFT_COL = 7;

interface KeyPos { row: number; col: number; shift: boolean }

// PC characters that need a different key, or SHIFT, on the CoCo keyboard
const SHIFTED_CHARS: { [ch: string]: string } = {
  '!': '1', '"': '2', '#': '3', '$': '4', '%': '5', '&': '6', "'": '7',
  '(': '8', ')': '9', '*': ':', '+': ';', '<': ',', '=': '-', '>': '.', '?': '/',
};

function lookupChar(ch: string): KeyPos | null {
  for (let row = 0; row < KEY_ROWS.length; row++) {
    const col = KEY_ROWS[row].indexOf(ch);
    if (col >= 0 && ch != '\0') return { row, col, shift: false };
  }
  return null;
}

// DOM keyCode -> CoCo key, for keys that are not typed characters
const SPECIAL_KEYS: { [code: number]: string } = {
  13: '\x0d',  // Enter
  27: '\x03',  // Escape = BREAK
  8: '\x08',   // Backspace = left arrow
  37: '\x08', 38: '\x0b', 39: '\x09', 40: '\x0a',
  36: '\x0c',  // Home = CLEAR
  32: ' ',
};

export function parseDECB(data: Uint8Array): { blocks: { addr: number, bytes: Uint8Array }[], exec: number } | null {
  const blocks = [];
  let p = 0;
  while (p < data.length) {
    if (p + 5 > data.length) return null;
    const type = data[p];
    const len = (data[p + 1] << 8) | data[p + 2];
    const addr = (data[p + 3] << 8) | data[p + 4];
    p += 5;
    if (type == 0xff) return blocks.length ? { blocks, exec: addr } : null;
    if (type != 0 || p + len > data.length) return null;
    blocks.push({ addr, bytes: data.subarray(p, p + len) });
    p += len;
  }
  return null; // no exec trailer
}

export class CoCoMachine extends BasicScanlineMachine {

  cpuFrequency = COCO_CPU_FREQ;
  canvasWidth = VDG_WIDTH;
  numVisibleScanlines = VDG_HEIGHT;
  numTotalScanlines = COCO_TOTAL_LINES;
  cpuCyclesPerLine = COCO_CYCLES_PER_LINE;
  defaultROMSize = 0x8000;
  sampleRate = COCO_TOTAL_LINES * 60;   // one DAC sample per scanline
  aspectRatio = 4 / 3;

  cpu;
  membus: MemoryBus;
  ram = new Uint8Array(0x10000);
  rom = new Uint8Array(0x8000);         // $8000-$FFFF as seen with TY = 0

  pia0 = new MC6821();
  pia1 = new MC6821();
  sam = new MC6883();
  vdg = new MC6847();

  // the loaded DECB program, reloaded into RAM on every reset
  program: { blocks: { addr: number, bytes: Uint8Array }[], exec: number } | null = null;

  // video address generator state (the SAM's counter)
  rowAddr = 0;
  lineInRow = 0;

  // Control state lives in `inputs` so that it is saved with the recorder:
  //  0-6   keyboard matrix, one byte per row, bit = column pressed
  //  8-11  joystick axes 0-63: right X, right Y, left X, left Y
  //  12    joystick buttons: bit 0 right 1, bit 1 left 1, bit 2 right 2, bit 3 left 2
  physShift = false;
  pressed = new Map<number, KeyPos>();

  constructor() {
    super();
    this.inputs.fill(0);
    this.inputs.set([32, 32, 32, 32], 8);
    this.handler = this.handleKey.bind(this);
    this.initBus();
    this.initPIAs();
    this.loadBIOS(COCO_BOOT_ROM);
    this.cpu = Object.create(CPU6809());
    this.cpu.init(this.membus.write, this.membus.read, 0);
  }

  // --- memory ------------------------------------------------------------

  initBus() {
    const read = (a: number): number => {
      a &= 0xffff;
      if (a < 0x8000) return this.ram[a];
      if (a < 0xff00) return this.sam.allRAM ? this.ram[a] : this.rom[a - ROM_BASE];
      if (a < 0xff20) return this.pia0.read(a & 3);
      if (a < 0xff40) return this.pia1.read(a & 3);
      if (a < 0xff60) return 0xff;            // disk controller: not present
      if (a >= 0xffe0) return this.rom[a - 0xc000]; // vectors come from $BFE0-$BFFF
      return 0xff;
    };
    const write = (a: number, v: number) => {
      a &= 0xffff;
      // writes to ROM addresses land in the RAM underneath
      if (a < 0xff00) this.ram[a] = v;
      else if (a < 0xff20) this.pia0.write(a & 3, v);
      else if (a < 0xff40) this.pia1.write(a & 3, v);
      else if (a >= SAM_BASE && a <= SAM_END) this.sam.access(a);
    };
    this.membus = this.probeMemoryBus({ read, write });
  }

  read(a: number): number { return this.membus.read(a); }
  write(a: number, v: number) { this.membus.write(a, v); }

  /** Read without side effects, for the debugger. */
  readConst(a: number): number {
    a &= 0xffff;
    if (a >= 0xff00 && a < 0xff20) return this.pia0.peek(a & 3);
    if (a >= 0xff20 && a < 0xff40) return this.pia1.peek(a & 3);
    return this.membus.read(a);
  }

  // --- PIAs --------------------------------------------------------------

  initPIAs() {
    const { pia0, pia1 } = this;
    // PIA0 port A: keyboard rows (bits 0-6) and the joystick comparator (bit 7)
    pia0.readInA = () => {
      const strobe = pia0.outB;     // columns being driven low
      let v = 0x7f;
      for (let row = 0; row < 7; row++) {
        if (this.inputs[row] & ~strobe & 0xff) v &= ~(1 << row);
      }
      // fire buttons pull the same lines low
      v &= ~(this.inputs[12] & 0x0f);
      // The comparator is high when the selected joystick axis voltage is at
      // least the DAC's. The axis is chosen by the two PIA0 CA2/CB2 lines.
      const sel = (pia0.c2a ? 1 : 0) | (pia0.c2b ? 2 : 0);
      const axis = this.inputs[8 + sel];
      const dac = pia1.outA >> 2;
      if (axis >= dac) v |= 0x80;
      return v;
    };
    // PIA1 port B reads: bit 2 is RAM size select (high = 4K/16K parts: no
    // matter here), the rest float high
    pia1.readInB = () => 0xff;
  }

  /** Level on the DAC output, -1..1 */
  getDAC(): number {
    // sound enable is PIA1 CB2; the DAC is port A bits 7-2
    if (!this.pia1.c2b) return 0;
    return ((this.pia1.outA >> 2) - 32) / 64;
  }

  // --- control input -----------------------------------------------------

  handleKey(key: number, code: number, flags: number) {
    const down = !!(flags & KeyFlags.KeyDown);
    if (key == 16) { // Shift on its own
      this.physShift = down;
      this.updateShift();
      return;
    }
    if (!down) {
      const pos = this.pressed.get(key);
      if (pos) {
        this.pressed.delete(key);
        this.inputs[pos.row] &= ~(1 << pos.col);
        this.updateShift();
      }
      return;
    }
    let pos: KeyPos = null;
    if (SPECIAL_KEYS[key]) {
      pos = lookupChar(SPECIAL_KEYS[key]);
      if (pos) pos.shift = !!(flags & KeyFlags.Shift);
    } else if (key >= 65 && key <= 90) {
      // letters are physical: unshifted gives upper case, as on the real keyboard
      pos = lookupChar(String.fromCharCode(key));
      if (pos) pos.shift = !!(flags & KeyFlags.Shift);
    } else {
      // other printable keys go by the character they type, since SHIFT
      // does not mean the same thing on a PC keyboard
      const ch = code >= 32 && code < 127 ? String.fromCharCode(code) : '';
      const base = SHIFTED_CHARS[ch];
      pos = lookupChar(base || ch);
      if (pos && base) pos.shift = true;
    }
    if (!pos) return;
    this.pressed.set(key, pos);
    this.inputs[pos.row] |= 1 << pos.col;
    this.updateShift();
  }

  /** The CoCo SHIFT key follows the keys held, or the physical Shift if none. */
  private updateShift() {
    let shift = false, any = false;
    for (const pos of this.pressed.values()) {
      any = true;
      if (pos.shift) shift = true;
    }
    if (!any) shift = this.physShift;
    if (shift) this.inputs[SHIFT_ROW] |= 1 << SHIFT_COL;
    else this.inputs[SHIFT_ROW] &= ~(1 << SHIFT_COL);
  }

  // Joystick on the mouse: controller 0 = X, 1 = Y of the right joystick.
  setPaddleInput(controller: number, value: number) {
    if (controller == 0 || controller == 1) this.inputs[8 + controller] = (value >> 2) & 0x3f;
  }
  setPaddleButton(index: number, pressed: boolean) {
    const mask = index == 0 ? 1 : index == 1 ? 4 : 0; // right joystick buttons 1 and 2
    if (!mask) return;
    if (pressed) this.inputs[12] |= mask;
    else this.inputs[12] &= ~mask;
  }

  // --- ROM and program loading --------------------------------------------

  /** A Color BASIC ROM (8K at $A000, or 16K with Extended BASIC from $8000). */
  loadBIOS(data: Uint8Array, title?: string) {
    if (data.length != 0x2000 && data.length != 0x4000)
      throw new Error(`CoCo ROM must be 8K or 16K, not ${data.length}`);
    this.rom.set(data, 0x4000 - data.length);
  }

  /** A DECB program, or else a cartridge ROM image (mapped at $C000). */
  loadROM(data: Uint8Array, title?: string, origin?: number) {
    const decb = parseDECB(data);
    if (decb) {
      this.program = decb;
    } else {
      if (data.length > 0x3f00) throw new Error(`cartridge ROM too big: ${data.length}`);
      this.program = null;
      this.rom.fill(0, CART_BASE - ROM_BASE);
      this.rom.set(data, CART_BASE - ROM_BASE);
    }
  }

  reset() {
    this.ram.fill(0);
    this.pia0.reset();
    this.pia1.reset();
    this.sam.reset();
    this.pia0.ca1 = this.pia0.cb1 = false;
    this.rowAddr = this.sam.displayBase;
    this.lineInRow = 0;
    if (this.program) {
      for (const b of this.program.blocks) this.ram.set(b.bytes, b.addr);
      this.ram[EXEC_VECTOR] = this.program.exec >> 8;
      this.ram[EXEC_VECTOR + 1] = this.program.exec & 0xff;
    }
    this.cpu.reset();
  }

  // --- running -----------------------------------------------------------

  advanceCPU() {
    // level-sensitive interrupts: PIA0 -> IRQ, PIA1 -> FIRQ. The CPU ignores
    // them while masked, and they come back after RTI if still asserted.
    if (this.pia0.irqA || this.pia0.irqB) this.cpu.interrupt();
    if (this.pia1.irqA || this.pia1.irqB) this.cpu.firq();
    const cycles = super.advanceCPU();
    // The SAM's R1 bit doubles the CPU clock (setHighSpeed() in CMOC): the
    // video does not change speed, so each instruction takes half as long
    // on the scanline.
    return this.sam.fast ? cycles / 2 : cycles;
  }

  startScanline() {
    const sl = this.scanline;
    // horizontal sync pulses once per line (PIA0 CA1)
    this.pia0.setCA1(true);
    this.pia0.setCA1(false);
    if (sl == 0) {
      // end of vertical sync: the display restarts from the SAM's offset
      this.pia0.setCB1(true);
      this.rowAddr = this.sam.displayBase;
      this.lineInRow = 0;
    } else if (sl == VDG_HEIGHT) {
      // field sync (PIA0 CB1) falls as the active display ends: the 60 Hz tick
      this.pia0.setCB1(false);
    }
  }

  drawScanline() {
    const sl = this.scanline;
    if (sl < VDG_HEIGHT && this.pixels) {
      const sam = this.sam;
      this.vdg.drawLine(this.pixels, sl * VDG_WIDTH, this.ram,
        this.rowAddr, this.lineInRow, sam.bytesPerRow, this.pia1.outB);
      if (++this.lineInRow >= sam.linesPerRow) {
        this.lineInRow = 0;
        this.rowAddr = (this.rowAddr + sam.bytesPerRow) & 0xffff;
      }
    }
    if (this.audio) this.audio.feedSample(this.getDAC(), 1);
  }

  // --- state -------------------------------------------------------------

  saveState() {
    return {
      c: this.cpu.saveState(),
      ram: this.ram.slice(0),
      inputs: this.inputs.slice(0),
      pia0: this.pia0.saveState(),
      pia1: this.pia1.saveState(),
      sam: this.sam.bits,
      rowAddr: this.rowAddr,
      lineInRow: this.lineInRow,
    };
  }
  loadState(state) {
    this.cpu.loadState(state.c);
    this.ram.set(state.ram);
    this.inputs.set(state.inputs);
    this.pia0.loadState(state.pia0);
    this.pia1.loadState(state.pia1);
    this.sam.bits = state.sam;
    this.rowAddr = state.rowAddr;
    this.lineInRow = state.lineInRow;
  }
}
