
import { Base6809MachinePlatform, Platform } from "../common/baseplatform";
import { PLATFORMS } from "../common/emu";
import { CoCoMachine } from "../machine/coco";

const COCO_PRESETS = [
  { id: 'hello.c', name: 'Hello World' },
  { id: 'gfx.c', name: 'Graphics Modes' },
  { id: 'joysound.c', name: 'Joystick and Sound' },
];

const COCO_MEMORY_MAP = { main: [
  { name: 'Direct Page / BASIC vars', start: 0x0000, size: 0x0400, type: 'ram' },
  { name: 'Text Screen',    start: 0x0400, size: 0x0200, type: 'ram' },
  { name: 'RAM',            start: 0x0600, size: 0x7a00, type: 'ram' },
  { name: 'Extended BASIC ROM', start: 0x8000, size: 0x2000, type: 'rom' },
  { name: 'Color BASIC ROM',    start: 0xa000, size: 0x2000, type: 'rom' },
  { name: 'Cartridge ROM',  start: 0xc000, size: 0x3f00, type: 'rom' },
  { name: 'PIA0 (keyboard, joysticks)', start: 0xff00, size: 0x20, type: 'io' },
  { name: 'PIA1 (sound, video mode)',   start: 0xff20, size: 0x20, type: 'io' },
  { name: 'Cartridge / disk I/O',       start: 0xff40, size: 0x20, type: 'io' },
  { name: 'SAM',            start: 0xffc0, size: 0x20, type: 'io' },
  { name: 'Vectors',        start: 0xffe0, size: 0x20, type: 'rom' },
] };

class CoCoPlatform extends Base6809MachinePlatform<CoCoMachine> implements Platform {

  newMachine()          { return new CoCoMachine(); }
  getPresets()          { return COCO_PRESETS; }
  readAddress(a)        { return this.machine.readConst(a); }
  getMemoryMap()        { return COCO_MEMORY_MAP; }
  getROMExtension(rom: Uint8Array) { return ".bin"; }
  showHelp()            { return "https://8bitworkshop.com/docs/platforms/coco/"; }
}

PLATFORMS['coco'] = CoCoPlatform;
