
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var os = require('os');
var { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '../../gen/tools/8bws.js');

// run the CLI and return { stdout, json } -- --json puts the CLIResult on stdout
function cli(...args) {
    var stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return stdout;
}
// in --json mode stdout is the CLIResult and nothing else
function cliJSON(...args) {
    return JSON.parse(cli(...args, '--json'));
}
function cliFails(...args) {
    try { cli(...args); } catch (e) { return e; }
    assert.fail('expected the command to fail: ' + args.join(' '));
}

describe('8bws CLI', function () {

    describe('discovery', function () {
        it('should list platforms', function () {
            var r = cliJSON('list-platforms');
            assert.ok(r.success);
            assert.ok(r.data.count > 20);
            assert.equal(r.data.platforms['nes'].arch, '6502');
        });
        it('should put nothing but JSON on stdout in --json mode', function () {
            // the compiler chatters on console.log; it must not corrupt the result
            var r = cliJSON('run', '--platform', 'gb', 'presets/gb/hello.c', '--frames', '5');
            assert.equal(r.data.frames, 5);
        });
        it('should list tools', function () {
            var r = cliJSON('list-tools');
            assert.ok(r.data.tools.includes('cc65'));
        });
    });

    describe('build', function () {
        it('should build a source file', function () {
            var out = path.join(os.tmpdir(), '8bws-test-hello.gb');
            var r = cliJSON('build', '--platform', 'gb', 'presets/gb/hello.c', '-o', out);
            assert.ok(r.success, r.error);
            assert.equal(r.data.tool, 'sdcc');
            assert.ok(r.data.outputSize > 0);
            assert.equal(fs.statSync(out).size, r.data.outputSize);
        });
        it('should report warnings of a successful build', function () {
            var src = path.join(os.tmpdir(), '8bws-test-warn.c');
            fs.writeFileSync(src, 'void main(void) {\n  const const int x = 3;\n  while (1) ;\n}\n');
            var r = cliJSON('build', '--platform', 'nes', src, '--check');
            assert.ok(r.success, r.error);
            assert.equal(r.data.warnings.length, 1);
            assert.equal(r.data.warnings[0].severity, 'warning');
            assert.equal(r.data.warnings[0].line, 2);
        });
        it('should check without writing output', function () {
            var r = cliJSON('build', '--platform', 'gb', 'presets/gb/hello.c', '--check');
            assert.ok(r.success, r.error);
            assert.equal(r.command, 'check');
        });
        it('should report compile errors', function () {
            var src = path.join(os.tmpdir(), '8bws-test-bad.c');
            fs.writeFileSync(src, 'int main() { this is not C }\n');
            var e = cliFails('build', '--platform', 'gb', src);
            assert.ok(e.status !== 0);
        });
        it('should detect the platform when it is clear', function () {
            var r = cliJSON('build', '--check', 'presets/nes/hello.c');
            assert.ok(r.success);
            assert.strictEqual(r.data.platform, 'nes');
        });
        it('should require a platform when detection is unsure', function () {
            var dir = fs.mkdtempSync(path.join(os.tmpdir(), '8bws-'));
            var src = path.join(dir, 'plain.c');
            fs.writeFileSync(src, 'int add(int a, int b) { return a + b; }\n');
            var e = cliFails('build', src);
            assert.ok(/--platform/.test(e.stderr + e.stdout), e.stderr);
        });
        it('should detect the platform and main file of a directory', function () {
            var dir = fs.mkdtempSync(path.join(os.tmpdir(), '8bws-dir-'));
            fs.copyFileSync('presets/nes/hello.c', path.join(dir, 'hello.c'));
            var r = cliJSON('build', '--check', dir);
            assert.ok(r.success, r.error);
            assert.strictEqual(r.data.platform, 'nes');
            assert.strictEqual(path.basename(r.data.source), 'hello.c');
        });
        it('should name the programs when a directory has no main file', function () {
            var dir = fs.mkdtempSync(path.join(os.tmpdir(), '8bws-dir-'));
            for (var fn of ['a.c', 'b.c']) fs.writeFileSync(path.join(dir, fn), '#include "neslib.h"\nvoid main() {}\n');
            var e = cliFails('build', '--check', dir);
            assert.ok(/No main file/.test(e.stderr + e.stdout), e.stderr);
            assert.ok(/a\.c, b\.c/.test(e.stderr + e.stdout), e.stderr);
        });
        it('should find a main file a README names in a subfolder', function () {
            var dir = fs.mkdtempSync(path.join(os.tmpdir(), '8bws-dir-'));
            fs.mkdirSync(path.join(dir, 'src'));
            fs.copyFileSync('presets/nes/hello.c', path.join(dir, 'src', 'hello.c'));
            fs.writeFileSync(path.join(dir, 'README.md'), '[x](http://8bitworkshop.com/redir.html?platform=nes&githubURL=x&file=hello.c)\n');
            var r = cliJSON('build', '--check', dir);
            assert.ok(r.success, r.error);
            assert.strictEqual(r.data.platform, 'nes');
            assert.ok(r.data.source.endsWith(path.join('src', 'hello.c')), r.data.source);
        });
        it('should read a README badge that links to /latest/', function () {
            var dir = fs.mkdtempSync(path.join(os.tmpdir(), '8bws-dir-'));
            fs.mkdirSync(path.join(dir, 'src'));
            fs.copyFileSync('presets/nes/hello.c', path.join(dir, 'src', 'hello.c'));
            fs.writeFileSync(path.join(dir, 'README.md'), '[x](https://8bitworkshop.com/latest/?platform=nes&githubURL=x&file=hello.c)\n');
            var r = cliJSON('build', '--check', dir);
            assert.ok(r.success, r.error);
            assert.strictEqual(r.data.platform, 'nes');
            assert.ok(r.data.source.endsWith(path.join('src', 'hello.c')), r.data.source);
        });
    });

    describe('detect', function () {
        it('should guess the platform of a file, with evidence', function () {
            var r = cliJSON('detect', 'presets/nes/climber.c');
            assert.ok(r.success);
            assert.strictEqual(r.data.detections[0].platform, 'nes');
            assert.ok(r.data.clear);
            assert.ok(r.data.detections[0].evidence.some(e => /neslib/.test(e.reason)));
        });
    });

    describe('run --platform', function () {
        it('should run a ROM for N frames', function () {
            var r = cliJSON('run', '--platform', 'nes', '--frames', '30', 'test/roms/nes/shoot2.c.rom');
            assert.ok(r.success, r.error);
            assert.equal(r.data.frames, 30);
            // the screen, not the 512x480 nametable debug view nes also builds
            assert.equal(r.data.width, 256);
            assert.equal(r.data.height, 224);
        });
        it('should build and run a source file', function () {
            var r = cliJSON('run', '--platform', 'gb', 'presets/gb/hello.c', '--frames', '10');
            assert.ok(r.success, r.error);
            assert.equal(r.data.frames, 10);
        });
        it('should build cosmic.c with SDCC from a header-only wrapper', function () {
            var out = path.join(os.tmpdir(), '8bws-cosmic-sdcc.bin');
            cli('build', '-p', 'apple2', 'presets/apple2/cosmic-sdcc.c', '-o', out);
            var bin = fs.readFileSync(out);
            assert.equal(bin[0] | bin[1] << 8, 0x4000);           // //#tooldef ld code_start=0x4000
            assert.equal(bin[2] | bin[3] << 8, bin.length - 4);
            assert.ok(bin.length > 4000);                          // the whole game, not just the wrapper
        });
        ['hello', 'sprite_collision'].forEach(function (name) {
            it('should build the c64 ' + name + ' SDCC preset as a PRG', function () {
                var out = path.join(os.tmpdir(), '8bws-c64-' + name + '-sdcc.prg');
                cli('build', '-p', 'c64', 'presets/c64/' + name + '-sdcc.c', '-o', out);
                var bin = fs.readFileSync(out);
                assert.equal(bin[0] | bin[1] << 8, 0x801);        // load address, then 10 SYS 2061
                assert.equal(bin[6], 0x9e);
            });
        });
        it('should not let c64 joystick 2 ghost the cursor keys into joystick 1', function () {
            // CIA1 PA drives the keyboard scan lines and joystick 2.  A low
            // joystick line must not make the KERNAL scan an extra line: the
            // cursor keys the IDE presses are on that line, and their column
            // 2 is PB2, joystick 1 LEFT.  The program reads port 1 with DDRA
            // all output, as the KERNAL leaves it.
            var src = path.join(os.tmpdir(), '8bws-c64-joy1.c');
            fs.writeFileSync(src, [
                'void main(void) {',
                '  __asm__("sei");',
                '  *(unsigned char*)0xdc02 = 0xff;',
                '  *(unsigned char*)0xdc00 = 0xff;',
                '  *(unsigned char*)0xdc03 = 0x00;',
                '  for (;;) *(unsigned char*)0x0400 = (~*(unsigned char*)0xdc01) & 0x1f;',
                '}',
            ].join('\n'));
            var out = cli('run', '-p', 'c64', src, '-e', 'run 300; keydown RIGHT; run 10; keydown UP; run 10; mem 0x0400 1');
            // UP (01) and RIGHT (08); no phantom LEFT (04)
            assert.ok(/^0400: 09\b/m.test(out), out);
        });
        it('should print the serial output of a devel-6502 program', function () {
            var out = cli('run', '-p', 'devel-6502', 'presets/devel-6502/hello-sdcc.c', '-e', 'run 5; serial');
            assert.ok(out.includes('Hello, SDCC 6502!\nagain\nagain\nagain'));
        });
        it('should reject serial on a platform without a serial port', function () {
            cliFails('run', '-p', 'nes', 'presets/nes/hello.c', '-e', 'run 1; serial');
        });
        it('should build and run a directory', function () {
            var dir = fs.mkdtempSync(path.join(os.tmpdir(), '8bws-dir-'));
            fs.copyFileSync('presets/nes/hello.c', path.join(dir, 'hello.c'));
            var r = cliJSON('run', dir, '--frames', '10');
            assert.ok(r.success, r.error);
            assert.strictEqual(r.data.platform, 'nes');
            assert.equal(r.data.frames, 10);
        });
        it('should break on a symbol from the build', function () {
            var out = cli('run', '--platform', 'gb', 'presets/gb/hello.c', '-e', 'break _main 600; pc 2');
            assert.ok(/break \$[0-9A-F]+: HIT/.test(out), out);
            assert.ok(/_main:/.test(out), out);
        });
        it('should find a C symbol without its underscore', function () {
            var out = cli('run', '--platform', 'gb', 'presets/gb/hello.c', '-e', 'break main 600; pc 1');
            assert.ok(/break \$[0-9A-F]+: HIT/.test(out), out);
        });
        it('should write a screenshot', function () {
            var png = path.join(os.tmpdir(), '8bws-test-shot.png');
            if (fs.existsSync(png)) fs.unlinkSync(png);
            cliJSON('run', '--platform', 'nes', '--frames', '10', '--png', png, 'test/roms/nes/shoot2.c.rom');
            assert.ok(fs.statSync(png).size > 0);
        });
        it('should write a frame sequence for ffmpeg', function () {
            var dir = fs.mkdtempSync(path.join(os.tmpdir(), '8bws-frames-'));
            var r = cliJSON('run', '--platform', 'nes', '--frames', '5', '--frames-dir', dir, 'test/roms/nes/shoot2.c.rom');
            assert.ok(r.success, r.error);
            assert.equal(r.data.frames, 5);
            assert.strictEqual(path.resolve(r.data.framesDir), path.resolve(dir));
            var files = fs.readdirSync(dir).sort();
            assert.deepEqual(files, ['frame_00000.png', 'frame_00001.png', 'frame_00002.png', 'frame_00003.png', 'frame_00004.png']);
            assert.ok(fs.statSync(path.join(dir, files[0])).size > 0);
            assert.ok(/ffmpeg -framerate \d+ -i .*frame_%05d\.png/.test(r.data.ffmpeg), r.data.ffmpeg);
        });
        it('should capture frames from a run script', function () {
            var dir = fs.mkdtempSync(path.join(os.tmpdir(), '8bws-frames-'));
            cli('run', '--platform', 'nes', 'test/roms/nes/shoot2.c.rom', '-e', 'run 3; capture 2 ' + dir + '; png ' + path.join(dir, 'one.png'));
            var files = fs.readdirSync(dir).sort();
            assert.deepEqual(files, ['frame_00000.png', 'frame_00001.png', 'one.png']);
        });
        it('should infer the platform from a ROM extension', function () {
            var gb = path.join(os.tmpdir(), '8bws-test-infer.gb');
            fs.copyFileSync('test/roms/gb/cpu_instrs.gb', gb);
            var r = cliJSON('run', gb, '--frames', '5');
            assert.equal(r.data.platform, 'gb');
        });
        it('should refuse an unrecognized ROM without a platform', function () {
            cliFails('run', 'test/roms/nes/shoot2.c.rom');
        });
    });

    describe('run --platform vcs (Javatari)', function () {
        it('should run a ROM and capture frames', function () {
            var png = path.join(os.tmpdir(), '8bws-test-vcs.png');
            if (fs.existsSync(png)) fs.unlinkSync(png);
            var r = cliJSON('run', '--platform', 'vcs', '--frames', '60', '--png', png, 'test/roms/vcs/brickgame.rom');
            assert.ok(r.success, r.error);
            assert.equal(r.data.frames, 60);
            assert.equal(r.data.width, 160);
            assert.ok(r.data.height > 180, r.data.height);
            assert.ok(fs.statSync(png).size > 0);
        });
        it('should build and run a source file', function () {
            var r = cliJSON('run', '--platform', 'vcs', 'presets/vcs/examples/hello.a', '--frames', '10');
            assert.ok(r.success, r.error);
        });
        it('should read memory and disassemble', function () {
            var out = cli('run', '--platform', 'vcs', '-e', 'run 20; pc 2; mem 0x80 16', 'test/roms/vcs/brickgame.rom');
            assert.ok(/PC=\$[0-9A-F]{4}/.test(out), out);
            assert.ok(/^0080:( [0-9A-F]{2}){8}/m.test(out), out);
        });
        it('should send keys to the joystick', function () {
            // brickgame keeps the player's X position at $80
            var out = cli('run', '--platform', 'vcs', '-e', 'run 50; mem 0x80 1; keydown left; run 10; mem 0x80 1', 'test/roms/vcs/brickgame.rom');
            assert.deepEqual(out.match(/^0080: [0-9A-F]{2}/gm), ['0080: 46', '0080: 3C'], out);
        });
    });

    // verilog builds a compiled unit, not a ROM image, and $readmem reads
    // project files when it loads
    describe('run --platform verilog', function () {
        const MAIN = [
            'module top(clk, reset, hsync, vsync, rgb);',
            '  input clk, reset;',
            '  output hsync, vsync;',
            '  output [3:0] rgb;',
            '  reg [7:0] rom[0:3];',
            '  initial $readmemh("rom_data.hex", rom);',
            '  assign hsync = 0;',
            '  assign vsync = 0;',
            '  assign rgb = rom[1][3:0];',
            'endmodule',
            '',
        ].join('\n');
        function project(withData) {
            var dir = fs.mkdtempSync(path.join(os.tmpdir(), '8bws-verilog-'));
            fs.writeFileSync(path.join(dir, 'main.v'), MAIN);
            if (withData) fs.writeFileSync(path.join(dir, 'rom_data.hex'), '00\n0f\n00\n00\n');
            return path.join(dir, 'main.v');
        }
        it('should build and run a source file that reads data with $readmem', function () {
            var r = cliJSON('run', '--platform', 'verilog', '--frames', '5', project(true));
            assert.ok(r.success, r.error);
            assert.equal(r.data.frames, 5);
            assert.strictEqual(r.data.rom, null);
        });
        it('should report a missing $readmem file', function () {
            var e = cliFails('run', '--platform', 'verilog', '--frames', '5', project(false));
            assert.ok(/no file "rom_data.hex"/.test(e.stdout + e.stderr), e.stdout + e.stderr);
        });
    });

    describe('run --platform verilog: signals and paddles', function () {
        it('should list signals with the clock count, and descend into modules', function () {
            var out = cli('run', 'presets/verilog/ball_paddle.v', '-e', 'run 1; signals; signals ball_paddle_top');
            assert.ok(/\(clock [1-9]\d*\)/.test(out), out);
            assert.ok(/^ball_paddle_top\/ /m.test(out), out);
            assert.ok(/^lives 3 /m.test(out), out);
            assert.ok(!/__V/.test(out), 'no Verilator internals');
        });
        it('should move the paddle only if the design has paddle inputs', function () {
            var shot = (x) => {
                var png = path.join(fs.mkdtempSync(path.join(os.tmpdir(), '8bws-paddle-')), 'shot.png');
                cli('run', 'presets/verilog/ball_paddle.v', '-e', `paddle ${x} 128 1 0 0; run 4`, '--png', png);
                return fs.readFileSync(png);
            };
            assert.ok(!shot(40).equals(shot(200)), 'the screen follows the paddle');
            var e = cliFails('run', 'presets/verilog/hvsync_generator.v', '-e', 'paddle 1 1');
            assert.ok(/has no paddles/.test(e.stdout + e.stderr), e.stdout + e.stderr);
        });
    });

    describe('run --platform verilog: vcd', function () {
        var dir;
        before(function () { dir = fs.mkdtempSync(path.join(os.tmpdir(), '8bws-vcd-')); });
        it('should stream signal changes to a VCD file, and gzip a .gz name', function () {
            var plain = path.join(dir, 'a.vcd'), gz = path.join(dir, 'a.vcd.gz');
            var out = cli('run', 'presets/verilog/ball_paddle.v', '-e', `run 1; vcd ${plain}; run 1; vcd off; vcd ${gz}; run 1; vcd off`);
            assert.ok(/wrote \d+ clocks to .*a\.vcd\b/.test(out), out);
            var text = fs.readFileSync(plain, 'utf8');
            assert.ok(text.startsWith('$version'), text.slice(0, 80));
            assert.ok(/\$var wire 9 \S+ hpos \[8:0\] \$end/.test(text));
            assert.ok(/^#0\n\$dumpvars$/m.test(text));
            var unzipped = require('zlib').gunzipSync(fs.readFileSync(gz)).toString('utf8');
            assert.ok(unzipped.startsWith('$version'));
            assert.ok(fs.statSync(gz).size < unzipped.length / 2, 'gzip shrinks it');
        });
        it('should close the file even if the script forgets `vcd off`', function () {
            var f = path.join(dir, 'b.vcd');
            cli('run', 'presets/verilog/ball_paddle.v', '-e', `vcd ${f}; run 1`);
            assert.ok(/\n#\d+\n$/.test(fs.readFileSync(f, 'utf8')), 'ends with a final time stamp');
        });
        it('should stop at the size limit, between clocks', function () {
            var f = path.join(dir, 'd.vcd');
            var out = cli('run', 'presets/verilog/ball_paddle.v', '-e', `vcd ${f} 0.5; run 2; vcd off`);
            assert.ok(/stopped at the size limit/.test(out), out);
            var size = fs.statSync(f).size;
            // about 2.7MB a frame, so the half megabyte is passed by a chunk or two, not by the two frames
            assert.ok(size >= 0.5 * 1048576 && size < 0.7 * 1048576, 'size ' + size);
            assert.ok(/\n#\d+\n$/.test(fs.readFileSync(f, 'utf8')), 'still ends cleanly');
        });
        it('should say so when the platform has no signals', function () {
            var e = cliFails('run', '--platform', 'apple2', '-e', `vcd ${path.join(dir, 'c.vcd')}`, 'test/roms/apple2/cosmic.c.rom');
            assert.ok(/no signals to record/.test(e.stdout + e.stderr), e.stdout + e.stderr);
        });
    });

    describe('run: emulator control', function () {
        // these all reach through the Platform to its Machine (common/devices.ts)
        it('should reject an unknown platform', function () {
            cliFails('run', '--platform', 'nosuchplatform', '--frames', '1', 'test/roms/apple2/cosmic.c.rom');
        });
        it('should disassemble a 6502 platform', function () {
            var out = cli('run', '--platform', 'apple2', '-e', 'run 20; pc 2', 'test/roms/apple2/cosmic.c.rom');
            assert.ok(/PC=\$[0-9A-F]{4}/.test(out), out);
            assert.ok(/\$[0-9A-F]{4}\s+[0-9A-F]{2}/.test(out), out);
        });
        it('should disassemble 65C02 opcodes on apple2.enh', function () {
            var out = cli('run', '--platform', 'apple2.enh', '-e', 'pc 12', 'test/roms/apple2.enh/enh65c02.rom');
            assert.ok(/STZ \$0600/.test(out), out);
            assert.ok(/^\s+\$080D\s+DA\s+PHX$/m.test(out), out);
            assert.ok(/BRA \$0817/.test(out), out);
        });
        it('should not decode 65C02 opcodes on a plain apple2', function () {
            var out = cli('run', '--platform', 'apple2', '-e', 'pc 12', 'test/roms/apple2/enh65c02.rom');
            // $9C is an unofficial NMOS opcode (SHY), and $DA/$80 are NOPs there
            assert.ok(/SHY \$0600,x/.test(out), out);
            assert.ok(!/STZ|PHX|BRA/.test(out), out);
        });
        it('should disassemble a z80 platform', function () {
            var out = cli('run', '--platform', 'vicdual', '-e', 'run 20; pc 2', 'test/roms/vicdual/snake1.c.rom');
            assert.ok(/PC=\$[0-9A-F]{4}/.test(out), out);
        });
        it('should disassemble a 6809 platform', function () {
            var out = cli('run', '--platform', 'williams', '-e', 'run 20; pc 2', 'test/roms/williams/vidfill.asm.rom');
            assert.ok(!/no disassembler/.test(out), out);
        });
        it('should step one instruction at a time', function () {
            var out = cli('run', '--platform', 'apple2', '-e', 'run 20; step 3', 'test/roms/apple2/cosmic.c.rom');
            var addrs = out.match(/^\s+\$[0-9A-F]{4}\s/gm) || [];
            assert.equal(addrs.length, 3, out);
            // 6502 registers and flags should be shown while stepping
            assert.ok(/A=\$[0-9A-F]{2} X=\$[0-9A-F]{2} Y=\$[0-9A-F]{2} SP=\$[0-9A-F]{2} [NnVvDdIiZzCc]{6}/.test(out), out);
        });
        it('should step and step back on nes (jsnes)', function () {
            var out = cli('run', '--platform', 'nes', '-e', 'run 5; step 3; back 2; pc 1', 'test/roms/nes/shoot2.c.rom');
            assert.ok(!/does not support|only checks the PC at frame boundaries/.test(out), out);
            // stopped 3 instructions into frame 5, then back to the 1st
            assert.ok(/^\[5:3\] PC=/m.test(out), out);
            assert.ok(/^\[5:1\] back 2: PC=\$[0-9A-F]{4}/m.test(out), out);
        });
        it('should record an instruction history', function () {
            var out = cli('run', '--platform', 'apple2', '-e', 'run 20; hist 5', 'test/roms/apple2/cosmic.c.rom');
            assert.ok(/instructions shown/.test(out), out);
        });
        it('should send keys to a platform without a Machine', function () {
            // nes registers its key handler on the video, like it does in the IDE
            var out = cli('run', '--platform', 'nes', '-e', 'run 5; keydown enter; run 5; keyup enter', 'test/roms/nes/shoot2.c.rom');
            assert.ok(/keyup enter/.test(out), out);
        });
        it('should dump memory', function () {
            var out = cli('run', '--platform', 'apple2', '-f', '20', '--memdump', '400,40f', 'test/roms/apple2/cosmic.c.rom');
            assert.ok(/^0400:( [0-9A-F]{2}){8}/m.test(out), out);
        });
    });

    describe('run script', function () {
        it('should reject an unknown command', function () {
            cliFails('run', '--platform', 'apple2', '-e', 'frobnicate', 'test/roms/apple2/cosmic.c.rom');
        });
        it('should run a script from a file', function () {
            var f = path.join(os.tmpdir(), '8bws-test.script');
            fs.writeFileSync(f, '# comment\nrun 5\necho hello-from-script\n');
            var out = cli('run', '--platform', 'apple2', '--script', f, 'test/roms/apple2/cosmic.c.rom');
            assert.ok(/hello-from-script/.test(out), out);
        });
        it('should resolve symbols from a label file', function () {
            var f = path.join(os.tmpdir(), '8bws-test.lbl');
            fs.writeFileSync(f, 'al 004000 .mysym\n');
            var out = cli('run', '--platform', 'apple2', '--symbols', f, '-e', 'break mysym 2', 'test/roms/apple2/cosmic.c.rom');
            assert.ok(/break \$4000/.test(out), out);
        });
    });

    describe('apple2 TGI drivers', function () {
        // build a one-file program next to the preset driver, run it, return the script output
        function runTGI(body, headers, script) {
            var dir = fs.mkdtempSync(path.join(os.tmpdir(), '8bws-tgi-'));
            for (var f of ['a2hires.s', 'a2hires.h']) {
                fs.copyFileSync(path.join('presets/apple2', f), path.join(dir, f));
            }
            var src = path.join(dir, 'main.c');
            fs.writeFileSync(src, headers + '\nint main(void) {\n' + body + '\nfor(;;);\n}\n');
            return cli('run', '--platform', 'apple2', src, '-e', script);
        }
        it('hires driver should draw pixels and lines on page 2', function () {
            var out = runTGI(
                'tgi_install(a2hires_tgi); tgi_init(); tgi_clear();' +
                'tgi_setcolor(3); tgi_setpixel(0, 0); tgi_setpixel(279, 191);' +
                'tgi_setcolor(5); tgi_line(0, 8, 13, 8);',
                '#include <tgi.h>\n#include "a2hires.h"\n//#link "a2hires.s"',
                'run 20; mem $4000 2; mem $4080 2; mem $5FF0 8');
            assert.ok(/^4000: 01 00/m.test(out), out);       // white pixel at 0,0
            assert.ok(/^4080: AA D5/m.test(out), out);       // orange line: odd columns + palette bit
            assert.ok(/^5FF0: 00 00 00 00 00 00 00 40/m.test(out), out); // last pixel
        });
        it('lores driver should install and draw (stray branch in cc65 a2.lo.s)', function () {
            var out = runTGI(
                'tgi_install(a2_lo_tgi); tgi_init(); tgi_clear();' +
                'tgi_setcolor(15); tgi_bar(0, 0, 39, 9);',
                '#include <tgi.h>',
                'run 30; pc 1; mem $400 4');
            assert.ok(!/PC=\$0000/.test(out), out);        // not crashed into zero page
            assert.ok(/^0400: (?!00 00 00 00)/m.test(out), out); // lo-res memory was written
        });
    });

    describe('legacy aliases', function () {
        it('should accept compile, check and compilerun', function () {
            assert.equal(cliJSON('compile', '--platform', 'gb', 'presets/gb/hello.c', '--check').command, 'check');
            assert.equal(cliJSON('check', '--platform', 'gb', 'presets/gb/hello.c').command, 'check');
            assert.ok(cliJSON('compilerun', '--platform', 'gb', 'presets/gb/hello.c', '--frames', '5').success);
        });
    });
});
