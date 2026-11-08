
var assert = require('assert');
var fs = require('fs');
var wtu = require('./workertestutils.js');
var fastpng = require('fast-png');

const dom = createTestDOM();
includeInThisContext('gen/common/cpu/6809.js');
includeInThisContext('tss/js/Log.js');
//global.Log = require('tss/js/Log.js').Log;
includeInThisContext('tss/js/tss/PsgDeviceChannel.js');
includeInThisContext('tss/js/tss/MasterChannel.js');
includeInThisContext('tss/js/tss/AudioLooper.js');

//var devices = require('gen/common/devices.js');
var emu = require('gen/common/emu.js');
var Keys = emu.Keys;
var audio = require('gen/common/audio.js');
var recorder = require('gen/common/recorder.js');
//var _6502 = require('gen/common/cpu/MOS6502.js');
var _apple2 = require('gen/platform/apple2.js');
//var m_apple2 = require('gen/machine/apple2.js');
var _vcs = require('gen/platform/vcs.js');
var _nes = require('gen/platform/nes.js');
var _vicdual = require('gen/platform/vicdual.js');
var _mw8080bw = require('gen/platform/mw8080bw.js');
var _galaxian = require('gen/platform/galaxian.js');
var _vector = require('gen/platform/vector.js');
var _williams = require('gen/platform/williams.js');
var _sound_williams = require('gen/platform/sound_williams.js');
var _astrocade = require('gen/platform/astrocade.js');
var _atari8 = require('gen/platform/atari8.js');
var _atari7800 = require('gen/platform/atari7800.js');
var _coleco = require('gen/platform/coleco.js');
var _sms = require('gen/platform/sms.js');
var _c64 = require('gen/platform/c64.js');
var _vectrex = require('gen/platform/vectrex.js');
var _coco = require('gen/platform/coco.js');
var _zx = require('gen/platform/zx.js');
// loadScript() evaluates scripts (vcs loads javatari/javatari.js) from the repo root
require('gen/tools/nodemock.js').mockScripts();

//

dom.window.HTMLCanvasElement.prototype.getContext = function() {
  return {
    getImageData: function(x,y,w,h) { return {data: new Uint32Array(w*h) }; },
    fillRect: function(x,y,w,h) { },
    drawImage: function(img,x,y,w,h) { },
    putImageData: function(data,w,h) { },
  };
}
global.navigator = {};

var keycallback;
var lastrastervideo;

emu.RasterVideo = function(mainElement, width, height, options) {
  var buffer;
  var datau8;
  var datau32;
  this.create = function() {
    this.width = width;
    this.height = height;
    buffer = new ArrayBuffer(width*height*4);
    datau8 = new Uint8Array(buffer);
    datau32 = new Uint32Array(buffer);
    lastrastervideo = this;
  }
  this.setKeyboardEvents = function(callback) {
    keycallback = callback;
  }
  this.getFrameData = function() { return datau32; }
  this.getImageData = function() { return {data:datau8, width:width, height:height}; }
  this.updateFrame = function() {}
  this.clearRect = function() {}
  this.setupMouseEvents = function() { }
  this.canvas = this;
  this.getContext = function() { return this; }
  this.fillRect = function() { }
  this.fillStyle = '';
  this.putImageData = function() { }
  this.style = {};
}

emu.VectorVideo = function(mainElement, width, height, options) {
  this.create = function() {
    this.drawops = 0;
  }
  this.setKeyboardEvents = function(callback) {
    keycallback = callback;
  }
  this.clear = function() { }
  this.drawLine = function() { this.drawops++; }
}

global.Worker = function() {
  this.msgcount = 0;
  this.postMessage = function() { this.msgcount++; }
}

global.Mousetrap = function() {
  this.bind = function() { }
}

//

function checkForBigNonTypedArrays(obj, path='') {
  if (typeof obj != 'object' || obj == null) return;
  Object.entries(obj).forEach((entry) => {
    if (entry[1] instanceof Array && entry[1].length > 200) {
      if (typeof entry[1][0] == 'number' && entry[1].buffer == null)
        throw new Error("array in save state not typed: " + path + '/' + entry[0]);
    }
    checkForBigNonTypedArrays(entry[1], path + '/' + entry[0]);
  });
}

