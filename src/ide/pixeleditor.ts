
import { hex, rgb2bgr, rle_unpack, tobin } from "../common/util";
import { Toolbar } from "./toolbar";
import { ProjectWindows } from "./windows";

export type UintArray = number[] | Uint8Array | Uint16Array | Uint32Array; //{[i:number]:number};

const MAX_SIZE_X = 800;
const MAX_SIZE_Y = 1000;
const MAX_SCALE = 16;

// TODO: separate view/controller
export interface EditorContext {
  setCurrentEditor(div: JQuery, editing: JQuery, node: PixNode): void;
  getPalettes(matchlen: number): SelectablePalette[];
  getTilemaps(matchlen: number): SelectableTilemap[];
  getNamedArray?(name: string): number[] | null;
}

export type SelectablePalette = {
  node: PixNode | null
  name: string
  palette: Uint32Array
  group?: string	// owning palette's name, used to disambiguate duplicate names
}

export type SelectableTilemap = {
  node: PixNode
  name: string
  images: Uint8Array[]
  rgbimgs: Uint32Array[] // TODO: different palettes?
}

// Layout slice names repeat when a project has several palettes (e.g. many NES
// palettes all produce "Background 0"). Prefix just the duplicate names with
// their owning palette's `group` so the dropdown stays unambiguous.
export function disambiguatePaletteNames(palettes: SelectablePalette[]): SelectablePalette[] {
  var counts: { [name: string]: number } = {};
  palettes.forEach((p) => { counts[p.name] = (counts[p.name] || 0) + 1; });
  palettes.forEach((p) => {
    if (counts[p.name] > 1 && p.group) p.name = p.group + ": " + p.name;
  });
  return palettes;
}

export type PixelEditorImageFormat = {
  w: number		// width
  h: number		// height
  count?: number		// # of images
  bpp?: number		// bits per pixel
  np?: number		// number of planes
  bpw?: number		// bits per word
  sl?: number		// words per line
  pofs?: number		// plane offset
  remap?: number[]	// remap array
  reindex?: number[]	// reindex array
  brev?: boolean		// bit reverse (msb is leftmost)
  flip?: boolean		// flip vertically
  skip?: number		// skip bytes
  wpimg?: number		// words per image
  il?: boolean	// interleave images row by row
  aspect?: number	// aspect ratio
  xform?: string		// CSS transform
  art?: number | boolean	// artifact color, Apple II
  palname?: string	// preferred palette name (matches a palette header's `name`)
  defpal?: string		// predefined palette to use when the project has none
  destfmt?: PixelEditorImageFormat
  // Pac-Man / Namco arcade: 8-byte vertical strips (4 rows × 8 cols),
  // 2bpp packed as bit y + bit (y+4), X/Y mirrored within each strip.
  // Tiles (8×8): 2 strips. Sprites (16×16): 8 strips in hardware order.
  pacstrip?:boolean|number
};

// Logical (left-to-right) column of the artifact bit within each word.
// The artifact bit is bit 7 of the word; with `brev` (MSB leftmost) it is the
// first column of each group, with LSB-first data (Apple II HGR) the last.
export function getArtBit(fmt: PixelEditorImageFormat): number | null {
  if (!fmt.art) return null;
  var bitsperword = fmt.bpw || 8;
  return fmt.brev ? Math.max(0, bitsperword - 8) : Math.min(7, bitsperword - 1);
}

// Artifact columns are at `gapX`, `gapX + gapBits`, ... and only while they fit
// inside the image (w:7,art:1 has no room for bit 7 in a byte-per-row image).
export function countArtColumns(width: number, gapX: number | null, gapBits: number): number {
  if (gapX == null || gapX < 0 || gapX >= width) return 0;
  gapBits = gapBits || 8;
  return Math.floor((width - gapX - 1) / gapBits) + 1;
}

export function isArtColumn(x: number, width: number, gapX: number | null, gapBits: number): boolean {
  if (gapX == null || gapX < 0 || gapX >= width) return false;
  gapBits = gapBits || 8;
  return x >= gapX && ((x - gapX) % gapBits) == 0;
}

export type PixelEditorPaletteFormat = {
  pal?: number | string
  n?: number
  layout?: string
  name?: string		// display name shown in the pixel editor's palette picker
};

export type PixelEditorPaletteLayout = [string, number, number][];

type PixelEditorMessage = {
  fmt: PixelEditorImageFormat
  palfmt: PixelEditorPaletteFormat
  bytestr: string
  palstr: string
};

/////////////////


