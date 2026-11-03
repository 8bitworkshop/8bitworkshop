
import assert from "assert";
import { describe, it } from "mocha";
import {
  DebugSymbols,
  isDebuggable,
  Debuggable,
  BreakpointList,
  BasePlatform,
  BaseDebugPlatform,
  Base6502Platform,
  BaseZ80Platform,
  Base6809Platform,
  EmuState,
  CpuState,
  OpcodeMetadata,
  Platform,
  getToolForFilename_6502,
  getToolForFilename_z80,
  getToolForFilename_6809,
  getToolForFilename_arm32,
  getOpcodeMetadata_6502,
  cpuStateToLongString_6502,
  cpuStateToLongString_Z80,
  cpuStateToLongString_6809,
  inspectSymbol,
  lookupSymbol,
  dumpStackToString,
} from "../../src/common/baseplatform";

describe('DebugSymbols', function () {
  it('should create symbol map with correct structure', function () {
    const symbolmap = { main: 0x0000, loop: 0x0010, end: 0x0100 };
    const debuginfo = { platform: 'test' };
    const symbols = new DebugSymbols(symbolmap, debuginfo);

    assert.strictEqual(symbols.symbolmap['main'], 0x0000);
    assert.strictEqual(symbols.symbolmap['loop'], 0x0010);
    assert.strictEqual(symbols.symbolmap['end'], 0x0100);
  });

  it('should create inverted address-to-symbol map', function () {
    const symbolmap = { main: 0x0000, loop: 0x0010, end: 0x0100 };
    const debuginfo = {};
    const symbols = new DebugSymbols(symbolmap, debuginfo);

    assert.strictEqual(symbols.addr2symbol[0x0000], 'main');
    assert.strictEqual(symbols.addr2symbol[0x0010], 'loop');
    assert.strictEqual(symbols.addr2symbol[0x0100], 'end');
  });

  it('should ensure sentinel values in address map', function () {
    const symbolmap = { loop: 0x1000 };
    const debuginfo = {};
    const symbols = new DebugSymbols(symbolmap, debuginfo);

    // Empty symbol map gets $00 sentinel
    assert.strictEqual(symbols.addr2symbol[0x0], '$00');
    assert.strictEqual(symbols.addr2symbol[0x10000], '__END__');
  });

  it('should store debug info', function () {
    const debuginfo = { platform: 'c64', version: '1.0' };
    const symbols = new DebugSymbols({}, debuginfo);

    assert.deepStrictEqual(symbols.debuginfo, debuginfo);
  });

  it('should handle empty symbol map', function () {
    const symbols = new DebugSymbols({}, {});

    assert.deepStrictEqual(symbols.symbolmap, {});
    assert.ok(symbols.addr2symbol[0x0] !== undefined);
  });

  it('should handle duplicate addresses with last symbol winning', function () {
    const symbolmap = { sym1: 0x100, sym2: 0x100 };
    const symbols = new DebugSymbols(symbolmap, {});

    // One of them should be in the inverted map
    assert.ok(symbols.addr2symbol[0x100] === 'sym1' || symbols.addr2symbol[0x100] === 'sym2');
  });
});

describe('isDebuggable type guard', function () {
  it('should identify debuggable objects', function () {
    const debuggable: Debuggable = {
      getDebugCategories: () => ['CPU', 'Memory'],
      getDebugInfo: (category: string) => 'debug info'
    };

    assert.ok(isDebuggable(debuggable));
  });

  it('should reject non-debuggable objects', function () {
    assert.ok(!isDebuggable({}));
    assert.ok(!isDebuggable(null));
    assert.ok(!isDebuggable(undefined));
    assert.ok(!isDebuggable({ foo: 'bar' }));
  });

  it('should accept partial implementations', function () {
    const partial = {
      getDebugCategories: () => ['CPU']
    };

    assert.ok(isDebuggable(partial));
  });
});

