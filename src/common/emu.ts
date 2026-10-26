
import { Platform } from "./baseplatform";
import type { ControlHint } from "./controls";
import { hex, clamp, lpad } from "./util";
import { SourceLocation } from "./workertypes";

// Emulator classes
// Most of this stuff helps emulators use the DOM
// and do keyboard/mouse/gamepad/timer handling, etc.

// Constructor signature for a registered Platform class. Most platforms only
// use mainElement; a few (e.g. MAME-based ones) read options as well. Legacy
// function-style platforms are cast to this type when they register themselves.
export type PlatformConstructor = new (mainElement: HTMLElement, options?: any) => Platform;

export var PLATFORMS: { [id: string]: PlatformConstructor } = {};

var _random_state = 1;

export function noise() {
  let x = _random_state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  return (_random_state = x) & 0xff;
}

export function getNoiseSeed() {
  return _random_state;
}

export function setNoiseSeed(x: number) {
  _random_state = x;
}

type KeyboardCallback = (which: number, charCode: number, flags: KeyFlags) => void;

export function __createCanvas(doc: HTMLDocument, mainElement: HTMLElement, width: number, height: number): HTMLCanvasElement {
  var canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.classList.add("emuvideo");
  canvas.tabIndex = 0; // Make it focusable and tabbable
  mainElement.appendChild(canvas);
  return canvas;
}

export enum KeyFlags {
  KeyDown = 1,
  Shift = 2,
  Ctrl = 4,
  Alt = 8,
  Meta = 16,
  KeyUp = 64,
  KeyPress = 128,
}

// KeyboardEvent.key is layout- and shift-aware, so it holds the character actually
// typed ("(", "+", "\"") where keyCode does not. Non-printable keys have multi-char
// names ("Enter", "Backspace", "ArrowLeft") so fall back to keyCode for those.
export function _charCodeOf(e: KeyboardEvent): number {
  return e.key != null && e.key.length == 1 ? e.key.charCodeAt(0) : e.keyCode;
}

// TODO: don't use which/keyCode anymore?
export function _setKeyboardEvents(canvas: HTMLElement, callback: KeyboardCallback) {
  canvas.onkeydown = (e) => {
    let flags = _metakeyflags(e);
    callback(e.which, _charCodeOf(e), KeyFlags.KeyDown | flags);
    if (!flags) e.preventDefault(); // eat all keys that don't have a modifier
  };
  canvas.onkeyup = (e) => {
    callback(e.which, _charCodeOf(e), KeyFlags.KeyUp | _metakeyflags(e));
  };
};

type VideoCanvasOptions = { rotate?: number, overscan?: boolean, aspect?: number };

class RasterVideoImpl {

  mainElement: HTMLElement;
  width: number;
  height: number;
  options: VideoCanvasOptions;

  constructor(mainElement: HTMLElement, width: number, height: number, options?: VideoCanvasOptions) {
    this.mainElement = mainElement;
    this.width = width;
    this.height = height;
    this.options = options;
  }

  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  imageData: ImageData;
  datau32: Uint32Array;
  vcanvas: JQuery;

  // Start paddles/joystick centered in [0,255] range.
  paddle_x = 128;
  paddle_y = 128;
  // Platforms can support up to three buttons.
  paddle_buttons: boolean[] = [false, false, false];

  setRotate(rotate: number) {
    var canvas = this.canvas;
    if (rotate) {
      // TODO: aspect ratio?
      canvas.style.transform = "rotate(" + rotate + "deg)";
      if (canvas.width < canvas.height)
        canvas.style.paddingLeft = canvas.style.paddingRight = "10%";
    } else {
      canvas.style.transform = null;
      canvas.style.paddingLeft = canvas.style.paddingRight = null;
    }
  }

  create(doc?: HTMLDocument) {
    var canvas;
    this.canvas = canvas = __createCanvas(doc || document, this.mainElement, this.width, this.height);
    this.vcanvas = $(canvas);
    if (this.options && this.options.rotate) {
      this.setRotate(this.options.rotate);
    }
    if (this.options && this.options.overscan) {
      this.vcanvas.css('padding', '0px');
    }
    if (this.options && this.options.aspect) {
      console.log(this.options);
      this.vcanvas.css('aspect-ratio', this.options.aspect + "");
    }
    this.ctx = canvas.getContext('2d');
    this.imageData = this.ctx.createImageData(this.width, this.height);
    this.datau32 = new Uint32Array(this.imageData.data.buffer);
  }

