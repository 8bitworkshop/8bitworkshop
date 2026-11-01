
import { SampledAudioSink } from "../common/devices";

import { setScriptLoader } from "../common/util";

import fs from 'fs';
import path from 'path';
import vm from 'vm';

export function mockGlobals() {
    global.atob = require('atob');
    global.btoa = require('btoa');
    (global as any).window = global;
    (global as any).window.addEventListener = (global as any).window.addEventListener || function () { };
    (global as any).window.removeEventListener = (global as any).window.removeEventListener || function () { };
    (global as any).document = (global as any).document || { addEventListener() { }, removeEventListener() { } };
    try { (global as any).navigator = (global as any).navigator || {}; } catch (e) { }
    // Node's own localStorage warns unless given a file; scripts only need a stub
    Object.defineProperty(global, 'localStorage', { value: memoryStorage(), configurable: true, writable: true });
}

function memoryStorage() {
    const items = new Map<string, string>();
    return {
        get length() { return items.size; },
        key: (i: number) => [...items.keys()][i] ?? null,
        getItem: (k: string) => items.has(k) ? items.get(k) : null,
        setItem: (k: string, v: string) => { items.set(k, String(v)); },
        removeItem: (k: string) => { items.delete(k); },
        clear: () => { items.clear(); },
    };
}

export class NullAudio implements SampledAudioSink {
    feedSample(value: number, count: number): void {
    }
}

export function mockAudio() {
    // The real TSS PsgDeviceChannel is a small register machine; platforms
    // (astrocade, vectrex) read/write its registers and set its clock, so the
    // stand-in has to keep those too, not just absorb the calls.
    class NullPsgDeviceChannel {
        clock = 0;
        register = new Int32Array(16);
        setMode() { }
        setDevice() { }
        setClock(clock: number) { this.clock = clock; }
        generate() { }
        setBufferLength() { }
        setSampleRate() { }
        getBuffer() { return []; }
        writeRegister() { }
        writeRegisterSN() { }
        writeRegisterAY(addr: number, val: number) { if (addr >= 0 && addr < 16) this.register[addr] = val & 0xff; }
        readRegister(addr: number) { return this.register[addr & 0xf]; }
    }
    // the constants the audio wrappers reference; values match tss/js/tss/PsgDeviceChannel.js
    (NullPsgDeviceChannel as any).MODE_UNSIGNED = 0;
    (NullPsgDeviceChannel as any).MODE_SIGNED = 1;
    (NullPsgDeviceChannel as any).DEVICE_PSG = 0;
    (NullPsgDeviceChannel as any).DEVICE_SSG = 1;
    (NullPsgDeviceChannel as any).DEVICE_AY_3_8910 = 0;
    (NullPsgDeviceChannel as any).DEVICE_YM_2149 = 1;
    (NullPsgDeviceChannel as any).DEVICE_SN76489 = 2;
    class NullMasterChannel {
        channels: any[] = [];
        // AudioLooper.setChannel() configures whatever MasterChannel it is given,
        // so the stand-in has to accept these even though it mixes nothing. Like
        // the real MasterChannel, it forwards the config to its slave channels.
        addChannel(channel: any) { return this.channels.push(channel); }
        setBufferLength(length: number) { this.channels.forEach((c) => c.setBufferLength(length)); }
        setSampleRate(rate: number) { this.channels.forEach((c) => c.setSampleRate(rate)); }
    }
    // MasterAudio drives the real TSS MasterChannel through SampleAudio's
    // Web Audio graph. Node has no AudioContext, so SampleAudio stays silent;
    // the channel stand-in still has to keep the register interfaces alive.
    global.MasterChannel = NullMasterChannel;
    global.PsgDeviceChannel = NullPsgDeviceChannel;
}

/** Serve fetch() from the filesystem, relative to `rootDir`. */
export function mockFetch(rootDir: string = process.cwd()) {
    global.fetch = async (url, init) => {
        let bin = fs.readFileSync(path.resolve(rootDir, String(url)));
        let blob = new Blob([bin]);
        return new Response(blob);
    }
}

/**
 * Make loadScript() evaluate files from `rootDir` in the global scope, the
 * way a <script> tag would. Each script loads once.
 */
let clearLoadedScripts: (() => void) | null = null;

export function mockScripts(rootDir: string = process.cwd()) {
    const loaded = new Map<string, Promise<void>>();
    clearLoadedScripts = () => loaded.clear();
    setScriptLoader((url) => {
        const file = path.resolve(rootDir, url);
        if (!loaded.has(file)) {
            loaded.set(file, (async () => {
                vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
            })());
        }
        return loaded.get(file);
    });
}

/**
 * Forget which scripts have been evaluated, so the next loadScript() runs them
 * again. A platform that keeps global state (Javatari deletes its own start())
 * needs a fresh script for a second run in the same process; a browser gets
 * that from a page reload.
 */
export function resetScripts() {
    if (clearLoadedScripts) clearLoadedScripts();
}

export function mockDOM() {
  const jsdom = require('jsdom');
  const { JSDOM } = jsdom;
  const dom = new JSDOM(`<!DOCTYPE html><div id="emulator"><div id="javatari-div"><div id="javatari-screen"></div><div id="javatari-console-panel"></div></div></div>`);
  global.window = dom.window;
  global.document = dom.window.document;
  // scripts loaded by loadScript() (Javatari) use these as bare globals
  global.Image ??= dom.window.Image;
  // jsdom has no 2D context without the canvas package
  dom.window.HTMLCanvasElement.prototype.getContext = function () {
    return this._ctx2d ??= mockContext2D(this);
  };
  //global['$'] = require("jquery/jquery.min.js");
  dom.window.Audio = null;
  //global.Image = function () { };
  return dom;
}

/** A 2D context that draws nothing but hands out real ImageData buffers. */
function mockContext2D(canvas: { width: number, height: number }) {
  const imageData = (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
  return {
    canvas,
    fillStyle: '', strokeStyle: '', globalAlpha: 1, globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true, font: '', lineWidth: 1,
    createImageData: imageData,
    getImageData: (_x: number, _y: number, w: number, h: number) => imageData(w, h),
    putImageData() { }, drawImage() { }, fillRect() { }, clearRect() { }, strokeRect() { },
    fillText() { }, measureText: () => ({ width: 0 }),
    beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, stroke() { }, fill() { }, arc() { }, rect() { },
    save() { }, restore() { }, translate() { }, scale() { }, rotate() { }, setTransform() { },
  };
}
