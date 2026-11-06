import assert from "assert";
import { describe, it } from "mocha";
import {
  GlobalVariable, SourceVariable, formatSourceValue, formatSourceVariableLine, functionAtPC,
  globalVariablesOf, globalVariableTree, inlineSourceValues, liveSourceVariables, sourceVariableTree, sourceVariablesOf,
  writableGlobalVariablesOf
} from "../../src/common/sourcevars";

describe('Source variables', function () {
  const mem: { [addr: number]: number } = {
    0x10: 0x34, 0x11: 0x12, // u16 score = 0x1234
    0x12: 0xff,             // i8 delta = -1
    0x13: 0x01,             // bool running = true
    0x14: 0x01, 0x15: 0x02, 0x16: 0x03, // [u8; 3]
    0x30: 0x78, 0x31: 0x56, // global u16 SCORE = 0x5678
    0x40: 0xaa, 0x41: 0xbb, 0x42: 0xcc, // global [u8; 3] PALETTE
  };
  const read = (a: number) => mem[a] || 0;
  const symbolmap = { main: 0x8000, helper: 0x8100 };
  const symbolsizes = { main: 0x20, helper: 0x10 };

  const vars: SourceVariable[] = [
    { name: 'score', type: 'u16', size: 2, function: 'main', addr: 0x10, range: [0x8000, 0x8010] },
    { name: 'score', type: 'u16', size: 2, function: 'main', addr: 0x20, range: [0x8010, 0x8020] },
    { name: 'delta', type: 'i8', size: 1, function: 'main', addr: 0x12, range: [0x8000, 0x8020] },
    { name: 'running', type: 'bool', size: 1, function: 'main', addr: 0x13, range: [0x8000, 0x8020] },
    { name: 'items', type: '[u8; 3]', size: 3, function: 'main', addr: 0x14, range: [0x8000, 0x8020] },
    // no storage: shown when its function is current, never guessed at
    { name: 'i', type: 'usize', size: 2, function: 'main', addr: null, range: null, location: 'optimized out' },
    { name: 'other', type: 'u8', size: 1, function: 'helper', addr: 0x10, range: null },
  ];

  const globals: GlobalVariable[] = [
    { name: 'SCORE', type: 'u16', size: 2, addr: 0x30, ram: true, mutable: true, file: 'main.rs', line: 12, col: 1 },
    { name: 'PALETTE', type: '[u8; 3]', size: 3, addr: 0x40, ram: false, mutable: false, file: 'main.rs', line: 16, col: 1, expandable: true },
  ];

  it('reads the variables out of debuginfo', function () {
    assert.deepStrictEqual(sourceVariablesOf({ sourceVariables: vars }), vars);
    assert.deepStrictEqual(sourceVariablesOf({}), []);
    assert.deepStrictEqual(sourceVariablesOf(null), []);
    assert.deepStrictEqual(globalVariablesOf({ globalVariables: globals }), globals);
    assert.deepStrictEqual(globalVariablesOf({}), []);
    assert.deepStrictEqual(globalVariablesOf(null), []);
    // mutable says whether the program can write it, regardless of where it lives
    const readonlyRam = { ...globals[0], name: 'LOCKED', mutable: false };
    const writableRom = { ...globals[1], name: 'ROMVAR', mutable: true };
    assert.deepStrictEqual(
      writableGlobalVariablesOf({ globalVariables: [globals[0], globals[1], readonlyRam, writableRom] }),
      [globals[0], writableRom]);
    assert.deepStrictEqual(writableGlobalVariablesOf({}), []);
    // older output has no mutable flag; keep it rather than hide every global
    const unmarked = { ...globals[1], ram: false, mutable: undefined };
    assert.deepStrictEqual(writableGlobalVariablesOf({ globalVariables: [unmarked] }), [unmarked]);
  });

  it('finds the function whose code contains the PC', function () {
    assert.strictEqual(functionAtPC(0x8004, symbolmap, symbolsizes), 'main');
    assert.strictEqual(functionAtPC(0x8104, symbolmap, symbolsizes), 'helper');
    assert.strictEqual(functionAtPC(0x8200, symbolmap, symbolsizes), null);
  });

  it('keeps the definition live at the PC, not the overlaid one', function () {
    assert.deepStrictEqual(liveSourceVariables(vars, 0x8004, symbolmap, symbolsizes).map(v => v.name),
      ['score', 'delta', 'running', 'items', 'i']);
    const later = liveSourceVariables(vars, 0x8014, symbolmap, symbolsizes);
    assert.strictEqual(later.find(v => v.name === 'score').addr, 0x20);
    // the helper's range is unknown, so it is shown for the helper only
    assert.ok(!liveSourceVariables(vars, 0x8004, symbolmap, symbolsizes).some(v => v.name === 'other'));
    assert.ok(liveSourceVariables(vars, 0x8104, symbolmap, symbolsizes).some(v => v.name === 'other'));
  });

  it('formats scalar, bool, array and optimized-out values', function () {
    const byName = (name: string, pc = 0x8004) =>
      liveSourceVariables(vars, pc, symbolmap, symbolsizes).find(v => v.name === name);
    assert.strictEqual(formatSourceValue(byName('score'), read), '$1234 (4660)');
    assert.strictEqual(formatSourceValue(byName('delta'), read), '$FF (-1)');
    assert.strictEqual(formatSourceValue(byName('running'), read), 'true');
    assert.strictEqual(formatSourceValue(byName('items'), read), '01 02 03');
    assert.strictEqual(formatSourceValue(byName('i'), read), '<optimized out>');
    // folded to a constant: no storage, but the value is known
    assert.strictEqual(formatSourceValue({ type: 'u16', size: 2, addr: null, constant: 0x1234 }, read), '$1234 (4660)');
    assert.strictEqual(formatSourceValue({ type: 'bool', size: 1, addr: null, constant: 1 }, read), 'true');
    assert.strictEqual(formatSourceVariableLine(byName('score'), read), 'score: u16 = $1234 (4660)');
  });

  it('builds a tree keyed by name and type', function () {
    const tree = sourceVariableTree(vars, 0x8004, symbolmap, symbolsizes, read);
    assert.deepStrictEqual(tree, {
      'delta:i8': '$FF (-1)',
      'i:usize': '<optimized out>',
      'items:[u8;3]': '01 02 03',
      'running:bool': 'true',
      'score:u16': '$1234 (4660)',
    });
    assert.strictEqual(sourceVariableTree(vars, 0x8200, symbolmap, symbolsizes, read), null);
  });

  it('shows every global, with no live range to filter on', function () {
    assert.deepStrictEqual(globalVariableTree(globals, read), {
      'PALETTE:[u8;3]': 'AA BB CC',
      'SCORE:u16': '$5678 (22136)',
    });
    assert.strictEqual(globalVariableTree([], read), null);
    assert.strictEqual(formatSourceVariableLine(globals[0], read), 'SCORE: u16 = $5678 (22136)');
  });
});

