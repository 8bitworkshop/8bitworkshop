import assert from "assert";
import { describe, it } from "mocha";
import { CodeProject } from "../../src/ide/project";

// oscar64 compiles the main file and its "//#link" sources in one invocation,
// so it emits a single .asm listing that mixes source lines from every file,
// each tagged with its own path. The editor and source breakpoints look up
// the listing for a given file, so each file must get a SourceFile holding
// only its own lines -- otherwise the linked files get no line info at all.
function makeProject(mainPath: string): CodeProject {
    const proj = new CodeProject({} as any, 'c64', {} as any, { onFileSystemUpdate: () => {} } as any);
    proj.mainPath = mainPath;
    return proj;
}

function mixedListing() {
    return {
        'main.lst': {
            lines: [
                { line: 1, path: 'main.cpp', offset: 0x100, iscode: true },
                { line: 2, path: 'main.cpp', offset: 0x102, iscode: true },
                { line: 5, path: 'lib.c', offset: 0x200, iscode: true },
                { line: 6, path: 'lib.c', offset: 0x205, iscode: true },
            ],
            asmlines: [
                { line: 1, path: 'main.cpp', offset: 0x100, insns: 'a9 00 LDA #$00', iscode: true },
            ],
            text: 'main.lst text',
        },
    };
}

describe('CodeProject.getListingForFile', function () {

    it('returns only the main file lines for the main file', function () {
        const proj = makeProject('presets/c64/main.cpp');
        proj.processBuildListings({ listings: mixedListing() } as any);
        const lst = proj.getListingForFile('presets/c64/main.cpp');
        assert.ok(lst, 'expected a listing for the main file');
        assert.ok(lst.sourcefile, 'expected a sourcefile for the main file');
        assert.deepStrictEqual(lst.sourcefile.lines.map(l => l.line), [1, 2]);
        assert.strictEqual(lst.sourcefile.line2offset.get(2), 0x102);
    });

    it('returns the linked file lines for a linked file', function () {
        const proj = makeProject('presets/c64/main.cpp');
        proj.processBuildListings({ listings: mixedListing() } as any);
        const lst = proj.getListingForFile('presets/c64/lib.c');
        assert.ok(lst, 'expected a listing for the linked file');
        assert.ok(lst.sourcefile, 'expected a sourcefile for the linked file');
        assert.deepStrictEqual(lst.sourcefile.lines.map(l => l.line), [5, 6]);
        assert.strictEqual(lst.sourcefile.line2offset.get(5), 0x200);
    });

    // the read-only header view asks for the listing of a library module
    // (urust keys its listings by the module's path)
    it('finds the listing for a library module opened in the header view', function () {
        const proj = makeProject('main.rs');
        proj.processBuildListings({ listings: {
            'main.rs': { lines: [{ line: 3, path: 'main.rs', offset: 0xc000, iscode: true }] },
            'rs8/nes/util.rs': { lines: [{ line: 70, path: 'rs8/nes/util.rs', offset: 0xc100, iscode: true }] },
        } } as any);
        const lst = proj.getListingForFile('rs8/nes/util.rs');
        assert.strictEqual(lst.sourcefile.line2offset.get(70), 0xc100);
        assert.strictEqual(proj.getListingForFile('rs8/nes/nothing.rs'), undefined);
        // the header view names it relative to the shared filesystem's /rs8
        assert.strictEqual(proj.getListingForFile('nes/util.rs')?.sourcefile.line2offset.get(70), 0xc100);
    });

    // rs8/console.rs and rs8/apple2/console.rs share a filename
    it('tells library modules with the same filename apart', function () {
        const proj = makeProject('main.rs');
        proj.processBuildListings({ listings: {
            'rs8/console.rs': { lines: [{ line: 1, path: 'rs8/console.rs', offset: 0xc000, iscode: true }] },
            'rs8/apple2/console.rs': { lines: [{ line: 1, path: 'rs8/apple2/console.rs', offset: 0xc200, iscode: true }] },
        } } as any);
        assert.strictEqual(proj.getListingForFile('console.rs')?.sourcefile.line2offset.get(1), 0xc000);
        assert.strictEqual(proj.getListingForFile('apple2/console.rs')?.sourcefile.line2offset.get(1), 0xc200);
    });

});