  setKeyboardEvents(callback) {
    _setKeyboardEvents(this.canvas, callback);
  }

  getFrameData() { return this.datau32; }

  getContext() { return this.ctx; }

  updateFrame(sx?: number, sy?: number, dx?: number, dy?: number, w?: number, h?: number) {
    if (w && h)
      this.ctx.putImageData(this.imageData, sx, sy, dx, dy, w, h);
    else
      this.ctx.putImageData(this.imageData, 0, 0);
  }

  clearRect(dx: number, dy: number, w: number, h: number) {
    var ctx = this.ctx;
    ctx.fillStyle = '#000000';
    ctx.fillRect(dx, dy, w, h);
  }

  setupMouseEvents(el?: HTMLCanvasElement) {
    if (!el) el = this.canvas;
    $(el).mousemove((e) => {
      var pos = getMousePos(el, e);
      var new_x = Math.round(pos.x * 255 / this.canvas.width);
      var new_y = Math.round(pos.y * 255 / this.canvas.height);
      this.paddle_x = clamp(0, 255, new_x);
      this.paddle_y = clamp(0, 255, new_y);
    }).mousedown((e) => {
      // TODO Allows users to specify mapping in settings.
      this.paddle_buttons[0] = !e.shiftKey && !e.altKey;
      this.paddle_buttons[1] = e.shiftKey && !e.altKey;
      this.paddle_buttons[2] = e.altKey && !e.shiftKey;
    }).mouseup((e) => {
      this.paddle_buttons.fill(false);
    });
  };
}

class VectorVideoImpl extends RasterVideoImpl {

  persistenceAlpha = 0.5;
  jitter = 1.0;
  gamma = 0.8;
  sx: number;
  sy: number;

  create() {
    super.create();
    this.sx = this.width / 1024.0;
    this.sy = this.height / 1024.0;
  }

  clear() {
    var ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = this.persistenceAlpha;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'lighter';
  }

  COLORS = [
    '#111111',
    '#1111ff',
    '#11ff11',
    '#11ffff',
    '#ff1111',
    '#ff11ff',
    '#ffff11',
    '#ffffff'
  ];

  drawLine(x1: number, y1: number, x2: number, y2: number, intensity: number, color: number) {
    var ctx = this.ctx;
    var sx = this.sx;
    var sy = this.sy;
    //console.log(x1,y1,x2,y2,intensity,color);
    if (intensity > 0) {
      // TODO: landscape vs portrait
      var alpha = Math.pow(intensity / 255.0, this.gamma);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3;
      ctx.beginPath();
      // TODO: bright dots
      var jx = this.jitter * (Math.random() - 0.5);
      var jy = this.jitter * (Math.random() - 0.5);
      x1 += jx;
      x2 += jx;
      y1 += jy;
      y2 += jy;
      ctx.moveTo(x1 * sx, this.height - y1 * sy);
      if (x1 == x2 && y1 == y2)
        ctx.lineTo(x2 * sx + 1, this.height - y2 * sy);
      else
        ctx.lineTo(x2 * sx, this.height - y2 * sy);
      ctx.strokeStyle = this.COLORS[color & 7];
      ctx.stroke();
    }
  }
}

export function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  if (!ctx?.setLineDash) return; // for unit testing
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x - 2, 0, 5, 32767);
  ctx.fillRect(0, y - 2, 32767, 5);
  ctx.lineWidth = width;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.setLineDash([width * 2, width * 2]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, 32767);
  ctx.moveTo(0, y);
  ctx.lineTo(32767, y);
  ctx.stroke();
}

// Platforms construct video and timers through these bindings, so a headless
// host can swap in stand-ins with setVideoClasses (see src/tools/emutarget.ts).
export type RasterVideo = RasterVideoImpl;
export let RasterVideo = RasterVideoImpl;
export type VectorVideo = VectorVideoImpl;
export let VectorVideo = VectorVideoImpl;

export interface VideoClasses {
  RasterVideo: typeof RasterVideoImpl;
  VectorVideo: typeof VectorVideoImpl;
  AnimationTimer: typeof AnimationTimerImpl;
}

