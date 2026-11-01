
import { SampledAudioSink } from "./devices";

// from TSS
declare var MasterChannel, PsgDeviceChannel;

/** The start/stop controls shared by the IDE's audio outputs. */
export interface AudioOutput {
  start(): void;
  stop(): void;
}

// MasterAudio drives a TSS MasterChannel. It used to let TSS's AudioLooper own
// a second AudioContext and pull samples from it; now it is a pull source for
// the same SampleAudio graph every other platform uses, so there is one Web
// Audio setup to unlock, pause and mute.
export class MasterAudio implements AudioOutput {
  master = new MasterChannel();
  output: SampledAudio;
  private masterRate = 0;

  start() {
    if (!this.output) {
      this.output = new SampledAudio(44100);
      this.output.setPullSource((samples) => this.pull(samples));
    }
    this.output.start();
    this.syncSampleRate();
  }

  stop() {
    this.output && this.output.stop();
  }

  private syncSampleRate() {
    const rate = this.output && this.output.sampleRate;
    if (rate && rate !== this.masterRate) {
      this.masterRate = rate;
      this.master.setSampleRate(rate);
    }
  }

  private pull(samples: Float32Array) {
    this.syncSampleRate();
    // MasterChannel produces interleaved stereo Int32 samples; AudioLooper
    // took the left channel and divided by 32768, and so do we.
    const length = samples.length * 2;
    if (this.master.bufferLength !== length) {
      this.master.setBufferLength(length);
    }
    this.master.generate(length);
    const buffer = this.master.getBuffer();
    for (let i = 0; i < samples.length; i++) {
      samples[i] = buffer[i * 2] / 32768;
    }
  }
}

export class AY38910_Audio {
  master : MasterAudio;
  psg = new PsgDeviceChannel();
  curreg = 0;

  constructor(master : MasterAudio) {
    this.master = master;
    this.psg.setMode(PsgDeviceChannel.MODE_SIGNED);
    this.psg.setDevice(PsgDeviceChannel.DEVICE_AY_3_8910);
    master.master.addChannel(this.psg);
  }

  reset() {
    for (var i=15; i>=0; i--) {
      this.selectRegister(i);
      this.setData(0);
    }
  }
  selectRegister(val : number) {
    this.curreg = val & 0xf;
  }
  setData(val : number) {
    this.psg.writeRegisterAY(this.curreg, val & 0xff);
  }
  readData() {
    return this.psg.readRegister(this.curreg);
  }
  currentRegister() { return this.curreg; }
}

export class SN76489_Audio {
  master : MasterAudio;
  psg = new PsgDeviceChannel();

  constructor(master : MasterAudio) {
    this.master = master;
    this.psg.setMode(PsgDeviceChannel.MODE_SIGNED);
    this.psg.setDevice(PsgDeviceChannel.DEVICE_SN76489);
    master.master.addChannel(this.psg);
  }
  reset() {
    // TODO
  }
  setData(val : number) {
    this.psg.writeRegisterSN(0, val & 0xff);
  }
}

// https://en.wikipedia.org/wiki/POKEY
// https://user.xmission.com/~trevin/atari/pokey_regs.html
// http://krap.pl/mirrorz/atari/homepage.ntlworld.com/kryten_droid/Atari/800XL/atari_hw/pokey.htm

export function newPOKEYAudio(count:number) {
  var audio = new MasterAudio();
  for (var i=1; i<=count; i++) {
    var pokey = new POKEYDeviceChannel();
    audio['pokey'+i] = pokey; // TODO: cheezy
    audio.master.addChannel(pokey);
  }
  return audio;
}

function combinePolys(a, b) {
  var arr = new Uint8Array(a.length * b.length);
  var n = 0;
  for (var i=0; i<arr.length; i++) {
    arr[i] = b[n % b.length];
    if (a[i % a.length]) n++;
  }
  return arr;
}

function divideBy(n) {
  var arr = new Uint8Array(n*2);
  arr.fill(1, 0, n);
  return arr;
}

