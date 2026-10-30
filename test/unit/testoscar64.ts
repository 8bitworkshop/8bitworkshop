import assert from "assert";
import { describe, it } from "mocha";
import {
  formatSourceValue, liveSourceVariables, sourceVariableAddress, sourceVariableTree, sourceVariablesOf
} from "../../src/common/sourcevars";
import { parseOscar64Dbj } from "../../src/worker/tools/oscar64parse";

describe('Oscar64 debug info', function () {
  const dbj = {
    types: [
      { name: '', typeid: 0, size: 1, type: 'uint' },
      { name: '', typeid: 1, size: 2, type: 'int' },
      { name: '', typeid: 2, size: 1, type: 'bool' },
      { name: '', typeid: 3, size: 4, type: 'array', eid: 0 },
      { name: '', typeid: 4, size: 2, type: 'ptr', eid: 0 },
      { name: 'point', typeid: 5, size: 4, type: 'struct' },
    ],
    functions: [{
      name: 'main', start: 0x8000, end: 0x8020, source: '/proj/main.c', line: 1,
      lines: [
        { start: 0x8000, end: 0x8004, source: '/proj/main.c', line: 10 },
        { start: 0x8004, end: 0x8008, source: '/proj/main.c', line: 12 },
        { start: 0x8010, end: 0x8018, source: '/proj/main.c', line: 14 },
        { start: 0x8018, end: 0x8020, source: '/proj/main.c', line: 18 },
      ],
      variables: [
        { name: 'score', start: 0x9000, end: 0x9002, enter: 10, leave: 14, typeid: 1,
          references: [{ source: '/proj/main.c', line: 10, column: 5 }] },
        { name: 'i', start: 2, end: 3, base: 0x23, enter: 12, leave: 14, typeid: 0,
          references: [{ source: '/proj/main.c', line: 12, column: 7 }] },
        { name: 'arr', start: 0x9000, end: 0x9004, enter: 10, leave: 18, typeid: 3,
          references: [{ source: '/proj/main.c', line: 10, column: 11 }] },
        { name: 'p', start: 0x9004, end: 0x9006, enter: 10, leave: 18, typeid: 4,
          references: [{ source: '/proj/main.c', line: 10, column: 15 }] },
        { name: 'pt', start: 0x9006, end: 0x900a, enter: 10, leave: 18, typeid: 5,
          references: [{ source: '/proj/main.c', line: 10, column: 18 }] },
        { name: 'n', start: 0x0d, end: 0x0e, typeid: 0,
          references: [{ source: '/proj/main.c', line: 1, column: 13 }] },
      ],
    }],
  };

  const parsed = parseOscar64Dbj(JSON.stringify(dbj));
  const vars = parsed.sourceVariables;
  const byName = (name: string) => vars.find(v => v.name === name);

  it('maps types and stack-relative homes', function () {
    assert.deepStrictEqual(sourceVariablesOf({ sourceVariables: vars }), vars);
    assert.strictEqual(byName('score').type, 'i16');
    assert.strictEqual(byName('arr').type, '[u8; 4]');
    assert.strictEqual(byName('p').type, '&u8');
    assert.strictEqual(byName('pt').type, 'point');
    assert.strictEqual(byName('i').baseAddr, 0x23);
    assert.strictEqual(byName('i').addr, 2);
    assert.strictEqual(byName('score').file, 'main.c');
    assert.strictEqual(byName('score').line, 10);
    assert.strictEqual(byName('score').col, 5);
  });

  it('turns enter/leave lines into code ranges', function () {
    assert.deepStrictEqual(byName('score').ranges, [[0x8000, 0x8008], [0x8010, 0x8018]]);
    // a variable visible on the first and last generated line is live over
    // the whole function, including branch tails with no line entry
    assert.deepStrictEqual(byName('arr').ranges, [[0x8000, 0x8020]]);
    assert.deepStrictEqual(byName('i').ranges, [[0x8004, 0x8008], [0x8010, 0x8018]]);
    assert.strictEqual(byName('n').ranges, null);
  });

  it('shows only the variables live at the PC', function () {
    const atI = liveSourceVariables(vars, 0x8005, { main: 0x8000 }, { main: 0x20 }).map(v => v.name);
    assert.deepStrictEqual(atI, ['score', 'i', 'arr', 'p', 'pt', 'n']);
    const atScore = liveSourceVariables(vars, 0x8019, { main: 0x8000 }, { main: 0x20 }).map(v => v.name);
    assert.deepStrictEqual(atScore, ['arr', 'p', 'pt', 'n']);
    // a parameter without enter/leave falls back to the current function
    assert.ok(liveSourceVariables(vars, 0x8019, { main: 0x8000 }, { main: 0x20 }).some(v => v.name == 'n'));
  });

  it('reads values through the stack pointer', function () {
    const mem: { [addr: number]: number } = { 0x9002: 0x34, 0x9003: 0x12 };
    const read = (addr: number) => {
      if (addr == 0x23) return 0x00;
      if (addr == 0x24) return 0x90;
      return mem[addr] || 0;
    };
    assert.strictEqual(sourceVariableAddress(byName('i'), read), 0x9002);
    assert.strictEqual(formatSourceValue(byName('i'), read), '$34 (52)');
    const tree = sourceVariableTree(vars, 0x8005, { main: 0x8000 }, { main: 0x20 }, read);
    assert.strictEqual(tree['i:u8'], '$34 (52)');
    assert.strictEqual(tree['score:i16'], '$0000 (0)');
  });
});
