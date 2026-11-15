import assert from "assert";
import { describe, it } from "mocha";
import * as fs from "fs";
import { getToolForFilename } from "../../src/tools/testlib";
import { getToolForPlatform, getToolSelector } from "../../src/common/toolselect";
import { installNodeMocks } from "../../src/tools/emutarget";
import { PLATFORMS } from "../../src/common/emu";

// The CLI picks the tool for every file of a build the way the IDE's platform
// objects do (the getToolForFilename members in src/platform/*.ts). It gets
// there from the platform's arch, so an arch the table doesn't name would send
// that platform's linked files to the fallback -- sdcc, for a z80 -- and the
// build would fail on the second file rather than the first.
describe('tool selection by platform', () => {
    it('should use the 6502 tools for the PC Engine', () => {
        assert.strictEqual(getToolForFilename('pcegfx.c', 'pce'), 'cc65');
        assert.strictEqual(getToolForFilename('pcegfx_tia.s', 'pce'), 'ca65');
    });
    it('should use the ARM tools for arm32', () => {
        assert.strictEqual(getToolForFilename('serialout.c', 'arm32'), 'armtcc');
        assert.strictEqual(getToolForFilename('boot.vasm', 'arm32'), 'vasmarm');
        assert.strictEqual(getToolForFilename('boot.armips', 'arm32'), 'armips');
    });
    it('should use the tools of the other architectures', () => {
        assert.strictEqual(getToolForFilename('main.c', 'c64'), 'cc65');
        assert.strictEqual(getToolForFilename('main.c', 'coleco'), 'sdcc');
        assert.strictEqual(getToolForFilename('main.c', 'williams'), 'cmoc');
        assert.strictEqual(getToolForFilename('main.c', 'x86'), 'smlrc');
        assert.strictEqual(getToolForFilename('main.v', 'verilog'), 'verilator');
    });
});

// Every platform object answers getToolForFilename from the shared table
// (src/common/toolselect.ts), so the IDE and the CLI can't disagree.
describe('tool selection table', () => {
    const EXTS = ['.c', '.h', '.s', '.a', '.asm', '.inc', '.ca65', '.dasm', '.acme', '.xa', '.wiz', '.ecs',
        '.cpp', '.cc', '.o64', '.bb', '.bas', '.fb', '.cc2600', '.cc7800', '.c78', '.lnk', '.nesasm',
        '-llvm.c', '.z', '.ns', '.scc', '.sgb', '.xasm', '.lwasm', '.vasm', '.armips', '.v', '.ice',
        '.dg', '.inf', '.uasm'];

    it('should agree with every platform object', async () => {
        installNodeMocks();
        for (const entry of fs.readdirSync('src/platform')) {
            if (!entry.endsWith('.ts') || entry.startsWith('_')) continue;
            try { await import('../../src/platform/' + entry.replace(/\.ts$/, '')); } catch (e) { }
        }
        const diffs: string[] = [];
        let checked = 0;
        for (const id of Object.keys(PLATFORMS)) {
            let plat: any;
            try { plat = new PLATFORMS[id](null); } catch (e) { continue; }
            if (!plat.getToolForFilename) continue;
            assert.ok(getToolSelector(id), `platform ${id} is not in the tool table`);
            checked++;
            for (const ext of EXTS) {
                const fn = 'main' + ext;
                const want = plat.getToolForFilename(fn), got = getToolForPlatform(id, fn);
                if (want !== got) diffs.push(`${id} ${fn}: platform=${want} table=${got}`);
            }
        }
        assert.ok(checked > 40, 'checked ' + checked + ' platforms');
        assert.deepStrictEqual(diffs, []);
    });

    it('should cover the platforms the old CLI table got wrong', () => {
        assert.strictEqual(getToolForPlatform('atari7800', 'game.c78'), 'cc7800');
        assert.strictEqual(getToolForPlatform('exidy', 'main.c'), 'cc65');
        assert.strictEqual(getToolForPlatform('channelf', 'main.c'), 'cc65');
        assert.strictEqual(getToolForPlatform('vcs', 'game-llvm.c'), 'remote:llvm-mos');
        assert.strictEqual(getToolForPlatform('williams-z80', 'main.c'), 'sdcc');
        assert.strictEqual(getToolForPlatform('williams', 'main.c'), 'cmoc');
    });
});
