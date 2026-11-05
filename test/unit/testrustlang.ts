import assert from "assert";
import { describe, it } from "mocha";
import { rust } from "@codemirror/lang-rust";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { TOOL_META, URUST_INCLUDE_PATTERNS, getToolMetaForFilename } from "../../src/common/toolmeta";
import { findIncludeLinks } from "../../src/ide/views/includedecorations";
import { extractSymbols } from "../../src/common/symbols";

describe('Rust editor support', function () {
  it('maps .rs files to urust with the rust editor style', function () {
    assert.ok(getToolMetaForFilename('main.rs').some(m => m.id === 'urust'));
    assert.strictEqual(TOOL_META.urust.editorStyle, 'rust');
  });

  it('parses a Rust source file', function () {
    const code = 'fn main() {\n    let x: u8 = 1; // hi\n    loop {}\n}\n';
    const state = EditorState.create({ doc: code, extensions: [rust()] });
    const names: string[] = [];
    syntaxTree(state).iterate({ enter: n => { names.push(n.name); } });
    for (const expected of ['FunctionItem', 'LetDeclaration', 'LoopExpression', 'LineComment']) {
      assert.ok(names.includes(expected), `expected ${expected} in ${names.join(' ')}`);
    }
  });

  it('shows one include badge per mod line, preferring the file that exists', function () {
    const doc = EditorState.create({ doc: 'mod audio;\nmod bcd;\n' }).doc;
    const ranges = [{ from: 0, to: doc.length }];
    // both foo.rs and foo/mod.rs patterns match each mod line; keep one badge
    assert.deepStrictEqual(
      findIncludeLinks(doc, ranges, URUST_INCLUDE_PATTERNS).map(l => l.filename),
      ['audio.rs', 'bcd.rs']);
    // if only the subdirectory form exists, link to that one
    assert.deepStrictEqual(
      findIncludeLinks(doc, ranges, URUST_INCLUDE_PATTERNS, fn => fn === 'audio/mod.rs').map(l => l.filename),
      ['audio/mod.rs', 'bcd.rs']);
  });

  it('links a nested rs8 module to the child source', function () {
    const doc = EditorState.create({
      doc: 'use rs8::nes::util::{pad_poll, ppu_off, PpuSafe};\nuse rs8::nes::PPUCTRL;\n'
    }).doc;
    const ranges = [{ from: 0, to: doc.length }];
    // the child module is its own file; an item of the parent stays with it
    assert.deepStrictEqual(
      findIncludeLinks(doc, ranges, URUST_INCLUDE_PATTERNS).map(l => l.filename),
      ['nes/util.rs', 'nes.rs']);
  });

  it('shows a badge for each module in a use brace group', function () {
    const doc = EditorState.create({
      doc: 'use rs8::apple2;\nuse rs8::apple2::util;\nuse rs8::gfx::surface::*;\nuse rs8::{io, reset};\n'
    }).doc;
    const ranges = [{ from: 0, to: doc.length }];
    // `reset` is an item, not a module, so the group has one link
    assert.deepStrictEqual(
      findIncludeLinks(doc, ranges, URUST_INCLUDE_PATTERNS).map(l => l.filename),
      ['apple2.rs', 'apple2/util.rs', 'gfx/surface.rs', 'io.rs']);
  });

  it('extracts Rust fn declarations as symbols', function () {
    const records = extractSymbols('fn draw(x: u8) {}\nfn main() {}\n', 'main.rs', 'rust', 'project');
    assert.deepStrictEqual(records.filter(r => r.kind === 'func').map(r => r.name), ['draw', 'main']);
  });
});