export var POKEYDeviceChannel = function() {

  /* definitions for AUDCx (D201, D203, D205, D207) */
  var NOTPOLY5    = 0x80     /* selects POLY5 or direct CLOCK */
  var POLY4       = 0x40     /* selects POLY4 or POLY17 */
  var PURE        = 0x20     /* selects POLY4/17 or PURE tone */
  var VOL_ONLY    = 0x10     /* selects VOLUME OUTPUT ONLY */
  var VOLUME_MASK = 0x0f     /* volume mask */

  /* definitions for AUDCTL (D208) */
  var POLY9       = 0x80     /* selects POLY9 or POLY17 */
  var CH1_179     = 0x40     /* selects 1.78979 MHz for Ch 1 */
  var CH3_179     = 0x20     /* selects 1.78979 MHz for Ch 3 */
  var CH1_CH2     = 0x10     /* clocks channel 1 w/channel 2 */
  var CH3_CH4     = 0x08     /* clocks channel 3 w/channel 4 */
  var CH1_FILTER  = 0x04     /* selects channel 1 high pass filter */
  var CH2_FILTER  = 0x02     /* selects channel 2 high pass filter */
  var CLOCK_15    = 0x01     /* selects 15.6999kHz or 63.9210kHz */

  /* for accuracy, the 64kHz and 15kHz clocks are exact divisions of
     the 1.79MHz clock */
  var DIV_64      = 28       /* divisor for 1.79MHz clock to 64 kHz */
  var DIV_15      = 114      /* divisor for 1.79MHz clock to 15 kHz */

  /* the size (in entries) of the 4 polynomial tables */
  var POLY4_SIZE  = 0x000f
  var POLY5_SIZE  = 0x001f
  var POLY9_SIZE  = 0x01ff

  var POLY17_SIZE = 0x0001ffff    /* else use the full 17 bits */

  /* channel/chip definitions */
  var CHAN1       = 0
  var CHAN2       = 1
  var CHAN3       = 2
  var CHAN4       = 3
  var CHIP1       = 0
  var CHIP2       = 4
  var CHIP3       = 8
  var CHIP4       = 12
  var SAMPLE      = 127

  var FREQ_17_EXACT     = 1789790.0  /* exact 1.79 MHz clock freq */
  var FREQ_17_APPROX    = 1787520.0  /* approximate 1.79 MHz clock freq */

  // LFSR sequences
  var bit1 = new Uint8Array( [ 1 ] );
  var bit2 = new Uint8Array( [ 0,1 ] ); // TODO?
  var bit4 = new Uint8Array( [ 1,1,0,1,1,1,0,0,0,0,1,0,1,0,0 ] );
  var bit5 = new Uint8Array( [ 0,0,1,1,0,0,0,1,1,1,1,0,0,1,0,1,0,1,1,0,1,1,1,0,1,0,0,0,0,0,1 ] );
  var bit9 = new Uint8Array( [ 0,0,1,0,1,0,0,0,1,0,0,0,0,0,0,0,1,0,1,1,1,0,0,1,0,1,0,0,1,1,1,1,1,0,0,1,1,0,1,1,0,1,0,1,1,1,0,1,1,0,0,1,0,0,1,1,1,1,0,1,0,0,0,0,1,1,0,1,1,0,0,0,1,0,0,0,1,1,1,1,0,1,0,1,1,0,1,0,1,0,0,0,0,1,1,0,1,0,1,0,0,0,1,0,1,0,0,0,1,1,1,0,0,1,1,0,1,1,0,0,1,1,1,1,1,0,0,1,1,0,0,0,1,1,0,1,0,0,0,1,1,0,0,1,1,1,1,0,0,1,0,0,0,1,1,1,0,0,1,1,0,1,0,1,1,0,1,1,0,1,0,0,1,0,0,1,1,1,1,1,1,0,1,1,1,1,0,1,1,0,0,0,0,1,1,1,1,1,0,0,0,1,0,0,0,0,1,0,0,0,1,0,1,0,1,1,0,0,0,0,1,0,1,1,1,1,0,1,0,0,0,1,1,0,0,0,1,1,1,0,1,1,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0,1,0,0,0,0,1,1,1,0,0,0,1,1,1,0,0,1,1,0,0,1,0,0,1,0,1,1,0,0,0,0,1,0,0,0,1,0,0,0,1,0,1,1,1,1,0,0,0,1,1,1,0,0,0,1,0,0,1,1,1,1,0,1,1,1,1,1,1,1,0,1,1,1,1,1,1,0,1,1,0,1,0,1,1,1,1,0,0,1,0,1,0,1,1,1,0,0,0,0,0,1,1,0,1,1,0,0,0,1,0,1,0,1,0,0,0,0,1,0,1,1,1,0,0,0,0,1,0,0,1,0,1,0,0,0,1,0,1,1,1,0,0,1,1,1,1,1,1,1,0,0,0,0,0,1,0,0,1,1,0,1,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0,1,1,0,1,0,0,0,0,0,1,1,1,1,0,0,1,0,0,1,0,1,1,1,1,1,1,1,0,1,0,0,1,0,0,0,1,1,0,1,1,1,0,0,0,1,0,1,0,0,1,0,1,0,1,0,1,1,1,0,0,1,0,1,1,0,0,1,1,1,1,1,0,0,0,1,1,0 ] );
  var bit15 = new Uint8Array( [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0] );
  var bit31 = new Uint8Array( [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0] );
  var bit17 = new Uint8Array(1<<14);
  for (var i=0; i<bit17.length; i++) {
    bit17[i] = Math.random() > 0.5 ? 1 : 0;
  }
  var bit17_5 = combinePolys(bit17, bit5);
  var bit5_4 = combinePolys(bit5, bit4);
  var wavetones = [
    bit17_5, bit5, bit5_4, bit5,
    bit17, bit2, bit4, bit2
  ];
  // TIA
  var div2 = divideBy(2);
  var div6 = divideBy(6);
  var div31 = divideBy(31);
  var div93 = divideBy(93);
  var bit15_4 = combinePolys(bit15, bit4);
  var bit5_2 = combinePolys(bit5, div2);
  var bit5_6 = combinePolys(bit5, div6);
  var tiawavetones = [
    bit1, bit4, bit15_4, bit5_4,
    div2, div2, div31, bit5_2,
    bit9, bit5, div31, bit1,
    div6, div6, div93, bit5_6
  ];
  
  // registers
  var regs = new Uint8Array(16);
  var counters = new Float32Array(4);
  var deltas = new Float32Array(4);
  var volume = new Float32Array(4);
  var audc = new Uint8Array(4);
  var waveforms = [bit1, bit1, bit1, bit1];
  var buffer;
  var sampleRate;
  var clock, baseDelta;
  var dirty = true;

  //

  this.setBufferLength = function (length) {
    buffer = new Int32Array(length);
  };

  this.getBuffer = function () {
    return buffer;
  };

  this.setSampleRate = function (rate) {
    sampleRate = rate;
    baseDelta = FREQ_17_EXACT / rate;
  };

  function updateValues(addr) {
    var ctrl = regs[8];
    var base = (ctrl & CLOCK_15) ? DIV_15 : DIV_64;
    var div;
    var i = addr & 4;
    var j = i>>1;
    var k = i>>2;
    if (ctrl & (CH1_CH2>>k)) {
      if (ctrl & (CH1_179>>k))
         div = regs[i+2] * 256 + regs[i+0] + 7;
      else
         div = (regs[i+2] * 256 + regs[i+0] + 1) * base;
      deltas[j+1] = baseDelta / div;
      deltas[j+0] = 0;
    } else {
      if (ctrl & (CH1_179>>k)) {
        div = regs[i+0] + 4;
      } else {
        div = (regs[i+0] + 1) * base;
      }
      deltas[j+0] = baseDelta / div;
      div = (regs[i+2] + 1) * base;
      deltas[j+1] = baseDelta / div;
    }
    //console.log(addr, ctrl.toString(16), div, deltas[j+0], deltas[j+1]);
  }

  this.setRegister = function(addr, value) {
    addr &= 0xf;
    value &= 0xff;
    if (regs[addr] != value) {
      regs[addr] = value;
      switch (addr) {
        case 0:
        case 2:
        case 4:
        case 6: // AUDF
        case 8: // ctrl
          dirty = true;
          break;
        case 1:
        case 3:
        case 5:
        case 7: // AUDC
          volume[addr>>1] = value & 0xf;
          waveforms[addr>>1] = wavetones[value>>5];
          break;
      }
    }
  }

  this.getRegister = function(addr) {
    addr &= 0xf;
    return regs[addr];
  }
  
  this.setTIARegister = function(addr, value) {
    switch (addr) {
      case 0x17:
      case 0x18:
        regs[(addr&1)*4] = value & 0x1f;
        dirty = true;
        break;
      case 0x15:
      case 0x16:
        waveforms[(addr&1)*2] = tiawavetones[value & 0xf];
        break;
      case 0x19:
      case 0x1a:
        volume[(addr&1)*2] = value & 0xf;
        break;
    }
  }

  this.generate = function (length) {
    if (dirty) {
      updateValues(0);
      updateValues(4);
      dirty = false;
    }
    for (var s=0; s<length; s+=2) {
      var sample = 0;
      for (var i=0; i<4; i++) {
        var d = deltas[i];
        var v = volume[i];
        if (d > 0 && d < 1 && v > 0) {
          var wav = waveforms[i];
          var cnt = counters[i] += d;
          if (cnt > wav.length) {
            cnt = counters[i] = cnt - Math.floor(cnt / wav.length) * wav.length;
          }
          var on = wav[Math.floor(cnt)];
          if (on) {
            sample += v;
          }
        }
      }
      sample *= 64;
      buffer[s] = sample;
      buffer[s+1] = sample;
    }
  }
}

