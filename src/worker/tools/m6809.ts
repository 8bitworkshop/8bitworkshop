import { CodeListingMap, WorkerError } from "../../common/workertypes";
import { defineArgs, extraArgsFor, linkSymbolArgs } from "../../common/toolmeta";
import { BuildStep, BuildStepResult, populateFiles, putWorkFile, gatherFiles, staleFiles, fixParamsWithDefines, populateExtraFiles, anyTargetChanged } from "../builder";
import { parseListing, msvcErrorMatcher, parseSourceLines } from "../listingutils";
import { EmscriptenModule, emglobal, execMain, execToFile, load, loadNative, moduleInstFn, print_fn } from "../wasmutils";
import { prepareCompilerInput } from "./mcpp";

// http://datapipe-blackbeltsystems.com/windows/flex/asm09.html
export function assembleXASM6809(step: BuildStep): BuildStepResult {
    load("xasm6809");
    var alst = "";
    var lasterror = null;
    var errors = [];
    function match_fn(s) {
        alst += s;
        alst += "\n";
        if (lasterror) {
            var line = parseInt(s.slice(0, 5)) || 0;
            errors.push({
                line: line,
                msg: lasterror
            });
            lasterror = null;
        }
        else if (s.startsWith("***** ")) {
            lasterror = s.slice(6);
        }
    }
    var Module: EmscriptenModule = emglobal.xasm6809({
        noInitialRun: true,
        //logReadFiles:true,
        print: match_fn,
        printErr: print_fn
    });
    var FS = Module.FS;
    //setupFS(FS);
    populateFiles(step, FS, {
        mainFilePath: 'main.asm'
    });
    var binpath = step.prefix + '.bin';
    var lstpath = step.prefix + '.lst'; // in stdout
    execMain(step, Module, ["-c", "-l", "-s", "-y", "-o=" + binpath, step.path]);
    if (errors.length)
        return { errors: errors };
    var aout = FS.readFile(binpath, { encoding: 'binary' });
    if (aout.length == 0) {
        errors.push({ line: 0, msg: "Empty output file" });
        return { errors: errors };
    }
    putWorkFile(binpath, aout);
    putWorkFile(lstpath, alst);
    // TODO: symbol map
    //mond09     0000     
    var symbolmap = {};
    //00005  W 0003 [ 8] A6890011            lda   >PALETTE,x
    //00012    0011      0C0203              fcb   12,2,3
    var asmlines = parseListing(alst, /^\s*([0-9]+) .+ ([0-9A-F]+)\s+\[([0-9 ]+)\]\s+([0-9A-F]+) (.*)/i, 1, 2, 4, 3);
    var listings: CodeListingMap = {};
    listings[step.prefix + '.lst'] = { lines: asmlines, text: alst };
    return {
        output: aout,
        listings: listings,
        errors: errors,
        symbolmap: symbolmap,
    };
}

export function compileCMOC(step: BuildStep): BuildStepResult {
    // cmoc hands .asm/.s files to lwasm through system(), which can't work here
    if (/\.(asm|s)$/i.test(step.path)) {
        return { errors: [{ line: 0, path: step.path,
            msg: "cmoc compiles C; name assembly files .xasm (xasm6809) or .lwasm (lwasm)" }] };
    }
    loadNative("cmoc");
    var params = step.params;
    // stderr
    var re_err1 = /^[/]*([^:]*):(\d+): (.+)$/;
    var errors: WorkerError[] = [];
    var errline = 0;
    function match_fn(s) {
        var matches = re_err1.exec(s);
        if (matches) {
            errors.push({
                line: parseInt(matches[2]),
                msg: matches[3],
                path: matches[1] || step.path
            });
        } else {
            console.log(s);
        }
    }
    gatherFiles(step, { mainFilePath: "main.c" });
    var destpath = step.prefix + '.s';
    if (staleFiles(step, [destpath])) {
        var args = ['-S', '-Werror', '-V',
            '-I/share/include',
            '-I.',
            step.path];
        var CMOC: EmscriptenModule = emglobal.cmoc({
            instantiateWasm: moduleInstFn('cmoc'),
            noInitialRun: true,
            //logReadFiles:true,
            print: match_fn,
            printErr: match_fn,
        });
        // set up filesystem with the preprocessed source
        var FS = CMOC.FS;
        //setupFS(FS, '65-'+getRootBasePlatform(step.platform));
        const err = prepareCompilerInput(step, 'cmoc', FS, params, args);
        if (err) return err;
        const runerr = execToFile(step, CMOC, args, FS, destpath, errors,
            (out) => step.params.set_stack_end ? out.replace('stack space in bytes', `\n lds #${step.params.set_stack_end}\n`) : out);
        if (runerr) return runerr;
    }
    return {
        nexttool: "lwasm",
        path: destpath,
        args: [destpath],
        files: [destpath],
    };
}

