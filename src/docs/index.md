# 8bitworkshop IDE

The 8bitworkshop IDE is a browser-based development environment for
micro computers and consoles.
The IDE compiles or assembles your source code
while you type, then the emulator runs your code.
This all happens locally in your web browser.

## Choosing a platform

First, choose a hardware platform using the green **Platform Selector**
to the right of the main menu.
This reloads the IDE with the appropriate emulator and toolchain.

Each platform has several example programs that you can view and edit.
Use the **Project Selector** drop-down (next to the menu icon) to choose one.
On large screens the **filter button** beside it opens a menu that narrows
the list to one example category, or to **Local Files** or **Repositories**
if there are any; **All** shows everything. While a filter is active, the
top of the project list says **Filtering by ...**.

## Editing files

Edits are persisted in browser local storage and survive closing the
tab. To restore an example to its original state, choose
**File &raquo; Revert to Original&hellip;**. To start from scratch, choose
**New Project&hellip;** and enter a filename (typically `.c` for C, or
`.asm` for assembly).

Each platform has its own virtual file system in the browser, so edits and
new files are only visible to the current platform.

See [Managing Files](managing-files.md) for how to 
export and import files, share playable links and videos, sync projects to GitHub, and pull projects from GitHub.

## Emulators

Every platform includes a built-in emulator that runs your code on
simulated hardware. Click the emulator screen to give it keyboard focus.
The IDE shows the key bindings used by the current platform; some
platforms also support gamepads. Platforms that make sound show a
**Mute** button on the toolbar. Clicking the emulator screen also unlocks
audio for the browser, unless you explicitly muted it.

## Compilers

C compilers and assemblers for most platforms run in the browser. Each
time you change the code it is recompiled automatically. Errors appear
in a list in the upper-right corner of the page; click the link beside
an error to jump to the offending source line.

If the build succeeds, the emulator restarts with the new ROM image, so
you see changes near-instantly.

See [Build Directives](build-directives.md) for information on
multi-file projects, compiler/linker directives, and file extensions.

See [Toolchains & Platforms](toolchains.md) for the full list of tools and
the complete platform × extension → tool reference.

CC65 was updated in 8bitworkshop 4.0 -- for more information see
[cc65 Toolchain Upgrade](cc65-upgrade.md).

## Debugger

The IDE includes a debugger for stepping through machine code, viewing
memory, and starting/stopping the program. The buttons at the top of the
screen perform these functions:

- **Reset:** hard-reset the emulator, then single-step to the first
  instruction.
- **Pause:** stop the emulator.
- **Run:** resume the emulator after pausing.
- **Single Step:** execute the next CPU instruction.
- **Step Over:** execute until the next source line, or step over a subroutine, then break.
- **Next Frame/Interrupt:** run until the next video frame starts, then
  break.
- **Run To Line:** set a breakpoint on the current source line (or click
  the gutter to the left of a line). The emulator stops when execution
  reaches that instruction.
- **Step Out of Subroutine:** run until the current subroutine returns,
  then break.
- **Step Backwards:** step back a single CPU instruction.

Some platforms also offer:

- **Analyze Timing:** perform a *flow analysis* of your code and compute
  timing values for each instruction.
- **Highlight Executed Lines:** highlight lines of source code as they are executed by the emulator.
- **Start Recording:** enable the replay feature, which lets you rewind
  the emulator and scroll to arbitrary frames and CPU cycles.

When the IDE hits a breakpoint or a single-step, a debug window appears
in the lower-right showing the CPU state. Click the links at the bottom
of the window for more detail. See [Breakpoints](breakpoints.md).

## Sidebar windows

The sidebar to the left of the editor lists every source file in your
project — the main file (shown in the pulldown), any included or linked
files, and any generated listings. Depending on the platform, additional
tools appear:

| Window | Description |
| --- | --- |
| [Editor](editor.md) | Edit source files; read-only listings, headers, and binary views |
| [Disassembly](disasm.md) | Disassemble the program around the program counter |
| [Memory Browser](memory.md) | Hex dump of CPU memory |
| [Memory Map](memmap.md) | Map of memory areas, linker segments and large variables |
| [VRAM Browser](vram.md) | Hex dump of video memory (systems with a separate VDP) |
| [Memory Probe](memprobe.md) | Heat map of memory read/write activity |
| [CRT Probe](crtprobe.md) | Memory activity laid out by raster position |
| [Probe Log](probelog.md) | Textual log of CPU/memory activity |
| [Scanline I/O](scanlineio.md) | I/O and VRAM access per scanline |
| [Symbol Profiler](symbols.md) | Read/write counts per symbol |
| [Call Graph](callgraph.md) | Call tree with clocks per routine, reconstructed from the stack |
| [Debug Tree](debugtree.md) | Hierarchical view of platform debug info |
| [Breakpoints](breakpoints.md) | Add and edit breakpoints |
| [Asset Editor](asseteditor.md) | Edit bitmaps, tilemaps, and palettes embedded in source |

## Keyboard Shortcuts

`mod` below is **Ctrl** on Windows/Linux and **Cmd** on macOS.

| Shortcut | Action |
| --- | --- |
| `F1` | Help for the active view |
| `F8` | Pause / resume |
| `mod+Shift+F` | Search symbols, files, and docs |
| `mod+Shift+G` | Go To Address |
| `mod+Shift+R` | Reset and run |
| `mod+Shift+D` | Reset and break |
| `mod+Shift+L` | Single step |
| `mod+Shift+K` | Step over |
| `mod+Shift+I` | Step out of subroutine |
| `mod+Shift+J` | Step backwards |
| `mod+Shift+X` | Next frame/interrupt |
| `mod+Shift+A` | Restart at cursor |
| `mod+Shift+Y` | Run to line |

The context-sensitive shortcuts are also shown as clickable chips in the
status bar at the bottom of the window (toggle it under
**Settings &raquo; Show keyboard shortcuts / status bar**).

See [Editor](editor.md) for editor-specific shortcuts.
