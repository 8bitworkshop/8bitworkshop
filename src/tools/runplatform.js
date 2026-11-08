
var assert = require('assert');
var fs = require('fs');
var wtu = require('./workertestutils.js');
//const canvas = require('canvas');
//const GIFEncoder = require('gif-encoder-2');
//const fastpng = require('fast-png');

const dom = createTestDOM();
includeInThisContext('gen/common/cpu/6809.js');
includeInThisContext("javatari/javatari.js");
Javatari.AUTO_START = false;
includeInThisContext('tss/js/Log.js');
//global.Log = require('tss/js/Log.js').Log;
includeInThisContext('tss/js/tss/PsgDeviceChannel.js');
includeInThisContext('tss/js/tss/MasterChannel.js');
includeInThisContext('tss/js/tss/AudioLooper.js');
//includeInThisContext("jsnes/dist/jsnes.min.js");
global.jsnes = require("jsnes/dist/jsnes.min.js");

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
var _atari8 = require('gen/platform/atari8.js');
var util = require('gen/common/util.js');
util.loadScript = function (s) { console.log('tried to load', s); } // for vcs

//

var keycallback;
var lastrastervideo;
var canvases = [];
dom.window.HTMLCanvasElement.prototype.getContext = function () {
  canvases.push(this);
  this.data = new Uint32Array(228 * 312);
  return {
    getImageData: function (x, y, w, h) {
      if (this.data == null) {
        this.data = new Uint32Array(w * h);
      }
      return { data: this.data };
    },
    fillRect: function (x, y, w, h) { },
    drawImage: function (img, x, y, w, h) {
    },
    putImageData: function (d, w, h) {
      this.data.set(d.data);
    },
  };
}
global.navigator = {};

emu.RasterVideo = function (mainElement, width, height, options) {
  var buffer;
  var datau8;
  var datau32;
  this.create = function () {
    this.width = width;
    this.height = height;
    buffer = new ArrayBuffer(width * height * 4);
    datau8 = new Uint8Array(buffer);
    datau32 = new Uint32Array(buffer);
    lastrastervideo = this;
  }
  this.setKeyboardEvents = function (callback) {
    keycallback = callback;
  }
  this.getFrameData = function () { return datau32; }
  this.getImageData = function () { return { data: datau8, width: width, height: height }; }
  this.updateFrame = function () { }
  this.clearRect = function () { }
  this.setupMouseEvents = function () { }
  this.canvas = this;
  this.getContext = function () { return this; }
  this.fillRect = function () { }
  this.fillStyle = '';
  this.putImageData = function () { }
}

emu.VectorVideo = function (mainElement, width, height, options) {
  this.create = function () {
    this.drawops = 0;
  }
  this.setKeyboardEvents = function (callback) {
    keycallback = callback;
  }
  this.clear = function () { }
  this.drawLine = function () { this.drawops++; }
}

global.Worker = function () {
  this.msgcount = 0;
  this.postMessage = function () { this.msgcount++; }
}

global.Mousetrap = function () {
  this.bind = function () { }
}

//

/*
interface RunStats {
  line: number;
  pcmin: number;
  pcmax: number;
  ops: {[op:number]:number};
  io: {[loc:number]:number};
}
*/

let STATS = {};

function getFrameStats(frame, line) {
  let key = Math.floor(frame/60) + '-' + line;
  let state = STATS[key];
  if (state == null) {
    state = newRunStats(frame, line);
    STATS[key] = state;
  }
  return state;
}

function newRunStats(frame, line) {
  return {
    frame: frame,
    line: line,
    insns: 0,
    xmin: -1,
    xmax: 0,
    pcmin: -1,
    pcmax: 0,
    wait: 0,
    ops: {},
    ioread: {},
    iowrite: {},
  };
}

function inc(map, amt) {
  if (map[amt] == null) map[amt] = 0;
  map[amt]++;
}