////// Worker sound

export var WorkerSoundChannel = function(worker) {
  var sampleRate;
  var output;
  var pending = [];
  var pendingLength = 0;

  worker.onmessage = function(e) {
    if (e && e.data && e.data.samples && output) {
      pending.push(e.data.samples);
      pendingLength += e.data.samples.length;
    }
  };

  this.setBufferLength = function (length) {
    output = new Int16Array(length);
    //worker.postMessage({bufferLength:length,numChannels:2});
    pendingLength = 0;
  };

  this.getBuffer = function () {
    return output;
  };

  this.setSampleRate = function (rate) {
    sampleRate = rate;
    worker.postMessage({sampleRate:rate});
  };

  this.generate = function (length) {
    if (pendingLength < length*3) {
      //console.log(length, pendingLength);
      output.fill(0);
      return; // TODO: send sync msg?
    }
    for (var i=0; i<output.length;) {
      if (pending.length == 0) break; // TODO?
      var buf = pending.shift();
      pendingLength -= buf.length;
      var l = output.length-i;
      if (buf.length < l) {
        output.set(buf, i);
      } else {
        output.set(buf.slice(0, l), i);
        pending.unshift(buf.slice(l));
        pendingLength += buf.length-l;
      }
      i += buf.length;
    }
  }

}