async function testPlatform(platid, romname, maxframes, callback, romTransform) {
    if (!emu.PLATFORMS[platid]) throw new Error("no platform " + platid);
    var platform = new emu.PLATFORMS[platid](emudiv);
    await platform.start();
    var emudiv = document.getElementById('emulator');
    var rec = new recorder.StateRecorderImpl(platform);
    assert.ok(platform.saveState()); // can save before ROM load?
    var rom = fs.readFileSync('./test/roms/' + platid + '/' + romname);
    rom = new Uint8Array(rom);
    if (romTransform) romTransform(rom);
    platform.loadROM("ROM", rom);
    var state0a = platform.saveState();
    checkForBigNonTypedArrays(state0a);
    platform.reset(); // reset again
    var state0b = platform.saveState();
    //TODO: vcs fails assert.deepEqual(state0a, state0b);
    platform.resume(); // so that recorder works
    platform.setRecorder(rec);
    for (var i=0; i<maxframes; i++) {
      if (callback) callback(platform, i);
      platform.nextFrame();
      if (i==10) {
        for (var j=0; j<0x10000; j++)
          platform.readAddress(j); // make sure readAddress() doesn't leave side effects
      }
    }
    // test replay feature
    platform.pause();
    maxframes = Math.min(maxframes, rec.maxCheckpoints * rec.checkpointInterval);
    assert.equal(maxframes, rec.numFrames());
    var state1 = platform.saveState();
    platform.loadState(state1);
    assert.deepEqual(state1, platform.saveState());
    assert.equal(0, rec.loadFrame(0));
    assert.equal(1, rec.loadFrame(1));
    assert.equal(maxframes, rec.loadFrame(maxframes));
    var state2 = platform.saveState();
    assert.deepEqual(state1, state2);
    checkForBigNonTypedArrays(state2);
    // test memory reads not clearing stuff
    for (var i=0; i<=0xffff; i++)
      if (platform.readAddress) platform.readAddress(i);
    var state3 = platform.saveState();
    assert.deepEqual(state2, state3);
    // test debug info
    var debugs = platform.getDebugCategories();
    for (var dcat of debugs) {
      var dinfo = platform.getDebugInfo(dcat, state2);
      console.log(dcat, dinfo);
      assert.ok(dinfo && dinfo.length > 0, dcat + " empty");
      assert.ok(dinfo.length < 80*24, dcat + " too long");
      assert.ok(dinfo.indexOf('undefined') < 0, dcat + " undefined");
      assert.ok(dinfo.indexOf('Display On:  false') < 0, dcat + " display off");
    }
    // record video to file
    if (lastrastervideo) {
      var pngbuffer = fastpng.encode(lastrastervideo.getImageData())
      assert(pngbuffer.length > 500); // make sure PNG is big enough
      try { fs.mkdirSync("./test"); } catch(e) { }
      try { fs.mkdirSync("./test/output"); } catch(e) { }
      try {
        fs.writeFileSync("./test/output/"+platid+"-"+romname+".png", pngbuffer);
      } catch (e) { console.log(e) }
    }
    // probe
    var proberec = platform.startProbing && platform.startProbing();
    if (proberec) {
      proberec.reset(0x100000);
      proberec.singleFrame = false;
      var lastclk = 0;
      for (var i=0; i<5; i++) {
        platform.nextFrame(true);
        var clks = proberec.countClocks();
        console.log(proberec.idx, clks - lastclk, proberec.sl);
        lastclk = clks;
      }
      assert.equal(clks, proberec.countClocks());
    }
    // debugging
    let bpState = null;
    if (platform.setupDebug) {
      let stated1 = platform.saveState();
      platform.setupDebug((state,msg) => {
        bpState = state;
      });
      if (platform.step) platform.step();
      platform.nextFrame();
      platform.clearDebug();
      let stated3 = platform.saveState();
      assert.ok(bpState);
      console.log(stated1.c.PC, bpState.c.PC, stated3.c.PC);
      assert.equal(stated1.c.PC, stated3.c.PC);
    }
    // debug tree
    if (platform.getDebugTree != null) {
      var dbgtree = platform.getDebugTree();
      if (dbgtree != null) JSON.stringify(dbgtree);
    }
    // misc
    var exts = platform.getDefaultExtensions();
    assert.ok(Array.isArray(exts));
    assert.ok(exts.length > 0);
    exts.forEach(ext => assert.ok(ext.startsWith('.')));
    if (platform.getROMExtension) assert.ok(platform.getROMExtension().startsWith("."));
    // load state again
    platform.loadState(state3);
    return platform;
}

