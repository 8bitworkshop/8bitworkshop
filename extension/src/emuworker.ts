
// emuworker - worker thread that runs one emulator and paces its frames.
// Platform modules expect browser globals (installNodeMocks), which must not
// leak into the shared extension host.

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { Rpc } from './rpc';
import { EmuTarget, installNodeMocks, loadPlatform } from '../../src/tools/emutarget';
import { clearLastKeycodeMap, describeControls, getLastKeycodeMap, setHaltHandler } from '../../src/common/emu';
import { ControlHint, PLATFORM_CONTROLS } from '../../src/common/controls';
import { AudioStream, setAudioStreamFactory } from '../../src/common/audio';
import { getRootBasePlatform } from '../../src/common/util';
import { toInternalError } from '../../src/common/telemetry';
import type { FileData } from '../../src/common/workertypes';
import type { StopEvent } from '../../src/common/debugcontroller';
import type { DebugSection } from '../../src/common/emucore';
import type { WaveformSnapshot } from '../../src/common/waveform';
import { setHDLHost } from '../../src/common/hdl/hdlhost';
import { BuildInfo, DebugService, TimelineInfo } from '../../src/tools/debugservice';
import { RunScript } from '../../src/tools/runscript';
import { openVcdFile, VcdFile } from '../../src/tools/vcdfile';
import { buildDebugContext } from '../../src/common/debugcontroller';
import { encode as encodePng } from 'fast-png';

/**
 * Emulators to run in place of a platform's default. The build still uses the
 * platform's own tools. vcs.jt4 is the same Javatari core, but built on a
 * Machine, so it stops mid-frame and can rewind.
 */
const EMULATOR_FOR: { [platform: string]: string } = {
  'vcs': 'vcs.jt4',
};

/** Audio is resampled to this rate in the worker; the webview plays it back. */
const STREAM_RATE = 48000;

/** A chunk of mono Float32 samples at `sampleRate`, sent to the webview. */
export interface AudioChunk {
  samples: ArrayBuffer;
  sampleRate: number;
}

export interface FrameEvent {
  pixels: ArrayBuffer;
  width: number;
  height: number;
  rotate?: number;
  aspect?: number;
  /** the recorded range and where this frame is in it */
  timeline?: TimelineInfo;
}

export interface EmuStatus {
  state: 'running' | 'paused' | 'halted';
  platform: string;
  frame: number;
  message?: string;
  /** the platform's controls, hand-written or from its key map */
  controls?: ControlHint[];
  /** the program reads paddles, so the panel sends the mouse */
  paddles?: boolean;
  /** the platform's audio output rate, if it makes sound */
  audio?: { sampleRate: number };
  timeline?: TimelineInfo;
  /** the platform has debug info text for the Machine view */
  debugInfo?: boolean;
  /** the platform records signal traces (verilog), for the Waveform view */
  waveform?: boolean;
  /** false for a program with nothing for the emulator screen: a Verilog design with only signals (no video, sound or controls) */
  screen?: boolean;
  /** the program has signals that can be recorded as a VCD (startVcd) */
  vcd?: boolean;
}

/** A VCD recording started or ended (the 'vcd' event). */
export interface VcdEvent {
  recording: boolean;
  file: string;
  /** when it ended: the clocks it holds and the bytes written */
  clocks?: number;
  bytes?: number;
  /** it stopped because the file reached its size limit */
  full?: boolean;
}

/** What a debug view gets (see DebugViews in views.ts). */
export interface ViewEvent {
  id: string;
  frame: number;
  /** the Machine view: the platform's debug info, a text section per category */
  sections?: DebugSection[];
  /** the Waveform view: the signal trace so far */
  waveform?: WaveformSnapshot;
}

/** How the host wants a program loaded. */
/** What a run-script printed, and the machine afterward (see `script`). */
export interface ScriptResult {
  output: string;
  /** the script stopped on a bad command or an emulator error */
  error?: string;
  frame: number;
  /** the last frame */
  png?: Uint8Array;
}

export interface LoadOptions {
  /** load it stopped, as a debug session does until it is configured */
  paused?: boolean;
  /** pixels along the longer side of a vector platform's screen */
  vectorSize?: number;
}

