import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { createHash } from 'crypto';
import { Worker } from 'worker_threads';
import * as zlib from 'zlib';
import { execFileSync } from 'child_process';
import { AssetStore, assetServers, defaultCacheDir } from '../../src/tools/assets';
import { EXCLUDED_PLATFORM_MODULES, UNSUPPORTED_PLATFORMS } from '../../src/tools/exclusions';
import { needsSdcc4, AssetManifest, PackInfo, isPackable, isUnreviewedFile, makePack, packForFile, packsForPlatform, readPack } from '../../src/tools/assetpacks';
import { listPackFiles } from '../scripts/assetpack';
import { findRootDir } from '../src/projectinfo';
import { Rpc } from '../src/rpc';
import type { BuildOutcome } from '../src/buildcore';
import type { EmuStatus } from '../src/emuworker';

const ROOT = findRootDir(__dirname);
const OUT = path.join(__dirname, '..');

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), '8bws-assets-'));
}

async function pack(name: string, files: { [path: string]: string }): Promise<[PackInfo, Uint8Array]> {
  var enc = new TextEncoder();
  var data = await makePack(Object.keys(files).map(p => ({ path: p, data: enc.encode(files[p]) })), 5);
  var sha256 = createHash('sha256').update(data).digest('hex');
  return [{ file: `8bitworkshop-${name}-test-${sha256.slice(0, 8)}.tar.br`, size: data.length, sha256, count: Object.keys(files).length }, data];
}

