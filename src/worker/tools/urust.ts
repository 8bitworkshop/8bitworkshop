import { WASIRunner } from "../../common/wasi/wasishim";
import { extraArgsFor } from "../../common/toolmeta";
import { WorkerError } from "../../common/workertypes";
import { BuildStep, BuildStepResult, gatherFiles, putWorkFile, staleFiles, fixParamsWithDefines } from "../builder";
import { populateWASIFiles, runWASI } from "../wasiutils";
import { loadWASMBinary } from "../wasmutils";
import { parseUrustDiagnostics, urustDebugToResult, urustPlatformName } from "./urustparse";

let wasiModule: WebAssembly.Module | null = null;

// one run yields the ROM (-o) and the debug JSON (--debug-out); errors and
// warnings come back as a JSON array on stderr (--error-format json)
export function compileUrust(step: BuildStep): BuildStepResult {
    gatherFiles(step, { mainFilePath: "main.rs" });
    const binpath = step.prefix + ".bin";
    const dbgpath = step.prefix + ".json";
    if (!staleFiles(step, [binpath])) return;
    const platform = urustPlatformName(step.platform);
    if (!platform) {
        return { errors: [{ line: 0, path: step.path, msg: `urust does not support platform ${step.platform}` }] };
    }
    fixParamsWithDefines(step.path, step.params); // //#flag, //#symbol, //#tooldef
    if (!wasiModule) {
        wasiModule = new WebAssembly.Module(loadWASMBinary("urust"));
    }
    const wasi = new WASIRunner();
    wasi.initSync(wasiModule);
    populateWASIFiles(wasi, step);
    let args = ['urust', 'build', step.path, '--emit', 'bin', '-o', binpath,
        '-O1',
        '--trap', 'call',
        //'-fno-bounds-checks',
        '-Wall',
        '--no-rustc-compat',
        '--auto-mod',
        '--debug-out', dbgpath, '--error-format', 'json'];
    args.push.apply(args, extraArgsFor('urust', step.params && step.params.buildArgs));
    // TODO: put board in toolmeta?
    if (!args.includes('--board') && !args.includes('--platform')) {
        args.push.apply(args, ['--platform', platform]);
    }
    wasi.setArgs(args);
    const trapped: WorkerError[] = [];
    runWASI(wasi, trapped);
    const { errors, warnings } = parseUrustDiagnostics(wasi.fds[2].getBytesAsString(), step.path);
    errors.push(...trapped);
    const output = wasi.fs.getFile("./" + binpath)?.getBytes();
    const debugtext = wasi.fs.getFile("./" + dbgpath)?.getBytesAsString();
    if (!errors.length && (!output || !debugtext)) {
        errors.push({ line: 0, path: step.path, msg: "urust did not produce " + binpath });
    }
    if (errors.length) {
        return { errors: errors.concat(warnings) };
    }
    const dbg = urustDebugToResult(JSON.parse(debugtext!), step.files);
    if (dbg.banked) {
        warnings.push({
            line: 0, path: step.path, severity: 'warning',
            msg: "this mapper has switchable ROM banks; source lines and symbols in banked code " +
                 "are shown by address only, so the debugger may pick the wrong bank's line",
        });
    }
    putWorkFile(binpath, output!);
    putWorkFile(dbgpath, debugtext!);
    return {
        output,
        errors: [],
        warnings,
        listings: dbg.listings,
        symbolmap: dbg.symbolmap,
        symbolsizes: dbg.symbolsizes,
        segments: dbg.segments,
    } as BuildStepResult;
}
