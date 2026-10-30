import { defineArgs, extraArgsFor, linkSymbolArgs, getPlatformToolConfig, SDCC_DEFAULT_VERSION } from "../../common/toolmeta";
import { CodeListingMap, WorkerError } from "../../common/workertypes";
import { BuildStep, BuildStepResult, gatherFiles, staleFiles, populateFiles, putWorkFile, populateExtraFiles, anyTargetChanged, getWorkFileAsString, getWorkFileData, fixParamsWithDefines, applyAsmProjectParams } from "../builder";
import { parseListing, parseSourceLines, msvcErrorMatcher, hasErrors } from "../listingutils";
import { EmscriptenModule, emglobal, ensureFilesystem, ensureWasiFilesystem, execMain, loadNative, moduleInstFn, print_fn, setupFS, setupStdin } from "../wasmutils";
import { runWASITool, checkExitCode, readWASIOutputString } from "../wasiutils";
import { preprocessMCPP } from "./mcpp";

// SDCC 4.x runs as WASI over sdcc-fs.zip, which holds share/sdcc/{include,lib/<port>}.
// Platforms with libraries built by SDCC 3.x stay on the 3.6.5 Emscripten build
// (see SDCC_FS in toolmeta).
const SDCC4_INCLUDE = 'share/sdcc/include';
const SDCC4_LIB = 'share/sdcc/lib';

/**
 * The SDCC port a build targets. `arch` is the platform param: z80 (the
 * default), gbz80, or 6502 for the mos6502 backend, which exists only in 4.x.
 */
export interface SDCCTarget {
    mflag: string;      // sdcc -m<port>
    as: 'sdasz80' | 'sdasgb' | 'sdas6500';
    lib: string;        // lib/<lib> in sdcc-fs.zip, and the sdld -l name
    sdcccall: number;   // default calling convention (__SDCCCALL)
    only4?: boolean;    // no 3.x build
}

export function sdccTarget(arch: string | undefined): SDCCTarget {
    switch (arch) {
        case 'gbz80': return { mflag: '-mgbz80', as: 'sdasgb', lib: 'gbz80', sdcccall: 1 };
        case '6502': return { mflag: '-mmos6502', as: 'sdas6500', lib: 'mos6502', sdcccall: 0, only4: true };
        default: return { mflag: '-mz80', as: 'sdasz80', lib: arch || 'z80', sdcccall: 1 };
    }
}

// what the sdcc driver predefines when it runs sdcpp; mcpp must supply them
function sdcc4Defines(target: SDCCTarget) {
    return [
    '-D', '__SDCC=4_6_3',
    '-D', '__SDCC_VERSION_MAJOR=4',
    '-D', '__SDCC_VERSION_MINOR=6',
    '-D', '__SDCC_VERSION_PATCH=3',
    '-D', `__SDCCCALL=${target.sdcccall}`,
    ...(target.mflag === '-mmos6502' ? ['-D', '__SDCC_mos6502=1'] : []),
    '-D', '__STDC_NO_COMPLEX__=1',
    '-D', '__STDC_NO_THREADS__=1',
    '-D', '__STDC_NO_ATOMICS__=1',
    '-D', '__STDC_NO_VLA__=1',
    ];
}

/**
 * The SDCC 4.x filesystem zip for this build, or null for SDCC 3.6.5. The
 * version is `//#tooldef c sdcc=3|4` (params.sdcc_version) or else
 * SDCC_DEFAULT_VERSION. Platforms with 3.x-only libraries always get 3.x,
 * and asking for 4.x there is an error.
 */
function sdcc4FS(step: BuildStep): string | null {
    const requested = step.params.sdcc_version;
    const only4 = sdccTarget(step.params.arch).only4;
    if (requested === 3 && only4) throw new Error(`SDCC 3 has no ${step.params.arch} backend. Remove "//#tooldef c sdcc=3".`);
    if ((requested ?? (only4 ? 4 : SDCC_DEFAULT_VERSION)) !== 4) return null;
    const zip = getPlatformToolConfig('sdcc', step.platform)?.wasiFSZip;
    if (!zip && requested === 4) {
        throw new Error(`SDCC 4 can't build for ${step.platform}: its libraries were compiled by SDCC 3. Remove "//#tooldef c sdcc=4".`);
    }
    return zip || null;
}

