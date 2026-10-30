import assert from "assert";
import { describe, it } from "mocha";
import { computeMemoryMapLayout, findLargeVariables, stripeBounds, addressAtOffset } from "../../src/ide/views/memmaplayout";
import { Segment } from "../../src/common/workertypes";
import { parseOscar64Map } from "../../src/worker/tools/oscar64parse";

const native: Segment[] = [
  { name: 'RAM', start: 0x0000, size: 0x800, type: 'ram', source: 'native' },
  { name: 'PPU', start: 0x2000, size: 0x8, type: 'io', source: 'native' },
  { name: 'ROM', start: 0x8000, size: 0x8000, type: 'rom', source: 'native' },
];
const linker: Segment[] = [
  { name: 'ZP', start: 0x00, size: 0x20, type: 'ram', source: 'linker' },
  { name: 'BSS', start: 0x300, size: 0x100, type: 'ram', source: 'linker' },
  { name: 'CODE', start: 0x8000, size: 0x1000, type: 'rom', source: 'linker' },
];

describe('Memory map layout', function () {

  it('fills gaps in the native column', function () {
    const layout = computeMemoryMapLayout(native);
    assert.equal(layout.columns.length, 1);
    const col = layout.columns[0];
    assert.equal(col.id, 'native');
    const blocks = col.blocks.slice().sort((a, b) => a.start - b.start);
    assert.deepEqual(blocks.map(b => [b.start, b.end, b.type]), [
      [0x0000, 0x0800, 'ram'],
      [0x0800, 0x2000, 'unmapped'],
      [0x2000, 0x2008, 'io'],
      [0x2008, 0x8000, 'unmapped'],
      [0x8000, 0x10000, 'rom'],
    ]);
    assert.equal(col.lanes, 1);
  });

  it('separates native and linker columns on shared bounds', function () {
    const layout = computeMemoryMapLayout(native.concat(linker));
    assert.deepEqual(layout.columns.map(c => c.id), ['native', 'linker']);
    const lnk = layout.columns[1];
    assert.ok(lnk.blocks.some(b => b.type == 'free' && b.start == 0x20 && b.end == 0x300));
    for (const col of layout.columns)
      for (const b of col.blocks) {
        assert.ok(layout.bounds.includes(b.start));
        assert.ok(layout.bounds.includes(b.end));
      }
  });

  it('puts overlapping segments in separate lanes', function () {
    const layout = computeMemoryMapLayout([
      { name: 'ROM', start: 0xd000, size: 0x3000, type: 'rom', source: 'native' },
      { name: 'LC', start: 0xd000, size: 0x1000, type: 'ram', source: 'native' },
    ]);
    const col = layout.columns[0];
    assert.equal(col.lanes, 2);
    assert.deepEqual(col.blocks.filter(b => b.start == 0xd000).map(b => b.lane).sort(), [0, 1]);
  });

  it('folds overlaps beyond the lane limit into a visible block', function () {
    const hdr = (name: string, size: number): Segment => ({ name, start: 0, size, source: 'linker' });
    const layout = computeMemoryMapLayout([hdr('EXEHDR', 2), hdr('MAINHDR', 4), hdr('SYSCHKHDR', 4), hdr('AUTOSTRT', 6)]);
    const col = layout.columns[0];
    assert.equal(col.lanes, 2);
    assert.equal(col.blocks.length, 2);
    const hidden = col.blocks.flatMap(b => (b.hidden || []).map(h => h.name)).sort();
    assert.deepEqual(hidden, ['EXEHDR', 'SYSCHKHDR']);
  });

  it('finds large variables from symbol gaps', function () {
    const symbols = {
      _small: 0x300, _buffer: 0x302, _last: 0x380,
      __BSS_RUN__: 0x300, _code: 0x8000, _zp: 0x10,
    };
    const vars = findLargeVariables(symbols, native.concat(linker), {minVarSize:16});
    assert.deepEqual(vars.map(v => [v.name, v.start, v.end]), [
      ['_last', 0x380, 0x400],
      ['_buffer', 0x302, 0x380],
      ['_zp', 0x10, 0x20],
    ]);
  });

  it('hides single-underscore segment bounds', function () {
    const symbols = { s_BSS: 0x300, l_BSS: 0x100, _buffer: 0x300 };
    const vars = findLargeVariables(symbols, native.concat(linker), {minVarSize:16});
    assert.deepEqual(vars.map(v => v.name), ['_buffer']);
  });

  it('skips the last symbol of a native-only RAM segment', function () {
    const vars = findLargeVariables({ _a: 0x100, _b: 0x200 }, native, {minVarSize:16});
    assert.deepEqual(vars.map(v => v.name), ['_a']);
  });

  it('uses reported symbol sizes over gap estimates', function () {
    const symbols = { _a: 0x300, _b: 0x340, ZeroStart: 0x380, _c: 0x380 };
    const sizes = { _a: 20, _b: 8, ZeroStart: 0, _c: 0x40 };
    const vars = findLargeVariables(symbols, native.concat(linker), {minVarSize:16}, sizes);
    assert.deepEqual(vars.map(v => [v.name, v.start, v.end, !!v.approx]), [
      ['_c', 0x380, 0x3c0, false],
      ['_a', 0x300, 0x314, false],
    ]);
  });

  it('reads object sizes from an oscar64 map', function () {
    const map = [
      'sections',
      '0a27 - 0a32 : DATA, data',
      '',
      'objects',
      '00f7 - 00f8 : c1A, DATA:zeropage',
      '00f7 - 00f7 : ZeroStart, START:zeropage',
      '0a32 - 0a5a : xbuf, DATA:bss',
      '0b00 - 0c00 : sinustable, DATA:data',
      '',
      'objects by size',
      '0b00 (0100) : sinustable, DATA:data',
    ].join('\n');
    const { symbolmap, symbolsizes } = parseOscar64Map(map);
    assert.equal(symbolmap.xbuf, 0x0a32);
    assert.deepEqual(symbolsizes, { c1A: 1, ZeroStart: 0, xbuf: 40, sinustable: 256 });
  });
});

