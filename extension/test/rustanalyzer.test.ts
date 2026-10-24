import * as assert from 'assert';
import {
  RUST_ANALYZER_SETTINGS, hasRustAnalyzerSettings, isUrustProject, withRustAnalyzerSettings
} from '../src/rustanalyzer';

describe('rust-analyzer settings', function () {
  it('recognizes a urust project by platform or tool', function () {
    for (var platform of ['nes', 'vcs', 'c64', 'atari8-800', 'apple2', 'vic20', 'zx', 'devel-6502'])
      assert.ok(isUrustProject(platform), platform);
    assert.ok(isUrustProject('nes', 'urust'));
    assert.ok(!isUrustProject('nes', 'cc65'));
    assert.ok(!isUrustProject('gb'), 'gb has no urust target');
    assert.ok(!isUrustProject(undefined));
  });

  it('turns off the check, unresolved-name lints, proc macros and the Run/Debug lenses only', function () {
    assert.deepEqual(RUST_ANALYZER_SETTINGS, {
      'rust-analyzer.checkOnSave': false,
      'rust-analyzer.diagnostics.disabled': RUST_ANALYZER_SETTINGS['rust-analyzer.diagnostics.disabled'],
      'rust-analyzer.procMacro.enable': false,
      'rust-analyzer.lens.run.enable': false,
      'rust-analyzer.lens.debug.enable': false,
    });
  });

  it('keeps syntax errors on and drops only the unresolved-name lints', function () {
    assert.ok(!('rust-analyzer.diagnostics.enable' in RUST_ANALYZER_SETTINGS));
    var off = RUST_ANALYZER_SETTINGS['rust-analyzer.diagnostics.disabled'] as string[];
    assert.ok(off.includes('unresolved-import') && off.includes('macro-error'));
    assert.ok(hasRustAnalyzerSettings(JSON.parse(JSON.stringify(RUST_ANALYZER_SETTINGS))), 'compared by value');
  });

  it('merges into the existing settings without dropping any', function () {
    var settings = { '8bitworkshop.platform': 'nes', 'editor.tabSize': 2 };
    var merged = withRustAnalyzerSettings(settings);
    assert.equal(merged['8bitworkshop.platform'], 'nes');
    assert.equal(merged['editor.tabSize'], 2);
    assert.ok(hasRustAnalyzerSettings(merged));
    // the input isn't changed
    assert.deepEqual(settings, { '8bitworkshop.platform': 'nes', 'editor.tabSize': 2 });
  });

  it('knows when the settings are already there', function () {
    assert.ok(!hasRustAnalyzerSettings({}));
    assert.ok(!hasRustAnalyzerSettings({ 'rust-analyzer.checkOnSave': true }));
    assert.ok(hasRustAnalyzerSettings(RUST_ANALYZER_SETTINGS));
  });
});
