import assert from "assert";
import { describe, it } from "mocha";
import { CPU6809 } from "../../src/common/cpu/6809";

const C = 1, V = 2, Z = 4, N = 8, I = 16, F = 64;

// Run the bytes at 0x100 as one instruction with the given initial state;
// returns the CPU state afterwards and the cycles taken.
function run(code: number[], init: any = {}) {
  const mem = new Uint8Array(0x10000);
  code.forEach((b, i) => mem[0x100 + i] = b);
  mem[0xfffe] = 0x01; mem[0xffff] = 0x00;       // reset vector -> 0x100
  mem[0xfff4] = 0x12; mem[0xfff5] = 0x34;       // SWI2 vector
  mem[0xfff2] = 0x56; mem[0xfff3] = 0x78;       // SWI3 vector
  mem[0x2000] = 0x30; mem[0x2001] = 0x00;       // pointer for [$2000]
  const cpu: any = CPU6809();
  cpu.init((a: number, v: number) => { mem[a] = v; }, (a: number) => mem[a], () => {});
  const s = { ...cpu.saveState(), SP: 0x8000, U: 0, A: 0, B: 0, X: 0, Y: 0, DP: 0, CC: 0, T: 0, ...init };
  cpu.loadState(s);
  const cycles = cpu.advanceInsn();
  return { ...cpu.saveState(), cycles, mem };
}

describe('6809 CPU flags and timing', () => {
  it('NEG sets Z for 0, clears C for 0, sets C otherwise', () => {
    let r = run([0x40], { A: 0 });                  // NEGA
    assert.strictEqual(r.A, 0);
    assert.strictEqual(r.CC & (Z | C | N | V), Z);
    r = run([0x40], { A: 1 });
    assert.strictEqual(r.A, 0xff);
    assert.strictEqual(r.CC & (Z | C | N | V), C | N);
    r = run([0x40], { A: 0x80 });
    assert.strictEqual(r.CC & (Z | C | N | V), C | N | V);
  });
  it('ASL and ROL set N and Z', () => {
    assert.strictEqual(run([0x48], { A: 0x40 }).CC & (N | Z | V), N | V);   // ASLA
    assert.strictEqual(run([0x48], { A: 0x80 }).CC & (N | Z | C | V), Z | C | V);
    assert.strictEqual(run([0x49], { A: 0x40 }).CC & (N | Z | V), N | V);   // ROLA
    assert.strictEqual(run([0x49], { A: 0x80, CC: 0 }).CC & (N | Z | C), Z | C);
    assert.strictEqual(run([0x49], { A: 0x00, CC: C }).A, 1);
  });
  it('INC and DEC set V only on signed overflow', () => {
    assert.strictEqual(run([0x4c], { A: 0xff, CC: V }).CC & (V | Z), Z);   // INCA
    assert.strictEqual(run([0x4c], { A: 0x7f }).CC & (V | N), V | N);
    assert.strictEqual(run([0x4a], { A: 0x00, CC: V }).CC & (V | N), N);   // DECA
    assert.strictEqual(run([0x4a], { A: 0x80 }).CC & (V | N), V);
  });
  it('DAA preserves C and SEX leaves V alone', () => {
    assert.strictEqual(run([0x19], { A: 0x10, CC: C }).CC & C, C);
    assert.strictEqual(run([0x1d], { B: 0x80, CC: V }).CC & (V | N), V | N);
  });
  it('STD sets N and Z', () => {
    assert.strictEqual(run([0xdd, 0x10], { A: 0x80, B: 0, CC: V }).CC & (N | Z | V), N);
    assert.strictEqual(run([0xfd, 0x20, 0x00], { A: 0, B: 0 }).CC & (N | Z), Z);
    assert.strictEqual(run([0xed, 0x84], { A: 0, B: 0, X: 0x1000 }).CC & (N | Z), Z);
  });
  it('SWI2 and SWI3 leave I and F alone, SWI sets them', () => {
    let r = run([0x10, 0x3f]);
    assert.strictEqual(r.CC & (I | F), 0);
    assert.strictEqual(r.PC, 0x1234);
    r = run([0x11, 0x3f]);
    assert.strictEqual(r.CC & (I | F), 0);
    assert.strictEqual(r.PC, 0x5678);
    assert.strictEqual(run([0x3f]).CC & (I | F), I | F);
  });
  it('indexed extended indirect takes 5 extra cycles', () => {
    const base = run([0xa6, 0x84], { X: 0x1000 }).cycles;       // LDA ,X = 4
    assert.strictEqual(base, 4);
    assert.strictEqual(run([0xa6, 0x9f, 0x20, 0x00]).cycles, 4 + 5);  // LDA [$2000]
    assert.strictEqual(run([0xa6, 0x94], { X: 0x2000 }).cycles, 4 + 3); // LDA [,X]
  });
  it('taken long branches take one more cycle than untaken', () => {
    assert.strictEqual(run([0x10, 0x27, 0x00, 0x10], { CC: Z }).cycles, 6);   // LBEQ taken
    assert.strictEqual(run([0x10, 0x27, 0x00, 0x10], { CC: 0 }).cycles, 5);
    assert.strictEqual(run([0x10, 0x27, 0x00, 0x10], { CC: Z }).PC, 0x114);
  });
});
