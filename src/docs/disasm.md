# Disassembly

The Disassembly window disassembles machine code around the current
program counter. It is available on platforms that expose both a
disassembler and a savable CPU state.

Each line shows:

| Column | Meaning |
| --- | --- |
| Address | The 16-bit program counter for the instruction |
| Bytes | The raw opcode bytes (padded for alignment) |
| Mnemonic | The disassembled instruction |
| Comment | The symbol defined at that address, if any |

The view is centered on the program counter (PC). While debugging, it
follows the PC as you step. Symbol names are substituted for addresses
when a symbol map is available, so jumps and loads show labels instead
of raw hex.

When the build has source-line information for a high-level language
(C, BASIC, Rust, ...), the source line for an instruction is shown above
it as a comment in a different color:

```
; game.c:42: if (player.x > 0) {
$0865  A2 08  LDX #$08
```

Assembly sources (ca65, DASM, ACME, ...) are not interleaved: their
instructions are already the disassembly. Source text comes from the
project file, so linked sources are shown with their own file name.
Library code with no source in the project is disassembled without these
comments.

## Navigating

- **Go To Address** re-centers the window on an address or symbol and
  highlights it.
- Addresses in the operand columns are linked to their symbols when the
  map contains them.

## Listing vs. disassembly

The Disassembly window is generated live by the emulator's disassembler.
A compiler or assembler *listing* is a separate, read-only window built
from the tool's own output; see [Editor](editor.md). The listing follows
the program counter using the line-to-address map from the assembler,
which is more accurate for source-level navigation than the live
disassembly.
