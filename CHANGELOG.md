# Changelog

## [Unreleased]

### Visual Studio Code extension (preview)

See [extension/CHANGELOG.md](extension/CHANGELOG.md).

### Builds and tools

- Git hooks in `.githooks/` run the type check before a commit (`npm run tslint`) and the test suite before a push (`npm test`). They print one line while working and only show output on failure, which aborts the commit/push. `make prepare`/`npm run hooks` installs them by pointing `core.hooksPath` at `.githooks`; bypass with `--no-verify`, `SKIP_PRECOMMIT=1`, or `SKIP_PREPUSH=1`. Tag-only and branch-deletion pushes don't run the tests.

- **CVBasic** builds BASIC programs for the Colecovision, MSX, SG-1000/SMS and NES. The WASI compiler turns `.bas` into gasm80 assembler, which the newly vendored gasm80 (also WASI) assembles into a cartridge ROM. Compiler and assembler diagnostics point at BASIC lines, and the gasm80 listing gives the debugger source line/address information. Colecovision, MSX, NES and SG-1000/SMS now send `.bas` to it, with presets, skeletons and a `cvbasic-fs.zip` package of its prologue/epilogue files.
- The worker's CommonJS require shim kept the exports of a module it loaded in the shim module's own `exports` binding. In a mocha parallel worker that had loaded the unbundled Node modules first, the bundle reused that shim; loading one module then made `require('path')` throw, so the `inform6` test failed. The shim now keeps those exports on the worker global.
- CI builds again: the `chips` submodule was registered with the relative URL `./chips`, which git resolves against the superproject's remote (`github.com/8bitworkshop/8bitworkshop/chips`, a 404), so every `git submodule update` failed while cloning it. It now points at `https://github.com/8bitworkshop/chips`, and a unit test rejects relative submodule URLs.
- The WASM builds of the compilers no longer take the host down with them. Their Emscripten runtime aborts the process on an unhandled rejection and rethrows uncaught exceptions, which node turns into exit code 7 with no message. The `8bws` CLI and the VS Code extension ignore those handlers now, so a stray error is reported instead of killing the process.
- Rust programs build with urust on every platform it supports. The ZX Spectrum now maps to urust's `zx-spectrum` target instead of an unknown `zx`, and `rs8::apple2`, `rs8::vic20` and `rs8::zx` link to their module sources like the other register modules. Platform detection recognizes an `rs8::` module in a `.rs` file, so an existing urust program opens without `--platform`.

### Debugging

- urust programs show their source variables while debugging. The compiler's `--debug-out` JSON already gives each variable's home and the `[from, to)` code range it is live over; the Debug Tree now has a **Locals** node with the values at the current PC (only the live definition is shown, and variables the optimizer kept no storage for say `<optimized out>`). Selecting a variable in the editor shows the same value, and `8bws run ... -e "tree Locals"` prints it from the CLI. The build's debug info now reaches the VS Code debugger too, so its Machine scope has the same node.

### Emulators

- A urust program that panics reaches its `__trap_spin` stub and runs forever, which looks like a working program. The emulator now notices ten frames on that symbol, reads the trapping `jsr`/`call` site from the stack, stops with `Program trapped at $xxxx`, and points the editor's PC arrow at that source line. This covers the 6502/Z80 machine platforms (devel, NES, C64, VIC-20, ZX, ...) and the CLI.
- **VIC-20**: a PRG is now loaded after the KERNAL has booted instead of before, so the cold start can't clobber it. The start address comes from the `SYS` in the BASIC stub (for `$1001`, `$0401` and `$1201` loads) or else the load address. A ROM set with no BASIC, such as the urust KERNAL, gets the program called directly through the IRQ vector instead of by typing `SYS`, and a program that returns lands back in the KERNAL's idle loop.
- **C64, VIC-20, CPC and ZX Spectrum**: the chip emulation picked up the upstream `chips` fixes for 6502 NMI handling (NMI hijacking, pin-pipeline width) and for the 6526 CIA (counter latch written in the reload cycle, port B reads, timer B interrupt flags, and ICR bit 7 no longer being the same signal as the /IRQ line). Together these clear the Wolfgang Lorenz `nmi` and `cia1/2ta`, `cia1/2tb`, `cia1/2pb6/7` tests. A C64 program that reads joystick 2 from `$dc00` without clearing DDRA first now sees the joystick instead of the port register. Also: AY-3-8910 envelope shape 15, the 8255 port output mask (CPC), the Sinclair joysticks' fire button (was wired to right), a missing CPU reset when loading a CPC `.sna`, and an over-eager `upd765` assert that fired in the CRTC demo.
- **C64**: holding RIGHT+UP from the keyboard no longer makes a program that reads joystick port 1 move left. The new port model lets a grounded joystick-2 line pull a CIA1 PA output low; the IDE also presses the cursor keys for the arrow keys, and those sit on the scan line the joystick could ground, so their column read as joystick-1 LEFT. The keyboard scan now takes its lines from the CIA output latch, not the external pin level, so joystick 2 stays out of the keyboard matrix. Reading joystick 2 directly from `$dc00` still works.

