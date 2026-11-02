# ROM images in this directory

These are **not** the original system ROMs. They are freely
redistributable replacement BIOS/OS images, included so that the MAME
builds of the Atari 8-bit and ColecoVision platforms can boot without
requiring the user to supply copyrighted firmware.

If you are looking to load the real firmware, or your own dump, add it
to the IDE project as a binary file named `<platform-id>.rom` (for
example `apple2.rom`); the IDE loads it as the BIOS at startup.
See the emulator code for the layout of the ROM file.

## Contents

| File | System | Image | Origin | License |
| --- | --- | --- | --- | --- |
| `a5200/5200.rom` | Atari 5200 | AltirraOS 5200 SuperKernel | [Altirra](https://www.virtualdub.org/altirra.html) by Avery Lee | permissive, notice required (see below) |
| `a800xl.zip` → `co61598b.rom` | Atari 800XL | AltirraOS XL/XE kernel | Altirra by Avery Lee | permissive, notice required |
| `a800xl.zip` → `co60302a.rom` | Atari 800XL | Altirra BASIC | Altirra by Avery Lee | permissive, notice required |
| `coleco/313 10031-4005 73108a.u2` | ColecoVision | `minbios` | built from [`meta/romsrc/coleco/minbios.asm`](../../meta/romsrc/coleco/minbios.asm) | unspecified in source (see below) |

The filenames inside `a800xl.zip` (`co61598b.rom`, `co60302a.rom`) and
the Coleco chip filename are the names MAME expects; the *contents* are
the free replacements, not the chips those names refer to.

The Atari images are byte-identical to the copies used by the native
(non-MAME) emulator:

* `a5200/5200.rom` = `res/atari8/altirra/superkernel.rom`
* `a800xl.zip` → `co61598b.rom` = `res/atari8/altirra/kernelxl.rom`

## Altirra license

The AltirraOS and Altirra BASIC ROMs are Copyright © 2008-2020
Avery Lee and are distributed under this notice (taken from the
source listing, `res/atari8/altirra/*.lst`):

> Copying and distribution of this file, with or without modification,
> are permitted in any medium without royalty provided the copyright
> notice and this notice are preserved. This file is offered as-is,
> without any warranty.

Keep this notice when redistributing the project or the ROM images.

## Coleco minbios

`coleco/313 10031-4005 73108a.u2` is an 8 KB alternative ColecoVision
BIOS assembled from `meta/romsrc/coleco/minbios.asm` with
[`naken_asm`](https://www.naken.cc/naken-asm/), then padded to 8192
bytes:

```sh
cd meta/romsrc/coleco
make            # runs naken_asm and copies to mame/roms/coleco/
```

The non-MAME ColecoVision emulator carries its own copy of this ROM,
compressed with [liblzg](https://github.com/mbitsnbites/liblzg), in the
`COLECO_BIOS_LZG` constant in `src/machine/coleco.ts`. After changing
the source, regenerate it with `lzg -9` and re-encode the result as
base64; `lzgmini()` in `src/common/util.ts` decodes it at run time.

## Regenerating / replacing

The Atari images can be rebuilt from the Altirra source (MADS
assembler), which is part of the Altirra emulator distribution. After
building, copy the resulting kernel/BASIC ROMs over the files above
(keeping the MAME-expected names and the zip layout).

Do not check in the original Atari or Coleco ROM dumps — they are
copyrighted and are not covered by this project's license.
