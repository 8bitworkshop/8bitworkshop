# Asset Header

An **asset header** is a tiny note to the [Asset Editor](asseteditor.md)
that tells it what a block of data means. It is just a JSON object inside
a comment, sitting right above the bytes:

```c
/*{w:8,h:8,bpp:1,count:2,brev:1}*/
const byte tiles[] = { ... };
```

The Asset Editor scans that comment and reads the JSON inside.
It then knows how to convert the bytes inside the array to and from an image.

For example, the above comment represents two images, 8x8 pixels, 1 bit per pixel, most significant bit on the left.

## Header syntax

A header is a comment containing a single JSON object, immediately
followed by a data block. The block ends at the next closing delimiter,
which depends on the language:

| Language | Header | Data block ends at |
| --- | --- | --- |
| C / C++ | `/*{w:8,h:8}*/` | `;` |
| Assembly | `;;{w:8,h:8};;` | `;;` |
| Verilog | `/*{w:8,h:8}*/` | `end` |
| Rust (`.rs`) | `/*{w:8,h:8}*/` or `//{w:8,h:8}` | the array's closing `]` |

**Each number needs a radix prefix.**
It recognizes `0xNN`, `$NN`, `#$NN`, `%0101`, `0b0101`, `8'hNN`, `8'b0101`,
and assembler `hex aabbcc…` statements.
It remembers the notation you used and writes each number back the same way.
It does *not* recognize **plain decimal** numbers, so for example `{24,60,126,…}` will be skipped.

Examples:
```c
/*{w:8,h:8,bpp:1,count:2,brev:1}*/
const byte tiles[] = {
  0xff,0x81,0x81,0x81,0x81,0x81,0x81,0xff,
  0x18,0x3c,0x7e,0xff,0xff,0x7e,0x3c,0x18,
};
```

```asm
;;{w:8,h:8,count:1,brev:1,flip:1};;
PlayerGfx:
       .byte $18,$3c,$7e,$ff
       hex ff7e3c18
;;
```

```rust
// {w:8,h:8,bpp:1,count:2,brev:1}
static TILES: [u8; 16] = [
  0xff,0x81,0x81,0x81,0x81,0x81,0x81,0xff,
  0x18,0x3c,0x7e,0xff,0xff,0x7e,0x3c,0x18,
];
```

In a `.rs` file the header may be a `/*…*/` comment or a `//…` line
comment. The data block is the array literal after the `=`; its closing
`]` ends the block, so the `;` inside a type like `[u8; 16]` is harmless.

The JSON parser isn't strict, so you don't have to "quote" keys --
`w:8` and `"w":8` mean the same thing.
String *values* still need their quotes, though: `pal:"nes"`, `comp:"rletag"`.

### Gotchas

- **The first `;` wins.** In C the block ends at the very next semicolon,
  so the array declaration must be the only statement between the header
  and that `;`. Anything else and the editor reads the wrong data.
- Keys are case-sensitive and must be alphabetic.
- A malformed header is reported inline in the Asset Editor tab, rather
  than being silently ignored.

### Read binary files with `#embed`

If the data block contains an `#embed` directive, the bytes are read
from that file instead of from the source text:

```c
/*{w:24,h:21,bpp:1,brev:1,wpimg:64,count:1}*/
const char sprite[] = {
#embed "sprite.bin"
};
```

### Overlapping arrays

The scanner decides where a data block ends from how the header starts,
not from the language of the file. In C, a `/*{…}*/` header always ends at
the next `;`; in assembly a `;;{…};;` header always ends at the next `;;`;
in Rust it ends at the array literal's closing `]`.

So in an assembly file you can't stack two `;;` headers — the second one
looks like the end of the first. But you *can* drop a `/*{…}*/` header in
the middle of a byte block; it will read up to the next `;`.