/** DebugService methods the host may call through `debug`. */
const DEBUG_METHODS = new Set([
  'capabilities', 'setBuild', 'setBreakpoints', 'continue', 'step', 'pause', 'stepBack', 'reverseContinue',
  'seekFrame', 'location', 'timeline', 'registers', 'readMemory', 'writeMemory', 'disassemble', 'evaluate',
  'debugTree', 'signalTree', 'symbols', 'callStack', 'inlineValues',
]);
// the ones that replay frames the recording already has
const REWIND_METHODS = new Set(['stepBack', 'reverseContinue', 'seekFrame']);
// the ones that start the machine running toward a goal
const FORWARD_METHODS = new Set(['continue', 'step']);

// how often a visible view refreshes while the program runs; a stop always does
const VIEW_INTERVAL_MS = 250;

// frames to run at once when catching up, before giving up and resyncing
const MAX_CATCHUP_FRAMES = 4;

installNodeMocks(workerData.rootDir);
// a program that ends (BASIC, devel) halts instead of idling
setHaltHandler(err => halt(err?.message || 'Program halted'));

let target: EmuTarget | null = null;
let service: DebugService | null = null;
/** frames are running (toward the service's goal) */
let running = false;
/** the panel is hidden: don't run frames, but keep `running` for when it shows */
let hidden = false;
let timer: NodeJS.Timeout | null = null;
let nextTime = 0;
let controls: ControlHint[] = [];
let started = false;
let muted = false;
// Verilog records signal traces only while a scope is showing; the Waveform
// view is the scope here (see HDLHost). The view's data goes out in pushViews.
setHDLHost({
  createScope: () => ({
    isVisible: () => views.has('waveform'),
    // a design with no video: open the view, once
    show() {
      if (!views.has('waveform') && !revealed) {
        revealed = true;
        rpc.emit('reveal', 'waveform');
      }
    },
    setCurrentTime() { },
    update() { },
    resize() { },
  }),
  showVideoControls() { },
  showSettleCount() { },
});
/** the views the host has showing: only these get data */
let views = new Set<string>();
let lastViewPush = 0;
/** the host was asked to open the Waveform view for this program */
let revealed = false;
/** the VCD file being written, and the frame to stop at (if it has a length) */
let vcdFile: { file: VcdFile, path: string, end: number | null } | null = null;

/**
 * The headless stand-in for the platform's Web Audio sink: SampleAudio hands
 * each full buffer here, and we forward it to the extension host as an event.
 */
class RpcAudioStream implements AudioStream {
  readonly sampleRate = STREAM_RATE;
  constructor(private rpc: Rpc) { }
  start() { }
  stop() { }
  push(samples: Float32Array) {
    // no frames run while paused/hidden, so the guard mostly saves a little
    // work when muting mid-chunk; the webview's gain node does the rest
    if (!running || hidden || muted) return;
    const buf = samples.buffer as ArrayBuffer;
    this.rpc.emit('audio', { samples: buf, sampleRate: STREAM_RATE }, [buf]);
  }
}

