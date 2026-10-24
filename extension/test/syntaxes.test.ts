import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { IGrammar } from 'vscode-textmate';
import { ASM_LANGUAGE_CPUS } from '../src/projectinfo';
import { ASM_LANGUAGES, makeContributions, makeLanguageConfiguration } from '../src/syntaxgen';
import { getToolForPlatform } from '../../src/common/toolselect';
import { TOOL_META } from '../../src/common/toolmeta';
import { loadGrammar, tokens } from '../scripts/tmtokenize';

const EXT_ROOT = path.resolve(__dirname, '../..');

/** The scope of the first token whose text is `text`. */
function scopeOf(g: IGrammar, line: string, text: string): string {
  const t = tokens(g, line).find(([s]) => s === text);
  assert.ok(t, `no token '${text}' in ${JSON.stringify(tokens(g, line))}`);
  return t[1];
}

const LABEL = 'entity.name.function.label';
const OPCODE = 'keyword.other.opcode';
const DIRECTIVE = 'keyword.control.directive';
const CONSTANT = 'variable.other.constant';
const REGISTER = 'variable.language.register';
const MACRO_CALL = 'entity.name.function.macro.call';

describe('6502 grammar', function () {
  let g: IGrammar;
  before(async () => { g = await loadGrammar('6502'); });

  it('reads dasm: column-0 labels, plain directives, locals', function () {
    assert.equal(scopeOf(g, 'Start\tsei', 'Start'), LABEL);
    assert.equal(scopeOf(g, 'Start\tsei', 'sei'), OPCODE);
    assert.equal(scopeOf(g, '.CLEAR_STACK    dex', '.CLEAR_STACK'), LABEL);
    assert.equal(scopeOf(g, '\tprocessor 6502', 'processor'), DIRECTIVE);
    assert.equal(scopeOf(g, '\tseg.u Variables', 'seg.u'), DIRECTIVE);
    assert.equal(scopeOf(g, '\tSEG CODE', 'SEG'), DIRECTIVE);
    assert.equal(scopeOf(g, '\tdc.b $1,$2', 'dc.b'), DIRECTIVE);
    assert.equal(scopeOf(g, '\tlda.w $80', 'lda.w'), OPCODE);
    assert.equal(scopeOf(g, 'COLUP0 = $06', 'COLUP0'), CONSTANT);
    assert.equal(scopeOf(g, 'Height  equ 192', 'Height'), CONSTANT);
    assert.equal(scopeOf(g, '.CYCLES     SET {1}', '.CYCLES'), CONSTANT);
    assert.equal(scopeOf(g, '.CYCLES     SET {1}', '{1}'), 'variable.parameter');
    assert.equal(scopeOf(g, '            MAC SLEEP', 'SLEEP'), 'entity.name.function');
    assert.equal(scopeOf(g, '                IFNCONST NO_ILLEGAL', 'IFNCONST'), DIRECTIVE);
    assert.equal(scopeOf(g, '    SLEEP 12', 'SLEEP'), MACRO_CALL);
    assert.equal(scopeOf(g, '\tlax (zp),y', 'lax'), 'keyword.other.opcode.illegal');
  });

  it('reads ca65: dot directives, @locals, unnamed labels, functions', function () {
    assert.equal(scopeOf(g, '.segment "CODE"', '.segment'), DIRECTIVE);
    assert.equal(scopeOf(g, '.segment "CODE"', '"CODE"'), 'string.quoted.double');
    assert.equal(scopeOf(g, '.proc main', 'main'), 'entity.name.function');
    assert.equal(scopeOf(g, '  @loop: lda $2002', '@loop'), LABEL);
    assert.equal(scopeOf(g, '  @loop: lda $2002', 'lda'), OPCODE);
    assert.equal(scopeOf(g, 'nmi:', 'nmi'), LABEL);
    assert.equal(scopeOf(g, '  bne :-', ':-'), LABEL);
    assert.equal(scopeOf(g, '  lda #<.loword(foo)', '.loword'), 'support.function');
    assert.equal(scopeOf(g, '  lda #<.loword(foo)', '#'), 'keyword.operator.immediate');
    assert.equal(scopeOf(g, 'foo: .res 3', '.res'), DIRECTIVE);
    assert.equal(scopeOf(g, 'lda #0', 'lda'), OPCODE);
    assert.equal(scopeOf(g, 'SPEED := 3', 'SPEED'), CONSTANT);
  });

  it('marks index registers and numbers', function () {
    assert.equal(scopeOf(g, '  sta $0200,x', 'x'), REGISTER);
    assert.equal(scopeOf(g, '  sta $0200,x', '$0200'), 'constant.numeric.hex');
    assert.equal(scopeOf(g, '  asl a', 'a'), REGISTER);
    assert.equal(scopeOf(g, '  lda #%1110 ; bits', '%1110'), 'constant.numeric.binary');
    assert.equal(scopeOf(g, '  lda #%1110 ; bits', '; bits'), 'comment.line.semicolon');
    assert.equal(scopeOf(g, "  lda #'A", "'A"), 'string.quoted.single');
    assert.equal(scopeOf(g, '  lda a_var', 'a_var'), 'variable.other');
  });
});