/** True if the step's cached asm output came from the other SDCC version. */
function builtByOtherSDCC(outpath: string, fs4: string | null): boolean {
    const asm = getWorkFileAsString(outpath);
    if (typeof asm !== 'string') return false;
    const m = /^; Version (\d+)\./m.exec(asm);
    return !!m && (m[1] === '4') !== !!fs4;
}

function hexToArray(s, ofs) {
    var buf = new ArrayBuffer(s.length / 2);
    var arr = new Uint8Array(buf);
    for (var i = 0; i < arr.length; i++) {
        arr[i] = parseInt(s.slice(i * 2 + ofs, i * 2 + ofs + 2), 16);
    }
    return arr;
}

/**
 * Banked ROM layout, following the GBDK/devkitSMS convention: the linker places
 * bank N's area at the virtual address (N << 16) | window, and the ROM image
 * holds bank N at file offset N * size.
 */
export interface ROMBanking {
    size: number;   // bytes per bank (power of 2)
    window: number; // CPU address the switchable bank is mapped at
}

/** Linker `-b` args for each `_CODE_N` area (N > 0) the object files declare. */
export function bankedAreaArgs(rels: string[], banking: ROMBanking): string[] {
    let banks = new Set<number>();
    for (let rel of rels) {
        let re = /^A _CODE_(\d+) /gm, m;
        while ((m = re.exec(rel))) {
            let n = parseInt(m[1]);
            if (n > 0) banks.add(n);
        }
    }
    let args = [];
    for (let n of Array.from(banks).sort((a, b) => a - b))
        args.push('-b', `_CODE_${n}=0x${((n << 16) | banking.window).toString(16)}`);
    return args;
}

/**
 * True if any of the object files declares the area, or if one of them can't
 * be read (so the caller keeps its default).
 */
export function objectsDefineArea(objfiles: string[], area: string): boolean {
    for (let fn of objfiles) {
        if (!fn.endsWith('.rel')) continue;
        let rel = getWorkFileAsString(fn);
        if (typeof rel !== 'string' || new RegExp(`^A ${area} `, 'm').test(rel)) return true;
    }
    return false;
}

/**
 * Builds the segment map from the linker's area bounds. SDCC names each area
 * with an `s_` and an `l_` symbol; the area name after the prefix may itself
 * start with an underscore (`_CODE` on z80, `CODE` on mos6502), so both
 * `s__CODE`/`l__CODE` and `s_CODE`/`l_CODE` have to pair up.
 */
export function parseSymbolSegments(symbolmap: { [sym: string]: number }) {
    const segments = [];
    // TODO: use stack params for stack segment
    for (const ident in symbolmap) {
        const m = /^s_(.+)$/.exec(ident);
        if (!m) continue;
        const area = m[1];
        // an area whose name begins with _ is shown without it, as before
        const seg = area.replace(/^_/, '');
        const segstart = symbolmap[ident];
        const segsize = symbolmap['l_' + area];
        if (!(segstart >= 0 && segsize > 0)) continue;
        let type = null;
        if (['INITIALIZER', 'GSINIT', 'GSFINAL'].includes(seg)) type = 'rom';
        else if (seg.startsWith('CODE')) type = 'rom';
        else if (['DATA', 'INITIALIZED'].includes(seg)) type = 'ram';
        if (type == 'rom' || segstart > 0) // ignore HEADER0, CABS0, etc (TODO?)
            segments.push({ name: seg, start: segstart, size: segsize, type });
    }
    return segments;
}

/**
 * Guesses each symbol's size as the distance to the next symbol in its
 * segment (the last one runs to the segment's end). The linker map only has
 * addresses, so this is a heuristic and errs on the big side:
 *  - alignment padding, or a variable with no symbol of its own (a local
 *    static, a string literal), is counted into the symbol before it
 *  - a segment's last symbol also takes any unused space at its end
 *  - symbols sharing an address (aliases) all get the same size
 *  - a label inside a function or data blob ends the symbol before it, so
 *    that one comes out too small
 * Symbols outside every segment get no size.
 */
export function inferSymbolSizes(symbolmap: { [sym: string]: number }, segments: { start: number, size: number }[]) {
    // s_SEG / l_SEG are segment bounds, and the linker's '$' names are debug labels
    const names = Object.keys(symbolmap).filter(n => !/^[sl]_/.test(n) && !n.includes('$'));
    const sizes: { [sym: string]: number } = {};
    for (const seg of segments) {
        const end = seg.start + seg.size;
        const inseg = names.filter(n => symbolmap[n] >= seg.start && symbolmap[n] < end);
        const addrs = [...new Set(inseg.map(n => symbolmap[n]))].sort((a, b) => a - b);
        for (const n of inseg) {
            const next = addrs[addrs.indexOf(symbolmap[n]) + 1] ?? end;
            sizes[n] = next - symbolmap[n];
        }
    }
    return sizes;
}

