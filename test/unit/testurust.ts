import assert from "assert";
import * as fs from "fs";
import * as path from "path";
import JSZip from "jszip";
import { describe, it } from "mocha";
import { getIncludeDirs, getIncludePatterns, getSharedFileSystemName, matchDependencyPatterns } from "../../src/common/toolmeta";
import { getToolForPlatform } from "../../src/common/toolselect";
import { toolRoot } from "../../src/tools/toolroot";
import {
  parseUrustDiagnostics, urustDebugToResult, urustPlatformName, UrustDebug
} from "../../src/worker/tools/urustparse";

describe('urust tool', function () {
  it('is selected by .rs on 6502 platforms', function () {
    assert.strictEqual(getToolForPlatform('devel-6502', 'main.rs'), 'urust');
    assert.strictEqual(getToolForPlatform('nes', 'game.rs'), 'urust');
  });

  it('scans include_bytes!/include_str! as dependencies', function () {
    const src = 'static A: &[u8] = &*include_bytes!("art/a.bin");\n' +
      'const S: &str = include_str!( "t.txt" );\n// include_bytes!("x") is also matched\n';
    const deps = matchDependencyPatterns(src, getIncludePatterns('urust'));
    assert.deepStrictEqual(deps, ['art/a.bin', 't.txt', 'x']);
  });

  it('scans //#resource files as dependencies', function () {
    const src = '//#resource "vicdual.toml"\n//#flag c --board vicdual.toml\nfn main() {}\n';
    assert.deepStrictEqual(matchDependencyPatterns(src, getIncludePatterns('urust')), ['vicdual.toml']);
  });

  it('scans mod/use as module dependencies', function () {
    const src = 'mod audio;\npub mod bcd;\n' +
      'use audio::{music_play, SND_COIN};\nuse bcd::bcd_add;\nuse rs8::reset;\n';
    const deps = matchDependencyPatterns(src, getIncludePatterns('urust'));
    // `mod` names the file (foo.rs or foo/mod.rs); `use` is scanned for editor
    // links but skips the bare rs8 items (they live in the compiler)
    assert.deepStrictEqual(deps,
      ['audio.rs', 'bcd.rs', 'audio/mod.rs', 'bcd/mod.rs', 'audio.rs', 'bcd.rs']);
  });

  it('links rs8 register modules to the bundled sources', function () {
    const src = 'use rs8::nes::*;\nuse rs8::io;\nuse rs8::{reg, reset};\n';
    const deps = matchDependencyPatterns(src, getIncludePatterns('urust'));
    // one file per register module; bare items (reg/reset) have no file
    assert.deepStrictEqual(deps, ['nes.rs', 'io.rs']);
  });

  it('links every platform module urust bundles', function () {
    const src = 'use rs8::apple2::*;\nuse rs8::vic20::*;\nuse rs8::zx::*;\n';
    assert.deepStrictEqual(matchDependencyPatterns(src, getIncludePatterns('urust')),
      ['apple2.rs', 'vic20.rs', 'zx.rs']);
  });

  it('exposes the rs8 sources as a WASI filesystem for the editor', function () {
    assert.strictEqual(getSharedFileSystemName('urust', 'devel-6502'), 'wasi:urust-fs.zip');
    assert.deepStrictEqual(getIncludeDirs('urust', 'devel-6502'), ['/rs8']);
  });

  it('ships the rs8 module sources in the WASI filesystem package', async function () {
    // the package is built outside the repo, so it may not be here
    const zipfile = path.resolve(toolRoot(), 'src/worker/fs/urust-fs.zip');
    if (!fs.existsSync(zipfile)) return this.skip();
    // /rs8/<module>.rs has to resolve for every module the include pattern links
    const zip = await JSZip.loadAsync(fs.readFileSync(zipfile));
    for (const f of ['lib.rs', 'apple2.rs', 'atari8.rs', 'c64.rs', 'conio.rs', 'io.rs', 'nes.rs', 'rand.rs', 'vcs.rs', 'vic20.rs', 'zx.rs']) {
      assert.ok(zip.file('rs8/' + f), 'missing rs8/' + f);
    }
  });

  it('maps platform ids to urust platforms', function () {
    assert.strictEqual(urustPlatformName('devel-6502'), 'devel-6502');
    assert.strictEqual(urustPlatformName('nes'), 'nes');
    assert.strictEqual(urustPlatformName('c64'), 'c64');
    assert.strictEqual(urustPlatformName('atari8-800xl'), 'atari8');
    assert.strictEqual(urustPlatformName('vcs'), 'vcs');
    assert.strictEqual(urustPlatformName('apple2'), 'apple2');
    assert.strictEqual(urustPlatformName('vic20'), 'vic20');
    // the Z80 backend names the whole computer, not the CPU
    assert.strictEqual(urustPlatformName('zx'), 'zx-spectrum');
  });

  it('parses JSON diagnostics; end column only on a single line', function () {
    const json = JSON.stringify([
      { level: 'error', message: 'bad type', file: 'main.rs', line: 2, col: 5, endLine: 2, endCol: 9 },
      { level: 'error', message: 'spans lines', file: 'main.rs', line: 4, col: 1, endLine: 6, endCol: 2 },
      { level: 'warning', message: 'in `f`: big', file: null, line: 0, col: 0, endLine: 0, endCol: 0 },
    ]);
    const { errors, warnings } = parseUrustDiagnostics(json + '\nurust: unknown option `-x`\n', 'main.rs');
    assert.deepStrictEqual(errors[0], { line: 2, path: 'main.rs', msg: 'bad type', start: 4, end: 8 });
    assert.deepStrictEqual(errors[1], { line: 4, path: 'main.rs', msg: 'spans lines', start: 0 });
    assert.deepStrictEqual(errors[2], { line: 0, path: 'main.rs', msg: 'unknown option `-x`' });
    assert.deepStrictEqual(warnings, [{ line: 0, path: 'main.rs', msg: 'in `f`: big', severity: 'warning' }]);
  });

  const dbg: UrustDebug = {
    files: ['main.rs'],
    symbols: [
      { name: 'main', addr: 0x8000, size: 20, kind: 'code', bank: null, ram: false },
      { name: 'score', addr: 0x10, size: 2, kind: 'data', bank: null, ram: true },
      { name: 'NMI', addr: 0x8100, size: 0, kind: 'code', bank: null, ram: false },
    ],
    lines: [
      { addr: 0x8000, size: 3, bank: null, file: 'main.rs', line: 3, col: 5, endLine: 3, endCol: 12, func: 'main' },
      { addr: 0x8003, size: 2, bank: null, file: 'main.rs', line: 3, col: 5, endLine: 4, endCol: 2, func: null },
    ],
    segments: [
      { name: 'ROM', start: 0x8000, size: 20, bank: null, type: 'rom' },
      { name: 'RAM', start: 0, size: 0x800, bank: null, type: 'ram' },
    ],
    variables: [
      { name: 'score', type: 'u16', size: 2, function: 'main', addr: 0x10, range: [0x8000, 0x8014], codeBank: null, file: 'main.rs', line: 1, col: 1 },
    ],
  };

  it('converts debug info for the debugger and memory map', function () {
    const r = urustDebugToResult(dbg, ['main.rs']);
    assert.deepStrictEqual(r.listings['main.rs'].lines[0],
      { line: 3, offset: 0x8000, path: 'main.rs', start: 4, end: 11, iscode: true, func: 'main' });
    assert.strictEqual('end' in r.listings['main.rs'].lines[1], false);
    assert.deepStrictEqual(r.symbolmap, { main: 0x8000, score: 0x10, NMI: 0x8100 });
    assert.deepStrictEqual(r.symbolsizes, { main: 20, score: 2 });
    assert.strictEqual(r.segments[1].type, 'ram');
    assert.strictEqual(r.banked, false);
    assert.deepStrictEqual(r.variables, dbg.variables);
    assert.deepStrictEqual(r.debuginfo.sourceVariables, dbg.variables);
  });

  it('flags banked output', function () {
    const banked = { ...dbg, lines: [{ ...dbg.lines[0], bank: 2 }] };
    assert.strictEqual(urustDebugToResult(banked, ['main.rs']).banked, true);
  });
});
