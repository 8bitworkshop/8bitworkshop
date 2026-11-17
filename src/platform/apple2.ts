
import { Platform, Preset, getOpcodeMetadata_6502, getToolForFilename_6502 } from "../common/baseplatform";
import { getToolForFilename_apple2 } from "../common/toolselect";
import { PLATFORMS } from "../common/emu";
import { AppleII } from "../machine/apple2";
import { Base6502MachinePlatform } from "../common/baseplatform";
import { CodeAnalyzer_apple2 } from "../common/analysis";
import { BaseMAME6502Platform } from "../common/mameplatform";

const APPLE2_PRESETS: Preset[] = [
  { id: 'sieve.c', name: 'Sieve', category: "C" },
  { id: 'keyboardtest.c', name: 'Keyboard Test' },
  { id: 'mandel.c', name: 'Mandelbrot' },
  { id: 'tgidemo.c', name: 'TGI Graphics Demo' },
  { id: 'icepiano.c', name: 'Ice Piano (Hires Demo)' },
  { id: 'Eliza.c', name: 'Eliza' },
  { id: 'siegegame.c', name: 'Siege Game' },
  { id: 'cosmic.c', name: 'Cosmic Impalas' },
  { id: 'farmhouse.c', name: "Farmhouse Adventure" },
  { id: 'yum.c', name: "Yum Dice Game" },
  { id: 'lz4test.c', name: "LZ4 Decompressor" },
  { id: 'hgrtest.a', name: "HGR Test", category: "Assembly" },
  { id: 'conway.a', name: "Conway's Game of Life" },
  { id: 'lz4fh.a', name: "LZ4FH Decompressor" },
  { id: 'deltamod.dasm', name: "Delta Modulation Audio" },
  { id: 'paddles.dasm', name: "Paddles/Joystick" },
  { id: 'mockingboard.c', name: "Mockingboard Music" },
  //  {id:'zap.dasm', name:"ZAP!"},
  //  {id:'tb_6502.s', name:'Tom Bombem (assembler game)'},
  { id: 'dos33bin.a', name: "DOS 3.3 Binary" },
  { id: 'applesinglebin.a', name: "AppleSingle Binary" },
  { id: 'hello-sdcc.c', name: 'Hello World (SDCC)', category: "C (SDCC)" },
  { id: 'cosmic-sdcc.c', name: 'Cosmic Impalas (SDCC)' },
];

/// MAME support

class Apple2MAMEPlatform extends BaseMAME6502Platform implements Platform {

  // MAME's apple2e driver emulates a //e, so it has a 65C02
  cpu65c02 = true;

  start() {
    this.startModule(this.mainElement, {
      jsfile: 'mame8bitpc.js',
      biosfile: ['apple2e.zip'],
      //cfgfile:'nes.cfg',
      driver: 'apple2e',
      width: 280 * 2,
      height: 192 * 2,
      //romfn:'/emulator/cart.nes',
      //romsize:romSize,
      //romdata:new lzgmini().decode(lzgRom).slice(0, romSize),
      preInit: function (_self) {
      },
    });
  }

  getOpcodeMetadata = getOpcodeMetadata_6502;
  getDefaultExtensions() { return [".c", ".sdcc", ".cpp", ".acme", ".xa", ".ca65", ".dasm", ".ecs", ".wiz"]; }
  getToolForFilename = getToolForFilename_apple2;

  getPresets() { return APPLE2_PRESETS; }

  loadROM(title, data) {
    this.loadROMFile(data);
    // TODO
  }
}

///

class NewApple2Platform extends Base6502MachinePlatform<AppleII> implements Platform {

