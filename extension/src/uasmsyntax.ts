// TextMate grammar and language configuration for urust's `.uasm` assembly
// front end: Rust-like declarations (import/const/data/var/scope/proc) around
// native assembly bodies. A body is whichever CPU the platform builds for, so
// the mnemonics and registers of all three are highlighted. No vscode import;
// scripts/syntaxes.ts writes the files.

import * as K from '../../src/parser/asmkeywords';

export const UASM_LANGUAGE = {
  id: '8bws-uasm',
  aliases: ['urust Assembly', 'uasm'],
  scopeName: 'source.uasm.8bws',
  extensions: ['.uasm'],
};

const alt = (w: string[]) => [...new Set(w)].sort((a, b) => b.length - a.length || a.localeCompare(b))
  .map((w) => w.replace(/[.$?]/g, '\\$&')).join('|');
const ID = `[A-Za-z_][A-Za-z0-9_]*`;

const DECLARATIONS = ['import', 'const', 'data', 'var', 'scope', 'proc'];
const CLAUSES = ['clobbers', 'stack', 'carry', 'irq', 'cycles', 'scratch', 'fast', 'in', 'keep', 'on', 'off'];
const TYPES = ['u8', 'i8', 'bool', 'u16', 'i16', 'u32', 'i32'];
const OPCODES = [
  ...K.opcodes6502, ...K.illegalOpcodes6502, ...K.opcodes65C02,
  ...K.opcodesZ80, ...K.opcodesGBZ80,
  ...K.opcodes6809,
];
const REGISTERS = [...K.registers6502, ...K.registersZ80, ...K.registers6809];

export function makeUasmGrammar(): object {
  const s = 'uasm';
  return {
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: UASM_LANGUAGE.aliases[0],
    scopeName: UASM_LANGUAGE.scopeName,
    patterns: [
      { include: '#comment' },
      { include: '#string' },
      { include: '#number' },
      { include: '#label' },
      { include: '#attribute' },
      {
        match: `^\\s*(proc)\\s+(${ID})`,
        captures: { 1: { name: `keyword.control.${s}` }, 2: { name: `entity.name.function.${s}` } },
      },
      {
        match: `^\\s*(scope)\\s+(${ID})`,
        captures: { 1: { name: `keyword.control.${s}` }, 2: { name: `entity.name.namespace.${s}` } },
      },
      {
        match: `^\\s*(const|data|var)\\s+(${ID})`,
        captures: { 1: { name: `keyword.control.${s}` }, 2: { name: `variable.other.${s}` } },
      },
      {
        match: `^\\s*(import)\\s+((?:${ID})(?:::${ID})*)`,
        captures: { 1: { name: `keyword.control.${s}` }, 2: { name: `entity.name.namespace.${s}` } },
      },
      { match: `\\b(?:${alt(DECLARATIONS)}|${alt(CLAUSES)})\\b`, name: `keyword.control.${s}` },
      { match: `\\b(?:${alt(TYPES)})\\b`, name: `storage.type.${s}` },
      { match: `\\b(?:true|false)\\b`, name: `constant.language.${s}` },
      { match: `(?i)\\b(?:${alt(OPCODES)})\\b`, name: `keyword.other.mnemonic.${s}` },
      { match: `(?i)\\b(?:${alt(REGISTERS)})\\b`, name: `constant.other.register.${s}` },
      // uppercase names are constants, hardware registers or labels
      { match: `\\b[A-Z][A-Z0-9_]+\\b`, name: `constant.other.${s}` },
      { match: `->|::|==|!=|<=|>=|<<|>>|&&|\\|\\||[#+*/%&|^!<>=~-]`, name: `keyword.operator.${s}` },
      { match: `[{}()\\[\\],;:]`, name: `punctuation.${s}` },
      { match: ID, name: `variable.other.${s}` },
    ],
    repository: {
      // `;` starts a comment at the start of a line or after whitespace, so
      // `[u8; 50]` is a type and not a comment
      comment: {
        name: `comment.line.semicolon.${s}`,
        match: `(^|\\s);.*$`,
      },
      string: {
        name: `string.quoted.double.${s}`,
        begin: `"`, end: `"`,
        patterns: [{ match: `\\\\.`, name: `constant.character.escape.${s}` }],
      },
      number: {
        patterns: [
          { match: `\\$[0-9A-Fa-f_]+`, name: `constant.numeric.hex.${s}` },
          { match: `%[01_]+`, name: `constant.numeric.binary.${s}` },
          { match: `\\b0[xX][0-9A-Fa-f_]+`, name: `constant.numeric.hex.${s}` },
          { match: `\\b0[bB][01_]+`, name: `constant.numeric.binary.${s}` },
          { match: `\\b\\d[\\d_]*`, name: `constant.numeric.${s}` },
        ],
      },
      // @loop: in a native body, and the leading-dot labels assemblers allow
      label: {
        match: `^\\s*((?:@|\\.)?${ID})\\s*:`,
        captures: { 1: { name: `entity.name.label.${s}` } },
      },
      // @reset, @nocross(256), @cfg(target_arch = "6502")
      attribute: {
        name: `meta.attribute.${s}`,
        begin: `@${ID}`,
        end: `(?=\\)|$)`,
        patterns: [
          { include: '#string' },
          { match: `\\b\\d+\\b`, name: `constant.numeric.${s}` },
          { match: ID, name: `variable.other.${s}` },
          { match: `[(),=]`, name: `punctuation.${s}` },
        ],
      },
    },
  };
}

export function makeUasmConfiguration(): object {
  return {
    comments: { lineComment: ';' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [['{', '}'], ['[', ']'], ['(', ')'], ['"', '"']],
    wordPattern: `[@.]?${ID}|\\$[0-9A-Fa-f_]+|%[01_]+`,
    indentationRules: {
      increaseIndentPattern: `^.*\\{[^}"']*$`,
      decreaseIndentPattern: `^\\s*\\}(?:\\s*;.*)?\\s*$`,
    },
    folding: {
      markers: {
        start: `^\\s*(?:proc|scope)\\b`,
        end: `^\\s*\\}(?:\\s*;.*)?\\s*$`,
      },
    },
  };
}
