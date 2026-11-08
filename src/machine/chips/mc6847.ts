// Motorola MC6847 Video Display Generator (VDG), as wired in the CoCo 1/2.
//
// The VDG does no addressing of its own: the SAM (MC6883) steps through
// memory and hands it one byte at a time, so this class only turns the bytes
// of one scanline into pixels. The caller supplies the address of the row, the
// line within the row and the number of bytes the SAM fetches per row.
//
// Mode pins come from PIA1 port B ($FF22):
//   bit 7 A/G    0 = alphanumeric / semigraphics, 1 = graphics
//   bit 6 GM2 \
//   bit 5 GM1  > graphics mode (0 CG1, 1 RG1, 2 CG2, 3 RG2, 4 CG3, 5 RG3, 6 CG6, 7 RG6)
//   bit 4 GM0 /
//   bit 3 CSS    color set select
// "CG" modes have 4 colors (2 bits per pixel), "RG" modes are 1 bit per pixel.
// In alphanumeric mode the screen byte is:
//   bit 7 = 1: semigraphics 4 (bits 6-4 color, bits 3-0 the 2x2 blocks)
//   bit 7 = 0: bit 6 = INV, bits 5-0 index the 64-glyph character set

import { MC6847_FONT } from "./mc6847font";

export const VDG_WIDTH = 256;
export const VDG_HEIGHT = 192;

function rgb(r: number, g: number, b: number): number {
  return 0xff000000 | (b << 16) | (g << 8) | r;
}

// Color indices 0-7 are what the hardware produces (CSS = 0: 0-3, CSS = 1: 4-7).
export const VDG_PALETTE = new Uint32Array([
  rgb(0x20, 0xd8, 0x20), // 0 green
  rgb(0xe8, 0xe8, 0x30), // 1 yellow
  rgb(0x30, 0x30, 0xd8), // 2 blue
  rgb(0xd8, 0x30, 0x30), // 3 red
  rgb(0xe8, 0xe8, 0xd0), // 4 buff
  rgb(0x30, 0xd8, 0xd8), // 5 cyan
  rgb(0xd8, 0x30, 0xd8), // 6 magenta
  rgb(0xe8, 0x90, 0x20), // 7 orange
  rgb(0x00, 0x00, 0x00), // 8 black
  rgb(0x00, 0x38, 0x00), // 9 dark green (alphanumeric background)
  rgb(0x40, 0x18, 0x00), // 10 dark orange
]);
const BLACK = 8, DARK_GREEN = 9, DARK_ORANGE = 10;

export class MC6847 {
  /**
   * Draw one scanline of the display.
   * @param out       frame buffer (ABGR, 256 pixels per line)
   * @param ofs       index of the first pixel of this line in `out`
   * @param ram       memory the SAM fetches from
   * @param rowAddr   address of the first byte of the current row
   * @param lineInRow scanline within the current row (0 = first)
   * @param bytes     bytes per row (16 or 32), from the SAM mode
   * @param pins      PIA1 port B: A/G, GM2-0, CSS
   */
  drawLine(out: Uint32Array, ofs: number, ram: Uint8Array,
           rowAddr: number, lineInRow: number, bytes: number, pins: number) {
    const css = (pins & 0x08) != 0;
    if (!(pins & 0x80)) {
      this.drawAlpha(out, ofs, ram, rowAddr, lineInRow, css);
    } else {
      this.drawGraphics(out, ofs, ram, rowAddr, bytes, (pins >> 4) & 7, css);
    }
  }

  private drawAlpha(out: Uint32Array, ofs: number, ram: Uint8Array,
                    rowAddr: number, lineInRow: number, css: boolean) {
    // characters are 8x12 cells; our 8x8 glyphs sit 2 lines down
    const glyphRow = lineInRow - 2;
    const lit = css ? 7 : 0;
    const dark = css ? DARK_ORANGE : DARK_GREEN;
    for (let i = 0; i < 32; i++) {
      const b = ram[(rowAddr + i) & 0xffff];
      let x = ofs + i * 8;
      if (b & 0x80) {
        // semigraphics 4: each of the four quadrants is 4x6 pixels
        const color = (b >> 4) & 7;
        const mask = lineInRow < 6 ? (b >> 2) & 3 : b & 3;
        const left = (mask & 2) ? color : BLACK;
        const right = (mask & 1) ? color : BLACK;
        for (let k = 0; k < 4; k++) {
          out[x + k] = VDG_PALETTE[left];
          out[x + 4 + k] = VDG_PALETTE[right];
        }
      } else {
        const bits = glyphRow >= 0 && glyphRow < 8 ? MC6847_FONT[(b & 0x3f) * 8 + glyphRow] : 0;
        // INV set = dark glyph on a lit background (the usual CoCo look)
        const fg = VDG_PALETTE[(b & 0x40) ? dark : lit];
        const bg = VDG_PALETTE[(b & 0x40) ? lit : dark];
        for (let k = 0; k < 8; k++) {
          out[x + k] = (bits & (0x80 >> k)) ? fg : bg;
        }
      }
    }
  }

  private drawGraphics(out: Uint32Array, ofs: number, ram: Uint8Array,
                       rowAddr: number, bytes: number, gm: number, css: boolean) {
    const cell = VDG_WIDTH / bytes; // screen pixels per byte
    const base = css ? 4 : 0;
    let x = ofs;
    if (gm & 1) {
      // RG modes: 1 bit per pixel, off = black, on = green or buff
      const on = VDG_PALETTE[base];
      const off = VDG_PALETTE[BLACK];
      const w = cell >> 3;
      for (let i = 0; i < bytes; i++) {
        const b = ram[(rowAddr + i) & 0xffff];
        for (let k = 0; k < 8; k++) {
          const c = (b & (0x80 >> k)) ? on : off;
          for (let j = 0; j < w; j++) out[x++] = c;
        }
      }
    } else {
      // CG modes: 2 bits per pixel, 4 colors
      const w = cell >> 2;
      for (let i = 0; i < bytes; i++) {
        const b = ram[(rowAddr + i) & 0xffff];
        for (let k = 0; k < 4; k++) {
          const c = VDG_PALETTE[base + ((b >> (6 - k * 2)) & 3)];
          for (let j = 0; j < w; j++) out[x++] = c;
        }
      }
    }
  }
}
