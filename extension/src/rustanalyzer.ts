// rustanalyzer - keep rust-analyzer useful in a urust project without letting
// it run `cargo check` (urust has no Cargo target), expand the rs8 proc
// macros on the host (the proc-macro server crashes on `#[asm]`/`#[no_cross]`:
// "proc macro server error: exited with exit status: 101"), or offer Run/Debug
// lenses for a binary it can't produce. rust-analyzer keeps parsing,
// highlighting, hover, formatting, navigation and syntax/type errors; the
// rest goes off.
//
// The settings belong to a workspace folder (VS Code applies a nested
// .vscode/settings.json only when that folder is opened on its own), so they
// go wherever the project's settings live: New Project, Set as Main File,
// accepted detection and the "Set Up rust-analyzer" command all write them.
// They are a plain object, so tests can drive the merge without VS Code.

import { TOOL_META, urustPlatformName } from '../../src/common/toolmeta';
import { getToolForPlatform } from '../../src/common/toolselect';

/** The rust-analyzer settings a urust project turns off. */
export const RUST_ANALYZER_SETTINGS: { [key: string]: boolean | string[] } = {
  'rust-analyzer.checkOnSave': false,
  // keep syntax and type errors, drop what the missing Cargo target and the
  // built-in rs8 crate cause (rs8::*, reg!, #[reset], #[asm])
  'rust-analyzer.diagnostics.disabled': [
    'unresolved-module', 'unresolved-import', 'unresolved-extern-crate',
    'unresolved-macro-call', 'unresolved-proc-macro', 'macro-error', 'proc-macro-disabled',
  ],
  // the rs8 macros are markers for urust; expanding them as host proc macros
  // only produces errors (the proc-macro server can exit with status 101)
  'rust-analyzer.procMacro.enable': false,
  'rust-analyzer.lens.run.enable': false,
  'rust-analyzer.lens.debug.enable': false,
};

/** True if `platform` (built with `tool`, when known) compiles Rust with urust. */
export function isUrustProject(platform?: string, tool?: string): boolean {
  // .rs selects urust on every 6502/Z80 platform; urust only targets some
  if (!platform || !urustPlatformName(platform)) return false;
  var id = tool || getToolForPlatform(platform, 'main.rs');
  return TOOL_META[id]?.editorStyle === 'rust';
}

/** `settings` with the rust-analyzer keys added; every other key is kept. */
export function withRustAnalyzerSettings(settings: { [key: string]: any }): { [key: string]: any } {
  return { ...settings, ...RUST_ANALYZER_SETTINGS };
}

/** Setting values are booleans or string lists: compare by value. */
export function sameSetting(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** True if `settings` already turns rust-analyzer's check, macros and lenses off. */
export function hasRustAnalyzerSettings(settings: { [key: string]: any }): boolean {
  return Object.keys(RUST_ANALYZER_SETTINGS).every(k => sameSetting(settings[k], RUST_ANALYZER_SETTINGS[k]));
}