function addRunStats(frame, ops) {
  let line = 0;
  let x = 0;
  let stat;
  let reads = [];
  for (let i = 0; i < ops.length; i++) {
    let op = ops[i];
    switch (op & 0xff000000) {
      case 0x7f000000: // FRAME
        line = 0;
      case 0x7e000000: // SCANLINE
        line++;
        x = 0;
        stat = getFrameStats(frame, line);
        break;
      case 0: // CLOCKS
        x += op & 0xffffff;
        break;
      case 0x01000000: // EXECUTE
        if (stat) {
          stat.insns++;
          let pc = op & 0xffff;
          if (stat.xmin == -1 || x < stat.xmin) stat.xmin = x;
          if (stat.xmax == 0 || x > stat.xmax) stat.xmax = x;
          if (stat.pcmin == -1 || pc < stat.pcmin) stat.pcmin = pc;
          if (stat.pcmax == 0 || pc > stat.pcmax) stat.pcmax = pc;
          let opcode = reads[pc];
          if (typeof opcode === 'number') {
            inc(stat.ops, opcode);
          }
        }
        break;
      case 0x12000000: // MEM_READ
        reads[op & 0xffff] = (op >> 16) & 0xff;
        break;
      case 0x14000000: // IO_READ
        if (stat) inc(stat.ioread, op & 0xffff);
        break;
      case 0x15000000: // IO_WRITE
        if (stat) inc(stat.iowrite, op & 0xffff);
        break;
      case 0x1f000000: // WAIT
        if (stat) stat.wait += op & 0xffffff;
        break;
    }
  }
}

//

async function runPlatform(platid, romname, maxframes) {
  var outfilename = 'data.out';
  try { fs.unlinkSync(outfilename); } catch (e) { }
  if (!emu.PLATFORMS[platid]) throw new Error('no such platform: ' + platid);
  var platform = new emu.PLATFORMS[platid](emudiv);
  await platform.start();
  var emudiv = document.getElementById('emulator');
  var rom = fs.readFileSync(romname);
  rom = new Uint8Array(rom);
  platform.loadROM("ROM", rom);
  platform.reset(); // reset again
  platform.resume(); // so that recorder works
  // skip a few to let vsync settle or whatever
  for (let i = 0; i < 10; i++) platform.nextFrame();
  let proberec = platform.startProbing();
  proberec.reset(0x100000);
  proberec.singleFrame = true;
  // connect display (vcs)
  //var canv = canvas.createCanvas(228,312);
  //var imdata = canv.getContext('2d').getImageData(0,0,228,312);
  //let imu32 = new Uint32Array(imdata.data.buffer);
  let oldNextLine = Javatari.room.screen.getMonitor().nextLine;
  let imofs = 0;
  Javatari.room.screen.getMonitor().nextLine = (pixels, vsyncSignal) => {
    for (let i = 0; i < pixels.length; i++) {
      let rgba = pixels[i];
      proberec.logData(rgba | 0xff000000);
      //imu32[imofs++] = rgba;
    }
    return oldNextLine(pixels, vsyncSignal);
  }
  // build encoder
  //const encoder = new GIFEncoder(lastrastervideo.width, lastrastervideo.height);
  //const encoder = new GIFEncoder(228,312,'neuquant',true);
  //encoder.setDelay(Math.round(1000/60));
  //encoder.start();
  // run frames
  let tweakframe = 30;
  for (var i = 0; i < maxframes; i++) {
    imofs = 0;
    platform.nextFrame();
    /*
    var pngbuffer = fastpng.encode(imdata);
    assert(pngbuffer.length > 500); // make sure PNG is big enough
    try { fs.mkdirSync("./test"); } catch(e) { }
    try { fs.mkdirSync("./test/output"); } catch(e) { }
    try {
      fs.writeFileSync("./test/output/"+platid+"-"+romname.replaceAll('/','_')+"_"+i+".png", pngbuffer);
    } catch (e) { console.log(e) }
    */
    //encoder.addFrame(imdata);
    let data = proberec.buf.slice(0, proberec.idx);
    addRunStats(i, data);
    //fs.appendFileSync(outfilename, data, null);

    if ((i % tweakframe) == tweakframe-1) {
      let ctrl = platform.saveControlsState();
      ctrl.P0btn = Math.random() > 0.5;
      ctrl.P1btn = Math.random() > 0.5;
      ctrl.SA = Math.round(Math.random() * 255);
      ctrl.SB = Math.round(Math.random() * 255);
      platform.loadControlsState(ctrl);
    }

    //console.log(i, data.length);
    proberec.clear();
  }
  platform.stopProbing();
  platform.pause();
  console.log(proberec);
  //console.log(STATS);
  fs.writeFileSync(outfilename, JSON.stringify(STATS));
  //encoder.finish();
  //fs.writeFileSync('test.gif', encoder.out.getData());
  return platform;
}

const platformid = process.argv[2];
const rompath = process.argv[3];
runPlatform(platformid, rompath, 10000);