// 0xabcd, #$abcd, 5'010101, 0b010101, etc
var pixel_re = /([0#]?)([x$%]|\d'h)([0-9a-f]+)(?:[;].*)?|(\d'b|0b)([01]+)/gim;

function convertToHexStatements(s: string): string {
  // convert 'hex ....' asm format
  return s.replace(/(\shex\s+)([0-9a-f]+)/ig, function (m, hexprefix, hexstr) {
    var rtn = hexprefix;
    for (var i = 0; i < hexstr.length; i += 2) {
      rtn += '0x' + hexstr.substr(i, 2) + ',';
    }
    return rtn;
  });
}

export function parseHexWords(s: string): number[] {
  var arr = [];
  var m;
  while (m = pixel_re.exec(s)) {
    var n;
    if (m[4])
      n = parseInt(m[5], 2);
    else if (m[2].startsWith('%'))
      n = parseInt(m[3], 2);
    else if (m[2].startsWith('x') || m[2].startsWith('$') || m[2].endsWith('h'))
      n = parseInt(m[3], 16);
    else
      n = parseInt(m[3]);
    arr.push(n);
  }
  return arr;
}

export function replaceHexWords(s: string, words: UintArray, bpw: number): string {
  // convert 'hex ...' format to 0x prefixed values for regex matching
  s = convertToHexStatements(s);
  var result = "";
  var m;
  var li = 0;
  var i = 0;
  var nibbles = Math.ceil(bpw / 4);
  while (m = pixel_re.exec(s)) {
    result += s.slice(li, pixel_re.lastIndex - m[0].length);
    li = pixel_re.lastIndex;
    if (m[4])
      result += m[4] + tobin(words[i++], parseInt(m[4]));
    else if (m[2].startsWith('%'))
      result += m[1] + m[2] + tobin(words[i++], bpw);
    else if (m[2].endsWith('h'))
      result += m[1] + m[2] + hex(words[i++], parseInt(m[2]));
    else if (m[2].startsWith('x'))
      result += m[1] + "x" + hex(words[i++], nibbles);
    else if (m[2].startsWith('$'))
      result += m[1] + "$" + hex(words[i++], nibbles);
    else
      result += m[1] + words[i++].toString();
  }
  result += s.slice(li);
  // convert 'hex ....' asm format
  result = result.replace(/(\shex\s+)([,x0-9a-f]+)/ig, (m, hexprefix, hexstr) => {
    var rtn = hexprefix + hexstr;
    rtn = rtn.replace(/0x/ig, '').replace(/,/ig, '')
    return rtn;
  });
  return result;
}

function remapBits(x: number, arr: number[]): number {
  if (!arr) return x;
  var y = 0;
  for (var i = 0; i < arr.length; i++) {
    var s = arr[i];
    if (s < 0) {
      s = -s - 1;
      y ^= 1 << s;
    }
    if (x & (1 << i)) {
      y ^= 1 << s;
    }
  }
  return y;
}

// for VCS playfields
// ;;{w:20,h:10,flip:1,reindex:[4,5,6,7,15,14,13,12,11,10,9,8,16,17,18,19]};;
function reindexMask(x: number, inds: number[]): [number, number] {
  var i = inds[x % inds.length];
  return [i >> 3, i & 7];
}

// Pac-Man strip layouts (must match src/machine/pacman.ts PacmanVideo)
const PAC_TILE_STRIPS: [number, number, number][] = [
  // [byteOffset, bx, by]
  [0, 0, 4],
  [8, 0, 0],
];
const PAC_SPRITE_STRIPS: [number, number, number][] = [
  [0, 8, 12], [8, 8, 0], [16, 8, 4], [24, 8, 8],
  [32, 0, 12], [40, 0, 0], [48, 0, 4], [56, 0, 8],
];

function pacStripDecode(input: UintArray, inOff: number, output: number[], bx: number, by: number, imgWidth: number) {
  for (var x = 0; x < 8; x++) {
    var strip = input[inOff + x] || 0;
    for (var y = 0; y < 4; y++) {
      var i = (3 - y) * imgWidth + (7 - x);
      var pen = ((strip >> y) & 1) | (((strip >> (y + 4)) & 1) << 1);
      output[by * imgWidth + bx + i] = pen;
    }
  }
}

function pacStripEncode(output: number[], outOff: number, pixels: Uint8Array|number[], bx: number, by: number, imgWidth: number) {
  for (var x = 0; x < 8; x++) {
    var strip = 0;
    for (var y = 0; y < 4; y++) {
      var i = (3 - y) * imgWidth + (7 - x);
      var pen = (pixels[by * imgWidth + bx + i] || 0) & 3;
      if (pen & 1) strip |= (1 << y);
      if (pen & 2) strip |= (1 << (y + 4));
    }
    output[outOff + x] = strip;
  }
}

function pacStripLayouts(fmt: PixelEditorImageFormat): [number, number, number][] {
  if (fmt.w === 16 && fmt.h === 16) return PAC_SPRITE_STRIPS;
  return PAC_TILE_STRIPS;
}

function pacStripBytesPerImage(fmt: PixelEditorImageFormat): number {
  return pacStripLayouts(fmt).length * 8;
}

function convertPacStripWordsToImages(words: UintArray, fmt: PixelEditorImageFormat): Uint8Array[] {
  var width = fmt.w;
  var height = fmt.h;
  var count = fmt.count || 1;
  var wpimg = fmt.wpimg || pacStripBytesPerImage(fmt);
  var layouts = pacStripLayouts(fmt);
  var images = [];
  for (var n = 0; n < count; n++) {
    var pix: number[] = new Array(width * height).fill(0);
    var base = n * wpimg;
    for (var s = 0; s < layouts.length; s++) {
      var [off, bx, by] = layouts[s];
      pacStripDecode(words, base + off, pix, bx, by, width);
    }
    images.push(new Uint8Array(pix));
  }
  return images;
}

function convertPacStripImagesToWords(images: Uint8Array[], fmt: PixelEditorImageFormat): number[] {
  var width = fmt.w;
  var height = fmt.h;
  var count = fmt.count || images.length;
  var wpimg = fmt.wpimg || pacStripBytesPerImage(fmt);
  var layouts = pacStripLayouts(fmt);
  var words = new Array(wpimg * count).fill(0);
  for (var n = 0; n < count; n++) {
    var pix = images[n] || new Uint8Array(width * height);
    var base = n * wpimg;
    for (var s = 0; s < layouts.length; s++) {
      var [off, bx, by] = layouts[s];
      pacStripEncode(words, base + off, pix, bx, by, width);
    }
  }
  return words;
}

export function convertWordsToImages(words:UintArray, fmt:PixelEditorImageFormat) : Uint8Array[] {
  if (fmt.pacstrip) return convertPacStripWordsToImages(words, fmt);
  var width = fmt.w;
  var height = fmt.h;
  var count = fmt.count || 1;
  var bpp = fmt.bpp || 1;
  var nplanes = fmt.np || 1;
  var bitsperword = fmt.bpw || 8;
  var wordsperline = fmt.sl || Math.ceil(width * bpp / bitsperword);
  var mask = (1 << bpp) - 1;
  var pofs = fmt.pofs || wordsperline * height * count;
  var skip = fmt.skip || 0;
  var wpimg = fmt.wpimg || wordsperline * height;
  var rowstride = wordsperline;
  if (fmt.il) { wpimg = wordsperline; rowstride = wordsperline * count; }
  var images = [];
  for (var n = 0; n < count; n++) {
    var imgdata = [];
    for (var y = 0; y < height; y++) {
      var yp = fmt.flip ? height - 1 - y : y;
      var ofs0 = wpimg * n + yp * rowstride;
      var shift = 0;
      for (var x = 0; x < width; x++) {
        var color = 0;
        var ofs = remapBits(ofs0, fmt.remap);
        if (fmt.reindex) { [ofs, shift] = reindexMask(x, fmt.reindex); ofs += ofs0; }
        for (var p = 0; p < nplanes; p++) {
          var byte = words[ofs + p * pofs + skip];
          color |= ((fmt.brev ? byte >> (bitsperword - shift - bpp) : byte >> shift) & mask) << (p * bpp);
        }
        imgdata.push(color);
        shift += bpp;
        if (shift >= bitsperword && !fmt.reindex) {
          ofs0 += 1;
          shift = 0;
        }
      }
    }
    images.push(new Uint8Array(imgdata));
  }
  return images;
}

function computeRequiredWords(fmt): number {
  // mirrors the addressing performed by convertWordsToImages: the data must cover
  // every word the converter can read, and must also span the full per-image block
  // extent (wpimg * count), e.g. hardware sprite strides larger than the visible rows.
  var count = fmt.count || 1;
  var bpp = fmt.bpp || 1;
  var nplanes = fmt.np || 1;
  var bitsperword = fmt.bpw || 8;
  var wordsperline = fmt.sl || Math.ceil(fmt.w * bpp / bitsperword);
  var pofs = fmt.pofs || wordsperline * fmt.h * count;
  var skip = fmt.skip || 0;
  var wpimg = fmt.wpimg || (fmt.map === 'nesnt' ? 1024 : wordsperline * fmt.h);
  var rowstride = wordsperline;
  if (fmt.il) { wpimg = wordsperline; rowstride = wordsperline * count; }

  var maxReindexOfs = 0;
  if (fmt.reindex) {
    for (var x = 0; x < fmt.w; x++) {
      maxReindexOfs = Math.max(maxReindexOfs, reindexMask(x, fmt.reindex)[0]);
    }
  }
  var maxAddr = 0;
  for (var n = 0; n < count; n++) {
    for (var y = 0; y < fmt.h; y++) {
      var yp = fmt.flip ? fmt.h - 1 - y : y;
      var ofs0 = wpimg * n + yp * rowstride;
      var steps = Math.ceil(fmt.w * bpp / bitsperword);
      for (var s = 0; s < steps; s++) {
        var ofs = fmt.reindex ? (ofs0 + maxReindexOfs) : remapBits(ofs0, fmt.remap);
        maxAddr = Math.max(maxAddr, ofs + (nplanes - 1) * pofs + skip);
        ofs0++;
      }
    }
  }
  return Math.max(wpimg * count, maxAddr + 1);
}

// "charpad" and "tilemap" blocks are grids of one tile index per cell
function isTileGridMap(fmt): boolean {
  return fmt.map == 'charpad' || fmt.map == 'tilemap';
}

function validateArtFormat(fmt): string | null {
  var artBit = getArtBit(fmt);
  if (artBit != null && fmt.w > 0 && artBit >= fmt.w)
    return `art:1 requires w to include the artifact column (w:${artBit + 1} for this format)`;
  return null;
}

export function validateAssetData(datastr: string, fmt): string | null {
  var err = validateArtFormat(fmt);
  if (err) return err;
  var words = parseHexWords(convertToHexStatements(datastr));
  if (fmt.comp == 'rletag') {
    words = Array.from(rle_unpack(new Uint8Array(words)));
  }
  if (isTileGridMap(fmt)) {
    // tile grid: one tile index per cell (w, h are in tiles, not pixels)
    if (words.length != fmt.w * fmt.h)
      return `Expected ${fmt.w * fmt.h} value(s), found ${words.length}`;
  } else if (fmt.w > 0 && fmt.h > 0) {
    var required = computeRequiredWords(fmt);
    if (words.length != required) {
      return `Expected ${required} value(s), found ${words.length}`;
    }
  } else if (fmt.pal) {
    if (words.length < 1) {
      return `Palette requires at least 1 value, found ${words.length}`;
    }
  }
  return null;
}

// same as validateAssetData, but for a raw binary file (e.g. referenced via #embed)
// where the byte count is already known and there's no source text to parse
export function validateAssetByteLength(bytelen: number, fmt): string | null {
  var err = validateArtFormat(fmt);
  if (err) return err;
  if (fmt.comp == 'rletag') {
    return null; // can't statically determine compressed length
  }
  if (isTileGridMap(fmt)) {
    if (bytelen != fmt.w * fmt.h)
      return `Expected ${fmt.w * fmt.h} byte(s), found ${bytelen}`;
  } else if (fmt.w > 0 && fmt.h > 0) {
    var required = computeRequiredWords(fmt);
    if (bytelen != required) {
      return `Expected ${required} byte(s), found ${bytelen}`;
    }
  } else if (fmt.pal) {
    if (bytelen < 1) {
      return `Palette requires at least 1 byte, found ${bytelen}`;
    }
  }
  return null;
}

export type AssetFragment = {
  header: string
  startline: number
  endline: number | string
  fmt?: any
  start?: number
  end?: number
  embedFile?: string
  error?: string
};

function getLineNumber(data: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < data.length; i++) {
    if (data[i] === '\n') line++;
  }
  return line;
}

// Returns the index of the ']' matching the '[' at `open`, skipping over line/block
// comments and string literals. Returns -1 if unmatched.
export function findMatchingBracket(text: string, open: number): number {
  if (open < 0 || text[open] !== '[') return -1;
  var depth = 0;
  for (var i = open; i < text.length; i++) {
    var c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      var nl = text.indexOf('\n', i);
      if (nl < 0) return -1;
      i = nl;
    } else if (c === '/' && text[i + 1] === '*') {
      var bc = text.indexOf('*/', i + 2);
      if (bc < 0) return -1;
      i = bc + 1;
    } else if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === '\\') i++;
      }
    } else if (c === '[') {
      depth++;
    } else if (c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Finds the end of a Rust array literal (the matching ']') that follows the
// assignment '=' after `start`. Anchoring on '=' skips the type annotation
// `[u8; N]`, whose ';' would otherwise fool the C-style "close at next ;" rule.
function findRustDataEnd(data: string, start: number): number {
  var eq = data.indexOf('=', start);
  if (eq < 0) return -1;
  var open = data.indexOf('[', eq);
  if (open < 0) return -1;
  return findMatchingBracket(data, open);
}

// Scans source text for "/*{json}*/" or ";;{json};;" asset headers followed by a data
// block closed by the next ';' (C), ';;' (asm), "end" (verilog), or the matching ']'
// of the array literal (Rust). Pure/testable: no DOM or project dependencies -- the
// language-specific closing delimiter is supplied by the caller.
export function scanTextForAssetFragments(data: string, isVerilog: boolean, isRust: boolean = false): AssetFragment[] {
  // Rust accepts /*{json}*/ and //{json} (or ///{json}); the latter has no closing
  // comment delimiter, so it runs to end of line.
  var re1 = isRust
    ? /\/\*(\{[^\n]+?\})\*\/|\/\/\/?[ \t]*(\{[^\n]+?\})/g
    : /[/;][*;]([{].+[}])[*;][/;]/g;
  var result: AssetFragment[] = [];
  var m;
  while (m = re1.exec(data)) {
    var jsonstr = m[1] || m[2];
    var start = m.index + m[0].length;
    var end;
    if (isVerilog) {
      end = data.indexOf("end", start);
    } else if (isRust) {
      end = findRustDataEnd(data, start);
    } else if (m[0].startsWith(';;')) {
      end = data.indexOf(';;', start);
      if (end == data.indexOf(';;{', start)) {
        // ignore start of next asset
        end = -1;
      }
    } else {
      end = data.indexOf(';', start); // C
    }
    var startline = getLineNumber(data, m.index);
    var header = m[0];
    var endline = end >= 0 ? getLineNumber(data, end) : '???';
    if (end < 0) {
      var closingDelim = isVerilog ? '"end"' : isRust ? '"]"' : m[0].startsWith(';;') ? '";;"' : '";"';
      result.push({ header: header, startline: startline, endline: endline, error: `No closing ${closingDelim} found after asset header` });
    } else if (end <= start) {
      result.push({ header: header, startline: startline, endline: endline, error: `Empty data block after asset header` });
    } else {
      try {
        var jsontxt = jsonstr.replace(/([A-Za-z_]\w*):/g, '"$1":'); // fix lenient JSON
        var json = JSON.parse(jsontxt);
        // C23 #embed "file.bin" -- data lives in a separate binary file, not inline
        var embedMatch = /#embed\s+"(.+?)"/.exec(data.substring(start, end));
        var embedFile = embedMatch ? embedMatch[1] : undefined;
        result.push({ header: header, startline: startline, endline: endline, fmt: json, start: start, end: end, embedFile: embedFile });
      } catch (e) {
        result.push({ header: header, startline: startline, endline: endline, error: `Invalid asset format: ${e.message}` });
      }
    }
  }
  return result;
}

// Resolves a #embed "file.bin" path against a project file-existence check: tries the
// plain name first, then a directory-prefixed candidate based on the including file's
// own path (e.g. "sub/main.c" + "data.bin" -> "sub/data.bin").
export function resolveEmbedPath(fileid: string, embedName: string, fileExists: (path: string) => boolean): string | null {
  if (fileExists(embedName)) return embedName;
  var slash = fileid.lastIndexOf('/');
  if (slash >= 0) {
    var candidate = fileid.substring(0, slash + 1) + embedName;
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

export function convertImagesToWords(images: Uint8Array[], fmt: PixelEditorImageFormat): number[] {
  if (fmt.destfmt) fmt = fmt.destfmt;
  if (fmt.pacstrip) return convertPacStripImagesToWords(images, fmt);
  var width = fmt.w;
  var height = fmt.h;
  var count = fmt.count || 1;
  var bpp = fmt.bpp || 1;
  var nplanes = fmt.np || 1;
  var bitsperword = fmt.bpw || 8;
  var wordsperline = fmt.sl || Math.ceil(fmt.w * bpp / bitsperword);
  var mask = (1 << bpp) - 1;
  var pofs = fmt.pofs || wordsperline * height * count;
  var skip = fmt.skip || 0;
  var wpimg = fmt.wpimg || wordsperline * height;
  var rowstride = wordsperline;
  if (fmt.il) { wpimg = wordsperline; rowstride = wordsperline * count; }

  var totalwords = fmt.il ? rowstride * height : wpimg * count;
  var words;
  if (nplanes > 0 && fmt.sl) // TODO?
    words = new Uint8Array(totalwords);
  else if (bitsperword <= 8)
    words = new Uint8Array(totalwords * nplanes);
  else
    words = new Uint32Array(totalwords * nplanes);

  for (var n = 0; n < count; n++) {
    var imgdata = images[n];
    var i = 0;
    for (var y = 0; y < height; y++) {
      var yp = fmt.flip ? height - 1 - y : y;
      var ofs0 = n * wpimg + yp * rowstride;
      var shift = 0;
      for (var x = 0; x < width; x++) {
        var color = imgdata[i++];
        var ofs = remapBits(ofs0, fmt.remap);
        if (fmt.reindex) { [ofs, shift] = reindexMask(x, fmt.reindex); ofs += ofs0; }
        for (var p = 0; p < nplanes; p++) {
          var c = (color >> (p * bpp)) & mask;
          words[ofs + p * pofs + skip] |= (fmt.brev ? (c << (bitsperword - shift - bpp)) : (c << shift));
        }
        shift += bpp;
        if (shift >= bitsperword && !fmt.reindex) {
          ofs0 += 1;
          shift = 0;
        }
      }
    }
  }
  return words;
}

// TODO
export function convertPaletteBytes(arr: UintArray, r0, r1, g0, g1, b0, b1): number[] {
  var result = [];
  for (var i = 0; i < arr.length; i++) {
    var d = arr[i];
    var rgb = 0xff000000;
    rgb |= ((d >> r0) & ((1 << r1) - 1)) << (0 + 8 - r1);
    rgb |= ((d >> g0) & ((1 << g1) - 1)) << (8 + 8 - g1);
    rgb |= ((d >> b0) & ((1 << b1) - 1)) << (16 + 8 - b1);
    result.push(rgb);
  }
  return result;
}

/**
 * Pac-Man / Namco color PROM byte → RGBA.
 * Must match src/machine/pacman.ts PacmanVideo.rebuild() (MAME resistor weights).
 * Encoding: RRR (bits 0-2), GGG (3-5), BB (6-7).
 */
export function decodePacmanColorPromByte(d: number): number {
  var r = ((d >> 0) & 1) * 0x21 + ((d >> 1) & 1) * 0x47 + ((d >> 2) & 1) * 0x97;
  var g = ((d >> 3) & 1) * 0x21 + ((d >> 4) & 1) * 0x47 + ((d >> 5) & 1) * 0x97;
  var b = ((d >> 6) & 1) * 0x51 + ((d >> 7) & 1) * 0xae;
  return 0xff000000 | (b << 16) | (g << 8) | r;
}

export function getPaletteLength(palfmt: PixelEditorPaletteFormat): number {
  var pal = palfmt.pal;
  if (typeof pal === 'number') {
    var rr = Math.floor(Math.abs(pal / 100) % 10);
    var gg = Math.floor(Math.abs(pal / 10) % 10);
    var bb = Math.floor(Math.abs(pal) % 10);
    return 1<<(rr+gg+bb);
  } else if (pal === 'pacman') {
    return 256; // every PROM encoding byte → a color
  } else {
    var paltable = PREDEF_PALETTES[pal];
    if (paltable) {
      return paltable.length;
    } else {
      throw new Error("No palette named " + pal);
    }
  }
}

export function convertPaletteFormat(palbytes: UintArray, palfmt: PixelEditorPaletteFormat): number[] {
  var pal = palfmt.pal;
  var newpalette;
  if (typeof pal === 'number') {
    var rr = Math.floor(Math.abs(pal / 100) % 10);
    var gg = Math.floor(Math.abs(pal / 10) % 10);
    var bb = Math.floor(Math.abs(pal) % 10);
    // TODO: n
    if (pal >= 0)
      newpalette = convertPaletteBytes(palbytes, 0, rr, rr, gg, rr + gg, bb);
    else
      newpalette = convertPaletteBytes(palbytes, rr+gg, bb, rr, gg, 0, rr);
  } else if (pal === 'pacman') {
    newpalette = [];
    for (var i = 0; i < palbytes.length; i++)
      newpalette.push(decodePacmanColorPromByte(palbytes[i]));
  } else {
    var paltable = PREDEF_PALETTES[pal];
    if (paltable) {
      newpalette = new Uint32Array(palbytes).map((i) => { return paltable[i & (paltable.length - 1)] | 0xff000000; });
    } else {
      throw new Error("No palette named " + pal);
    }
  }
  return newpalette;
}

// Direct-color palette formats (e.g. pal:444) encode RGB channels in the word
// itself instead of indexing a fixed table. getDirectColorChannels() describes
// where each channel lives so the palette editor can offer RGB controls rather
// than a grid of thousands of swatches.
export type DirectColorChannels = {
  r: number; g: number; b: number;             // bits per channel
  rshift: number; gshift: number; bshift: number; // bit offsets in the word
};

export function getDirectColorChannels(palfmt: PixelEditorPaletteFormat): DirectColorChannels | null {
  var pal = palfmt.pal;
  if (typeof pal !== 'number' || !isFinite(pal)) return null;
  var rr = Math.floor(Math.abs(pal / 100) % 10);
  var gg = Math.floor(Math.abs(pal / 10) % 10);
  var bb = Math.floor(Math.abs(pal) % 10);
  if (rr + gg + bb <= 0) return null;
  if (pal >= 0)
    return { r: rr, g: gg, b: bb, rshift: 0, gshift: rr, bshift: rr + gg };
  // negative pal: convertPaletteBytes(arr, rr+gg, bb, rr, gg, 0, rr)
  return { r: bb, g: gg, b: rr, rshift: rr + gg, gshift: rr, bshift: 0 };
}

// Pack per-channel values into a direct-color palette word (inverse of
// decodeDirectColorWord / convertPaletteFormat).
export function encodeDirectColorWord(palfmt: PixelEditorPaletteFormat, r: number, g: number, b: number): number {
  var c = getDirectColorChannels(palfmt);
  if (!c) return 0;
  return ((r & ((1 << c.r) - 1)) << c.rshift)
    | ((g & ((1 << c.g) - 1)) << c.gshift)
    | ((b & ((1 << c.b) - 1)) << c.bshift);
}

export function decodeDirectColorWord(palfmt: PixelEditorPaletteFormat, word: number): { r: number; g: number; b: number } | null {
  var c = getDirectColorChannels(palfmt);
  if (!c) return null;
  return {
    r: (word >> c.rshift) & ((1 << c.r) - 1),
    g: (word >> c.gshift) & ((1 << c.g) - 1),
    b: (word >> c.bshift) & ((1 << c.b) - 1),
  };
}

// TODO: illegal colors?
const PREDEF_PALETTES = {
  // LCD polarity: index 0 = lightest (pixel off), 3 = darkest (pixel on)
  'gb': [
    0xd0d884, 0x87a84c, 0x526b34, 0x2d3122,
  ],
  'nes': [
    0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000,
    0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000,
    0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000,
    0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000
  ],
  'ap2lores': [
    (0x000000), (0xff00ff), (0x00007f), (0x7f007f), (0x007f00), (0x7f7f7f), (0x0000bf), (0x0000ff),
    (0xbf7f00), (0xffbf00), (0xbfbfbf), (0xff7f7f), (0x00ff00), (0xffff00), (0x00bf7f), (0xffffff),
  ],
  'vcs': [
    0x000000, 0x000000, 0x404040, 0x404040, 0x6c6c6c, 0x6c6c6c, 0x909090, 0x909090, 0xb0b0b0, 0xb0b0b0, 0xc8c8c8, 0xc8c8c8, 0xdcdcdc, 0xdcdcdc, 0xf4f4f4, 0xf4f4f4,
    0x004444, 0x004444, 0x106464, 0x106464, 0x248484, 0x248484, 0x34a0a0, 0x34a0a0, 0x40b8b8, 0x40b8b8, 0x50d0d0, 0x50d0d0, 0x5ce8e8, 0x5ce8e8, 0x68fcfc, 0x68fcfc,
    0x002870, 0x002870, 0x144484, 0x144484, 0x285c98, 0x285c98, 0x3c78ac, 0x3c78ac, 0x4c8cbc, 0x4c8cbc, 0x5ca0cc, 0x5ca0cc, 0x68b4dc, 0x68b4dc, 0x78c8ec, 0x78c8ec,
    0x001884, 0x001884, 0x183498, 0x183498, 0x3050ac, 0x3050ac, 0x4868c0, 0x4868c0, 0x5c80d0, 0x5c80d0, 0x7094e0, 0x7094e0, 0x80a8ec, 0x80a8ec, 0x94bcfc, 0x94bcfc,
    0x000088, 0x000088, 0x20209c, 0x20209c, 0x3c3cb0, 0x3c3cb0, 0x5858c0, 0x5858c0, 0x7070d0, 0x7070d0, 0x8888e0, 0x8888e0, 0xa0a0ec, 0xa0a0ec, 0xb4b4fc, 0xb4b4fc,
    0x5c0078, 0x5c0078, 0x74208c, 0x74208c, 0x883ca0, 0x883ca0, 0x9c58b0, 0x9c58b0, 0xb070c0, 0xb070c0, 0xc084d0, 0xc084d0, 0xd09cdc, 0xd09cdc, 0xe0b0ec, 0xe0b0ec,
    0x780048, 0x780048, 0x902060, 0x902060, 0xa43c78, 0xa43c78, 0xb8588c, 0xb8588c, 0xcc70a0, 0xcc70a0, 0xdc84b4, 0xdc84b4, 0xec9cc4, 0xec9cc4, 0xfcb0d4, 0xfcb0d4,
    0x840014, 0x840014, 0x982030, 0x982030, 0xac3c4c, 0xac3c4c, 0xc05868, 0xc05868, 0xd0707c, 0xd0707c, 0xe08894, 0xe08894, 0xeca0a8, 0xeca0a8, 0xfcb4bc, 0xfcb4bc,
    0x880000, 0x880000, 0x9c201c, 0x9c201c, 0xb04038, 0xb04038, 0xc05c50, 0xc05c50, 0xd07468, 0xd07468, 0xe08c7c, 0xe08c7c, 0xeca490, 0xeca490, 0xfcb8a4, 0xfcb8a4,
    0x7c1800, 0x7c1800, 0x90381c, 0x90381c, 0xa85438, 0xa85438, 0xbc7050, 0xbc7050, 0xcc8868, 0xcc8868, 0xdc9c7c, 0xdc9c7c, 0xecb490, 0xecb490, 0xfcc8a4, 0xfcc8a4,
    0x5c2c00, 0x5c2c00, 0x784c1c, 0x784c1c, 0x906838, 0x906838, 0xac8450, 0xac8450, 0xc09c68, 0xc09c68, 0xd4b47c, 0xd4b47c, 0xe8cc90, 0xe8cc90, 0xfce0a4, 0xfce0a4,
    0x2c3c00, 0x2c3c00, 0x485c1c, 0x485c1c, 0x647c38, 0x647c38, 0x809c50, 0x809c50, 0x94b468, 0x94b468, 0xacd07c, 0xacd07c, 0xc0e490, 0xc0e490, 0xd4fca4, 0xd4fca4,
    0x003c00, 0x003c00, 0x205c20, 0x205c20, 0x407c40, 0x407c40, 0x5c9c5c, 0x5c9c5c, 0x74b474, 0x74b474, 0x8cd08c, 0x8cd08c, 0xa4e4a4, 0xa4e4a4, 0xb8fcb8, 0xb8fcb8,
    0x003814, 0x003814, 0x1c5c34, 0x1c5c34, 0x387c50, 0x387c50, 0x50986c, 0x50986c, 0x68b484, 0x68b484, 0x7ccc9c, 0x7ccc9c, 0x90e4b4, 0x90e4b4, 0xa4fcc8, 0xa4fcc8,
    0x00302c, 0x00302c, 0x1c504c, 0x1c504c, 0x347068, 0x347068, 0x4c8c84, 0x4c8c84, 0x64a89c, 0x64a89c, 0x78c0b4, 0x78c0b4, 0x88d4cc, 0x88d4cc, 0x9cece0, 0x9cece0,
    0x002844, 0x002844, 0x184864, 0x184864, 0x306884, 0x306884, 0x4484a0, 0x4484a0, 0x589cb8, 0x589cb8, 0x6cb4d0, 0x6cb4d0, 0x7ccce8, 0x7ccce8, 0x8ce0fc, 0x8ce0fc
  ],
  'astrocade': [0, 2368548, 4737096, 7171437, 9539985, 11974326, 14342874, 16777215, 12255269, 14680137, 16716142, 16725394, 16734903, 16744155, 16753663, 16762879, 11534409, 13959277, 16318866, 16721334, 16730842, 16740095, 16749311, 16758783, 10420330, 12779662, 15138995, 16718039, 16727291, 16736767, 16745983, 16755199, 8847495, 11206827, 13631696, 15994612, 16724735, 16733951, 16743423, 16752639, 6946975, 9306307, 11731175, 14092287, 16461055, 16732415, 16741631, 16751103, 4784304, 7143637, 9568505, 11929087, 14297599, 16731647, 16741119, 16750335, 2425019, 4784352, 7209215, 9570047, 12004095, 14372863, 16741375, 16750847, 191, 2359523, 4718847, 7146495, 9515263, 11949311, 14318079, 16752127, 187, 224, 2294015, 4658431, 7092735, 9461247, 11895551, 14264063, 176, 213, 249, 2367999, 4736511, 7105279, 9539327, 11908095, 159, 195, 3303, 209151, 2577919, 4946431, 7380735, 9749247, 135, 171, 7888, 17140, 681983, 3050495, 5484543, 7853311, 106, 3470, 12723, 22231, 31483, 1548031, 3916799, 6285311, 73, 8557, 17810, 27318, 36570, 373759, 2742271, 5176575, 4389, 13641, 23150, 32402, 41911, 51163, 2026495, 4456447, 9472, 18724, 27976, 37485, 46737, 56246, 1834970, 4194303, 14080, 23296, 32803, 42055, 51564, 60816, 2031541, 4456409, 18176, 27648, 36864, 46116, 55624, 392556, 2752401, 5177269, 21760, 30976, 40192, 49667, 58919, 1572683, 3932016, 6291348, 24320, 33536, 43008, 52224, 716810, 3079982, 5504851, 7864183, 25856, 35328, 44544, 250368, 2619136, 4980503, 7405371, 9764703, 26624, 35840, 45312, 2413824, 4782336, 7143173, 9568041, 11927374, 26112, 35584, 2338560, 4707328, 7141376, 9502464, 11927326, 14286659, 24832, 2393344, 4762112, 7196160, 9564928, 11992832, 14352155, 16711487, 2447360, 4815872, 7250176, 9618688, 12052992, 14417664, 16776990, 16777027, 4803328, 7172096, 9606144, 11974912, 14343424, 16776965, 16777001, 16777038, 6962176, 9330688, 11764992, 14133504, 16502272, 16773655, 16777019, 16777055, 8858112, 11226880, 13660928, 16029440, 16759818, 16769070, 16777043, 16777079, 10426112, 12794624, 15163392, 16745475, 16754727, 16764235, 16773488, 16777108, 11534848, 13969152, 16337664, 16740388, 16749640, 16759148, 16768401, 16777141, 12255232, 14684928, 16725795, 16735047, 16744556, 16753808, 16763317, 16772569],
  'c64': [0x000000, 0xffffff, 0x2b3768, 0xb2a470, 0x863d6f, 0x438d58, 0x792835, 0x6fc7b8, 0x254f6f, 0x003943, 0x59679a, 0x444444, 0x6c6c6c, 0x84d29a, 0xb55e6c, 0x959595],
};

// SMS and Game Gear share the same mode-4 CRAM layout: 32 colors where the
// tilemap's bit 11 selects palette 0 (background, colors 0-15) or palette 1
// (sprites, colors 16-31). Game Gear packs 12-bit color, SMS 6-bit, but the
// index layout is identical, so one layout serves both.
var SMS_GG_LAYOUT: PixelEditorPaletteLayout = [
  ['Background', 0x00, 16],
  ['Sprite',     0x10, 16],
];

export var PREDEF_LAYOUTS: { [id: string]: PixelEditorPaletteLayout } = {
  'nes': [
    ['Screen Color', 0x00, 1],
    ['Background 0', 0x01, 3],
    ['Background 1', 0x05, 3],
    ['Background 2', 0x09, 3],
    ['Background 3', 0x0d, 3],
    ['Sprite 0', 0x11, 3],
    ['Sprite 1', 0x15, 3],
    ['Sprite 2', 0x19, 3],
    ['Sprite 3', 0x1d, 3]
  ],
  'astrocade': [
    ['Left', 0x00, -4],
    ['Right', 0x04, -4]
  ],
  // Pac-Man: each palette PROM entry is 4 pens (indices into the 32-color PROM).
  // Arrays tagged layout:"pacman" should store those pens as already-resolved color-PROM bytes.
  'pacman':[
    ['Pal 01', 0x00, 4],
    ['Pal 03', 0x04, 4],
    ['Pal 05', 0x08, 4],
    ['Pal 07', 0x0c, 4],
    ['Pal 09', 0x10, 4],
    ['Pal 10', 0x14, 4],
    ['Pal 11', 0x18, 4],
    ['Pal 14', 0x1c, 4],
    ['Pal 19', 0x20, 4],
  ],
  'sms': SMS_GG_LAYOUT,
  'gg': SMS_GG_LAYOUT,
};

// Slice a converted RGBA palette into the named sub-palettes described by a
// layout, keeping only slices whose color count matches `matchlen` (the pen
// count of the image being colored, i.e. 2^bpp). Negative lengths produce a
// reversed slice; a slice one color shorter than matchlen gets the shared
// color 0 prepended (the NES backdrop convention).
export function computePaletteSlices(palette: Uint32Array, layout: PixelEditorPaletteLayout, matchlen: number, node: PixNode | null, group?: string): SelectablePalette[] {
  var result: SelectablePalette[] = [];
  if (!layout) return result;
  layout.forEach(([name, start, len]) => {
    if (start >= palette.length) return;
    if (len == matchlen) {
      result.push({ node, name, group, palette: palette.slice(start, start + len) });
    } else if (-len == matchlen) { // reverse order
      var reversed = palette.slice(start, start - len);
      reversed.reverse();
      result.push({ node, name, group, palette: reversed });
    } else if (len + 1 == matchlen) {
      var shared = new Uint32Array(matchlen);
      shared[0] = palette[0];
      shared.set(palette.slice(start, start + len), 1);
      result.push({ node, name, group, palette: shared });
    }
  });
  return result;
}

/////

function equalArrays(a: UintArray, b: UintArray): boolean {
  if (a == null || b == null)
    return false;
  if (a.length !== b.length)
    return false;
  if (a === b)
    return true;
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i])
      return false;
  }
  return true;
}
function equalNestedArrays(a: UintArray[], b: UintArray[]): boolean {
  if (a == null || b == null)
    return false;
  if (a.length !== b.length)
    return false;
  if (a === b)
    return true;
  for (var i = 0; i < a.length; i++) {
    if (!equalArrays(a[i], b[i]))
      return false;
  }
  return true;
}