describe('Inline source values', function () {
  const mem: { [addr: number]: number } = { 0x10: 5, 0x11: 7 };
  const read = (a: number) => mem[a] || 0;
  const symbolmap = { main: 0x8000 };
  const symbolsizes = { main: 0x20 };
  const vars: SourceVariable[] = [
    { name: 'i', type: 'u8', size: 1, function: 'main', addr: 0x10, range: [0x8000, 0x8020], line: 2 },
    { name: 'sum', type: 'u8', size: 1, function: 'main', addr: 0x11, range: [0x8008, 0x8020], line: 3 },
  ];
  const text = ['fn main() {', '  let mut i = 0;', '  let mut sum = 0;', '  sum += i;', '  i += 1;'];
  const lines = [
    { line: 1, offset: 0x8000 }, { line: 2, offset: 0x8002 }, { line: 3, offset: 0x8008 },
    { line: 4, offset: 0x8010 }, { line: 5, offset: 0x8018 },
  ];
  const run = (stop?: number) => inlineSourceValues(vars, 0x8010, symbolmap, symbolsizes, lines, l => text[l - 1], read, stop);

  it('shows the variables a line names, with their values', function () {
    const m = run(4);
    assert.strictEqual(m.get(4), 'i = 5, sum = 7');
  });
  it('shows each variable once, on the line nearest the stop', function () {
    const m = run(5);
    assert.strictEqual(m.get(5), 'i = 5');
    assert.strictEqual(m.get(4), 'sum = 7');
    assert.strictEqual([...m.values()].join().split('i = ').length, 2);
  });
  it('skips a variable outside its live range and a line that does not name it', function () {
    const m = run(2);
    assert.strictEqual(m.get(2), 'i = 5'); // `sum` is not live until line 3's code
    assert.strictEqual(m.has(3), true);
    assert.strictEqual(m.has(1), false);
  });
  it('matches whole identifiers only', function () {
    const t = text.slice(); t[4] = '  idx += 1;';
    const m = inlineSourceValues(vars, 0x8010, symbolmap, symbolsizes, lines, l => t[l - 1], read, 5);
    assert.strictEqual(m.has(5), false);
  });
  it('shows an inlined callee\'s variable under its source name', function () {
    // the compiler names it `mangled_callee::name`; the line only says `name`
    const inl: SourceVariable[] = [{ name: 'mod__callee::i', type: 'u8', size: 1, function: 'main', addr: 0x10, range: [0x8000, 0x8020], line: 2 }];
    const m = inlineSourceValues(inl, 0x8010, symbolmap, symbolsizes, lines, l => text[l - 1], read, 4);
    assert.strictEqual(m.get(4), 'i = 5');
    // two inlined copies with the same name and value are listed once
    const twice = [...inl, { ...inl[0], name: 'mod__other::i' }];
    assert.strictEqual(inlineSourceValues(twice, 0x8010, symbolmap, symbolsizes, lines, l => text[l - 1], read, 4).get(4), 'i = 5');
  });
  it('draws only the variables of the file whose lines it is given', function () {
    // `i` is declared at line 2 of other.rs, which this file's line 2 must not pick up
    const mine = lines.map(l => ({ ...l, path: 'rs8/mine.rs' }));
    const two: SourceVariable[] = [
      { ...vars[0], file: 'other.rs' },
      { ...vars[1], file: 'mine.rs' },
    ];
    const m = inlineSourceValues(two, 0x8010, symbolmap, symbolsizes, mine, l => text[l - 1], read, 4);
    assert.deepStrictEqual([...m.values()], ['sum = 7']);
  });
});