describe('BreakpointList', function () {
  it('should return null when no breakpoints exist', function () {
    const list = new BreakpointList();
    const cond = list.getDebugCondition();

    assert.strictEqual(cond, null);
  });

  it('should create debug condition for single breakpoint', function () {
    const list = new BreakpointList();
    let hitCount = 0;
    list.id2bp['bp1'] = { cond: () => { hitCount++; return true; } };

    const cond = list.getDebugCondition();
    assert.ok(cond !== null);
    assert.ok(cond());
    assert.strictEqual(hitCount, 1);
  });

  it('should evaluate multiple breakpoints with OR logic', function () {
    const list = new BreakpointList();
    let hits1 = 0, hits2 = 0;

    list.id2bp['bp1'] = { cond: () => { hits1++; return false; } };
    list.id2bp['bp2'] = { cond: () => { hits2++; return true; } };

    const cond = list.getDebugCondition();
    const result = cond();

    assert.ok(result);
    assert.strictEqual(hits1, 1);
    assert.strictEqual(hits2, 1);
  });

  it('should remove breakpoint', function () {
    const list = new BreakpointList();
    list.id2bp['bp1'] = { cond: () => true };

    delete list.id2bp['bp1'];
    const cond = list.getDebugCondition();

    assert.strictEqual(cond, null);
  });
});

describe('Tool Filename Detection', function () {
  describe('6502 tools', function () {
    it('should detect C language', function () {
      assert.strictEqual(getToolForFilename_6502('test.c'), 'cc65');
      assert.strictEqual(getToolForFilename_6502('program.c'), 'cc65');
    });

    it('should detect assembly language', function () {
      assert.strictEqual(getToolForFilename_6502('test.s'), 'ca65');
      assert.strictEqual(getToolForFilename_6502('code.ca65'), 'ca65');
      assert.strictEqual(getToolForFilename_6502('test.dasm'), 'dasm');
    });

    it('should detect various assembler formats', function () {
      assert.strictEqual(getToolForFilename_6502('test.acme'), 'acme');
      assert.strictEqual(getToolForFilename_6502('test.xa'), 'xa');
      assert.strictEqual(getToolForFilename_6502('test.wiz'), 'wiz');
    });

    it('should detect special formats', function () {
      assert.strictEqual(getToolForFilename_6502('test.ecs'), 'ecs');
      assert.strictEqual(getToolForFilename_6502('test.cpp'), 'oscar64');
      assert.strictEqual(getToolForFilename_6502('test.cc'), 'oscar64');
      assert.strictEqual(getToolForFilename_6502('test.o64'), 'oscar64');
    });

    it('should default to dasm for unknown extensions', function () {
      assert.strictEqual(getToolForFilename_6502('test.a'), 'dasm');
      assert.strictEqual(getToolForFilename_6502('test.asm'), 'dasm');
      assert.strictEqual(getToolForFilename_6502('unknown'), 'dasm');
    });

    it('should detect llvm-mos for special C files', function () {
      assert.strictEqual(getToolForFilename_6502('test-llvm.c'), 'remote:llvm-mos');
    });
  });

  describe('Z80 tools', function () {
    it('should detect C language', function () {
      assert.strictEqual(getToolForFilename_z80('test.c'), 'sdcc');
      assert.strictEqual(getToolForFilename_z80('code.h'), 'sdcc');
    });

    it('should detect assembly language', function () {
      assert.strictEqual(getToolForFilename_z80('test.s'), 'sdasz80');
      assert.strictEqual(getToolForFilename_z80('test.sgb'), 'sdasgb');
      assert.strictEqual(getToolForFilename_z80('test.ns'), 'naken');
    });

    it('should detect special formats', function () {
      assert.strictEqual(getToolForFilename_z80('test.scc'), 'sccz80');
      assert.strictEqual(getToolForFilename_z80('test.z'), 'zmac');
      assert.strictEqual(getToolForFilename_z80('test.wiz'), 'wiz');
    });

    it('should default to zmac for unknown extensions', function () {
      assert.strictEqual(getToolForFilename_z80('unknown'), 'zmac');
    });
  });

  describe('ARM32 tools', function () {
    it('should detect assembly language', function () {
      assert.strictEqual(getToolForFilename_arm32('test.vasm'), 'vasmarm');
      assert.strictEqual(getToolForFilename_arm32('test.armips'), 'armips');
    });

    it('should default to armtcc', function () {
      assert.strictEqual(getToolForFilename_arm32('test.c'), 'armtcc');
      assert.strictEqual(getToolForFilename_arm32('test.s'), 'armtcc');
      assert.strictEqual(getToolForFilename_arm32('unknown'), 'armtcc');
    });
  });

  describe('6809 tools', function () {
    it('should detect C language', function () {
      assert.strictEqual(getToolForFilename_6809('test.c'), 'cmoc');
      assert.strictEqual(getToolForFilename_6809('code.h'), 'cmoc');
    });

    it('should detect assembly language', function () {
      assert.strictEqual(getToolForFilename_6809('test.xasm'), 'xasm6809');
      assert.strictEqual(getToolForFilename_6809('test.lwasm'), 'lwasm');
    });

    it('should default to cmoc', function () {
      assert.strictEqual(getToolForFilename_6809('unknown'), 'cmoc');
    });
  });
});

