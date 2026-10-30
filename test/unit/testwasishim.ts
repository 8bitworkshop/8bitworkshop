import assert from "assert";
import { WASIRunner, WASIMemoryFilesystem, WASIErrors, FDOpenFlags, normalizeWASIPath } from "../../src/common/wasi/wasishim";
import * as fs from "fs";
import { loadWASIFilesystemZip, unzipWASIFilesystem } from "../../src/worker/wasiutils";
import { parseOscar64Dbj, parseOscar64Listing, parseOscar64Lbl, parseOscar64Map } from "../../src/worker/tools/oscar64parse";

async function loadWASM(filename: string) {
    const wasmdata = fs.readFileSync(`./src/worker/wasm/${filename}.wasm`);
    let shim = new WASIRunner();
    await shim.loadAsync(wasmdata);
    return shim;
}

async function loadDASM() {
    return loadWASM('dasm-wasisdk');
}
async function loadCC7800() {
    return loadWASM('cc7800');
}
async function loadOscar64() {
    return loadWASM('oscar64');
}

describe('test WASI DASM', function () {
    it('dasm help', async function () {
        let shim = await loadDASM();
        let errno = shim.run();
        assert.strictEqual(errno, 1);
    });
    it('dasm file not found', async function () {
        let shim = await loadDASM();
        shim.setArgs(["dasm", "file_not_found.asm"]);
        let errno = shim.run();
        assert.strictEqual(errno, 2);
    });
    it('dasm file not found 2', async function () {
        let shim = await loadDASM();
        shim.setArgs(["dasm", "/file.asm", "-d"]);
        let errno = shim.run();
        assert.strictEqual(errno, 2);
    });
    it('dasm bad args 1', async function () {
        let shim = await loadDASM();
        shim.setArgs(["dasm", "file_not_found.asm", "extra_arg.asm"]);
        let errno = shim.run();
        assert.strictEqual(errno, 1);
    });
    it('dasm bad args 2', async function () {
        let shim = await loadDASM();
        shim.setArgs(["dasm", "file_not_found.asm", "-E9"]);
        let errno = shim.run();
        assert.strictEqual(errno, 1);
    });
    it('dasm empty file', async function () {
        let shim = await loadDASM();
        shim.setArgs(["dasm", "empty.asm"]);
        shim.addPreopenDirectory("/root");
        shim.fs.putFile("/root/empty.asm", "");
        let errno = shim.run();
        assert.strictEqual(errno, 0);
    });
    it('dasm small file', async function () {
        let shim = await loadDASM();
        shim.setArgs(["dasm", "empty.asm"]);
        shim.addPreopenDirectory("/root");
        shim.fs.putFile("/root/empty.asm", " processor 6502\n org $100\n nop");
        let errno = shim.run();
        assert.strictEqual(errno, 0);
        let aout = shim.fs.getFile("/root/a.out");
        assert.deepStrictEqual(Array.from(aout.getBytes()), [0x00, 0x01, 0xea]);
    });
});

describe('test WASI cc7800', function () {
    it('cc7800 help', async function () {
        let shim = await loadCC7800();
        shim.setArgs(["cc7800", '-h']);
        let errno = shim.run();
        assert.strictEqual(errno, 0);
        const stdout = shim.fds[1].getBytesAsString();
        console.log(stdout);
        assert.ok(stdout.indexOf('Usage: cc7800') >= 0);
    });
});