// SampleAudio

/**
 * Where SampleAudio sends the samples it produces, when a host wants to move
 * them somewhere other than a Web Audio graph (the VS Code extension streams
 * them to its webview). A host installs one factory with setAudioStreamFactory;
 * the source rate is the platform's nominal sampleRate, which SampleAudio
 * resamples to the stream's rate.
 */
export interface AudioStream {
  readonly sampleRate: number;
  start(): void;
  stop(): void;
  /** called with mono Float32 samples; the array may be transferred, not reused */
  push(samples: Float32Array): void;
}

var audioStreamFactory: ((sourceRate: number) => AudioStream) | null = null;

/** Install the streaming output. Pass null to go back to a Web Audio graph. */
export function setAudioStreamFactory(factory: ((sourceRate: number) => AudioStream) | null) {
  audioStreamFactory = factory;
}

// samples per chunk; the same size the IDE's ScriptProcessor asks for
export const AUDIO_CHUNK_SAMPLES = 2048;

// Browsers create an AudioContext suspended until a user gesture, and start()
// runs at page load, before any gesture. So also resume on the first
// interaction anywhere on the page (canvas focus alone is too narrow). resume()
// must be called synchronously inside the handler for Safari/iOS to allow it.
// Called on every start(), since stop() suspends the context.
const audioUnlockEvents = ['pointerdown', 'touchend', 'mousedown', 'keydown', 'click'];
const pendingUnlocks = new WeakSet<AudioContext>();   // waiting for the first user gesture
const unlockListeners = new WeakSet<AudioContext>();  // document gesture handlers installed

