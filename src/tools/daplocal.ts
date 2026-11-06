// A DebugBackend that runs the emulator in this process: for `8bws dap`, and
// for testing the adapter without VS Code. Running has no display to keep
// pace with, so it goes as fast as it can, a few frames at a time, taking
// requests (pause) in between.

import type { StopEvent } from '../common/debugcontroller';
import type { DebugBackend, LaunchArgs, LaunchResult } from './dapsession';
import { BuildInfo, DebugService } from './debugservice';
import type { EmuTarget } from './emutarget';

// frames to run between looking for requests
const FRAMES_PER_SLICE = 4;

export interface LoadedProgram {
  target: EmuTarget;
  debugInfo?: BuildInfo;
  /** the directory project paths are relative to */
  root: string;
}

export class LocalDebugBackend implements DebugBackend {
  private service: DebugService | null = null;
  private stopListeners: ((e: StopEvent) => void)[] = [];
  private outputListeners: ((text: string) => void)[] = [];
  private looping = false;

  constructor(private load: (args: LaunchArgs) => Promise<LoadedProgram>) { }

  onStop(fn: (e: StopEvent) => void) { this.stopListeners.push(fn); }
  onOutput(fn: (text: string) => void) { this.outputListeners.push(fn); }

  async launch(args: LaunchArgs): Promise<LaunchResult> {
    const prog = await this.load(args);
    const svc = this.service = new DebugService(prog.target, e => this.stopListeners.forEach(fn => fn(e)));
    if (prog.debugInfo) svc.setBuild(prog.debugInfo);
    if (args.script) {
      const r = svc.evaluate(args.script, 'repl');
      if (r.result) this.outputListeners.forEach(fn => fn(r.result + '\n'));
    }
    return { capabilities: svc.capabilities(), root: prog.root };
  }

  async terminate() {
    this.service = null;
  }

  async setBreakpoints(...a: Parameters<DebugService['setBreakpoints']>) { return this.svc.setBreakpoints(...a); }
  async continue() { this.svc.continue(); this.loop(); }
  async step(...a: Parameters<DebugService['step']>) { this.svc.step(...a); this.loop(); }
  async pause() { this.svc.pause(); }
  async stepBack(...a: Parameters<DebugService['stepBack']>) { this.svc.stepBack(...a); }
  async reverseContinue() { this.svc.reverseContinue(); }
  async location() { return this.svc.location(); }
  async callStack(...a: Parameters<DebugService['callStack']>) { return this.svc.callStack(...a); }
  async registers() { return this.svc.registers(); }
  async readMemory(...a: Parameters<DebugService['readMemory']>) { return this.svc.readMemory(...a); }
  async writeMemory(...a: Parameters<DebugService['writeMemory']>) { return this.svc.writeMemory(...a); }
  async debugTree(...a: Parameters<DebugService['debugTree']>) { return this.svc.debugTree(...a); }
  async signalTree(...a: Parameters<DebugService['signalTree']>) { return this.svc.signalTree(...a); }
  async symbols() { return this.svc.symbols(); }
  async disassemble(...a: Parameters<DebugService['disassemble']>) { return this.svc.disassemble(...a); }
  async inlineValues(...a: Parameters<DebugService['inlineValues']>) { return this.svc.inlineValues(...a); }
  async evaluate(...a: Parameters<DebugService['evaluate']>) { return this.svc.evaluate(...a); }

  private get svc(): DebugService {
    if (!this.service) throw new Error('no program is loaded');
    return this.service;
  }

  /** Work toward the goal a slice at a time until it stops. */
  private loop() {
    if (this.looping) return;
    this.looping = true;
    const slice = () => {
      const svc = this.service;
      if (!svc || !svc.running) { this.looping = false; return; }
      try {
        svc.advance(FRAMES_PER_SLICE);
      } catch (e) {
        this.looping = false;
        this.outputListeners.forEach(fn => fn(`emulator error: ${e?.stack || e}\n`));
        svc.pause();
        return;
      }
      setImmediate(slice);
    };
    setImmediate(slice);
  }
}