describe('test WASI dialogc', function () {
    async function loadDialogc() {
        let shim = await loadWASM('dialogc');
        const zipdata = fs.readFileSync(`./src/worker/fs/dialog-fs.zip`);
        shim.fs.setParent(await unzipWASIFilesystem(zipdata as any, "./"));
        shim.addPreopenDirectory(".");
        return shim;
    }
    it('dialogc compile', async function () {
        let shim = await loadDialogc();
        const src = fs.readFileSync('./presets/zmachine/hello.dg', 'utf8');
        shim.fs.putFile("./hello.dg", src);
        shim.setArgs(["dialogc", "-t", "z8", "-o", "hello.z8", "hello.dg", "stdlib.dg"]);
        let errno = shim.run();
        assert.strictEqual(shim.fds[2].getBytesAsString(), "");
        assert.strictEqual(errno, 0);
        const zfile = shim.fs.getFile("./hello.z8").getBytes();
        assert.ok(zfile.length > 1000);
        assert.strictEqual(zfile[0], 8); // z-machine version 8
    });
    it('dialogc syntax error', async function () {
        let shim = await loadDialogc();
        shim.fs.putFile("./bad.dg", "(room #room)\n(current player #player\n");
        shim.setArgs(["dialogc", "-t", "z8", "-o", "bad.z8", "bad.dg", "stdlib.dg"]);
        let errno = shim.run();
        assert.strictEqual(errno, 1);
        const stderr = shim.fds[2].getBytesAsString();
        assert.ok(stderr.indexOf('Error: bad.dg, line ') >= 0, stderr);
    });
    it('dialogc missing source file', async function () {
        let shim = await loadDialogc();
        shim.setArgs(["dialogc", "-t", "z8", "-o", "x.z8", "nosuch.dg", "stdlib.dg"]);
        let errno = shim.run();
        assert.strictEqual(errno, 1);
        const stderr = shim.fds[2].getBytesAsString();
        assert.ok(stderr.indexOf('Error: Failed to open "nosuch.dg"') >= 0, stderr);
    });
});

describe('test WASI oscar64', function () {
    it('oscar64 compile + parse output', async function () {
        let shim = await loadOscar64();
        const zipdata = fs.readFileSync(`./src/worker/fs/oscar64-fs.zip`);
        let oscar64_fs = await unzipWASIFilesystem(zipdata, "./");
        shim.fs.setParent(oscar64_fs);
        shim.fs.putFile("./main.c", `#include <stdio.h>\nint main() { unsigned char x = 42; printf("FOO%d", x); return 0; }`);
        shim.addPreopenDirectory("include");
        shim.addPreopenDirectory(".");
        shim.setArgs(["oscar64", '-v', '-O0', '-gp', '-ii=include', '-o=./foo.prg', 'main.c']);
        let errno = shim.run();
        const stdout = shim.fds[1].getBytesAsString();
        const stderr = shim.fds[2].getBytesAsString();
        assert.strictEqual(errno, 0, stdout + '\n' + stderr);
        assert.ok(stdout.indexOf('Starting oscar64') >= 0, stdout);
        // oscar64 should have written a .map, .lbl and .asm file
        assert.ok(shim.fs.getFile("./foo.prg"), "foo.prg not written");
        assert.ok(shim.fs.getFile("./foo.map"), "foo.map not written");
        assert.ok(shim.fs.getFile("./foo.lbl"), "foo.lbl not written");
        assert.ok(shim.fs.getFile("./foo.asm"), "foo.asm not written");
        assert.ok(shim.fs.getFile("./foo.dbj"), "foo.dbj not written");
        // parse the map file for segments and symbols
        let mapout = shim.fs.getFile("./foo.map").getBytesAsString();
        let parsed = parseOscar64Map(mapout);
        assert.ok(parsed.segments.length > 0);
        assert.ok(parsed.symbolmap['main'] > 0);
        // parse the lbl file
        let lblout = shim.fs.getFile("./foo.lbl").getBytesAsString();
        let lbl = parseOscar64Lbl(lblout);
        assert.ok(lbl['main'] === parsed.symbolmap['main']);
        // parse the asm listing
        let asmout = shim.fs.getFile("./foo.asm").getBytesAsString();
        let listing = parseOscar64Listing(asmout, 'main.c');
        assert.ok(listing.asmlines.length > 0);
        assert.ok(listing.srclines.length > 0);
        assert.ok(listing.srclines[0].offset > 0);
        // parse the source-level debug JSON
        let dbjout = shim.fs.getFile("./foo.dbj").getBytesAsString();
        let dbj = parseOscar64Dbj(dbjout);
        assert.ok(dbj.sourceVariables.some(v => v.name == 'x'), JSON.stringify(dbj.sourceVariables));
    });
});

