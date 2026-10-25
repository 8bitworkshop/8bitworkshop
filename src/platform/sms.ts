
import { GameGear, SG1000, SMS } from "../machine/sms";
import { Platform, BaseZ80MachinePlatform } from "../common/baseplatform";
import { PLATFORMS } from "../common/emu";
import { getToolForFilename_sms } from "../common/toolselect";

// TODO: merge w/ coleco
export var SG1000_PRESETS = [
  {id:'text.c', name:'Text Mode'},
  {id:'hello.c', name:'Scrolling Text'},
  {id:'text32.c', name:'32-Column Color Text'},
  {id:'stars.c', name:'Scrolling Starfield'},
  {id:'cursorsmooth.c', name:'Moving Cursor'},
  {id:'simplemusic.c', name:'Simple Music'},
  {id:'musicplayer.c', name:'Multivoice Music'},
  {id:'mode2bitmap.c', name:'Mode 2 Bitmap'},
  {id:'mode2compressed.c', name:'Mode 2 Bitmap (LZG)'},
  {id:'lines.c', name:'Mode 2 Lines'},
  {id:'multicolor.c', name:'Multicolor Mode'},
  {id:'siegegame.c', name:'Siege Game'},
  {id:'shoot.c', name:'Solarian Game'},
  {id:'climber.c', name:'Climber Game'},
  {id:'hello.bas', name:'Hello World (CVBasic)', category:'CVBasic'},
];

const LIB_CV_SMS_PRESETS = [
  { id: 'mode4test.c', name: 'Mode 4 Test' },
  { id: 'text.c', name: 'Text Mode' },
  { id: 'hello.c', name: 'Scrolling Text' },
  { id: 'text32.c', name: '32-Column Color Text' },
  { id: 'stars.c', name: 'Scrolling Starfield' },
  { id: 'cursorsmooth.c', name: 'Moving Cursor' },
  { id: 'simplemusic.c', name: 'Simple Music' },
  { id: 'musicplayer.c', name: 'Multivoice Music' },
  { id: 'siegegame.c', name: 'Siege Game' },
  { id: 'climber.c', name: 'Climber Game' },
  { id: 'solarian.c', name: 'Solarian Game' },
];

// Solarian hardcodes an SMS mode-4 CRAM palette, so it is not offered on Game Gear.
export var SMS_PRESETS = [
  ...LIB_CV_SMS_PRESETS,
  {id:'hello.bas', name:'Hello World (CVBasic)', category:'CVBasic'},
];

export var GG_PRESETS = [
  ...LIB_CV_SMS_PRESETS
];

///

class SG1000Platform extends BaseZ80MachinePlatform<SG1000> implements Platform {

  newMachine()          { return new SG1000(); }
  getPresets()          { return SG1000_PRESETS; }
  getToolForFilename = getToolForFilename_sms;
  getDefaultExtensions() { return [...super.getDefaultExtensions(), ".bas"]; }

  readAddress(a)        { return this.machine.read(a); }
  readVRAMAddress(a)    { return this.machine.readVRAMAddress(a); }
}

class SMSPlatform extends BaseZ80MachinePlatform<SMS> implements Platform {

  newMachine()          { return new SMS(); }
  getPresets()          { return SMS_PRESETS; }
  getToolForFilename = getToolForFilename_sms;
  getDefaultExtensions() { return [...super.getDefaultExtensions(), ".bas"]; }

  readAddress(a)        { return this.machine.read(a); }
  readVRAMAddress(a)    { return this.machine.readVRAMAddress(a); }
}

class GameGearPlatform extends BaseZ80MachinePlatform<GameGear> implements Platform {

  newMachine()          { return new GameGear(); }
  getPresets()          { return GG_PRESETS; }
  getToolForFilename = getToolForFilename_sms;
  getDefaultExtensions() { return [...super.getDefaultExtensions(), ".bas"]; }

  readAddress(a)        { return this.machine.read(a); }
  readVRAMAddress(a)    { return this.machine.readVRAMAddress(a); }
}

///

PLATFORMS['sms-sg1000-libcv'] = SG1000Platform;
PLATFORMS['sms-sms-libcv'] = SMSPlatform;
PLATFORMS['sms-gg-libcv'] = GameGearPlatform;