`presets/nes/chr_generic.s` does this. One `;;` header describes all 256
CHR tiles, and a `/*{…}*/` header near the end describes 15 of those same
bytes as 16×16 sprites. The ranges overlap on purpose, so the editor
shows the same data two ways. Just remember that any `;` inside the block
will cut it short.

## Field reference

### Image fields

These describe a bitmap or character set. Only `w` and `h` are required —
everything else falls back to a sensible default.

| Field | Default | Description |
| --- | --- | --- |
| `w` | *required* | Width in pixels |
| `h` | *required* | Height in pixels |
| `count` | `1` | Number of images |
| `bpp` | `1` | Bits per pixel |
| `np` | `1` | Number of bitplanes (colors = 2<sup>bpp&dot;np</sup>) |
| `bpw` | `8` | Bits per word (8, 16, 32) |
| `sl` | `ceil(w*bpp/bpw)` | Words per scanline (stride) |
| `wpimg` | `sl*h` | Words per image (for padding) |
| `pofs` | `sl*h*count` | Distance between bitplanes, in words |
| `skip` | `0` | Words to skip at the start of the whole block |
| `brev` | `false` | MSB is the leftmost pixel |
| `flip` | `false` | Data is stored bottom row first |
| `il` | `false` | Interleave images row by row |
| `remap` | — | Bit permutation applied to the word offset |
| `reindex` | — | Per-column word/bit table |
| `aspect` | `1` | Pixel aspect ratio for display only |
| `art` | `false` | Apple II HGR artifact color; bit 7 is drawn as an extra column per word |
| `palname` | — | Preferred palette name for preview |
| `comp` | — | `"rletag"` = RLE-compressed block |
| `map` | — | `"nesnt"` = NES nametable, `"charpad"` = C64 CharPad map, `"tilemap"` = generic tile map; not a bitmap |
| `pacstrip` | — | Pac-Man/Namco vertical-strip layout |
| `xform` | — | CSS transform. Parsed and stored but currently inert |

### Palette fields

A block with `pal` and no `w`/`h` describes a palette instead of an image.

| Field | Default | Description |
| --- | --- | --- |
| `pal` | — | Palette decoding, see below |
| `n` | — | Advisory entry count — the real count comes from the data |
| `layout` | — | Grouped editor layout: `nes`, `astrocade`, `pacman`, `sms`, `gg` |
| `name` | `"Palette N"` | Display name in the bitmap editor's palette dropdown |

`pal` is either:

- **A number** like `332` or `444` — the three digits are channel bit
  widths, applied **from the low bits upward**. A positive value puts red
  lowest (`pal:332` = RGB332, red in bits 0–2); a **negative** value puts
  blue lowest (`pal:-332` = blue in bits 0–2, red in the top 2 bits).
  The picker's color space is `1 << (sum of digits)` entries, which is why
  `pal:444` is a 4096-color chooser regardless of how many entries the
  block holds.
- **A name**: `"nes"`, `"vcs"`, `"c64"`, `"gb"`, `"ap2lores"`,
  `"astrocade"`, or `"pacman"`.
  An unknown name reports an error.

Bitmaps pick up their colors from palette blocks **anywhere in the current
project**, matched by entry count — a 4-color bitmap offers every 4-entry
palette (and every 4-entry slice named by a `layout`) in a dropdown.
Projects fall back to a default palette when no palette block matches.

```c
/*{pal:"nes",layout:"nes"}*/
const char PALETTE[8] = { 0x0F, 0x11,0x24,0x3C, 0x00, 0x01,0x15,0x25 };
```

SMS and Game Gear mode-4 palettes use `layout:"sms"` (or `"gg"`, the same
split): the first 16 entries are the background palette and the next 16 are
the sprite palette, matching the VDP's palette-select bit.

```c
/*{pal:222,n:32,layout:"sms"}*/
const unsigned char PALETTE[32] = { ... };
```

`bpw` applies to palette blocks too — PC Engine palettes are 16-bit
words, so their blocks carry `bpw:16` for correct parsing and write-back.

