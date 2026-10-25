
import { MSX1 } from "../machine/msx";
import { Platform, BaseZ80MachinePlatform } from "../common/baseplatform";
import { PLATFORMS } from "../common/emu";
import { getToolForFilename_msx } from "../common/toolselect";

// https://github.com/Konamiman/MSX2-Technical-Handbook
// https://www.msx.org/wiki/MSX_Cartridge_slot
// http://map.grauw.nl/resources/msx_io_ports.php
// https://openmsx.org/manual/setup.html
// https://www.msx.org/wiki/Slots
// https://www.msx.org/wiki/SDCC
// https://github.com/gseidler/The-MSX-Red-Book/blob/master/the_msx_red_book.md

var MSX_BIOS_PRESETS = [
  {id:'helloworld.asm', name:'Hello World (ASM)'},
  {id:'redbook_kbd.asm', name:'Redbook Keyboard Scanner (ASM)'},
  {id:'siegegame.c',    name:'Siege Game'},
  {id:'eliza.c',        name:'Eliza'},
  {id:'hello.wiz',      name:'Hello (Wiz)'},
  {id:'hello.bas',      name:'Hello World (CVBasic)', category:'CVBasic'},
];

// TODO: share with coleco, sms
var LIBCV_PRESETS = [
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
];

class MSXPlatform extends BaseZ80MachinePlatform<MSX1> implements Platform {

  newMachine()          { return new MSX1(); }
  getPresets()          { return MSX_BIOS_PRESETS; }
  getToolForFilename = getToolForFilename_msx;
  getDefaultExtensions() { return [...super.getDefaultExtensions(), ".bas"]; }

  readAddress(a)        { return this.machine.read(a); }
  readVRAMAddress(a)    { return this.machine.readVRAMAddress(a); }
  getMemoryMap = function() { return { main:[
      {name:'BIOS',start:0x0,size:0x4000,type:'rom'},
      //{name:'Cartridge',start:0x4000,size:0x4000,type:'rom'},
      {name:'RAM',start:0xc000,size:0x3200,type:'ram'},
      {name:'Stack',start:0xf000,size:0x300,type:'ram'},
      {name:'BIOS Work RAM',start:0xf300,size:0xd00},
  ] } };
}

class MSXLibCVPlatform extends MSXPlatform implements Platform {
  getPresets() { return LIBCV_PRESETS; }
}

PLATFORMS['msx'] = MSXPlatform;
PLATFORMS['msx-libcv'] = MSXLibCVPlatform;
