import assert from "assert";
import { describe, it } from "mocha";
import * as fs from "fs";
import * as path from "path";
import { detectProject, detectDialect, detectionSummary, describeFinding, findMainCandidates, headersFromPresets, isClearWinner, isFolderOfPrograms, isHeaderFile, classifyFinding, dropNestedFindings, isMadeOfProjects, mainEvidence, parseReadmeBadge, toolForDialect } from "../../src/common/detect";
import { PLATFORM_PARAMS } from "../../src/worker/platforms";

const PRESETS = 'presets';
const PLATFORMS = Object.keys(PLATFORM_PARAMS).filter(p => p.indexOf('.') < 0);

function listing(): { [platform: string]: string[] } {
  var out: { [platform: string]: string[] } = {};
  for (var dir of fs.readdirSync(PRESETS)) {
    if (!PLATFORMS.includes(dir)) continue;
    out[dir] = fs.readdirSync(path.join(PRESETS, dir));
  }
  return out;
}

function files(map: { [fn: string]: string }) {
  return { files: Object.keys(map), read: (fn: string) => map[fn] ?? null, platforms: PLATFORMS };
}

describe('detect', () => {
  it('reads the README badge', async () => {
    var badge = parseReadmeBadge('Game\n\n[Open](http://8bitworkshop.com/redir.html?platform=vcs&githubURL=x&file=game.dasm).\n');
    assert.deepStrictEqual(badge, { platform: 'vcs', mainFile: 'game.dasm' });
    var latest = parseReadmeBadge('Game\n\n[Open](https://8bitworkshop.com/latest/?platform=vcs&githubURL=x&file=game.dasm).\n');
    assert.deepStrictEqual(latest, { platform: 'vcs', mainFile: 'game.dasm' });
    var d = await detectProject(files({ 'README.md': '[x](https://8bitworkshop.com/?platform=nes&file=main.c)', 'main.c': '' }));
    assert.strictEqual(d[0].platform, 'nes');
    assert.strictEqual(d[0].mainFile, 'main.c');
    assert.strictEqual(d[0].score, 1);
  });

  it('finds NES from a header, with the line', async () => {
    var d = await detectProject(files({ 'game.c': '\n#include "neslib.h"\nvoid main() {}\n' }));
    assert.strictEqual(d[0].platform, 'nes');
    assert.ok(isClearWinner(d));
    assert.strictEqual(classifyFinding(d), 'project');
    assert.deepStrictEqual(d[0].evidence[0], { file: 'game.c', line: 2, reason: 'includes "neslib.h"', kind: 'code' });
    assert.strictEqual(d[0].mainFile, 'game.c');
  });

  it('finds the VCS from TIA registers', async () => {
    var d = await detectProject(files({ 'game.dasm': '  processor 6502\n  sta WSYNC\n  sta COLUBK\n' }));
    assert.strictEqual(d[0].platform, 'vcs');
  });

  it('tells the Atari 8-bit family apart by header', async () => {
    // atari.h is guarded by __ATARI__ (800); atari5200.h by __ATARI5200__
    var d = await detectProject(files({ 'game.c': '#include <atari.h>\nvoid main() {}\n' }));
    assert.strictEqual(d[0].platform, 'atari8-800');
    d = await detectProject(files({ 'game.c': '#include <atari5200.h>\nvoid main() {}\n' }));
    assert.strictEqual(d[0].platform, 'atari8-5200');
  });

  it('finds a urust platform from the rs8 module a program uses', async () => {
    for (var [module, platform] of [['nes', 'nes'], ['vcs', 'vcs'], ['c64', 'c64'], ['apple2', 'apple2'], ['vic20', 'vic20'], ['zx', 'zx']]) {
      var d = await detectProject(files({ 'main.rs': `use rs8::${module}::*;\nfn main() {}\n` }));
      assert.strictEqual(d[0].platform, platform, module);
      assert.ok(isClearWinner(d), module);
      assert.strictEqual(d[0].mainFile, 'main.rs', module);
    }
    // the Atari 8-bit module serves both machines, so it can't pick one alone
    var a8 = await detectProject(files({ 'main.rs': 'use rs8::atari8::*;\nfn main() {}\n' }));
    assert.deepStrictEqual(a8.map(d => d.platform).sort(), ['atari8-5200', 'atari8-800']);
  });

  it('prefers the folder name over a shared Atari library header', async () => {
    var map: { [fn: string]: string } = {
      'game.c': '#include <atari.h>\nvoid main() {}\n',
      'a8lib.h': '#if defined(__ATARI5200__)\n#include <atari5200.h>\n#else\n#include <atari.h>\n#endif\n',
    };
    var d = await detectProject({ files: Object.keys(map), read: (fn) => map[fn], platforms: PLATFORMS, dirName: 'atari8-800' });
    assert.strictEqual(d[0].platform, 'atari8-800');
    assert.ok(isClearWinner(d));
  });

  it('says nothing about plain C', async () => {
    var d = await detectProject(files({ 'util.c': 'int add(int a, int b) { return a + b; }\n', 'util.h': 'int add(int, int);\n' }));
    assert.ok(d.every(x => x.score < 0.5), JSON.stringify(d));
    assert.ok(!isClearWinner(d));
  });

  it('reads a cc65 target from a Makefile', async () => {
    var d = await detectProject(files({ 'Makefile': 'all:\n\tcl65 -t c64 -o game.prg game.c\n', 'game.c': 'void main() {}\n' }));
    assert.strictEqual(d[0].platform, 'c64');
  });

  it('knows assembler dialects', () => {
    assert.strictEqual(detectDialect('.segment "CODE"\n  lda #0\n'), 'ca65');
    assert.strictEqual(detectDialect('  processor 6502\n  seg code\n'), 'dasm');
    assert.strictEqual(detectDialect('  lda #0\n'), null);
    // .asm builds with dasm on the NES; ca65 code needs ca65
    assert.strictEqual(toolForDialect('nes', 'game.asm', '.segment "CODE"\n'), 'ca65');
    assert.strictEqual(toolForDialect('nes', 'game.s', '.segment "CODE"\n'), undefined);
    assert.strictEqual(toolForDialect('nes', 'game.asm', '  processor 6502\n'), undefined);
  });

  it('picks one main file, or none for a directory of programs', () => {
    var texts = new Map([['main.c', '#include "util.h"\n//#link "sprites.c"\nvoid main() {}\n'], ['sprites.c', 'void draw() {}\n']]);
    assert.deepStrictEqual(findMainCandidates('nes', [...texts.keys()], texts), { candidates: ['main.c'], mainFile: 'main.c' });
    texts = new Map([['a.c', 'void main() {}\n'], ['b.c', 'void main() {}\n']]);
    assert.deepStrictEqual(findMainCandidates('nes', [...texts.keys()], texts), { candidates: ['a.c', 'b.c'], mainFile: undefined });
    // C without main() is a library, whatever links it
    texts = new Map([['game.s', 'reset: jmp reset\n'], ['util.c', 'int add(int a, int b) { return a + b; }\n']]);
    assert.deepStrictEqual(findMainCandidates('nes', [...texts.keys()], texts), { candidates: ['game.s'], mainFile: 'game.s' });
  });

  it('downweights a fingerprint found in a header', async () => {
    // the GBDK calls are library declarations, not a program using the hardware
    var header = 'void display_off();\nvoid SHOW_BKG();\nvoid set_bkg_data();\n';
    var d = await detectProject({ files: ['gb.h'], read: () => header, platforms: PLATFORMS, dirName: 'gb' });
    assert.ok(d.every(x => x.score < 0.5), JSON.stringify(d));
    assert.ok(d[0].score > 0, 'the header still counts for something');
    assert.strictEqual(classifyFinding(d), undefined, 'but a header alone is no project');
    assert.ok(isHeaderFile('gb/gb.h'));
    assert.ok(!isHeaderFile('gb/gb.sgb'));
    assert.strictEqual(mainEvidence(d[0])?.reason, 'calls GBDK functions');
  });

  it('passes over a toolchain library folder', async () => {
    // src/worker/lib/vcs: a linker config and startup code, in a folder named for the platform
    var d = await detectProject({ ...files({ 'atari2600.cfg': 'MEMORY {}\n', 'crt0.s': '  .export _init\n_init: rts\n' }), dirName: 'vcs' });
    assert.strictEqual(d[0].platform, 'vcs');
    assert.ok(d[0].score >= 0.5, 'enough score...');
    assert.notStrictEqual(classifyFinding(d), 'project', '...but no program code');
    assert.strictEqual(d[0].mainFile, undefined, 'crt0 is not a program');
    // src/worker/lib/vectrex: headers including headers
    d = await detectProject({ ...files({ 'bios.h': '#include "vectrex.h"\n' }), dirName: 'vectrex' });
    assert.ok(d[0].score >= 0.5);
    assert.strictEqual(classifyFinding(d), undefined);
  });

  it('offers a folder of ROMs only as potential', async () => {
    var d = await detectProject({ files: ['croom.nes'], read: () => null, platforms: PLATFORMS });
    assert.ok(isClearWinner(d), 'the CLI can still run it');
    assert.strictEqual(classifyFinding(d), 'potential');
  });

  it('offers an ambiguous strong detection as potential', async () => {
    var d = await detectProject(files({ 'game.c': '#include <cbm.h>\nvoid main() { POKE(0xd020, 0); VIC.bgcolor0 = 1; }\n' }));
    assert.ok(d[0].score >= 0.5 && d[1].score >= 0.5, JSON.stringify(d));
    assert.ok(!isClearWinner(d));
    assert.strictEqual(classifyFinding(d), 'potential');
  });

  it('keeps subfolders part of their project', () => {
    var main = { platform: 'vcs', score: 1, evidence: [], mainFile: 'main.asm' };
    var part = { platform: 'vcs', score: 0.5, evidence: [], mainFile: 'kernel.asm' };
    var programs = { platform: 'nes', score: 1, evidence: [], mainCandidates: ['a.c', 'b.c'] };
    var kept = dropNestedFindings([
      { dir: 'nyancat', detection: main },
      { dir: 'nyancat/bank1/code', detection: part },
      { dir: 'nyancat2', detection: part },
      { dir: 'presets/nes', detection: programs },
      { dir: 'presets/nes/chase', detection: part },
      { dir: 'presets/nes/lib', detection: { ...part, mainFile: undefined } },
    ]).map(f => f.dir);
    assert.deepStrictEqual(kept, ['nyancat', 'nyancat2', 'presets/nes', 'presets/nes/chase']);
  });

  it('prompts for a folder made of projects, not a big repo', () => {
    // ~/emu/workspace: a folder of cloned project repos
    var repos = ['2048', 'chase', 'falling', 'genemedic', 'guntner', 'mango', 'pacman'];
    assert.ok(isMadeOfProjects(repos, [...repos, 'guntner/exports', 'scripts']));
    // the 8bitworkshop repo: projects under a few of many top-level folders
    var projects = ['src/worker/lib/verilog', 'test/ecs', 'tmp', 'presets/nes', 'presets/c64', 'presets/vcs', 'presets/gb', 'presets/apple2', 'presets/zx'];
    var dirs = [...projects, 'src/common', 'css', 'res', 'gen', 'doc', 'scripts', 'extension', 'images', 'web', 'meta'];
    assert.ok(!isMadeOfProjects(projects, dirs));
    assert.ok(isMadeOfProjects(['presets/nes', 'presets/c64'], dirs), 'a few projects anywhere still count');
  });

  it('lists every program in a folder of programs', async () => {
    var programs = ['chase.c', 'climber.c', 'testphys.c'];
    var map: { [fn: string]: string } = {};
    for (var fn of programs) map[fn] = '#include "gb/gb.h"\nvoid main() {}\n';
    var d = await detectProject({ files: programs, read: (fn) => map[fn] ?? null, platforms: PLATFORMS, headers: { 'gb/gb.h': ['gb'] }, dirName: 'gb' });
    assert.strictEqual(d[0].platform, 'gb');
    assert.strictEqual(d[0].mainFile, undefined);
    assert.deepStrictEqual(d[0].mainCandidates, programs);
    assert.ok(isFolderOfPrograms(d[0]));
    assert.strictEqual(detectionSummary(d[0]), '3 programs');
    assert.strictEqual(describeFinding(d[0]), '3 programs — chase.c:1 includes "gb/gb.h"');
  });

  // Every preset's true platform is its directory. Track how often the top
  // guess for a lone preset file is right, and fail if it gets worse.
  it('guesses the platform of the presets', async function () {
    this.timeout(60000);
    var dirs = listing();
    var headers = headersFromPresets(dirs);
    var total = 0, right = 0, wrong: string[] = [];
    for (var dir in dirs) {
      for (var fn of dirs[dir]) {
        if (fn.endsWith('~') || fn.startsWith('skeleton.')) continue;
        if (!/\.(c|s|asm|dasm|ca65|acme|z|wiz|bas|v|xasm|cc2600|cc7800)$/.test(fn)) continue;
        var text = fs.readFileSync(path.join(PRESETS, dir, fn), 'utf-8');
        var d = await detectProject({ files: [fn], read: () => text, platforms: PLATFORMS, headers });
        total++;
        // members of a family that share every header count as right
        var family = (p: string) => p.replace(/^(sms-.*|msx-libcv|coleco)$/, 'libcv').replace(/^(atari8|astrocade|williams).*$/, '$1');
        // a tie for first place still puts the right platform in the pick list
        var top = d.length ? d[0].score : 0;
        if (d.length && d.some(x => x.score === top && family(x.platform) === family(dir))) right++;
        else wrong.push(`${dir}/${fn} -> ${d.length ? d[0].platform + ' ' + d[0].score : 'nothing'}`);
      }
    }
    var accuracy = right / total;
    console.log(`detect: ${right}/${total} presets (${Math.round(accuracy * 100)}%)`);
    if (process.env.DETECT_VERBOSE) console.log(wrong.join('\n'));
    assert.ok(accuracy >= ACCURACY_BASELINE, `accuracy ${accuracy} < ${ACCURACY_BASELINE}\n` + wrong.slice(0, 40).join('\n'));
  });
});

// raise this when detection improves
const ACCURACY_BASELINE = 0.7;
