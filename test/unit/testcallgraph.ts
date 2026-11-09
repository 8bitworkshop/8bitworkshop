import assert from "assert";
import { describe, it } from "mocha";
import { CallGraphBuilder, InsnKind } from "../../src/common/callgraph";
import { ProbeFlags } from "../../src/common/probe";

// Feed a builder the events the probe would log: before each instruction,
// the SP change the previous one made, then the instruction's address.
function run(kinds: { [pc: number]: InsnKind }, steps: [number, number][]) {
  const b = new CallGraphBuilder(pc => kinds[pc] ?? 'other', pc => '$' + pc.toString(16));
  let sp = -1;
  for (const [pc, newsp] of steps) {
    if (newsp !== sp) {
      b.event(newsp < sp ? ProbeFlags.SP_PUSH : ProbeFlags.SP_POP, newsp, 0);
      sp = newsp;
    }
    b.event(ProbeFlags.EXECUTE, pc, 0);
  }
  return b;
}

describe('Call graph', function () {
  it('follows calls and returns, not pushes and jumps', function () {
    const b = run({ 0x102: 'call', 0x205: 'return', 0x110: 'call' }, [
      [0x100, 0xf004],
      [0x102, 0xf004],  // CALL $200
      [0x200, 0xf002],
      [0x201, 0xf002],  // PUSH HL, then a jump: not a call
      [0x202, 0xf000],
      [0x300, 0xf000],
      [0x204, 0xf002],  // POP HL
      [0x205, 0xf002],  // RET
      [0x103, 0xf004],
      [0x110, 0xf004],  // CALL C,$200, not taken: SP stays
      [0x113, 0xf004],
    ]);
    assert.deepStrictEqual(Object.keys(b.graph.calls), ['$200']);
    assert.strictEqual(b.graph.calls['$200'].count, 1);
    assert.deepStrictEqual(Object.keys(b.graph.calls['$200'].calls), []);
    assert.strictEqual(b.stack.length, 1);
  });

  it('counts an interrupt as a call', function () {
    const b = new CallGraphBuilder(() => 'other', pc => '$' + pc.toString(16));
    b.event(ProbeFlags.SP_POP, 0x1ff, 0);
    b.event(ProbeFlags.EXECUTE, 0x8000, 0);
    b.event(ProbeFlags.EXECUTE, 0x8001, 0);
    b.event(ProbeFlags.INTERRUPT, 0, 0);
    b.event(ProbeFlags.SP_PUSH, 0x1fc, 0);
    b.event(ProbeFlags.EXECUTE, 0x9000, 0);
    assert.deepStrictEqual(Object.keys(b.graph.calls), ['$9000']);
  });

  it('counts an unreported interrupt as a call, so its return is not a new root', function () {
    // an NMI: the interrupted instruction is not a call, SP drops by 3 and the PC jumps
    const b = run({ 0x9002: 'return' }, [
      [0x100, 0x1ff], [0x101, 0x1ff],
      [0x9000, 0x1fc], [0x9001, 0x1fc], [0x9002, 0x1fc],  // NMI handler, ends in RTI
      [0x102, 0x1ff], [0x103, 0x1ff],
    ]);
    assert.deepStrictEqual(Object.keys(b.graph.calls), ['$9000']);
    assert.strictEqual(b.graph.calls['$9000'].count, 1);
    assert.strictEqual(b.stack.length, 1);
    assert.strictEqual(b.graph.$$PC, null);  // the root was not re-parented
  });

  it('returns past where it started into a new root', function () {
    const b = run({ 0x205: 'return' }, [[0x204, 0xf000], [0x205, 0xf000], [0x103, 0xf002]]);
    assert.deepStrictEqual(Object.keys(b.graph.calls), ['$205']);
    assert.strictEqual(b.stack.length, 1);
  });

  it('wraps the root once, however many returns leave it', function () {
    // Returns at the root again and again (calls the trace window missed),
    // always from the same RTS: one new root, not a level per return.
    const b = run({ 0x205: 'return', 0x102: 'call', 0x300: 'return' }, [
      [0x204, 0xf000], [0x205, 0xf000],   // return past the start: new root
      [0x103, 0xf002], [0x204, 0xf002], [0x205, 0xf002],  // and again
      [0x103, 0xf004], [0x102, 0xf004],   // a real call from the new root
      [0x300, 0xf002], [0x300, 0xf002], [0x103, 0xf004],
    ]);
    assert.deepStrictEqual(Object.keys(b.graph.calls).sort(), ['$205', '$300']);
    assert.deepStrictEqual(Object.keys(b.graph.calls['$205'].calls), []);
    assert.strictEqual(b.stack.length, 1);
  });

  it('enters a call that an interrupt cut off, so the callee does not pop its caller', function () {
    // A call at 0x102 and an IRQ before the callee's first instruction:
    // SP drops 2 for the return address and 12 for the IRQ frame. The handler
    // (0x9000) ends in RTI and the PC is then the callee, 0x200, which RETs.
    const b = run({ 0x102: 'call', 0x9002: 'return', 0x201: 'return' }, [
      [0x100, 0xf100], [0x101, 0xf100],
      [0x101, 0xf100],
      [0x102, 0xf100],                     // CALL $200 ...
      [0x9000, 0xf0f2], [0x9001, 0xf0f2], [0x9002, 0xf0f2],  // ... IRQ: handler
      [0x200, 0xf0fe],                     // RTI: back at the callee
      [0x201, 0xf0fe],                     // RET
      [0x103, 0xf100],
    ]);
    assert.deepStrictEqual(Object.keys(b.graph.calls).sort(), ['$200', '$9000']);
    assert.strictEqual(b.graph.calls['$200'].count, 1);
    assert.strictEqual(b.stack.length, 1);
    assert.strictEqual(b.graph.$$PC, null);  // nothing was popped from, or wrapped around, the root
  });

  it('guesses from SP and PC when it cannot tell the instruction', function () {
    const kinds = new Proxy({}, { get: () => 'unknown' }) as any;
    const b = run(kinds, [[0x100, 0x1ff], [0x101, 0x1ff], [0x200, 0x1fd]]);
    assert.deepStrictEqual(Object.keys(b.graph.calls), ['$200']);
  });

  it('charges clocks to the routine running and to its callers', function () {
    const b = new CallGraphBuilder(pc => pc === 0x102 ? 'call' : pc === 0x201 ? 'return' : 'other', pc => '$' + pc.toString(16));
    const step = (pc: number, sp: number, clocks: number) => {
      if (sp !== (step as any).sp) b.event(sp < (step as any).sp ? ProbeFlags.SP_PUSH : ProbeFlags.SP_POP, sp, 0);
      (step as any).sp = sp;
      b.event(ProbeFlags.EXECUTE, pc, 0);
      b.event(ProbeFlags.CLOCKS, clocks, 0);
    };
    (step as any).sp = -1;
    step(0x100, 0xf004, 4);
    step(0x102, 0xf004, 6);  // CALL $200
    step(0x200, 0xf002, 10);
    step(0x201, 0xf002, 6);  // RET
    step(0x103, 0xf004, 4);
    const call = b.graph.calls['$200'];
    assert.strictEqual(call.self, 16);
    assert.strictEqual(call.total, 16);
    assert.strictEqual(b.graph.self, 4 + 6 + 4);  // the CALL counts where it started; so does the RET, in $200
    assert.strictEqual(b.graph.total, 30);
  });
});