/** Replace the classes platforms construct; returns the previous ones. */
export function setVideoClasses(classes: Partial<VideoClasses>): VideoClasses {
  const previous = { RasterVideo, VectorVideo, AnimationTimer };
  if (classes.RasterVideo) RasterVideo = classes.RasterVideo;
  if (classes.VectorVideo) VectorVideo = classes.VectorVideo;
  if (classes.AnimationTimer) AnimationTimer = classes.AnimationTimer;
  return previous;
}

export class RAM {
  mem: Uint8Array;
  constructor(size: number) {
    this.mem = new Uint8Array(new ArrayBuffer(size));
  }
}

export class EmuHalt extends Error {
  $loc: SourceLocation;
  /** The address a fault came from, when it is not the current PC (a trap). */
  pc?: number;
  squelchError = true;
  /**
   * true when the program stopped by design (e.g. a semihost exit), as opposed
   * to a fault the CPU reported (illegal opcode, watchdog, bad ROM). Hosts can
   * use this to tell "the program ended" from "the emulator gave up".
   */
  normal: boolean;
  constructor(msg: string, loc?: SourceLocation, normal = false) {
    super(msg);
    this.$loc = loc;
    this.normal = normal;
    Object.setPrototypeOf(this, EmuHalt.prototype);
  }
}

// Platforms call haltEmulation() when the program ends or the CPU stops.
// The host (IDE, extension) installs a handler; headless runs ignore it.
var haltHandler: (err?: EmuHalt) => void = () => { };

export function setHaltHandler(handler: (err?: EmuHalt) => void) {
  haltHandler = handler;
}

export function haltEmulation(err?: EmuHalt) {
  haltHandler(err);
}

export var useRequestAnimationFrame: boolean = false;

class AnimationTimerImpl {

  callback;
  running: boolean = false;
  pulsing: boolean = false;
  nextts = 0;
  nframes;
  startts; // for FPS calc
  frameRate;
  intervalMsec;
  // If a frame is this many intervals late, resync the clock instead of running
  // back-to-back frames to catch up. Catching up floods frame-locked audio (the
  // producer generates many frames of samples at once), so a real-time emulator
  // should drop the missed time rather than burst.
  maxCatchupFrames = 3;
  useReqAnimFrame = useRequestAnimationFrame && typeof window.requestAnimationFrame === 'function'; // need for unit test

  constructor(frequencyHz: number, callback: () => void) {
    this.frameRate = frequencyHz;
    this.intervalMsec = 1000.0 / frequencyHz;
    this.callback = callback;
  }

  scheduleFrame(msec: number) {
    var fn = (timestamp) => {
      try {
        this.nextFrame(this.useReqAnimFrame ? timestamp : Date.now());
      } catch (e) {
        this.running = false;
        this.pulsing = false;
        // A halted program is a normal stop for the host: show it where it
        // stopped instead of letting the browser report an uncaught error.
        if (e instanceof EmuHalt) {
          haltEmulation(e);
          return;
        }
        throw e;
      }
    }
    if (this.useReqAnimFrame)
      window.requestAnimationFrame(fn);
    else
      setTimeout(fn, msec);
  }

  nextFrame(ts: number) {
    if (ts > this.nextts) {
      if (this.running) {
        this.callback();
      }
      if (this.nframes == 0)
        this.startts = ts;
      if (this.nframes++ == 300) {
        console.log("Avg framerate: " + this.nframes * 1000 / (ts - this.startts) + " fps");
      }
    }
    this.nextts += this.intervalMsec;
    // too far behind to catch up smoothly? resync instead of bursting
    if ((ts - this.nextts) > this.intervalMsec * this.maxCatchupFrames) {
      //console.log(ts - this.nextts, 'msec skipped');
      this.nextts = ts;
    }
    if (this.running) {
      this.scheduleFrame(this.nextts - ts);
    } else {
      this.pulsing = false;
    }
  }
  isRunning() {
    return this.running;
  }
  start() {
    if (!this.running) {
      this.running = true;
      this.nextts = 0;
      this.nframes = 0;
      if (!this.pulsing) {
        this.scheduleFrame(0);
        this.pulsing = true;
      }
    }
  }
  stop() {
    this.running = false;
  }
}

export type AnimationTimer = AnimationTimerImpl;
export let AnimationTimer = AnimationTimerImpl;

// TODO: move to util?

