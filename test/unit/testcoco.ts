import assert from "assert";
import { describe, it } from "mocha";
import { MC6821 } from "../../src/machine/chips/mc6821";
import { MC6883 } from "../../src/machine/chips/mc6883";
import { MC6847, VDG_PALETTE } from "../../src/machine/chips/mc6847";
import { CoCoMachine, parseDECB } from "../../src/machine/coco";
import { KeyFlags } from "../../src/common/emu";

const GREEN = VDG_PALETTE[0], YELLOW = VDG_PALETTE[1], BLUE = VDG_PALETTE[2],
  RED = VDG_PALETTE[3], BLACK = VDG_PALETTE[8], DARK_GREEN = VDG_PALETTE[9];

describe('MC6821 PIA', () => {
  it('selects the DDR or the data register with CR bit 2', () => {
    const pia = new MC6821();
    pia.write(0, 0xf0);                 // CRA bit 2 clear: this is DDRA
    assert.strictEqual(pia.ddra, 0xf0);
    assert.strictEqual(pia.read(0), 0xf0);
    pia.write(1, 0x04);                 // now port data
    pia.readInA = () => 0x0a;
    pia.write(0, 0x50);
    assert.strictEqual(pia.ora, 0x50);
    // outputs read back what was written, inputs come from the pins
    assert.strictEqual(pia.read(0), 0x5a);
  });

  it('flags an active C1 edge and raises IRQ only when enabled', () => {
    const pia = new MC6821();
    pia.write(1, 0x04);                 // data reg, falling edge, IRQ disabled
    pia.setCA1(true);
    assert.strictEqual(pia.cra & 0x80, 0, 'rising edge is not active');
    pia.setCA1(false);
    assert.strictEqual(pia.cra & 0x80, 0x80, 'falling edge sets the flag');
    assert.strictEqual(pia.irqA, false, 'IRQ not enabled');
    pia.write(1, 0x05);
    assert.strictEqual(pia.irqA, true);
    pia.read(0);                        // reading the data register clears the flag
    assert.strictEqual(pia.irqA, false);
    assert.strictEqual(pia.cra & 0x80, 0);
  });

  it('uses the rising edge when CR bit 1 is set', () => {
    const pia = new MC6821();
    pia.write(3, 0x07);
    pia.setCB1(true);
    assert.strictEqual(pia.irqB, true);
  });

  it('drives C2 as a manual output', () => {
    const pia = new MC6821();
    pia.write(1, 0x3c);                 // C2 output, manual mode, level high
    assert.strictEqual(pia.c2a, true);
    pia.write(1, 0x34);
    assert.strictEqual(pia.c2a, false);
  });
});

describe('MC6883 SAM', () => {
  it('sets and clears bits through address pairs', () => {
    const sam = new MC6883();
    sam.access(0xffc3);                 // V1 set
    sam.access(0xffc5);                 // V2 set
    assert.strictEqual(sam.v, 6);
    sam.access(0xffc2);                 // V1 clear
    assert.strictEqual(sam.v, 4);
  });

  it('computes the display address from F0-F6', () => {
    const sam = new MC6883();
    sam.access(0xffc9);                 // F1: $0400
    assert.strictEqual(sam.displayBase, 0x0400);
    sam.access(0xffc7);                 // F0: +$0200
    assert.strictEqual(sam.displayBase, 0x0600);
  });

  it('knows the geometry of each mode', () => {
    const sam = new MC6883();
    assert.deepStrictEqual([sam.bytesPerRow, sam.linesPerRow], [32, 12]);
    sam.access(0xffc3); sam.access(0xffc5);
    assert.deepStrictEqual([sam.bytesPerRow, sam.linesPerRow], [32, 1]);
    assert.strictEqual(sam.allRAM, false);
    sam.access(0xffdf);
    assert.strictEqual(sam.allRAM, true);
  });
});

