# 8bitworkshop

![Build Status](https://github.com/8bitworkshop/8bitworkshop/actions/workflows/node.js.yml/badge.svg)

8bitworkshop is a browser-based IDE for micro computers and consoles.
It compiles or assembles your code as you type,
then runs the result in a built-in emulator — all locally in your
browser, with no server round-trip.

It bundles toolchains and emulators for dozens of platforms, including the
Atari 2600/7800/8-bit, Commodore 64/VIC-20, NES, Game Boy, ColecoVision,
MSX, ZX Spectrum, Amstrad CPC, PC Engine, Vectrex, Apple II, and a
number of arcade boards. See
[Toolchains & Platforms](https://8bitworkshop.github.io/8bitworkshop/#help/toolchains)
for the complete list.

![8bitworkshop IDE](https://8bitworkshop.com/images/ide_screenshot1.png)

## Use Online

Latest release:
- https://8bitworkshop.com/latest/
- https://8bitworkshop.github.io/8bitworkshop/

## Features

* In-browser compilers and assemblers (cc65, SDCC, Z80/6502/6809
  assemblers, and more) — see [Tools](src/docs/toolchains.md)
* Built-in emulators with keyboard and gamepad input
* Debugger with breakpoints, stepping, memory browser, disassembly,
  call stack, memory probes, and time-travel replay
* Hardware simulation with Verilog
* Asset editor for bitmaps and palettes
* Export ROMs, save screenshots/videos, share playable links, and sync
  projects to GitHub

## Install Locally

Requirements:

* [Node.js](https://nodejs.org/) 24.x
* [npm](https://www.npmjs.com/)
* `make` and `git`
* Python 3 (for the local dev server)

To clone just the main branch, with blobs fetched lazily:

```sh
git clone --filter=blob:none -b master --single-branch \
  git@github.com:8bitworkshop/8bitworkshop.git
```

Drop the `--filter` option if you want to browse history offline.

To build the 8bitworkshop IDE:

```sh
# On Windows, use the `UCRT64` shell from https://msys2.org/
# On Linux/macOS, just type:
make
```

`make` initializes git submodules, installs npm dependencies, builds the
TypeScript and lezer grammars, and runs esbuild.

To use GitHub integration locally, download the Firebase config file,
e.g. https://8bitworkshop.com/v[version]/config.js

### Develop with VSCode

To fix TypeScript errors in VSCode:
* Open any TypeScript file
* Open the command palette (Cmd+Shift+P)
* Select "TypeScript: Select TypeScript Version"
* Select "Use Workspace Version"

### Start Local Web Server

Start a web server on http://localhost:8000/ while TypeScript compiles
in the background:

```sh
make tsweb
```

### Run Tests

```sh
# To avoid "API rate limited exceeded" errors, set `TEST8BIT_GITHUB_TOKEN`,
# see: https://github.com > Settings > Developer settings > Personal access tokens
export TEST8BIT_GITHUB_TOKEN="<github_personal_access_token>"

npm test
```

## Command-Line Tool

The `8bws` CLI builds and runs projects headlessly, without a browser.
It is useful for scripting, CI, and regression tests.

```sh
# Build a source file to a ROM
npm run cli -- build --platform c64 hello.c -o hello.prg --symbols

# Run a ROM for 200 frames and take a screenshot
npm run cli -- run --platform nes --frames 200 --png shot.png game.nes

# Run with a debugger script (symbolic addresses come from the build)
npm run cli -- run --platform gb hello.c -e "break _main; pc 4"

npm run cli -- list-platforms
npm run cli -- list-tools
```

Run scripts (`-e` or `--script <file>`) can `run`, `break`, `step`,
`trace`, `hist`, `key`, `mem`, `screen`, `pc`, `info`, `reset`, and
`echo`. Run `npm run cli -- help` for the full list.

## Documentation

The IDE manual lives in [`src/docs/`](src/docs/index.md):

* [IDE Overview](src/docs/index.md)
* [Managing Files](src/docs/managing-files.md) — export, share, GitHub sync
* [Build Directives](src/docs/build-directives.md) — multi-file projects
* [Toolchains & Platforms](src/docs/toolchains.md) — tools and file extensions
* [Debugger](src/docs/breakpoints.md) — breakpoints and stepping
* [Embedding the IDE](src/docs/embedding-ide.md) — iframe embeds

## Contributing

Thank you for your contribution!

The 8bitworkshop IDE is intended for a diverse audience using a wide range of devices.
It likes:
* Running locally
* Vanilla TypeScript against Web APIs
* Stable/mature dependencies
* Running decently on 10-year old Chromebooks
* Working (or degrading gracefully) on 5-year old browsers
* Not changing anything described in the 8bitworkshop books too much

The code samples in `presets/` are intended to be studied by humans.
LLM usage for generating code samples is discouraged, as they tend to hide subtle errors in code and in comments, and it diminishes the human achievement and human-to-human communication aspects of the project.
Please thoroughly review and edit such code.

Adapting third party sample code with permissive licenses and giving credit to the original author(s) is encouraged.

## Credits

8bitworkshop is created and maintained by
[Steven E. Hugg](https://github.com/8bitworkshop).

Major contributors:
* [Fred Sauer](https://github.com/fredsa) - CodeMirror 6 editor migration, Apple II enhancements, and general IDE work.
* [Mike DX](https://github.com/MikeDX) - PC Engine / Game Boy / Williams 6809 enhancements, library code, and examples.
* [Micah Cowan](https://github.com/micahcowan) - Apple II enhancements.
- NotExactlySiev: NES debug symbols in Mesen format (3.10.0).

The emulators, compilers, assemblers, and libraries that this project
builds on are credited in [Dependencies](#dependencies) and retain their
own licenses (see [License](#license)).

For the complete list of contributors, see the
[GitHub contributors graph](https://github.com/8bitworkshop/8bitworkshop/graphs/contributors).

## License

The original source code in this repository is Copyright © 2016-2026
[Steven E. Hugg](https://github.com/8bitworkshop) and is licensed under the
[GPL-3.0](https://github.com/8bitworkshop/8bitworkshop/blob/master/LICENSE).

This project also bundles and links against third-party components,
including emulators, compilers, and libraries. These components are
**not** covered by the GPL-3.0 license above; they remain under their
own licenses, and you must comply with those terms when redistributing
this project or a modified version of it. 
See the individual dependencies' own license files for details.

All included code samples located in the `presets/` directory are licensed under
[CC0](https://creativecommons.org/publicdomain/zero/1.0/)
unless a different license is explicitly stated within the specific code sample.

## Dependencies

### Emulators

* https://javatari.org/ (AGPL-3.0)
* https://jsnes.org/ (Apache 2.0)
* https://www.mamedev.org/ (BSD-3-Clause)
* https://github.com/floooh/chips (Zlib)
* https://github.com/DrGoldfire/Z80.js (MIT)
* http://www.twitchasylum.com/jsvecx/ (GPL-3)
* https://github.com/curiousdannii/ifvms.js/ (MIT)
* https://github.com/6502ts/6502.ts (MIT)
* https://github.com/yhzmr442/jspce (MIT)
* https://github.com/gasman/jsspeccy2 (GPL-3)

### Compilers

* https://cc65.github.io/ (zlib)
* http://sdcc.sourceforge.net/ (GPL-2)
* https://github.com/stahta01/cmoc/ (GPL-3.0)
* https://github.com/batari-Basic/batari-Basic (GPL-2)
* https://www.veripool.org/wiki/verilator (GNU Lesser Public License Version 3)
* http://mcpp.sourceforge.net/ (BSD-2)
* https://github.com/DavidKinder/Inform6 (Inform, https://github.com/DavidKinder/Inform6/blob/master/licence.txt)
* https://github.com/dmsc/fastbasic (GPL-2.0)
* https://github.com/wiz-lang/wiz (MIT)
* https://github.com/sylefeb/Silice (GPL-3.0)
* https://github.com/steux/cc7800 (GPL-3.0)
* https://bellard.org/tcc/ (MIT)
* https://github.com/Dialog-IF/dialog (BSD-2-Clause)
* https://github.com/alexfru/SmallerC (BSD-2-Clause)
* https://github.com/drmortalwombat/oscar64/ (GPL-3.0)

### Assemblers/Linkers

* https://dasm-assembler.github.io/ (GPL-2)
* https://web.archive.org/web/20221010235026/http://atjs.mbnet.fi/mc6809/Assembler/xasm.tar.gz
* http://48k.ca/zmac.html (public domain)
* https://github.com/apple2accumulator/merlin32
* https://github.com/camsaul/nesasm
* https://www.floodgap.com/retrotech/xa/ (GPL-2)
* https://github.com/mikeakohn/naken_asm (GPL-3)
* https://github.com/yasm/yasm
* https://github.com/mbitsnbites/vasm-mirror
* https://github.com/8bitworkshop/acme (GPL-2.0)

### Dev Kits / Libraries

* https://shiru.untergrund.net/code.shtml
* http://www.colecovision.eu/ColecoVision/development/libcv.shtml (LGPL-2.1)
* https://github.com/toyoshim/tss (BSD-3-Clause)
* https://github.com/lronaldo/cpctelera (LGPL-3.0)
* https://github.com/datajerk/c2t (BSD-3)
* https://github.com/8bitworkshop/6809tools (GPL-3)
* https://github.com/mbitsnbites/liblzg (Zlib)
* https://github.com/8bitworkshop/makewav
* https://github.com/Kingcom/armips (MIT)
* https://github.com/dmsc/mkatr (GPL-2.0)

### Firmware

The emulator cores need system firmware to boot. Only freely
distributable replacement images are included — see
[`mame/roms/README.md`](mame/roms/README.md) for their provenance and
licenses.

To use your own firmware in the IDE, add it to the project as a binary file named
`<platform-id>.rom` (for example `apple2.rom`); the IDE loads it as the
BIOS at startup. Only freely distributable firmware should be shared.

* http://www.virtualdub.org/altirra.html (GPL-2)
* https://github.com/MEGA65/open-roms (LGPL-3.0)
* https://sourceforge.net/projects/cbios/ (BSD)
* https://zxdesign.itch.io/opense (GPL-2)

### Related Projects

* https://github.com/8bitworkshop/8bit-tools (CC0-1.0)
* https://github.com/8bitworkshop/awesome-8bitgamedev (Public Domain)
* https://github.com/8bitworkshop/8bitworkshop-compilers

## Tool Server (experimental)

This is an experimental feature that relies on a Docker container to provide compiler tools like [llvm-mos](https://github.com/llvm-mos/llvm-mos-sdk).
Right now, you have to run locally and build your own docker container.

```sh
docker build -t 8bitws-server-debian scripts/docker
docker run -p 3009:3009 8bitws-server-debian
echo '{"REMOTE_URL":"http://localhost:3009/build"}' > remote.json
```

Then add "&tool=llvm-mos" to your URL, like
[this](http://localhost:8000/?platform=c64&file=sprite_collision.c&tool=llvm-mos).
You can also rename your C files to have the suffix "-llvm.c".
Right now only the platforms c64, atari8, nes (NROM), and pce are supported.
Not very many of the current examples work with the new toolchain.
