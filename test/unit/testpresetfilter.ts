import assert from "assert";
import { describe, it } from "mocha";
import { Preset } from "../../src/common/baseplatform";
import { getPresetCategories, getPresetFilters, getPresetFilterLabel, resolvePresetFilter, PRESET_FILTER_ALL, PRESET_FILTER_LOCAL_FILES, PRESET_FILTER_REPOSITORIES } from "../../src/ide/presetfilter";

const PRESETS: Preset[] = [
  { id: 'hello.c', name: 'Hello World' },
  { id: 'hello-sdcc.c', name: 'Hello World (SDCC)', category: 'SDCC' },
  { id: 'sprites.c', name: 'Sprites' },
  { id: 'hello.rs', name: 'Hello (urust)', category: 'urust' },
  { id: 'hello2-sdcc.c', name: 'Hello Again (SDCC)', category: 'SDCC' },
];

describe('preset filter menu', function () {
  it('lists categories once, in preset order', function () {
    assert.deepEqual(getPresetCategories(PRESETS), ['SDCC', 'urust']);
    assert.deepEqual(getPresetCategories([PRESETS[0], PRESETS[2]]), []);
  });

  it('starts with All, then categories and special groups', function () {
    assert.deepEqual(getPresetFilters(PRESETS, false, false).map(f => f.label), ['All', 'SDCC', 'urust']);
    assert.deepEqual(getPresetFilters(PRESETS, true, true).map(f => f.key),
      [PRESET_FILTER_ALL, 'SDCC', 'urust', PRESET_FILTER_LOCAL_FILES, PRESET_FILTER_REPOSITORIES]);
  });

  it('falls back to All when the selected filter is gone', function () {
    const filters = getPresetFilters(PRESETS, false, false);
    assert.equal(resolvePresetFilter(filters, 'SDCC'), 'SDCC');
    assert.equal(resolvePresetFilter(filters, PRESET_FILTER_LOCAL_FILES), PRESET_FILTER_ALL);
    assert.equal(resolvePresetFilter(filters, null), PRESET_FILTER_ALL);
  });

  it('labels the selected filter', function () {
    const filters = getPresetFilters(PRESETS, true, false);
    assert.equal(getPresetFilterLabel(filters, PRESET_FILTER_LOCAL_FILES), 'Local Files');
    assert.equal(getPresetFilterLabel(filters, 'SDCC'), 'SDCC');
    assert.equal(getPresetFilterLabel(filters, 'nope'), 'All');
  });
});