export function dumpRAM(ram: ArrayLike<number>, ramofs: number, ramlen: number): string {
  var s = "";
  var bpel = ram['BYTES_PER_ELEMENT'] || 1;
  var perline = Math.ceil(16 / bpel);
  var isFloat = ram instanceof Float32Array || ram instanceof Float64Array;
  // TODO: show scrollable RAM for other platforms
  for (var ofs = 0; ofs < ramlen; ofs += perline) {
    s += '$' + hex(ofs + ramofs) + ':';
    for (var i = 0; i < perline; i++) {
      if (ofs + i < ram.length) {
        if (i == perline / 2) s += " ";
        if (isFloat) s += " " + ram[ofs + i].toPrecision(bpel * 2);
        else s += " " + hex(ram[ofs + i], bpel * 2);
      }
    }
    s += "\n";
  }
  return s;
}

export interface KeyDef {
  c: number,	// key code
  n: string,	// name
  // for gamepad
  plyr?: number,
  xaxis?: number,
  yaxis?: number,
  button?: number
};

export interface KeyMapEntry {
  index: number;
  mask: number;
  def: KeyDef;
}

type KeyCodeMap = Map<number, KeyMapEntry>;

export const Keys = {
  ANYKEY: { c: 0, n: "?" },
  // https://w3c.github.io/gamepad/#remapping
  // gamepad and keyboard (player 0)
  UP: { c: 38, n: "Up", plyr: 0, button: 12, yaxis: -1 },
  DOWN: { c: 40, n: "Down", plyr: 0, button: 13, yaxis: 1 },
  LEFT: { c: 37, n: "Left", plyr: 0, button: 14, xaxis: -1 },
  RIGHT: { c: 39, n: "Right", plyr: 0, button: 15, xaxis: 1 },
  A: { c: 32, n: "Space", plyr: 0, button: 0 },
  B: { c: 16, n: "Shift", plyr: 0, button: 1 },
  GP_A: { c: 88, n: "X", plyr: 0, button: 0 },
  GP_B: { c: 90, n: "Z", plyr: 0, button: 1 },
  GP_C: { c: 86, n: "V", plyr: 0, button: 2 },
  GP_D: { c: 67, n: "C", plyr: 0, button: 3 },
  SELECT: { c: 220, n: "\\", plyr: 0, button: 8 },
  START: { c: 13, n: "Enter", plyr: 0, button: 9 },
  OPTION: { c: 8, n: "Bcksp", plyr: 0, button: 10 },
  // gamepad and keyboard (player 1)
  P2_UP: { c: 87, n: "W", plyr: 1, button: 12, yaxis: -1 },
  P2_DOWN: { c: 83, n: "S", plyr: 1, button: 13, yaxis: 1 },
  P2_LEFT: { c: 65, n: "A", plyr: 1, button: 14, xaxis: -1 },
  P2_RIGHT: { c: 68, n: "D", plyr: 1, button: 15, xaxis: 1 },
  P2_A: { c: 84, n: "T", plyr: 1, button: 0 },
  P2_B: { c: 82, n: "R", plyr: 1, button: 1 },
  P2_GP_A: { c: 69, n: "E", plyr: 1, button: 0 },
  P2_GP_B: { c: 82, n: "R", plyr: 1, button: 1 },
  P2_GP_C: { c: 84, n: "T", plyr: 1, button: 2 },
  P2_GP_D: { c: 89, n: "Y", plyr: 1, button: 3 },
  P2_SELECT: { c: 70, n: "F", plyr: 1, button: 8 },
  P2_START: { c: 71, n: "G", plyr: 1, button: 9 },
  // keyboard only
  VK_ESCAPE: { c: 27, n: "Esc" },
  VK_F1: { c: 112, n: "F1" },
  VK_F2: { c: 113, n: "F2" },
  VK_F3: { c: 114, n: "F3" },
  VK_F4: { c: 115, n: "F4" },
  VK_F5: { c: 116, n: "F5" },
  VK_F6: { c: 117, n: "F6" },
  VK_F7: { c: 118, n: "F7" },
  VK_F8: { c: 119, n: "F8" },
  VK_F9: { c: 120, n: "F9" },
  VK_F10: { c: 121, n: "F10" },
  VK_F11: { c: 122, n: "F11" },
  VK_F12: { c: 123, n: "F12" },
  VK_SCROLL_LOCK: { c: 145, n: "ScrLck" },
  VK_PAUSE: { c: 19, n: "Pause" },
  VK_QUOTE: { c: 222, n: "'" },
  VK_1: { c: 49, n: "1" },
  VK_2: { c: 50, n: "2" },
  VK_3: { c: 51, n: "3" },
  VK_4: { c: 52, n: "4" },
  VK_5: { c: 53, n: "5" },
  VK_6: { c: 54, n: "6" },
  VK_7: { c: 55, n: "7" },
  VK_8: { c: 56, n: "8" },
  VK_9: { c: 57, n: "9" },
  VK_0: { c: 48, n: "0" },
  VK_MINUS: { c: 189, n: "-" },
  VK_MINUS2: { c: 173, n: "-" },
  VK_EQUALS: { c: 187, n: "=" },
  VK_EQUALS2: { c: 61, n: "=" },
  VK_BACK_SPACE: { c: 8, n: "Bkspc" },
  VK_TAB: { c: 9, n: "Tab" },
  VK_Q: { c: 81, n: "Q" },
  VK_W: { c: 87, n: "W" },
  VK_E: { c: 69, n: "E" },
  VK_R: { c: 82, n: "R" },
  VK_T: { c: 84, n: "T" },
  VK_Y: { c: 89, n: "Y" },
  VK_U: { c: 85, n: "U" },
  VK_I: { c: 73, n: "I" },
  VK_O: { c: 79, n: "O" },
  VK_P: { c: 80, n: "P" },
  VK_ACUTE: { c: 219, n: "´" },
  VK_OPEN_BRACKET: { c: 219, n: "[" },
  VK_CLOSE_BRACKET: { c: 221, n: "]" },
  VK_CAPS_LOCK: { c: 20, n: "CpsLck" },
  VK_A: { c: 65, n: "A" },
  VK_S: { c: 83, n: "S" },
  VK_D: { c: 68, n: "D" },
  VK_F: { c: 70, n: "F" },
  VK_G: { c: 71, n: "G" },
  VK_H: { c: 72, n: "H" },
  VK_J: { c: 74, n: "J" },
  VK_K: { c: 75, n: "K" },
  VK_L: { c: 76, n: "L" },
  VK_CEDILLA: { c: 186, n: "Ç" },
  VK_TILDE: { c: 222, n: "~" },
  VK_ENTER: { c: 13, n: "Enter" },
  VK_SHIFT: { c: 16, n: "Shift" },
  VK_BACK_SLASH: { c: 220, n: "\\" },
  VK_Z: { c: 90, n: "Z" },
  VK_X: { c: 88, n: "X" },
  VK_C: { c: 67, n: "C" },
  VK_V: { c: 86, n: "V" },
  VK_B: { c: 66, n: "B" },
  VK_N: { c: 78, n: "N" },
  VK_M: { c: 77, n: "M" },
  VK_COMMA: { c: 188, n: "] =" },
  VK_PERIOD: { c: 190, n: "." },
  VK_SEMICOLON: { c: 59, n: ";" },
  VK_SLASH: { c: 191, n: "/" },
  VK_CONTROL: { c: 17, n: "Ctrl" },
  VK_ALT: { c: 18, n: "Alt" },
  VK_COMMAND: { c: 224, n: "Cmd" },
  VK_SPACE: { c: 32, n: "Space" },
  VK_INSERT: { c: 45, n: "Ins" },
  VK_DELETE: { c: 46, n: "Del" },
  VK_HOME: { c: 36, n: "Home" },
  VK_END: { c: 35, n: "End" },
  VK_PAGE_UP: { c: 33, n: "PgUp" },
  VK_PAGE_DOWN: { c: 34, n: "PgDown" },
  VK_UP: { c: 38, n: "Up" },
  VK_DOWN: { c: 40, n: "Down" },
  VK_LEFT: { c: 37, n: "Left" },
  VK_RIGHT: { c: 39, n: "Right" },
  VK_NUM_LOCK: { c: 144, n: "Num" },
  VK_DIVIDE: { c: 111, n: "Num /" },
  VK_MULTIPLY: { c: 106, n: "Num *" },
  VK_SUBTRACT: { c: 109, n: "Num -" },
  VK_ADD: { c: 107, n: "Num +" },
  VK_DECIMAL: { c: 194, n: "Num ." },
  VK_NUMPAD0: { c: 96, n: "Num 0" },
  VK_NUMPAD1: { c: 97, n: "Num 1" },
  VK_NUMPAD2: { c: 98, n: "Num 2" },
  VK_NUMPAD3: { c: 99, n: "Num 3" },
  VK_NUMPAD4: { c: 100, n: "Num 4" },
  VK_NUMPAD5: { c: 101, n: "Num 5" },
  VK_NUMPAD6: { c: 102, n: "Num 6" },
  VK_NUMPAD7: { c: 103, n: "Num 7" },
  VK_NUMPAD8: { c: 104, n: "Num 8" },
  VK_NUMPAD9: { c: 105, n: "Num 9" },
  VK_NUMPAD_CENTER: { c: 12, n: "Num Cntr" }
};

