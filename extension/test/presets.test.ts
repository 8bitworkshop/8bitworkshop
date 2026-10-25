import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { copyTemplate, findTemplate, readPresetIndex } from '../../src/tools/presets';
import { UNSUPPORTED_PLATFORMS } from '../../src/tools/exclusions';
import { getRootBasePlatform } from '../../src/common/util';
import { findRootDir } from '../src/projectinfo';

// out/presets.json is written by scripts/presetindex.ts during the build.
// The export-ROM feature reads each platform's romext from it.
describe('preset index', function () {
  var index = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'presets.json'), 'utf-8'));

  function romext(id: string): string | undefined {
    return index.platforms.find((p: any) => p.id === id)?.romext;
  }

  it('records the ROM extension for platforms that define one', function () {
    assert.equal(romext('nes'), '.nes');
    assert.equal(romext('vcs'), '.a26');
    assert.equal(romext('gb'), '.gb');
  });

  it('defaults to .bin for platforms without one', function () {
    assert.equal(romext('astrocade'), '.bin');
  });

  // presetindex builds each platform on the main thread; the Verilog platform
  // pulls in binaryen, which used to fail there and skip these platforms
  it('offers the Verilog platforms and their templates', function () {
    for (var id of ['verilog', 'verilog-vga']) {
      var p = index.platforms.find((p: any) => p.id === id);
      assert.ok(p, `${id} missing from the preset index`);
      assert.ok(p.templates.length > 0, `${id} has no templates`);
    }
  });
});

describe('copying a preset', function () {
  var tmp: string;
  var index = readPresetIndex(path.join(__dirname, '..', 'presets.json'));
  var presets = path.join(findRootDir(__dirname), 'presets');

  beforeEach(function () { tmp = fs.mkdtempSync(path.join(os.tmpdir(), '8bws-new-')); });
  afterEach(function () { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('finds a preset with or without its extension, and says when that is ambiguous', function () {
    assert.equal(findTemplate(index, 'nes/aputest.c').template.id, 'aputest.c');
    assert.equal(findTemplate(index, 'NES/Aputest').template.id, 'aputest.c');
    // nes/hello names several presets (hello.c, hello.bas, ...): list them all
    var hello = index.platforms.find((p) => p.id === 'nes')!.templates
      .map((t) => t.id).filter((id) => id.replace(/\.[^./]+$/, '').toLowerCase() === 'hello');
    assert.ok(hello.length > 1, 'nes/hello should be ambiguous');
    assert.throws(() => findTemplate(index, 'nes/hello'), (err: Error) =>
      err.message === `'nes/hello' matches ${hello.length} presets (${hello.join(', ')}); give the extension.`);
    assert.throws(() => findTemplate(index, 'nes/nope'), /No preset 'nope'/);
    assert.throws(() => findTemplate(index, 'nope/hello.c'), /No platform/);
    assert.throws(() => findTemplate(index, 'hello.c'), /<platform>\/<file>/);
  });

  it('leaves out platforms the packaged CLI cannot run', function () {
    for (var p of index.platforms) assert.ok(!UNSUPPORTED_PLATFORMS.includes(getRootBasePlatform(p.id)), `${p.id} offered`);
    assert.ok(readPresetIndex(path.join(__dirname, '..', 'presets.json'), () => false).platforms.every(p => p.templates.length === 0));
  });

  it('copies the main file and its own files; libraries only on request', function () {
    var { platform, template } = findTemplate(index, 'nes/aputest.c');
    assert.ok(template.shared.length > 0, 'aputest should read shared libraries');
    var files = copyTemplate(presets, platform, template, path.join(tmp, 'a'));
    assert.deepEqual(files, ['aputest.c', ...template.files]);
    var all = copyTemplate(presets, platform, template, path.join(tmp, 'b'), { libraries: true });
    assert.deepEqual(all.slice().sort(), ['aputest.c', ...template.files, ...template.shared].sort());
    for (var f of all) assert.ok(fs.existsSync(path.join(tmp, 'b', f)), f);
  });

  it('saves a blank program as main.<ext>', function () {
    var { platform, template } = findTemplate(index, 'nes/skeleton.cc65');
    assert.deepEqual(copyTemplate(presets, platform, template, tmp), ['main.c']);
  });

  it('refuses to overwrite without force, and changes nothing', function () {
    var { platform, template } = findTemplate(index, 'nes/aputest.c');
    fs.writeFileSync(path.join(tmp, 'aputest.c'), 'mine');
    assert.throws(() => copyTemplate(presets, platform, template, tmp, { libraries: true }), /already in/);
    assert.equal(fs.readFileSync(path.join(tmp, 'aputest.c'), 'utf-8'), 'mine');
    assert.deepEqual(fs.readdirSync(tmp), ['aputest.c']);
    copyTemplate(presets, platform, template, tmp, { force: true });
    assert.notEqual(fs.readFileSync(path.join(tmp, 'aputest.c'), 'utf-8'), 'mine');
  });
});