/**
 * Each object file's slice of every area, in link order: the linker places a
 * module's contribution to an area as one block right after the previous
 * module's, so the starts are running sums from the area's start. Whatever
 * the areas hold beyond the object files came from libraries (.lib modules
 * are linked after the objects). Skips an area whose objects add up to more
 * than it holds, so a wrong guess is never drawn.
 */
export function moduleRanges(objs: { name: string, rel: string }[], segments: { name: string, start: number, size: number }[]) {
    const out: { [seg: string]: { name: string, start: number, size: number }[] } = {};
    // the z80 linker writes an area as _CODE, the mos6502 one as CODE; try
    // the plain name first so a real CODE area wins over an empty _CODE
    const areaSize = (rel: string, name: string) => {
        for (const area of [name, '_' + name]) {
            const m = new RegExp(`^A ${area.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} size ([0-9A-Fa-f]+) `, 'm').exec(rel);
            if (m) return parseInt(m[1], 16);
        }
        return 0;
    };
    for (const seg of segments) {
        let cur = seg.start;
        const mods = [];
        for (const obj of objs) {
            const size = areaSize(obj.rel, seg.name);
            if (size > 0) mods.push({ name: obj.name, start: cur, size });
            cur += size;
        }
        if (!mods.length || cur > seg.start + seg.size) continue;
        if (cur < seg.start + seg.size)
            mods.push({ name: '(libraries)', start: cur, size: seg.start + seg.size - cur });
        out[seg.name] = mods;
    }
    return out;
}

/**
 * Convert Intel HEX to a ROM image of rom_size bytes. With banking, records
 * above 64 KB are placed by bank, and the image grows to the next power of 2
 * that holds the highest bank.
 */
export function parseIHX(ihx: string, rom_start: number, rom_size: number, errors: WorkerError[], banking?: ROMBanking) {
    var output = new Uint8Array(new ArrayBuffer(rom_size));
    var upper = 0; // from type 04 (extended linear address) records
    for (var s of ihx.split("\n")) {
        if (s[0] == ':') {
            var arr = hexToArray(s, 1);
            var count = arr[0];
            var address = upper + (arr[1] << 8) + arr[2];
            var offset = address - rom_start;
            var rectype = arr[3];
            if (rectype == 0) {
                if (banking && address >= 0x10000) {
                    let bank = address >>> 16;
                    let low = address & 0xffff;
                    if (low < banking.window || low + count > banking.window + banking.size) {
                        errors.push({line:0, msg:`Bank ${bank} overflows its 0x${banking.size.toString(16)}-byte window at 0x${low.toString(16)}`});
                        continue;
                    }
                    offset = bank * banking.size + low - banking.window;
                    if (offset + count > output.length) {
                        let newsize = output.length;
                        while (newsize < offset + count) newsize *= 2;
                        let grown = new Uint8Array(newsize);
                        grown.set(output);
                        output = grown;
                    }
                }
                // The linker also emits records for whatever it placed outside
                // the ROM -- initialized data, or a GSINIT area that landed in
                // the _DATA area's RAM. Those bytes are not part of the ROM
                // image; reading past the end of output to check them yields
                // undefined, which used to be reported as an overlap.
                if (offset < 0 || offset + count > output.length) {
                    console.log(`skipping IHX record outside ROM: 0x${address.toString(16)} +${count}`);
                    continue;
                }
                if (output[offset] !== 0) {
                    errors.push({line:0,msg:`IHX overlap offset 0x${(offset).toString(16)}`});
                }
                for (var i = 0; i < count; i++) {
                    output[i + offset] = arr[4 + i];
                }
            } else if (rectype == 1) {
                break;
            } else if (rectype == 4) {
                upper = ((arr[4] << 8) | arr[5]) << 16;
            } else {
                console.log(s); // unknown record type
            }
        }
    }
    return output;
}