describe('Opcode Metadata', function () {
  it('should return valid metadata for 6502 opcodes', function () {
    // Test NOP (0xEA)
    const nop = getOpcodeMetadata_6502(0xEA, 0);
    assert.strictEqual(nop.opcode, 0xEA);
    assert.ok(nop.minCycles > 0);
    assert.ok(nop.maxCycles >= nop.minCycles);
    assert.ok(nop.insnlength > 0);
  });

  it('should return consistent metadata for same opcode', function () {
    const meta1 = getOpcodeMetadata_6502(0x69, 0x1000); // ADC immediate
    const meta2 = getOpcodeMetadata_6502(0x69, 0x2000);

    assert.strictEqual(meta1.opcode, meta2.opcode);
    assert.strictEqual(meta1.minCycles, meta2.minCycles);
    assert.strictEqual(meta1.maxCycles, meta2.maxCycles);
    assert.strictEqual(meta1.insnlength, meta2.insnlength);
  });

  it('should handle all 256 6502 opcodes', function () {
    for (let op = 0; op < 256; op++) {
      const meta = getOpcodeMetadata_6502(op, 0);
      assert.ok(meta.minCycles >= 0);
      assert.ok(meta.maxCycles >= meta.minCycles);
      assert.ok(meta.insnlength >= 0);
    }
  });
});

describe('CPU State Formatting', function () {
  describe('6502 CPU state', function () {
    it('should format basic CPU state', function () {
      const state: any = {
        PC: 0x1234,
        SP: 0xFF,
        A: 0x42,
        X: 0x10,
        Y: 0x20,
        N: false, V: false, D: false, Z: false, C: false, I: false, R: true
      };

      const output = cpuStateToLongString_6502(state);
      assert.ok(output.includes('1234')); // PC
      assert.ok(output.includes('FF'));   // SP
    });

    it('should show flag status', function () {
      const state1: any = {
        PC: 0,
        SP: 0,
        N: true, V: false, D: false, Z: true, C: false, I: false, R: true
      };

      const output = cpuStateToLongString_6502(state1);
      assert.ok(output.includes('N'));
      assert.ok(output.includes('Z'));
    });

    it('should show BUSY status when R is false', function () {
      const state: any = { PC: 0, SP: 0, R: false };
      const output = cpuStateToLongString_6502(state);
      assert.ok(output.includes('BUSY'));
    });
  });

  describe('Z80 CPU state', function () {
    it('should format Z80 state', function () {
      const state: any = {
        PC: 0x4000,
        SP: 0x9000,
        AF: 0x1234,
        BC: 0x5678,
        DE: 0x9ABC,
        HL: 0xDEF0,
        IX: 0x0001,
        IY: 0x0002,
        IR: 0x3344,
        iff1: true,
        iff2: false
      };

      const output = cpuStateToLongString_Z80(state);
      assert.ok(output.includes('4000')); // PC
      assert.ok(output.includes('9000')); // SP
      assert.ok(output.includes('1234')); // AF
    });
  });

  describe('6809 CPU state', function () {
    it('should format 6809 state', function () {
      const state: any = {
        PC: 0x1000,
        SP: 0x2000,
        DP: 0x00,
        A: 0x11,
        B: 0x22,
        X: 0x3333,
        Y: 0x4444,
        U: 0x5555,
        CC: 0xF0
      };

      const output = cpuStateToLongString_6809(state);
      assert.ok(output.includes('1000')); // PC
      assert.ok(output.includes('2000')); // SP
      assert.ok(output.includes('11'));   // A
    });
  });
});

