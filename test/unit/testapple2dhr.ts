import assert from "assert";
import { describe, it } from "mocha";
import { mockAudio, mockGlobals } from "../../src/tools/nodemock";

mockGlobals();
mockAudio();

// imported after the browser globals are mocked (the machine pulls in the TSS
// audio channel objects)
import { AppleII } from "../../src/machine/apple2";
import { RGBA } from "../../src/common/util";

function newEnhanced() {
  const m = new AppleII(true);
  m.connectVideo(new Uint32Array(m.canvasWidth * m.numVisibleScanlines));
  return m;
}

// Graphics + full screen + page 1 + hi-res + 80COL, i.e. the double hi-res
// setup except for the DHIRES (AN3) switch.
function setupHires80(m: AppleII) {
  m.write(0xc00d, 0);  // 80COL on
  m.write(0xc050, 0);  // graphics
  m.write(0xc052, 0);  // not mixed
  m.write(0xc054, 0);  // page 1
  m.write(0xc057, 0);  // hi-res
}

function render(m: AppleII) {
  m.ap2disp.invalidate();
  m.ap2disp.updateScreen();
  return m.pixels.slice(0, m.canvasWidth); // scanline 0
}

// Line 0 as 140 4-bit pixels, packed the way the //e's scanner reads them: per
// column, aux bits 0-6 then main bits 0-6, low bit first. Bit 7 of each byte is
// set to junk, because double hi-res must ignore it.
function pokeLine0(m: AppleII, nibbles: number[]) {
  const stream: number[] = [];
  for (const n of nibbles) for (let i = 0; i < 4; i++) stream.push((n >> i) & 1);
  for (let x = 0; x < 40; x++) {
    let a = 0, b = 0;
    for (let i = 0; i < 7; i++) {
      a |= stream[x * 14 + i] << i;
      b |= stream[x * 14 + 7 + i] << i;
    }
    m.auxRAM[0x2000 + x] = a | (x & 1 ? 0x80 : 0);
    m.ram[0x2000 + x] = b | (x & 2 ? 0x80 : 0);
  }
}

describe('Apple //e double hi-res', function () {
  const nibbles = Array.from({ length: 140 }, (_, i) => (i * 7 + (i >> 4)) & 15);

  it('shows 16 colors, one per 4 dots, ignoring bit 7', () => {
    const m = newEnhanced();
    setupHires80(m);
    m.write(0xc05e, 0);  // DHIRES on
    pokeLine0(m, nibbles);
    const line = render(m);
    const colorOf: {[n: number]: number} = {};
    for (let k = 0; k < 140; k++) {
      const c = line[k * 4];
      for (let d = 1; d < 4; d++) assert.strictEqual(line[k * 4 + d], c, `pixel ${k} is 4 dots wide`);
      // the same nibble is always the same color, and different nibbles differ
      if (colorOf[nibbles[k]] === undefined) colorOf[nibbles[k]] = c;
      assert.strictEqual(c, colorOf[nibbles[k]], `pixel ${k} nibble ${nibbles[k]}`);
    }
    assert.strictEqual(Object.keys(colorOf).length, 16);
    assert.strictEqual(new Set(Object.values(colorOf)).size, 15); // lo-res grey 5 == grey 10
    // DHR nibble = lo-res color number rotated right one bit (foumartgames/lukazi
    // examples: yellow is 1110, magenta 1000 and dark blue 0001 in dot order)
    assert.strictEqual(colorOf[14], RGBA(208, 221, 141) >>> 0, 'yellow');
    assert.strictEqual(colorOf[8], RGBA(227, 30, 96) >>> 0, 'magenta');
    assert.strictEqual(colorOf[1], RGBA(96, 78, 189) >>> 0, 'dark blue');
    assert.strictEqual(colorOf[0], RGBA(0, 0, 0) >>> 0);
    assert.strictEqual(colorOf[15], RGBA(255, 255, 255) >>> 0);
  });

  it('is plain hi-res until DHIRES is switched on', () => {
    const m = newEnhanced();
    setupHires80(m);
    pokeLine0(m, nibbles);
    const hires = render(m);
    m.write(0xc05e, 0);
    const dhr = render(m);
    assert.notDeepStrictEqual(hires, dhr);
    m.write(0xc05f, 0);  // DHIRES off again
    assert.deepStrictEqual(render(m), hires);
  });

  it('saves and restores DHIRES, and reset turns it off', () => {
    const m = newEnhanced();
    m.write(0xc05e, 0);
    const s = m.saveState();
    assert.strictEqual(s.iie.an3, false);
    m.write(0xc05f, 0);
    m.loadState(s);
    assert.strictEqual(m.an3, false);
    m.reset();
    assert.strictEqual(m.an3, true);
  });
});

// In the //e's 80-column modes aux memory is the left (even) column of each pair
// and main memory the right (odd) one.
describe('Apple //e 80-column column order', function () {
  const white = RGBA(255, 255, 255) >>> 0, black = RGBA(0, 0, 0) >>> 0;

  it('draws aux before main in double lo-res', () => {
    const m = newEnhanced();
    m.write(0xc00d, 0);  // 80COL on
    m.write(0xc050, 0);  // graphics
    m.write(0xc052, 0);  // not mixed
    m.write(0xc056, 0);  // lo-res
    m.auxRAM[0x400] = 0x0f;  // aux: white top block of column 0
    m.ram[0x400] = 0x00;     // main: black
    const line = render(m);
    assert.strictEqual(line[0], white);
    assert.strictEqual(line[13], black);
  });

  it('shows aux double lo-res colors rotated left one bit', () => {
    const m = newEnhanced();
    m.write(0xc00d, 0);  // 80COL on
    m.write(0xc050, 0);  // graphics
    m.write(0xc052, 0);  // not mixed
    m.write(0xc056, 0);  // lo-res
    m.auxRAM[0x400] = 0x01;  // aux 1 = dark blue (lo-res 2)
    m.ram[0x400] = 0x01;     // main 1 = magenta, as in lo-res
    m.auxRAM[0x401] = 0x08;  // aux 8 = magenta (lo-res 1)
    m.ram[0x401] = 0x0d;     // main 13 = yellow
    const line = render(m);
    assert.strictEqual(line[0], RGBA(96, 78, 189) >>> 0, 'aux 1 is dark blue');
    assert.strictEqual(line[7], RGBA(227, 30, 96) >>> 0, 'main 1 is magenta');
    assert.strictEqual(line[14], RGBA(227, 30, 96) >>> 0, 'aux 8 is magenta');
    assert.strictEqual(line[21], RGBA(208, 221, 141) >>> 0, 'main 13 is yellow');
  });

  it('draws aux before main in 80-column text', () => {
    const m = newEnhanced();
    m.write(0xc00d, 0);  // 80COL on
    m.ram[0x400] = 0x00;     // main: inverse '@' is mostly lit
    m.auxRAM[0x400] = 0xa0;  // aux: normal space, all dark
    const line = render(m);
    // column 0 (pixels 0-6) comes from aux, so it is dark; column 1 from main
    assert.ok(line.slice(0, 7).every(c => c === line[0]));
    assert.ok(line.slice(7, 14).some(c => c !== line[0]));
  });
});
