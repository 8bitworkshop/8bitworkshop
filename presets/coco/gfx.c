// Graphics modes on the Color Computer.
//
// The picture comes from two chips working together. The SAM (6883) steps
// through memory and decides how many bytes make a row and how often a row
// repeats; the VDG (6847) turns those bytes into pixels. Both are set by
// poking addresses:
//   SAM  $FFC0-$FFDF  an even address clears a bit, the next odd one sets it
//   VDG  $FF22        PIA1 port B: bit 7 = graphics, bits 6-4 = mode,
//                     bit 3 = color set
//
// Press a key to switch from 256x192 two-color to 128x192 four-color.
// (A 0.9 MHz 6809 is slow, so we fill whole bytes instead of plotting pixels.)

#include <cmoc.h>
#include <coco.h>

#define VIDEO ((byte *) 0x0600)  // 6K of video RAM, below the program
#define PIA1_B (* (byte *) 0xff22)

// Set the SAM's 3-bit video mode V (6 = one scanline per row, 32 bytes a row).
void setSAMMode(byte v) {
  byte i;
  for (i = 0; i < 3; i++)
    * (byte *) (0xffc0 + i * 2 + ((v >> i) & 1)) = 0;
}

// Set the SAM's display address, in 512-byte units (7 bits).
void setSAMBase(word addr) {
  byte i;
  for (i = 0; i < 7; i++)
    * (byte *) (0xffc6 + i * 2 + ((addr >> (9 + i)) & 1)) = 0;
}

void clearVideo(void) {
  byte *p = VIDEO;
  word n = 6144;
  while (n--) *p++ = 0;
}

int main() {
  byte *p;
  byte y, b;

  // --- RG6: 256x192, one bit per pixel, green on black.
  // A box around the screen: whole bytes along the top and bottom,
  // the outermost pixel of the first and last byte on each row.
  clearVideo();
  setSAMMode(6);
  setSAMBase(0x0600);
  PIA1_B = 0xf0;
  p = VIDEO;
  for (b = 0; b < 32; b++) {
    p[b] = 0xff;
    p[191 * 32 + b] = 0xff;
  }
  for (y = 0; y < 192; y++) {
    p[0] |= 0x80;
    p[31] |= 0x01;
    p += 32;
  }
  while (!inkey()) ;

  // --- CG6: 128x192, two bits per pixel, four colors.
  // A byte holds 4 pixels, so 0x55 * color fills a byte with one color.
  clearVideo();
  PIA1_B = 0xe0;
  p = VIDEO;
  for (y = 0; y < 192; y++) {
    for (b = 0; b < 32; b++)
      *p++ = (byte) (0x55 * (((b >> 2) + (y >> 4)) & 3));
  }
  for (;;) ;
  return 0;
}
