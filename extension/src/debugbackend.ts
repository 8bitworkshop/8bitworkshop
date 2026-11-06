// debugbackend - the debug adapter's view of the emulator worker. The
// adapter (src/tools/dapsession.ts, shared with `8bws dap`) runs in the
// extension host; each call goes to the worker's DebugService over the RPC,
// and the worker's 'stopped' events come back through handleStop().

import type { StopEvent } from '../../src/common/debugcontroller';
import type { DebugBackend, LaunchArgs, LaunchResult } from '../../src/tools/dapsession';
import type { DebugService } from '../../src/tools/debugservice';

/** Calls the running emulator worker's `debug` RPC. */
export type DebugCall = (method: string, ...args: any[]) => Promise<any>;

export class WorkerDebugBackend implements DebugBackend {
  private stopListeners: ((e: StopEvent) => void)[] = [];
  private outputListeners: ((text: string) => void)[] = [];

  /**
   * `launcher` builds the program and starts the emulator stopped (see
   * emuworker's LoadOptions.paused), then hands over its build (setBuild).
   */
  constructor(
    private call: DebugCall,
    private launcher: (args: LaunchArgs) => Promise<{ root: string }>,
    private stopper: () => Promise<void>) { }

  onStop(fn: (e: StopEvent) => void) { this.stopListeners.push(fn); }
  onOutput(fn: (text: string) => void) { this.outputListeners.push(fn); }

  /** A 'stopped' event from the worker. */
  handleStop(e: StopEvent) { this.stopListeners.forEach(fn => fn(e)); }

  /** Something to show in the Debug Console. */
  output(text: string) { this.outputListeners.forEach(fn => fn(text)); }

  async launch(args: LaunchArgs): Promise<LaunchResult> {
    const { root } = await this.launcher(args);
    if (args.script) {
      const r = await this.call('evaluate', args.script, 'repl');
      if (r.result) this.output(r.result + '\n');
    }
    return { capabilities: await this.call('capabilities'), root };
  }

  terminate() { return this.stopper(); }

  setBreakpoints(...a: Parameters<DebugService['setBreakpoints']>) { return this.call('setBreakpoints', ...a); }
  continue() { return this.call('continue'); }
  step(...a: Parameters<DebugService['step']>) { return this.call('step', ...a); }
  pause() { return this.call('pause'); }
  stepBack(...a: Parameters<DebugService['stepBack']>) { return this.call('stepBack', ...a); }
  reverseContinue() { return this.call('reverseContinue'); }
  location() { return this.call('location'); }
  callStack(...a: Parameters<DebugService['callStack']>) { return this.call('callStack', ...a); }
  registers() { return this.call('registers'); }
  readMemory(...a: Parameters<DebugService['readMemory']>) { return this.call('readMemory', ...a); }
  writeMemory(...a: Parameters<DebugService['writeMemory']>) { return this.call('writeMemory', ...a); }
  debugTree(...a: Parameters<DebugService['debugTree']>) { return this.call('debugTree', ...a); }
  signalTree(...a: Parameters<DebugService['signalTree']>) { return this.call('signalTree', ...a); }
  symbols() { return this.call('symbols'); }
  disassemble(...a: Parameters<DebugService['disassemble']>) { return this.call('disassemble', ...a); }
  inlineValues(...a: Parameters<DebugService['inlineValues']>) { return this.call('inlineValues', ...a); }
  evaluate(...a: Parameters<DebugService['evaluate']>) { return this.call('evaluate', ...a); }
}