In Apple II artifact-color mode (`art:1`), the artifact column (high bit) is
shown as a half-transparent 2-color column at the end of each word's pixels,
and is left alone by the transforms. `w` must include that column (e.g. `w:8` for one byte per
row, of which seven pixels are visible and the eighth is the artifact bit).

### Palette names

Give a palette a `name` in its header to label it in that dropdown, and
name a bitmap's preferred entry with `palname` so it opens with the matching
palette:

```c
/*{pal:"nes",layout:"nes",name:"Background"}*/
const char BG_PALETTE[8] = { ... };
/*{pal:"nes",layout:"nes",name:"Sprite"}*/
const char SPR_PALETTE[8] = { ... };
/*{w:16,h:16,bpp:1,np:2,pofs:8,brev:1,palname:"Sprite"}*/
const char sprites[] = { ... };
```

Unnamed palettes are numbered in source order (`Palette 1`, `Palette 2`, …)
and get a prefix when there are sub-palettes like on NES (`Palette 3: Background 0`).

## Bit order and planes

Two questions decide how the bits turn into pixels.

**Where do bits start?** `brev:1` means **MSB is the leftmost pixel** — the
usual arrangement for NES, Game Boy, TMS9918, VCS, and most tile-based
hardware. Without it, the LSB is leftmost (Apple II HGR, some bitmap
formats).

**How are colors decided?** Most formats use one of these two:

- **`bpp:N`** — the bits of one pixel are adjacent within a word. `bpp:4`
  packs two 16-color pixels per byte.
- **`np:N`** — the bits of one pixel live in N separate words, `pofs`
  apart. Plane `p` supplies bits `p*bpp`.

Game Boy 2bpp is `bpp:1,np:2,pofs:1,sl:2` — planes interleaved every
other byte. NES 2bpp is `bpp:1,np:2,pofs:8` — plane 0 in bytes 0–7,
plane 1 in bytes 8–15.

## The address model

Everything except the special modes below is described by one addressing
formula:

```
bpw        = bpw   ?? 8                      // bits per word
sl         = sl    ?? ceil(w * bpp / bpw)    // words per scanline
wpimg      = wpimg ?? sl * h                 // words per image
pofs       = pofs  ?? sl * h * count         // distance between bitplanes
rowstride  = sl                              // (see il: below)

for each image n, for each row y:
    yp    = flip ? h-1-y : y
    ofs0  = n*wpimg + yp*rowstride
    shift = 0
    for each column x:
        ofs = remap(ofs0)                       // bit permutation
        for each plane p:
            word  = data[ofs + p*pofs + skip]
            bits  = brev ? word >> (bpw-shift-bpp) : word >> shift
            color |= (bits & ((1<<bpp)-1)) << (p*bpp)
        shift += bpp
        if shift >= bpw:                        // move to next word in the row
            ofs0 += 1
            shift = 0
```

A few things to note:

1. **`remap` is applied to `ofs0` inside the `x` loop**, after the
   byte-advance. It therefore sees the byte index *within* a row as well
   as the row and image index — which lets you describe
   multi-tile-wide sprites.
2. **`skip` is added last**, after `remap` and after the plane offset. It
   offsets the whole block, not each image.
3. **`pofs` defaults to "one plane block after another"**
   (`sl*h*count`). Set it explicitly for anything interleaved.
4. Total colors per pixel = `1 << (bpp * np)`.

### `il` — row interleaving

`il:1` stores all `count` images as one wide block, row by row: `wpimg`
becomes `sl`, and `rowstride` becomes `sl*count`. Useful for character
sets stored as a single wide strip.

## `remap` — matching hardware tile layouts

`remap` permutes the **bits of the word offset**.
It is useful for handling bitmaps in a
different order than row-major, or for rearranging sprite tiles.

Entry `i` of the array says which destination bit source bit `i` becomes:

```
remap(ofs)  =  OR over i of:  bit i of ofs  →  bit remap[i] of result
```