describe('memory map stripe bounds', function () {
  it('inserts $1000 boundaries and assigns height fractions', function () {
    const s = stripeBounds([0x0000, 0x0800, 0x2000, 0x8000, 0x10000]);
    assert.ok(s);
    assert.deepStrictEqual(s.bounds, [
      0x0000, 0x0800, 0x1000, 0x2000, 0x3000, 0x4000, 0x5000, 0x6000, 0x7000,
      0x8000, 0x9000, 0xa000, 0xb000, 0xc000, 0xd000, 0xe000, 0xf000, 0x10000,
    ]);
    // every sub-row's weights within a parent sum to 1
    const sums = new Map<number, number>();
    for (let i = 0; i < s.parents.length; i++)
      sums.set(s.parents[i], (sums.get(s.parents[i]) || 0) + s.weights[i]);
    for (const sum of sums.values()) assert.ok(Math.abs(sum - 1) < 1e-9);
  });
  it('bails out on a huge address range', function () {
    assert.strictEqual(stripeBounds([0, 0x10000000]), null);
  });
});

describe('memory map address scrub', function () {
  it('maps row offsets to addresses', function () {
    const bounds = [0x0000, 0x1000, 0x2000];
    const heights = [1, 3];
    assert.strictEqual(addressAtOffset(bounds, heights, 0), 0x0000);
    assert.strictEqual(addressAtOffset(bounds, heights, 0.5), 0x0800);
    assert.strictEqual(addressAtOffset(bounds, heights, 1), 0x1000);
    assert.strictEqual(addressAtOffset(bounds, heights, 2), 0x1555);
    assert.strictEqual(addressAtOffset(bounds, heights, 4), 0x1fff);
  });
  it('clamps out-of-range offsets', function () {
    const bounds = [0, 0x1000];
    assert.strictEqual(addressAtOffset(bounds, [1], -5), 0);
    assert.strictEqual(addressAtOffset(bounds, [1], 99), 0xfff);
  });
});

describe('memory map modules column', function () {
  it('adds a Modules column from segment modules', function () {
    const layout = computeMemoryMapLayout([{ name: 'CODE', start: 0x200, size: 0x140, type: 'rom',
      modules: [{ name: 'main', start: 0x200, size: 0x100 }, { name: 'util', start: 0x300, size: 0x40 }] }]);
    const col = layout.columns.find(c => c.id == 'modules');
    assert.deepStrictEqual(col.blocks.map(b => [b.name, b.start, b.end]), [['main', 0x200, 0x300], ['util', 0x300, 0x340]]);
  });
  it('shows Objects only when no modules are known', function () {
    const syms = { _a: 0x200, _b: 0x300 };
    const seg = { name: 'DATA', start: 0x200, size: 0x140, type: 'ram' };
    const ids = (segs) => computeMemoryMapLayout(segs, syms, { minVarSize: 16 }).columns.map(c => c.id);
    assert.ok(ids([seg]).includes('vars'));
    const withmods = ids([{ ...seg, modules: [{ name: 'main', start: 0x200, size: 0x140 }] }]);
    assert.ok(withmods.includes('modules') && !withmods.includes('vars'));
  });
});