export abstract class PixNode {
  left: PixNode;		// toward text editor
  right: PixNode;		// toward pixel editor

  words?: UintArray;		// file data
  images?: Uint8Array[];	// array of indexed image data
  rgbimgs?: Uint32Array[];	// array of rgba imgages
  palette?: Uint32Array; // array of rgba

  abstract updateLeft(): boolean;	// update coming from right
  abstract updateRight(): boolean;	// update coming from left

  refreshLeft() {
    var p: PixNode = this;
    while (p) {
      p.updateLeft();
      p = p.left;
    }
  }
  refreshRight() {
    var p: PixNode = this;
    while (p) {
      p.updateRight();
      p = p.right;
    }
  }
  addRight(node: PixNode) {
    this.right = node;
    node.left = this;
    return node;
  }
  addLeft(node: PixNode) {
    this.left = node;
    node.right = this;
    return node;
  }
}

abstract class CodeProjectDataNode extends PixNode {
  project: ProjectWindows;
  fileid: string;
  label: string;
  words: UintArray;
}

export class FileDataNode extends CodeProjectDataNode {

  constructor(project: ProjectWindows, fileid: string) {
    super();
    this.project = project;
    this.fileid = fileid;
    this.label = fileid;
  }
  updateLeft() {
    //if (equalArrays(this.words, this.right.words)) return false;
    this.words = this.right.words;
    if (this.project) {
      this.project.updateFile(this.fileid, this.words as Uint8Array);
    }
    return true;
  }
  updateRight() {
    if (this.project) {
      this.words = this.project.project.getFile(this.fileid) as Uint8Array;
    }
    return true;
  }
}