export function assembleLWASM(step: BuildStep): BuildStepResult {
    loadNative("lwasm");
    var errors = [];
    gatherFiles(step, { mainFilePath: "main.s" });
    var objpath = step.prefix + ".o";
    var lstpath = step.prefix + ".lst";
    const isRaw = step.path.endsWith('.asm');
    if (staleFiles(step, [objpath, lstpath])) {
        var objout, lstout;
        var args = ['-9', '-I/share/asminc', '-o' + objpath, '-l' + lstpath];
        // //#symbol as / //#flag as
        args.push.apply(args, defineArgs('lwasm', step.params.symbols && step.params.symbols.assembler));
        args.push.apply(args, extraArgsFor('lwasm', step.params.buildArgs));
        args.push(step.path);
        args.push(isRaw ? '-r' : '--obj');
        var LWASM: EmscriptenModule = emglobal.lwasm({
            instantiateWasm: moduleInstFn('lwasm'),
            noInitialRun: true,
            //logReadFiles:true,
            print: print_fn,
            printErr: msvcErrorMatcher(errors),
        });
        var FS = LWASM.FS;
        //setupFS(FS, '65-'+getRootBasePlatform(step.platform));
        populateFiles(step, FS);
        fixParamsWithDefines(step.path, step.params);
        execMain(step, LWASM, args);
        if (errors.length)
            return { errors: errors };
        objout = FS.readFile(objpath, { encoding: 'binary' });
        lstout = FS.readFile(lstpath, { encoding: 'utf8' });
        putWorkFile(objpath, objout);
        putWorkFile(lstpath, lstout);
        if (isRaw) {
            return {
                output: objout
            };
        }
    }
    return {
        linktool: "lwlink",
        files: [objpath, lstpath],
        args: [objpath]
    };
}

export function linkLWLINK(step: BuildStep): BuildStepResult {
    loadNative("lwlink");
    var params = step.params;
    gatherFiles(step);
    var binpath = "main";
    if (staleFiles(step, [binpath])) {
        var errors = [];
        var LWLINK: EmscriptenModule = emglobal.lwlink({
            instantiateWasm: moduleInstFn('lwlink'),
            noInitialRun: true,
            //logReadFiles:true,
            print: print_fn,
            printErr: function (s) {
                if (s.startsWith("Warning:"))
                    console.log(s);
                else
                    errors.push({ msg: s, line: 0 });
            }
        });
        var FS = LWLINK.FS;
        //setupFS(FS, '65-'+getRootBasePlatform(step.platform));
        populateFiles(step, FS);
        populateExtraFiles(step, FS, params.extra_link_files);
        var libargs = params.extra_link_args || [];
        // raw image by default (ROM platforms); a platform can ask for a
        // DECB .bin instead (coco), whose blocks carry the load addresses
        // and the EXEC address that --entry names.
        var args = [
            '-L.',
            '--entry=program_start',
            '--format=' + (params.link_format || 'raw'),
            '--output=main',
            '--map=main.map'].concat(libargs, step.args);
        // //#flag ld / //#symbol ld
        args.push.apply(args, linkSymbolArgs('lwlink', params.symbols && params.symbols.linker));
        args.push.apply(args, extraArgsFor('lwlink', params.buildArgs));
        console.log(args);
        execMain(step, LWLINK, args);
        if (errors.length)
            return { errors: errors };
        var aout = FS.readFile("main", { encoding: 'binary' });
        var mapout = FS.readFile("main.map", { encoding: 'utf8' });
        putWorkFile("main", aout);
        putWorkFile("main.map", mapout);
        // return unchanged if no files changed
        if (!anyTargetChanged(step, ["main", "main.map"]))
            return;
        // parse symbol map
        //console.log(mapout);
        var symbolmap = {};
        var segments = [];
        for (var s of mapout.split("\n")) {
            var toks = s.split(" ");
            // TODO: use regex
            if (toks[0] == 'Symbol:') {
                let ident = toks[1];
                let ofs = parseInt(toks[4], 16);
                if (ident && ofs >= 0 
                  && !ident.startsWith("l_") 
                  //&& !/^L\d+$/.test(ident)
                  && !ident.startsWith('funcsize_')
                  && !ident.startsWith('funcend_')) {
                    symbolmap[ident] = ofs;
                }
            }
            else if (toks[0] == 'Section:') {
                let seg = toks[1];
                let segstart = parseInt(toks[5], 16);
                let segsize = parseInt(toks[7], 16);
                segments.push({ name: seg, start: segstart, size: segsize });
            }
        }
        // build listings
        const re_segment = /\s*SECTION\s+(\w+)/i;
        const re_function = /\s*([0-9a-f]+).+?(\w+)\s+EQU\s+[*]/i;
        var listings: CodeListingMap = {};
        for (var fn of step.files) {
            if (fn.endsWith('.lst')) {
                // TODO
                var lstout = FS.readFile(fn, { encoding: 'utf8' });
                var asmlines = parseListing(lstout, /^([0-9A-F]+)\s+([0-9A-F]+)\s+[(]\s*(.+?)[)]:(\d+) (.*)/i, 4, 1, 2, 3, re_function, re_segment);
                for (let l of asmlines) {
                    l.offset += symbolmap[l.func] || 0;
                }
                // * Line //threed.c:117: init of variable e
                var srclines = parseSourceLines(lstout, /Line .+?:(\d+)/i, /^([0-9A-F]{4})/i, re_function, re_segment);
                for (let l of srclines) {
                    l.offset += symbolmap[l.func] || 0;
                }
                putWorkFile(fn, lstout);
                // strip out left margin
                lstout = lstout.split('\n').map(l => l.substring(0,15) + l.substring(56)).join('\n')
                // TODO: you have to get rid of all source lines to get asm listing
                listings[fn] = {
                    asmlines: srclines.length ? asmlines : null,
                    lines: srclines.length ? srclines : asmlines,
                    text: lstout
                };
            }
        }
        return {
            output: aout, //.slice(0),
            listings: listings,
            errors: errors,
            symbolmap: symbolmap,
            segments: segments
        };
    }
}

