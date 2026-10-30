import assert from "assert";
import { describe, it } from "mocha";
import { SourceFile } from "../../src/common/workertypes";
import { buildSourceLineMap, formatSourceComment, isSourceComment } from "../../src/ide/views/disasmsource";

function sourceFile(lines: { line: number, offset: number, path?: string }[]): SourceFile {
  return new SourceFile(lines as any, '');
}

describe('disassembly source lines', function () {

  it('maps source-line start addresses to their file, line and text', function () {
    const listings = {
      'main.c.lst': {
        lines: [],
        sourcefile: sourceFile([
          { line: 2, offset: 0x100, path: 'main.c' },
          { line: 3, offset: 0x104, path: 'main.c' },
        ]),
      } as any,
    };
    const map = buildSourceLineMap(listings, (path, line) =>
      path == 'main.c' ? ['', 'int main() {', '  x++;', '}'][line - 1] : null);
    assert.deepStrictEqual(map.get(0x100), { path: 'main.c', file: 'main.c', line: 2, text: 'int main() {' });
    assert.deepStrictEqual(map.get(0x104), { path: 'main.c', file: 'main.c', line: 3, text: '  x++;' });
  });

  it('derives the source path from a listing name when lines have no path', function () {
    // SDCC writes a hello.c.lst from hello.c, without a per-line file name
    const listings = {
      'hello.c.lst': {
        lines: [],
        sourcefile: sourceFile([{ line: 7, offset: 0x865 }]),
      } as any,
    };
    const map = buildSourceLineMap(listings, (path, line) =>
      path == 'hello.c' && line == 7 ? 'putstr(message);' : null);
    assert.strictEqual(map.get(0x865).text, 'putstr(message);');
  });

  it('keeps only the first line at an address', function () {
    const listings = {
      'main.c.lst': {
        lines: [],
        sourcefile: sourceFile([
          { line: 10, offset: 0x100, path: 'main.c' },
          { line: 11, offset: 0x100, path: 'main.c' },
        ]),
      } as any,
    };
    const map = buildSourceLineMap(listings, (path, line) => `line ${line}`);
    assert.strictEqual(map.size, 1);
    assert.strictEqual(map.get(0x100).line, 10);
  });

  it('skips lines whose source text is not available', function () {
    const listings = {
      'main.c.lst': {
        lines: [],
        sourcefile: sourceFile([{ line: 1, offset: 0x100, path: 'missing.c' }]),
      } as any,
    };
    assert.strictEqual(buildSourceLineMap(listings, () => null).size, 0);
  });

  it('lets the caller omit assembly sources', function () {
    const listings = {
      'main.lst': {
        lines: [],
        sourcefile: sourceFile([
          { line: 2, offset: 0x100, path: 'main.c' },
          { line: 8, offset: 0x200, path: 'main.s' },
        ]),
      } as any,
    };
    const read = (path: string, line: number) => `${path}:${line}`;
    const map = buildSourceLineMap(listings, read, path => !path.endsWith('.s'));
    assert.strictEqual(map.get(0x100).text, 'main.c:2');
    assert.strictEqual(map.get(0x200), undefined);
  });

  it('does not add a mixed listing\'s combined sourcefile twice', function () {
    const sf = sourceFile([{ line: 1, offset: 0x200, path: 'lib.c' }]);
    const listings = {
      'main.lst': {
        lines: [],
        sourcefile: sf,
        sourcefiles: { 'lib.c': sf },
      } as any,
    };
    assert.strictEqual(buildSourceLineMap(listings, () => 'x').size, 1);
  });

  it('formats a source line as a disassembly comment', function () {
    assert.strictEqual(formatSourceComment({ path: 'src/main.c', file: 'main.c', line: 12, text: '  x++;  ' }),
      '; main.c:12:   x++;');
    assert.strictEqual(formatSourceComment({ path: 'src/main.c', file: 'main.c', line: 13, text: '' }),
      '; main.c:13:');
  });

  it('recognizes its own source comments, not a listing comment', function () {
    assert.ok(isSourceComment(formatSourceComment({ path: 'src/main.c', file: 'main.c', line: 12, text: 'x++;' })));
    assert.ok(!isSourceComment('; main.c: 12: x++;')); // listing-style comment
    assert.ok(!isSourceComment('; a plain comment'));
    assert.ok(!isSourceComment('0865  A2 08  LDX #$08'));
  });

});
