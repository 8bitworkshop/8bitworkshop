var assert = require('assert');
var { loadPlatform } = require('../../gen/tools/emutarget.js');

/*
    A tiny cartridge that programs the VIC-I and draws two characters, so
    that the text window can be checked.

    The cartridge file has a 2 byte load address, then the cold and warm
    start vectors, then the "A0CBM" signature; the code is loaded at $A009:

        $A009  A9 1B       LDA #$1B      ; bg color white, border color cyan
        $A00B  8D 0F 90    STA $900F
        $A00D  A9 19       LDA #$19      ; upper border = raster line 25
        $A00F  8D 01 90    STA $9001
        $A011  A9 F0       LDA #$F0      ; screen pointer A13..A10
        $A013  8D 05 90    STA $9005
        $A015  A9 96       LDA #$96      ; screen pointer A9
        $A017  8D 02 90    STA $9002
        $A019  A9 00       LDA #$00      ; clear the screen page
        $A01B  A2 00       LDX #$00
        $A01D  9D 00 1E    STA $1E00,X
        $A020  9D 00 1F    STA $1F00,X
        $A023  E8          INX
        $A024  D0 F7       BNE $A01D
        $A026  A9 06       LDA #$06      ; clear the color RAM, blue
        $A028  A2 00       LDX #$00
        $A02A  9D 00 96    STA $9600,X
        $A02D  E8          INX
        $A02E  E0 28       CPX #$28
        $A030  D0 F8       BNE $A02A
        $A032  A9 48       LDA #'H'
        $A034  8D 00 1E    STA $1E00
        $A037  A9 49       LDA #'I'
        $A039  8D 01 1E    STA $1E01
        $A03C  4C 40 A0    JMP $A040
        $A03F  00
        $A040  4C 40 A0    JMP $A040
*/
var CART = [
    0x00, 0xA0, 0x09, 0xA0, 0x09, 0xA0, 0x41, 0x30, 0xC3, 0xC2, 0xCD, 0xA9,
    0x1B, 0x8D, 0x0F, 0x90, 0xA9, 0x19, 0x8D, 0x01, 0x90, 0xA9, 0xF0, 0x8D,
    0x05, 0x90, 0xA9, 0x96, 0x8D, 0x02, 0x90, 0xA9, 0x00, 0xA2, 0x00, 0x9D,
    0x00, 0x1E, 0x9D, 0x00, 0x1F, 0xE8, 0xD0, 0xF7, 0xA9, 0x06, 0xA2, 0x00,
    0x9D, 0x00, 0x96, 0xE8, 0xE0, 0x28, 0xD0, 0xF8, 0xA9, 0x48, 0x8D, 0x00,
    0x1E, 0xA9, 0x49, 0x8D, 0x01, 0x1E, 0x4C, 0x40, 0xA0,
];

var CYAN = 0xFFFFF04D;

describe('VIC-20 video', function () {
    it('should draw the 22 column text window centered in the frame', async function () {
        this.timeout(60000);
        var target = await loadPlatform('vic20');
        await target.start();
        var video = target.getVideo();
        assert.equal(video.width, 232);
        assert.equal(video.height, 272);
        // load the cartridge that programs the VIC
        await target.loadROM(new Uint8Array(CART), 'cart.bin');
        // run until the cartridge has set up the screen (with a real KERNAL
        // this takes a moment, with the stub BIOS it is immediate)
        var color = function () { return -1; };
        for (var i = 0; i < 300; i++) {
            target.advanceFrame();
            video = target.getVideo();
            var px = video.pixels;
            color = function (x, y) { return px[y * video.width + x]; };
            if (color(0, 100) == CYAN) break;
        }
        assert.equal(color(0, 100), CYAN, 'the cartridge screen did not appear');
        // the cartridge sets the colors before the window position, so let
        // a few more frames pass before the picture is checked
        for (var i = 0; i < 5; i++) {
            target.advanceFrame();
        }
        video = target.getVideo();
        px = video.pixels;
        color = function (x, y) { return px[y * video.width + x]; };
        // the text window is 22 columns (176 pixels) wide and centered, so
        // there are 28 pixels of border color on either side. The pixels
        // inside the window are the background color or a character, but
        // never the border color.
        assert.equal(color(0, 100), CYAN, 'left border');
        assert.equal(color(27, 100), CYAN, 'left border');
        assert.notEqual(color(28, 100), CYAN, 'first text column');
        assert.notEqual(color(203, 100), CYAN, 'last text column');
        assert.equal(color(204, 100), CYAN, 'right border');
        assert.equal(color(231, 100), CYAN, 'right border');
        // the window is 23 rows (184 lines) tall, starting at raster line 25
        assert.equal(color(100, 25), CYAN, 'above the text window');
        assert.notEqual(color(100, 26), CYAN, 'first text row');
        assert.notEqual(color(100, 209), CYAN, 'last text row');
        assert.equal(color(100, 210), CYAN, 'below the text window');
    });
});

