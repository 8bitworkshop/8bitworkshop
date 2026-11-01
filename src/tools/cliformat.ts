// Terminal output helpers for the 8bws CLI.
//
// Every command returns a CLIResult; output() renders it either as JSON
// (--json) or as colorized text. Keeping this out of 8bws.ts leaves the
// command implementations free of ANSI noise.

import { hex } from '../common/util';
import { urustErrorDocURL } from '../common/toolmeta';

export interface CLIResult {
  success: boolean;
  command: string;
  data?: any;
  error?: string;
}

export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

let jsonMode = false;
let emit = console.log;

/**
 * In --json mode stdout carries the CLIResult and nothing else, so the
 * compiler's chatter (plain console.log from the worker) is pushed to stderr.
 */
export function setJsonMode(on: boolean) {
  jsonMode = on;
  if (!on) return;
  emit = console.log.bind(console);
  console.log = (...args: any[]) => process.stderr.write(args.join(' ') + '\n');
}
export function isJsonMode() { return jsonMode; }

let serving = false;

/**
 * For `8bws dap`: stdout carries the protocol, so console output goes to
 * stderr, and fail() throws, so the server can answer with the error
 * instead of exiting.
 */
export function setServerMode() {
  serving = true;
  const toStderr = (...args: any[]) => { process.stderr.write(args.join(' ') + '\n'); };
  console.log = console.info = console.warn = console.debug = toStderr;
}

/** Human-facing output: stdout normally, stderr in --json mode. */
export function write(s: string): void {
  (jsonMode ? process.stderr : process.stdout).write(s);
}

// progress/status chatter -- suppressed in --json mode so stdout stays parseable
export function note(msg: string): void {
  if (!jsonMode || serving) process.stderr.write(`${c.dim}${msg}${c.reset}\n`);
}

/** A problem worth fixing that doesn't stop the command; stderr in any mode. */
export function warn(msg: string): void {
  process.stderr.write(`${c.yellow}Warning: ${msg}${c.reset}\n`);
}

let emitted = false;

/** True once a CLIResult has been printed -- lets main() detect a silent exit. */
export function hasOutput(): boolean { return emitted; }

export function output(result: CLIResult): void {
  emitted = true;
  if (jsonMode) {
    emit(JSON.stringify(result, null, 2));
    return;
  }
  process.stderr.write(result.success
    ? `${c.bgGreen}${c.bold}${c.white} OK ${c.reset} `
    : `${c.bgRed}${c.bold}${c.white} FAIL ${c.reset} `);
  process.stderr.write(`${c.bold}${c.cyan}${result.command}${c.reset}\n`);
  if (result.error) {
    process.stderr.write(`${c.red}Error: ${result.error}${c.reset}\n`);
  }
  if (result.data) {
    (FORMATTERS[result.command] || formatGeneric)(result.data);
  }
}

// exit with a formatted error message
export function fail(command: string, error: string, data?: any): never {
  if (serving) {
    const details = (data?.errors || []).map((e: any) => `\n${e.path || ''}${e.line ? ':' + e.line : ''}: ${e.msg}`).join('');
    throw new Error(`${command}: ${error}${details}`);
  }
  output({ success: false, command, error, data });
  process.exit(1);
}

const FORMATTERS: { [command: string]: (data: any) => void } = {
  help: formatHelp,
  build: formatBuild,
  run: formatRun,
  'list-tools': formatList('tools', 'Available tools'),
  'list-platforms': formatPlatforms,
  detect: formatDetect,
  presets: formatPresets,
  new: formatNew,
};

function formatHelp(data: any): void {
  console.log(`\n${c.bold}Usage:${c.reset} 8bws <command> [options] <file>\n`);
  console.log(`${c.bold}Commands:${c.reset}`);
  for (const [cmd, usage] of Object.entries(data.commands || {})) {
    console.log(`  ${c.green}${cmd.padEnd(14)}${c.reset}${c.dim}${usage}${c.reset}`);
  }
  if (data.options) {
    for (const [section, opts] of Object.entries(data.options as any)) {
      console.log(`\n${c.bold}${section}:${c.reset}`);
      for (const [flag, desc] of Object.entries(opts as any)) {
        console.log(`  ${c.yellow}${flag.padEnd(22)}${c.reset}${c.dim}${desc}${c.reset}`);
      }
    }
  }
  if (data.script) {
    console.log(`\n${c.bold}Script commands${c.reset} ${c.dim}(-e / --script)${c.reset}\n${data.script}`);
  }
  console.log();
}

function formatBuild(data: any): void {
  if (data.errors) {
    for (const err of data.errors) {
      let loc = '';
      if (err.path) loc += `${c.cyan}${err.path}${c.reset}`;
      if (err.line) loc += `${c.dim}:${c.reset}${c.yellow}${err.line}${c.reset}`;
      if (loc) loc += ` ${c.dim}-${c.reset} `;
      console.log(`  ${c.red}●${c.reset} ${loc}${err.msg || err.message || JSON.stringify(err)}`);
      for (const help of err.help || []) {
        console.log(`      ${c.dim}= help:${c.reset} ${help}`);
      }
      const url = urustErrorDocURL(err.topic);
      if (url) console.log(`      ${c.dim}see ${url}${c.reset}`);
    }
    return;
  }
  field('Tool', data.tool, c.green);
  field('Platform', data.platform, c.green);
  field('Source', data.source, c.cyan);
  if (data.outputSize != null) field('Size', `${data.outputSize} bytes`, c.yellow);
  field('Output', data.outputFile, c.cyan);
  if (data.symbolmap) {
    console.log(`\n${c.bold}Symbols${c.reset} ${c.dim}(${Object.keys(data.symbolmap).length})${c.reset}`);
    for (const [name, addr] of Object.entries(data.symbolmap).sort((a: any, b: any) => a[1] - b[1])) {
      console.log(`  ${c.cyan}$${hex(addr as number, 4)}${c.reset}  ${name}`);
    }
  }
  if (data.segments) {
    console.log(`\n${c.bold}Segments${c.reset} ${c.dim}(${data.segments.length})${c.reset}`);
    for (const seg of data.segments) {
      console.log(`  ${c.green}${seg.name.padEnd(16)}${c.reset} ${c.cyan}$${hex(seg.start, 4)}${c.reset}  ${c.dim}size${c.reset} ${c.yellow}${seg.size}${c.reset}`);
    }
  }
  if (data.saveDir) {
    console.log(`\n${c.bold}Saved to${c.reset} ${c.cyan}${data.saveDir}${c.reset} ${c.dim}(${data.savedFiles.length} files)${c.reset}`);
    for (const f of data.savedFiles) console.log(`  ${c.dim}●${c.reset} ${f}`);
  }
}