A **negative** entry `-n` maps source bit `i` to destination bit `n-1`
**and inverts it** — use it when the hardware stores the halves in the
opposite order.

### Worked example: NES 16×16 metasprite

From `presets/nes/shoot2.c`:

```c
/*{w:16,h:16,bpp:1,count:16,brev:1,np:2,pofs:8,remap:[5,0,1,2,4,6,7,8,9,10,11,12]}*/
```

`sl` = 2, `wpimg` = 32, so the natural offset is `32n + 2y + xb`:

| Source bit | Meaning | → | Dest bit | Contributes |
| --- | --- | --- | --- | --- |
| 0 | `xb` (left/right byte) | → | 5 | 32 |
| 1,2,3 | `y0,y1,y2` | → | 0,1,2 | `y & 7` |
| 4 | `y3` (top/bottom half) | → | 4 | 16 |
| 5+ | image index `n` | → | 6+ | 64·n |

Physical offset = `64n + 32·xb + 16·y3 + (y&7)`, plus `p*8` for the
plane. That is exactly NES CHR: four 16-byte tiles per metasprite in
8×16 sprite order — upper-left, lower-left, upper-right, lower-right.

### Worked example: Game Boy 16×16 metasprite

From `presets/gb/pakupaku.c`:

```c
/*{w:16,h:16,bpp:1,count:19,brev:1,np:2,pofs:1,sl:2,wpimg:64,remap:[5,1,2,3,4,0,6,7,8,9,10,11,12]}*/
```

Game Boy interleaves its two planes, so `pofs:1`: each plane gets one
byte per 8-pixel row, and `sl:2` covers both planes of that row. The
natural offset is therefore `64n + 2y + xb`, with `xb` in bit 0 and `y`
in bits 1–4.

The remap rearranges those bits as follows:

| Source bit | Meaning | → | Dest bit | Contributes |
| --- | --- | --- | --- | --- |
| 0 | `xb` (left/right 8×8 tile) | → | 5 | 32 |
| 1,2,3 | `y0,y1,y2` | → | 1,2,3 | `y & 7` |
| 4 | `y3` (top/bottom half) | → | 4 | 16 |
| 5 | unused | → | 0 | — |
| 6+ | image index `n` | → | 6+ | 64·n |

So the physical offset becomes `64n + 32·xb + 16·y3 + 2·(y&7)`, plus `p`
for the plane. That is upper-left, lower-left, upper-right, lower-right —
the tile order pakupaku's OAM code expects. Bit 5 is unused only because
`y` never exceeds 15 here; mapping it to bit 0 keeps the remap a proper
permutation of the range.

### `remap` must be a bijection

In other words, if you do it in reverse, you get the original order back.

The size check computes the required data length as `max over n,i of
remap(n*wpimg + i)` for `i` in `[0, wpimg)`, plus one. If your remap
isn't a permutation of that range, the maximum comes out wrong and you
get a spurious *"Expected N values, found M"* error. This is why the
Game Boy example above bothers to map the unused bit 5 down to bit 0
instead of leaving it alone — the mapping is never exercised during
decoding, but it keeps the range exact.

### Other patterns in the tree

| Format | Meaning |
| --- | --- |
| `remap:[0,1,2,4,5,6,7,8,9,10,11,12]` | NES 8×8: doubles the image stride to 16 bytes so the two 8-byte planes fit |
| `remap:[4,0,1,2,3,5,6,7,8,9]` | TMS9918 16×16 sprite: UL, LL, UR, LR (ColecoVision, MSX) |
| `remap:[-5,0,1,2,3,5,6,7,8,9]` | Same, with the halves stored right-first |
| `remap:[3,0,1,2,4,5,6,7,8,9,10]` | Galaxian/Scramble 16×16 sprite |

## `reindex`