/** End offset, within [rom_start, rom_start + rom_size), of the highest data record. */
export function ihxExtent(ihx: string, rom_start: number, rom_size: number): number {
    let end = 0, upper = 0;
    for (const s of ihx.split("\n")) {
        if (s[0] != ':') continue;
        const arr = hexToArray(s, 1);
        if (arr[3] == 0) {
            const offset = upper + (arr[1] << 8) + arr[2] - rom_start;
            if (offset >= 0 && offset + arr[0] <= rom_size) end = Math.max(end, offset + arr[0]);
        } else if (arr[3] == 4) {
            upper = ((arr[4] << 8) | arr[5]) << 16;
        }
    }
    return end;
}

/**
 * The `load_header` platform param: how a loadable file wraps the linked
 * image (trimmed to the program's end, `length` bytes, linked at `start`).
 *   dos33  Apple II binary: load address and length (2 bytes each, little
 *          endian); the loader checks length == file size - 4
 *   prg    Commodore PRG: load address $0801, then the BASIC line
 *          `10 SYS <start>` that runs the program, which must be linked at
 *          $080D (right after that stub)
 */
export function loadHeader(kind: string, image: Uint8Array, start: number, length: number): Uint8Array<ArrayBuffer> {
    var header: number[];
    switch (kind) {
        case 'dos33':
            header = [start & 0xff, start >> 8, length & 0xff, length >> 8];
            break;
        case 'prg': {
            const sys = [...String(start)].map((c) => c.charCodeAt(0));
            const end = 0x801 + 4 + 1 + sys.length + 1; // link, line number, SYS token, digits, NUL
            header = [0x01, 0x08, end & 0xff, end >> 8, 0x0a, 0x00, 0x9e, ...sys, 0, 0, 0];
            if (0x801 + header.length - 2 !== start) throw new Error(`load_header prg: code must start at $${(0x801 + header.length - 2).toString(16)}, not $${start.toString(16)}`);
            break;
        }
        default:
            throw new Error(`unknown load_header '${kind}'`);
    }
    const out = new Uint8Array(new ArrayBuffer(header.length + length));
    out.set(header);
    out.set(image.subarray(0, length), header.length);
    return out;
}

function errorMatcherSDASZ80(path: string, errors: WorkerError[]) {
    //?ASxxxx-Error-<o> in line 1 of main.asm null
    //              <o> .org in REL area or directive / mnemonic error
    // ?ASxxxx-Error-<q> in line 1627 of cosmic.asm
    //    <q> missing or improper operators, terminators, or delimiters
    var match_asm_re1 = / in line (\d+) of (\S+)/; // TODO
    var match_asm_re2 = / <\w> (.+)/; // TODO
    var errline = 0;
    var errpath = path;
    var match_asm_fn = (s: string) => {
        var m = match_asm_re1.exec(s);
        if (m) {
            errline = parseInt(m[1]);
            errpath = m[2];
        } else {
            m = match_asm_re2.exec(s);
            if (m) {
                errors.push({
                    line: errline,
                    path: errpath,
                    msg: m[1]
                });
            }
        }
    }
    return match_asm_fn;
}

async function assembleSDAS(step: BuildStep, tool: SDCCTarget['as']): Promise<BuildStepResult> {
    var errors = [];
    gatherFiles(step, { mainFilePath: "main.asm" });
    var objpath = step.prefix + ".rel";
    var lstpath = step.prefix + ".lst";
    // the link step reads these params, so settle them even when up to date
    if (step.mainfile) {
        applyAsmProjectParams(step.params);   // an asm project, not a C one
    }
    if (staleFiles(step, [objpath, lstpath])) {
        const match_asm_fn = errorMatcherSDASZ80(step.path, errors);
        const args = ['-plosgffwy', step.path];
        var objout, lstout;
        if (tool == 'sdas6500' || (tool == 'sdasz80' && sdcc4FS(step))) {
            const { wasi, errno, stdout, stderr } = await runWASITool(tool, args, {
                module: tool == 'sdasz80' ? 'sdasz80-4' : tool,
                populate: (fs) => populateFiles(step, fs),
            });
            stdout.concat(stderr).forEach(match_asm_fn);
            checkExitCode(tool, errno, stderr, errors);
            if (errors.length) {
                return { errors: errors };
            }
            objout = readWASIOutputString(wasi, objpath);
            lstout = readWASIOutputString(wasi, lstpath);
        } else {
            loadNative(tool);
            var AS: EmscriptenModule = emglobal[tool]({
                instantiateWasm: moduleInstFn(tool),
                noInitialRun: true,
                //logReadFiles:true,
                print: match_asm_fn,
                printErr: match_asm_fn,
            });
            // old-style Emscripten modules return the Module object, whose .then()
            // only resolves after main() runs; newer MODULARIZE factories return a Promise
            if (AS instanceof Promise) AS = await AS;
            var FS = AS.FS;
            populateFiles(step, FS);
            execMain(step, AS, args);
            if (errors.length) {
                return { errors: errors };
            }
            objout = FS.readFile(objpath, { encoding: 'utf8' });
            lstout = FS.readFile(lstpath, { encoding: 'utf8' });
        }
        putWorkFile(objpath, objout);
        putWorkFile(lstpath, lstout);
    }
    return {
        linktool: tool == 'sdas6500' ? 'sdld6808' : 'sdldz80',
        files: [objpath, lstpath],
        args: [objpath]
    };
}