// Every AudioContext the IDE starts is registered here so the UI can tell
// whether Web Audio is still waiting for the user gesture that owns the page.
// Browsers keep one suspended until then, and resume() resolves asynchronously,
// so notify listeners on registration, state changes and resume completion.
const audioContexts = new Set<AudioContext>();
const audioStateListeners = new Set<() => void>();

function notifyAudioState() {
  for (const listener of Array.from(audioStateListeners)) listener();
}

function markAudioUnlocked(ctx: AudioContext) {
  pendingUnlocks.delete(ctx);
  notifyAudioState();
}

function trackAudioContext(ctx: AudioContext) {
  if (audioContexts.has(ctx)) return;
  audioContexts.add(ctx);
  if (typeof ctx.addEventListener === 'function') {
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') {
        pendingUnlocks.delete(ctx);
      } else if (ctx.state === 'closed') {
        // a closed context can never be resumed, so stop counting it as blocked
        audioContexts.delete(ctx);
        pendingUnlocks.delete(ctx);
      }
      notifyAudioState();
    });
  }
  notifyAudioState();
}

/**
 * True while an AudioContext is waiting for the user gesture that unlocks
 * Web Audio. A context the IDE suspends itself (pause, tab blur) is not blocked;
 * it comes back without a gesture.
 */
export function isAudioBlocked(): boolean {
  for (const ctx of audioContexts) {
    if (ctx.state !== 'running' && pendingUnlocks.has(ctx)) return true;
  }
  return false;
}

/** Subscribe to AudioContext creation and state changes. Returns an unsubscribe fn. */
export function onAudioStateChange(listener: () => void): () => void {
  audioStateListeners.add(listener);
  return () => { audioStateListeners.delete(listener); };
}

function resumeTrackedContext(ctx: AudioContext) {
  const resumed = ctx.resume();
  if (resumed && typeof resumed.then === 'function') {
    resumed.then(() => {
      if (ctx.state === 'running') markAudioUnlocked(ctx);
      else notifyAudioState();
    }, () => {});
  }
}

export function resumeAudioContext(ctx: AudioContext) {
  if (!ctx || ctx.state === 'closed') return;
  trackAudioContext(ctx);
  if (ctx.state === 'running') {
    pendingUnlocks.delete(ctx);
    return;
  }
  pendingUnlocks.add(ctx);
  notifyAudioState(); // show the click hint even if resume() stays suspended
  resumeTrackedContext(ctx);
  if (typeof document === 'undefined' || unlockListeners.has(ctx)) return;
  unlockListeners.add(ctx);
  const onGesture = () => {
    resumeTrackedContext(ctx);
    if (ctx.state === 'running') {
      for (const ev of audioUnlockEvents) document.removeEventListener(ev, onGesture, true);
      unlockListeners.delete(ctx);
    }
  };
  for (const ev of audioUnlockEvents) document.addEventListener(ev, onGesture, true);
}

// Mute is global: a platform can have more than one output (apple2's speaker
// and Mockingboard, or two SampleAudio instances across a restart), and the
// button should silence all of them. Every Web Audio graph registers its gain
// node here as it is created, and new graphs pick up the current state.
let audioMuted = false;
const audioMuteGains = new Set<{ gain: { value: number } }>();
const audioMuteListeners = new Set<() => void>();

/** True when the IDE's audio output is muted. */
export function isAudioMuted(): boolean {
  return audioMuted;
}

/** Mute or unmute every audio output. */
export function setAudioMuted(muted: boolean) {
  muted = !!muted;
  if (muted === audioMuted) return;
  audioMuted = muted;
  for (const node of audioMuteGains) node.gain.value = muted ? 0 : 1;
  for (const listener of Array.from(audioMuteListeners)) listener();
}

/** Subscribe to mute changes. Returns an unsubscribe function. */
export function onAudioMuteChange(listener: () => void): () => void {
  audioMuteListeners.add(listener);
  return () => { audioMuteListeners.delete(listener); };
}