`reindex` throws out the shift/advance logic and replaces it with a plain
per-column table. For column `x`, `reindex[x % len]` is a **bit index
within the row**: `>> 3` gives the word offset added to the row base, `&
7` gives the bit position (still subject to `brev`). Entry `15` therefore
means word 1, bit 7. Because it drives the offset directly, the automatic
`ofs0 += 1` advance is disabled.

It exists for hardware where pixel order within a row is not linear —
notably VCS playfields, where the three playfield registers are not all
in the same bit order:

```asm
;;{w:20,h:10,flip:1,reindex:[4,5,6,7,15,14,13,12,11,10,9,8,16,17,18,19]};;
```

## Special modes

### `comp:"rletag"`

The block is RLE-compressed: the first byte is the tag, a literal byte
sets the current value, and a tag byte is followed by a repeat count
(count 0 = end). Decompression happens before decoding, so the editor
shows the expanded image. Currently, these asset blocks are view-only.

### `map:"nesnt"`

The block is an NES nametable, not a bitmap. `w`/`h` are in **tiles**
(default 32×30) and the block is rendered as a tilemap using the project's
CHR data, with a map editor instead of a pixel editor. Usually paired with
`comp:"rletag"`:

```c
/*{w:32,h:30,bpp:8,comp:"rletag",map:"nesnt"}*/
```
Currently, these asset blocks are view-only.

### `map:"tilemap"`

The block is a `w`×`h` grid of tile indices (one value per cell, `w`/`h` in
**tiles**), drawn with the project's 8×8 tile bitmaps and shown as a
read-only preview. Any tile bitmap block with at least as many tiles as the
highest index in the map is used. An optional `attrs` names a parallel array
of the same size holding CGB-style attribute bytes: bits 0-2 are the palette
number (colors are offset by 4 × palette, so the preview needs a palette
with enough entries), bit 5 flips X and bit 6 flips Y. Arrays are found by
name in the project, and may be 2D (`map[66][156]`).

```c
/*{w:156,h:66,map:"tilemap",attrs:"bigmap_map_attributes"}*/
const unsigned char bigmap_map[66][156] = { ... };
```

See `presets/gb/bigmap.h`.

### `map:"charpad"`

A C64 CharPad map: `w`×`h` tile indices, each tile `tw`×`th` chars. `chars`,
`tiles` and `colors` name the charset, tileset and colour arrays; `colorby`
is `"tile"` (default) or `"char"`, `mc:0` selects hires, and `bg`, `mca`,
`mcb` are the screen and shared multicolor colors.
See `presets/c64/level2-data.c`. Currently view-only.

### `pacstrip:1`

Pac-Man / Namco arcade layout: 8-byte vertical strips of 4 rows × 8
columns, 2bpp packed as bit `y` plus bit `y+4`, X/Y mirrored within each
strip. Tiles (8×8) use 2 strips; sprites (16×16) use 8 strips in hardware
order. The mode implies 4 colors regardless of `bpp`.

```c
/*{w:8,h:8,count:256,bpp:2,pacstrip:1}*/
/*{w:16,h:16,count:64,bpp:2,pacstrip:1}*/
```

### `art:1`

Apple II HGR artifact color: bit 7 of each byte selects the color set. Each
group of eight columns is drawn as its seven pixels, then the artifact bit
itself as a half-transparent two-color pixel (palette entry 0 or 1), so its
state is visible. Click or drag that column to toggle it.

Because the artifact bit is part of the image data, `w` must include it:
`w:8` for a byte-per-row image, `w:16` for two bytes per row (each gets its
own artifact column). `w:7,art:1` has no room for bit 7 and is
rejected by the Asset Editor.

With `brev` (MSB first) the artifact bit is the first column of each group
instead of the last. Flips, rotations and pastes skip the artifact columns.

## Validation

Before it creates an editor, the Asset Editor counts the parsed words
(these are bytes when `bpw` is 8) and checks them against the format:

```
required = max(remap(n*wpimg + i))  +  planeExtent  +  1  +  skip
planeExtent = (np-1)*pofs, or 0 if that is smaller than wpimg
```

