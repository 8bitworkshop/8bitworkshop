import assert from "assert";
import { describe, it } from "mocha";
import { inferSymbolSizes, moduleRanges, parseSymbolSegments } from "../../src/worker/tools/sdcc";

describe('sdcc symbol sizes', function () {
  const segments = [{ start: 0x2000, size: 0x10 }, { start: 0x100, size: 0x40 }];

  it('sizes a symbol up to the next one, and the last up to its segment end', function () {
    const sizes = inferSymbolSizes({ _a: 0x2000, _b: 0x2001, _c: 0x2003 }, segments);
    assert.deepStrictEqual(sizes, { _a: 1, _b: 2, _c: 0xd });
  });

  it('gives aliases the same size, and skips bounds, debug labels and outsiders', function () {
    const sizes = inferSymbolSizes({
      _a: 0x2000, _alias: 0x2000, _b: 0x2004, s__DATA: 0x2000, l__DATA: 0x10,
      s_CODE: 0x2000, l_CODE: 0x40, 'G$f$0$0': 0x2002, _rom: 0x100, _far: 0x9000,
    }, segments);
    assert.deepStrictEqual(sizes, { _a: 4, _alias: 4, _b: 0xc, _rom: 0x40 });
  });
});

describe('sdcc segment symbols', function () {
  it('pairs the z80 areas, whose names start with an underscore', function () {
    const segments = parseSymbolSegments({
      s__CODE: 0x8100, l__CODE: 0x100, s__DATA: 0x7000, l__DATA: 9,
      s_OSEG: 0x7000, l_OSEG: 6,
    });
    assert.deepStrictEqual(segments, [
      { name: 'CODE', start: 0x8100, size: 0x100, type: 'rom' },
      { name: 'DATA', start: 0x7000, size: 9, type: 'ram' },
      { name: 'OSEG', start: 0x7000, size: 6, type: null },
    ]);
  });

  it('pairs the mos6502 areas, whose names have no underscore', function () {
    const segments = parseSymbolSegments({
      s__CODE: 0, l__CODE: 0, s_CODE: 0x858, l_CODE: 0xE3,
      s__DATA: 0xC000, l__DATA: 0, s_DATA: 0xC000, l_DATA: 1,
    });
    assert.deepStrictEqual(segments, [
      { name: 'CODE', start: 0x858, size: 0xE3, type: 'rom' },
      { name: 'DATA', start: 0xC000, size: 1, type: 'ram' },
    ]);
  });
});

describe('sdcc module ranges', function () {
  const rel = (area: string, size: number) => `XH3\nA _${area} size ${size.toString(16)} flags 0 addr 0\n`;
  const objs = [
    { name: 'crt0', rel: rel('HOME', 0x10) },
    { name: 'main', rel: rel('CODE', 0x100) + rel('DATA', 8) },
    { name: 'util', rel: rel('CODE', 0x40) },
  ];

  it('places each object after the previous one in every area, and the rest to libraries', function () {
    const mods = moduleRanges(objs, [
      { name: 'CODE', start: 0x200, size: 0x150 }, { name: 'HOME', start: 0x350, size: 0x30 }, { name: 'DATA', start: 0xc000, size: 8 }]);
    assert.deepStrictEqual(mods.CODE, [
      { name: 'main', start: 0x200, size: 0x100 }, { name: 'util', start: 0x300, size: 0x40 },
      { name: '(libraries)', start: 0x340, size: 0x10 }]);
    assert.deepStrictEqual(mods.HOME, [{ name: 'crt0', start: 0x350, size: 0x10 }, { name: '(libraries)', start: 0x360, size: 0x20 }]);
    assert.deepStrictEqual(mods.DATA, [{ name: 'main', start: 0xc000, size: 8 }]);
  });

  it('reads mos6502 areas, which are not prefixed with an underscore', function () {
    const mos = [{ name: 'hello', rel: rel('_CODE', 0) + rel('CODE', 0x87) }];
    assert.deepStrictEqual(moduleRanges(mos, [{ name: 'CODE', start: 0x858, size: 0x87 }]),
      { CODE: [{ name: 'hello', start: 0x858, size: 0x87 }] });
  });

  it('skips an area the objects overfill', function () {
    assert.deepStrictEqual(moduleRanges(objs, [{ name: 'CODE', start: 0x200, size: 0x100 }]), {});
  });
});