function _metakeyflags(e) {
  return (e.shiftKey ? KeyFlags.Shift : 0) |
    (e.ctrlKey ? KeyFlags.Ctrl : 0) |
    (e.altKey ? KeyFlags.Alt : 0) |
    (e.metaKey ? KeyFlags.Meta : 0);
}

type KeyMapFunction = (o: KeyMapEntry, key: number, code: number, flags: number) => void;

// the key map of the most recent keyboard handler, so a host can show the
// controls (the VS Code emulator panel does)
var lastKeycodeMap: KeyCodeMap = null;

export function getLastKeycodeMap(): KeyCodeMap {
  return lastKeycodeMap;
}

export function clearLastKeycodeMap() {
  lastKeycodeMap = null;
}

// what each controller key does, in the order the hint lists them
const CONTROL_LABELS: [KeyDef[], string, string][] = [
  [[Keys.UP, Keys.DOWN, Keys.LEFT, Keys.RIGHT], '\u2190\u2191\u2193\u2192', 'Joystick'],
  [[Keys.A], 'Space', 'Button A'],
  [[Keys.B], 'Shift', 'Button B'],
  [[Keys.GP_A, Keys.GP_B, Keys.GP_C, Keys.GP_D], 'X Z V C', 'Buttons'],
  [[Keys.START], 'Enter', 'Start'],
  [[Keys.SELECT], '\\', 'Select'],
  [[Keys.OPTION], 'Backspace', 'Option'],
  [[Keys.P2_UP, Keys.P2_DOWN, Keys.P2_LEFT, Keys.P2_RIGHT], 'W A S D', 'Player 2'],
];