// Builds a minimal bootable ATR: the boot sector loads a short program at
// $2000 that writes $42 to $0600 and loops forever.
function makeTestATR() {
  const NUM_SECTORS = 128, SECTOR_SIZE = 128;
  const paragraphs = (16 + NUM_SECTORS * SECTOR_SIZE) / 16;
  const data = new Uint8Array(paragraphs * 16);
  data[0] = 0x96; data[1] = 0x02;
  data[2] = paragraphs & 0xff; data[3] = (paragraphs >> 8) & 0xff;
  data[4] = SECTOR_SIZE; data[5] = 0;
  const s = 16;
  data[s + 0] = 0x00; // boot flags
  data[s + 1] = 0x01; // boot sector count
  data[s + 2] = 0x00; data[s + 3] = 0x20; // load address $2000
  data[s + 4] = 0x00; data[s + 5] = 0x00; // init address
  // $2006: lda #$42; sta $0600; jmp $2006
  data.set([0xa9, 0x42, 0x8d, 0x00, 0x06, 0x4c, 0x06, 0x20], s + 6);
  return data;
}

describe('Platform Replay', () => {

  it('Should run apple2', async () => {
    var platform = await testPlatform('apple2', 'cosmic.c.rom', 72, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(32, 32, 1); // space bar
      }
    });
    assert.equal(platform.saveState().kbdlatch, 0x20); // strobe cleared
  });

  it('Should run > 60 secs', async function () {
    // 61 seconds of emulated time: enough to fill the recorder (3000 frames)
    // and wrap it, which is what the replay bookkeeping is about. A loaded
    // machine (the parallel test run) needs more than the default timeout.
    this.timeout(300000);
    var platform = await testPlatform('apple2', 'mandel.c.rom', 61*60, (platform, frameno) => {
    });
  });

  it('Should run vcs', async () => {
    var platform = await testPlatform('vcs', 'brickgame.rom', 72, (platform, frameno) => {
      if (frameno == 62) {
        var cstate = platform.saveControlsState();
        cstate.pia.SA = 0xff ^ 0x40; // stick left
        platform.loadControlsState(cstate);
      }
    });
    assert.equal(platform.saveState().p.SA, 0xff ^ 0x40);
    assert.equal(60, platform.readAddress(0x80)); // player x pos
  });

  it('Should run nes', async () => {
    var platform = await testPlatform('nes', 'shoot2.c.rom', 72, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_LEFT.c, Keys.VK_LEFT.c, 1);
      }
    });
    assert.equal(120-10, platform.readAddress(0x41d)); // player x pos
  });

  it('Should run vicdual', async () => {
    var platform = await testPlatform('vicdual', 'snake1.c.rom', 72, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_DOWN.c, Keys.VK_DOWN.c, 1);
      }
    });
  });

  it('Should run mw8080bw', async () => {
    var platform = await testPlatform('mw8080bw', 'game2.c.rom', 72, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_LEFT.c, Keys.VK_LEFT.c, 1);
      }
    });
    assert.equal(96-9*2, platform.readAddress(0x2006)); // player x pos
  });

  it('Should run galaxian', async () => {
    var platform = await testPlatform('galaxian-scramble', 'shoot2.c.rom', 72, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_LEFT.c, Keys.VK_LEFT.c, 1);
      }
    });
    assert.equal(112-10, platform.readAddress(0x4074)); // player x pos
  });

  it('Should run vector', async () => {
    var platform = await testPlatform('vector-z80color', 'game.c.rom', 72, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_UP.c, Keys.VK_UP.c, 1);
      }
    });
  });
