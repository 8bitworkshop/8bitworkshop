// Generates TextMate grammars and language configurations for the
// assembler languages. One grammar per CPU covers every assembler for it
// (dasm, ca65, xa, nesasm; zmac, sdas; xasm6809, lwasm): it knows each
// dialect's directives, number formats and label styles. Keyword tables
// come from src/parser/asmkeywords.ts, which the IDE's parsers share.
// No vscode import; scripts/syntaxes.ts writes the files.

import * as K from '../../src/parser/asmkeywords';
import { VERILOG_LANGUAGE } from './verilogsyntax';
import { RUST_LANGUAGE } from './rustsyntax';

export interface AsmLanguage {
  id: string;             // language ID, e.g. '8bws-6502'
  cpu: string;            // scope suffix, e.g. '6502'
  aliases: string[];
  /** File extensions only 8bitworkshop uses. Shared ones (.s, .asm, .inc,
   *  .a) are assigned per project, not here. */
  extensions: string[];
  opcodes: string[];
  illegalOpcodes?: string[];
  registers: string[];
  conditions?: string[];
  /** directives written with or without a leading dot */
  plainDirectives: string[];
  /** directives written only with a leading dot */
  dotDirectives: string[];
  /** dot-prefixed functions used in expressions (ca65 .lobyte etc.) */
  dotFunctions?: string[];
  /** '*' in column 0 starts a comment (Motorola style) */
  starComments?: boolean;
}

const uniq = (a: string[]) => [...new Set(a)];

export const ASM_LANGUAGES: AsmLanguage[] = [
  {
    id: '8bws-6502', cpu: '6502',
    aliases: ['6502 Assembly', '6502'],
    extensions: ['.dasm', '.ca65', '.xa', '.nesasm', '.acme'],
    opcodes: uniq([...K.opcodes6502, ...K.opcodes65C02]),
    illegalOpcodes: K.illegalOpcodes6502,
    registers: K.registers6502,
    plainDirectives: uniq([...K.dasmPseudoOps, ...K.dasmMacroOps, ...K.dasmControlOps,
      'hex', 'trace', 'setstr', 'eif', 'elif', 'endr', 'ifdef', 'ifndef']),
    dotDirectives: uniq([...K.ca65Directives, ...K.sdasDirectives,
      // nesasm, xa
      'bank', 'db', 'dw', 'ds', 'inesprg', 'ineschr', 'inesmap', 'inesmir', 'rsset', 'rs',
      'bin', 'asc', 'text']),
    dotFunctions: K.ca65Functions,
  },
  {
    id: '8bws-z80', cpu: 'z80',
    aliases: ['Z80 Assembly', 'Z80'],
    extensions: ['.zmac', '.sgb'],
    opcodes: uniq([...K.opcodesZ80, ...K.opcodesGBZ80]),
    registers: K.registersZ80,
    conditions: K.conditionsZ80,
    plainDirectives: uniq([...K.zmacPseudoOps, ...K.zmacMacroOps, ...K.zmacControlOps]),
    dotDirectives: uniq([...K.sdasDirectives, 'globl', 'module']),
  },
  {
    id: '8bws-6809', cpu: '6809',
    aliases: ['6809 Assembly', '6809'],
    extensions: ['.xasm', '.lwasm'],
    opcodes: K.opcodes6809,
    registers: K.registers6809,
    plainDirectives: K.motorolaPseudoOps,
    dotDirectives: K.sdasDirectives,
    starComments: true,
  },
];

// Characters that continue a symbol: dasm .local, ca65 @local, sdas 10$
const SYM = `[\\w.@$?]`;
const SYM_START = `[A-Za-z_.@]`;
const NOT_SYM = `(?!${SYM})`;

function words(list: string[]): string {
  // longest first, so 'dc.b' wins over 'dc'
  return [...list].sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map((w) => w.replace(/[.$?]/g, '\\$&')).join('|');
}

