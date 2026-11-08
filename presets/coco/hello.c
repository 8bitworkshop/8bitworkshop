// Hello World for the Tandy Color Computer 1/2.
// Compiled with CMOC; the standard library prints through the
// BASIC ROM's CHROUT routine to the 32x16 text screen.

#include <cmoc.h>
#include <coco.h>

int main() {
  cls(1);
  printf("HELLO, COLOR COMPUTER!\n\n");
  printf("32 COLUMNS, 16 ROWS, 9 COLORS.\n");
  for (;;) {
    // echo typed characters
    byte k = inkey();
    if (k) putchar(k);
  }
  return 0;
}
