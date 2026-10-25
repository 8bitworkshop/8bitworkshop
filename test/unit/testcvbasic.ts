import assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { describe, it } from "mocha";
import { WASIRunner } from "../../src/common/wasi/wasishim";
import { getSharedFileSystemName } from "../../src/common/toolmeta";
import { getToolForPlatform } from "../../src/common/toolselect";
import { toolRoot } from "../../src/tools/toolroot";
import { unzipWASIFilesystem } from "../../src/worker/wasiutils";
import {
  cvbasicTarget, findProgramEndLine, mapAsmLinesToBasic, parseCVBasicDiagnostics, parseCVBasicListing,
  parseGasm80Diagnostics, parseGasm80ListingLine, parseGasm80Symbols
} from "../../src/worker/tools/cvbasic";

function toolFile(...parts: string[]): string {
  return path.join(toolRoot(), ...parts);
}

describe('CVBasic tool', function () {

  it('is selected by .bas on the platforms it targets', function () {
    assert.strictEqual(getToolForPlatform('coleco', 'game.bas'), 'cvbasic');
    assert.strictEqual(getToolForPlatform('coleco.mame', 'game.bas'), 'cvbasic');
    assert.strictEqual(getToolForPlatform('msx', 'game.bas'), 'cvbasic');
    assert.strictEqual(getToolForPlatform('sms-sg1000-libcv', 'game.bas'), 'cvbasic');
    assert.strictEqual(getToolForPlatform('sms-sms-libcv', 'game.bas'), 'cvbasic');
    assert.strictEqual(getToolForPlatform('nes', 'game.bas'), 'cvbasic');
    // other sources keep their tools
    assert.strictEqual(getToolForPlatform('coleco', 'game.c'), 'sdcc');
    assert.strictEqual(getToolForPlatform('nes', 'game.c'), 'cc65');
  });

  it('maps platforms to CVBasic console flags and ROM extensions', function () {
    assert.deepStrictEqual(cvbasicTarget('coleco'), { console: [], romExt: '.rom', sms: false });
    assert.deepStrictEqual(cvbasicTarget('msx'), { console: ['--msx'], romExt: '.rom', sms: false });
    assert.deepStrictEqual(cvbasicTarget('sms-sg1000-libcv'), { console: ['--sg1000'], romExt: '.sg', sms: false });
    assert.deepStrictEqual(cvbasicTarget('sms-sms-libcv'), { console: ['--sms'], romExt: '.sms', sms: true });
    assert.deepStrictEqual(cvbasicTarget('nes'), { console: ['--nes'], romExt: '.nes', sms: false });
    assert.strictEqual(cvbasicTarget('gb'), null);
  });

  it('ships the prologue/epilogue files as a WASI filesystem', function () {
    assert.strictEqual(getSharedFileSystemName('cvbasic', 'coleco'), 'wasi:cvbasic-fs.zip');
  });

  it('maps assembly lines back to BASIC source lines', function () {
    const source = "\tPRINT AT 0,\"HI\"\n\tPRINT AT 0,\"HI\"\n\tGOTO again\n";
    const asm = [
      "\t; CVBasic prologue",
      "\tLD A,1",
      "\t; CVBasic program start.",
      "\t; \tPRINT AT 0,\"HI\"",
      "\tLD HL,0",
      "\t; \tPRINT AT 0,\"HI\"",
      "\tLD HL,0",
      "\t; \tGOTO again",
      "\tJP again",
    ].join("\n");
    const map = mapAsmLinesToBasic(asm, source);
    // the prologue is not mapped; repeated statements advance in order
    assert.strictEqual(map.size, 3);
    assert.strictEqual(map.get(4), 1);
    assert.strictEqual(map.get(6), 2);
    assert.strictEqual(map.get(8), 3);
  });

  it('maps assembly lines even without the "program start" marker (NES/6502)', function () {
    const asm = "\tLD A,1\n\t; \tPRINT \"HI\"\n\tJSR print\n";
    const map = mapAsmLinesToBasic(asm, "\tPRINT \"HI\"\n");
    assert.strictEqual(map.get(2), 1);
  });

  it('parses gasm80 listing lines at their fixed columns', function () {
    assert.deepStrictEqual(parseGasm80ListingLine('8000  55AA              00136 \tDB $55,$AA'),
      { address: 0x8000, insns: '55AA', line: 136 });
    assert.deepStrictEqual(parseGasm80ListingLine('858E                    04622 \t; comment'),
      { address: 0x858E, insns: '', line: 4622 });
    assert.deepStrictEqual(parseGasm80ListingLine('859E  48454C4C4F204356  04630 \tDB $48,$45'),
      { address: 0x859e, insns: '48454C4C4F204356', line: 4630 });
    assert.strictEqual(parseGasm80ListingLine('not a listing line'), null);
    assert.strictEqual(parseGasm80ListingLine(''), null);
  });

  it('builds BASIC source lines from a gasm80 listing', function () {
    const lst = [
      '8000                    00010 \tORG $8000',
      '8000  3E01              00011 \tLD A,1',
      '8002  210000            00012 \tLD HL,0',
      '8005                    00013 \t; \tPRINT AT 0',
      '8005  3E00              00014 \tLD A,0',
      '8007  C9                00015 \tRET',
    ].join('\n');
    const map = new Map<number, number>([[13, 4], [14, 4], [15, 5]]);
    assert.deepStrictEqual(parseCVBasicListing(lst, map), [
      { line: 4, offset: 0x8005, insns: '3E00', iscode: true },
      { line: 5, offset: 0x8007, insns: 'C9', iscode: true },
    ]);
  });

  it('stops the source listing at the epilogue', function () {
    const asm = "\t; CVBasic program start.\n\tLD A,1\nrom_end:\n\ttimes $fffa-$ db $ff\n";
    const endline = findProgramEndLine(asm);
    assert.strictEqual(endline, 3);
    const lst = [
      '8000  3E01              00002 \tLD A,1',
      '8002                    00003 rom_end:',
      '8002                    00004 \ttimes $fffa-$ db $ff',
      '0000                    00007 VAR: \trb 1',
    ].join('\n');
    const map = new Map<number, number>([[2, 1], [4, 1], [7, 1]]);
    assert.deepStrictEqual(parseCVBasicListing(lst, map, endline),
      [{ line: 1, offset: 0x8000, insns: '3E01', iscode: true }]);
    assert.strictEqual(findProgramEndLine("\tLD A,1\n"), Infinity);
  });

  it('parses CVBasic diagnostics', function () {
    const errors = [];
    parseCVBasicDiagnostics([
      'CVBasic compiler v0.9.2',
      'ERROR: missing THEN in IF at line 22 (game.bas)',
      'Warning: variable \'x\' read but never assigned at line 7 (game.bas)',
      'INFO: compiling main program at line 1 (game.bas)',
      'Error: PROCEDURE \'foo\' jumped in by GOTO',
      '8 RAM bytes used of 814 bytes available.',
    ].join('\n'), 'game.bas', errors);
    assert.deepStrictEqual(errors, [
      { line: 22, path: 'game.bas', msg: 'missing THEN in IF' },
      { line: 7, path: 'game.bas', msg: "variable 'x' read but never assigned", severity: 'warning' },
      { line: 0, path: 'game.bas', msg: "PROCEDURE 'foo' jumped in by GOTO" },
    ]);
  });

  it('maps gasm80 diagnostics onto BASIC lines', function () {
    const errors = [];
    const map = new Map<number, number>([[42, 9]]);
    parseGasm80Diagnostics([
      "Error: undefined label 'foo' at line 42",
      'Warning: something odd at line 99',
      'First time \'foo\' at line 42',
      'Error: cannot open \'x.asm\' for input',
    ].join('\n'), map, 'game.bas', errors);
    assert.deepStrictEqual(errors, [
      { line: 9, path: 'game.bas', msg: "undefined label 'foo'" },
      { line: 0, path: 'game.bas', msg: 'something odd', severity: 'warning' },
      { line: 0, path: 'game.bas', msg: "cannot open 'x.asm' for input" },
    ]);
  });

  it('parses gasm80 symbol files', function () {
    const sym = [
      'ARRAY_#SCORES: equ 00007094h',
      'START: equ 0000853dh',
      'COLECO: equ 00000001h',
      '',
    ].join('\n');
    assert.deepStrictEqual(parseGasm80Symbols(sym),
      { 'ARRAY_#SCORES': 0x7094, 'START': 0x853d, 'COLECO': 1 });
  });

  it('compiles and assembles a Coleco preset end-to-end', async function () {
    const cvwasm = toolFile('src/worker/wasm/cvbasic.wasm');
    const gwasm = toolFile('src/worker/wasm/gasm80.wasm');
    const fszip = toolFile('src/worker/fs/cvbasic-fs.zip');
    // the wasm builds live outside the repo, so they may not be here
    if (!fs.existsSync(cvwasm) || !fs.existsSync(gwasm) || !fs.existsSync(fszip)) return this.skip();

    const cvfs = await unzipWASIFilesystem(fs.readFileSync(fszip) as any, './');
    const cv = new WASIRunner();
    await cv.loadAsync(fs.readFileSync(cvwasm));
    cv.fs.setParent(cvfs);
    cv.addPreopenDirectory('.');
    const source = fs.readFileSync(toolFile('presets/coleco/hello.bas'), 'utf8');
    cv.fs.putFile('./main.bas', source);
    cv.setArgs(['cvbasic', 'main.bas', 'main.asm', 'share/cvbasic']);
    assert.strictEqual(cv.run(), 0, cv.fds[2].getBytesAsString());
    const asmtext = cv.fs.getFile('./main.asm').getBytesAsString();
    assert.ok(asmtext.indexOf('CVBasic prologue') >= 0, 'missing prologue');

    const g8 = new WASIRunner();
    await g8.loadAsync(fs.readFileSync(gwasm));
    g8.addPreopenDirectory('.');
    g8.fs.putFile('./main.asm', asmtext);
    g8.setArgs(['gasm80', 'main.asm', '-o', 'main.rom', '-l', 'main.lst', '-s', 'main.sym']);
    assert.strictEqual(g8.run(), 0, g8.fds[2].getBytesAsString());
    const rom = g8.fs.getFile('./main.rom').getBytes();
    assert.strictEqual(rom.length, 8192);
    assert.deepStrictEqual([rom[0], rom[1]], [0x55, 0xaa]); // Coleco cartridge header

    // the listing carries BASIC source line info for the debugger
    const map = mapAsmLinesToBasic(asmtext, source);
    const lines = parseCVBasicListing(g8.fs.getFile('./main.lst').getBytesAsString(), map,
      findProgramEndLine(asmtext));
    assert.ok(lines.length > 5, 'too few source lines: ' + lines.length);
    assert.ok(lines.every(l => l.line >= 1 && l.offset >= 0x8000));
  });
});
