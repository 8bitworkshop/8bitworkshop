
// toolselect - which tool builds a file, by platform and filename.
// The one table the IDE's platform objects, the CLI, and the VS Code
// extension all use. Keep this module free of emulator imports so build-only
// code can use it without pulling in CPU cores.

import { getBasePlatform, getRootBasePlatform } from "./util";

export type ToolSelector = (fn: string) => string;

////// per architecture

export function getToolForFilename_6502(fn: string): string {
  if (fn.endsWith("-llvm.c")) return "remote:llvm-mos";
  if (fn.endsWith("-sdcc.c") || fn.endsWith(".sdcc")) return "sdcc";   // SDCC 4.x mos6502 backend
  if (fn.endsWith(".c")) return "cc65";
  if (fn.endsWith(".h")) return "cc65";
  if (fn.endsWith(".s")) return "ca65";
  if (fn.endsWith(".ca65")) return "ca65";
  if (fn.endsWith(".dasm")) return "dasm";
  if (fn.endsWith(".bb")) return "bataribasic";
  if (fn.endsWith(".acme")) return "acme";
  if (fn.endsWith(".xa")) return "xa";
  if (fn.endsWith(".wiz")) return "wiz";
  if (fn.endsWith(".ecs")) return "ecs";
  if (fn.endsWith(".cpp")) return "oscar64";
  if (fn.endsWith(".cc")) return "oscar64";
  if (fn.endsWith(".o64")) return "oscar64";
  if (fn.endsWith(".rs")) return "urust";
  return "dasm"; // .a
}

export function getToolForFilename_z80(fn: string): string {
  if (fn.endsWith(".c") || fn.endsWith(".sdcc")) return "sdcc";
  if (fn.endsWith(".h")) return "sdcc";
  if (fn.endsWith(".s")) return "sdasz80";
  if (fn.endsWith(".sgb")) return "sdasgb";
  if (fn.endsWith(".ns")) return "naken";
  if (fn.endsWith(".scc")) return "sccz80";
  if (fn.endsWith(".z")) return "zmac";
  if (fn.endsWith(".wiz")) return "wiz";
  if (fn.endsWith(".rs")) return "urust";
  return "zmac";
}

// CVBasic is a portable BASIC: the same .bas source builds for Colecovision,
// MSX, SG-1000/MSM and NES, so each of those platforms sends .bas to it while
// its other extensions keep their usual tools.
function withCVBasic(sel: ToolSelector): ToolSelector {
  return (fn: string) => fn.endsWith(".bas") ? "cvbasic" : sel(fn);
}

export function getToolForFilename_coleco(fn: string): string {
  return withCVBasic(getToolForFilename_z80)(fn);
}

export function getToolForFilename_msx(fn: string): string {
  return withCVBasic(getToolForFilename_z80)(fn);
}

export function getToolForFilename_sms(fn: string): string {
  return withCVBasic(getToolForFilename_z80)(fn);
}

export function getToolForFilename_6809(fn: string): string {
  if (fn.endsWith(".c")) return "cmoc";
  if (fn.endsWith(".h")) return "cmoc";
  if (fn.endsWith(".xasm")) return "xasm6809";
  if (fn.endsWith(".lwasm")) return "lwasm";
  return "cmoc";
}

export function getToolForFilename_arm32(fn: string): string {
  fn = fn.toLowerCase();
  if (fn.endsWith(".vasm")) return "vasmarm";
  if (fn.endsWith(".armips")) return "armips";
  return "armtcc";
}

////// per platform

// TODO: merge with getToolForFilename_6502?
export function getToolForFilename_vcs(fn: string): string {
  if (fn.endsWith(".cc2600")) return "cc2600";
  if (fn.endsWith("-llvm.c")) return "remote:llvm-mos";
  if (fn.endsWith(".wiz")) return "wiz";
  if (fn.endsWith(".bb") || fn.endsWith(".bas")) return "bataribasic";
  if (fn.endsWith(".ca65")) return "ca65";
  if (fn.endsWith(".acme")) return "acme";
  //if (fn.endsWith(".inc")) return "ca65";
  if (fn.endsWith(".c")) return "cc65";
  //if (fn.endsWith(".h")) return "cc65";
  if (fn.endsWith(".ecs")) return "ecs";
  if (fn.endsWith(".rs")) return "urust";
  return "dasm";
}