describe('WASIMemoryFilesystem path handling', function () {
    it('normalizes paths', function () {
        assert.strictEqual(normalizeWASIPath('././foo.prg'), 'foo.prg');
        assert.strictEqual(normalizeWASIPath('dir/./sub//file'), 'dir/sub/file');
        assert.strictEqual(normalizeWASIPath('/root/../root/a.asm'), '/root/a.asm');
        assert.strictEqual(normalizeWASIPath('.'), '.');
        assert.strictEqual(normalizeWASIPath('/'), '/');
    });
    it('reports a missing file as NOENT, not NOSYS', function () {
        const wasi = new WASIRunner();
        assert.strictEqual(wasi.openFile('./missing.bin', 0), WASIErrors.NOENT);
        wasi.fs.putFile('./plain.bin', 'x');
        assert.strictEqual(wasi.openFile('./plain.bin', FDOpenFlags.DIRECTORY), WASIErrors.NOTDIR);
    });
    it('finds files written with a different leading ./ depth', function () {
        const fsys = new WASIMemoryFilesystem();
        fsys.putFile('././main.map', 'map');
        assert.strictEqual(fsys.getFile('./main.map').getBytesAsString(), 'map');
        assert.strictEqual(fsys.getFile('main.map').getBytesAsString(), 'map');
    });
    it('removes files but not directories', function () {
        const fsys = new WASIMemoryFilesystem();
        fsys.putFile('./a.bin', 'x');
        fsys.putDirectory('./sub');
        assert.strictEqual(fsys.removeFile('./sub'), WASIErrors.ISDIR);
        assert.strictEqual(fsys.removeDirectory('./a.bin'), WASIErrors.NOTDIR);
        assert.strictEqual(fsys.removeFile('./a.bin'), WASIErrors.SUCCESS);
        assert.strictEqual(fsys.removeFile('./a.bin'), WASIErrors.NOENT);
    });
    it('removes only empty directories', function () {
        const fsys = new WASIMemoryFilesystem();
        fsys.putDirectory('./sub');
        fsys.putFile('./sub/a.bin', 'x');
        assert.strictEqual(fsys.removeDirectory('./sub'), WASIErrors.NOTEMPTY);
        assert.strictEqual(fsys.removeFile('./sub/a.bin'), WASIErrors.SUCCESS);
        assert.strictEqual(fsys.removeDirectory('./sub'), WASIErrors.SUCCESS);
        assert.strictEqual(fsys.removeDirectory('/'), WASIErrors.BUSY);
    });
    it('renames files, replacing the target', function () {
        const fsys = new WASIMemoryFilesystem();
        fsys.putFile('./a.tmp', 'new');
        fsys.putFile('./a.s', 'old');
        fsys.putDirectory('./sub');
        assert.strictEqual(fsys.renameFile('./a.tmp', './a.s'), WASIErrors.SUCCESS);
        assert.strictEqual(fsys.getFile('./a.s').getBytesAsString(), 'new');
        assert.strictEqual(fsys.getFile('./a.tmp'), undefined);
        assert.strictEqual(fsys.renameFile('./a.tmp', './b.s'), WASIErrors.NOENT);
        assert.strictEqual(fsys.renameFile('./a.s', './sub'), WASIErrors.ISDIR);
    });
    it('deletes only from the writable layer, not the parent', function () {
        const parent = new WASIMemoryFilesystem();
        parent.putFile('./shared.h', 'shared');
        const child = new WASIMemoryFilesystem();
        child.setParent(parent);
        // a parent file is visible but not deletable from the child layer
        assert.ok(child.getFile('./shared.h'));
        assert.strictEqual(child.removeFile('./shared.h'), WASIErrors.NOENT);
        assert.ok(parent.getFile('./shared.h'));
    });
});