const rpc: Rpc = new Rpc(parentPort, {
  /** `files` are the project files the program reads at load time (BuildOutcome.files) */
  async start(platform: string, rom: any, files?: { [path: string]: FileData }, opts: LoadOptions = {}) {
    // platform modules keep global state (Javatari deletes its own start()),
    // so a worker runs one emulator; the host starts a new worker per run
    if (started) throw new Error('This emulator worker already ran a platform; start a new worker.');
    started = true;
    revealed = false;
    stop();
    clearLastKeycodeMap();
    target = await loadPlatform(EMULATOR_FOR[platform] || platform);
    if (opts.vectorSize) target.vectorSize = opts.vectorSize;
    await target.start();
    service = new DebugService(target, stopped);
    // machines build their keyboard handler as they start
    controls = PLATFORM_CONTROLS[getRootBasePlatform(platform)] || describeControls(getLastKeycodeMap());
    target.setFileData(files || {});
    await target.loadROM(rom);
    if (!opts.paused) resume();
    rpc.emit('audioReset', null);
    return status();
  },
  async loadROM(rom: any, files?: { [path: string]: FileData }, opts: LoadOptions = {}) {
    if (!target) throw new Error('emulator not started');
    stopVcd();
    revealed = false;
    target.setFileData(files || {});
    await target.loadROM(rom);
    if (!opts.paused) resume();
    rpc.emit('audioReset', null);
    return status();
  },
  /**
   * Record the design's signals to `file` as a VCD, for `frames` frames (or
   * until stopVcd or the file reaches `maxBytes`, by default 1 GB). It slows the simulation and
   * writes ~3MB a frame for a VGA design (a quarter of that if `file` ends in
   * .gz), so the host asks for a length.
   */
  startVcd(file: string, frames?: number, maxBytes?: number) {
    if (!target) throw new Error('emulator not started');
    if (!target.supportsVcd) throw new Error(`'${target.id}' has no signals to record`);
    stopVcd();
    const rec = { file: openVcdFile(file, maxBytes), path: file, end: frames ? target.frameCount + frames : null };
    try {
      target.startVcd(chunk => rec.file.write(chunk), () => rec.file.full);
    } catch (e) {
      rec.file.close();
      throw e;
    }
    vcdFile = rec;
    rpc.emit('vcd', { recording: true, file } as VcdEvent);
  },
  stopVcd() {
    return stopVcd();
  },
  /** Call a DebugService method; stops come back as 'stopped' events. */
  debug(method: string, ...args: any[]) {
    if (!service) throw new Error('emulator not started');
    if (!DEBUG_METHODS.has(method)) throw new Error(`no debug method '${method}'`);
    if (REWIND_METHODS.has(method)) stopVcd();
    const result = (service as any)[method](...args);
    if (FORWARD_METHODS.has(method)) startRunning();
    return result;
  },
  reset() {
    if (!target) return null;
    target.reset();
    sendFrame();
    rpc.emit('audioReset', null);
    return status();
  },
  pause() {
    pause();
    rpc.emit('audioReset', null);
    return status();
  },
  /** Show a recorded frame, stopped there. */
  seekFrame(frame: number) {
    if (!service) return null;
    stopVcd();
    service.seekFrame(frame);
    return status();
  },
  resume() {
    resume();
    rpc.emit('audioReset', null);
    return status();
  },
  setMuted(m: boolean) {
    muted = !!m;
  },
  /** The debug views now showing (ids from views.ts); hidden ones cost nothing. */
  setViews(ids: string[]) {
    const opened = ids.indexOf('waveform') >= 0 && !views.has('waveform');
    views = new Set(ids);
    // paused, nothing runs to be traced: run the last frame again
    if (opened && target && !running) {
      try { target.replayFrame(); } catch (e) { /* the view shows what it has */ }
    }
    pushViews(true);
  },
  /** A click on an input in the Waveform view. */
  setSignal(index: number, value: number) {
    target?.setSignalValue(index, value);
    pushViews(true);
  },
  setVisible(visible: boolean) {
    hidden = !visible;
    if (hidden) stopTimer();
    else schedule();
  },
  key(key: number, code: number, flags: number) {
    try {
      target?.setKeyInput(key, code, flags);
    } catch (e) {
      // platforms without keyboard input ignore keys
    }
  },
  paddle(x: number, y: number, buttons: boolean[]) {
    target?.setPaddles(x, y, buttons);
  },
  stop() {
    stop();
  },
  status,
  /**
   * Run a run-script (src/tools/runscript.ts) on a machine loaded paused, as
   * `8bws run -e` does. For the language model tools, on a worker of their
   * own: the script drives the machine directly, not through the pacing loop.
   */
  script(text: string, build?: BuildInfo): ScriptResult {
    if (!target) throw new Error('emulator not started');
    if (running) throw new Error('the emulator is running; scripts need a paused machine');
    var out: string[] = [];
    var script = new RunScript(target, s => { out.push(s); });
    if (build) script.setDebugContext(buildDebugContext(build));
    script.startTracing();
    var error: string | undefined;
    try {
      script.run(text);
    } catch (e) {
      error = e && e.message || String(e);
    }
    var video = target.getVideo();
    var png = video ? encodePng({ width: video.width, height: video.height, data: new Uint8Array(video.pixels.buffer), channels: 4 }) : undefined;
    return { output: out.join(''), error, frame: target.frameCount, png };
  },
});

// take over the platform's audio sink: SampleAudio resamples to STREAM_RATE
// and hands us the buffers, which we forward to the host (see emulatorpanel)
setAudioStreamFactory(() => new RpcAudioStream(rpc));

function status(): EmuStatus | null {
  if (!target) return null;
  const audio = target.getAudioParams();
  return {
    state: running ? 'running' : 'paused', platform: target.id, frame: target.frameCount,
    controls, paddles: target.acceptsPaddles(), debugInfo: target.hasDebugInfo, waveform: target.hasWaveform, screen: target.usesScreen, vcd: target.supportsVcd, audio: audio ? { sampleRate: audio.sampleRate } : undefined,
    timeline: service?.timeline() ?? undefined,
  };
}

/** Run on from here, until a breakpoint or a pause. */
function resume() {
  if (!service || running) return;
  service.continue();
  startRunning();
}