export function getToolForFilename_atari7800(fn: string): string {
  if (fn.endsWith(".cc7800")) return "cc7800";
  if (fn.endsWith(".c78")) return "cc7800";
  return getToolForFilename_6502(fn);
}

export function getToolForFilename_atari8(fn: string): string {
  if (fn.endsWith(".bas") || fn.endsWith(".fb") || fn.endsWith(".fbi")) return "fastbasic";
  return getToolForFilename_6502(fn);
}

export function getToolForFilename_apple2(fn: string): string {
  if (fn.endsWith(".lnk")) return "merlin32";
  return getToolForFilename_6502(fn);
}

export function getToolForFilename_nes(fn: string): string {
  //if (fn.endsWith(".asm")) return "ca65"; // .asm uses ca65
  if (fn.endsWith(".nesasm")) return "nesasm";
  if (fn.endsWith(".bas")) return "cvbasic";
  return getToolForFilename_6502(fn);
}

export function getToolForFilename_channelf(fn: string): string {
  if (fn.endsWith(".c")) return "cc65";
  if (fn.endsWith(".s") || fn.endsWith(".ca65")) return "ca65";
  return "dasm";
}

export function getToolForFilename_verilog(fn: string): string {
  if (fn.endsWith(".asm")) return "jsasm";
  if (fn.endsWith(".ice")) return "silice";
  return "verilator";
}

export function getToolForFilename_x86(fn: string): string {
  if (fn.endsWith(".c")) return "smlrc";
  return "yasm";
}

export function getToolForFilename_zmachine(fn: string): string {
  return fn.endsWith(".dg") ? "dialog" : "inform6";
}

export function getToolForFilename_basic(fn: string): string {
  return "basic";
}

// Looked up by full platform id, then base id (no .suffix), then root id (no
// -specialization), so e.g. williams-z80 can differ from williams.
const PLATFORM_TOOLS: { [platform: string]: ToolSelector } = {
  // 6502
  'vcs': getToolForFilename_vcs,
  'atari7800': getToolForFilename_atari7800,
  'atari8': getToolForFilename_atari8,
  'apple2': getToolForFilename_apple2,
  'nes': getToolForFilename_nes,
  'c64': getToolForFilename_6502,
  'vic20': getToolForFilename_6502,
  'kim1': getToolForFilename_6502,
  'exidy': getToolForFilename_6502,
  'devel': getToolForFilename_6502,
  'pce': getToolForFilename_6502,
  'vector': getToolForFilename_6502,
  // Z80 and friends
  'vector-z80color': getToolForFilename_z80,
  'williams-z80': getToolForFilename_z80,
  'astrocade': getToolForFilename_z80,
  'coleco': getToolForFilename_coleco,
  'cpc': getToolForFilename_z80,
  'galaxian': getToolForFilename_z80,
  'gb': getToolForFilename_z80,
  'mcr': getToolForFilename_z80,
  'msx': getToolForFilename_msx,
  'mw8080bw': getToolForFilename_z80,
  'pacman': getToolForFilename_z80,
  'sms': getToolForFilename_sms,
  'sound_konami': getToolForFilename_z80,
  'sound_williams': getToolForFilename_z80,
  'vicdual': getToolForFilename_z80,
  'zx': getToolForFilename_z80,
  // 6809
  'williams': getToolForFilename_6809,
  'vectrex': getToolForFilename_6809,
  // other
  'arm32': getToolForFilename_arm32,
  'channelf': getToolForFilename_channelf,
  'verilog': getToolForFilename_verilog,
  'x86': getToolForFilename_x86,
  'zmachine': getToolForFilename_zmachine,
  'basic': getToolForFilename_basic,
};

export function getToolSelector(platform: string): ToolSelector | undefined {
  return PLATFORM_TOOLS[platform]
    || PLATFORM_TOOLS[getBasePlatform(platform)]
    || PLATFORM_TOOLS[getRootBasePlatform(platform)];
}

/** The tool that builds `fn` on `platform`. Unknown platforms get the Z80 tools. */
export function getToolForPlatform(platform: string, fn: string): string {
  return (getToolSelector(platform) || getToolForFilename_z80)(fn);
}