export class TextDataNode extends CodeProjectDataNode {
  bpw: number;
  rangeId: string;

  private static nextRangeId = 0;

  constructor(project: ProjectWindows, fileid: string, label: string, start: number, end: number, bpw?: number) {
    super();
    this.project = project;
    this.fileid = fileid;
    this.label = label;
    this.bpw = bpw || 8;
    this.rangeId = `asset_${TextDataNode.nextRangeId++}`;
    this.project.setAssetRange(this.fileid, this.rangeId, start, end);
  }

  updateLeft() {
    if (this.right.words.length != this.words.length)
      throw Error("Cannot put " + this.right.words.length + " image bytes into array of " + this.words.length + " bytes");
    this.words = this.right.words;
    var datastr = this.project.getAssetText(this.fileid, this.rangeId);
    if (datastr == null)
      throw Error("Could not find source code range for asset " + this.fileid);
    datastr = replaceHexWords(datastr, this.words, this.bpw);
    // CM6 state field automatically remaps all tracked ranges.
    this.project.replaceAssetText(this.fileid, this.rangeId, datastr);
    return true;
  }

  updateRight() {
    var datastr = this.project.getAssetText(this.fileid, this.rangeId);
    if (datastr == null)
      throw Error("Could not find source code range for asset " + this.fileid);
    datastr = convertToHexStatements(datastr);
    var words = parseHexWords(datastr);
    this.words = words;
    return true;
  }
}

export class Compressor extends PixNode {

  words: UintArray;

  updateLeft() {
    // TODO: can't modify length of rle bytes
    return false;
  }
  updateRight() {
    this.words = rle_unpack(new Uint8Array(this.left.words));
    return true;
  }

}

export class Mapper extends PixNode {

  fmt: PixelEditorImageFormat;
  words: UintArray;
  images: Uint8Array[];

  constructor(fmt) {
    super();
    this.fmt = fmt;
  }
  updateLeft() {
    //if (equalNestedArrays(this.images, this.right.images)) return false;
    this.images = this.right.images;
    this.words = convertImagesToWords(this.images, this.fmt);
    return true;
  }
  updateRight() {
    if (equalArrays(this.words, this.left.words)) return false;
    // convert each word array to images
    this.words = this.left.words;
    this.images = convertWordsToImages(this.words, this.fmt);
    return true;
  }
}

class RGBAPalette {
  palcols;
  constructor(palcols: Uint32Array) {
    this.palcols = palcols;
  }
  indexOf(rgba: number): number {
    return this.palcols.indexOf(rgba);
  }
}

export class Palettizer extends PixNode {

  images: Uint8Array[];
  rgbimgs: Uint32Array[];
  palette: Uint32Array;

  ncolors: number;
  context: EditorContext;
  paloptions: SelectablePalette[];
  palindex: number = 0;
  defpal?: string;     // fmt.defpal: predefined palette used when none is in the project
  palname?: string;    // fmt.palname: preferred palette, chosen until the user picks one
  palselected: boolean = false; // true once the user chooses from the dropdown

  // TODO: control to select palette for bitmaps