export function assembleSDASZ80(step: BuildStep): Promise<BuildStepResult> {
    return assembleSDAS(step, 'sdasz80');
}

export function assembleSDASGB(step: BuildStep): Promise<BuildStepResult> {
    return assembleSDAS(step, 'sdasgb');
}

export function assembleSDAS6500(step: BuildStep): Promise<BuildStepResult> {
    return assembleSDAS(step, 'sdas6500');
}

export function linkSDLDZ80(step: BuildStep) {
    return linkSDLD(step, 'sdldz80');
}

export function linkSDLD6808(step: BuildStep) {
    return linkSDLD(step, 'sdld6808');
}

async function linkSDLD(step: BuildStep, ld: 'sdldz80' | 'sdld6808') {
    const arch = sdccTarget(step.params.arch).lib;
    const fs4 = sdcc4FS(step);
    var errors = [];
    gatherFiles(step);
    var binpath = "main.ihx";
    if (staleFiles(step, [binpath])) {
        //?ASlink-Warning-Undefined Global '__divsint' referenced by module 'main'
        var match_aslink_re = /\?ASlink-(\w+)-(.+)/;
        var match_aslink_fn = (s: string) => {
            var matches = match_aslink_re.exec(s);
            if (matches) {
                errors.push({
                    line: 0,
                    msg: matches[2]
                });
            }
        }
        var params = step.params;
        var libdir = fs4 ? `${SDCC4_LIB}/${arch}` : arch === 'z80' ? '/share/lib/z80' : '.'; // sm83.lib copied to current (.) directory
        var args = ['-mjwxyu', '-i', 'main.ihx'];
        // sdld 4.x fails on -b for an area no module defines (an asm-only
        // program may have no _DATA)
        // the mos6502 library's crt0 sets the area order and the vectors
        const startup = params.startup_objs || (ld == 'sdld6808' ? [`${libdir}/crt0.rel`] : undefined);
        var bases: { [area: string]: number } = { _CODE: params.codeseg_start || params.code_start, _DATA: params.data_start };
        // mos6502's crt0 starts with an empty _CODE, so the code group begins at
        // GSINIT; ZP would otherwise follow the first -b
        if (ld == 'sdld6808')
            bases = { ZP: params.zp_start ?? 0, GSINIT: bases._CODE, _DATA: bases._DATA };
        for (let area in bases) {
            if (!fs4 || objectsDefineArea(step.args.concat(startup || [], params.extra_link_args || []), area))
                args.push('-b', `${area}=0x${bases[area].toString(16)}`);
        }
        args.push('-k', libdir, '-l', arch);
        if (params.extra_link_args)
            args.push.apply(args, params.extra_link_args);
        // //#symbol ld (sdldz80 uses -g sym=expr) and //#flag ld
        args.push.apply(args, linkSymbolArgs(ld, params.symbols && params.symbols.linker));
        args.push.apply(args, extraArgsFor(ld, params.buildArgs));
        var objargs = step.args;
        if (params.rom_banking) {
            // place each #pragma bank N area, unless a //#flag ld already did
            let banked = objargs.filter((fn) => fn.endsWith('.rel') && bankedAreaArgs([getWorkFileAsString(fn)], params.rom_banking).length);
            let bargs = bankedAreaArgs(banked.map(getWorkFileAsString), params.rom_banking);
            for (let i = 0; i < bargs.length; i += 2) {
                let area = bargs[i + 1].split('=')[0] + '=';
                if (!args.some((a) => a.startsWith(area)))
                    args.push(bargs[i], bargs[i + 1]);
            }
            // Link banked objects just before the last bank 0 object. The
            // linker writes an IHX extended address record when it flushes
            // buffered data, using the address width of the module it is
            // reading at that moment; the XL2 (16-bit) libraries come last, so
            // the last object's upper address is lost -- harmless for bank 0.
            // The first objects stay first: they set the area order crt0 needs.
            let rest = objargs.filter((fn) => !banked.includes(fn));
            if (banked.length && rest.length)
                objargs = rest.slice(0, -1).concat(banked, rest.slice(-1));
        }
        objargs = withStartupObjects(startup, objargs);
        args.push.apply(args, objargs);
        var readText: (path: string) => string;
        if (fs4) {
            // one sdld binary for all targets: it picks the target from argv[0]
            const { wasi, errno, stdout, stderr } = await runWASITool(ld, args, {
                module: 'sdld4',
                sharedFS: fs4,
                populate: (fs) => {
                    populateFiles(step, fs);
                    // a platform shared with cc65 lists cc65's crt0 and .cfg here
                    if (ld == 'sdldz80') populateExtraFiles(step, fs, params.extra_link_files);
                    // -u updates the listing beside each object; the library's crt0 has none
                    else for (const fn of startup) if (fn.endsWith('.rel')) fs.writeFile(fn.replace(/\.rel$/, '.lst'), '\n');
                },
            });
            stdout.concat(stderr).forEach(match_aslink_fn);
            checkExitCode(ld, errno, stderr, errors);
            if (errors.length) {
                return { errors: errors };
            }
            readText = (path) => readWASIOutputString(wasi, path);
        } else {
            loadNative("sdldz80");
            var LDZ80: EmscriptenModule = emglobal.sdldz80({
                instantiateWasm: moduleInstFn('sdldz80'),
                noInitialRun: true,
                //logReadFiles:true,
                print: match_aslink_fn,
                printErr: match_aslink_fn,
            });
            var FS = LDZ80.FS;
            ensureFilesystem('sdcc');
            setupFS(FS, 'sdcc');
            populateFiles(step, FS);
            populateExtraFiles(step, FS, params.extra_link_files);
            // TODO: coleco hack so that -u flag works
            if (step.platform.startsWith("coleco")) {
                FS.writeFile('crt0.rel', FS.readFile('/share/lib/coleco/crt0.rel', { encoding: 'utf8' }));
                FS.writeFile('crt0.lst', '\n'); // TODO: needed so -u flag works
            }
            execMain(step, LDZ80, args);
            if (errors.length) {
                return { errors: errors };
            }
            readText = (path) => FS.readFile(path, { encoding: 'utf8' });
        }
        var hexout = readText("main.ihx");
        var noiout = readText("main.noi");
        putWorkFile("main.ihx", hexout);
        putWorkFile("main.noi", noiout);
        // return unchanged if no files changed
        if (!anyTargetChanged(step, ["main.ihx", "main.noi"]))
            return;
        // parse binary file
        var binout = parseIHX(hexout, params.rom_start !== undefined ? params.rom_start : params.code_start, params.rom_size, errors, params.rom_banking);
        if (errors.length) {
            return { errors: errors };
        }
        if (params.load_header) {
            const start = params.rom_start !== undefined ? params.rom_start : params.code_start;
            binout = loadHeader(params.load_header, binout, start, ihxExtent(hexout, start, params.rom_size));
        }
        // parse listings
        var listings: CodeListingMap = {};
        for (var fn of step.files) {
            if (fn.endsWith('.lst')) {
                var rstout = readText(fn.replace('.lst', '.rst'));
                putWorkFile(fn, rstout);
                listings[fn] = parseRSTListing(rstout, fn.replace(/\.lst$/, ''));
            }
        }
        // parse symbol map
        var symbolmap = {};
        for (var s of noiout.split("\n")) {
            var toks = s.split(" ");
            if (toks[0] == 'DEF' && !toks[1].startsWith("A$")) {
                symbolmap[toks[1]] = parseInt(toks[2], 16);
            }
        }
        // build segment map
        var segments = parseSymbolSegments(symbolmap);
        // object files in link order, for the Memory Map's module column
        // (a library's own objects, like crt0, are stored as bytes)
        let objs = objargs.filter((fn) => fn.endsWith('.rel')).map((fn) => {
            let data = getWorkFileData(fn);
            return { name: fn.replace(/\.rel$/, ''), rel: typeof data === 'string' ? data : new TextDecoder().decode(data) };
        });
        let modules = moduleRanges(objs, segments);
        for (let seg of segments) if (modules[seg.name]) seg.modules = modules[seg.name];
        // gameboy: fix up header for the final ROM size, compute checksum
        if (step.params.arch === 'gbz80') {
            if (binout.length > 0x8000) {
                // ROM size code n means 32 KB << n
                binout[0x148] = Math.log2(binout.length / 0x8000);
                // a ROM-only cart can't switch banks; MBC5 accepts MBC1-style bank writes
                if (binout[0x147] === 0) binout[0x147] = 0x19;
            }
            var checksum = 0;
            for (var address = 0x0134; address <= 0x014C; address++) {
                checksum = checksum - binout[address] - 1;
            }
            binout[0x14D] = checksum & 0xff;
        }
        return {
            output: binout,
            listings: listings,
            errors: errors,
            symbolmap: symbolmap,
            symbolsizes: inferSymbolSizes(symbolmap, segments),
            segments: segments
        };
    }
}