The `planeExtent` rule distinguishes the two plane layouts: when planes
are interleaved (`pofs < wpimg`, Game Boy/SMS) the plane bytes are already
inside each image block; when planes are stored as separate blocks
(`pofs >= wpimg`, NES) the extra plane is counted at the end.

A mismatch shows as **"Expected N value(s), found M"** in the Asset
Editor tab. When that happens, check things in this order:

1. **`found 0`** — the literals have no radix prefix, or the data block
   ended early at a stray `;`.
2. `count` — the most common culprit otherwise.
3. `wpimg` — hardware often pads (C64 sprites are 24×21 bits in 64
   bytes).
4. `remap` — is it a bijection over `[0, wpimg)`?
5. `pofs` — interleaved planes need it set explicitly.

## Cookbook

Some recipes you can copy and paste:

| Platform | Header |
| --- | --- |
| NES 8×8 CHR | `/*{w:8,h:8,bpp:1,count:256,brev:1,np:2,pofs:8,remap:[0,1,2,4,5,6,7,8,9,10,11,12]}*/` |
| NES 16×16 metasprite | `/*{w:16,h:16,bpp:1,count:16,brev:1,np:2,pofs:8,remap:[5,0,1,2,4,6,7,8,9,10,11,12]}*/` |
| NES palette | `/*{pal:"nes",layout:"nes"}*/` |
| NES nametable | `/*{w:32,h:30,bpp:8,comp:"rletag",map:"nesnt"}*/` |
| Game Boy 8×8 tile | `/*{w:8,h:8,bpp:1,count:4,brev:1,np:2,pofs:1,sl:2}*/` |
| Game Boy 16×16 metasprite | `/*{w:16,h:16,bpp:1,count:19,brev:1,np:2,pofs:1,sl:2,wpimg:64,remap:[5,1,2,3,4,0,6,7,8,9,10,11,12]}*/` |
| ColecoVision / MSX sprite | `/*{w:16,h:16,brev:1,remap:[4,0,1,2,3,5,6,7,8,9],count:2}*/` |
| ColecoVision layered 2-plane sprite | `/*{w:16,h:16,remap:[-5,0,1,2,3,5,6,7,8,9],count:5,np:2}*/` |
| C64 hires sprite | `/*{w:24,h:21,bpp:1,brev:1,wpimg:64,aspect:1,count:3}*/` |
| C64 multicolor sprite | `/*{w:12,h:21,bpp:2,brev:1,wpimg:64,count:4,aspect:2}*/` |
| VCS sprite | `;;{w:8,h:16,brev:1,flip:1};;` |
| VCS palette | `;;{pal:"vcs"};;` |
| Galaxian/Scramble tile ROM | `/*{w:16,h:16,remap:[3,0,1,2,4,5,6,7,8,9,10],brev:1,np:2,pofs:2048,count:64}*/` |
| Pac-Man tiles / sprites | `/*{w:8,h:8,count:256,bpp:2,pacstrip:1}*/` · `/*{w:16,h:16,count:64,bpp:2,pacstrip:1}*/` |
| Pac-Man color PROM | `/*{pal:"pacman",n:32}*/` |
| SMS / Game Gear mode-4 palette | `/*{pal:222,n:32,layout:"sms"}*/` (GG: `pal:444`) |
| Astrocade | `/*{w:16,h:16,bpp:2,brev:1}*/` · `/*{pal:"astrocade",layout:"astrocade"}*/` |
| Williams | `/*{w:16,h:16,bpp:4,brev:1}*/` |
| PC Engine 16×16 sprite | `/*{w:16,h:16,bpp:1,count:3,brev:1,np:4,pofs:16,sl:1,bpw:16,wpimg:64}*/` |
| Apple II HGR | `/*{w:8,h:8,bpp:1,count:96}*/` (LSB-first, no `brev`) |
| Verilog 16-bit words | `/*{w:16,h:16,bpw:16,count:5}*/` |