  constructor(context: EditorContext, fmt: PixelEditorImageFormat) {
    super();
    this.context = context;
    // Pac-Man strip bitmaps are always 2bpp (4 pens), even if bpp is omitted.
    if (fmt.pacstrip)
      this.ncolors = 4;
    else
      this.ncolors = 1 << ((fmt.bpp||1) * (fmt.np||1));
    this.palname = fmt.palname;
    this.defpal = fmt.defpal;
  }
  updateLeft() {
    if (this.right) { this.rgbimgs = this.right.rgbimgs; } // TODO: check is for unit test, remove?
    var pal = new RGBAPalette(this.palette);
    var newimages = this.rgbimgs.map((im: Uint32Array) => {
      var out = new Uint8Array(im.length);
      for (var i = 0; i < im.length; i++) {
        out[i] = pal.indexOf(im[i]);
      }
      return out;
    });
    // have to do it this way b/c pixel editor modifies arrays
    //if (equalNestedArrays(newimages, this.images)) return false;
    this.images = newimages;
    return true;
  }
  updateRight() {
    if (!this.updateRefs() && equalNestedArrays(this.images, this.left.images)) return false;
    this.images = this.left.images;
    var mask = this.palette.length - 1; // must be power of 2
    // for each image, map bytes to RGB colors
    this.rgbimgs = this.images.map((im: Uint8Array) => {
      var out = new Uint32Array(im.length);
      for (var i = 0; i < im.length; i++) {
        out[i] = this.palette[im[i] & mask];
      }
      return out;
    });
    return true;
  }
  updateRefs() {
    var newpalette;
    if (this.context != null) {
      this.paloptions = this.context.getPalettes(this.ncolors);
      if (this.paloptions && this.paloptions.length > 0) {
        // Pick the palette named by fmt.palname until the user chooses one.
        if (this.palname && !this.palselected) {
          var pi = this.paloptions.findIndex((p: SelectablePalette) => p.name === this.palname);
          if (pi >= 0) this.palindex = pi;
        }
        newpalette = this.paloptions[this.palindex].palette;
      }
    }
    if (newpalette == null && this.defpal && PREDEF_PALETTES[this.defpal]) {
      newpalette = convertPaletteFormat(PREDEF_PALETTES[this.defpal].map((_, i) => i), { pal: this.defpal });
    }
    if (newpalette == null) {
      if (this.ncolors <= 2)
        newpalette = new Uint32Array([0xff000000, 0xffffffff]);
      else
        newpalette = new Uint32Array([0xff000000, 0xffff00ff, 0xffffff00, 0xffffffff]); // TODO: more palettes
    }
    if (equalArrays(this.palette, newpalette)) return false;
    this.palette = newpalette;
    return true;
  }
}

function dedupPalette(cols: UintArray): Uint32Array {
  var dup = new Map();
  var res = new Uint32Array(cols.length);
  var ndups = 0;
  for (var i = 0; i < cols.length; i++) {
    var n = cols[i];
    while (dup[n]) {
      n ^= ++ndups;
    }
    res[i] = n;
    dup[n] = 1;
  }
  return res;
}

export class PaletteFormatToRGB extends PixNode {

  words: UintArray;
  rgbimgs: Uint32Array[];
  palette: Uint32Array;
  palfmt: PixelEditorPaletteFormat;
  layout: PixelEditorPaletteLayout;

  constructor(palfmt) {
    super();
    this.palfmt = palfmt;
  }
  updateLeft() {
    //TODO
    return true;
  }
  updateRight() {
    if (equalArrays(this.words, this.left.words)) return false;
    this.words = this.left.words;
    var cols = convertPaletteFormat(this.words, this.palfmt);
    // Keep exact PROM colors for Pac-Man (and any layout slices). Dedup is only
    // for flat palette grids where identical swatches need unique edit identities.
    this.palette = (this.palfmt.layout || this.palfmt.pal === 'pacman')
      ? new Uint32Array(cols) : dedupPalette(cols);
    this.layout = PREDEF_LAYOUTS[this.palfmt.layout];
    this.rgbimgs = [];
    this.palette.forEach((rgba: number) => {
      this.rgbimgs.push(new Uint32Array([rgba]));
    });
    return true;
  }
  getAllColors() {
    var arr = [];
    for (var i = 0; i < getPaletteLength(this.palfmt); i++)
      arr.push(i);
    return convertPaletteFormat(arr, this.palfmt);
  }
}

export class PaletteEditorView extends PixNode {
  updateCells: () => void;

  constructor(updateCells: () => void) {
    super();
    this.updateCells = updateCells;
  }
  updateLeft() {
    return true;
  }
  updateRight() {
    this.updateCells();
    return true;
  }
}

export abstract class Compositor extends PixNode {

  tilemap: Uint8Array[];	// tilemap images
  images: Uint8Array[];	// output (1 image)
  width: number;
  height: number;

  context: EditorContext;
  tileoptions: SelectableTilemap[];
  tileindex: number = 0;
  minTiles: number = 256;	// only tile sources with at least this many tiles are used

  constructor(context: EditorContext) {
    super();
    this.context = context;
  }
  updateRefs(): boolean {
    var oldtilemap = this.tilemap;
    if (this.context != null) {
      this.tileoptions = this.context.getTilemaps(this.minTiles);
      if (this.tileoptions && this.tileoptions.length > 0) {
        this.tilemap = this.tileoptions[this.tileindex].images;
      }
    }
    return !equalNestedArrays(oldtilemap, this.tilemap);
  }
}

export type MetaspriteEntry = {
  x: number, y: number, tile: number, attr: number
};

export class MetaspriteCompositor extends Compositor {

  metadefs: MetaspriteEntry[];

  constructor(context: EditorContext, metadefs) {
    super(context);
    this.metadefs = metadefs;
  }
  updateLeft() {
    // TODO
    return false;
  }
  updateRight() {
    this.updateRefs();
    this.width = 16; // TODO
    this.height = 16; // TODO
    var idata = new Uint8Array(this.width * this.height);
    this.images = [idata];
    this.metadefs.forEach((meta) => {
      // TODO
    });
    return true;
  }
}

// Copies a tw x th indexed tile into a larger indexed image at (x0,y0).
// Nonzero pixels get `coloradd` added (NES attribute palette select).
function blitTile(dest: Uint8Array, stride: number, x0: number, y0: number,
  tile: ArrayLike<number>, tw: number, th: number, coloradd: number = 0) {
  var j = 0;
  for (var y = 0; y < th; y++) {
    var i = (y0 + y) * stride + x0;
    for (var x = 0; x < tw; x++) {
      var color = tile[j++];
      dest[i++] = color && coloradd ? color + coloradd : color;
    }
  }
}

export class NESNametableConverter extends Compositor {

  cols: number;
  rows: number;
  baseofs: number;
  constructor(context: EditorContext) {
    super(context);
  }
  updateLeft() {
    // TODO
    return false;
  }
  updateRight() {
    if (!this.updateRefs() && equalArrays(this.words, this.left.words)) return false;
    this.words = this.left.words;
    this.cols = 32;
    this.rows = 30;
    this.width = this.cols * 8;
    this.height = this.rows * 8;
    this.baseofs = 0;
    var idata = new Uint8Array(this.width * this.height);
    this.images = [idata];
    var a = 0;
    var attraddr;
    for (var row = 0; row < this.rows; row++) {
      for (var col = 0; col < this.cols; col++) {
        var name = this.words[this.baseofs + a];
        if (typeof name === 'undefined') throw Error("No name for address " + this.baseofs + " + " + a);
        var t = this.tilemap[name];
        if (!t) throw Error("No tilemap found for tile index " + name);
        attraddr = (a & 0x2c00) | 0x3c0 | (a & 0x0C00) | ((a >> 4) & 0x38) | ((a >> 2) & 0x07);
        var attr = this.words[attraddr];
        var tag = name ^ (attr << 9) ^ 0x80000000;
        var attrshift = (col & 2) + ((a & 0x40) >> 4);
        var coloradd = ((attr >> attrshift) & 3) << 2;
        blitTile(idata, this.width, col * 8, row * 8, t, 8, 8, coloradd);
        a++;
      }
    }
    // TODO
    return true;
  }
}

// Header for a generic tile map: a w x h grid of tile indices into the project's
// 8x8 tile bitmaps. An optional parallel `attrs` array (same size, CGB-style bytes)
// holds each cell's palette number in bits 0-2 and X/Y flip in bits 5/6.
export type TilemapFormat = {
  w: number, h: number		// map size, in tiles
  attrs?: string		// name of the attribute array
};

export function validateTilemapFormat(fmt: TilemapFormat, lookup: (name: string) => number[] | null): string | null {
  if (!(fmt.w > 0 && fmt.h > 0)) return 'tilemap needs positive w and h';
  if (fmt.attrs) {
    var attrs = lookup(fmt.attrs);
    if (!attrs) return `Could not find array "${fmt.attrs}"`;
    if (attrs.length != fmt.w * fmt.h)
      return `Attribute array "${fmt.attrs}" has ${attrs.length} value(s), expected ${fmt.w * fmt.h}`;
  }
  return null;
}

// Renders a tile map to one indexed image. Tiles are 8x8 indexed images; each cell's
// palette number is added to its nonzero pixels as (palette * 4).
export function renderTilemap(fmt: TilemapFormat, map: UintArray, attrs: UintArray | null,
  tiles: ArrayLike<number>[]): { width: number, height: number, pixels: Uint8Array } {
  var width = fmt.w * 8;
  var height = fmt.h * 8;
  var pixels = new Uint8Array(width * height);
  var flipped = new Uint8Array(64);
  for (var row = 0; row < fmt.h; row++) {
    for (var col = 0; col < fmt.w; col++) {
      var i = row * fmt.w + col;
      var t = tiles[map[i]];
      if (!t) throw Error(`Tile index ${map[i]} out of range at map cell ${col},${row}`);
      var attr = attrs ? attrs[i] || 0 : 0;
      if (attr & 0x60) {
        for (var y = 0; y < 8; y++)
          for (var x = 0; x < 8; x++)
            flipped[y * 8 + x] = t[((attr & 0x40 ? 7 - y : y) << 3) + (attr & 0x20 ? 7 - x : x)];
        t = flipped;
      }
      blitTile(pixels, width, col * 8, row * 8, t, 8, 8, (attr & 7) << 2);
    }
  }
  return { width, height, pixels };
}

export class TilemapConverter extends Compositor {

  fmt: TilemapFormat;
  width: number;
  height: number;

  constructor(context: EditorContext, fmt: TilemapFormat) {
    super(context);
    this.fmt = fmt;
    this.width = fmt.w * 8;
    this.height = fmt.h * 8;
  }
  updateLeft() {
    return false; // TODO: map editing
  }
  updateRight() {
    var words = this.left.words;
    var maxtile = 0;
    for (var i = 0; i < words.length; i++) maxtile = Math.max(maxtile, words[i]);
    this.minTiles = maxtile + 1;
    this.updateRefs();
    if (!this.tilemap) throw Error(`No tile bitmaps found with at least ${this.minTiles} tiles`);
    // the attribute array is re-read each time so edits to it show up here
    var attrs = this.fmt.attrs ? this.context.getNamedArray(this.fmt.attrs) : null;
    var r = renderTilemap(this.fmt, words, attrs, this.tilemap);
    if (this.images && equalArrays(this.images[0], r.pixels)) return false;
    this.images = [r.pixels];
    return true;
  }
}