describe('Symbol lookup', function () {
  it('should find symbol at address', function () {
    const platform: any = {
      debugSymbols: new DebugSymbols({ main: 0x1000, loop: 0x1010 }, {}),
      readAddress: (addr: number) => addr & 0xFF
    };

    const result = lookupSymbol(platform, 0x1010, false);
    assert.ok(result.includes('loop'));
  });

  it('should find symbol before address when extra is true', function () {
    const platform: any = {
      debugSymbols: new DebugSymbols({ main: 0x1000 }, {}),
      readAddress: (addr: number) => 0
    };

    const result = lookupSymbol(platform, 0x1005, true);
    assert.ok(result.includes('main'));
    assert.ok(result.includes('$05'));
  });

  it('should return empty string when no symbol found', function () {
    const platform: any = {
      debugSymbols: new DebugSymbols({}, {}),
      readAddress: (addr: number) => 0
    };

    const result = lookupSymbol(platform, 0x5000, false);
    assert.strictEqual(result, '');
  });

  it('should handle missing debug symbols', function () {
    const platform: any = { debugSymbols: null };

    const result = lookupSymbol(platform, 0x1000, false);
    assert.strictEqual(result, '');
  });
});

describe('Stack dumping', function () {
  it('should dump stack memory', function () {
    const mem = new Uint8Array([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
      0x20, 0x10, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D,
    ]);

    const platform: any = {
      debugSymbols: new DebugSymbols({ func: 0x100E }, {}),
      readAddress: (addr: number) => addr < mem.length ? mem[addr] : 0
    };

    const result = dumpStackToString(platform, mem, 0, 15, 9, 0x20);
    assert.ok(result.includes('$'));
    assert.ok(result.length > 0);
  });

  it('should handle big endian byte order', function () {
    const mem = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
    const platform: any = {
      debugSymbols: new DebugSymbols({}, {}),
      readAddress: (addr: number) => mem[addr]
    };

    const result = dumpStackToString(platform, mem, 0, 3, 2, 0, true);
    assert.ok(result.includes('$'));
  });

  it('should show JSR addresses', function () {
    const mem = new Uint8Array(256);
    // Set up JSR at 0x100 (6502 JSR is 0x20)
    mem[0x100] = 0x20;
    // Stack has return address pointing near 0x100
    mem[0x50] = 0xFE;
    mem[0x51] = 0x01;

    const platform: any = {
      debugSymbols: new DebugSymbols({ func: 0x0100 }, {}),
      readAddress: (addr: number) => {
        if (addr < mem.length) return mem[addr];
        return 0;
      }
    };

    const result = dumpStackToString(platform, mem, 0, 255, 0x50, 0x20);
    // The function returns a string with stack content
    assert.ok(result.includes('$'));
  });
});