- **VIC-20**: the Debug Info panel shows the machine's chips like the C64's does: a VIA pane with both 6522s (ports, timers, interrupt flags) and a VIC pane with the VIC-I raster position, screen and character memory addresses, colors and register dump. The ZP/Stack pane read from the wrong offset of the machine state and showed unrelated bytes; it now shows the zero page and stack.
- **C64, VIC-20 and the other WASM machines**: a BIOS loaded after the machine started (a project's `<platform>.rom`, or `8bws run --bios`) was ignored, because the machine had already copied its ROMs. Loading one now rebuilds and resets the machine.
- **VIC-20**: the text window is drawn correctly now. The VIC-I emulated the VIC-II's display window registers, so the 22 column window was placed at a garbage offset: the first character column was clipped in half and the screen was shifted 24 pixels to the right. The VIC-I window is fixed at 22x23 characters and centered in the picture; its vertical position still comes from the ROM (the "upper border" register), so NTSC and PAL ROMs both work.

### Editor and UI

- A first visit to the IDE now opens a random game from the books (`BOOK_DEMOS` in `src/common/books.ts`) instead of Hello World: VCS bricks, the Galaxian Solarian game, the Verilog racing game, the NES climber or the C-64 side-scroller. The chosen `?platform=`/`?file=` go into the address bar as usual, and a URL that names its own platform/file/repo keeps the old behavior.
- The About menu shows the IDE's own version (taken from `package.json` at build time), so a bug report or screenshot names the build it came from.
- The IDE now works in Firefox: a synchronous XHR with a `responseType` hangs in Firefox when the response is 1MB or more, so the build worker hung forever on platforms with a big toolchain package (Game Boy, Atari 8-bit, Apple II, ...). The worker now fetches those packages as ArrayBuffers. A worker that dies no longer leaves the IDE spinning: the error is shown and the build stops.
- Firefox no longer serves a stale build worker or toolchain package after an update: its hard reload (cmd+shift+r) doesn't revalidate requests made from a worker. The IDE now puts a build id in the worker URL, and the worker passes it on to every package and library it fetches.

## [4.0.0] - 2026-10-21

### Visual Studio Code extension (preview)

See [extension/CHANGELOG.md](extension/CHANGELOG.md).

### Debugging

- Step Over for C and assembly sources, a Breakpoints pane, and more breakpoint conditions.
- Call Stack view renamed Call Graph, with clocks and more detail per line.
- cc65/ca65 `.lst` listings map the PC to the correct listing line again; a `.s`/`.ca65` editor still follows its own source lines. Stepping into a library routine that has no listing now falls back to the Disassembler instead of staying on the caller's line.
- Reset clears the call graph; breakpoints are re-armed after a build.
- Click the hex offset in the gutter to run to that line.
- Probe Log no longer shows a blank line for every clock tick with no event; only recorded events get a line, so instructions and their bus accesses stay together.
- Compiler warnings no longer fail a build or get lost. cc65/ca65/ld65 and SDCC warnings show as yellow gutter markers and yellow squiggles on the source line in the IDE (not in the error dialog), as warnings in the VS Code Problems panel, and on stderr from `8bws` (`--no-warnings` hides them).
- Emulators now run on a timeline (CLI and extension only for now): step back, seek, reverse run, `rbreak`, and deterministic replay with a replay-verification test that found determinism bugs in several platforms.

### `8bws` CLI

- New `8bws` command-line tool (`npm run cli`) to build and run programs headlessly: `build`, `run`, `verify-replay`, `profile`, `detect`, `list-platforms`, `list-tools`; scripted emulator control; `--png`, `--json`, `--symbols`, `--memdump`, `--info`; platform and main file detected from a project directory.
- `8bws` is packaged for npm as `@8bws/8bws` (`npm run npm-package` in `extension/`). It downloads toolchain packs on first use, from the version's GitHub Release first; pushing a `cli-v<version>` tag publishes it; its version follows the extension's (`.github/workflows/release-cli.yml`).
- `THIRD-PARTY-NOTICES.md` has a Sources section: each toolchain's upstream repository and pinned revision, with versions from `TOOL_META` and a GPLv3 source offer. Regenerate with `npm run notices` (pins are checked in at `scripts/tool-sources.json`); the GitHub Release publishes the notices alongside the packs.
- `8bws presets [platform]` lists the examples and `8bws new <platform>/<preset> [dir]` copies one, with the files only it uses, into a directory to start from (`--libs` adds the shared libraries, `--force` overwrites). The npm package ships `presets.json` for them.
- `8bws run --frames-dir <dir>` records an animation for ffmpeg, writing every frame as `DIR/frame_NNNNN.png` (the run script adds `capture N DIR` and `png FILE`); `--fps` sets the nominal frame rate and the result includes the matching `ffmpeg` command.
- `8bws run` script `paddle X Y [BUTTONS]` moves the paddle on platforms and Verilog designs that have one.
- `8bws run` script `vcd FILE [MAXMB]` / `vcd off` records a Verilog design's signal changes to a VCD file as it runs, streamed so the recording's length isn't limited by memory (a `.gz` name compresses it; about 3 MB per frame of a design with video, 4x less gzipped), stopping at 1 GB unless told otherwise.
- Vector platforms (`vector-*`, `vectrex`) render headlessly: a software rasterizer with phosphor fade draws their lines into the frame buffer, so `--png` and the VS Code emulator panel show them. The size is `--vector-size <px>` (long side, default 512), `EmuCore.vectorSize`, or the extension's `8bitworkshop.vectorSize`.
- `buildpresets` lists compiler warnings per preset, flags a rising warning count against `--baseline`, and fails builds with warnings unless `--no-strict` is given.
- `compatcheck` builds the examples of an older release (3.12.1) with the toolchain we ship now, so a compiler that stops accepting old code shows up before it ships. It checks the release out in a temporary worktree, and `--baseline` fails when an example that used to build stops building; the release script runs it.
- The `8bws` bundle can be published to npm (`npm run npm-package` in `extension/` stages it). It unpacks only the toolchain packs a command needs, into the user's cache directory (`EIGHTBITWORKSHOP_TOOLCHAINS` overrides it, `EIGHTBITWORKSHOP_ASSETS` names a pack mirror).

### Editor and UI

- Editor moved from CodeMirror 5 to CodeMirror 6 with Lezer grammars for 6502, Z80, 6809, Verilog, BASIC, batari BASIC, FastBasic, Inform 6 and Wiz; new Cobalt and MBO themes and better indent handling.
- Rust syntax highlighting for `.rs` files, via `@codemirror/lang-rust`; the urust toolchain now claims the `rust` editor style instead of falling back to C.
- A `mod foo;` line shows one include-link arrow instead of two (it had linked to both `foo.rs` and `foo/mod.rs`); the arrow now points at whichever file exists.
- Rust `use rs8::nes::…` (and the other register modules) opens the module source: urust embeds them in its `.wasm`, so they ship again as `urust-fs.zip` for the editor to read.
- The Asset Editor understands Rust arrays: a `/*{…}*/` or `//{…}` header in a `.rs` file describes the `[u8; N] = [ … ]` literal that follows (the closing `]` ends the block, so the `;` in the type annotation is no longer mistaken for the end). Rust arrays are also found by name for tilemap/charpad lookups.
- Source search across the project and toolchain headers (F1 for help), with arrow-key navigation, plus symbol search without source.
- Shortcut bar and keyboard shortcut help, F8 pause/resume, Cmd+Shift+G go to offset.
- Settings menu with developer options (highlight whitespace, highlight executed lines, line numbers off by default).
- Hash routing for windows, and per-page titles.
- Mobile layout: tab bar instead of split panes, and a flex toolbar.
- Click `#include`/`#link` decorations to open the file; offer to import a GitHub repo given by `repo=` ("user/repo" or a tree URL).
- Tool info dialog and generated toolchain docs; Help window with ID docs.
- File | New only lists extensions that have skeleton files.
- "Share Playable Link" packs the game into the URL fragment instead of the query string, so it no longer hits the web server's ~8 KB request-line limit, and encodes it as URL-safe Base64 to avoid percent-encoding. Old `?r=` links still play.
- Removed the Markdown/Showdown platform, the old `script` platform, Google Analytics, Sentry (replaced with a new error-reporting endpoint) and the HTTPS redirect.
- "Highlight Executed Lines" draws a hot/cold heat map: lines run since the last update are colored by how often they have run (blue = cold, red = hot) and disappear once they stop executing.
- Audio reliably unlocks under the browser autoplay policy: the emulator resumes its `AudioContext` on the first click/keypress anywhere on the page, not only when the emulator canvas gets focus. A hint under the emulator screen says so until it is unlocked.
- Memory Map: a Modules column shows each object file's slice of every SDCC or cc65 segment (`Segment.modules`; SDCC from the `.rel` sizes in link order, with the remainder as `(libraries)`; cc65 from the ld65 map's module list, library members by name).
- Memory Browser: a symbol label covers only its reported size, and an unsized symbol stops at its segment boundary instead of running into the next segment.

