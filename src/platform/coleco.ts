
import { ColecoVision } from "../machine/coleco";
import { Platform, BaseZ80MachinePlatform, getToolForFilename_z80 } from "../common/baseplatform";
import { getToolForFilename_coleco } from "../common/toolselect";
import { PLATFORMS } from "../common/emu";
import { BaseMAMEZ80Platform } from "../common/mameplatform";

export var ColecoVision_PRESETS = [
  { id: 'text.c', name: 'Text Mode' },
  { id: 'hello.c', name: 'Scrolling Text' },
  { id: 'text32.c', name: '32-Column Color Text' },
  { id: 'stars.c', name: 'Scrolling Starfield' },
  { id: 'cursorsmooth.c', name: 'Moving Cursor' },
  { id: 'simplemusic.c', name: 'Simple Music' },
  { id: 'musicplayer.c', name: 'Multivoice Music' },
  { id: 'mode2bitmap.c', name: 'Mode 2 Bitmap' },
  { id: 'mode2compressed.c', name: 'Mode 2 Bitmap (LZG)' },
  { id: 'lines.c', name: 'Mode 2 Lines' },
  { id: 'multicolor.c', name: 'Multicolor Mode' },
  { id: 'siegegame.c', name: 'Siege Game' },
  { id: 'shoot.c', name: 'Solarian Game' },
  { id: 'climber.c', name: 'Climber Game' },
  { id: 'hello.bas', name: 'Hello World (CVBasic)', category: 'CVBasic' },
  { id: 'happy_face.bas', name: 'Bouncing Face (CVBasic)', category: 'CVBasic' },
];

class ColecoVisionPlatform extends BaseZ80MachinePlatform<ColecoVision> implements Platform {

  newMachine()          { return new ColecoVision(); }
  getPresets()          { return ColecoVision_PRESETS; }
  getToolForFilename = getToolForFilename_coleco;
  getDefaultExtensions() { return [...super.getDefaultExtensions(), ".bas"]; }
  readAddress(a)        { return this.machine.read(a); }
  readVRAMAddress(a)    { return this.machine.readVRAMAddress(a); }
  // TODO loadBIOS(bios)	{ this.machine.loadBIOS(a); }
  getMemoryMap = function() { return { main:[
      {name:'BIOS',start:0x0,size:0x2000,type:'rom'},
      {name:'Cartridge Header',start:0x8000,size:0x100,type:'rom'},
  ] } };
  showHelp() {
    return "https://8bitworkshop.com/docs/platforms/coleco/";
  }
}

/// MAME support

class ColecoVisionMAMEPlatform extends BaseMAMEZ80Platform implements Platform {

  start() {
    this.startModule(this.mainElement, {
      jsfile: 'mame8bitws.js',
      cfgfile: 'coleco.cfg',
      biosfile: 'coleco/313 10031-4005 73108a.u2',
      driver: 'coleco',
      width: 280 * 2,
      height: 216 * 2,
      romfn: '/emulator/cart.rom',
      romsize: 0x8000,
      preInit: function(_self) {
      },
    });
  }

  loadROM(title, data) {
    this.loadROMFile(data);
    this.loadRegion(":coleco_cart:rom", data);
  }

  getPresets() { return ColecoVision_PRESETS; }

  getToolForFilename = getToolForFilename_coleco;
  getDefaultExtensions() { return [".c", ".ns", ".s", ".scc", ".sgb", ".z", ".wiz", ".bas"]; }
}


///

PLATFORMS['coleco.mame'] = ColecoVisionMAMEPlatform;
PLATFORMS['coleco'] = ColecoVisionPlatform;
