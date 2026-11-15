// CodeMirror support for urust's `.uasm` assembly front end: Rust-like
// declarations (import/const/data/var/scope/proc) around native assembly
// bodies. The body is whichever CPU the platform builds for, so the mnemonics
// and registers of all three are highlighted; declarations and `;` comments
// are what make the file different from a plain assembler source.

import { StreamLanguage, StreamParser, LanguageSupport } from "@codemirror/language";
import * as K from "./asmkeywords";

interface UasmState {
  /** inside a proc's native body (after its `{`) */
  inBody: boolean;
  /** a `proc` declaration has been read; its `{` starts the body */
  pendingProc: boolean;
  depth: number;
}

const DECLARATIONS = new Set([
  'import', 'const', 'data', 'var', 'scope', 'proc',
]);
const CLAUSES = new Set([
  'clobbers', 'stack', 'carry', 'irq', 'cycles', 'scratch', 'fast', 'in',
  'keep', 'on', 'off',
]);
const TYPES = new Set(['u8', 'i8', 'bool', 'u16', 'i16', 'u32', 'i32']);
const ATOMS = new Set(['true', 'false']);
const OPCODES = new Set([
  ...K.opcodes6502, ...K.opcodes65C02, ...K.illegalOpcodes6502,
  ...K.opcodesZ80, ...K.opcodesGBZ80,
  ...K.opcodes6809,
].map(s => s.toLowerCase()));
const REGISTERS = new Set([
  ...K.registers6502, ...K.registersZ80, ...K.registers6809,
].map(s => s.toLowerCase()));

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/;
const WORD = /[\w.$?]/;

/** `;` starts a comment at the start of a line or after whitespace, so `[u8; 50]` is a type. */
function atCommentStart(stream: any): boolean {
  return stream.sol() || stream.pos === 0 || /\s/.test(stream.string.charAt(stream.pos - 1));
}

const uasmStreamParser: StreamParser<UasmState> = {
  name: 'uasm',

  startState() {
    return { inBody: false, pendingProc: false, depth: 0 };
  },

  token(stream, state) {
    if (stream.sol()) {
      // a closing brace ends a native body even before it is tokenized
      if (/^\s*}/.test(stream.string.slice(stream.pos))) state.inBody = false;
    }
    if (stream.eatSpace()) return null;

    const ch = stream.peek();

    if (ch === ';' && atCommentStart(stream)) {
      stream.skipToEnd();
      return 'comment';
    }

    if (ch === '"') {
      stream.next();
      while (!stream.eol()) {
        const c = stream.next();
        if (c === '\\') stream.next();
        else if (c === '"') break;
      }
      return 'string';
    }

    // @reset, @nocross(256), @loop: (a label in a native body)
    if (ch === '@') {
      stream.next();
      stream.eatWhile(WORD);
      return stream.peek() === ':' ? 'labelName' : 'meta';
    }

    // $hex and %bin, the target assemblers' number formats
    if (ch === '$') {
      stream.next();
      stream.eatWhile(/[0-9A-Fa-f_]/);
      return 'number';
    }
    if (ch === '%') {
      stream.next();
      stream.eatWhile(/[01_]/);
      return 'number';
    }
    if (/[0-9]/.test(ch)) {
      stream.match(/^(?:0[xX][0-9A-Fa-f_]+|0[bB][01_]+|\d[\d_]*)/);
      return 'number';
    }

    // declaration line: `proc bump(...)`, `const LINES = 192`
    if (/[A-Za-z_.]/.test(ch)) {
      const lineStart = /^\s*$/.test(stream.string.slice(0, stream.pos));
      stream.next();
      stream.eatWhile(WORD);
      const word = stream.current();
      const lower = word.toLowerCase();

      // a label in a native body, and the leading-dot labels assemblers allow
      if (lineStart && stream.peek() === ':') return 'labelName';
      if (DECLARATIONS.has(lower)) {
        if (lower === 'proc') state.pendingProc = true;
        return 'keyword';
      }
      if (CLAUSES.has(lower)) return 'keyword';
      if (TYPES.has(lower)) return 'typeName';
      if (ATOMS.has(lower)) return 'atom';
      if (state.inBody && OPCODES.has(lower)) return 'keyword';
      if (REGISTERS.has(lower)) return 'atom';
      // an uppercase name is a constant or a hardware register
      if (/^[A-Z][A-Z0-9_]*$/.test(word)) return 'atom';
      return stream.peek() === ':' ? 'labelName' : 'variableName';
    }

    if (ch === '{') {
      stream.next();
      state.depth++;
      if (state.pendingProc) {
        state.inBody = true;
        state.pendingProc = false;
      }
      return 'bracket';
    }
    if (ch === '}') {
      stream.next();
      state.inBody = false;
      state.depth = Math.max(0, state.depth - 1);
      return 'bracket';
    }
    if (ch === '[' || ch === ']' || ch === '(' || ch === ')') {
      stream.next();
      return 'bracket';
    }
    if (ch === ',' || ch === ':' || ch === ';') {
      stream.next();
      return 'separator';
    }
    if (ch === '#' || ch === '<' || ch === '>' || ch === '-' || ch === '+' ||
      ch === '*' || ch === '/' || ch === '=' || ch === '!' || ch === '&' ||
      ch === '|' || ch === '^' || ch === '~') {
      stream.match(/^(?:->|::|==|!=|<=|>=|<<|>>|&&|\|\|)/) || stream.next();
      return 'operator';
    }

    stream.next();
    return null;
  },

  indent(state, textAfter, context) {
    const closing = /^\s*}/.test(textAfter);
    const depth = Math.max(0, state.depth - (closing ? 1 : 0));
    return depth * (context.unit || 2);
  },

  languageData: {
    commentTokens: { line: ';' },
  },
};

export function uasm(): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(uasmStreamParser));
}

export { uasmStreamParser };
