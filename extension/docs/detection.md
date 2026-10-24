# Platform detection

8bitworkshop can tell the platform of existing code from clues in it, and
it always shows you the clue it used.

## When it runs

- **Set as Main File**, or **Build** or **Run** on a file with no
  project. You asked, so a clear answer applies at once: "Using NES
  (game.c:3 includes "neslib.h"). [Change]". If the answer isn't clear,
  a list shows the likely platforms first, each with its clue.
- **Opening a folder** that has no 8bitworkshop settings. A notification
  appears only when the clues are strong and point at one platform:
  "This looks like an NES project (...). [Use It] [Choose...] [Not Now]
  [Don't Ask]". Nothing changes until you choose **Use It**, which
  opens the main file, builds it, and offers **Run**. A large
  folder with projects scattered through it, such as a big codebase
  with a few examples inside, brings up no notification.
- **Opening a source file** in a folder with no project. If its folder
  has strong clues, you get the same notification. After **Not Now**,
  8bitworkshop doesn't ask again until you reopen the window. Weaker
  clues show only in the status bar, such as **NES?**; click it to
  choose a platform.
- **8bitworkshop: Detect Projects** scans the folder again, even after
  **Don't Ask**. It also lists folders with weaker clues as potential
  projects, unchecked.

If a folder holds several projects, such as `nes/` and `c64/`
subfolders or a folder of cloned repos, the notification says how many
it found. A project's own subfolders count as part of it. Click **Review**
and check the ones to use; each gets its own entry in
`8bitworkshop.folders`.

## The clues

Strongest first:

| Clue | Example |
|---|---|
| The 8bitworkshop link in `README.md` | `8bitworkshop.com/...?platform=vcs&file=game.dasm` |
| A ROM file | `game.nes`, `game.a26`, `game.gb` |
| A platform's header or include file | `#include "neslib.h"`, `include "nesdefs.dasm"` |
| An `rs8::` module in a Rust program | `use rs8::nes::*;` (urust) |
| Hardware registers | `WSYNC`, `COLUBK` (VCS); `PPUCTRL` (NES); `$D020` (C64) |
| A cc65 target in a Makefile, or a cc65 linker config | `cl65 -t c64`, `nes.cfg` |
| A file extension few platforms use | `.cc2600`, `.bb` |
| A folder named after a platform | `nes/`, `c64/` |

Plain C or assembly with none of these never brings up a notification,
so other projects you open aren't interrupted. Neither do ROM files,
linker configs, headers, or folder names alone: a notification needs a
clue in a program's own source. A C program needs a `main()`, and
startup code such as `crt0.s` is never the main file.

Hardware registers and function names in a header only declare a
library, so a folder of nothing but headers and library sources isn't
offered as a project. When a folder holds several programs, its review
entry shows the count (**Game Boy · 26 programs**). Accepting it makes
the folder a directory of small programs, so **Run** builds whichever
program is open.

Some platforms share everything detection can see. For example, the
ColecoVision, MSX and Sega platforms all use `cv.h`. Then the list shows
them all and you choose.

## Assembler syntax

A file extension can mean different assemblers: `.asm` builds with DASM
on the 6502 platforms. When you set a main file that's written for
another assembler, 8bitworkshop says so:

> This looks like ca65 code; .asm builds with dasm. [Use ca65] [Keep dasm]

Choosing **Use ca65** saves `8bitworkshop.tool` for the project. When
you accept a project found on opening a folder, the right tool is saved
without asking.

## Fix a wrong guess

Click the status bar, then choose one of these:

- **Change Platform...** to pick another platform.
- **Detect Again** to look at the clues again.
- **Remove Project...** to clear its settings, so it isn't a project at
  all. See [Remove a project](projects.md#remove-a-project).

## From the command line

`8bws detect` prints the same guesses and clues:

```bash
8bws detect game.c
8bws detect path/to/folder
```

`8bws build` and `8bws run` use detection when you leave out
`--platform`. Give them a source file, or a folder: for a folder they
build the main file detection picks. If no platform clearly wins, or no
main file stands out, they list the candidates and ask for `--platform`
or a source file.

```bash
8bws build --check path/to/folder
8bws run path/to/folder --frames 60
```