// Finds the numbers in a named C array (`name[..] = {..}`) or asm label (`name:` or
// `_name:` followed by .byte/hex lines, up to the next label) in source text.
export function findNamedArray(text: string, name: string): number[] | null {
  if (!/^\w+$/.test(name)) return null;
  var m = new RegExp('\\b' + name + '\\s*(?:\\[[^\\]]*\\]\\s*)+=\\s*\\{').exec(text);
  if (m) {
    // find the matching close brace, so 2D arrays ({{..},{..}}) work
    var depth = 1, i = m.index + m[0].length;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] == '{') depth++;
      else if (text[i] == '}') depth--;
    }
    var body = text.substring(m.index + m[0].length, i - 1).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    return parseHexWords(convertToHexStatements(body.replace(/[{}]/g, ' ')));
  }
  // Rust array: `name: [T; N] = [ ... ]` / `const name = [ ... ]` (also `&[ ... ]`)
  var rm = new RegExp('\\b' + name + '\\s*(?::\\s*[^=\\n]*)?=\\s*&?\\s*\\[').exec(text);
  if (rm) {
    var ropen = rm.index + rm[0].length - 1; // index of the array literal '['
    var rclose = findMatchingBracket(text, ropen);
    if (rclose < 0) return null;
    var rbody = text.substring(ropen + 1, rclose).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    return parseHexWords(convertToHexStatements(rbody));
  }
  var lm = new RegExp('^[ \\t]*_?' + name + ':', 'm').exec(text);
  if (lm) {
    var rest = text.substring(lm.index + lm[0].length);
    var next = /^[ \t]*(?:[A-Za-z_.][\w.]*:|\.global)/m.exec(rest);
    if (next) rest = rest.substring(0, next.index);
    return parseHexWords(convertToHexStatements(rest.replace(/;.*$/gm, '')));
  }
  return null;
}

// Header for a CharPad-style map (C64 character graphics): a w x h grid of tile
// indices; each tile is tw x th char indices; chars are 8x8 (hires) or 4x8 (multicolor).
export type CharpadFormat = {
  w: number, h: number		// map size, in tiles
  tw: number, th: number		// tile size, in chars
  chars: string			// name of the charset array (8 bytes/char)
  tiles: string			// name of the tileset array (tw*th char indices/tile)
  colors: string			// name of the colour array (one byte per tile, or per char)
  colorby?: string		// "tile" (default) or "char"
  mc?: number			// 0 = hires mode (default 1: multicolor, colour bit 3 selects)
  bg?: number, mca?: number, mcb?: number	// screen and shared multicolor 1/2 colours
};

export function charpadSourceNames(fmt: CharpadFormat): string[] {
  return [fmt.chars, fmt.tiles, fmt.colors];
}

export function validateCharpadFormat(fmt: CharpadFormat, lookup: (name: string) => number[] | null): string | null {
  if (!(fmt.w > 0 && fmt.h > 0 && fmt.tw > 0 && fmt.th > 0))
    return 'charpad map needs positive w, h, tw and th';
  for (var name of charpadSourceNames(fmt)) {
    if (!name) return 'charpad map needs "chars", "tiles" and "colors" array names';
    if (!lookup(name)) return `Could not find array "${name}"`;
  }
  return null;
}

// Renders a CharPad map to one indexed image of C64 colour numbers (0-15).
export function renderCharpadMap(fmt: CharpadFormat, map: UintArray, chars: UintArray,
  tiles: UintArray, colors: UintArray): { width: number, height: number, pixels: Uint8Array } {
  var multi = fmt.mc !== 0;
  var bg = fmt.bg || 0, mca = fmt.mca || 0, mcb = fmt.mcb || 0;
  var width = fmt.w * fmt.tw * 8;
  var height = fmt.h * fmt.th * 8;
  var pixels = new Uint8Array(width * height);
  var chartile = new Uint8Array(64);
  var tilechars = fmt.tw * fmt.th;
  for (var row = 0; row < fmt.h; row++) {
    for (var col = 0; col < fmt.w; col++) {
      var t = map[row * fmt.w + col];
      if (t === undefined || (t + 1) * tilechars > tiles.length)
        throw Error(`Tile index ${t} out of range at map cell ${col},${row}`);
      for (var k = 0; k < tilechars; k++) {
        var c = tiles[t * tilechars + k];
        if (c === undefined || (c + 1) * 8 > chars.length)
          throw Error(`Char index ${c} out of range in tile ${t}`);
        var colour = colors[fmt.colorby == 'char' ? c : t];
        if (colour === undefined) throw Error(`No colour for ${fmt.colorby == 'char' ? 'char ' + c : 'tile ' + t}`);
        var ismc = multi && (colour & 8) != 0;
        var fg = multi ? colour & 7 : colour & 15;
        for (var y = 0; y < 8; y++) {
          var b = chars[c * 8 + y];
          for (var x = 0; x < 8; x++) {
            if (ismc) {
              var v = (b >> (6 - (x & ~1))) & 3; // pixels are double wide
              chartile[y * 8 + x] = v == 0 ? bg : v == 1 ? mca : v == 2 ? mcb : fg;
            } else {
              chartile[y * 8 + x] = (b >> (7 - x)) & 1 ? fg : bg;
            }
          }
        }
        blitTile(pixels, width, (col * fmt.tw + (k % fmt.tw)) * 8, (row * fmt.th + Math.floor(k / fmt.tw)) * 8, chartile, 8, 8);
      }
    }
  }
  return { width, height, pixels };
}

export class CharpadConverter extends PixNode {

  fmt: CharpadFormat;
  context: EditorContext;
  images: Uint8Array[];
  width: number;
  height: number;

  constructor(context: EditorContext, fmt: CharpadFormat) {
    super();
    this.context = context;
    this.fmt = fmt;
    this.width = fmt.w * fmt.tw * 8;
    this.height = fmt.h * fmt.th * 8;
  }
  updateLeft() {
    return false; // TODO: map editing
  }
  updateRight() {
    var lookup = (name: string) => {
      var arr = this.context.getNamedArray && this.context.getNamedArray(name);
      if (!arr) throw Error(`Could not find array "${name}"`);
      return arr;
    };
    // charset, tileset and colours are re-read each time so edits to them show up here
    var r = renderCharpadMap(this.fmt, this.left.words, lookup(this.fmt.chars), lookup(this.fmt.tiles), lookup(this.fmt.colors));
    if (this.images && equalArrays(this.images[0], r.pixels)) return false;
    this.images = [r.pixels];
    return true;
  }
}

///// UI CONTROLS

export class ImageChooser {

  rgbimgs: Uint32Array[];
  width: number;
  height: number;
  gapX: number | null = null;
  gapBits: number = 8;
  viewers: Viewer[];

  recreate(parentdiv: JQuery, onclick) {
    var agrid = $('<div class="asset_grid"/>'); // grid (or 1) of preview images
    parentdiv.empty().append(agrid);
    this.viewers = [];
    var cscale = Math.max(2, Math.ceil(16 / this.width)); // TODO
    var imgsperline = this.width <= 8 ? 16 : 8; // TODO
    var span = null;
    this.rgbimgs.forEach((imdata, i) => {
      var viewer = new Viewer();
      viewer.width = this.width;
      viewer.height = this.height;
      viewer.gapX = this.gapX;
      viewer.gapBits = this.gapBits;
      viewer.recreate();
      viewer.canvas.style.width = (viewer.displayWidth * cscale) + 'px'; // TODO
      viewer.canvas.title = '$' + hex(i);
      viewer.updateImage(imdata);
      $(viewer.canvas).addClass('asset_cell');
      $(viewer.canvas).click((e) => {
        onclick(i, viewer);
      });
      this.viewers.push(viewer);
      if (!span) {
        span = $('<span/>');
        agrid.append(span);
      }
      span.append(viewer.canvas);
      var brk = (i % imgsperline) == imgsperline - 1;
      if (brk) {
        agrid.append($("<br/>"));
        span = null;
      }
    });
  }

  updateImages(rgbimgs: Uint32Array[]) {
    this.rgbimgs = rgbimgs;
    for (var i = 0; i < this.viewers.length; i++) {
      this.viewers[i].updateImage(rgbimgs[i]);
    }
  }
}

// A color picker for a single palette entry.
//
// Direct-color formats (pal:444, pal:332, ...) encode RGB in the word itself;
// a 444 palette has 4096 possible colors so showing a swatch for each one is
// unusable. Those get an RGB color input plus per-channel sliders. Indexed
// palettes get a scrollable swatch grid (their tables are small).
export class PaletteColorPicker {

  palfmt: PixelEditorPaletteFormat;
  rgbimgs: Uint32Array[];
  channels: DirectColorChannels | null;
  onpick: (word: number) => void;

  viewers: Viewer[] = [];
  sliders: { input: HTMLInputElement, valueLabel: JQuery, channel: string }[] = [];
  previewEl: JQuery;
  colorInput: HTMLInputElement;
  hexEl: JQuery;
  currentWord: number = 0;

  constructor(palfmt: PixelEditorPaletteFormat, rgbimgs: Uint32Array[], onpick: (word: number) => void) {
    this.palfmt = palfmt;
    this.rgbimgs = rgbimgs;
    this.channels = getDirectColorChannels(palfmt);
    this.onpick = onpick;
  }

  recreate(parentdiv: JQuery, currentWord: number) {
    parentdiv.empty();
    this.viewers = [];
    this.sliders = [];
    this.previewEl = null;
    this.colorInput = null;
    this.hexEl = null;
    if (this.channels)
      this.createSliders(parentdiv);
    else
      this.createGrid(parentdiv);
    this.setCurrent(currentWord);
  }

  private paletteColor(word: number): number {
    var cols = convertPaletteFormat([word], this.palfmt);
    return (cols && cols[0]) || 0xff000000;
  }

  private updateColorWidgets(word: number) {
    var rgb = this.paletteColor(word);
    var hexcol = '#' + hex(rgb2bgr(rgb & 0xffffff), 6);
    if (this.previewEl) this.previewEl.css('background-color', hexcol);
    if (this.colorInput && this.colorInput.value !== hexcol) this.colorInput.value = hexcol;
    if (this.hexEl) this.hexEl.text(hexcol + '  $' + hex(word, 4));
  }

  setCurrent(word: number) {
    this.currentWord = word;
    if (this.channels) {
      var c = decodeDirectColorWord(this.palfmt, word);
      if (c) {
        for (var s of this.sliders) {
          var v = s.channel === 'r' ? c.r : s.channel === 'g' ? c.g : c.b;
          s.input.value = String(v);
          s.valueLabel.text(String(v));
        }
      }
      this.updateColorWidgets(word);
    } else {
      this.viewers.forEach((v, i) => $(v.canvas).toggleClass('selected', i === word));
    }
  }

  private channelBits(name: string): number {
    var c = this.channels;
    if (!c) return 0;
    return name === 'r' ? c.r : name === 'g' ? c.g : c.b;
  }

  private pickFromSliders() {
    var vals: { [k: string]: number } = { r: 0, g: 0, b: 0 };
    for (var s of this.sliders) vals[s.channel] = Number(s.input.value);
    var word = encodeDirectColorWord(this.palfmt, vals['r'], vals['g'], vals['b']);
    this.setCurrent(word);
    this.onpick(word);
  }

  private createSliders(parentdiv: JQuery) {
    var c = this.channels;
    var box = newDiv(parentdiv, 'asset_colorpicker');
    this.previewEl = newDiv(box, 'asset_colorpicker_preview');
    // native <input type=color> only addresses 8 bits/channel
    if (c.r <= 8 && c.g <= 8 && c.b <= 8) {
      this.colorInput = document.createElement('input');
      this.colorInput.type = 'color';
      this.colorInput.className = 'asset_colorpicker_colorinput';
      box.append(this.colorInput);
    }
    this.hexEl = newDiv(box, 'asset_colorpicker_hex');
    var controls = newDiv(box, 'asset_colorpicker_controls');
    for (var name of ['r', 'g', 'b']) {
      var bits = this.channelBits(name);
      if (bits <= 0) continue;
      var row = newDiv(controls, 'asset_colorpicker_row');
      $('<label/>').text(name.toUpperCase()).appendTo(row);
      var input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = String((1 << bits) - 1);
      input.step = '1';
      input.className = 'asset_colorpicker_slider';
      row.append(input);
      var valueLabel = $('<span class="asset_colorpicker_value"/>').appendTo(row);
      input.value = '0';
      this.sliders.push({ input, valueLabel, channel: name });
      $(input).on('input', () => this.pickFromSliders());
    }
    if (this.colorInput) $(this.colorInput).on('input', () => {
      // native color input is 8 bits/channel; quantize to the palette's depth
      var v = this.colorInput.value;
      var r = parseInt(v.substring(1, 3), 16);
      var g = parseInt(v.substring(3, 5), 16);
      var b = parseInt(v.substring(5, 7), 16);
      var word = encodeDirectColorWord(this.palfmt,
        r >> (8 - c.r), g >> (8 - c.g), b >> (8 - c.b));
      this.setCurrent(word);
      this.onpick(word);
    });
  }