describe('extension asset packs', function () {

  it('puts the Verilog toolchain in its own pack', function () {
    assert.equal(packForFile('src/worker/wasm/verilator_bin.wasm'), 'verilog');
    assert.equal(packForFile('src/worker/fs/fsSilice.data'), 'verilog');
    assert.equal(packForFile('presets/verilog/ball_absolute.v'), 'base');
    assert.deepEqual(packsForPlatform('verilog-vga'), ['base', 'verilog']);
    assert.deepEqual(packsForPlatform('nes'), ['base']);
    assert.deepEqual(packsForPlatform(undefined), ['base']);
  });

  it('puts the urust toolchain in the base pack', function () {
    for (var f of ['src/worker/wasm/urust.wasm', 'src/worker/fs/urust-fs.zip']) {
      assert.equal(packForFile(f), 'base', f);
      assert.ok(isPackable(f), f); // urust is MIT: no UNREVIEWED_TOOLS entry
    }
    // packs are built from git-tracked files. Until the urust binaries are
    // committed they exist only in the work tree, so there is nothing to pack.
    var tracked = execFileSync('git', ['ls-files', '--', 'src/worker/wasm/urust.wasm', 'src/worker/fs/urust-fs.zip'],
      { cwd: ROOT, encoding: 'utf-8' }).split('\n').filter(f => f);
    if (tracked.length < 2) return this.skip();
    var all = Object.values(listPackFiles(ROOT)).flat();
    for (var f of ['src/worker/wasm/urust.wasm', 'src/worker/fs/urust-fs.zip']) assert.ok(all.includes(f), f);
  });

  it('puts the lesser-used toolchains in the extra pack, fetched by tool', function () {
    for (var f of ['src/worker/wasm/oscar64.wasm', 'src/worker/fs/cc7800-fs.zip']) {
      assert.equal(packForFile(f), 'extra', f);
    }
    assert.equal(packForFile('src/worker/wasm/cmoc.wasm'), 'base');
    var all = Object.values(listPackFiles(ROOT)).flat();
    assert.ok(!all.some(f => /^src\/worker\/.*(dialogc|armips|inform|yasm|dialog-fs|arm-tcc|smlrc|arm32)/.test(f)), 'unused toolchains are not packed');
    assert.equal(packForFile('src/worker/wasm/sdcc4.wasm'), 'extra');
    assert.equal(packForFile('src/worker/fs/sdcc-fs.zip'), 'extra');
    assert.deepEqual(packsForPlatform('c64', 'oscar64'), ['base', 'extra']);
    assert.deepEqual(packsForPlatform('verilog', 'cc2600'), ['base', 'verilog', 'extra']);
    assert.deepEqual(packsForPlatform('nes', 'cc65'), ['base', 'cc65']);
    // SDCC 4.x: by directive, or the 6502 backend; 3.x stays in base
    assert.deepEqual(packsForPlatform('gb', 'sdcc', 'int x;'), ['base', 'sdcc']);
    assert.deepEqual(packsForPlatform('gb', 'sdcc', '//#tooldef c sdcc=4\nint x;'), ['base', 'sdcc', 'extra']);
    assert.ok(needsSdcc4('coleco', 'sdcc', '//#tooldef sdcc=4'));
    assert.ok(!needsSdcc4('coleco', 'sdcc', '//#tooldef c sdcc=3'));
    assert.ok(!needsSdcc4('coleco', 'cc65', '//#tooldef c sdcc=4'));
    assert.ok(needsSdcc4('c64', 'sdcc', 'int x;'), 'mos6502 is 4.x only');
    assert.ok(!needsSdcc4('c64', 'cc65', 'int x;'));
  });

  it('puts cc65 and SDCC 3.x in their own packs, with the tools that hand off to them', function () {
    for (var f of ['src/worker/wasm/cc65.wasm', 'src/worker/wasm/ca65.wasm', 'src/worker/wasm/ld65.wasm', 'src/worker/fs/cc65-fs-nes.zip',
      'src/worker/wasm/fastbasic-int.js', 'src/worker/wasm/fastbasic-int.wasm',
      'src/worker/wasm/fastbasic-fp.js', 'src/worker/wasm/fastbasic-fp.wasm']) {
      assert.equal(packForFile(f), 'cc65', f);
    }
    for (var f of ['src/worker/wasm/sdcc.wasm', 'src/worker/wasm/sdasgb.js', 'src/worker/wasm/sdldz80.wasm', 'src/worker/fs/fssdcc.data', 'src/worker/fs/fssdcc.js.metadata']) {
      assert.equal(packForFile(f), 'sdcc', f);
    }
    // shared by 6809 and SDCC, so it stays in base
    assert.equal(packForFile('src/worker/asmjs/mcpp.js'), 'base');
    // fastbasic and ECS assemble with ca65
    assert.deepEqual(packsForPlatform('atari8-800', 'fastbasic'), ['base', 'cc65']);
    assert.deepEqual(packsForPlatform('nes', 'ecs'), ['base', 'cc65']);
    assert.deepEqual(packsForPlatform('c64', 'ca65'), ['base', 'cc65']);
    assert.deepEqual(packsForPlatform('zx', 'sdasz80'), ['base', 'sdcc']);
    // no build tool, just an emulator
    assert.deepEqual(packsForPlatform('nes'), ['base']);
    assert.deepEqual(packsForPlatform('vcs', 'dasm'), ['base']);
  });

  it('lists the tracked toolchain files, with symlinked directories copied', function () {
    var lists = listPackFiles(ROOT);
    assert.ok(lists.cc65.includes('src/worker/wasm/cc65.wasm'));
    assert.ok(lists.sdcc.includes('src/worker/wasm/sdcc.wasm'));
    assert.ok(lists.base.includes('presets/nes/hello.c'));
    assert.ok(lists.base.some(f => f.startsWith('presets/msx-libcv/')), 'symlinked preset dir');
    assert.ok(!lists.base.includes('presets/msx-libcv'));
    assert.deepEqual(lists.verilog.filter(f => f.startsWith('src/')).sort(), [
      'src/worker/fs/fsSilice.data', 'src/worker/fs/fsSilice.js', 'src/worker/fs/fsSilice.js.metadata',
      'src/worker/wasm/silice.js', 'src/worker/wasm/silice.wasm',
      'src/worker/wasm/verilator_bin.js', 'src/worker/wasm/verilator_bin.wasm',
    ]);
    assert.ok(lists.verilog.includes('node_modules/binaryen/index.js'));
    for (var f of Object.values(lists).flat()) {
      assert.ok(fs.statSync(path.join(ROOT, f)).isFile(), f);
      assert.ok(!f.endsWith('~'), `backup file ${f}`);
    }
  });

  it('leaves out tools whose license is not cleared', function () {
    assert.ok(isUnreviewedFile('src/worker/wasm/nesasm.wasm'));
    assert.ok(isUnreviewedFile('src/worker/wasm/merlin32.js'));
    assert.ok(isUnreviewedFile('src/worker/asmjs/xasm6809.js'));
    assert.ok(!isUnreviewedFile('src/worker/wasm/cc65.wasm'));
    var lists = listPackFiles(ROOT);
    for (var f of Object.values(lists).flat()) {
      assert.ok(!isUnreviewedFile(f), `unreviewed file shipped: ${f}`);
    }
  });

  it('packs the same files to the same bytes', async function () {
    var [a] = await pack('base', { 'a.txt': 'x', 'b/c.txt': 'y' });
    var [b] = await pack('base', { 'a.txt': 'x', 'b/c.txt': 'y' });
    assert.equal(a.sha256, b.sha256);
  });

  it('round-trips files through a pack', async function () {
    var long = 'presets/' + 'x'.repeat(60) + '/' + 'y'.repeat(60) + '.c';
    var files = [
      { path: 'src/worker/wasm/a.wasm', data: new Uint8Array([0, 1, 2, 255]) },
      { path: 'empty.txt', data: new Uint8Array(0) },
      { path: 'block.bin', data: new Uint8Array(512).fill(7) },
      { path: long, data: new TextEncoder().encode('long name') },
    ];
    var out = await readPack(await makePack(files, 5));
    assert.deepEqual(out.map(f => [f.path, Array.from(f.data)]), files.map(f => [f.path, Array.from(f.data)]));
  });

  it('writes tar that the tar command reads', async function () {
    var dir = tmpdir();
    var tar = zlib.brotliDecompressSync(await makePack([
      { path: 'a/b.txt', data: new TextEncoder().encode('hello') },
      { path: 'c.bin', data: new Uint8Array(1000).fill(1) },
    ], 5));
    fs.writeFileSync(path.join(dir, 'p.tar'), tar);
    execFileSync('tar', ['-xf', 'p.tar'], { cwd: dir });
    assert.equal(fs.readFileSync(path.join(dir, 'a/b.txt'), 'utf-8'), 'hello');
    assert.equal(fs.statSync(path.join(dir, 'c.bin')).size, 1000);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('8bws toolchain cache', function () {
  it('defaults to the user cache directory, per OS', function () {
    assert.equal(defaultCacheDir({}, 'linux', '/home/u'), path.join('/home/u', '.cache', '8bitworkshop'));
    assert.equal(defaultCacheDir({ XDG_CACHE_HOME: '/x' }, 'linux', '/home/u'), path.join('/x', '8bitworkshop'));
    assert.equal(defaultCacheDir({}, 'darwin', '/Users/u'), path.join('/Users/u', 'Library', 'Caches', '8bitworkshop'));
    assert.equal(defaultCacheDir({ LOCALAPPDATA: 'C:\\L' }, 'win32', 'C:\\u'), path.join('C:\\L', '8bitworkshop', 'Cache'));
  });

  it('lets $EIGHTBITWORKSHOP_TOOLCHAINS override it', function () {
    assert.equal(defaultCacheDir({ EIGHTBITWORKSHOP_TOOLCHAINS: '/t' }, 'darwin', '/Users/u'), '/t');
  });
});

describe('extension AssetStore', function () {
  var server: http.Server;
  var url: string;
  var served: { [file: string]: Uint8Array };
  var hits: string[];
  var manifest: AssetManifest;
  var cache: string;

  before(async function () {
    var [base, baseZip] = await pack('base', { 'src/worker/wasm/a.wasm': 'AAA', 'presets/nes/hello.c': 'main' });
    var [verilog, verilogZip] = await pack('verilog', { 'src/worker/wasm/verilator_bin.wasm': 'VVV' });
    manifest = { ideVersion: 'test', version: 'test', packs: { base, verilog } };
    served = { [base.file]: baseZip, [verilog.file]: verilogZip };
    server = http.createServer((req, res) => {
      var name = path.posix.basename(req.url || '');
      hits.push(name);
      if (served[name] && req.url === '/assets/' + name) res.end(served[name]);
      else { res.statusCode = 404; res.end(); }
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as any).port}/assets/`;
  });

  after(function () {
    server.close();
  });

  beforeEach(function () {
    hits = [];
    cache = tmpdir();
  });

  afterEach(function () {
    fs.rmSync(cache, { recursive: true, force: true });
  });

  it('downloads a pack once and unpacks it', async function () {
    var store = new AssetStore(cache, manifest, [url]);
    var progress: number[] = [];
    var root = await store.ensure(['base'], (pack, n) => progress.push(n));
    assert.equal(fs.readFileSync(path.join(root, 'src/worker/wasm/a.wasm'), 'utf-8'), 'AAA');
    assert.ok(store.has('base'));
    assert.ok(!store.has('verilog'));
    assert.ok(progress.length > 0);
    // a second store (a new window) finds it installed
    var again = new AssetStore(cache, manifest, [url]);
    assert.equal(await again.ensure(['base']), root);
    assert.deepEqual(hits, [manifest.packs.base.file]);
  });

  it('adds the verilog pack to the same root', async function () {
    var store = new AssetStore(cache, manifest, [url]);
    var root = await store.ensure(['base']);
    assert.equal(await store.ensure(['base', 'verilog']), root);
    assert.ok(fs.existsSync(path.join(root, 'src/worker/wasm/a.wasm')));
    assert.ok(fs.existsSync(path.join(root, 'src/worker/wasm/verilator_bin.wasm')));
  });

  it('shares one download between concurrent callers', async function () {
    var store = new AssetStore(cache, manifest, [url]);
    var [a, b] = await Promise.all([store.ensure(['base']), store.ensure(['base'])]);
    assert.equal(a, b);
    assert.equal(hits.length, 1);
  });

  it('skips a server with the wrong file and tries the next', async function () {
    var bad = tmpdir();
    fs.writeFileSync(path.join(bad, manifest.packs.base.file), 'not a pack');
    var store = new AssetStore(cache, manifest, [bad, 'http://127.0.0.1:1/nothing/', url]);
    var root = await store.ensure(['base']);
    assert.ok(fs.existsSync(path.join(root, 'presets/nes/hello.c')));
    fs.rmSync(bad, { recursive: true });
  });

  it('reads a pack from a local directory or file: URL', async function () {
    var dir = tmpdir();
    fs.writeFileSync(path.join(dir, manifest.packs.base.file), served[manifest.packs.base.file]);
    var store = new AssetStore(cache, manifest, ['file://' + dir]);
    await store.ensure(['base']);
    assert.ok(store.has('base'));
    assert.deepEqual(hits, []);
    fs.rmSync(dir, { recursive: true });
  });

  it('fails when no server has a good copy, and installs nothing', async function () {
    var store = new AssetStore(cache, manifest, [url + 'missing/']);
    await assert.rejects(store.ensure(['base']), /Cannot download toolchain pack.*HTTP 404/);
    assert.ok(!store.has('base'));
  });

  it('removes roots from older builds', async function () {
    var old = path.join(cache, '0123456789ab');
    fs.mkdirSync(old);
    var store = new AssetStore(cache, manifest, [url]);
    await store.ensure(['base']);
    assert.ok(!fs.existsSync(old));
  });
});

// Builds and runs from the real packs (npm run assets), not the repo.
describe('extension toolchains from packs', function () {
  this.timeout(120000);
  var manifestFile = path.join(OUT, 'assets.json');
  var cache: string;
  var root: string;

  before(async function () {
    if (!fs.existsSync(manifestFile)) return this.skip();
    var manifest: AssetManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
    cache = tmpdir();
    var store = new AssetStore(cache, manifest, [path.join(OUT, 'assets')]);
    root = await store.ensure(["base", "cc65", "verilog"]);
  });

  after(function () {
    if (cache) fs.rmSync(cache, { recursive: true, force: true });
  });

  function start(script: string, handlers = {}): [Worker, Rpc] {
    var worker = new Worker(path.join(OUT, script), { workerData: { rootDir: root } });
    return [worker, new Rpc(worker, handlers)];
  }

  async function build(platform: string, dir: string, main: string): Promise<BuildOutcome> {
    var [worker, rpc] = start('buildworker.js', {
      readFile: (id: number, rel: string) => {
        var p = path.join(root, 'presets', dir, rel);
        return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null;
      },
    });
    try {
      var mainText = fs.readFileSync(path.join(root, 'presets', dir, main), 'utf-8');
      return await rpc.call<BuildOutcome>('build', { buildId: 1, platform, mainPath: main, mainText });
    } finally {
      await worker.terminate();
    }
  }

  it('builds NES C', async function () {
    var r = await build('nes', 'nes', 'hello.c');
    assert.deepEqual(r.diagnostics, []);
    assert.ok(r.success && r.output);
  });

  it('builds Verilog and loads binaryen from the pack', async function () {
    var r = await build('verilog', 'verilog', 'ball_absolute.v');
    assert.deepEqual(r.diagnostics, []);
    assert.ok(r.success && r.output);
    // loading the platform imports binaryen, which only the pack root has.
    // (Running frames is a separate, pre-existing Verilog failure.)
    var [worker, rpc] = start('emuworker.js');
    try {
      var s = await rpc.call<EmuStatus>('start', 'verilog', r.output);
      assert.equal(s.platform, 'verilog');
    } finally {
      await worker.terminate();
    }
  });
});

describe('8bws bundle with an empty cache', function () {
  this.timeout(120000);
  var cli = path.join(OUT, '8bws.js');
  var home: string;
  var work: string;

  before(function () {
    if (!fs.existsSync(path.join(OUT, 'assets.json')) || !fs.existsSync(cli)) return this.skip();
    home = tmpdir();
    work = tmpdir();
    for (var f of ['presets/nes/hello.c', 'presets/verilog/ball_absolute.v', 'presets/verilog/hvsync_generator.v']) {
      fs.copyFileSync(path.join(ROOT, f), path.join(work, path.basename(f)));
    }
  });

  after(function () {
    for (var d of [home, work]) if (d) fs.rmSync(d, { recursive: true, force: true });
  });

  function run(...args: string[]): string {
    var env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: home, XDG_CACHE_HOME: path.join(home, '.cache') };
    delete env.EIGHTBITWORKSHOP_ROOT;
    delete env.EIGHTBITWORKSHOP_TOOLCHAINS;
    return execFileSync(process.execPath, [cli, ...args], { cwd: work, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  }

  function installed(home: string): string[] {
    var found: string[] = [];
    (function walk(dir: string) {
      for (var e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === '.packs') found.push(...fs.readdirSync(path.join(dir, e.name)).map(n => n.split('-')[0]));
        else if (e.isDirectory() && dir.split(path.sep).length - home.split(path.sep).length < 4) walk(path.join(dir, e.name));
      }
    })(home);
    return found.sort();
  }

  it('unpacks only base and cc65 for a NES build, into the user cache', function () {
    run('build', '--check', 'hello.c');
    assert.deepEqual(installed(home), ['base', 'cc65']);
  });

  it('unpacks sdcc, not cc65, for a Game Boy build', function () {
    var h = fs.mkdtempSync(path.join(os.tmpdir(), '8bws-gb-'));
    try {
      fs.copyFileSync(path.join(ROOT, 'presets/gb/clock.c'), path.join(work, 'clock.c'));
      var env: NodeJS.ProcessEnv = { ...process.env, HOME: h, USERPROFILE: h, LOCALAPPDATA: h, XDG_CACHE_HOME: path.join(h, '.cache') };
      delete env.EIGHTBITWORKSHOP_ROOT;
      delete env.EIGHTBITWORKSHOP_TOOLCHAINS;
      execFileSync(process.execPath, [cli, 'build', '--check', '-p', 'gb', 'clock.c'], { cwd: work, env, stdio: 'pipe' });
      assert.deepEqual(installed(h), ['base', 'sdcc']);
    } finally {
      fs.rmSync(h, { recursive: true, force: true });
    }
  });

  it('lists only the tools and platforms the packs can build', function () {
    var tools: string[] = JSON.parse(run('list-tools', '--json')).data.tools;
    assert.ok(tools.includes('cc65') && tools.includes('dasm'));
    for (var t of ['dialog', 'armtcc', 'inform', 'nesasm', 'merlin32', 'xasm6809']) assert.ok(!tools.includes(t), `${t} listed`);
    var platforms = Object.keys(JSON.parse(run('list-platforms', '--json')).data.platforms);
    assert.ok(platforms.includes('nes'));
    for (var p of UNSUPPORTED_PLATFORMS) assert.ok(!platforms.includes(p), `${p} listed`);
  });

  it('refuses an unsupported platform up front, and leaves the emulator out of the bundle', function () {
    assert.throws(() => run('build', '--check', '-p', 'x86', 'hello.c'), /isn't in this install/);
    assert.ok(UNSUPPORTED_PLATFORMS.includes('vectrex'));
    for (var id of EXCLUDED_PLATFORM_MODULES) {
      assert.ok(!new RegExp(`^// \\.\\./.*src/platform/${id}\\.ts$`, 'm').test(fs.readFileSync(cli, 'utf-8')), `${id} compiled into the bundle`);
    }
  });

  it('fetches the Verilog pack when a Verilog build needs it', function () {
    run('build', '--check', '-p', 'verilog', 'ball_absolute.v');
    assert.deepEqual(installed(home), ['base', 'cc65', 'verilog']);
  });
});

describe('asset servers', function () {
  it('try the version\'s GitHub Release first, then the Pages fallbacks', function () {
    var urls = assetServers({ ideVersion: '4.0.0', version: '0.1.2', packs: {} });
    assert.equal(urls[0], 'https://github.com/8bitworkshop/8bitworkshop/releases/download/cli-v0.1.2/');
    assert.ok(urls.length > 1 && urls.slice(1).every(u => !u.includes('/releases/')));
  });
});

describe('8bws npm package', function () {
  this.timeout(120000);
  var dir: string;
  var home: string;
  var work: string;

  before(function () {
    if (!fs.existsSync(path.join(OUT, 'assets.json')) || !fs.existsSync(path.join(OUT, '8bws.js'))) return this.skip();
    dir = path.join(tmpdir(), 'pkg');
    home = tmpdir();
    work = tmpdir();
    execFileSync(process.execPath, [path.join(OUT, '..', 'scripts', 'stage-npm.mjs'), '--out', dir], { stdio: 'pipe' });
    fs.copyFileSync(path.join(ROOT, 'presets/nes/hello.c'), path.join(work, 'hello.c'));
  });

  after(function () {
    for (var d of [dir && path.dirname(dir), home, work]) if (d) fs.rmSync(d, { recursive: true, force: true });
  });

  it('has a package.json that matches the extension version, and a bin with a shebang', function () {
    var pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    assert.equal(pkg.version, JSON.parse(fs.readFileSync(path.join(OUT, '..', 'package.json'), 'utf-8')).version);
    assert.deepEqual(pkg.bin, { '8bws': '8bws.js' });
    assert.ok(fs.readFileSync(path.join(dir, '8bws.js'), 'utf-8').startsWith('#!/usr/bin/env node\n'));
  });

  it('is scoped @8bws/8bws by default and takes --name', function () {
    var pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    assert.equal(pkg.name, '@8bws/8bws');
    var other = path.join(tmpdir(), 'named');
    execFileSync(process.execPath, [path.join(OUT, '..', 'scripts', 'stage-npm.mjs'), '--out', other, '--name', '@acme/tool'], { stdio: 'pipe' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(other, 'package.json'), 'utf-8')).name, '@acme/tool');
    assert.ok(fs.readFileSync(path.join(other, 'README.md'), 'utf-8').includes('npx @acme/tool build'));
    assert.ok(fs.readFileSync(path.join(dir, 'README.md'), 'utf-8').includes('npx @8bws/8bws build'));
    fs.rmSync(path.dirname(other), { recursive: true, force: true });
  });

  it('stages the CLI, manifest and licenses, and lists exactly those to publish', function () {
    var expected = ['8bws.js', 'LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.md', 'assets.json', 'package.json', 'presets.json'];
    assert.deepEqual(fs.readdirSync(dir).sort(), expected);
    var pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    assert.deepEqual([...pkg.files, 'package.json'].sort(), expected);
  });

  it('builds from an empty cache, fetching packs from $EIGHTBITWORKSHOP_ASSETS', function () {
    var env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: home, XDG_CACHE_HOME: path.join(home, '.cache'),
      EIGHTBITWORKSHOP_ASSETS: path.join(OUT, 'assets') };
    delete env.EIGHTBITWORKSHOP_ROOT;
    delete env.EIGHTBITWORKSHOP_TOOLCHAINS;
    var out = execFileSync(process.execPath, [path.join(dir, '8bws.js'), 'build', '--check', '--json', 'hello.c'], { cwd: work, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(JSON.parse(out).data.platform, 'nes');
  });

  it('lists presets and copies one that then builds', function () {
    var env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: home, XDG_CACHE_HOME: path.join(home, '.cache'),
      EIGHTBITWORKSHOP_ASSETS: path.join(OUT, 'assets') };
    delete env.EIGHTBITWORKSHOP_ROOT;
    delete env.EIGHTBITWORKSHOP_TOOLCHAINS;
    var cli = (cwd: string, ...args: string[]) => JSON.parse(execFileSync(process.execPath, [path.join(dir, '8bws.js'), ...args, '--json'], { cwd, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })).data;
    assert.ok(cli(work, 'presets').platforms.some((p: any) => p.id === 'nes'));
    assert.ok(cli(work, 'presets', 'nes').templates.some((t: any) => t.id === 'aputest.c'));
    var made = cli(work, 'new', 'nes/aputest.c', 'game');
    assert.equal(made.main, 'aputest.c');
    assert.ok(fs.existsSync(path.join(work, 'game', 'aputest.c')));
    assert.equal(cli(path.join(work, 'game'), 'build', '--check', '-p', 'nes', 'aputest.c').platform, 'nes');
  });
});
