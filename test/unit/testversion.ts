import assert from "assert";
import { describe, it } from "mocha";
import { getAppVersion, getAppVersionLabel } from "../../src/common/version";

describe('version', () => {
  it('returns no version when the build did not inject one', () => {
    // unit tests are compiled without the esbuild define
    assert.strictEqual(getAppVersion(), '');
  });

  it('formats a version for display', () => {
    assert.strictEqual(getAppVersionLabel('4.0.0'), 'v4.0.0');
    assert.strictEqual(getAppVersionLabel('v4.0.0'), 'v4.0.0');
    assert.strictEqual(getAppVersionLabel('V4.0.0'), 'V4.0.0');
    assert.strictEqual(getAppVersionLabel(' 4.0.0 '), 'v4.0.0');
    assert.strictEqual(getAppVersionLabel(''), '');
    assert.strictEqual(getAppVersionLabel(undefined), '');
  });
});