export var SampleAudio = function(clockfreq) {
  var self = this;
  var sfrac, sinc, accum;
  var buffer, bufpos, bufferlist;
  var ifill;                // physical ring slot the producer is filling
  var written, read;        // monotonic buffer counts (committed / consumed)
  var skippedBuffers = 0, lastSkipLog = 0;
  var underruns = 0;
  var fillHist = null;      // ring-fill histogram; opt-in via setStatsEnabled
  var collectStats = false;
  // Clock recovery. The emulated frame clock and the AudioContext clock drift apart
  // by a fraction of a percent, so over time the ring either drains (underruns) or
  // fills. We nudge the resample ratio by a hair to hold a small cushion, instead of
  // adding ring depth, which would just add latency.
  var baseSinc = 1;         // sr / clockfreq, the untrimmed ratio
  var trim = 1;             // current trim around baseSinc
  var fillAvg = 0;          // EWMA of ring fill, in buffers
  var lastTrimAdj = 0;
  var FILL_TARGET = 1.5;    // buffers of cushion to hold
  var FILL_ALPHA = 0.05;    // EWMA weight per consumer pull (~1s at 21 pulls/s)
  var TRIM_GAIN = 0.004;    // resample-ratio change per buffer of error
  var MAX_TRIM = 0.01;      // cap the pitch shift at 1%
  var TRIM_INTERVAL_MS = 500;
  // The ring is allocated once at MAXBUFFERS and always indexed with that modulo.
  // Measurement showed the fill settles at 1-2 buffers and never nears this cap, so
  // depth is not the latency lever -- the per-buffer floor (bufferlen) is -- and
  // clock recovery holds the small cushion. The cap stays as insurance against the
  // ScriptProcessor callback stalling on the main thread (rendering/GC), ~370ms.
  var MAXBUFFERS = 8;
  var targetDepth = MAXBUFFERS;

  function mix(ape) {
    var lbuf = ape.outputBuffer.getChannelData(0);
    var m = this.module;
    if (!m) m = ape.srcElement.module;
    if (!m) return;
    if (m.callback) {
      m.callback(lbuf);
      return;
    } else if (written > read) {
      // copy the oldest committed buffer, then free it
      if (collectStats) fillHist[Math.min(written - read, MAXBUFFERS)]++;
      fillAvg += ((written - read) - fillAvg) * FILL_ALPHA;
      var buf = bufferlist[read % MAXBUFFERS];
      for (var i=0; i<lbuf.length; i++) {
        lbuf[i] = i < buf.length ? buf[i] : 0;
      }
      read++;
    } else {
      // underrun: nothing produced yet, play silence rather than stale data
      underruns++;
      if (collectStats) fillHist[0]++;
      fillAvg *= (1 - FILL_ALPHA);
      lbuf.fill(0);
    }
  }
  
  function clearBuffers() {
    if (bufferlist) {
      for (var buf of bufferlist)
        buf.fill(0);
      read = written; // drop any pending audio so we don't replay it on resume
    }
  }

  function createContext() {
    var AudioContext = window['AudioContext'] || window['webkitAudioContext'] || window['mozAudioContext'];
    if (! AudioContext) {
      console.log("no web audio context");
      return;
    }
    var ctx : AudioContext = new AudioContext();
    self.context = ctx;
    self.sr=self.context.sampleRate;
    self.bufferlen=2048;

    // remove DC bias
    self.filterNode=self.context.createBiquadFilter();
    self.filterNode.type='lowshelf';
    self.filterNode.frequency.value=100;
    self.filterNode.gain.value=-6;

    // mixer
    if ( typeof self.context.createScriptProcessor === 'function') {
      self.mixerNode=self.context.createScriptProcessor(self.bufferlen, 1, 1);
    } else {
      self.mixerNode=self.context.createJavaScriptNode(self.bufferlen, 1, 1);
    }

    self.mixerNode.module=self;
    self.mixerNode.onaudioprocess=mix;

    // compressor for a bit of volume boost, helps with multich tunes
    self.compressorNode=self.context.createDynamicsCompressor();

    // a single gain node the mute button controls (see setAudioMuted)
    self.gainNode=self.context.createGain();
    self.gainNode.gain.value = audioMuted ? 0 : 1;
    audioMuteGains.add(self.gainNode);

    // patch up some cables :)
    self.mixerNode.connect(self.filterNode);
    self.filterNode.connect(self.compressorNode);
    self.compressorNode.connect(self.gainNode);
    self.gainNode.connect(self.context.destination);
  }

  /**
   * Pull samples from a source instead of waiting for feedSample().
   * The ScriptProcessor callback fills `samples` on demand; MasterAudio uses
   * this to drive a TSS MasterChannel through the same graph as every other
   * platform.
   */
  this.setPullSource = function(source: (samples: Float32Array) => void) {
    self.callback = source;
  };

  this.start = function() {
    if (self.stream) return;   // streaming already; start() is called again on resume
    if (audioStreamFactory) {
      // No AudioContext in this host. Point the resampler at the stream's rate
      // and hand each full buffer to it instead of the ScriptProcessor ring.
      self.stream = audioStreamFactory(clockfreq);
      self.sr = self.stream.sampleRate;
      self.bufferlen = AUDIO_CHUNK_SAMPLES;
      sinc = self.sr * 1.0 / clockfreq;
      sfrac = 0;
      accum = 0;
      bufpos = 0;
      buffer = new Float32Array(self.bufferlen);
      self.stream.start();
      return;
    }
    if (this.context) {
      // Chrome autoplay (https://goo.gl/7K7WLu)
      resumeAudioContext(this.context);
      return;   // already created
    }
    createContext();		// create it
    if (!this.context) return;  // not created?
    // the context starts suspended when created without a gesture
    resumeAudioContext(this.context);
    sinc = this.sr * 1.0 / clockfreq;
    baseSinc = sinc;
    trim = 1;
    fillAvg = 0;
    lastTrimAdj = Date.now();
    sfrac = 0;
    accum = 0;
    bufpos = 0;
    bufferlist = [];
    written = 0;
    read = 0;
    ifill = 0;
    fillHist = collectStats ? new Array(MAXBUFFERS + 1).fill(0) : null;
    for (var i=0; i<MAXBUFFERS; i++) {
      var arrbuf = new ArrayBuffer(self.bufferlen*4);
      bufferlist[i] = new Float32Array(arrbuf);
    }
    buffer = bufferlist[0];
  }
  
  this.stop = function() {
    if (self.stream) {
      self.stream.stop();
      return;
    }
    this.context && this.context.suspend && this.context.suspend();
    clearBuffers(); // just in case it doesn't stop immediately
  }

  this.reset = function() {
    bufpos = 0; // drop any partly-filled chunk so a resume doesn't replay it
  }

  this.close = function() {
    if (self.gainNode) {
      audioMuteGains.delete(self.gainNode);
      self.gainNode = null;
    }
    if (this.context) {
      this.context.close();
      this.context = null;
    }
  }

  this.addSingleSample = function(value) {
    if (!buffer) return;
    buffer[bufpos++] = value;
    if (bufpos >= buffer.length) {
      bufpos = 0;
      if (self.stream) {
        // hand the buffer off and get a fresh one; the stream may transfer it
        var out = buffer;
        buffer = new Float32Array(self.bufferlen);
        self.stream.push(out);
        return;
      }
      bufferlist[ifill] = buffer;
      written++;
      // Producer outran the consumer; drop the oldest audio to make room.
      if (written - read >= targetDepth) {
        read++;
        skippedBuffers++;
        var now = Date.now();
        if (now - lastSkipLog > 1000) { // throttle so a sustained overrun doesn't flood the console
          console.warn('SampleAudio: skipped audio buffer(s), total=' + skippedBuffers +
            ', fill=' + (written - read) + '/' + targetDepth +
            ', contextRate=' + self.sr + ', requestedBuf=' + self.bufferlen +
            ', expectedIntervalMs=' + (self.bufferlen * 1000 / self.sr).toFixed(2));
          lastSkipLog = now;
        }
      }
      ifill = (ifill + 1) % MAXBUFFERS;
      buffer = bufferlist[ifill];
      // Clock recovery: steer the resample ratio to hold FILL_TARGET buffers.
      var trimNow = Date.now();
      if (trimNow - lastTrimAdj > TRIM_INTERVAL_MS) {
        lastTrimAdj = trimNow;
        var want = 1 + TRIM_GAIN * (FILL_TARGET - fillAvg);
        if (want > 1 + MAX_TRIM) want = 1 + MAX_TRIM;
        else if (want < 1 - MAX_TRIM) want = 1 - MAX_TRIM;
        trim = want;
        sinc = baseSinc * trim;
      }
    }
  }

  this.feedSample = function(value, count) {
    accum += value * count;
    sfrac += sinc * count;
    if (sfrac >= 1) {
      accum /= sfrac;
      while (sfrac >= 1) {
        this.addSingleSample(accum * sinc);
        sfrac -= 1;
      }
      accum *= sfrac;
    }
  }

  /**
   * Diagnostics for tuning the ring depth: where the fill actually sits, and how
   * often the producer overruns (drops) or the consumer underruns (silence).
   * Sampling happens on the ScriptProcessor path only; streaming hosts have no ring.
   * The fill histogram is off by default (it touches every consumer pull); turn it
   * on with setStatsEnabled(true) when you want the distribution. The mean/skips/
   * underruns/trim fields are always tracked.
   */
  this.getStats = function() {
    var total = 0, weighted = 0, maxFill = 0;
    if (fillHist) {
      for (var fill=0; fill<fillHist.length; fill++) {
        var count = fillHist[fill];
        total += count;
        weighted += fill * count;
        if (count > 0 && fill > maxFill) maxFill = fill;
      }
    }
    return {
      maxBuffers: MAXBUFFERS,
      targetDepth: targetDepth,
      sampleRate: self.sr || 0,
      bufferLength: self.bufferlen || 0,
      fillHistogram: fillHist ? fillHist.slice() : [],
      meanFill: total > 0 ? weighted / total : 0,
      maxFill: maxFill,
      samples: total,
      skippedBuffers: skippedBuffers,
      underruns: underruns,
      fillAvg: fillAvg,
      trim: trim,
    };
  };

  /** Turn the per-pull fill histogram on or off (off by default). */
  this.setStatsEnabled = function(on) {
    collectStats = !!on;
    fillHist = collectStats ? new Array(MAXBUFFERS + 1).fill(0) : null;
  };
  
}


