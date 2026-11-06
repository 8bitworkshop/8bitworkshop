import assert from "assert";
import { describe, it } from "mocha";
import {
  getArtBit, countArtColumns, isArtColumn,
  validateAssetData, validateAssetByteLength, Viewer, Mapper
} from "../../src/ide/pixeleditor";

// A Viewer with a stand-in canvas context: updateImage() only needs image data.
function artViewer(width: number, height: number, gapX: number | null, gapBits: number): Viewer {
  var v = new Viewer();
  v.width = width;
  v.height = height;
  v.gapX = gapX;
  v.gapBits = gapBits;
  v.rgbdata = new Uint32Array(width * height);
  v.displayRgbData = new Uint32Array(v.displayWidth * height);
  v.ctx = { putImageData() { /* no canvas in unit tests */ } } as any;
  v.peerviewers = [v];
  return v;
}

describe('Pixel editor artifact color', function () {

  it('should locate the artifact bit (bit 7) for both bit orders', function () {
    assert.equal(getArtBit({ w: 8, h: 8 }), null);
    assert.equal(getArtBit({ w: 8, h: 8, art: 1 }), 7); // LSB first: bit 7 is last
    assert.equal(getArtBit({ w: 8, h: 8, art: 1, brev: true }), 0); // MSB first: bit 7 is first
    assert.equal(getArtBit({ w: 16, h: 1, art: 1, bpw: 16 }), 7);
    assert.equal(getArtBit({ w: 16, h: 1, art: 1, bpw: 16, brev: true }), 8);
  });

  it('should count one artifact column per word in a row', function () {
    assert.equal(countArtColumns(8, 7, 8), 1);
    assert.equal(countArtColumns(16, 7, 8), 2);
    assert.equal(countArtColumns(17, 7, 8), 2); // partial third word has no bit 7
    assert.equal(countArtColumns(8, 0, 8), 1);
    assert.equal(countArtColumns(7, 7, 8), 0); // w:7 leaves no room for the artifact bit
    assert.equal(countArtColumns(9, 15, 16), 0);
    assert.equal(countArtColumns(20, 15, 16), 1);
  });

  it('should identify artifact columns', function () {
    var art = (x: number) => isArtColumn(x, 16, 7, 8);
    assert.deepEqual([0, 1, 6, 7, 8, 14, 15].map(art),
      [false, false, false, true, false, false, true]);
    assert.ok(!isArtColumn(7, 7, 7, 8)); // outside the image
    assert.ok(isArtColumn(8, 16, 8, 16));
  });

  it('should draw the artifact column half-transparent, in place', function () {
    // alpha is the top byte of the RGBA word
    var faded = (c: number) => ((c & 0x00ffffff) | 0x80000000) >>> 0;
    var onebyte = artViewer(8, 1, 7, 8);
    onebyte.updateImage(new Uint32Array([0xff000010, 0xff000011, 0xff000012, 0xff000013,
      0xff000014, 0xff000015, 0xff000016, 0xff000017]));
    assert.equal(onebyte.displayWidth, 8); // no separator column
    assert.deepEqual(Array.from(onebyte.displayRgbData), [0xff000010, 0xff000011, 0xff000012,
      0xff000013, 0xff000014, 0xff000015, 0xff000016, faded(0xff000017)]);
    assert.equal(onebyte.rgbdata[7], 0xff000017); // the real color is untouched

    // two bytes per row: every word's bit 7 is faded
    var twobytes = artViewer(16, 1, 7, 8);
    var data = new Uint32Array(16).fill(0xff0000aa);
    twobytes.updateImage(data);
    var faded16 = Array.from(twobytes.displayRgbData).map((c, x) => c == faded(0xff0000aa) ? x : -1)
      .filter(x => x >= 0);
    assert.deepEqual(faded16, [7, 15]);

    // w:7 leaves no room for the artifact bit, so nothing is faded
    var nofit = artViewer(7, 1, 7, 8);
    nofit.updateImage(new Uint32Array(7).fill(0xff0000aa));
    assert.equal(nofit.displayWidth, 7);
    assert.ok(Array.from(nofit.displayRgbData).every(c => c == 0xff0000aa));
  });

  it('should write a toggled artifact bit back to the words', function () {
    // LSB first: the artifact bit is the last column of each 8-pixel group
    var mapper = new Mapper({ w: 8, h: 1, bpp: 1, art: 1 });
    mapper.left = { words: [0x41] } as any;
    mapper.updateRight();
    assert.deepEqual(Array.from(mapper.images[0]), [1, 0, 0, 0, 0, 0, 1, 0]);
    mapper.images[0][7] = 1;
    mapper.right = { images: mapper.images } as any;
    mapper.updateLeft();
    assert.deepEqual(Array.from(mapper.words as number[]), [0xc1]);

    // MSB first: the artifact bit is the first column of the group
    var brev = new Mapper({ w: 8, h: 1, bpp: 1, art: 1, brev: true });
    brev.left = { words: [0x41] } as any;
    brev.updateRight();
    assert.deepEqual(Array.from(brev.images[0]), [0, 1, 0, 0, 0, 0, 0, 1]);
    brev.images[0][0] = 1;
    brev.right = { images: brev.images } as any;
    brev.updateLeft();
    assert.deepEqual(Array.from(brev.words as number[]), [0xc1]);
  });

  it('should reject art:1 when w has no room for the artifact column', function () {
    assert.ok(/artifact column/.test(validateAssetData('0x00,0x01,0x02,0x03,0x04,0x05,0x06',
      { w: 7, h: 1, art: 1 })));
    assert.equal(validateAssetData('0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x08',
      { w: 8, h: 8, art: 1 }), null);
    assert.ok(/artifact column/.test(validateAssetByteLength(7, { w: 7, h: 1, art: 1 })));
    assert.equal(validateAssetByteLength(8, { w: 8, h: 8, art: 1 }), null);
  });
});