/*
  it('Should run williams 6809', async () => {
    var platform = await testPlatform('williams', 'vidfill.asm.rom', 72, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_LEFT.c, Keys.VK_LEFT.c, 1);
      }
    });
  });
*/
  it('Should run williams-z80', async () => {
    var platform = await testPlatform('williams-z80', 'game1.c.rom', 72, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_LEFT.c, Keys.VK_LEFT.c, 1);
      }
    });
  });
  it('Should run sound_williams', async () => {
    var platform = await testPlatform('sound_williams-z80', 'swave.c.rom', 72, (platform, frameno) => {
      if (frameno == 60) {
        keycallback(Keys.VK_2.c, Keys.VK_2.c, 1);
      }
    });
  });

  it('Should run astrocade', async () => {
    var platform = await testPlatform('astrocade', 'cosmic.c.rom', 92, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_SPACE.c, Keys.VK_SPACE.c, 1);
      }
    });
  });
  it('Should run coleco', async () => {
    var platform = await testPlatform('coleco', 'shoot.c.rom', 92, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_SPACE.c, Keys.VK_SPACE.c, 1);
      }
    });
  });
  it('Should run coleco cart with AA55 signature', async () => {
    var platform = await testPlatform('coleco', 'shoot.c.rom', 92, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_SPACE.c, Keys.VK_SPACE.c, 1);
      }
    }, (rom) => {
      assert.deepEqual(Array.from(rom.slice(0, 2)), [0x55, 0xaa]);
      rom[0] = 0xaa; // AA55 means show title screen, but minbios jumps straight in
      rom[1] = 0x55;
    });
  });
  it('Should run sms-sg1000-libcv', async () => {
    var platform = await testPlatform('sms-sg1000-libcv', 'shoot.c.rom', 92, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_SPACE.c, Keys.VK_SPACE.c, 1);
      }
    });
  });
  it('Should run sms-sms-libcv', async () => {
    var platform = await testPlatform('sms-sms-libcv', 'climber.c-sms-sms-libcv.rom', 200, (platform, frameno) => {
      if (frameno == 122) {
        keycallback(Keys.RIGHT.c, Keys.VK_RIGHT.c, 1);
      }
    });
  });
  it('Should run coco', async () => {
    // hello.c prints two lines, then echoes what is typed: press 'Q'
    var platform = await testPlatform('coco', 'hello.c.rom', 62, (platform, frameno) => {
      if (frameno == 40) keycallback(81, 81, 1); // Q down
      if (frameno == 45) keycallback(81, 81, 64); // Q up
    });
    assert.equal(0x48, platform.readAddress(0x400)); // 'H' of HELLO
    // the typed Q is echoed at the start of the fourth text row
    assert.equal(0x51, platform.readAddress(0x400 + 3 * 32));
  });
  it('Should run atari7800', async () => {
    var platform = await testPlatform('atari7800', 'sprites.dasm.rom', 92, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_DOWN.c, Keys.VK_DOWN.c, 1);
      }
    });
    assert.equal(0x1800, platform.saveState().maria.dll);
    assert.equal(39, platform.readAddress(0x81)); // player y pos
  });
  /*
  it('Should run vectrex', async () => {
    var platform = await testPlatform('vectrex', 'joystick.c.rom', 92, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_DOWN.c, Keys.VK_DOWN.c, 1);
      }
    });
  });
  */
  it('Should run c64', async () => {
    await testPlatform('c64', 'climber.c.rom', 92, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_DOWN.c, Keys.VK_DOWN.c, 1);
      }
    });
  });
  it('Should run zx spectrum', async () => {
    await testPlatform('zx', 'cosmic.c.rom', 92, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_LEFT.c, Keys.VK_LEFT.c, 1);
      }
    });
  });
  it('Should run atari800', async () => {
    await testPlatform('atari8-800', 'siegegame.bin', 92, (platform, frameno) => {
      if (frameno == 62) {
        keycallback(Keys.VK_DOWN.c, Keys.VK_DOWN.c, 1);
      }
    });
  });
  it('Should boot an ATR disk image on atari800', async () => {
    var platform = new emu.PLATFORMS['atari8-800'](document.getElementById('emulator'));
    await platform.start();
    platform.loadROM('test.atr', makeTestATR());
    platform.resume();
    var booted = false;
    for (var i = 0; i < 60 && !booted; i++) {
      platform.nextFrame();
      booted = platform.readAddress(0x0600) == 0x42;
    }
    platform.pause();
    assert.ok(booted, "ATR boot code did not run");
  });

  it('Should run atari5200', async function () {
    // 1200 frames of the acid test suite: close to a minute of emulated
    // time, so a loaded machine (the parallel test run) needs more than the
    // default timeout.
    this.timeout(300000);
    await testPlatform('atari8-5200', 'acid5200.rom', 1200, (platform, frameno) => {
      if (frameno == 1199) {
        for (let j=0; j<1024; j+=40) {
          var s = '';
          for (let i=0; i<38; i++) {
            let c = platform.readAddress(0x402+j+i) & 0x7f;
            if (c < 0x40) c += 0x20;
            s += String.fromCharCode(c);
          }
          s = s.trim();
          if (s.startsWith("Passed:")) break;
        }
        assert.equal(s, "Passed: 14  Failed: 32  Skipped: 1");
      }
    });
  });
});