describe('Z80 grammar', function () {
  let g: IGrammar;
  before(async () => { g = await loadGrammar('z80'); });

  it('reads zmac', function () {
    assert.equal(scopeOf(g, 'PrgStart:   DI', 'PrgStart'), LABEL);
    assert.equal(scopeOf(g, 'PrgStart:   DI', 'DI'), OPCODE);
    assert.equal(scopeOf(g, '            INCLUDE "hvglib.h"', 'INCLUDE'), DIRECTIVE);
    assert.equal(scopeOf(g, 'FrameCount  EQU     $4F00', 'FrameCount'), CONSTANT);
    assert.equal(scopeOf(g, '            DB      00001000b', '00001000b'), 'constant.numeric.binary');
    assert.equal(scopeOf(g, '            ld a,0FFh', '0FFh'), 'constant.numeric.hex');
    assert.equal(scopeOf(g, '            SYSTEM  INTPC', 'SYSTEM'), MACRO_CALL);
    assert.equal(scopeOf(g, "  ex af,af'", "af'"), REGISTER);
    assert.equal(scopeOf(g, '  ld (ix+2),a', 'ix'), REGISTER);
    assert.equal(scopeOf(g, '  jp nz,loop', 'nz'), 'keyword.other.condition');
    assert.equal(scopeOf(g, '  ret z', 'z'), 'keyword.other.condition');
    assert.equal(scopeOf(g, 'mymac macro arg', 'mymac'), 'entity.name.function');
  });

  it('reads sdas', function () {
    assert.equal(scopeOf(g, '\t.area _CODE', '.area'), DIRECTIVE);
    assert.equal(scopeOf(g, '\t.globl _main', '.globl'), DIRECTIVE);
    assert.equal(scopeOf(g, '00101$:', '00101$'), LABEL);
    assert.equal(scopeOf(g, '\tjr\tNZ,00101$', '00101$'), 'variable.other');
    assert.equal(scopeOf(g, '\tld\ta,#0x3f', '0x3f'), 'constant.numeric.hex');
    assert.equal(scopeOf(g, '\tldh\t(_x),a', 'ldh'), OPCODE);
  });
});

describe('6809 grammar', function () {
  let g: IGrammar;
  before(async () => { g = await loadGrammar('6809'); });

  it('reads Motorola-style source', function () {
    assert.equal(scopeOf(g, 'palette\tequ\t$c000', 'palette'), CONSTANT);
    assert.equal(scopeOf(g, '        leax\t1,x', 'leax'), OPCODE);
    assert.equal(scopeOf(g, '        leax\t1,x', 'x'), REGISTER);
    assert.equal(scopeOf(g, '\tfcb\t$1,$2', 'fcb'), DIRECTIVE);
    assert.equal(scopeOf(g, '* comment', '* comment'), 'comment.line.asterisk');
    assert.equal(scopeOf(g, '\tpshs a,b', 'b'), REGISTER);
  });
});