describe('VIC-20 debug info', function () {
    it('should show the VIA and VIC-I state of the cartridge', async function () {
        this.timeout(60000);
        var target = await loadPlatform('vic20');
        await target.start();
        await target.loadROM(new Uint8Array(CART), 'cart.bin');
        for (var i = 0; i < 60; i++) target.advanceFrame();
        var info = {};
        for (var section of target.getDebugInfo()) info[section.category] = section.text;
        assert.ok(info['CPU'], 'CPU');
        assert.ok(info['ZPRAM'], 'ZPRAM');
        assert.ok(info['VIA'], 'VIA');
        assert.ok(info['VIC'], 'VIC');
        // the cartridge programs $900F/$9001/$9005/$9002
        assert.ok(info['VIC'].indexOf('Screen: $1E00') >= 0, info['VIC']);
        assert.ok(info['VIC'].indexOf('Char: ROM $8000') >= 0, info['VIC']);
        assert.ok(info['VIC'].indexOf('Border 3  Background 1') >= 0, info['VIC']);
        assert.ok(info['VIC'].indexOf('$9000: 00 19 96 00 00 F0') >= 0, info['VIC']);
        assert.ok(info['VIA'].indexOf('VIA 1 ($9110)') >= 0, info['VIA']);
        assert.ok(info['VIA'].indexOf('VIA 2 ($9120)') >= 0, info['VIA']);
        // the ZP/stack pane reads the machine's zero page and stack, not
        // some other offset into the machine state
        var state = target.saveState();
        for (var a = 0; a < 0x200; a++) {
            assert.equal(state.ram[a], target.read(a), 'RAM $' + a.toString(16));
        }
    });
});

/*
    PRG files that write 'H' (screen code 8) to the top left of the screen
    and spin, once as a BASIC stub (10 SYS4109, the machine code follows it)
    and once as plain machine code in the tape buffer.

        LDA #$08       ; A9 08
        STA $1E00      ; 8D 00 1E
        JMP *          ; 4C xx xx
*/
function code(addr) {
    return [0xA9, 0x08, 0x8D, 0x00, 0x1E, 0x4C, (addr + 5) & 0xFF, (addr + 5) >> 8];
}
var SYS_PRG = [0x01, 0x10, 0x0B, 0x10, 0x0A, 0x00, 0x9E, 0x34, 0x31, 0x30, 0x39, 0x00, 0x00, 0x00]
    .concat(code(0x100D));
var RAW_PRG = [0x3C, 0x03].concat(code(0x033C));

describe('VIC-20 quickload', function () {
    [['a BASIC stub with SYS', SYS_PRG], ['machine code at the load address', RAW_PRG]].forEach(function (t) {
        it('should run ' + t[0], async function () {
            this.timeout(60000);
            var target = await loadPlatform('vic20');
            await target.start();
            await target.loadROM(new Uint8Array(t[1]), 'test.prg');
            for (var i = 0; i < 60; i++) target.advanceFrame();
            assert.equal(target.read(0x1E00), 8, 'the program did not run');
        });
    });
});
