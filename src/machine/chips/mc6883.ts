// Motorola MC6883 Synchronous Address Multiplexer (SAM).
//
// Its 16 control bits are set and cleared by *writing* to address pairs in
// $FFC0-$FFDF (even address clears the bit, odd address sets it, the data is
// ignored). The registers are write-only, so we keep the bits here.
//
//   bit  addresses  name  meaning
//   0-2  C0-C5      V     display mode (selects how the video address counter steps)
//   3-9  C6-D3      F     video display offset, in units of 512 bytes
//   10   D4/D5      P1    page select (upper/lower 32K), CoCo 1/2 64K only
//   11-12 D6-D9     R     CPU clock rate (R1 = 1: double speed)
//   13-14 DA-DD     M     memory size
//   15   DE/DF      TY    map type (1 = all RAM, 0 = ROM in the upper 32K)

export const SAM_BASE = 0xffc0;
export const SAM_END = 0xffdf;

// DMA mode table, indexed by V: [bytes per row, scanlines per row].
// Text is 12 scanlines per character row; graphics rows are repeated so that
// the frame always covers 192 scanlines.
const SAM_MODES: [number, number][] = [
  [32, 12], // 0: alphanumeric, semigraphics
  [16, 3],  // 1: CG1 (64x64 x4) or RG1 (128x64 x2)
  [32, 3],  // 2: CG2 (128x64 x4)
  [16, 2],  // 3: RG2 (128x96 x2)
  [32, 2],  // 4: CG3 (128x96 x4)
  [16, 1],  // 5: RG3 (128x192 x2)
  [32, 1],  // 6: CG6 (128x192 x4) or RG6 (256x192 x2)
  [32, 1],  // 7: DMA (direct memory access); not emulated, treat like 6
];

export class MC6883 {
  bits = 0;

  reset() { this.bits = 0; }

  /** Handle an access to $FFC0-$FFDF. */
  access(addr: number) {
    const off = addr - SAM_BASE;
    const bit = off >> 1;
    if (off & 1) this.bits |= 1 << bit;
    else this.bits &= ~(1 << bit);
  }

  get v(): number { return this.bits & 7; }
  get f(): number { return (this.bits >> 3) & 0x7f; }
  /** Address of the top-left of the display. */
  get displayBase(): number { return this.f << 9; }
  get page1(): boolean { return !!(this.bits & 0x400); }
  get fast(): boolean { return !!(this.bits & 0x1000); }
  get memSize(): number { return (this.bits >> 13) & 3; }
  /** True when the whole 64K is RAM (no ROM visible at $8000-$FEFF). */
  get allRAM(): boolean { return !!(this.bits & 0x8000); }

  get bytesPerRow(): number { return SAM_MODES[this.v][0]; }
  get linesPerRow(): number { return SAM_MODES[this.v][1]; }
}
