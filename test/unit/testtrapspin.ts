import assert from "assert";
import { describe, it } from "mocha";
import {
  Base6502Platform,
  BaseZ80Platform,
  DebugSymbols,
  EmuState,
  TRAP_SPIN_FRAMES,
} from "../../src/common/baseplatform";
import { EmuHalt } from "../../src/common/emu";

// A platform only as far as the trap watchdog needs it: a PC, an SP, memory
// and a symbol table. The real ones add video, input and breakpoints.
class Fake6502 extends Base6502Platform {
  pc = 0;
  sp = 0xfd;
  stable = true;
  mem = new Uint8Array(0x10000);

  constructor(spin = 0x8000) {
    super();
    this.debugSymbols = new DebugSymbols({ __trap_spin: spin }, {});
  }
  readAddress(addr: number) { return this.mem[addr & 0xffff]; }
  getCPUState() { return { PC: this.pc, SP: this.sp, A: 0, X: 0, Y: 0 }; }
  isStable() { return this.stable; }
  loadState(state: EmuState) { }
  saveState(): EmuState { return {}; }
  pause() { }
  resume() { }
  advance() { return 0; }
}

class FakeZ80 extends BaseZ80Platform {
  pc = 0;
  sp = 0x1000;
  mem = new Uint8Array(0x10000);

  constructor(spin = 0x8000) {
    super();
    this.debugSymbols = new DebugSymbols({ __trap_spin: spin }, {});
  }
  readAddress(addr: number) { return this.mem[addr & 0xffff]; }
  getPC() { return this.pc; }
  getSP() { return this.sp; }
  getCPUState() { return { PC: this.pc, SP: this.sp, AF: 0, BC: 0, DE: 0, HL: 0 }; }
  isStable() { return true; }
  loadState(state: EmuState) { }
  saveState(): EmuState { return {}; }
  pause() { }
  resume() { }
  advance() { return 0; }
}

function trap(times: number, p: { checkTrapSpin(): void }) {
  for (let i = 0; i < times; i++) p.checkTrapSpin();
}

describe('trap spin watchdog', function () {
  it('waits ten consecutive frames before halting', function () {
    const p = new Fake6502(0x8000);
    p.pc = 0x8000;
    trap(TRAP_SPIN_FRAMES - 1, p);
    assert.throws(() => p.checkTrapSpin(), (e) => e instanceof EmuHalt);
  });

  it('resets the count when the PC leaves the spin', function () {
    const p = new Fake6502(0x8000);
    p.pc = 0x8000;
    trap(TRAP_SPIN_FRAMES - 1, p);
    p.pc = 0x1234;
    p.checkTrapSpin();
    p.pc = 0x8000;
    trap(TRAP_SPIN_FRAMES - 1, p);
    assert.throws(() => p.checkTrapSpin(), (e) => e instanceof EmuHalt);
  });

  it('keeps counting through frames that end mid-instruction', function () {
    const p = new Fake6502(0x8000);
    p.pc = 0x8000;
    trap(1, p);                 // a stable frame on the spin
    p.stable = false;
    p.pc = 0x1234;              // the WASM cores' PC is not the opcode here
    trap(TRAP_SPIN_FRAMES - 2, p);
    p.stable = true;
    p.pc = 0x8000;
    assert.throws(() => p.checkTrapSpin(), (e) => e instanceof EmuHalt);
  });

  it('reads a 6502 JSR return address off the stack (minus 2)', function () {
    const p = new Fake6502(0x8000);
    p.pc = 0x8000;
    // jsr pushed site + 2; SP points just below the two bytes
    p.mem[0x100 + p.sp + 1] = (0x1234 + 2) & 0xff;
    p.mem[0x100 + p.sp + 2] = (0x1234 + 2) >> 8;
    assert.throws(() => trap(TRAP_SPIN_FRAMES, p),
      (e) => e instanceof EmuHalt && e.message === 'Program trapped at $1234');
  });

  it('reads a Z80 CALL return address off the stack (minus 3)', function () {
    const p = new FakeZ80(0x8000);
    p.pc = 0x8000;
    // call pushed site + 3, low byte first
    p.mem[p.sp] = (0xBEEF + 3) & 0xff;
    p.mem[p.sp + 1] = (0xBEEF + 3) >> 8;
    assert.throws(() => trap(TRAP_SPIN_FRAMES, p),
      (e) => e instanceof EmuHalt && e.message === 'Program trapped at $BEEF');
  });

  it('does nothing without the symbol, or on a platform with no stack to read', function () {
    const p = new Fake6502(0x8000);
    p.debugSymbols = new DebugSymbols({}, {});
    p.pc = 0x8000;
    trap(TRAP_SPIN_FRAMES * 2, p);

    // the base class has no architecture and so no site, but the spin is
    // still a hang
    const q = new Fake6502(0x8000);
    q.getTrapSite = () => null;
    q.pc = 0x8000;
    assert.throws(() => trap(TRAP_SPIN_FRAMES, q),
      (e) => e instanceof EmuHalt && e.message === 'Program trapped in __trap_spin');
  });
});