  private createGrid(parentdiv: JQuery) {
    var scroll = newDiv(parentdiv, 'asset_colorpicker_grid');
    var agrid = newDiv(scroll, 'asset_grid');
    var imgsperline = 16;
    var span = null;
    this.rgbimgs.forEach((imdata, i) => {
      var viewer = new Viewer();
      viewer.width = 1;
      viewer.height = 1;
      viewer.recreate();
      viewer.canvas.style.width = '16px';
      viewer.canvas.style.height = '16px';
      viewer.updateImage(imdata);
      $(viewer.canvas).addClass('asset_cell');
      $(viewer.canvas).attr('title', '$' + hex(i) + '  #' + hex(rgb2bgr(imdata[0] & 0xffffff), 6));
      $(viewer.canvas).click(() => {
        this.setCurrent(i);
        this.onpick(i);
      });
      this.viewers.push(viewer);
      if (!span) {
        span = $('<span/>');
        agrid.append(span);
      }
      span.append(viewer.canvas);
      if ((i % imgsperline) === imgsperline - 1) {
        agrid.append($('<br/>'));
        span = null;
      }
    });
  }
}

function newDiv(parent?, cls?: string) {
  var div = $(document.createElement("div"));
  if (parent) div.appendTo(parent)
  if (cls) div.addClass(cls);
  return div;
}

export class CharmapEditor extends PixNode {

  context;
  parentdiv;
  fmt;
  chooser;
  editor: PixEditor;

  constructor(context: EditorContext, parentdiv: JQuery, fmt: PixelEditorImageFormat) {
    super();
    this.context = context;
    this.parentdiv = parentdiv;
    this.fmt = fmt;
  }

  updateLeft() {
    return true;
  }

  updateRight() {
    if (equalNestedArrays(this.rgbimgs, this.left.rgbimgs)) return false;
    this.rgbimgs = this.left.rgbimgs;
    // if chooser already exists with same number of images, update in place
    if (this.chooser && this.chooser.viewers && this.chooser.viewers.length == this.rgbimgs.length) {
      this.updateArtInfo();
      this.chooser.updateImages(this.rgbimgs);
      // keep rgbimgs pointing to viewer buffers so edits propagate back via refreshLeft
      for (var i = 0; i < this.chooser.viewers.length; i++) {
        this.rgbimgs[i] = this.chooser.viewers[i].rgbdata;
      }
      // the palette (e.g. changed via the selector) also drives the editor's
      // selectable color buttons, so update them to match
      if (this.editor)
        this.editor.setPalette(this.left.palette);
      return true;
    }
    var adual = newDiv(this.parentdiv.empty(), "asset_dual"); // contains grid and editor
    var agrid = newDiv(adual);
    var aeditor = newDiv(adual, "asset_editor").hide(); // contains editor, when selected
    // add image chooser grid
    var chooser = this.chooser = new ImageChooser();
    chooser.rgbimgs = this.rgbimgs;
    chooser.width = this.fmt.w || 1;
    chooser.height = this.fmt.h || 1;
    var artBit = getArtBit(this.fmt);
    if (artBit != null) {
      chooser.gapX = artBit;
      chooser.gapBits = this.fmt.bpw || 8;
    }
    chooser.recreate(agrid, (index, viewer) => {
      // TODO: variable scale?
      const aspect = this.fmt.aspect || 1.0;
      const yscale = Math.min(MAX_SCALE,
        MAX_SIZE_X / (viewer.displayWidth * aspect),
        MAX_SIZE_Y / this.fmt.h);
      const xscale = yscale * aspect;
      this.createEditor(aeditor, viewer, xscale, yscale);
      this.context.setCurrentEditor(aeditor, $(viewer.canvas), this);
      this.rgbimgs[index] = viewer.rgbdata;
    });
    this.updateArtInfo();
    if (this.fmt.art) {
      for (var i = 0; i < this.chooser.viewers.length; i++) {
        this.chooser.viewers[i].updateImage();
      }
    }
    // add palette selector
    // TODO: only view when editing?
    var palizer = this.left;
    if (palizer instanceof Palettizer && palizer.paloptions.length > 1) {
      var palselect = $(document.createElement('select'));
      palizer.paloptions.forEach((palopt, i) => {
        // TODO: full identifier
        var sel = $(document.createElement('option')).text(palopt.name).val(i).appendTo(palselect);
        if (i == (palizer as Palettizer).palindex)
          sel.attr('selected', 'selected');
      });
      palselect.appendTo(agrid).change((e) => {
        var index = ($(e.target).val() as any) as number;
        (palizer as Palettizer).palindex = index;
        (palizer as Palettizer).palselected = true;
        palizer.refreshRight();
      });
    }
    return true;
  }

  updateArtInfo() {
    if (!this.fmt.art || !this.chooser || !this.chooser.viewers) return;
    var indexedImages = this.left.images;
    if (!indexedImages) return;
    for (var i = 0; i < this.chooser.viewers.length; i++) {
      this.chooser.viewers[i].artInfo = { indexedImage: indexedImages[i] };
    }
  }

  createEditor(aeditor: JQuery, viewer: Viewer, xscale: number, yscale: number): PixEditor {
    var im = new PixEditor();
    im.createWith(viewer);
    im.updateImage();
    var w = im.displayWidth * xscale;
    var h = viewer.height * yscale;
    im.canvas.style.width = w + 'px'; // TODO
    im.canvas.style.height = h + 'px'; // TODO
    im.makeEditable(this, aeditor, this.left.palette);
    this.editor = im;
    return im;
  }
}

export class MapEditor extends PixNode {

  context;
  parentdiv;
  fmt;

  constructor(context: EditorContext, parentdiv: JQuery, fmt: PixelEditorImageFormat) {
    super();
    this.context = context;
    this.parentdiv = parentdiv;
    this.fmt = fmt;
  }

  updateLeft() {
    return true;
  }

  updateRight() {
    if (equalNestedArrays(this.rgbimgs, this.left.rgbimgs)) return false;
    this.rgbimgs = this.left.rgbimgs;
    var adual = newDiv(this.parentdiv.empty(), "asset_dual"); // contains grid and editor
    var agrid = newDiv(adual);
    var aeditor = newDiv(adual, "asset_editor").hide(); // contains editor, when selected
    // add image chooser grid
    var viewer = new Viewer();
    viewer.width = this.fmt.w;
    viewer.height = this.fmt.h;
    viewer.recreate();
    viewer.updateImage(this.rgbimgs[0]);
    agrid.append(viewer.canvas);
    return true;
  }
}

export class Viewer {

  width: number;
  height: number;
  gapX: number | null = null;   // leftmost artifact column in each word
  gapBits: number = 8;          // bits per word; artifact columns repeat every gapBits
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  imagedata: ImageData;
  rgbdata: Uint32Array;
  displayImageData: ImageData;
  displayRgbData: Uint32Array;
  peerviewers: Viewer[];
  artInfo: { indexedImage: Uint8Array } | null = null;

  get artColumnCount(): number {
    return this.gapX == null ? 0 : countArtColumns(this.width, this.gapX, this.gapBits);
  }

  get displayWidth(): number {
    return this.width;
  }

  isArtColumn(x: number): boolean {
    return this.gapX != null && isArtColumn(x, this.width, this.gapX, this.gapBits);
  }

  recreate() {
    this.canvas = this.newCanvas();
    this.imagedata = this.ctx.createImageData(this.width, this.height);
    this.rgbdata = new Uint32Array(this.imagedata.data.buffer);
    if (this.gapX != null) {
      this.displayImageData = this.ctx.createImageData(this.displayWidth, this.height);
      this.displayRgbData = new Uint32Array(this.displayImageData.data.buffer);
    }
    this.peerviewers = [this];
  }

  createWith(pv: Viewer) {
    this.width = pv.width;
    this.height = pv.height;
    this.gapX = pv.gapX;
    this.gapBits = pv.gapBits;
    this.imagedata = pv.imagedata;
    this.rgbdata = pv.rgbdata;
    this.canvas = this.newCanvas();
    if (this.gapX != null) {
      this.displayImageData = this.ctx.createImageData(this.displayWidth, this.height);
      this.displayRgbData = new Uint32Array(this.displayImageData.data.buffer);
    }
    pv.peerviewers.push(this);
    this.peerviewers = pv.peerviewers;
    this.artInfo = pv.artInfo;
  }

  newCanvas(): HTMLCanvasElement {
    var c = document.createElement('canvas');
    c.width = this.displayWidth;
    c.height = this.height;
    //if (fmt.xform) c.style.transform = fmt.xform;
    c.classList.add("pixels");
    c.classList.add("pixelated");
    this.ctx = c.getContext('2d');
    return c;
  }

  updateImage(imdata?: Uint32Array) {
    if (imdata) {
      this.rgbdata.set(imdata);
    }
    for (let v of this.peerviewers) {
      if (v.gapX != null && v.displayRgbData) {
        // Same layout as rgbdata. The artifact bit is drawn as a 2-color pixel
        // (so its 0/1 state is visible) but half-transparent, so a solid grey
        // palette entry doesn't hide what's behind it. Only this display copy
        // is faded; rgbdata keeps the real palette color (toggle reads it back).
        for (var i = 0; i < this.rgbdata.length; i++) {
          var px = this.rgbdata[i];
          v.displayRgbData[i] = v.isArtColumn(i % this.width) ? ((px & 0x00ffffff) | 0x80000000) >>> 0 : px;
        }
        v.ctx.putImageData(v.displayImageData, 0, 0);
      } else {
        v.ctx.putImageData(this.imagedata, 0, 0);
      }
    }
  }
}

// copied image data, shared between all pixel editors in the session
export interface PixelClipboardData {
  width: number
  height: number
  pixels: Uint32Array	// RGBA pixels, art-bit columns removed
  palette: Uint32Array	// palette the pixels were copied from
}

var pixelClipboard: PixelClipboardData | null = null;

export function getPixelClipboard(): PixelClipboardData | null {
  return pixelClipboard;
}

export function setPixelClipboard(clip: PixelClipboardData | null) {
  pixelClipboard = clip;
}

// Paste clipboard pixels over the top-left of the destination image, clipped to
// whichever is smaller. Colors are matched by palette index, not by RGB value,
// so a tile copied under one palette keeps its shape under another.
export function pasteClipboardPixels(clip: PixelClipboardData,
  dstpixels: Uint32Array, dstwidth: number, dstheight: number, dstpalette: Uint32Array): Uint32Array {
  var remap = new Map<number, number>();
  for (var i = 0; i < clip.palette.length; i++) {
    if (!remap.has(clip.palette[i]))
      remap.set(clip.palette[i], dstpalette[i & (dstpalette.length - 1)]);
  }
  var result = dstpixels.slice();
  var w = Math.min(clip.width, dstwidth);
  var h = Math.min(clip.height, dstheight);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var rgba = clip.pixels[y * clip.width + x];
      var mapped = remap.get(rgba);
      result[y * dstwidth + x] = mapped !== undefined ? mapped : rgba;
    }
  }
  return result;
}