describe('Platform Input', () => {

  // node's global navigator is a getter, so it has to be replaced this way
  const realNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
  let pads;

  function fakePads() {
    pads = [0, 1].map(() => ({
      axes: [0, 0],
      buttons: new Array(16).fill(null).map(() => ({ pressed: false })),
    }));
    Object.defineProperty(global, 'navigator', {
      value: { getGamepads: () => pads }, configurable: true, writable: true
    });
  }

  after(() => {
    if (realNavigator === undefined) delete global.navigator;
    else Object.defineProperty(global, 'navigator', realNavigator);
  });

  // starts a platform with a gamepad plugged in, then runs `press` (which can
  // poke the pads or call keycallback) and reports the input port before/after
  async function withGamepad(platid, romname, press, addr) {
    fakePads();
    var platform = new emu.PLATFORMS[platid](document.getElementById('emulator'));
    await platform.start();
    platform.loadROM("ROM", new Uint8Array(fs.readFileSync('./test/roms/' + platid + '/' + romname)));
    platform.resume();
    // the poller only wakes up once a pad announces itself
    window.dispatchEvent(new window.Event('gamepadconnected'));
    for (var i = 0; i < 4; i++) platform.nextFrame();
    var before = platform.readAddress(addr);
    press(pads);
    platform.nextFrame();
    var after = platform.readAddress(addr);
    platform.pause();
    return { before, after };
  }

  // Robotron-style twin stick: player 1's stick is bound to the P2_* keys,
  // so it comes from gamepad #1, and firing comes from gamepad #0
  it('Should read a gamepad on williams-z80', async () => {
    var r = await withGamepad('williams-z80', 'game1.c.rom',
      (pads) => { pads[1].axes[0] = -1; }, 0xc804); // input0, LEFT1 = 0x4
    assert.equal(r.before & 0x4, 0);
    assert.equal(r.after & 0x4, 0x4, "gamepad left should set LEFT1");
  });

  it('Should read gamepad buttons on williams-z80', async () => {
    var r = await withGamepad('williams-z80', 'game1.c.rom',
      (pads) => { pads[0].buttons[8].pressed = true; }, 0xc80c); // input2, COIN1 = 0x10
    assert.equal(r.before & 0x10, 0);
    assert.equal(r.after & 0x10, 0x10, "gamepad button 8 should set COIN1");
  });

  // GRAVITAR_KEYCODE_MAP is active low, so a press clears the bit
  it('Should read a gamepad on vector-z80color', async () => {
    var r = await withGamepad('vector-z80color', 'game.c.rom',
      (pads) => { pads[0].axes[0] = -1; }, 0x8001); // input1, LEFT1 = 0x8
    assert.equal(r.before & 0x8, 0x8);
    assert.equal(r.after & 0x8, 0, "gamepad left should clear LEFT1");
  });

  it('Should read gamepad axis 1 on vector-z80color', async () => {
    var r = await withGamepad('vector-z80color', 'game.c.rom',
      (pads) => { pads[0].axes[1] = -1; }, 0x8001); // input1, UP1 = 0x10
    assert.equal(r.before & 0x10, 0x10);
    assert.equal(r.after & 0x10, 0, "gamepad up should clear UP1");
  });

  // the coin slots are on the number keys, which no gamepad button reaches
  it('Should read the coin keys on vector-z80color', async () => {
    var r = await withGamepad('vector-z80color', 'game.c.rom',
      () => { keycallback(Keys.VK_5.c, Keys.VK_5.c, 1); }, 0x8000); // input0, COIN1 = 0x2
    assert.equal(r.before & 0x2, 0);
    assert.equal(r.after & 0x2, 0x2, "'5' should set COIN1");
  });

  it('Should read the coin keys on williams-z80', async () => {
    var r = await withGamepad('williams-z80', 'game1.c.rom',
      () => { keycallback(Keys.SELECT.c, Keys.SELECT.c, 1); }, 0xc80c); // input2, COIN1 = 0x10
    assert.equal(r.before & 0x10, 0);
    assert.equal(r.after & 0x10, 0x10, "'\\' should set COIN1");
  });
});