describe('MC6847 VDG', () => {
  const vdg = new MC6847();
  const line = new Uint32Array(256);

  it('draws inverted text as a dark glyph on green', () => {
    const ram = new Uint8Array(0x10000);
    ram[0x400] = 0x41;                  // 'A', INV set: how Color BASIC prints
    ram[0x401] = 0x60;                  // space
    vdg.drawLine(line, 0, ram, 0x400, 2, 32, 0x00);  // first glyph row of the cell
    assert.strictEqual(line[0], GREEN, 'background');
    assert.strictEqual(line[2], DARK_GREEN, 'the glyph\'s top bar');
    assert.strictEqual(line[8], GREEN, 'a space is all background');
    vdg.drawLine(line, 0, ram, 0x400, 0, 32, 0x00);  // blank line above the glyph
    assert.strictEqual(line[2], GREEN);
  });

  it('draws reverse video without the INV bit, and orange with CSS', () => {
    const ram = new Uint8Array(0x10000);
    ram[0x400] = 0x01;                  // 'A', no INV
    vdg.drawLine(line, 0, ram, 0x400, 2, 32, 0x00);
    assert.strictEqual(line[2], GREEN);
    assert.strictEqual(line[0], DARK_GREEN);
    vdg.drawLine(line, 0, ram, 0x400, 2, 32, 0x08);
    assert.strictEqual(line[2], VDG_PALETTE[7]);
  });

  it('draws semigraphics 4 quadrants', () => {
    const ram = new Uint8Array(0x10000);
    ram[0x400] = 0x8f;                  // green, all four quadrants
    ram[0x401] = 0xa8;                  // blue, upper left only
    vdg.drawLine(line, 0, ram, 0x400, 0, 32, 0x00);
    assert.strictEqual(line[0], GREEN); assert.strictEqual(line[7], GREEN);
    assert.strictEqual(line[8], BLUE); assert.strictEqual(line[11], BLUE);
    assert.strictEqual(line[12], BLACK);
    vdg.drawLine(line, 0, ram, 0x400, 6, 32, 0x00);  // lower half
    assert.strictEqual(line[0], GREEN);
    assert.strictEqual(line[8], BLACK);
  });

  it('draws RG6: 256 pixels of 1 bit', () => {
    const ram = new Uint8Array(0x10000);
    ram[0x600] = 0x80; ram[0x601] = 0x01;
    vdg.drawLine(line, 0, ram, 0x600, 0, 32, 0xf0);
    assert.strictEqual(line[0], GREEN);
    assert.strictEqual(line[1], BLACK);
    assert.strictEqual(line[15], GREEN);
    vdg.drawLine(line, 0, ram, 0x600, 0, 32, 0xf8);  // color set 1: buff
    assert.strictEqual(line[0], VDG_PALETTE[4]);
  });

  it('draws CG6: 4 colors, 2 screen pixels each', () => {
    const ram = new Uint8Array(0x10000);
    ram[0x600] = 0x1b;                  // 00 01 10 11
    vdg.drawLine(line, 0, ram, 0x600, 0, 32, 0xe0);
    assert.deepStrictEqual([line[0], line[1], line[2], line[3], line[4], line[5], line[6], line[7]],
      [GREEN, GREEN, YELLOW, YELLOW, BLUE, BLUE, RED, RED]);
  });

  it('draws CG1: 64 pixels across, 4 screen pixels each', () => {
    const ram = new Uint8Array(0x10000);
    ram[0x600] = 0x1b;
    vdg.drawLine(line, 0, ram, 0x600, 0, 16, 0x80);
    assert.strictEqual(line[3], GREEN);
    assert.strictEqual(line[4], YELLOW);
    assert.strictEqual(line[12], RED);
    assert.strictEqual(line[15], RED);
  });
});