class PixEditor extends Viewer {

  left: PixNode;
  palette: Uint32Array;
  curpalcol: number = -1;
  currgba: number;
  palbtns: JQuery[];
  palbtnspan: JQuery;
  aeditor: JQuery;
  offscreen: Map<string, number> = new Map();

  getPositionFromEvent(e): { x: number, y: number } {
    var dw = this.displayWidth;
    var x = Math.floor(e.offsetX * dw / $(this.canvas).width());
    var y = Math.floor(e.offsetY * this.height / $(this.canvas).height());
    return { x: x, y: y };
  }

  setPaletteColor(col: number) {
    col &= this.palette.length - 1;
    if (this.curpalcol != col) {
      if (this.curpalcol >= 0)
        this.palbtns[this.curpalcol].removeClass('selected');
      this.curpalcol = col;
      this.currgba = this.palette[col & this.palette.length - 1];
      this.palbtns[col].addClass('selected');
    }
  }

  makeEditable(leftnode: PixNode, aeditor: JQuery, palette: Uint32Array) {
    this.left = leftnode;
    this.palette = palette;

    var dragcol;
    var dragging = false;

    var pxls = $(this.canvas);
    var artDragIdx = -1;
    pxls.mousedown((e) => {
      var pos = this.getPositionFromEvent(e);
      if (this.isArtPixel(pos.x)) {
        artDragIdx = this.toggleArtPixel(pos.x, pos.y);
        dragging = true;
        $(document).mouseup((e) => {
          $(document).off('mouseup');
          dragging = false;
          artDragIdx = -1;
          this.commit();
        });
        return;
      }
      dragcol = this.getPixel(pos.x, pos.y) == this.currgba ? this.palette[0] : this.currgba;
      this.setPixel(pos.x, pos.y, this.currgba);
      dragging = true;
      $(document).mouseup((e) => {
        $(document).off('mouseup');
        var pos = this.getPositionFromEvent(e);
        this.setPixel(pos.x, pos.y, dragcol);
        dragging = false;
        this.commit();
      });
    })
      .mousemove((e) => {
        var pos = this.getPositionFromEvent(e);
        if (!dragging) return;
        if (artDragIdx >= 0 && this.isArtPixel(pos.x)) {
          this.setArtPixel(pos.x, pos.y, artDragIdx);
        } else if (artDragIdx < 0 && !this.isArtPixel(pos.x)) {
          this.setPixel(pos.x, pos.y, dragcol);
        }
      });

    aeditor.empty();
    this.aeditor = aeditor;
    this.createToolbarButtons(aeditor[0]);
    aeditor.append(this.canvas);
    aeditor.append(this.createPaletteButtons());
    this.setPaletteColor(1);
  }

  // Update the palette used for the selectable color buttons (e.g. after the
  // palette selector dropdown changes). Rebuilds the buttons and keeps the
  // current selection valid for the new palette size.
  setPalette(palette: Uint32Array) {
    if (this.palette === palette) return;
    this.palette = palette;
    this.curpalcol = -1;
    if (this.aeditor) {
      this.palbtnspan.remove();
      this.aeditor.append(this.createPaletteButtons());
    }
    this.setPaletteColor(1);
  }

  isArtPixel(x: number): boolean {
    return this.isArtColumn(Math.round(x));
  }

  toggleArtPixel(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return -1;
    var ofs = y * this.width + x;
    // read the state from what is on screen: the indexed image can be stale
    var newIdx = this.rgbdata[ofs] == this.palette[0] ? 1 : 0;
    this.setArtPixel(x, y, newIdx);
    return newIdx;
  }

  setArtPixel(x: number, y: number, idx: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    var ofs = y * this.width + x;
    this.rgbdata[ofs] = this.palette[idx];
    // keep the indexed image (which writes the words back) in step
    var indexed = this.artInfo && this.artInfo.indexedImage;
    if (indexed && ofs < indexed.length) indexed[ofs] = idx;
    this.updateImage();
  }

  getPixel(x: number, y: number): number {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return this.offscreen[x + ',' + y] | this.palette[0];
    } else {
      var ofs = x + y * this.width;
      return this.rgbdata[ofs];
    }
  }

  setPixel(x: number, y: number, rgba: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      this.offscreen[x + ',' + y] = rgba;
    } else {
      var ofs = x + y * this.width;
      var oldrgba = this.rgbdata[ofs];
      if (oldrgba != rgba) {
        this.rgbdata[ofs] = rgba;
        this.updateImage();
      }
    }
  }

  createPaletteButtons() {
    this.palbtns = [];
    var span = this.palbtnspan = newDiv(null, "asset_toolbar");
    for (var i = 0; i < this.palette.length; i++) {
      var btn = $(document.createElement('button')).addClass('palbtn');
      var rgb = this.palette[i] & 0xffffff;
      var color = "#" + hex(rgb2bgr(rgb), 6);
      btn.click(this.setPaletteColor.bind(this, i));
      btn.css('backgroundColor', color).text(i.toString(16));
      btn.css('color', (rgb & 0x008000) ? 'black' : 'white');
      span.append(btn);
      this.palbtns.push(btn);
    }
    return span;
  }

  createToolbarButtons(parent: HTMLElement) {
    var toolbar = new Toolbar(parent, parent); // scope key bindings to the pixel editor
    toolbar.add('ctrl+shift+h', 'Flip X', 'glyphicon-resize-horizontal', this.flipX.bind(this));
    toolbar.add('ctrl+shift+v', 'Flip Y', 'glyphicon-resize-vertical', this.flipY.bind(this));
    toolbar.add('ctrl+shift+9', 'Rotate', 'glyphicon-repeat', this.rotate90.bind(this));
    toolbar.add('ctrl+shift+left', 'Move Left', 'glyphicon-arrow-left', this.translate.bind(this, 1, 0));
    toolbar.add('ctrl+shift+right', 'Move Right', 'glyphicon-arrow-right', this.translate.bind(this, -1, 0));
    toolbar.add('ctrl+shift+up', 'Move Up', 'glyphicon-arrow-up', this.translate.bind(this, 0, 1));
    toolbar.add('ctrl+shift+down', 'Move Down', 'glyphicon-arrow-down', this.translate.bind(this, 0, -1));
    toolbar.newGroup();
    toolbar.add(null, 'Copy Image', 'glyphicon-copy', this.copyImage.bind(this));
    toolbar.add(null, 'Paste Image', 'glyphicon-paste', this.pasteImage.bind(this));
    // TODO: destroy toolbar?
  }

  // returns the image with art-bit columns removed, like remapPixels() operates on
  getStrippedPixels(): { pixels: Uint32Array, width: number } {
    if (this.gapX == null) {
      return { pixels: this.rgbdata.slice(), width: this.width };
    }
    var strippedWidth = this.width - this.artColumnCount;
    var stripped = new Uint32Array(strippedWidth * this.height);
    this.copyNonArtPixels(stripped, strippedWidth, this.rgbdata, this.width);
    return { pixels: stripped, width: strippedWidth };
  }

  copyImage() {
    var { pixels, width } = this.getStrippedPixels();
    setPixelClipboard({
      width: width,
      height: this.height,
      pixels: pixels,
      palette: this.palette.slice()
    });
  }

  pasteImage() {
    var clip = getPixelClipboard();
    if (!clip) return;
    var { pixels, width } = this.getStrippedPixels();
    var pasted = pasteClipboardPixels(clip, pixels, width, this.height, this.palette);
    this.remapPixels((x, y) => pasted[y * width + x]);
  }

  commit() {
    this.updateImage();
    try {
      this.left.refreshLeft();
    } catch (e) {
      console.log(e);
      alert(`Could not update source code. ${e}`);
    }
  }

  copyNonArtPixels(dst: Uint32Array, dstWidth: number, src: Uint32Array, srcWidth: number) {
    for (var y = 0; y < this.height; y++) {
      var si = 0, di = 0;
      for (var x = 0; x < this.width; x++) {
        var isArt = this.isArtPixel(x);
        if (!isArt)
          dst[y * dstWidth + di] = src[y * srcWidth + si];
        if (!isArt || srcWidth === this.width) si++;
        if (!isArt || dstWidth === this.width) di++;
      }
    }
  }

  remapPixels(mapfn: (x: number, y: number) => number) {
    // Strip art bit columns so transforms ignore them.
    var savedRgb = this.rgbdata;
    var savedWidth = this.width;
    if (this.gapX != null) {
      var strippedWidth = this.width - this.artColumnCount;
      var stripped = new Uint32Array(strippedWidth * this.height);
      this.copyNonArtPixels(stripped, strippedWidth, this.rgbdata, this.width);
      this.rgbdata = stripped;
      this.width = strippedWidth;
    }
    // Apply the transform.
    var i = 0;
    var pixels = new Uint32Array(this.rgbdata.length);
    for (var y = 0; y < this.height; y++) {
      for (var x = 0; x < this.width; x++) {
        pixels[i++] = mapfn(x, y);
      }
    }
    // Restore art bit columns from the original data.
    this.rgbdata = savedRgb;
    this.width = savedWidth;
    if (this.gapX != null) {
      this.copyNonArtPixels(this.rgbdata, this.width, pixels, strippedWidth);
    } else {
      this.rgbdata.set(pixels);
    }
    this.commit();
  }

  rotate(deg: number) {
    var s1 = Math.sin(deg * Math.PI / 180);
    var c1 = Math.cos(deg * Math.PI / 180);
    this.remapPixels((x, y) => {
      var xx = x + 0.5 - this.width / 2.0;
      var yy = y + 0.5 - this.height / 2.0;
      var xx2 = xx * c1 - yy * s1 + this.width / 2.0 - 0.5;
      var yy2 = yy * c1 + xx * s1 + this.height / 2.0 - 0.5;
      return this.getPixel(xx2, yy2);
    });
  }
  rotate90() {
    this.rotate(90);
  }
  flipX() {
    this.remapPixels((x, y) => {
      return this.getPixel(this.width - 1 - x, y);
    });
  }
  flipY() {
    this.remapPixels((x, y) => {
      return this.getPixel(x, this.height - 1 - y);
    });
  }
  translate(dx: number, dy: number) {
    this.remapPixels((x, y) => {
      return this.getPixel(x + dx, y + dy);
    });
  }

}

// TODO: not yet used

abstract class TwoWayPixelConverter {

  w: number;
  h: number;
  words: Uint8Array;
  bitoffsets: Uint32Array;
  coloffsets: Uint32Array;

  constructor(width: number, height: number, bpp: number, colpp: number) {
    this.w = width;
    this.h = height;
    this.words = new Uint8Array(width * height);
    this.bitoffsets = new Uint32Array(width * height);
    this.coloffsets = new Uint32Array(width * height);
  }

  setPixel(x: number, y: number, col: number, bitofs: number, colofs: number) {
    var ofs = x + y * this.w;
    this.words[ofs] = col;
    this.bitoffsets[ofs] = bitofs;
    this.coloffsets[ofs] = colofs;
  }

  abstract wordsToImage(words: UintArray): Uint8Array[];

  abstract imageToWords(image: Uint8Array): UintArray;
}

export class TwoWayMapper extends PixNode {

  pc: TwoWayPixelConverter;

  constructor(pc: TwoWayPixelConverter) {
    super();
    this.pc = pc;
  }
  updateLeft() {
    //if (equalNestedArrays(this.images, this.right.images)) return false;
    this.images = this.right.images;
    this.words = this.pc.imageToWords(this.images[0]);
    return true;
  }
  updateRight() {
    if (equalArrays(this.words, this.left.words)) return false;
    // convert each word array to images
    this.words = this.left.words;
    this.images = this.pc.wordsToImage(this.words);
    return true;
  }
}