export class SampledAudio implements AudioOutput {
  sa;
  constructor(sampleRate : number) {
    this.sa = new SampleAudio(sampleRate);
  }
  feedSample(value:number, count:number) {
    this.sa.feedSample(value, count);
  }
  /**
   * Fill samples from a source on demand instead of calling feedSample().
   * Used by MasterAudio to drive TSS's pull-based MasterChannel.
   */
  setPullSource(source: (samples: Float32Array) => void) {
    this.sa.setPullSource(source);
  }
  start() {
    this.sa.start();
  }
  stop() {
    this.sa.stop();
  }
  reset() {
    this.sa.reset();
  }
  /** ring-depth diagnostics; see SampleAudio.getStats */
  getStats() {
    return this.sa.getStats ? this.sa.getStats() : null;
  }
  /** turn the ring-fill histogram on or off (off by default) */
  setStatsEnabled(on: boolean) {
    this.sa.setStatsEnabled && this.sa.setStatsEnabled(on);
  }
  /** the rate this sink outputs at, once start() has run (Web Audio or stream) */
  get sampleRate() : number {
    return this.sa.sr || 0;
  }
}

interface TssChannel {
  setBufferLength(len : number) : void;
  setSampleRate(rate : number) : void;
  getBuffer() : number[];
  generate(numSamples : number) : void;
}

export class TssChannelAdapter {
  channels : TssChannel[];
  audioGain = 1.0 / 8192;
  bufferLength : number;

  constructor(chans, oversample:number, sampleRate:number) {
    this.bufferLength = oversample * 2;
    this.channels = chans.generate ? [chans] : chans; // array or single channel
    this.channels.forEach((c) => {
      c.setBufferLength(this.bufferLength);
      c.setSampleRate(sampleRate);
    });
  }

  generate(sink:SampledAudioSink) {
    var l = this.bufferLength;
    var bufs = this.channels.map((ch) => ch.getBuffer());
    this.channels.forEach((ch) => {
      ch.generate(l);
    });
    for (let i=0; i<l; i+=2) {
      var total = 0;
      bufs.forEach((buf) => total += buf[i]);
      sink.feedSample(total * this.audioGain, 1);
    };
  }
}