function formatRun(data: any): void {
  field('Platform', data.platform, c.green);
  field('ROM', data.rom, c.cyan);
  if (data.frames != null) field('Frames', data.frames, c.yellow);
  if (data.width) field('Video', `${data.width}x${data.height}`, c.yellow);
  field('Screenshot', data.png, c.cyan);
}

function formatList(key: string, title: string) {
  return (data: any) => {
    console.log(`\n${c.bold}${title}${c.reset} ${c.dim}(${data[key].length})${c.reset}\n`);
    for (const item of data[key]) console.log(`  ${c.green}●${c.reset} ${item}`);
    console.log();
  };
}

function formatPlatforms(data: any): void {
  console.log(`\n${c.bold}Available platforms${c.reset} ${c.dim}(${data.count})${c.reset}\n`);
  const byArch: { [arch: string]: string[] } = {};
  for (const [name, info] of Object.entries(data.platforms) as [string, any][]) {
    (byArch[info.arch || 'unknown'] ||= []).push(name);
  }
  for (const [arch, platforms] of Object.entries(byArch).sort()) {
    console.log(`  ${c.bold}${c.magenta}${arch}${c.reset}`);
    for (const p of platforms.sort()) console.log(`    ${c.green}●${c.reset} ${p}`);
  }
  console.log();
}

function formatDetect(data: any): void {
  if (!data.detections.length) {
    console.log(`  ${c.dim}no platform found${c.reset}`);
    return;
  }
  for (const d of data.detections) {
    const main = d.mainFile ? `  main: ${d.mainFile}` : d.mainCandidates && d.mainCandidates.length > 1 ? `  ${d.mainCandidates.length} programs` : '';
    const tool = d.tool ? `  tool: ${d.tool}` : '';
    console.log(`  ${c.bold}${c.green}${d.platform.padEnd(18)}${c.reset}${String(d.score).padEnd(6)}${main}${tool}`);
    for (const e of d.evidence) {
      console.log(`    ${c.dim}${e.file}${e.line ? ':' + e.line : ''}${c.reset} ${e.reason}`);
    }
  }
  if (!data.clear) console.log(`  ${c.yellow}no clear winner; pass --platform${c.reset}`);
}

function formatPresets(data: any): void {
  if (data.platforms) {
    console.log(`\n${c.bold}Platforms with examples${c.reset} ${c.dim}(${data.platforms.length}; 8bws presets <platform> lists them)${c.reset}\n`);
    for (const p of data.platforms) console.log(`  ${c.green}${p.id.padEnd(22)}${c.reset}${p.name.padEnd(30)}${c.dim}${p.count}${c.reset}`);
    console.log();
    return;
  }
  console.log(`\n${c.bold}${data.name}${c.reset} ${c.dim}(8bws new ${data.platform}/<file> [dir])${c.reset}`);
  let category = '';
  for (const t of data.templates) {
    if (t.category !== category) console.log(`\n  ${c.bold}${c.magenta}${category = t.category}${c.reset}`);
    console.log(`    ${c.green}${t.id.padEnd(26)}${c.reset}${c.dim}${t.name}${c.reset}`);
  }
  console.log();
}

function formatNew(data: any): void {
  field('Preset', data.preset, c.green);
  field('Directory', data.dir, c.cyan);
  for (const f of data.files) console.log(`  ${c.dim}●${c.reset} ${f}`);
  if (data.libraries?.length) console.log(`  ${c.dim}shared, not copied (add --libs): ${data.libraries.join(', ')}${c.reset}`);
  console.log(`\n  ${c.dim}next:${c.reset} ${data.build}`);
}

function formatGeneric(data: any): void {
  for (const [key, value] of Object.entries(data)) {
    const v = (typeof value === 'object' && value !== null) ? JSON.stringify(value) : value;
    console.log(`  ${c.dim}${key}:${c.reset} ${v}`);
  }
}

function field(label: string, value: any, color: string): void {
  if (value == null || value === false) return;
  console.log(`  ${c.dim}${(label + ':').padEnd(11)}${c.reset}${color}${value}${c.reset}`);
}

// shared hexdump used by 'mem' and --memdump
export function hexdump(read: (addr: number) => number, start: number, end: number, out = write): void {
  for (let ofs = 0; start + ofs <= end; ofs += 16) {
    let line = `${hex(start + ofs, 4)}:`;
    let ascii = '';
    for (let i = 0; i < 16 && start + ofs + i <= end; i++) {
      if (i === 8) line += ' ';
      const byte = read(start + ofs + i);
      line += ` ${hex(byte)}`;
      ascii += (byte >= 0x20 && byte < 0x7f) ? String.fromCharCode(byte) : '.';
    }
    out(`${line.padEnd(60)} ${ascii}\n`);
  }
}