// a tiny DECB .bin: blocks of (0, len, addr, bytes), then (255, 0, 0, exec)
function decb(addr: number, exec: number, bytes: number[]): Uint8Array {
  return new Uint8Array([0, bytes.length >> 8, bytes.length & 255, addr >> 8, addr & 255,
    ...bytes, 0xff, 0, 0, exec >> 8, exec & 255]);
}

function boot(program: number[]): CoCoMachine {
  const m = new CoCoMachine();
  m.connectVideo(new Uint32Array(256 * 192));
  m.loadROM(decb(0x2800, 0x2800, program));
  m.reset();
  return m;
}

function frames(m: CoCoMachine, n: number) {
  for (let i = 0; i < n; i++) m.advanceFrame(() => false);
}

describe('DECB loader', () => {
  it('parses blocks and the exec address', () => {
    const d = parseDECB(decb(0x2800, 0x2802, [1, 2, 3]));
    assert.strictEqual(d.exec, 0x2802);
    assert.strictEqual(d.blocks.length, 1);
    assert.strictEqual(d.blocks[0].addr, 0x2800);
    assert.deepStrictEqual(Array.from(d.blocks[0].bytes), [1, 2, 3]);
  });

  it('rejects things that are not DECB files', () => {
    assert.strictEqual(parseDECB(new Uint8Array([0x44, 0x4b, 0, 0, 0, 0])), null);
    assert.strictEqual(parseDECB(new Uint8Array([0, 0, 9, 0x28, 0, 1])), null, 'block runs off the end');
    assert.strictEqual(parseDECB(new Uint8Array([0, 0, 1, 0x28, 0, 1])), null, 'no exec trailer');
  });
});