### Website

- Links that open the IDE now point at `https://8bitworkshop.com/latest/`, which the server proxies to the newest build: the badge in a published project's README, the README the VS Code extension writes for a new project, the platform links on the website, and the embedding docs. Old `redir.html` links still work.

### Asset editor

- Undo/redo for edits, including binary files, and reliable undo for palette changes.
- Clickable decorations with start/end line numbers, header and error display, and `#asseteditor/file/line` links.
- CharPad (C64) tile maps: a `/*{map:"charpad",w:16,h:16,tw:4,th:4,chars:"charset_data",tiles:"chartileset_data",colors:"chartileset_colour_data",bg:11,mca:0,mcb:1}*/` header on the map array renders the whole level (map → tiles → chars, multicolor or hires, per-tile or per-char colour) as a read-only preview, with the source arrays found by name in C or asm. `presets/c64/level2-data.c` is annotated. Header keys may now contain digits.
- Generic tile maps: a `/*{map:"tilemap",w:156,h:66,attrs:"name"}*/` header renders a grid of tile indices with the project's 8x8 tiles as a read-only preview, with optional CGB-style palette/flip attributes. `presets/gb/large_map.c` now has Game Boy Color palettes and its `bigmap.h` is annotated. Named-array lookup handles 2D arrays.
- NES nametables and CharPad maps share one tile-blit helper and one `addTilemapEditor` pipeline.
- Canvas up to 800x1000, interleaved pixel data, Apple II artifact colors, SMS/GG palette layouts, a large color picker, cut/paste, and `#embed` support.

