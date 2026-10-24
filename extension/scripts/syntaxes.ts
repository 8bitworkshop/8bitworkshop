// Writes the assembler grammars and language configurations to
// out/syntaxes/ (npm run build runs it). package.json's contributes.languages
// and contributes.grammars must match makeContributions(); a test checks.
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { VERILOG_LANGUAGE, makeVerilogConfiguration, makeVerilogGrammar } from '../src/verilogsyntax';
import { RUST_LANGUAGE, makeRustConfiguration, makeRustGrammar } from '../src/rustsyntax';
import { ASM_LANGUAGES, makeGrammar, makeLanguageConfiguration } from '../src/syntaxgen';

const outDir = path.resolve(__dirname, 'syntaxes');
mkdirSync(outDir, { recursive: true });
for (const lang of ASM_LANGUAGES) {
  writeFileSync(path.join(outDir, `${lang.id}.tmLanguage.json`), JSON.stringify(makeGrammar(lang), null, 1));
  writeFileSync(path.join(outDir, `${lang.id}.language-configuration.json`), JSON.stringify(makeLanguageConfiguration(lang), null, 1));
}
writeFileSync(path.join(outDir, `${VERILOG_LANGUAGE.id}.tmLanguage.json`), JSON.stringify(makeVerilogGrammar(), null, 1));
writeFileSync(path.join(outDir, `${VERILOG_LANGUAGE.id}.language-configuration.json`), JSON.stringify(makeVerilogConfiguration(), null, 1));
writeFileSync(path.join(outDir, `${RUST_LANGUAGE.id}.tmLanguage.json`), JSON.stringify(makeRustGrammar(), null, 1));
writeFileSync(path.join(outDir, `${RUST_LANGUAGE.id}.language-configuration.json`), JSON.stringify(makeRustConfiguration(), null, 1));
console.error(`[syntaxes] wrote ${ASM_LANGUAGES.length + 2} grammars to ${outDir}`);