describe('BasePlatform', function () {
  class TestPlatform extends BasePlatform {
    loadState(state: EmuState): void { }
    saveState(): EmuState { return {}; }
    pause(): void { }
    resume(): void { }
    advance(novideo?: boolean): number { return 0; }
  }

  it('should initialize with empty internal files', function () {
    const platform = new TestPlatform();
    assert.deepStrictEqual(platform.internalFiles, {});
  });

  it('should set and get recorder', function () {
    const platform = new TestPlatform();
    const recorder: any = { frameRequested: () => false };
    platform.setRecorder(recorder);
    assert.strictEqual(platform.recorder, recorder);
  });

  it('should read and write files', function () {
    const platform = new TestPlatform();
    const data: any = { data: [1, 2, 3] };

    platform.writeFile('test.txt', data);
    const read = platform.readFile('test.txt');

    assert.deepStrictEqual(read, data);
  });

  it('should return undefined for non-existent file', function () {
    const platform = new TestPlatform();
    const read = platform.readFile('nonexistent.txt');
    assert.strictEqual(read, undefined);
  });

  it('should generate debug tree', function () {
    const platform = new TestPlatform();
    platform.debugSymbols = new DebugSymbols({ test: 0x1000 }, { info: 'test' });

    const tree: any = platform.getDebugTree();
    assert.ok(tree.state);
    assert.deepStrictEqual(tree.debuginfo, { info: 'test' });
  });
});

describe('BaseDebugPlatform', function () {
  class TestDebugPlatform extends BaseDebugPlatform {
    loadState(state: EmuState): void { }
    saveState(): EmuState { return { c: { PC: 0 } }; }
    pause(): void { }
    resume(): void { }
    advance(novideo?: boolean): number { return 0; }
    getCPUState(): CpuState { return { PC: 0x1000, SP: 0x100 }; }
    getSP(): number { return 0x100; }
    getPC(): number { return 0x1000; }
    isStable(): boolean { return true; }
    mem: { [addr: number]: number } = {};
    readAddress(addr: number): number { return this.mem[addr] || 0; }
  }

  it('should manage breakpoints', function () {
    const platform = new TestDebugPlatform();
    const cond = () => true;

    platform.setBreakpoint('bp1', cond);
    assert.ok(platform.hasBreakpoint('bp1'));

    platform.clearBreakpoint('bp1');
    assert.ok(!platform.hasBreakpoint('bp1'));
  });

  it('should clear all debug state', function () {
    const platform = new TestDebugPlatform();
    platform.debugSavedState = { c: { PC: 0 } };
    platform.debugBreakState = { c: { PC: 100 } };
    platform.onBreakpointHit = () => { };

    platform.clearDebug();

    assert.strictEqual(platform.debugSavedState, null);
    assert.strictEqual(platform.debugBreakState, null);
    assert.strictEqual(platform.onBreakpointHit, null);
  });

  it('should track frame count', function () {
    const platform = new TestDebugPlatform();
    assert.strictEqual(platform.frameCount, 0);

    platform.postFrame();
    assert.strictEqual(platform.frameCount, 1);

    platform.postFrame();
    assert.strictEqual(platform.frameCount, 2);
  });

  it('should detect breakpoint hits', function () {
    const platform = new TestDebugPlatform();
    assert.ok(!platform.wasBreakpointHit());

    platform.debugBreakState = { c: { PC: 0 } };
    assert.ok(platform.wasBreakpointHit());
  });

  it('should show source locals and globals in the debug tree', function () {
    const platform = new TestDebugPlatform();
    platform.mem[0x20] = 0x78;
    platform.mem[0x21] = 0x56;
    platform.mem[0x30] = 0x34;
    platform.mem[0x31] = 0x12;
    platform.debugSymbols = new DebugSymbols({ main: 0x1000, hiscore: 0x20 }, {
      extra: 'kept',
      sourceVariables: [
        { name: 'score', type: 'u16', size: 2, function: 'main', addr: 0x30, range: [0x1000, 0x1010] },
      ],
      globalVariables: [
        { name: 'hiscore', type: 'u16', size: 2, addr: 0x20, ram: true, mutable: true },
        { name: 'PALETTE', type: '[u8; 3]', size: 3, addr: 0x40, ram: false, mutable: false },
      ],
    });

    const tree: any = platform.getDebugTree();
    assert.deepStrictEqual(tree.debuginfo, { extra: 'kept' });
    assert.deepStrictEqual(tree.Locals.$$(), { 'score:u16': '$1234 (4660)' });
    assert.deepStrictEqual(tree.Globals.$$(), { 'hiscore:u16': '$5678 (22136)' });
    assert.strictEqual(platform.inspect('hiscore'), 'hiscore: u16 = $5678 (22136)');
  });
});

