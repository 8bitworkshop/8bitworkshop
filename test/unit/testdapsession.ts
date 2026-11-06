import assert from "assert";
import { before, describe, it } from "mocha";
import { EmuDebugSession } from "../../src/tools/dapsession";
import { DapClient } from "./dapclient";
import type { Breakpoint } from "../../src/common/breakpoints";
import type { DebugBackend } from "../../src/tools/dapsession";
import { LocalDebugBackend } from "../../src/tools/daplocal";
import { loadPlatform } from "../../src/tools/emutarget";
import { compileSourceFile, preload } from "../../src/tools/testlib";

// The debug adapter, driven with DAP messages as VS Code sends them, over the
// in-process backend `8bws dap` uses.

const ROOT = '/proj';
let build: any;

async function launch(args: any = {}): Promise<DapClient> {
  const backend = new LocalDebugBackend(async () => {
    const target = await loadPlatform('mw8080bw');
    await target.start();
    await target.loadROM(build.output);
    return { target, root: ROOT, debugInfo: { listings: build.listings, symbolmap: build.symbolmap, symbolsizes: { _draw_char: 4, _main: 100 }, mainPath: 'game2.c' } };
  });
  const c = new DapClient(new EmuDebugSession(backend));
  const caps = await c.request('initialize', { adapterID: '8bitworkshop', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' });
  assert.ok(caps.supportsDisassembleRequest);
  await c.request('launch', { program: 'game2.c', ...args });
  await c.event('initialized');
  const { capabilities } = await c.event('capabilities');
  assert.strictEqual(capabilities.supportsStepBack, true);
  return c;
}

describe('Debug adapter', function () {
  this.timeout(120000);

  before(async function () {
    await preload('sdcc', 'mw8080bw');
    build = await compileSourceFile('sdcc', 'mw8080bw', 'presets/mw8080bw/game2.c');
    assert.deepStrictEqual(build.errors || [], []);
  });

  it('stops at a source breakpoint, steps by line, and steps back', async function () {
    const c = await launch();
    const { breakpoints } = await c.request('setBreakpoints', { source: { path: `${ROOT}/game2.c` }, breakpoints: [{ line: 166 }] });
    assert.strictEqual(breakpoints[0].verified, true);
    assert.strictEqual(breakpoints[0].line, 166);
    await c.request('configurationDone');
    const hit = await c.event('stopped');
    assert.strictEqual(hit.reason, 'breakpoint');
    assert.deepStrictEqual(hit.hitBreakpointIds, [breakpoints[0].id]);
    let frame = await c.where();
    assert.strictEqual(frame.source.path, `${ROOT}/game2.c`);
    assert.strictEqual(frame.line, 166);
    assert.strictEqual(frame.name, '_draw_string+31');

    await c.request('next', { threadId: 1 });
    assert.strictEqual((await c.event('stopped')).reason, 'step');
    assert.strictEqual((await c.where()).line, 167);

    await c.request('stepBack', { threadId: 1 });
    assert.strictEqual((await c.event('stopped')).reason, 'step');
    frame = await c.where();
    assert.strictEqual(frame.line, 166);
    assert.strictEqual(frame.name, '_draw_string+31');
  });

  it('shows registers, memory and disassembly around the PC', async function () {
    const c = await launch();
    await c.request('setFunctionBreakpoints', { breakpoints: [{ name: 'draw_char' }] });
    await c.request('configurationDone');
    assert.strictEqual((await c.event('stopped')).reason, 'breakpoint');
    const frame = await c.where();
    const pc = parseInt(frame.instructionPointerReference, 16);
    assert.strictEqual(pc, build.symbolmap['_draw_char']);
    // the callers, from return addresses on the stack
    const { stackFrames, totalFrames } = await c.request('stackTrace', { threadId: 1 });
    assert.deepStrictEqual(stackFrames.map((f: any) => `${f.name.replace(/\+\d+$/, '')} ${f.line}`),
      ['_draw_char 155', '_draw_string 168', '_draw_playfield 391', '_play_round 487', '_play_game 533', '_main 552']);
    assert.strictEqual(totalFrames, 6);
    assert.ok(stackFrames.every((f: any) => !f.presentationHint));
    const callers = await c.request('stackTrace', { threadId: 1, startFrame: 1, levels: 2 });
    assert.deepStrictEqual(callers.stackFrames.map((f: any) => f.id), [1, 2]);

    const { scopes } = await c.request('scopes', { frameId: frame.id });
    const { variables } = await c.request('variables', { variablesReference: scopes[0].variablesReference });
    const reg = variables.find((v: any) => v.name === 'PC');
    assert.strictEqual(parseInt(reg.value.slice(1), 16), pc);

    const { instructions } = await c.request('disassemble', { memoryReference: frame.instructionPointerReference, instructionOffset: -3, instructionCount: 6 });
    assert.strictEqual(instructions.length, 6);
    assert.strictEqual(parseInt(instructions[3].address, 16), pc);
    assert.strictEqual(instructions[3].symbol, '_draw_char');
  });

  it('shows the machine tree and symbols', async function () {
    const c = await launch();
    await c.request('setFunctionBreakpoints', { breakpoints: [{ name: 'draw_char' }] });
    await c.request('configurationDone');
    await c.event('stopped');
    const frame = await c.where();
    const { scopes } = await c.request('scopes', { frameId: frame.id });
    assert.deepStrictEqual(scopes.map((s: any) => s.name), ['Registers', 'Machine', 'Symbols']);

    const machine = await c.request('variables', { variablesReference: scopes[1].variablesReference });
    const state = machine.variables.find((v: any) => v.name === 'state');
    assert.ok(state.variablesReference);
    const stateVars = await c.request('variables', { variablesReference: state.variablesReference });
    assert.ok(stateVars.variables.find((v: any) => v.name === 'c'), 'CPU state under state');

    const syms = await c.request('variables', { variablesReference: scopes[2].variablesReference });
    const sym = syms.variables.find((v: any) => v.name === '_draw_char');
    assert.ok(sym.value.includes('$' + build.symbolmap['_draw_char'].toString(16).padStart(4, '0').toUpperCase()), 'symbol shows its address');
    assert.match(sym.value, /\[4\]: ([0-9A-F]{2} ){3}[0-9A-F]{2}$/, 'a sized symbol shows all its bytes');
    const big = syms.variables.find((v: any) => v.name === '_main');
    assert.match(big.value, /\[100\]: ([0-9A-F]{2} ){31}[0-9A-F]{2} \.\.\.$/, 'a big symbol shows a prefix');
  });

  it('runs run-script commands in the Debug Console, and expressions in watches', async function () {
    const c = await launch();
    await c.request('setFunctionBreakpoints', { breakpoints: [{ name: 'draw_char' }] });
    await c.request('configurationDone');
    await c.event('stopped');
    const hover = await c.request('evaluate', { expression: 'SP', context: 'hover' });
    assert.match(hover.result, /^\$[0-9A-F]{4} \(\d+\)$/);
    const symHover = await c.request('evaluate', { expression: 'draw_char', context: 'hover' });
    assert.match(symHover.result, /^\$[0-9A-F]{4}\[4\]: ([0-9A-F]{2} ){3}[0-9A-F]{2}$/, 'a symbol hovers as its contents');
    const back = await c.request('evaluate', { expression: 'back 3', context: 'repl' });
    assert.match(back.result, /back 3: PC=/);
    assert.strictEqual((await c.event('stopped')).reason, 'goto');
    const now = await c.request('evaluate', { expression: 'now', context: 'repl' });
    assert.match(now.result, /past; recorded/);
    await assert.rejects(c.request('evaluate', { expression: 'bogus', context: 'repl' }), /unknown command/);
  });

  it('runs backwards to the previous breakpoint hit', async function () {
    const c = await launch();
    await c.request('setFunctionBreakpoints', { breakpoints: [{ name: 'draw_char' }] });
    await c.request('configurationDone');
    await c.event('stopped');
    const first = await c.where();
    await c.request('continue', { threadId: 1 });
    await c.event('stopped');
    await c.request('reverseContinue', { threadId: 1 });
    assert.strictEqual((await c.event('stopped')).reason, 'breakpoint');
    await c.request('reverseContinue', { threadId: 1 });
    assert.strictEqual((await c.event('stopped')).reason, 'entry');
    assert.strictEqual(first.name, '_draw_char');
  });

  it('pauses a running program', async function () {
    const c = await launch();
    await c.request('configurationDone');
    await new Promise(resolve => setTimeout(resolve, 50));
    await c.request('pause', { threadId: 1 });
    assert.strictEqual((await c.event('stopped')).reason, 'pause');
    assert.ok((await c.where()).instructionPointerReference);
  });
});

describe('Debug adapter, where there is no source', function () {
  // a routine `lib` at $1000 of one-byte NOPs, the PC 3 bytes in, and
  // another routine at $1008
  const PC = 0x1003;
  let bpsSent: Breakpoint[] = [];
  const backend: DebugBackend = {
    launch: async () => ({ capabilities: { step: true, rewind: false, granularity: 'insn', write: false, tree: false, signals: false }, root: ROOT }),
    terminate: async () => { },
    onStop: () => { },
    setBreakpoints: async (bps) => { bpsSent = bps; return bps.map(b => ({ id: b.id, verified: true, pc: parseInt(b.target.slice(1), 16) })); },
    continue: async () => { }, step: async () => { }, pause: async () => { }, stepBack: async () => { }, reverseContinue: async () => { },
    location: async () => ({ at: { frame: 0, step: 0 }, pc: PC, symbol: { name: 'lib', offset: PC - 0x1000 } }),
    callStack: async () => [{ pc: PC, symbol: { name: 'lib', offset: PC - 0x1000 } }],
    registers: async () => [], readMemory: async () => [], writeMemory: async () => 0,
    inlineValues: async () => [], debugTree: async () => [], signalTree: async () => [], symbols: async () => [],
    evaluate: async () => ({ result: '' }),
    disassemble: async (addr, insnOffset, count) => Array.from({ length: count }, (_, i) => {
      const a = addr + insnOffset + i;
      return { addr: a, bytes: '00', text: 'NOP', symbol: a === 0x1000 ? 'lib' : a === 0x1008 ? 'next' : undefined };
    }),
  };

  it('shows a disassembly of the routine, and takes breakpoints in it', async function () {
    const c = new DapClient(new EmuDebugSession(backend));
    await c.request('initialize', { adapterID: '8bitworkshop', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' });
    await c.request('launch', { program: 'x.s' });
    const frame = await c.where();
    assert.strictEqual(frame.source.name, 'lib (disassembly)');
    assert.ok(frame.source.sourceReference > 0);
    const { content } = await c.request('source', { source: frame.source, sourceReference: frame.source.sourceReference });
    const lines = content.split('\n');
    assert.deepStrictEqual(lines.slice(0, 3), ['lib:', '  $1000  00          NOP', '  $1001  00          NOP']);
    // up to the next routine
    assert.strictEqual(lines.length, 1 + 8 + 1);
    assert.strictEqual(frame.line, 1 + 4);
    assert.match(lines[frame.line - 1], /^  \$1003 /);

    // the same code keeps the same reference
    assert.strictEqual((await c.where()).source.sourceReference, frame.source.sourceReference);

    // breakpoints go on instructions' lines, not labels'
    const { breakpoints } = await c.request('setBreakpoints', { source: frame.source, breakpoints: [{ line: 3 }, { line: 1 }] });
    assert.deepStrictEqual(bpsSent.map(b => b.target), ['$1001']);
    assert.strictEqual(breakpoints[0].verified, true);
    assert.strictEqual(breakpoints[0].line, 3);
    assert.strictEqual(breakpoints[1].verified, false);
  });
});


describe('Debug adapter, for a design with signals', function () {
  const PC = 0;
  const signals: { [path: string]: { name: string, value: string, expandable: boolean }[] } = {
    '': [{ name: 'clk', value: '1', expandable: false }, { name: 'cpu', value: '', expandable: true }],
    'cpu': [{ name: 'A', value: '5 ($05)', expandable: false }],
  };
  const backend: DebugBackend = {
    launch: async () => ({ capabilities: { step: false, rewind: false, granularity: 'frame', write: false, tree: true, signals: true }, root: ROOT }),
    terminate: async () => { },
    onStop: () => { },
    setBreakpoints: async () => [],
    continue: async () => { }, step: async () => { }, pause: async () => { }, stepBack: async () => { }, reverseContinue: async () => { },
    location: async () => ({ at: { frame: 3, step: 0 }, clock: 1234, pc: PC }),
    callStack: async () => [],
    registers: async () => [], readMemory: async () => [], writeMemory: async () => 0,
    inlineValues: async () => [], debugTree: async () => [{ name: 'runtime', value: '', expandable: true }],
    signalTree: async (path) => signals[path.join('.')],
    symbols: async () => [], evaluate: async () => ({ result: '' }), disassemble: async () => [],
  };

  it('shows the signals, nested by module, instead of registers', async function () {
    const c = new DapClient(new EmuDebugSession(backend));
    await c.request('initialize', { adapterID: '8bitworkshop', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' });
    await c.request('launch', { program: 'x.v' });
    // no PC, so one made-up frame for VS Code to show Variables under
    const { stackFrames } = await c.request('stackTrace', { threadId: 1 });
    assert.deepStrictEqual(stackFrames.map((f: any) => f.name), ['frame 3, clock 1234']);
    const { scopes } = await c.request('scopes', { frameId: 0 });
    assert.deepStrictEqual(scopes.map((s: any) => s.name), ['Signals']);
    const top = await c.request('variables', { variablesReference: scopes[0].variablesReference });
    assert.deepStrictEqual(top.variables.map((v: any) => `${v.name}=${v.value}`), ['clk=1', 'cpu=']);
    assert.strictEqual(top.variables[0].variablesReference, 0);
    const cpu = await c.request('variables', { variablesReference: top.variables[1].variablesReference });
    assert.deepStrictEqual(cpu.variables.map((v: any) => `${v.name}=${v.value}`), ['A=5 ($05)']);
  });
});