export function makeGrammar(lang: AsmLanguage): object {
  const c = lang.cpu;
  const ops = words(lang.opcodes);
  const ill = lang.illegalOpcodes?.length ? words(lang.illegalOpcodes) : null;
  const plain = words(lang.plainDirectives);
  const dot = words(lang.dotDirectives);
  const allMnemonics = words([...lang.opcodes, ...(lang.illegalOpcodes || [])]);
  // dasm's lda.w, lda.b; the suffix stays part of the mnemonic
  const opSuffix = `(?:\\.[bwlz])?`;
  const directive = `\\.(?:${dot}|${plain})|(?:${plain})`;
  // A symbol that names nothing we know; used for labels and macro calls.
  const label = `(?!(?:${allMnemonics})${opSuffix}${NOT_SYM})${SYM_START}${SYM}*|\\d+\\$`;
  // Label part of a line: indented with a colon (ca65, sdas, zmac), or in
  // column 0 with or without one (dasm).
  const head = `^(?:\\s*(${label})(::?)|(${label})${NOT_SYM}(::?)?)?\\s*`;
  const labelCaptures = {
    1: { name: `entity.name.function.label.${c}` },
    2: { name: `punctuation.separator.label.${c}` },
    3: { name: `entity.name.function.label.${c}` },
    4: { name: `punctuation.separator.label.${c}` },
  };

  const patterns: any[] = [
    { include: '#comment' },
    // name = value, name := value, name EQU value
    {
      match: `^\\s*(${label})${NOT_SYM}\\s*(:?=)`,
      captures: {
        1: { name: `variable.other.constant.${c}` },
        2: { name: `keyword.operator.assignment.${c}` },
      },
    },
    {
      match: `^(${label})${NOT_SYM}:?\\s+(\\.?(?:equ|eqm|set|defl|setstr|sett|=))${NOT_SYM}`,
      captures: {
        1: { name: `variable.other.constant.${c}` },
        2: { name: `keyword.control.directive.${c}` },
      },
    },
    // Definitions: name MACRO (zmac); .proc name, MAC name, .macro name
    {
      match: `^(${label})${NOT_SYM}:?\\s+(\\.?macro)${NOT_SYM}`,
      captures: {
        1: { name: `entity.name.function.${c}` },
        2: { name: `keyword.control.directive.${c}` },
      },
    },
    {
      match: `${head}(\\.?(?:proc|scope|struct|union|enum|macro|mac|define))\\s+(${SYM_START}${SYM}*)`,
      captures: {
        ...labelCaptures,
        5: { name: `keyword.control.directive.${c}` },
        6: { name: `entity.name.function.${c}` },
      },
    },
    // A statement: optional label, then an instruction or directive
    {
      match: `${head}(?:((?:${ops})${opSuffix})` +
        (ill ? `|((?:${ill})${opSuffix})` : `|(?!)()`) +
        `|(${directive}))${NOT_SYM}`,
      captures: {
        ...labelCaptures,
        5: { name: `keyword.other.opcode.${c}` },
        6: { name: `keyword.other.opcode.illegal.${c}` },
        7: { name: `keyword.control.directive.${c}` },
      },
    },
    // Anything else in statement position is a macro call
    {
      match: `^(?:\\s*(${label})(::?)|(${label})${NOT_SYM}(::?)?)?\\s+(${SYM_START}${SYM}*)${NOT_SYM}(?!\\s*:)`,
      captures: {
        ...labelCaptures,
        5: { name: `entity.name.function.macro.call.${c}` },
      },
    },
    // A label alone on its line; ca65's unnamed ':' label
    {
      match: `^(?:\\s*(${label})(::?)|(${label})${NOT_SYM}(::?)?)`,
      captures: labelCaptures,
    },
    { match: `^\\s*(:)(?=\\s|;|$)`, captures: { 1: { name: `entity.name.function.label.${c}` } } },
    { include: '#operand' },
  ];

  const operand: any[] = [
    { include: '#comment' },
    { include: '#string' },
    { include: '#number' },
  ];
  if (c === 'z80') {
    operand.push({ match: `(?i)\\baf'`, name: `variable.language.register.${c}` });
  }
  operand.push(
    { match: `\\{\\d+\\}|\\\\\\w+`, name: `variable.parameter.${c}` },
  );
  if (lang.dotFunctions?.length) {
    operand.push({ match: `\\.(?:${words(lang.dotFunctions)})${NOT_SYM}`, name: `support.function.${c}` });
  }
  // ca65 unnamed label references :+ :- :++
  operand.push({ match: `:[+-]+`, name: `entity.name.function.label.${c}` });
  if (c === '6502') {
    // registers only as index (,x ,y) or accumulator operand (asl a)
    operand.push(
      { match: `(,)\\s*([xy])${NOT_SYM}`, captures: {
        1: { name: `punctuation.separator.${c}` }, 2: { name: `variable.language.register.${c}` } } },
      { match: `(?<=\\s)(a)(?=\\s*(?:;|$))`, name: `variable.language.register.${c}` },
    );
  } else {
    operand.push({ match: `(?<!${SYM})(?:${words(lang.registers)})${NOT_SYM}(?!')`, name: `variable.language.register.${c}` });
  }
  if (lang.conditions) {
    // z, p, m are ordinary names too; only after whitespace as a whole operand
    operand.push({ match: `(?<=\\s)(?:${words(lang.conditions)})(?=\\s*(?:,|;|$))`, name: `keyword.other.condition.${c}` });
  }
  operand.push(
    { match: `\\.(?:${dot})${NOT_SYM}`, name: `keyword.control.directive.${c}` },
    { match: `#`, name: `keyword.operator.immediate.${c}` },
    { match: `<<|>>|<=|>=|==|!=|&&|\\|\\||[-+*/%&|^~!<>=]`, name: `keyword.operator.${c}` },
    { match: `[,()\\[\\]]`, name: `punctuation.separator.${c}` },
    { match: `${SYM_START}${SYM}*|\\d+\\$`, name: `variable.other.${c}` },
  );

  const comment: any[] = [{ match: `;.*$`, name: `comment.line.semicolon.${c}` }];
  if (lang.starComments) comment.push({ match: `^\\*.*$`, name: `comment.line.asterisk.${c}` });

  return {
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: lang.aliases[0],
    scopeName: `source.asm.${c}`,
    // Oniguruma: case-insensitive for the whole grammar
    patterns: patterns.map(ci),
    repository: {
      comment: { patterns: comment.map(ci) },
      operand: { patterns: operand.map(ci) },
      string: {
        patterns: [
          { name: `string.quoted.double.${c}`, match: `"(?:[^"\\\\]|\\\\.)*"?` },
          // 'x', and dasm's unterminated 'x
          { name: `string.quoted.single.${c}`, match: `'(?:[^'\\\\]|\\\\.)'?` },
        ],
      },
      number: {
        patterns: [
          { name: `constant.numeric.hex.${c}`, match: `\\$[0-9a-fA-F]+|\\b0[xX][0-9a-fA-F]+\\b|\\b[0-9][0-9a-fA-F]*[hH]\\b` },
          { name: `constant.numeric.binary.${c}`, match: `%[01]+\\b|\\b0[bB][01]+\\b|\\b[01]+[bB]\\b` },
          { name: `constant.numeric.decimal.${c}`, match: `\\b[0-9]+\\b(?!\\$)` },
        ],
      },
    },
  };
}

