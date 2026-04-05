import { closeBrackets, deleteBracketPair } from "@codemirror/autocomplete";
import { indentUnit } from "@codemirror/language";
import { Compartment, EditorState, Extension } from "@codemirror/state";
import { EditorView, highlightSpecialChars, highlightTrailingWhitespace, highlightWhitespace, keymap, lineNumbers } from "@codemirror/view";
import { isMobileDevice } from "./views/baseviews";
import { debugHighlightTagsTooltip } from "./views/debug";
import { insertTabKeymap, smartIndentKeymap } from "./views/tabs";

declare var bootbox;
declare var $: JQueryStatic;

export const tabSizeCompartment = new Compartment();
export const tabsToSpacesCompartment = new Compartment();
export const showLineNumbersCompartment = new Compartment();
export const highlightSpecialCharsCompartment = new Compartment();
export const highlightTrailingWhitespaceCompartment = new Compartment();
export const highlightWhitespaceCompartment = new Compartment();
export const closeBracketsCompartment = new Compartment();
export const debugHighlightTagsCompartment = new Compartment();

const editors: Set<EditorView> = new Set();

export function registerEditor(editor: EditorView) {
  editors.add(editor);
}

export function unregisterEditor(editor: EditorView) {
  editors.delete(editor);
}

export interface EditorSettings {
  tabSize: number;
  tabsToSpaces: boolean;
  showLineNumbers: boolean;
  highlightSpecialChars: boolean;
  highlightTrailingWhitespace: boolean;
  highlightWhitespace: boolean;
  closeBrackets: boolean;
  debugHighlightTags: boolean;
}

const SETTINGS_KEY = "8bitworkshop/editorSettings";

const defaultSettings: EditorSettings = {
  tabSize: 8,
  tabsToSpaces: true,
  showLineNumbers: !isMobileDevice,
  highlightSpecialChars: true,
  highlightTrailingWhitespace: true,
  highlightWhitespace: false,
  closeBrackets: false,
  debugHighlightTags: false,
};

export function loadSettings(): EditorSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch (e) { }
  return { ...defaultSettings };
}

export function saveAndApplySettings(settings: EditorSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  const effects = compartmentValues.map(([c, fn]) => c.reconfigure(fn(settings)));
  for (const editor of editors) {
    editor.dispatch({ effects });
  }
}

const compartmentValues: [Compartment, (s: EditorSettings) => Extension][] = [
  [tabSizeCompartment, s => [EditorState.tabSize.of(s.tabSize), indentUnit.of(" ".repeat(s.tabSize))]],
  [tabsToSpacesCompartment, s => keymap.of(s.tabsToSpaces ? smartIndentKeymap : insertTabKeymap)],
  [showLineNumbersCompartment, s => s.showLineNumbers ? lineNumbers() : []],
  [highlightSpecialCharsCompartment, s => s.highlightSpecialChars ? highlightSpecialChars() : []],
  [highlightTrailingWhitespaceCompartment, s => s.highlightTrailingWhitespace ? highlightTrailingWhitespace() : []],
  [highlightWhitespaceCompartment, s => s.highlightWhitespace ? highlightWhitespace() : []],
  [closeBracketsCompartment, s => s.closeBrackets ? [closeBrackets(), keymap.of([{ key: "Backspace", run: deleteBracketPair }])] : []],
  [debugHighlightTagsCompartment, s => s.debugHighlightTags ? debugHighlightTagsTooltip : []],
];

export function settingsExtensions(settings: EditorSettings): Extension[] {
  return compartmentValues.map(([c, fn]) => c.of(fn(settings)));
}

export function openSettings() {
  var settings = loadSettings();
  bootbox.dialog({
    onEscape: true,
    // title: "Settings",
    message: `<form id="settingsForm" onsubmit="return false">
       <h5>Editor settings</h5>
       <div class="form-group"><label>Tab size: <input type="number" id="setting_tabSize" min="1" max="40" value="${settings.tabSize}" style="width:4em"></label></div>
       <div class="checkbox"><label><input type="checkbox" id="setting_tabsToSpaces" ${settings.tabsToSpaces ? 'checked' : ''}> Insert spaces when pressing TAB</label></div>
       <div class="checkbox"><label><input type="checkbox" id="setting_showLineNumbers" ${settings.showLineNumbers ? 'checked' : ''}> Show line numbers</label></div>
       <div class="checkbox"><label><input type="checkbox" id="setting_highlightSpecialChars" ${settings.highlightSpecialChars ? 'checked' : ''}> Show special characters</label></div>
       <div class="checkbox"><label><input type="checkbox" id="setting_highlightTrailingWhitespace" ${settings.highlightTrailingWhitespace ? 'checked' : ''}> Highlight trailing whitespace</label></div>
       <div class="checkbox"><label><input type="checkbox" id="setting_highlightWhitespace" ${settings.highlightWhitespace ? 'checked' : ''}> Show whitespace</label></div>
       <div class="checkbox"><label><input type="checkbox" id="setting_closeBrackets" ${settings.closeBrackets ? 'checked' : ''}> Automatically add and remove closing brackets</label></div>

       <h5>8bitworkshop IDE internal settings</h5>
       <div class="checkbox"><label><input type="checkbox" id="setting_debugHighlightTags" ${settings.debugHighlightTags ? 'checked' : ''}> Debug parser and syntax highlighting</label></div>
      </form>`,
    buttons: {
      cancel: {
        label: "Cancel",
        className: "btn-default"
      },
      ok: {
        label: "SAVE",
        className: "btn-primary",
        callback: () => {
          settings.tabSize = parseInt($('#setting_tabSize').val() as string) || 8;
          settings.tabsToSpaces = $('#setting_tabsToSpaces').is(':checked');
          settings.showLineNumbers = $('#setting_showLineNumbers').is(':checked');
          settings.highlightSpecialChars = $('#setting_highlightSpecialChars').is(':checked');
          settings.highlightTrailingWhitespace = $('#setting_highlightTrailingWhitespace').is(':checked');
          settings.highlightWhitespace = $('#setting_highlightWhitespace').is(':checked');
          settings.closeBrackets = $('#setting_closeBrackets').is(':checked');
          settings.debugHighlightTags = $('#setting_debugHighlightTags').is(':checked');
          saveAndApplySettings(settings);
        }
      }
    }
  });
}
