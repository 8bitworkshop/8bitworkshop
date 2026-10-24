# Changelog

## Unreleased

- Rust programs (`.rs`) build with urust on every platform it supports (NES, Atari 2600, C64, Atari 8-bit, Apple II, VIC-20, ZX Spectrum, and devel-6502).
- Platform detection recognizes the `rs8::` module an urust program uses (`use rs8::nes::*;` picks the NES), and the ZX Spectrum maps to urust's `zx-spectrum` target.
- `.rs` is treated as a shared extension: 8bitworkshop never claims it, never shows "No platform" for an unrelated Rust file, and leaves the `rust` language to your Rust extension. Without one, a built-in `Rust (urust)` grammar highlights the file inside a project.
- New urust projects write `.vscode/settings.json` that turns off rust-analyzer's `cargo check` (urust has no Cargo target), its unresolved-name diagnostics (`rs8::*`, `reg!` and `#[reset]` can't resolve without a Cargo target; syntax and type errors stay), its Run/Debug lenses, and proc-macro expansion (the rs8 macros are markers; expanding `#[asm]`/`#[no_cross]` makes the proc-macro server exit with status 101), while keeping highlighting, hover and navigation. **8bitworkshop: Set Up rust-analyzer** does the same for an existing project, and setting a urust main file or accepting a detected project writes them automatically.
- Blank programs built with urust are labelled **Rust** rather than the tool's name.

## 0.1.2

- `8bws` unpacks only the toolchains a command needs: cc65, SDCC, Verilog and
  the lesser-used tools are separate packs that wait until a build uses them.
  Run outside VS Code, it keeps them in the user cache directory.

## 0.1.1

- The Verilog and Verilog (VGA) platforms now appear in New Project and Open
  Example.
- Verilog syntax highlighting.
- Vector platforms (Atari vector, Vectrex) show their video in the emulator panel. The
  `8bitworkshop.vectorSize` setting sets its resolution (512 by default).
- The mouse is a paddle in the emulator panel, for programs that read one
  (Verilog designs with `hpaddle`/`vpaddle` inputs, and platforms with paddles).
- Reloading the window closes the emulator tab instead of restoring it blank.
- Debugging a Verilog program shows its signals in Variables, nested by module,
  under a stack frame named for the frame and clock cycle.
- A Machine view in a new 8bitworkshop panel shows the platform's debug info,
  live while the program runs, for platforms that have it.
- A Waveform view in the 8bitworkshop panel shows a Verilog design's signals
  as it runs: zoom, move the cursor, switch hex/decimal, and click an input to
  change it. It shares its drawing and keys with the IDE's waveform pane.
  It records only while it is showing, so opening it while paused runs the
  last frame again to fill it. A design with only signals (no video, sound or controls) opens no emulator tab, only this view.
- **Record Signals to VCD...** writes a Verilog design's signal changes to a
  `.vcd` file as it runs, without holding them in memory, up to
  1 GB. `8bws run` has a
  matching `vcd FILE` / `vcd off` script command.
- Infer symbol sizes from build output, instead of one byte per variable.
- Removed Hex Editor extension integration, we'll come up with a better one.
- Closing the emulator tab no longer reports "emuworker.js was stopped" as an error.
- Removed the assetUrl setting.
- Dialog, Inform 6, armips, YASM, arm-tcc and smlrc, which no extension
  platform uses, are no longer packed.

## 0.1.0

First preview.

- New Project and Open Example, with blank programs and the 8bitworkshop
  examples for each platform.
- Platform and main-file detection for existing folders.
- Builds as you type, with errors in the Problems panel.
- Emulator panel with pause, reset, and mute.
- Syntax highlighting for 6502, Z80, and 6809 assembly, and for Verilog
  (including inline `__asm` blocks).
- Toolchains download on first use, checked against built-in hashes.
- Compiler and emulator crashes send an error report to 8bitworkshop.com,
  following VS Code's `telemetry.telemetryLevel` setting. See the README.
- Debugging with <kbd>F5</kbd>: breakpoints on lines, functions and
  conditions; step, step over, step out, step back and reverse continue;
  a timeline to scrub through the recording while paused.
- Debug views: registers, the machine's internal state (the IDE's Debug
  Tree), symbols, a call stack walked from return addresses, and
  disassembly.
- `.s`, `.asm`, `.inc` and `.a` files in a project get the highlighting
  for the platform's CPU. `.acme` files get 6502 highlighting.
- An `8bws` command in the integrated terminal builds and runs programs
  from the command line, for scripts and AI agents.
- Build and Run tools for AI agents in VS Code, such as Copilot's agent
  mode. Run returns a screenshot from a hidden emulator.
- New Project writes a README with build instructions and the link that
  platform detection reads.
- The platform list shows the 8bitworkshop book for each platform that
  has one, with a button to open it.