  newMachine() { return new AppleII(); }
  resume() {
    super.resume();
    this.machine && this.machine.startAudio();
  }
  pause() {
    super.pause();
    this.machine && this.machine.stopAudio();
  }
  getPresets() { return APPLE2_PRESETS; }
  getDefaultExtensions() { return [...super.getDefaultExtensions(), ".lnk"]; }
  readAddress(a) { return this.machine.readConst(a); }
  // A real 16K //e ROM can be dropped in as "apple2.enh.rom"; the built-in
  // Apple2Go ROM keeps booting the same way when there isn't one.
  getMemoryMap = function () {
    return {
      main: [
        { name: 'Zero Page RAM', start: 0x0, size: 0x100, type: 'ram' },
        { name: 'Line Input RAM', start: 0x200, size: 0x100, type: 'ram' },
        { name: 'RAM', start: 0x300, size: 0xc0, type: 'ram' },
        { name: 'DOS Vectors', start: 0x3c0, size: 0x40, type: 'ram' },
        { name: 'Text/Lores Page 1', start: 0x400, size: 0x400, type: 'ram' },
        { name: 'RAM', start: 0x800, size: 0x1800, type: 'ram' },
        { name: 'Hires Page 1', start: 0x2000, size: 0x2000, type: 'ram' },
        { name: 'Hires Page 2', start: 0x4000, size: 0x2000, type: 'ram' },
        { name: 'RAM', start: 0x6000, size: 0x6000, type: 'ram' },
        { name: 'I/O', start: 0xc000, size: 0x1000, type: 'io' },
        { name: 'ROM', start: 0xd000, size: 0x3000, type: 'rom' },
      ]
    }
  };
  getROMExtension(rom: Uint8Array) {
    if (rom && rom.length == 35 * 16 * 256) return ".dsk"; // DSK image
    return ".bin";
  };
  getToolForFilename = getToolForFilename_apple2;
  /*
  newCodeAnalyzer() {
    return new CodeAnalyzer_apple2(this);
  }
  getOriginPC() {
    return 0x803; // TODO?
  }
  */
}

/// Apple //e (enhanced): 128K, 80-column text, double hi-res.
///
/// Named `apple2.enh` so `getBasePlatform()` resolves it to `apple2`: the
/// presets, toolchain filesystem and tool selection are shared with the II+
/// platform, the same way `gb.color` shares `presets/gb/`.
class NewApple2EnhancedPlatform extends NewApple2Platform implements Platform {
  newMachine() { return new AppleII(true); }
  // the //e has a 65C02, so disassemble STZ/BRA/PHX/... instead of NOPs and KILs
  cpu65c02 = true;
  // and take instruction lengths/cycles from its (patched) table, not the NMOS copy
  getOpcodeMetadata = (opcode: number, address: number) =>
    this.machine ? this.machine.cpu.getOpcodeMetadata(opcode) : getOpcodeMetadata_6502(opcode, address);
  getMemoryMap = function () {
    return {
      main: [
        { name: 'Zero Page RAM', start: 0x0, size: 0x100, type: 'ram' },
        { name: 'Line Input RAM', start: 0x200, size: 0x100, type: 'ram' },
        { name: 'RAM', start: 0x300, size: 0xc0, type: 'ram' },
        { name: 'DOS Vectors', start: 0x3c0, size: 0x40, type: 'ram' },
        { name: 'Text/Lores Page 1', start: 0x400, size: 0x400, type: 'ram' },
        { name: 'RAM', start: 0x800, size: 0x1800, type: 'ram' },
        { name: 'Hires Page 1', start: 0x2000, size: 0x2000, type: 'ram' },
        { name: 'Hires Page 2', start: 0x4000, size: 0x2000, type: 'ram' },
        { name: 'RAM', start: 0x6000, size: 0x6000, type: 'ram' },
        { name: 'I/O', start: 0xc000, size: 0x1000, type: 'io' },
        { name: 'ROM', start: 0xd000, size: 0x3000, type: 'rom' },
      ],
      aux: [
        { name: 'Aux RAM (RAMRD/RAMWRT)', start: 0x200, size: 0xbe00, type: 'ram' },
      ]
    }
  };
}

PLATFORMS['apple2.mame'] = Apple2MAMEPlatform;
PLATFORMS['apple2'] = NewApple2Platform;
PLATFORMS['apple2.enh'] = NewApple2EnhancedPlatform;
