/**
 * findListingLocation - given a PC value, finds the best known source (or
 * assembly-listing) window and line to show it at. Used both to follow the
 * live PC while debugging and to jump to a specific address on demand (e.g.
 * clicking a symbol/address breakpoint).
 *
 * Kept free of DOM / ui.ts dependencies so it can be unit tested.
 */

import { lastAtOrBefore } from "../../common/util";
import { CodeListingMap } from "../../common/workertypes";

export interface ListingLocationContext {
  listings: CodeListingMap;
  filename2path: { [key: string]: string };
  // "known window id" (registered), not "currently open" -- see ProjectWindows.isWindow
  isWindow: (id: string) => boolean;
  findWindowWithFilePrefix: (filename: string) => string | null;
  // a read-only window for a listing whose source is not a project file (a
  // urust rs8 module), registering it if need be; null if there is none
  headerWindowFor?: (listingPath: string) => string | null;
  // sorted symbol addresses: a PC inside a library routine (which has no
  // listing) must not fall back to the last line of the routine before it
  symbolAddrs?: number[];
}

export interface ListingLocation {
  wndid: string;
  line: number;
}

/** Find the best known listing window + source line for a PC value.
 * `lookahead` should match the caller's PC_LINE_LOOKAHEAD constant. */
export function findListingLocation(pc: number, ctx: ListingLocationContext, lookahead: number): ListingLocation | null {
  let bestid: string = null;
  let bestscore = 256;
  let bestline = 0;
  const listings = ctx.listings;
  const fnStart = ctx.symbolAddrs ? lastAtOrBefore(ctx.symbolAddrs, pc) : null;
  if (listings) {
    for (let lstfn in listings) {
      let lst = listings[lstfn];
      let file = lst.assemblyfile || lst.sourcefile;
      // pick either listing or source file
      let wndid = ctx.filename2path[lstfn] || lstfn;
      if (file == lst.sourcefile) {
        // checked first: a prefix match would take rs8/gfx/span.rs for any
        // project file named span.rs
        wndid = (ctx.headerWindowFor && ctx.headerWindowFor(lstfn)) || ctx.findWindowWithFilePrefix(lstfn);
      }
      // does this window exist?
      if (wndid && ctx.isWindow(wndid)) {
        // find the source line at the PC or closely before it. A null result
        // (PC in a routine this listing doesn't cover) falls through to the
        // disassembly view.
        let srcline1 = file && file.findLineForOffset(pc, lookahead, fnStart);
        if (srcline1) {
          let score = Math.abs(pc - srcline1.offset);
          if (score < bestscore) {
            bestid = wndid;
            bestscore = score;
            bestline = srcline1.line;
          }
        }
      }
    }
  }
  return bestid ? { wndid: bestid, line: bestline } : null;
}