### Platforms

- **Game Boy**: native emulator with GBC double speed, RTC and banking; C via a partial gbdk-2020 header set; presets ported from GBDK, plus Chase and Paku Paku; ghosting on the LCD.
- **Atari 8-bit**: `.atr` disk images, 5th player, ANTIC and POKEY fixes, a8lib common library, scrolling and libdemo examples, oscar64 support. The XEX loader now calls each INIT vector before loading the next chunk (cc65's system-check chunk overlaps the main program), fixing a crash on startup of `tgidemo.c`.
- **Atari 2600**: a Javatari-derived `vcs.jt4` machine that also runs headlessly; updated `vcs.h`/`macro.h`.
- **Apple II**: paddle/joystick and SW0-2 support, dynamic origin, DOS 3.3 and AppleSingle samples. New self-contained hi-res TGI driver (`a2hires.s`, 280x192, 8 colors, no ROM calls) used by the TGI demos.
- **NES**: updated jsnes and a fix for a write bug.
- **SMS/Game Gear/ColecoVision**: shared code, SMS Solarian port, more presets.
- **Arcade**: Pac-Man hardware, Williams, Galaxian and Astrocade accuracy updates; early Exidy, MCR and Channel F work.
- PC Engine Chase example; BASIC uppercase-only dialect fixes; 6502 KIL instructions halt the emulator.
- C64: openroms-compatible cc65 `_cgetc`/`PLOT` overrides.
- Verilog: fixed a non-convergence bug on settle and a shift-state bug on digit keys.
- Astrocade fixes. Astrocade arcade (`astrocade-arcade`) closer to running Gorf.
- Vertical-monitor games can turn the screen with `?options=rotate%3D-90`.

### Build tools

- Many toolchains are now WASI builds: cc65 (pinned to 2021 6ac4aa4), DASM 2.20.17, acme, zmac, yasm and merlin32.
- Tool metadata centralized in `src/common/toolmeta.ts`; `npm run toolversions` checks tool versions.
- New build directives replace the legacy CFGFILE-style ones; build parameters no longer leak between builds. See *Build Directives* in help.
- Warnings no longer fail the build; only errors are reported.
- cc65 toolchain updated to cc65 `d8a486a` (V2.19-3867, 2026-09-26). Presets adjusted for the newer cc65.
- SDCC: both 3.6.5 and 4.x are bundled; 3.6.5 is the (much faster) default and `//#tooldef c sdcc=4` opts in to 4.x. Examples for C64 and Apple II. See *SDCC versions* in the build directives docs.
- `//#tooldef ld code_start=ADDR` and `data_start=ADDR` move SDCC's code and RAM data.
- mcpp now also searches the project root for quoted includes, so a header in a subfolder can include `"gb/gb.h"` and other staged platform headers.
- Build is now only `esbuild` through `scripts/build.mjs`; code split into a headless `src/common/projectcore.ts` / `toolselect.ts`.
- `.xa` assembler and the Dialog interactive-fiction compiler added.
- New `buildpresets` script that builds and runs every preset.
- `npm run release -- patch` bumps the app version, moves the changelog's unreleased notes under the new version, commits, and tags `v<version>`; add `--push` to push the tag.
- The web site is deployed to GitHub Pages from the `release` branch instead of `master`, so a release can be staged and published separately from ongoing work.

## 3.12.1 (2025-11-06)

- Verilog: FemtoRV32 RISC-V module and assembler fixes.
- VCS: `atari2600-ecs.cfg` and better ECS section alignment; cc2600 added; cc7800 build updated.
- Apple II: fixed the 0-9 keys.
- Removed Sentry; updated esbuild and TypeScript 5.9.2; builds on Node 20.x.

## 3.12.0 (2024-11-13)

- New ARM32 platform with arm-tcc, libc, an ELF/DWARF parser and FPU instructions.
- oscar64 compiler support (C64).
- `#embed` directive for sdcc and cmoc.
- Experimental Exidy platform; Astrocade arcade emulation work; Galaxian and Williams preset updates.
- Verilog example categories; sdcc link errors no longer vanish when there are compile errors.
- Debug info panel gets a close button; NES MMC3 RAM/SRAM areas swapped (issue #186); Apple II LC `$C08x` read fix.
- Clarified the multi-license, and more C64 presets and a book link.

## 3.11.0 (2023-11-06)

- New PC Engine platform (32 KB carts, Wiz hello world).
- VCS: preliminary cc65 support, TigerVision (3E/3F) mapper config, a vcslib demo.
- Atari 7800: missing graphics modes, color kill, Kangaroo mode, PIA timer, 7800.h, and a Debug Tree for display lists.
- Atari 8-bit: Debug Tree display list view.
- C64: `.tap` export, Wiz support, updated music player and SID macros, LZ4 example; `incbin` for C files.
- ca65: `.proc` symbols and listing parsing fixes.
- Game controller D-pad switches and 2-button mapping; multiple controllers no longer interfere.
- Removed the `script` platform and Google Analytics.

## 3.10.1 (2023-05-11)

- 6502 opcode stats corrected against TomHarte's ProcessorTests.
- Atari 5200 menu item and presets; Atari 8-bit paddle inputs and music preset.
- Fixed GitHub repository deletion; fixed C64 and vector-ataricolor presets.

## 3.10.0 (2022-10-04)

- New Atari 8-bit emulator, written in TypeScript and cycle-accurate. It replaces the MAME-based one, runs most cartridge games, and loads some well-behaved XEX files.
- New CRT Probe colors: interrupt routines purple, DMA black, normal CPU activity grey with subtle tints for reads, writes and stack changes. Click the CRT Probe or Memory Probe to set a breakpoint.
- New Sega Game Gear platform; the example code is shared with Master System.
- Download Debug Symbols for NES, in Mesen format (contributed by NotExactlySiev).
- Commodore 64: bug fixes, emulator improvements, many more examples (you may need to revert existing files).
- Apple ][ improvements (contributions from micahcowan).
- Single-stepping now switches between windows when appropriate.
- New Help menu with tool- and platform-specific documentation, replacing the "?" button.
- Better parsing of ca65 listing files, so line numbers are more accurate.
- Fixed bugs with GitHub repositories and the browser back button.
- Fixed keyboard issues on some computer platforms.
- Fixed minor bugs in the 6502 and Z80 emulators.
- Updated several compiler tools.

## 3.9.1 (2022-09-13)

Tagged the same day as 3.9.0; no separate notes.

## 3.9.0 (tagged 2022-09-13; announced 2021-12-21)

- The build now uses a JavaScript bundler (esbuild), improving modularity and startup time.
- New Amstrad CPC platform (CPC6128, 128K) with the cpctelera library for C.
- Stella (Stellerator) Atari 2600 emulator added to the MAME/Other menu: native TypeScript, CRT simulation, high accuracy, no IDE debugging.

## 3.8.0 (2021-07-22)

- New Verilog backend that translates modules to WebAssembly, based on Verilator 4: 20-50% faster, 64-bit support, better test compliance.
- Verilog: Scope View swipe support and ergonomic improvements, inline assembler fixes, module state shown in the Debug Tree.
- Updated the C64 and ZX emulators.
- Fixed include/import issues in Silice and Wiz.
- CC65 optimization flags can be overridden with `#define CC65_FLAGS <comma-separated args>`.

## 3.7.2.1 (2021-05-21)

- Upgraded Sentry.

## 3.7.2 (2021-05-19)

- VCS/DASM: better ca65 support (DASM is still preferred for VCS); better macro parsing (macros can be stepped through) and error messages.
- Improved cycle analysis tool: counts up to 76*4 scanlines and inspects JSR subroutines.
- The KIL ($02) instruction breaks into the debugger, usable for assertions.
- Verilog: 32-bit RGB output supported when the upper 8 bits are set (`$FFbbggrr`); a lone module's inputs can be toggled by clicking the Scope view.
- Experimental: Wiz, a "high-level assembly" language (examples for Atari 2600, NES, MSX).
- Experimental: Silice, a semi-procedural HDL (slow to simulate).

## 3.7.1 (2021-01-14)

- Verilog 32-bit RGB output (`$FFbbggrr`), tested with Silice.
- Embed mode: splits, UI tweaks, no line numbers, fixed `saveAs`.
- Fixed GitHub import and branch-name bugs.
- Serial test harness with `readFile`/`writeFile` and save/load state; `devel-6502` platform.

## 3.7.0 (2020-10-08)

- Vintage BASIC interpreter supporting multiple historical dialects via `OPTION DIALECT` (e.g. Dartmouth), with a teleprinter-style interface instead of a CRT.
  - Errors are highlighted as you type; successful edits hot-load into a running program where possible.
  - New "Restart at Line" button.
  - Debug Tree and variable inspection by highlighting a name.
- FastBasic, a BASIC interpreter for Atari 8-bit computers.

## 3.6.0 (2020-07-23)

New platforms:

- Commodore 64 (chips library, MEGA65 open-source BIOS; C and 6502 assembly, no BASIC or disk drive).
- ZX Spectrum 48K (SDCC for C, ZMAC for assembly, SEBASIC ROMs).
- Z-Machine, with Inform 6 and its example games; includes a Debug Tree for object hierarchy and globals.
- Atari 5200 (experimental; MAME-based, no debugging; Altirra BIOS).
- PC DOS x86 (experimental; v86 with FreeDOS, yasm and SmallerC; no debugging).

New tools and features:

- Dithertron: converts images to retro formats (C64 multi/hires, NES, TMS9918A, Apple ][ Hires, Atari ANTIC D, Atari VCS, Bally Astrocade), with export to sample programs for some formats.
- Probe Log: cycle- or instruction-level execution log.
- Symbol Probe: running read/execute/write counts per symbol.
- Call Stack: tree view with call counts and the raster lines where each subroutine starts and ends.
- Debug Tree: inspector for raw emulator state.
- All debug views now supported on VCS, C64 and ZX Spectrum.
- Improved Memory Probe: more symbol lookups on mouse-over, display kept when advancing a frame.
- Double-click a global symbol in the editor to show its value.
- Cycle-level replay slider; opens the relevant listing while rewinding.
- Run to PC by clicking the left gutter; fixed repeated use on the same line.
- Fixed line numbers in CA65 assembly.
- Requests browser storage permission on first new project or repository import (Safari) and reports whether changes will be preserved.
- Memory Map shows overlapping segments side by side.
- "?" toolbar icon links to platform/language help.
- Downloaded ROMs get an appropriate file extension.

## 3.5.2 (2020-06-28)

- Multi-file import with `file0_name`; new upload dialog.
- Started PC DOS support (v86, FreeDOS, FatFS, yasm, SmallerC).
- Started Vectrex (xasm and C) and added the cmoc 6809 compiler.
- C64: better PRG start address detection, F2/F4/F8/F10 keys, IRQ-based program start, ROM cart reset, clock correction, BIOS `gotoxy()` fix.
- Fixed Apple II colors; Player 2 gamepad buttons; Verilog player 2 keys.

## 3.5.1 (2020-04-09)

- C64 added to the platform menu, with scrolling and sprite libraries.
- Debug: variable values on inspect, textual probe view, click the gutter to run to cursor; probe output kept for the last frame.
- Asset editor toolbar and aspect ratios.
- Warns that Safari/iOS removes local data after 7 days.

## 3.5.0 (2019-12-27)

- Five new platforms, programmable in C or assembly: Bally Astrocade (with the open-source AstroLibre BIOS), ColecoVision, MSX (with open-source C-BIOS), Sega Master System, Atari 7800.
- libCV C library shared by the TMS9918A-based platforms.
- New Z80 simulator: much faster and no longer hiccups.
- Memory Probe and CRT Probe debug views.

## 3.4.2 (2019-09-08)

- Quota errors caught on local storage, with a "persist" menu item.
- Verilog: much faster `$readmem`, keycode/keystrobe, fixed the 6502 CPU.
- GitHub: import after publish to get all files.
- Uploads prompt for confirmation; audio buffers cleared when stopping.

## 3.4.1 (2019-08-22)

- Fixed audio autoplay in Chrome (VCS and SampleAudio).
- GitHub: check the repo exists before importing.
- Fixed POKEY/TIA sound, MSX presets and BIOS module, and Atari 7800 fixes.
- Added nesasm3; NES `.asm` uses DASM instead of ca65.
- Updated TypeScript to 3.5.3.

## 3.4.0 (2019-08-10)

- New Nintendo Entertainment System (NES) platform: C via cc65 with a fork of NESLib and Famitone for music/sound, plus 6502 assembly examples.
- Project gallery of homebrew creations, openable in the IDE.
- GitHub integration: publish projects to GitHub from a separate workspace. Limitations: all sources at the root; no conflict resolution (pulling replaces local files).
- Asset Editor for palettes and bitmaps, writing changes back to source via comment tags.
- Memory Map view of the platform's address space.
- Profiler view with a scanline-by-scanline account of executing code.
- Gamepad support, and keyboard controls shown while the emulator runs.
- HTTPS is now the default for new users (File menu option to move existing users).
- Verilog: `$readmemb` and `$readmemh`, Scope view icons, Ctrl-click the CRT to pause on a scanline, new "Verilog VGA" platform (slower, 25 MHz).
- Minor: new dialog boxes, Z80 cycle counts in the assembler editor, more debug info, nicer break-expression dialog, new emulator focus ring.
- Fixes: disappearing first editor line, debugging in listing view, segment names in Memory Viewer, DASM listing/error parser, assorted debugger issues.
- New files no longer get a `local/` prefix (existing files keep it and can be renamed).

## 3.3.0 (2018-12-22)

- Verilog platform: write Verilog and see it simulated in real time on a simulated CRT (about 5 million ticks/sec in JavaScript), with a Scope view, many examples, and a built-in assembler for custom CPUs (e.g. FEMTO-8).
- SDCC (Z80) now runs with `--oldralloc` for much faster compiles at slightly less optimal code. This breaks `bcd_add` and the vector game samples; use "Revert File" to restore the originals.
- VCS: Ctrl-click the monitor to break when the raster beam reaches that position.
- Binary files can be uploaded and included in 6502 assembly with `incbin`.

## 3.2.1 (2018-11-25)

- batari BASIC (Atari 2600) integrated, with presets from "Hello World" to complete games.
- New sidebar and three resizable panes; shows source files, includes, listings and tools.
- "Add Files to Project" menu items: new include files (`#include`) and linked C files (`//#link "..."`).
- Markdown platform with live preview (Showdown).

## 3.2.0 (2018-10-03)

- Debugging keyboard shortcuts: Ctrl+Alt+P pause, R resume, `.` reset, S single step, V single frame, L run to cursor, O run until return, B step backwards.
- Debugging of bankswitched VCS programs (standard 8K/16K/32K and Tigervision 3E/3F; ORG code at `$1000`). Force a mapper by appending its hex code to the filename, e.g. `MyGame[3E]`.
- Apple ][ cassette loading via the c2t tool.
- Bitmap Font Generator in the Tools menu.
- Z80 disassembler.

## 3.1.0 (2018-08-26)

- VCS: header/include files viewable and editable (use double quotes, not angle brackets); fixed emulator blank-screen and wrong-size ROM bugs and a wonky PC when single-stepping; Advance Frame button; Disassembler view using DASM symbols; Stack Info in the Debug Info panel; `TIMER_START`/`TIMER_WAIT` made reliable for every scanline count (a WSYNC is now forced after `TIMER_WAIT`); new PAL example.
- Instant Replay: records the last 120 seconds of game state to rewind and replay.
- Share Playable Link: the whole ROM is embedded in the URL, embeddable via iframe.
- Download ZIP archive of a project or of all changed files for a platform.
- The page is no longer loaded twice on startup.
- New Apple II+ (64K) platform with an alternate Monitor ROM (no Applesoft BASIC); C via cc65 and 6502 assembly.

## 3.0.0 (2018-08-07)

- New browser storage backend; local changes are migrated on first start, allowing many more saved projects.
- HTTPS support (local files on HTTPS and HTTP sites are separate).
- New WebAssembly worker build engine, much faster, with multiple include and link files.
- Window list (folder icon) with listing files, Memory Browser and Disassembler views.
- Error icons beside the editor expand to full messages on mouse-over.
- VCS: no sound while the debugger is stopped; PIA and TIA state shown during debugging.
- "Upload File" menu option.
- Removed "Share File as GitHub Gist" due to GitHub changes.

See the README for credits, third-party emulators, compilers and libraries, and the
[GitHub contributors graph](https://github.com/8bitworkshop/8bitworkshop/graphs/contributors) for the full list.
