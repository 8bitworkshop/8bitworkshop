import assert from "assert";
import { describe, it } from "mocha";
import { parseErrorText } from "../../src/common/errormarkup";

describe('error markup', function () {
  it('splits backtick code spans from plain text', function () {
    assert.deepStrictEqual(parseErrorText('use `text!("..")` here'), [
      { text: 'use ' },
      { text: 'text!("..")', code: true },
      { text: ' here' },
    ]);
    assert.deepStrictEqual(parseErrorText('`a` and `b`'), [
      { text: 'a', code: true },
      { text: ' and ' },
      { text: 'b', code: true },
    ]);
  });

  it('leaves unmatched backticks and plain text alone', function () {
    assert.deepStrictEqual(parseErrorText('unclosed `x'), [{ text: 'unclosed `x' }]);
    assert.deepStrictEqual(parseErrorText('a `code\nspan`'), [{ text: 'a `code\nspan`' }]);
    assert.deepStrictEqual(parseErrorText(''), []);
  });
});