/**
 * Parse a linked (.rst) listing into asm lines and, when the compiler left
 * source comments, source lines. `srcprefix` is the source file name without
 * its extension: SDCC 3.6.5 writes `;<stdin>:N:` comments, SDCC 4.x writes
 * `;file.c:N: <source>` (with mcpp's `//` path prefix), and 4.x addresses
 * have 8 hex digits instead of 4. The mos6502 backend writes `;\tfile.c: N: <source>`.
 */
export function parseRSTListing(rstout: string, srcprefix: string) {
    //   0000 21 02 00      [10]   52 	ld	hl, #2
    var asmlines = parseListing(rstout, /^\s*([0-9A-F]{4,8})\s+([0-9A-F][0-9A-F r]*[0-9A-F])\s+\[([0-9 ]+)\]?\s+(\d+) (.*)/i, 4, 1, 2, 3);
    const name = srcprefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // the mos6502 backend writes `;<tab>file.c: 17: source`, with a space after the colon
    const srcre = new RegExp(`^\\s+\\d+ ;\\s*(?:<stdin>|/*${name}\\.[^:\\s]+):\\s*(\\d+):`, 'i');
    var srclines = parseSourceLines(rstout, srcre, /^\s*([0-9A-F]{4,8})/i);
    if (!srclines.length) {
        // the mos6502 backend names the file of every line, so a main file
        // that #includes the others (the -sdcc.c wrappers) still gets a
        // listing: tag each line with its file (see processListings);
        // the pattern captures the line number first, then the file name
        srclines = parseSourceLines(rstout, /^\s+\d+ ;\t(?=[^\s:]+: (\d+):)([^\s:]+)/, /^\s*([0-9A-F]{4,8})/i);
    }
    // TODO: you have to get rid of all source lines to get asm listing
    return {
        asmlines: srclines.length ? asmlines : null,
        lines: srclines.length ? srclines : asmlines,
        text: rstout
    };
}

