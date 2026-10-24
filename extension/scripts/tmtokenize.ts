// Tokenizes with VS Code's TextMate engine (vscode-textmate + oniguruma),
// using the grammars from src/syntaxgen.ts. For tests and scripts only.
import * as fs from 'fs';
import * as onig from 'vscode-oniguruma';
import { IGrammar, INITIAL, Registry, parseRawGrammar } from 'vscode-textmate';
import { ASM_LANGUAGES, makeGrammar } from '../src/syntaxgen';
import { VERILOG_LANGUAGE, makeVerilogGrammar } from '../src/verilogsyntax';
import { RUST_LANGUAGE, makeRustGrammar } from '../src/rustsyntax';

let registry: Registry | undefined;

/** The grammar for scope source.asm.<cpu>, the Verilog one for 'verilog', or the Rust one for 'rust'. */
export async function loadGrammar(cpu: string): Promise<IGrammar> {
  if (!registry) {
    const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
    await onig.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    registry = new Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (s: string[]) => new onig.OnigScanner(s),
        createOnigString: (s: string) => new onig.OnigString(s),
      }),
      loadGrammar: async (scope: string) => {
        if (scope === VERILOG_LANGUAGE.scopeName) return parseRawGrammar(JSON.stringify(makeVerilogGrammar()), `${scope}.json`);
        if (scope === RUST_LANGUAGE.scopeName) return parseRawGrammar(JSON.stringify(makeRustGrammar()), `${scope}.json`);
        const lang = ASM_LANGUAGES.find((l) => `source.asm.${l.cpu}` === scope);
        return lang ? parseRawGrammar(JSON.stringify(makeGrammar(lang)), `${scope}.json`) : null;
      },
    });
  }
  return (await registry.loadGrammar(cpu === 'verilog' ? VERILOG_LANGUAGE.scopeName
    : cpu === 'rust' ? RUST_LANGUAGE.scopeName : `source.asm.${cpu}`))!;
}

/** Tokenizes one line: [text, innermost scope without the CPU suffix] pairs, blanks dropped. */
export function tokens(g: IGrammar, line: string): [string, string][] {
  const r = g.tokenizeLine(line, INITIAL);
  return r.tokens
    .map((t): [string, string] => [line.slice(t.startIndex, t.endIndex),
      t.scopes.length > 1 ? t.scopes[t.scopes.length - 1].replace(/\.[^.]+$/, '') : ''])
    .filter(([text]) => text.trim() !== '');
}
