import assert from "assert";
import { describe, it } from "mocha";
import {
  SourceVariable, formatSourceValue, formatSourceVariableLine, functionAtPC,
  liveSourceVariables, sourceVariableTree, sourceVariablesOf
} from "../../src/common/sourcevars";

describe('Source variables', function () {
  const mem: { [addr: number]: number } = {
    0x10: 0x34, 0x11: 0x12, // u16 score = 0x1234
    0x12: 0xff,             // i8 delta = -1
    0x13: 0x01,             // bool running = true
    0x14: 0x01, 0x15: 0x02, 0x16: 0x03, // [u8; 3]
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

  it('reads the variables out of debuginfo', function () {
    assert.deepStrictEqual(sourceVariablesOf({ sourceVariables: vars }), vars);
    assert.deepStrictEqual(sourceVariablesOf({}), []);
    assert.deepStrictEqual(sourceVariablesOf(null), []);
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
});
