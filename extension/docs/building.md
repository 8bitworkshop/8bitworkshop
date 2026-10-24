# Building

8bitworkshop builds your program with the compilers and assemblers built
into the extension, as you type or when you save.

## When it builds

| `8bitworkshop.autoBuild` | Builds |
|---|---|
| `onType` (default) | after you stop typing for a moment |
| `onSave` | when you save |
| `off` | only when you run **8bitworkshop: Build** or **Run** |

Only changes to the program that runs, or to a file its last build read,
start a build. Editing a file the program doesn't use starts nothing.

If builds take longer than about a second, 8bitworkshop waits longer
after you stop typing.

## Toolchains

The compilers, assemblers, emulators, and examples are included so 8bitworkshop builds offline.

For toolchain development, set `8bitworkshop.toolchainPath` to a built
8bitworkshop checkout (a directory containing `src/worker`) to use it
instead of the included toolchains.

### Rust (urust)

`.rs` files on a platform urust supports (NES, Atari 2600, C64, Atari
8-bit, Apple II, VIC-20, ZX Spectrum, and devel-6502) build with
[urust](https://github.com/sehugg/urust), a compiler for a subset of
Rust. It has no Cargo target: `rs8` and the register modules are built
in, and `#[reset]`/`#[nmi]` mark the entry points.

8bitworkshop never claims `.rs`: if you have a Rust extension installed,
VS Code keeps using its `rust` language, so rust-analyzer's parsing,
highlighting, hover, formatting and navigation all work. Without one,
8bitworkshop assigns its own `Rust (urust)` language for highlighting.

rust-analyzer's `cargo check` has no target to check, so it reports
errors for `#[reset]`, `reg!` and `rs8::*`, and its proc-macro server
can't expand the rs8 macros: `#[asm]` and `#[no_cross]` make it exit
with `proc macro server error ... exit status: 101`. New urust projects
write settings that turn off the check, its unresolved-name
diagnostics (syntax and type errors stay), proc-macro expansion and the
Run/Debug lenses while leaving highlighting, hover and navigation on. For an existing project, run **8bitworkshop: Set Up
rust-analyzer**; it writes those settings to the folder's settings (asking
first for a `.rs` file outside a urust project) or to a closed project's
`.vscode/settings.json`.

## Errors

Errors appear as red underlines and in the **Problems** panel. The
**8bitworkshop** output channel logs each build, its tool, and its size.

Code you're halfway through typing often doesn't compile, so errors from
a build you didn't save wait until you pause for about a second. The
last version that built keeps running in the emulator until you fix
them.

## Restarting the game

| `8bitworkshop.reloadOnBuild` | After a successful build |
|---|---|
| `always` (default) | the game restarts with the new code |
| `onSave` | the game restarts only when you save; errors still update as you type |
| `never` | the game keeps running until you click **Run** |

A change that doesn't change the output, such as editing a comment,
doesn't restart the game.

## Exporting the ROM

8bitworkshop normally keeps the built ROM in memory and runs it in the
emulator; it writes nothing to your folder. To also save the ROM to
disk, set `8bitworkshop.exportRom` to `true`. Each successful build
then writes it to the `8bitworkshop.exportRomPath` folder (`bin` by
default), next to the main file, with the platform's usual extension
such as `.nes` or `.a26`.

## AI agents

Agents that use VS Code's language model tools, such as Copilot's agent
mode, have two tools (VS Code 1.95 or later):

- **Build 8bitworkshop Program** (`#8bitworkshopBuild`) builds, and returns
  the ROM size or each error as `file:line: message`. Errors also appear in
  Problems, as with **Build**.
- **Run 8bitworkshop Program** (`#8bitworkshopRun`) builds, runs the program
  in a hidden emulator, and returns a screenshot of the last frame. It can
  also run a script, as `8bws run -e` does: press keys, stop at a routine,
  dump memory. Your emulator panel isn't touched. Screenshots need a VS Code
  version whose tools can return images; older ones get the text alone.

Both use unsaved editor contents and the project's platform and tool. For
a file outside a project, the agent passes the platform.

Agents in the terminal use the `8bws` command below.

## Building from the terminal

With `8bitworkshop.terminalCommand` turned on (it's off by default), VS
Code's integrated terminal has an `8bws` command that builds and runs
programs with the same toolchains and emulators as the extension. It
needs no Node.js install. Scripts and AI agents that run in the
terminal, such as Claude Code, can use it to check their work:

```bash
8bws build game.c -o game.nes          # compile to a ROM
8bws build --check game.c              # just report errors
8bws run game.c --frames 120 --png screen.png
8bws run game.c -e "run 60; screen"    # a run script; see 8bws help
8bws help
```

Add `--json` for machine-readable output on stdout. Without `--platform`,
`8bws` uses [platform detection](detection.md#from-the-command-line); the
README that **New Project** writes names the platform, so a new project
needs no `--platform`. Library files that aren't in your folder come from
the examples, as they do in the editor.

The command is a launcher script in the extension's storage folder, which
the extension adds to `PATH` for each new terminal. Terminals opened
before it was turned on don't have it; open a new one. The first run in a
while may take a few seconds while it unpacks the toolchains.

## Where included files come from

8bitworkshop looks for files your program includes or links in two
places, in order:

1. The folder of the main file (and the paths you give, such as
   `#include "lib/util.h"`).
2. The examples folder for the platform. For NES, that has `neslib.h`
   and `chr_generic.s`, among others.

That's why a copied example builds even though **Copy to Workspace**
copies only its own files. To edit a library file, copy it into your
folder: your copy wins. When you copy an example, **Also copy library
files** does this for you.

The build tools' own headers, such as cc65's `nes.h`, are built in.

8bitworkshop never runs a Makefile or other build script. It builds
with its own tools.

## The build tool

8bitworkshop picks the tool from the platform and the file's extension,
the same way the 8bitworkshop website does. For example, on the NES,
`.c` builds with cc65, `.s` with ca65, and `.dasm` with DASM.

To use another tool for the main file, set `8bitworkshop.tool`. See
[Platform detection](detection.md) for how it notices code written for
another assembler.