/**
 * Control hints generated from a key map, for platforms with no hand-written
 * ones in PLATFORM_CONTROLS (src/common/controls.ts).
 */
export function describeControls(map: KeyCodeMap): ControlHint[] {
  if (!map) return [];
  var defs = new Set<KeyDef>();
  for (var k of Object.keys(map)) {
    var o: KeyMapEntry = map[k];
    if (o && o.def) defs.add(o.def);
  }
  var hints: ControlHint[] = [];
  for (var [keys, label, action] of CONTROL_LABELS) {
    if (keys.some(key => defs.has(key))) {
      hints.push({ keys: [label], action });
      for (var key of keys) defs.delete(key);
    }
  }
  // the rest (coin, number keys) by name; player 2's buttons go unlisted
  var p2 = new Set(Object.keys(Keys).filter(k => k.startsWith('P2_')).map(k => Keys[k]));
  var others = [...defs].filter(d => d !== Keys.ANYKEY && !p2.has(d)).map(d => d.n);
  if (others.length) hints.push({ keys: others.slice(0, 6), action: 'Other' });
  return hints;
}

export function newKeyboardHandler(switches: number[] | Uint8Array, map: KeyCodeMap, func?: KeyMapFunction, alwaysfunc?: boolean) {
  if (map) lastKeycodeMap = map;
  return (key: number, code: number, flags: number) => {
    if (!map) {
      func(null, key, code, flags);
      return;
    }
    var o: KeyMapEntry = map[key];
    if (!o) o = map[0];
    if (func && (o || alwaysfunc)) {
      func(o, key, code, flags);
    }
    if (o) {
      //console.log(key,code,flags,o);
      var mask = o.mask;
      if (mask < 0) { // negative mask == active low
        mask = -mask;
        if (flags & (KeyFlags.KeyDown | KeyFlags.KeyUp))
          flags ^= KeyFlags.KeyDown | KeyFlags.KeyUp;
      }
      if (flags & KeyFlags.KeyDown) {
        switches[o.index] |= mask;
      } else if (flags & KeyFlags.KeyUp) {
        switches[o.index] &= ~mask;
      }
    }
  };
}

