// Joystick and sound on the Color Computer.
//
// Move the mouse over the screen to move the right joystick; click to fire.
// The CoCo's joysticks are analog: the hardware has one comparator and a
// 6-bit DAC, and the ROM finds each axis (0-63) by trying DAC values until
// the comparator flips. The same DAC makes the sound, so reading the
// joystick makes a little noise on a real machine too.

#include <cmoc.h>
#include <coco.h>

#define SCREEN ((byte *) 0x0400)
#define BLACK_BLOCK 0x80
#define GREEN_BLOCK 0x8f

int main() {
  word pos = 0x20, oldpos = 0x20;
  byte fired = 0;

  cls(0);                       // black screen
  printf("MOVE THE MOUSE, CLICK TO BEEP");

  for (;;) {
    const byte *pot = readJoystickPositions();  // right X, right Y, left X, left Y
    byte x = pot[0];
    byte y = pot[1];
    byte row = 1 + (y >> 2);    // 15 rows below the title
    if (row > 15) row = 15;
    pos = ((word) row << 5) + (x >> 1);   // 32 columns

    SCREEN[oldpos] = BLACK_BLOCK;
    SCREEN[pos] = GREEN_BLOCK;
    oldpos = pos;

    // the fire button; the tone follows the joystick's X position
    if (readJoystickButtons() & JOYSTK_BUTTON_1_RIGHT) {
      if (!fired) sound(40 + (x << 1), 4);
      fired = 1;
    } else {
      fired = 0;
    }
  }
  return 0;
}