/** Run frames toward whatever goal the service has. */
function startRunning() {
  if (running) return;
  running = true;
  schedule();
  rpc.emit('status', status());
}

/** Stop between frames. The stop comes back through stopped(). */
function pause() {
  if (service) service.pause();
  else { running = false; stopTimer(); }
}

/** Every stop: a breakpoint, a finished step, a pause, a halt, a seek. */
function stopped(e: StopEvent) {
  running = false;
  stopTimer();
  sendFrame();
  pushViews(true);
  rpc.emit('stopped', e);
  if (e.reason === 'halt' || e.reason === 'exception') {
    rpc.emit('status', { ...status(), state: 'halted', message: e.message });
  } else {
    rpc.emit('status', status());
  }
}

/** Start ticking from now, if running, shown, and not already ticking. */
function schedule() {
  if (!running || hidden || timer) return;
  nextTime = performance.now();
  tick();
}

function stopTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Finish the VCD file, if one is being written. */
function stopVcd(): VcdEvent | null {
  const f = vcdFile;
  if (!f) return null;
  vcdFile = null;
  // the writer's last chunk goes out before the file closes
  const clocks = target ? target.stopVcd() : 0;
  f.file.close();
  const ev: VcdEvent = { recording: false, file: f.path, clocks, bytes: f.file.bytes, full: f.file.full };
  rpc.emit('vcd', ev);
  return ev;
}

function stop() {
  running = false;
  stopTimer();
  stopVcd();
  rpc.emit('status', status());
  target = null;
  service = null;
}

/**
 * The program ended (the platform's halt handler) or the emulator failed.
 * Both stop the machine where it is, like any other stop.
 */
function halt(message: string, reason: 'halt' | 'exception' = 'halt') {
  if (!running || !target || !service) return;
  service.debug.pause();
  const { at, pc } = service.location();
  stopped({ reason, at, pc, message });
}

function tick() {
  timer = null;
  if (!running || hidden || !target || !service) return;
  var interval = 1000 / target.frameRate;
  var now = performance.now();
  var frames = 0;
  try {
    // a stop (breakpoint, step done, halt) comes back through stopped()
    while (running && nextTime <= now && frames < MAX_CATCHUP_FRAMES) {
      service.advance(1);
      nextTime += interval;
      frames++;
    }
  } catch (e) {
    // EmuHalt (the program's fault) is a stop, caught in DebugController;
    // anything reaching here is an emulator bug
    rpc.emit('internalError', { platform: target.id, ...toInternalError(e) });
    halt(String(e && e.message || e), 'exception');
    return;
  }
  if (!running) return;  // stopped during the frame
  if (vcdFile && ((vcdFile.end != null && target.frameCount >= vcdFile.end) || !target.vcdRunning)) stopVcd();
  if (now - nextTime > interval * MAX_CATCHUP_FRAMES) nextTime = now;  // too far behind
  if (frames) {
    sendFrame();
    pushViews(false); // (a design with no video sends no frames)
  }
  timer = setTimeout(tick, Math.max(0, nextTime - performance.now()));
}

function sendFrame() {
  var video = target?.getVideo();
  if (!video) return;
  // the platform keeps drawing into its buffer, so send a copy
  var pixels = video.pixels.slice().buffer;
  var frame: FrameEvent = {
    pixels, width: video.width, height: video.height, rotate: video.rotate, aspect: video.aspect,
    timeline: service?.timeline() ?? undefined,
  };
  rpc.emit('frame', frame, [pixels]);
}

/** Send each showing view its data, at most every VIEW_INTERVAL_MS unless `force`. */
function pushViews(force: boolean) {
  if (!target || !views.size) return;
  const now = performance.now();
  if (!force && now - lastViewPush < VIEW_INTERVAL_MS) return;
  lastViewPush = now;
  if (views.has('machine')) {
    let sections: DebugSection[] = [];
    try {
      sections = target.getDebugInfo();
    } catch (e) {
      // a platform that can't describe itself in this state shows nothing
    }
    const ev: ViewEvent = { id: 'machine', frame: target.frameCount, sections };
    rpc.emit('view', ev);
  }
  if (views.has('waveform')) {
    const waveform = target.getWaveform();
    if (waveform) {
      const ev: ViewEvent = { id: 'waveform', frame: target.frameCount, waveform };
      rpc.emit('view', ev, [waveform.data.buffer as ArrayBuffer]);
    }
  }
}