export function setKeyboardFromMap(video: RasterVideo, switches: number[] | Uint8Array, map: KeyCodeMap, func?: KeyMapFunction, alwaysfunc?: boolean) {
  var handler = newKeyboardHandler(switches, map, func, alwaysfunc);
  video.setKeyboardEvents(handler);
  return new ControllerPoller(handler);
}

export function makeKeycodeMap(table: [KeyDef, number, number][]): KeyCodeMap {
  var map = new Map<number, KeyMapEntry>();
  for (var i = 0; i < table.length; i++) {
    var entry = table[i];
    var val: KeyMapEntry = { index: entry[1], mask: entry[2], def: entry[0] };
    map[entry[0].c] = val;
  }
  return map;
}

// TODO: P2_GP_B and P2_GP_C share keycodes with P2_B and P2_A, so they can't
// be listed here without button 1/2 double-binding on player 2.
const DEFAULT_CONTROLLER_KEYS: KeyDef[] = [
  Keys.UP, Keys.DOWN, Keys.LEFT, Keys.RIGHT, Keys.A, Keys.B, Keys.SELECT, Keys.START,
  Keys.GP_A, Keys.GP_B, Keys.GP_C, Keys.GP_D, Keys.OPTION,
  Keys.P2_UP, Keys.P2_DOWN, Keys.P2_LEFT, Keys.P2_RIGHT, Keys.P2_A, Keys.P2_B, Keys.P2_SELECT, Keys.P2_START,
  Keys.P2_GP_A, Keys.P2_GP_D,
];

// Gamepad helper
export class ControllerPoller {
  active = false;
  handler;
  state: Int32Array[];
  lastState: Int32Array[];
  AXIS0 = 24; // first joystick axis index
  constructor(handler: (key, code, flags) => void) {
    this.handler = handler;
    window.addEventListener("gamepadconnected", (event) => {
      console.log("Gamepad connected:", event);
      this.reset();
    });
    window.addEventListener("gamepaddisconnected", (event) => {
      console.log("Gamepad disconnected:", event);
      this.reset();
    });
  }
  reset() {
    if (typeof navigator.getGamepads === 'function') {
      let numGamepads = navigator.getGamepads()?.length;
      this.state = new Array(numGamepads);
      this.lastState = new Array(numGamepads);
      for (var i = 0; i < numGamepads; i++) {
        this.state[i] = new Int32Array(64);
        this.lastState[i] = new Int32Array(64);
      }
      this.active = this.state?.length > 0;
    }
  }
  start() {
    this.reset();
  }
  stop() {
    this.active = false;
  }
  poll() {
    if (!this.active) return;
    var gamepads = navigator.getGamepads && navigator.getGamepads();
    if (!gamepads) return;
    for (var gpi = 0; gpi < gamepads.length; gpi++) {
      let state = this.state[gpi];
      let lastState = this.lastState[gpi];
      var gp = gamepads[gpi];
      if (gp) {
        for (var i = 0; i < gp.axes.length; i++) {
          var k = i + this.AXIS0;
          state[k] = Math.round(gp.axes[i]);
          if (state[k] != lastState[k]) {
            this.handleStateChange(gpi, k);
          }
        }
        for (var i = 0; i < gp.buttons.length; i++) {
          state[i] = gp.buttons[i].pressed ? 1 : 0;
          if (state[i] != lastState[i]) {
            this.handleStateChange(gpi, i);
          }
        }
        lastState.set(state);
      }
    }
  }
  handleStateChange(gpi: number, k: number) {
    var axis = k - this.AXIS0;
    var state = this.state[gpi][k];
    var lastState = this.lastState[gpi][k];
    // TODO: this is slow
    for (var def of DEFAULT_CONTROLLER_KEYS) {
      // is this a gamepad entry? same player #?
      if (!def || def.plyr != gpi) continue;
      // does this key map to the button/axis that changed?
      // an axis has to be compared against the direction the key stands for,
      // so that e.g. a left-to-right flick releases LEFT and presses RIGHT
      var active: boolean, wasActive: boolean;
      if (def.button != null && k == def.button) {
        active = state != 0;
        wasActive = lastState != 0;
      } else if (axis == 0 && def.xaxis != null) {
        active = def.xaxis == state;
        wasActive = def.xaxis == lastState;
      } else if (axis == 1 && def.yaxis != null) {
        active = def.yaxis == state;
        wasActive = def.yaxis == lastState;
      } else {
        continue;
      }
      // don't break -- several keys can share a button (e.g. A and GP_A)
      //console.log("Gamepad", gpi, def.c, state);
      if (active && !wasActive) {
        this.handler(def.c, 0, KeyFlags.KeyDown);
      } else if (!active && wasActive) {
        this.handler(def.c, 0, KeyFlags.KeyUp);
      }
    }
  }
}