/**
 * sdcc 3.6.5 compiles a __banked call to `call banked_call; .dw _fn; .dw 0`,
 * with a "PENDING: bank support" comment where the bank number belongs. Supply
 * it the way later sdcc versions do: a file with `#pragma bank N` defines
 * `b_fn == N` for each function, and call sites reference `b_fn`.
 */
export function fixBankedCalls(asm: string): string {
    asm = asm.replace(/^(\s*\.dw\s+(_\w+)\s*\n\s*\.dw\s+)0\s*; PENDING: bank support/gm,
        (_m, head, fn) => head + 'b' + fn);
    let m = /^\s*\.area\s+_CODE_(\d+)\b/m.exec(asm);
    if (m && parseInt(m[1]) > 0) {
        let defs = [];
        let re = /^(_\w+)::/gm, f;
        while ((f = re.exec(asm)))
            defs.push(`\t.globl b${f[1]}\nb${f[1]} == ${m[1]}`);
        if (defs.length) asm += '\n' + defs.join('\n') + '\n';
    }
    return asm;
}

/**
 * The platform's startup objects (crt0), from its lib directory, go first:
 * they set the area order. A project that links its own (by file name, so
 * gb/crt0.rel replaces crt0.rel) keeps it instead.
 */
export function withStartupObjects(startup: string[] | undefined, objargs: string[]): string[] {
    if (!startup) return objargs;
    var own = new Set(objargs.map((fn) => fn.split('/').pop()));
    return startup.filter((fn) => !own.has(fn)).concat(objargs);
}