// Prefix a pattern's regex with (?i)
function ci(p: any): any {
  return p.match && !p.match.startsWith('(?i)') ? { ...p, match: '(?i)' + p.match } : p;
}

// VS Code evaluates folding markers as JS regexes, which have no (?i)
function anyCase(w: string): string {
  return w.replace(/[a-z]/g, (ch) => `[${ch}${ch.toUpperCase()}]`);
}

export function makeLanguageConfiguration(lang: AsmLanguage): object {
  const blockStart = ['proc', 'scope', 'struct', 'union', 'enum', 'macro', 'mac',
    'repeat', 'rept', 'if', 'ifdef', 'ifndef', 'ifconst', 'ifnconst'];
  const blockEnd = ['endproc', 'endscope', 'endstruct', 'endunion', 'endenum', 'endmacro',
    'endmac', 'endm', 'repend', 'endrep', 'endrepeat', 'endr', 'endif', 'endc'];
  return {
    comments: { lineComment: ';' },
    brackets: [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '"', close: '"', notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [['(', ')'], ['[', ']'], ['"', '"'], ["'", "'"]],
    wordPattern: '[A-Za-z_.@][\\w.@$?]*|\\$[0-9A-Fa-f]+|%[01]+|\\d\\w*',
    folding: {
      markers: {
        start: `^(?:\\S+\\s+|\\s*)\\.?(?:${blockStart.map(anyCase).join('|')})\\b`,
        end: `^\\s*\\.?(?:${blockEnd.map(anyCase).join('|')})\\b`,
      },
    },
  };
}

/** contributes.languages / contributes.grammars entries for package.json */
export function makeContributions(dir = './out/syntaxes') {
  return {
    languages: [...ASM_LANGUAGES.map((l) => ({
      id: l.id,
      aliases: l.aliases,
      extensions: l.extensions,
      configuration: `${dir}/${l.id}.language-configuration.json`,
    })), {
      // no extensions: .v is shared, assigned per project
      id: VERILOG_LANGUAGE.id,
      aliases: VERILOG_LANGUAGE.aliases,
      configuration: `${dir}/${VERILOG_LANGUAGE.id}.language-configuration.json`,
    }, {
      // no extensions: .rs belongs to the installed Rust extension; this is
      // assigned per project only when no Rust extension claims it
      id: RUST_LANGUAGE.id,
      aliases: RUST_LANGUAGE.aliases,
      configuration: `${dir}/${RUST_LANGUAGE.id}.language-configuration.json`,
    }],
    grammars: [...ASM_LANGUAGES.map((l) => ({
      language: l.id,
      scopeName: `source.asm.${l.cpu}`,
      path: `${dir}/${l.id}.tmLanguage.json`,
    })), {
      language: VERILOG_LANGUAGE.id,
      scopeName: VERILOG_LANGUAGE.scopeName,
      path: `${dir}/${VERILOG_LANGUAGE.id}.tmLanguage.json`,
    }, {
      language: RUST_LANGUAGE.id,
      scopeName: RUST_LANGUAGE.scopeName,
      path: `${dir}/${RUST_LANGUAGE.id}.tmLanguage.json`,
    }],
  };
}