// handy for loadROM()
export function padBytes(data: Uint8Array | number[], len: number, padstart?: boolean): Uint8Array {
  if (data.length > len) {
    throw Error("Data too long, " + data.length + " > " + len);
  }
  var r = new RAM(len);
  if (padstart)
    r.mem.set(data, len - data.length);
  else
    r.mem.set(data);
  return r.mem;
}

type AddressReadWriteFn = ((a: number) => number) | ((a: number, v: number) => void);
type AddressDecoderEntry = [number, number, number, AddressReadWriteFn];
type AddressDecoderOptions = { gmask?: number, defaultval?: number };

// TODO: better performance, check values
export function AddressDecoder(table: AddressDecoderEntry[], options?: AddressDecoderOptions) {
  var self = this;
  function makeFunction() {
    var s = "";
    if (options && options.gmask) {
      s += "a&=" + options.gmask + ";";
    }
    for (var i = 0; i < table.length; i++) {
      var entry = table[i];
      var start = entry[0] | 0;
      var end = entry[1] | 0;
      var mask = entry[2] | 0;
      var func = entry[3];
      self['__fn' + i] = func;
      s += "if (a>=" + start + " && a<=" + end + "){";
      if (mask) s += "a&=" + mask + ";";
      s += "return this.__fn" + i + "(a,v)&0xff;}\n";
    }
    s += "return " + (options?.defaultval | 0) + ";";
    return new Function('a', 'v', s);
  }
  return makeFunction().bind(self);
}

export function newAddressDecoder(table: AddressDecoderEntry[], options?: AddressDecoderOptions): (a: number, v?: number) => number {
  return new (AddressDecoder as any)(table, options);
}


// https://stackoverflow.com/questions/17130395/real-mouse-position-in-canvas
export function getMousePos(canvas: HTMLCanvasElement, evt): { x: number, y: number } {
  // Improves reachability of min and max values at edges of canvas. Without delta,
  // min and max values would be represented by 1/2 as many pixels as other values.
  const delta = .5;
  // Canvas HTML element has integer `width` and `height`, but getBoundingClientRect() pos & size
  // are scaled to non-integer values. Mouse events return integer x/y values in the range
  // [Math.floor(rect.left/top), Math.floor(rect.left/top) + Math.floor(rect.width/height)],
  // which may not be the same as [Math.floor(rect.left/top), Math.floor(rect.right/bottom)].
  var rect = canvas.getBoundingClientRect(), // abs. size of element
    // Ignore canvas borders and padding, so mouse position is relative to canvas content.
    style = window.getComputedStyle(canvas),
    left = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
    right = parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight),
    top = parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
    bottom = parseFloat(style.borderBottomWidth) + parseFloat(style.paddingBottom),
    width = rect.width - left - right,
    height = rect.height - top - bottom,

    // Determine scale factors to map mouse coordinates to canvas coordinates.
    scaleX = canvas.width / Math.floor(width - 2 * delta),
    scaleY = canvas.height / Math.floor(height - 2 * delta),

    // Scale coordinates after they've been adjusted to be relative to canvas content.
    x = (evt.clientX - delta - rect.left - left) * scaleX,
    y = (evt.clientY - delta - rect.top - top) * scaleY;
  return {
    // Clamp to [0, canvas.width/height] to prevent non-integer rect position
    // and size, and potentially `delta`, from returning out of bounds values.
    x: Math.max(0, Math.min(canvas.width, x)),
    y: Math.max(0, Math.min(canvas.height, y))
  }
}


