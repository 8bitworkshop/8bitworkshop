import assert from "assert";
import { describe, it } from "mocha";
import fs from "fs";
import path from "path";
import { BOOKS, BOOK_DEMOS, bookFor, firstVisitDemo, pickRandomBookDemo } from "../../src/common/books";

describe('bookFor', function () {
  it('finds the book for a platform and its variants', function () {
    assert.equal(bookFor('nes')?.id, 'nes');
    assert.equal(bookFor('nes-asm')?.id, 'nes');
    assert.equal(bookFor('vcs.mame')?.id, 'vcs');
    assert.equal(bookFor('verilog-vga')?.id, 'verilog');
    assert.equal(bookFor('c64')?.id, 'c64');
  });

  it('covers only the arcade platforms in the arcade book', function () {
    for (var p of ['mw8080bw', 'vicdual', 'galaxian-scramble', 'vector-z80color', 'williams-z80'])
      assert.equal(bookFor(p)?.id, 'arcade', p);
    for (var p of ['williams', 'vector-ataricolor', 'coleco', 'gb', 'msx', 'apple2'])
      assert.equal(bookFor(p), undefined, p);
  });
});

describe('BOOK_DEMOS', function () {
  it('has a demo for every book', function () {
    for (var book of BOOKS)
      assert.ok(BOOK_DEMOS.some(d => d.book == book.id), book.id);
  });

  it('demos belong to their book and exist on disk', function () {
    for (var demo of BOOK_DEMOS) {
      assert.equal(bookFor(demo.platform)?.id, demo.book, demo.platform);
      const file = path.join('presets', demo.platform, demo.file);
      assert.ok(fs.existsSync(file), file);
    }
  });
});

describe('pickRandomBookDemo', function () {
  it('returns a demo for any random value', function () {
    for (var r of [0, 0.2, 0.5, 0.999, 1])
      assert.ok(BOOK_DEMOS.includes(pickRandomBookDemo(() => r)), String(r));
  });

  it('spreads over the whole list', function () {
    var seen = new Set<string>();
    for (var i = 0; i < 100; i++) seen.add(pickRandomBookDemo().file);
    assert.ok(seen.size > 1, 'picks more than one demo');
  });
});

describe('firstVisitDemo', function () {
  it('picks a demo on a first visit with an empty query', function () {
    var demo = firstVisitDemo({}, true, () => 0);
    assert.equal(demo, BOOK_DEMOS[0]);
  });

  it('does nothing when it is not a first visit', function () {
    assert.equal(firstVisitDemo({}, false, () => 0), null);
  });

  it('leaves a query that names its own platform, file, repo or upload alone', function () {
    for (var q of [{ platform: 'nes' }, { file: 'hello.c' }, { repo: 'user/repo' },
                   { importURL: 'http://example.com/x.c' }, { file0_name: 'main.c' }])
      assert.equal(firstVisitDemo(q, true, () => 0), null, JSON.stringify(q));
  });
});
