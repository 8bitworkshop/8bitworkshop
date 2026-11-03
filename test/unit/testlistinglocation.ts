import assert from "assert";
import { describe, it } from "mocha";
import { SourceFile } from "../../src/common/workertypes";
import { findListingLocation, ListingLocationContext } from "../../src/ide/search/listinglocation";

const LOOKAHEAD = 64;

function makeFile(lines: { line: number, offset: number }[]): SourceFile {
  return new SourceFile(lines, '');
}

// a context where every candidate window id is "known" and file-prefix
// lookup just strips a trailing extension, like the real IDE's windows
function makeContext(overrides: Partial<ListingLocationContext> = {}): ListingLocationContext {
  return {
    listings: {},
    filename2path: {},
    isWindow: () => true,
    findWindowWithFilePrefix: (fn) => fn.replace(/\.lst$/, ''),
    ...overrides,
  };
}

describe('findListingLocation', function () {

  it('returns null when there are no listings', function () {
    const ctx = makeContext({ listings: {} });
    assert.strictEqual(findListingLocation(0x100, ctx, LOOKAHEAD), null);
  });

  it('returns null when the PC matches no line in any listing', function () {
    const ctx = makeContext({
      listings: {
        'game.c': { lines: [], sourcefile: makeFile([{ line: 1, offset: 0 }]) } as any,
      },
    });
    assert.strictEqual(findListingLocation(0x9999, ctx, LOOKAHEAD), null);
  });

  it('resolves a sourcefile-only listing via findWindowWithFilePrefix', function () {
    const ctx = makeContext({
      listings: {
        'game.c.lst': { lines: [], sourcefile: makeFile([{ line: 1, offset: 0x10 }]) } as any,
      },
    });
    const loc = findListingLocation(0x10, ctx, LOOKAHEAD);
    assert.ok(loc);
    assert.strictEqual(loc.wndid, 'game.c'); // .lst stripped by findWindowWithFilePrefix
    assert.strictEqual(loc.line, 1);
  });

  it('uses a header window for a listing that is not a project file (urust rs8 module)', function () {
    const ctx = makeContext({
      listings: {
        'main.rs': { lines: [], sourcefile: makeFile([{ line: 3, offset: 0x8000 }]) } as any,
        'rs8/gfx/span.rs': { lines: [], sourcefile: makeFile([{ line: 40, offset: 0x8100 }]) } as any,
      },
      // a project window named span.rs must not capture the module's lines
      findWindowWithFilePrefix: (fn) => fn.startsWith('rs8/gfx/span') ? 'span.rs' : fn,
      headerWindowFor: (fn) => fn.startsWith('rs8/') ? '#headerview/' + fn.substring(4) : null,
      isWindow: (id) => id != 'span.rs',
    });
    const loc = findListingLocation(0x8102, ctx, LOOKAHEAD);
    assert.deepStrictEqual(loc, { wndid: '#headerview/gfx/span.rs', line: 40 });
    assert.strictEqual(findListingLocation(0x8001, ctx, LOOKAHEAD).wndid, 'main.rs');
  });

  it('prefers the assembly listing over the source file when both are present', function () {
    const ctx = makeContext({
      listings: {
        'game.c.lst': {
          lines: [],
          sourcefile: makeFile([{ line: 1, offset: 0x10 }]),
          assemblyfile: makeFile([{ line: 7, offset: 0x10 }]),
        } as any,
      },
      filename2path: { 'game.c.lst': 'game.c.lst' },
    });
    const loc = findListingLocation(0x10, ctx, LOOKAHEAD);
    assert.ok(loc);
    assert.strictEqual(loc.wndid, 'game.c.lst'); // resolved via filename2path, not findWindowWithFilePrefix
    assert.strictEqual(loc.line, 7);
  });

  it('skips a listing whose window is not known', function () {
    const ctx = makeContext({
      listings: {
        'unknown.c.lst': { lines: [], sourcefile: makeFile([{ line: 1, offset: 0x10 }]) } as any,
      },
      isWindow: () => false,
    });
    assert.strictEqual(findListingLocation(0x10, ctx, LOOKAHEAD), null);
  });

  it('picks the closest match among several listings', function () {
    const ctx = makeContext({
      listings: {
        'far.c.lst': { lines: [], sourcefile: makeFile([{ line: 1, offset: 0x00 }]) } as any,
        'near.c.lst': { lines: [], sourcefile: makeFile([{ line: 1, offset: 0x0e }]) } as any,
      },
    });
    // pc=0x10: 'near' (offset 0x0e, score 2) beats 'far' (offset 0x00, score 16)
    const loc = findListingLocation(0x10, ctx, LOOKAHEAD);
    assert.ok(loc);
    assert.strictEqual(loc.wndid, 'near.c');
  });

  it('finds the line closely preceding the PC when there is no exact match', function () {
    const ctx = makeContext({
      listings: {
        'game.c.lst': { lines: [], sourcefile: makeFile([{ line: 5, offset: 0x100 }]) } as any,
      },
    });
    const loc = findListingLocation(0x103, ctx, LOOKAHEAD);
    assert.ok(loc);
    assert.strictEqual(loc.line, 5);
  });

  it('does not look further behind the PC than the given lookahead', function () {
    const ctx = makeContext({
      listings: {
        'game.c.lst': { lines: [], sourcefile: makeFile([{ line: 5, offset: 0x100 }]) } as any,
      },
    });
    assert.strictEqual(findListingLocation(0x100 + 5, ctx, 4), null);
  });

  it('falls back to disassembly for library code past the end of a function', function () {
    // main() ends at $865; _cgetc follows at $868 and has no source line.
    // Without symbol boundaries the PC at $868 would wrongly match main's
    // last line (only 3 bytes behind) instead of the disassembly.
    const ctx = makeContext({
      listings: {
        'game.c.lst': { lines: [], sourcefile: makeFile([{ line: 15, offset: 0x865 }]) } as any,
      },
      symbolAddrs: [0x800, 0x840, 0x868],
    });
    assert.strictEqual(findListingLocation(0x868, ctx, LOOKAHEAD), null);
    assert.strictEqual(findListingLocation(0x880, ctx, LOOKAHEAD), null);
    // ...but the call site itself still maps to its source line
    const call = findListingLocation(0x865, ctx, LOOKAHEAD);
    assert.ok(call);
    assert.strictEqual(call.line, 15);
  });

  it('maps a function prologue to that function\'s first listed line', function () {
    // prev() ends at $800; main() starts at $840 with its first listed line at
    // $845 (prologue unlisted). A PC in main's prologue must not show prev()'s line.
    const ctx = makeContext({
      listings: {
        'game.c.lst': {
          lines: [],
          sourcefile: makeFile([{ line: 4, offset: 0x800 }, { line: 5, offset: 0x845 }]),
        } as any,
      },
      symbolAddrs: [0x800, 0x840, 0x900],
    });
    const loc = findListingLocation(0x843, ctx, LOOKAHEAD);
    assert.ok(loc);
    assert.strictEqual(loc.line, 5);
  });

});