describe('verilog grammar', function () {
  let g: IGrammar;
  before(async () => { g = await loadGrammar('verilog'); });

  it('reads Verilog-2005', function () {
    assert.equal(scopeOf(g, 'module top(input clk);', 'module'), 'keyword.control');
    assert.equal(scopeOf(g, 'module top(input clk);', 'top'), 'entity.name.type.module');
    assert.equal(scopeOf(g, 'module top(input clk);', 'input'), 'storage.type');
    assert.equal(scopeOf(g, '  always @(posedge clk) q <= 8\'hFF;', 'always'), 'keyword.control');
    assert.equal(scopeOf(g, '  always @(posedge clk) q <= 8\'hFF;', "8'hFF"), 'constant.numeric.hex');
    assert.equal(scopeOf(g, '  x = 4\'b10zx;', "4'b10zx"), 'constant.numeric.binary');
    assert.equal(scopeOf(g, '  $display("a %d", x);', '$display'), 'support.function');
    assert.equal(scopeOf(g, '`define FOO 1', '`define'), 'keyword.control.directive');
    assert.equal(scopeOf(g, '  y = `FOO;', '`FOO'), 'entity.name.function.macro');
    assert.equal(scopeOf(g, '  // note', '// note'), 'comment.line.double-slash');
    assert.equal(scopeOf(g, '  alu u0 (.a(a));', 'alu'), 'entity.name.type.module');
    assert.equal(scopeOf(g, '  alu u0 (.a(a));', '.a'), 'variable.parameter.port');
  });

  it('reads inline assembly between __asm and __endasm', async function () {
    const { INITIAL } = await import('vscode-textmate');
    let st = INITIAL;
    const scopes: Record<string, string> = {};
    for (const line of ["    rom = '{", '      __asm', '.org 0x8000', 'Loop: ; go', '      mov ax,$6fff', '      __endasm', '  module']) {
      const r = g.tokenizeLine(line, st);
      st = r.ruleStack;
      for (const t of r.tokens) scopes[line.slice(t.startIndex, t.endIndex).trim()] = t.scopes[t.scopes.length - 1];
    }
    assert.equal(scopes['__asm'], 'keyword.control.verilog');
    assert.equal(scopes['.org'], 'keyword.control.directive.verilog');
    assert.equal(scopes['0x8000'], 'constant.numeric.verilog');
    assert.equal(scopes['Loop'], 'entity.name.function.label.verilog');
    assert.equal(scopes['; go'], 'comment.line.semicolon.verilog');
    assert.equal(scopes['$6fff'], 'constant.numeric.verilog');
    assert.equal(scopes['mov ax,'], 'meta.embedded.asm.verilog');
    assert.equal(scopes['__endasm'], 'keyword.control.verilog');
    assert.equal(scopes['module'], 'keyword.control.verilog');
  });

  it('leaves SystemVerilog words alone', function () {
    assert.equal(scopeOf(g, '  logic x;', '  logic x;'), '');
  });
});