describe('CoCo machine', () => {
  // LDA #$41 / STA $0400 / BRA *
  const PRINT_A = [0x86, 0x41, 0xb7, 0x04, 0x00, 0x20, 0xfe];

  it('boots the ROM, clears the screen and runs the program', () => {
    const m = boot(PRINT_A);
    frames(m, 2);
    assert.strictEqual(m.ram[0x400], 0x41, 'program ran');
    assert.strictEqual(m.ram[0x401], 0x60, 'screen was cleared to green blanks');
    // the VDG shows it: top-left pixel is part of the cell's blank top lines
    assert.strictEqual(m.pixels[0], GREEN);
    // and the hardware was set up for text at $0400
    assert.strictEqual(m.sam.displayBase, 0x400);
    assert.strictEqual(m.pia1.outB & 0x80, 0, 'alphanumeric mode');
  });

  it('keeps a 60 Hz tick from the field sync interrupt', () => {
    const m = boot(PRINT_A);
    frames(m, 11);
    const ticks = (m.ram[0x112] << 8) | m.ram[0x113];
    assert.ok(ticks >= 9 && ticks <= 11, 'TIMER advanced once per frame: ' + ticks);
  });

  it('reads the keyboard matrix through PIA0', () => {
    const m = boot(PRINT_A);
    frames(m, 1);
    m.write(0xff02, 0xfd);              // strobe column 1 low
    assert.strictEqual(m.read(0xff00) & 0x7f, 0x7f, 'no key down');
    m.setKeyInput(65, 65, KeyFlags.KeyDown);       // A is row 0, column 1
    assert.strictEqual(m.read(0xff00) & 0x7f, 0x7e);
    m.write(0xff02, 0xfb);              // column 2: not A
    assert.strictEqual(m.read(0xff00) & 0x7f, 0x7f);
    m.setKeyInput(65, 65, KeyFlags.KeyUp);
    m.write(0xff02, 0xfd);
    assert.strictEqual(m.read(0xff00) & 0x7f, 0x7f);
  });

  it('maps typed punctuation to the CoCo keys, with SHIFT where needed', () => {
    const m = boot(PRINT_A);
    frames(m, 1);
    // PC '=' is SHIFT-'-' on a CoCo ('-' is row 5, column 5)
    m.setKeyInput(187, 0x3d, KeyFlags.KeyDown);
    m.write(0xff02, 0xdf);              // column 5
    assert.strictEqual(m.read(0xff00) & 0x20, 0, 'the - key is down');
    m.write(0xff02, 0x7f);              // column 7: SHIFT is row 6
    assert.strictEqual(m.read(0xff00) & 0x40, 0, 'SHIFT is down');
    m.setKeyInput(187, 0x3d, KeyFlags.KeyUp);
    assert.strictEqual(m.read(0xff00) & 0x40, 0x40, 'SHIFT released with it');
  });

  it('reports joystick axes through the DAC comparator', () => {
    const m = boot(PRINT_A);
    frames(m, 1);
    m.setPaddleInput(0, 255);
    m.write(0xff20, 0x80);              // DAC = 32
    assert.strictEqual(m.read(0xff00) & 0x80, 0x80, 'axis above the DAC');
    m.setPaddleInput(0, 0);
    assert.strictEqual(m.read(0xff00) & 0x80, 0, 'axis below the DAC');
  });

  it('reads the joysticks with the ROM routine at $A9DE', () => {
    // JSR $A9DE / BRA *
    const m = boot([0xbd, 0xa9, 0xde, 0x20, 0xfe]);
    m.setPaddleInput(0, 255);           // right X: full right
    m.setPaddleInput(1, 128);           // right Y: center
    frames(m, 2);
    assert.strictEqual(m.ram[0x15a], 63);
    assert.strictEqual(m.ram[0x15b], 32);
  });

  it('prints through the ROM routine CMOC calls at [$A002]', () => {
    // LDA #'H' / JSR [$A002] / LDA #'I' / JSR [$A002] / BRA *
    const m = boot([0x86, 0x48, 0xad, 0x9f, 0xa0, 0x02, 0x86, 0x49, 0xad, 0x9f, 0xa0, 0x02, 0x20, 0xfe]);
    frames(m, 2);
    assert.strictEqual(m.ram[0x400], 0x48);
    assert.strictEqual(m.ram[0x401], 0x49);
    assert.strictEqual((m.ram[0x88] << 8) | m.ram[0x89], 0x402, 'cursor advanced');
  });

  it('makes sound with the DAC, through the ROM routine at $A956', () => {
    // tone $80, duration $0010, then SOUND
    // LDA #$80 / STA $8C / LDX #$10 / STX $8D / JSR $A956 / BRA *
    const m = boot([0x86, 0x80, 0x97, 0x8c, 0x8e, 0x00, 0x10, 0x9f, 0x8d, 0xbd, 0xa9, 0x56, 0x20, 0xfe]);
    const samples: number[] = [];
    m.connectAudio({ feedSample: (v: number) => { samples.push(v); } });
    frames(m, 4);
    assert.ok(Math.max(...samples) > 0.2, 'DAC goes high');
    assert.ok(Math.min(...samples) < -0.2, 'and low');
  });

  it('runs twice as many instructions with the SAM fast clock', () => {
    // BRA * burns the whole frame; the fast clock doubles how many run
    const slow = boot([0x20, 0xfe]);
    const fast = boot([0xb7, 0xff, 0xd9, 0x20, 0xfe]);   // STA $FFD9 sets R1
    frames(slow, 1); frames(fast, 1);                     // run the boot ROM
    const a = slow.advanceFrame(() => false);
    const b = fast.advanceFrame(() => false);
    assert.ok(b > a * 1.9 && b < a * 2.1, `${b} instructions vs ${a}`);
  });

  it('restores its state', () => {
    const m = boot(PRINT_A);
    frames(m, 3);
    const s = m.saveState();
    const before = (m.ram[0x112] << 8) | m.ram[0x113];
    frames(m, 5);
    m.loadState(s);
    assert.strictEqual((m.ram[0x112] << 8) | m.ram[0x113], before);
    assert.strictEqual(m.cpu.getPC(), s.c.PC);
  });
});
