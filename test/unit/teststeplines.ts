import assert from "assert";
import { describe, it } from "mocha";
import { processListings, sourceLineStartPCs } from "../../src/common/projectcore";

describe('sourceLineStartPCs', function () {
  it('keeps one start PC per run of entries on the same line (urust emits one per expression)', function () {
    const mk = (line: number, offset: number) => ({ line, offset, path: 'a.rs', iscode: true });
    const listings: any = { 'a.rs': { lines: [mk(1, 0x800), mk(1, 0x803), mk(1, 0x806), mk(2, 0x809), mk(2, 0x80b), mk(1, 0x80d)] } };
    processListings(listings);
    assert.deepStrictEqual([...sourceLineStartPCs(listings)].sort(), [0x800, 0x809, 0x80d]);
  });
});
