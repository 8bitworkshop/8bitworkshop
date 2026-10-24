// TextMate grammar and language configuration for the Rust subset urust
// compiles. The language claims no file extension: .rs belongs to whichever
// Rust extension is installed (rust-analyzer), and this grammar is the
// fallback for a project whose platform builds with urust when no Rust
// extension exists (see projectinfo.ts rustLanguageFor and extension.ts
// assignLanguage). No vscode import; scripts/syntaxes.ts writes the files.

export const RUST_LANGUAGE = {
  id: '8bws-rust',
  aliases: ['Rust (urust)'],
  scopeName: 'source.rust.8bws',
};

const KEYWORDS = `as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move
  mut pub ref return self Self static struct super trait type union unsafe use where while`.split(/\s+/);

const TYPES = `bool char str u8 u16 u32 u64 u128 usize i8 i16 i32 i64 i128 isize f32 f64`.split(/\s+/);
const CONSTANTS = ['true', 'false'];

const alt = (w: string[]) => [...new Set(w)].sort((a, b) => b.length - a.length || a.localeCompare(b))
  .map((w) => w.replace(/[.$?]/g, '\\$&')).join('|');
const ID = `[A-Za-z_][A-Za-z0-9_]*`;
// integer/float type suffix: 0x10u16, 0b1010u8, 1.5f32
const SUFFIX = `(?:[iu](?:8|16|32|64|128|size)|f(?:32|64))?`;

export function makeRustGrammar(): object {
  const s = 'rust';
  return {
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: RUST_LANGUAGE.aliases[0],
    scopeName: RUST_LANGUAGE.scopeName,
    patterns: [
      { include: '#attribute' },
      { include: '#comment' },
      { include: '#rawstring' },
      { include: '#string' },
      { include: '#char' },
      { include: '#number' },
      // fn name, and the item keywords that introduce a name
      {
        match: `\\b(fn)\\s+(${ID})`,
        captures: { 1: { name: `keyword.control.${s}` }, 2: { name: `entity.name.function.${s}` } },
      },
      {
        match: `\\b(struct|enum|trait|type|union)\\s+(${ID})`,
        captures: { 1: { name: `keyword.control.${s}` }, 2: { name: `entity.name.type.${s}` } },
      },
      {
        match: `\\b(mod|use)\\s+(${ID})`,
        captures: { 1: { name: `keyword.control.${s}` }, 2: { name: `entity.name.namespace.${s}` } },
      },
      // macro invocation: println!, reg!, text!, vec![]
      { match: `\\b(${ID})\\s*!(?!=)`, name: `entity.name.function.macro.${s}` },
      { match: `\\b(?:${alt(TYPES)})\\b`, name: `storage.type.${s}` },
      { match: `\\b(?:${alt(CONSTANTS)})\\b`, name: `constant.language.${s}` },
      { match: `\\b(?:${alt(KEYWORDS)})\\b`, name: `keyword.control.${s}` },
      // Rust identifiers that aren't keywords: types (CamelCase), macros are
      // matched above, everything else is a variable or a path component
      // ALL_CAPS names are constants and registers (PPUCTRL, WSYNC)
      { match: `\\b[A-Z][A-Z0-9_]+\\b`, name: `constant.other.${s}` },
      { match: `\\b[A-Z][A-Za-z0-9_]*\\b`, name: `entity.name.type.${s}` },
      { match: `<-|->|=>|::|<<=|>>=|\\.\\.=?|==|!=|<=|>=|&&|\\|\\||[+*/%&|^!<>=@]`, name: `keyword.operator.${s}` },
      { match: `[{}()\\[\\],;:.?]`, name: `punctuation.${s}` },
      { match: `${ID}`, name: `variable.other.${s}` },
    ],
    repository: {
      comment: {
        patterns: [
          { name: `comment.line.double-slash.${s}`, match: `//.*$` },
          // nested /* /* */ */ comments, as Rust allows
          { name: `comment.block.${s}`, begin: `/\\*`, end: `\\*/`, patterns: [{ include: '#comment' }] },
        ],
      },
      // #[reset], #[cycles(max = 1740)], #![no_std]
      attribute: {
        name: `meta.attribute.${s}`,
        begin: `#!?\\[`,
        end: `\\]`,
        beginCaptures: { 0: { name: `punctuation.definition.attribute.begin.${s}` } },
        endCaptures: { 0: { name: `punctuation.definition.attribute.end.${s}` } },
        patterns: [
          { include: '#attrbody' },
        ],
      },
      attrbody: {
        patterns: [
          { include: '#string' },
          // nested brackets: #[x(a = [1])]
          { begin: `\\[`, end: `\\]`, patterns: [{ include: '#attrbody' }] },
          { match: `${ID}`, name: `entity.other.attribute-name.${s}` },
          { match: `=`, name: `keyword.operator.assignment.${s}` },
          { match: `\\b(?:${alt(TYPES)})\\b`, name: `storage.type.${s}` },
          { match: `\\b\\d+\\b`, name: `constant.numeric.${s}` },
        ],
      },
      // r"..." and r#"..."#: no escapes, and the same number of # closes it
      rawstring: {
        name: `string.quoted.double.raw.${s}`,
        begin: `\\b[br]r?(#*)"`, end: `"\\1`,
      },
      string: {
        name: `string.quoted.double.${s}`,
        begin: `"`, end: `"`,
        patterns: [
          { match: `\\\\.`, name: `constant.character.escape.${s}` },
          // println!("x = {}", x)
          { match: `\\{[^{}]*\\}`, name: `constant.other.placeholder.${s}` },
        ],
      },
      // 'a' is a character, 'a is a lifetime (and 'static)
      char: {
        patterns: [
          { match: `'(?:\\\\.|[^'\\\\])'`, name: `string.quoted.single.${s}` },
          { match: `'${ID}`, name: `variable.other.lifetime.${s}` },
        ],
      },
      number: {
        patterns: [
          { match: `\\b0[xX][0-9a-fA-F_]+${SUFFIX}`, name: `constant.numeric.hex.${s}` },
          { match: `\\b0[bB][01_]+${SUFFIX}`, name: `constant.numeric.binary.${s}` },
          { match: `\\b0[oO][0-7_]+${SUFFIX}`, name: `constant.numeric.octal.${s}` },
          { match: `\\b\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][-+]?\\d+)?${SUFFIX}`, name: `constant.numeric.${s}` },
        ],
      },
    },
  };
}

export function makeRustConfiguration(): object {
  return {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string', 'comment'] },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [['{', '}'], ['[', ']'], ['(', ')'], ['"', '"'], ["'", "'"]],
    wordPattern: `[A-Za-z_][A-Za-z0-9_]*|'[A-Za-z_][A-Za-z0-9_]*`,
    indentationRules: {
      increaseIndentPattern: `^.*\\{[^}"']*$`,
      decreaseIndentPattern: `^\\s*\\}[;,]?\\s*$`,
    },
  };
}