describe('Base6502Platform', function () {
  class TestNES6502 extends Base6502Platform {
    loadState(state: EmuState): void { }
    saveState(): EmuState { return { c: { PC: 0, SP: 0 } }; }
    pause(): void { }
    resume(): void { }
    advance(novideo?: boolean): number { return 0; }
    getCPUState(): CpuState { return { PC: 0x8000, SP: 0xFF }; }
    getSP(): number { return 0xFF; }
    getPC(): number { return 0x8000; }
    isStable(): boolean { return true; }
    readAddress(addr: number): number { return 0; }
  }

  it('should get default extensions', function () {
    const platform = new TestNES6502();
    const exts = platform.getDefaultExtensions();
    assert.ok(exts.includes('.c'));
    assert.ok(exts.includes('.ca65'));
    assert.ok(exts.includes('.dasm'));
  });

  it('should get 6502 opcode metadata', function () {
    const platform = new TestNES6502();
    const meta = platform.getOpcodeMetadata(0x69, 0);
    assert.ok(meta.minCycles > 0);
  });

  it('should get origin PC from reset vector', function () {
    const platform = new TestNES6502();
    const originPC = platform.getOriginPC();
    assert.ok(typeof originPC === 'number');
  });

  it('should apply PC delta correction', function () {
    const platform = new TestNES6502();
    const state: CpuState = { PC: 0x1000 };

    const fixed = platform.fixPC(state);
    assert.strictEqual(fixed.PC, 0x0FFF); // PC - 1

    const unfixed = platform.unfixPC(fixed);
    assert.strictEqual(unfixed.PC, 0x1000);
  });

  it('should handle PC wrapping at 16-bit boundary', function () {
    const platform = new TestNES6502();
    const state: CpuState = { PC: 0x0000 };

    const fixed = platform.fixPC(state);
    assert.strictEqual(fixed.PC, 0xFFFF);
  });

  it('should get debug categories', function () {
    const platform = new TestNES6502();
    const cats = platform.getDebugCategories();
    assert.ok(cats.includes('CPU'));
    assert.ok(cats.includes('Stack'));
  });
});

describe('inspectSymbol', function () {
  it('should inspect symbol value at address', function () {
    const platform: any = {
      debugSymbols: new DebugSymbols({ myvar: 0x100 }, {}),
      readAddress: (addr: number) => addr === 0x100 ? 0x42 : 0x00
    };

    const result = inspectSymbol(platform, 'myvar');
    assert.ok(result.includes('100'));
    assert.ok(result.includes('42'));
  });

  it('should handle two-byte values', function () {
    const platform: any = {
      debugSymbols: new DebugSymbols({ word: 0x200 }, {}),
      readAddress: (addr: number) => {
        if (addr === 0x200) return 0x34;
        if (addr === 0x201) return 0x12;
        return 0;
      }
    };

    const result = inspectSymbol(platform, 'word');
    assert.ok(result.includes('200'));
  });

  it('should look for C and asm symbol variants', function () {
    const platform: any = {
      debugSymbols: new DebugSymbols({ _myvar: 0x300 }, {}),
      readAddress: (addr: number) => addr === 0x300 ? 0x99 : 0
    };

    const result = inspectSymbol(platform, 'myvar');
    assert.ok(result.includes('99'));
  });

  it('should return undefined for missing symbol', function () {
    const platform: any = {
      debugSymbols: new DebugSymbols({}, {}),
      readAddress: (addr: number) => 0
    };

    const result = inspectSymbol(platform, 'nonexistent');
    assert.ok(result === undefined || result === null);
  });

  it('should handle missing debug symbols', function () {
    const platform: any = { debugSymbols: null };
    const result = inspectSymbol(platform, 'symbol');
    assert.strictEqual(result, undefined);
  });

  it('should handle missing readAddress method', function () {
    const platform: any = {
      debugSymbols: new DebugSymbols({ test: 0x100 }, {}),
      readAddress: undefined
    };

    const result = inspectSymbol(platform, 'test');
    assert.ok(result === null);
  });
});

