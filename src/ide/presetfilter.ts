// The Project Selector's filter menu (ide/ui.ts).
// It narrows the preset drop-down to one example category, or to the local
// files and imported repositories the platform has.

import { Preset } from "../common/baseplatform";

export const PRESET_FILTER_ALL = "__all__";
export const PRESET_FILTER_LOCAL_FILES = "__local_files__";
export const PRESET_FILTER_REPOSITORIES = "__repositories__";

export interface PresetFilter {
  key: string;
  label: string;
}

/** Categories in the order the platform's preset array lists them. */
export function getPresetCategories(presets: Preset[]): string[] {
  const categories: string[] = [];
  for (const preset of presets) {
    if (preset.category && !categories.includes(preset.category))
      categories.push(preset.category);
  }
  return categories;
}

/** Menu order: All, the platform's categories, then local files/repositories. */
export function getPresetFilters(presets: Preset[], hasLocalFiles: boolean, hasRepositories: boolean): PresetFilter[] {
  const filters: PresetFilter[] = [{ key: PRESET_FILTER_ALL, label: "All" }];
  for (const category of getPresetCategories(presets))
    filters.push({ key: category, label: category });
  if (hasLocalFiles)
    filters.push({ key: PRESET_FILTER_LOCAL_FILES, label: "Local Files" });
  if (hasRepositories)
    filters.push({ key: PRESET_FILTER_REPOSITORIES, label: "Repositories" });
  return filters;
}

/** The selected filter if it is still in the menu, otherwise All. */
export function resolvePresetFilter(filters: PresetFilter[], selected: string): string {
  return filters.some(filter => filter.key == selected) ? selected : PRESET_FILTER_ALL;
}

export function getPresetFilterLabel(filters: PresetFilter[], key: string): string {
  const filter = filters.find(filter => filter.key == key);
  return filter ? filter.label : "All";
}