export async function compileSDCC(step: BuildStep): Promise<BuildStepResult> {

    gatherFiles(step, {
        mainFilePath: "main.c" // not used
    });
    var params = step.params;
    var isGBZ80 = params.arch === 'gbz80';
    const target = sdccTarget(params.arch);
    var outpath = step.prefix + ".asm";
    fixParamsWithDefines(step.path, params); // //#symbol, //#flag, //#tooldef
    const fs4 = sdcc4FS(step); // after the directives: //#tooldef c sdcc=3|4
    if (staleFiles(step, [outpath]) || builtByOtherSDCC(outpath, fs4)) {
        var errors = [];
        // load source file and preprocess
        var code = getWorkFileAsString(step.path);
        var preproc;
        if (fs4) {
            const sharefs = await ensureWasiFilesystem(fs4);
            if (!sharefs) throw new Error("Could not load SDCC filesystem " + fs4);
            preproc = preprocessMCPP(step, { fs: sharefs, dir: SDCC4_INCLUDE }, sdcc4Defines(target));
        } else {
            ensureFilesystem('sdcc');
            preproc = preprocessMCPP(step, 'sdcc');
        }
        if (preproc.errors) {
            return { errors: preproc.errors };
        }
        // mcpp keeps a UTF-8 byte order mark, which 4.x rejects
        else code = preproc.code.replace(/\uFEFF/g, '');
        var args = ['--vc', '--std-sdcc99', target.mflag, //'-Wall',
            '--c1mode',
            //'--debug',
            //'-S', 'main.c',
            //'--asm=sdasz80',
            //'--reserve-regs-iy',
            '--less-pedantic',
            ///'--fomit-frame-pointer',
            //'--opt-code-speed',
            //'--max-allocs-per-node', '1000',
            //'--cyclomatic',
            //'--nooverlay',
            //'--nogcse',
            //'--nolabelopt',
            //'--noinvariant',
            //'--noinduction',
            //'--nojtbound',
            //'--noloopreverse',
            '-o', outpath];
        // if "#pragma opt_code" found do not disable optimziations
        if (!/^\s*#pragma\s+opt_code/m.exec(code)) {
            args.push.apply(args, [
                '--no-peep',
                '--nolospre',
                '--max-allocs-per-node', '500',
            ]);
        }
        if (params.extra_compile_args) {
            args.push.apply(args, params.extra_compile_args);
        }
        // //#symbol c and //#flag c
        args.push.apply(args, defineArgs('sdcc', params.symbols && params.symbols.compiler));
        args.push.apply(args, extraArgsFor('sdcc', params.buildArgs));
        var asmout: string;
        if (fs4) {
            // --c1mode reads the preprocessed source from stdin
            const { wasi, errno, stdout, stderr } = await runWASITool('sdcc', args, {
                module: 'sdcc4',
                stdin: code,
                populate: (fs) => populateFiles(step, fs),
            });
            // 4.x warns more than 3.6.5 did (e.g. `int main(int argc)`)
            stderr.forEach(msvcErrorMatcher(errors));
            checkExitCode('sdcc', errno, stderr, errors);
            if (hasErrors(errors)) {
                return { errors: errors };
            }
            asmout = readWASIOutputString(wasi, outpath);
        } else {
            loadNative('sdcc');
            var SDCC: EmscriptenModule = emglobal.sdcc({
                instantiateWasm: moduleInstFn('sdcc'),
                noInitialRun: true,
                noFSInit: true,
                print: print_fn,
                printErr: msvcErrorMatcher(errors),
                //TOTAL_MEMORY:256*1024*1024,
            });
            var FS = SDCC.FS;
            populateFiles(step, FS);
            // pipe file to stdin
            setupStdin(FS, code);
            ensureFilesystem('sdcc'); // not preloaded on a 4.x platform built with sdcc=3
            setupFS(FS, 'sdcc');
            execMain(step, SDCC, args);
            // TODO: preprocessor errors w/ correct file
            if (hasErrors(errors)) {
                return { errors: errors };
            }
            asmout = FS.readFile(outpath, { encoding: 'utf8' });
        }
        // massage the asm output
        // (mos6502's crt0 declares its own area order)
        if (target.as != 'sdas6500')
            asmout = " .area _HOME\n .area _CODE\n .area _INITIALIZER\n .area _DATA\n .area _INITIALIZED\n .area _BSEG\n .area _BSS\n .area _HEAP\n" + asmout;
        if (isGBZ80) asmout = fixBankedCalls(asmout);
        putWorkFile(outpath, asmout);
    }
    return {
        nexttool: target.as,
        path: outpath,
        args: [outpath],
        files: [outpath],
        warnings: errors,
    };
}