describe('rust grammar', function () {
  let g: IGrammar;
  before(async () => { g = await loadGrammar('rust'); });

  it('reads the Rust subset urust compiles', function () {
    assert.equal(scopeOf(g, '#[reset]', 'reset'), 'entity.other.attribute-name');
    assert.equal(scopeOf(g, 'fn main() {', 'fn'), 'keyword.control');
    assert.equal(scopeOf(g, 'fn main() {', 'main'), 'entity.name.function');
    assert.equal(scopeOf(g, 'struct Player {', 'Player'), 'entity.name.type');
    assert.equal(scopeOf(g, 'use rs8::nes::*;', 'rs8'), 'entity.name.namespace');
    assert.equal(scopeOf(g, 'let x: u8 = 0x10;', 'let'), 'keyword.control');
    assert.equal(scopeOf(g, 'let x: u8 = 0x10;', 'u8'), 'storage.type');
    assert.equal(scopeOf(g, 'let x: u8 = 0x10;', '0x10'), 'constant.numeric.hex');
    assert.equal(scopeOf(g, 'let b = 0b1010u8;', '0b1010u8'), 'constant.numeric.binary');
    assert.equal(scopeOf(g, 'println!("Hi");', 'println!'), 'entity.name.function.macro');
    assert.equal(scopeOf(g, 'println!("Hi");', 'Hi'), 'string.quoted.double');
    assert.equal(scopeOf(g, "let c = 'a';", "'a'"), 'string.quoted.single');
    assert.equal(scopeOf(g, 'fn f<\'a>(x: &\'a u8) {}', "'a"), 'variable.other.lifetime');
    assert.equal(scopeOf(g, '  // note', '// note'), 'comment.line.double-slash');
  });

  it('reads nested attribute brackets, raw strings and ALL_CAPS names', function () {
    assert.equal(scopeOf(g, '#[x(a = [1])] fn f() {}', 'fn'), 'keyword.control');
    assert.equal(scopeOf(g, 'let s = r#"a "b" c"#;', 'a "b" c'), 'string.quoted.double.raw');
    assert.equal(scopeOf(g, 'PPUCTRL = 0;', 'PPUCTRL'), 'constant.other');
    assert.equal(scopeOf(g, 'struct Player {', 'Player'), 'entity.name.type');
  });

  it('reads block comments, nesting included', async function () {
    const { INITIAL } = await import('vscode-textmate');
    let st = INITIAL;
    const line = (text: string): [string, string][] => {
      const r = g.tokenizeLine(text, st);
      st = r.ruleStack;
      return r.tokens.map((t: any) => [text.slice(t.startIndex, t.endIndex), t.scopes[t.scopes.length - 1]]);
    };
    // every token on these lines is still inside the outer comment
    for (const text of ['/* outer', '  /* inner */', '  still out'])
      assert.ok(line(text).every(([t, s]) => !t.trim() || s === 'comment.block.rust'), text);
    // the end marker closes it, and the code after it is code again
    const after = line('*/ fn main() {}');
    assert.equal(after.find(([t]) => t === '*/')?.[1], 'comment.block.rust');
    assert.equal(after.find(([t]) => t === 'fn')?.[1], 'keyword.control.rust');
  });
});

describe('assembler languages', function () {
  it('match package.json', function () {
    const pkg = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, 'package.json'), 'utf8'));
    const c = makeContributions();
    assert.deepEqual(pkg.contributes.languages, c.languages);
    assert.deepEqual(pkg.contributes.grammars, c.grammars);
  });

  it('are the ones projectinfo assigns', function () {
    assert.deepEqual(ASM_LANGUAGE_CPUS, ASM_LANGUAGES.map((l) => l.cpu));
  });

  it('claim only extensions whose tool uses that CPU style', function () {
    const style: Record<string, string> = { '8bws-6502': '6502', '8bws-z80': 'z80', '8bws-6809': '6809' };
    const platform: Record<string, string> = { '8bws-6502': 'nes', '8bws-z80': 'zx', '8bws-6809': 'williams' };
    for (const lang of ASM_LANGUAGES) {
      for (const ext of lang.extensions) {
        const tool = getToolForPlatform(platform[lang.id], `main${ext}`);
        assert.equal(TOOL_META[tool]?.editorStyle, style[lang.id], `${ext} -> ${tool}`);
      }
    }
  });

  it('have folding markers that match either case', function () {
    const cfg: any = makeLanguageConfiguration(ASM_LANGUAGES[0]);
    const start = new RegExp(cfg.folding.markers.start);
    const end = new RegExp(cfg.folding.markers.end);
    assert.ok(start.test('            MAC SLEEP'));
    assert.ok(start.test('.proc main'));
    assert.ok(start.test('\t.if FOO'));
    assert.ok(end.test('            ENDM'));
    assert.ok(end.test('.endproc'));
    assert.ok(!start.test('\tlda #0'));
  });
});
