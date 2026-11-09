// The call graph behind the IDE's Call Graph window, built from probe events
// (see probe.ts). A call is a call instruction (or an interrupt) after which
// the stack pointer went down; a return is a return instruction after which
// it went up. Conditional calls and returns that aren't taken leave SP alone,
// so they don't count, and neither do pushes and pops of data.
//
// Clocks (CLOCKS events) are charged to the routine running: `self` to it
// alone, `total` to it and everything above it on the stack. A call or
// return instruction's own clocks count in the routine it started in.
//
// An interrupt is a call too, whether or not the machine reports it. One that
// lands right after a call instruction swallows that call: the next instruction
// run is the handler's, and the callee's first runs only after the handler
// returns. The call is entered then (see callLost).
//
// Where the instruction can't be told (no disassembler), it falls back to
// guessing from how far SP moved and how far the PC jumped.

import { ProbeFlags } from "./probe";

export interface CallGraphNode {
  $$SP: number;
  $$PC: number;
  count: number;
  /** clocks in this routine, not counting its callees */
  self: number;
  /** clocks in this routine and its callees */
  total: number;
  startLine: number;
  endLine: number;
  calls: { [name: string]: CallGraphNode };
}

export type InsnKind = 'call' | 'return' | 'other' | 'unknown';

export class CallGraphBuilder {
  graph: CallGraphNode | null = null;
  /** the root first, the routine running now last */
  stack: CallGraphNode[] = [];
  private lastsp = -1;
  private lastpc = 0;
  /** SP as the last instruction started */
  private spAtLastExec = -1;
  private interrupted = false;
  /**
   * Stack depths of handlers that interrupted a call instruction before the
   * callee ran: when one returns, the PC is the callee's entry, so the call
   * is entered there. (Else the callee's RTS would pop its caller's frame.)
   */
  private callLost = new Set<number>();
  /** the root stands for callers we never saw call (see leave) */
  private rootIsCaller = false;
  // for the fallback guess
  private jsr = false;
  private rts = false;

  /**
   * `classify` says what the instruction at an address is; `name` names a
   * routine by its address (a symbol, or hex).
   */
  constructor(private classify: (pc: number) => InsnKind, private name: (pc: number) => string) { }

  /** Forget everything. */
  clear() {
    this.graph = null;
    this.rootIsCaller = false;
    this.reset();
  }

  /** Forget where it is, but keep the graph. */
  reset() {
    this.stack = [];
    this.callLost.clear();
    this.lastsp = -1;
    this.lastpc = 0;
    this.spAtLastExec = -1;
    this.interrupted = false;
    this.jsr = false;
    this.rts = false;
  }

  private newNode(pc: number, sp: number): CallGraphNode {
    return { $$SP: sp, $$PC: pc, count: 0, self: 0, total: 0, startLine: null, endLine: null, calls: {} };
  }

  private enter(pc: number, row: number, lostCall = false) {
    const top = this.stack[this.stack.length - 1];
    const sym = this.name(pc);
    let child = top.calls[sym];
    if (child == null) child = top.calls[sym] = this.newNode(pc, this.lastsp);
    else if (child.$$PC == null) child.$$PC = pc;
    this.stack.push(child);
    if (lostCall) this.callLost.add(this.stack.length - 1);
    child.count++;
    child.startLine = row;
  }

  /** Returns true if the routine left had interrupted a call (see callLost). */
  private leave(row: number): boolean {
    if (this.stack.length > 1) {
      const lost = this.callLost.delete(this.stack.length - 1);
      this.stack.pop().endLine = row;
      return lost;
    } else if (!this.rootIsCaller) {
      // it returned from where it was when we started: into a caller we
      // didn't see call, which becomes the new root
      this.rootIsCaller = true;
      this.callLost.clear();
      const old = this.stack[0];
      this.graph = this.newNode(null, this.lastsp);
      this.graph.total = old.total;
      this.graph.calls[this.name(this.lastpc)] = old;
      this.stack = [this.graph];
    }
    // else the root already stands for the unseen callers. A later return
    // from it is another one of them (or a call we never saw): wrapping the
    // tree once more would only stack a level per return, each named for the
    // same RTS and nested over the real routines, so leave the root be.
    return false;
  }

  /** Charge `n` clocks to the routine running now. */
  clocks(n: number) {
    const stack = this.stack;
    if (!stack.length) return;
    stack[stack.length - 1].self += n;
    for (const node of stack) node.total += n;
  }

  /** One probe event (for CLOCKS, `addr` is the number of clocks). */
  event(op: number, addr: number, row: number) {
    switch (op) {
      case ProbeFlags.CLOCKS:
        this.clocks(addr);
        break;
      case ProbeFlags.INTERRUPT:
        this.interrupted = true;
        break;
      case ProbeFlags.SP_POP:
      case ProbeFlags.SP_PUSH:
        if (this.stack.length) {
          const top = this.stack[this.stack.length - 1];
          const delta = this.lastsp - addr;
          if ((delta == 2 || delta == 3) && addr < top.$$SP) this.jsr = true;
          if ((delta == -2 || delta == -3) && this.stack.length > 1 && addr > top.$$SP) this.rts = true;
        }
        this.lastsp = addr;
        break;
      case ProbeFlags.EXECUTE: {
        if (!this.stack.length) {
          this.graph ??= this.newNode(null, this.lastsp);
          this.stack = [this.graph];
        }
        const kind = this.spAtLastExec >= 0 ? this.classify(this.lastpc) : 'unknown';
        if (kind === 'unknown' && !this.interrupted) {
          this.guess(addr, row);
        } else {
          const pushed = this.lastsp < this.spAtLastExec;
          const popped = this.lastsp > this.spAtLastExec;
          // A push that ends in a jump can only be an interrupt or BRK, since
          // a PUSH falls through. Many machines don't log their interrupts.
          const implicitIrq = kind === 'other' && pushed && Math.abs(addr - this.lastpc) >= 4;
          if ((kind === 'call' || this.interrupted || implicitIrq) && pushed) {
            // a call instruction pushes one return address; more than that
            // (or a reported interrupt) means an interrupt took the next slot
            const lost = kind === 'call' && (this.interrupted || this.spAtLastExec - this.lastsp > 3);
            this.enter(addr, row, lost);
          } else if (kind === 'return' && popped) {
            // the handler is done and the PC is the callee the interrupt cut off
            if (this.leave(row)) this.enter(addr, row);
          }
          this.jsr = this.rts = false;
        }
        this.interrupted = false;
        this.lastpc = addr;
        this.spAtLastExec = this.lastsp;
        break;
      }
    }
  }

  /** The old guess: SP moved by an address's worth, and the PC jumped. */
  private guess(addr: number, row: number) {
    if (Math.abs(addr - this.lastpc) >= 4) {
      if (this.jsr) this.enter(addr, row);
      if (this.rts) this.leave(row);
      this.jsr = this.rts = false;
    }
  }
}
