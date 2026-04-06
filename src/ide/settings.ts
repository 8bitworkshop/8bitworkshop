import { closeBrackets, deleteBracketPair } from "@codemirror/autocomplete";
import { Compartment, Extension } from "@codemirror/state";
import { EditorView, highlightSpecialChars, highlightTrailingWhitespace, highlightWhitespace, keymap, lineNumbers } from "@codemirror/view";
import { isMobileDevice } from "./views/baseviews";
import { debugHighlightTagsTooltip } from "./views/debug";
import { tabExtension } from "./views/tabs";

const MIN_TAB_SIZE = 1;
const MAX_TAB_SIZE = 40;
const DEFAULT_TAB_SIZE = 8;

declare var bootbox;
declare var $: JQueryStatic;

export const tabCompartment = new Compartment();
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
  tabSize: DEFAULT_TAB_SIZE,
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
  [tabCompartment, s => tabExtension(s.tabSize, s.tabsToSpaces)],
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
  const dialog = bootbox.dialog({
    onEscape: true,
    // title: "Settings",
    message: `<form id="settingsForm" onsubmit="return false">
      <h5>Editor settings</h5>
      <div>
        <label class="main">Tab size</label> <input type="number" id="setting_tabSize" min="${MIN_TAB_SIZE}" max="${MAX_TAB_SIZE}" value="${settings.tabSize}" style="width:4em">
      </div>
      <div>
        <label class="main">Tab key inserts</label>
        <label><input type="radio" name="tabMode" id="setting_tabInsertsTabs" ${!settings.tabsToSpaces ? 'checked' : ''}> tabs</label>
        <label><input type="radio" name="tabMode" id="setting_tabInsertsSpaces" ${settings.tabsToSpaces ? 'checked' : ''}> spaces</label>
      </div>

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
      save: {
        label: "SAVE",
        className: "btn-primary",
        callback: () => {
          settings.tabSize = Math.min(MAX_TAB_SIZE, Math.max(MIN_TAB_SIZE, parseInt($('#setting_tabSize').val() as string) || MIN_TAB_SIZE));
          settings.tabsToSpaces = $('#setting_tabInsertsSpaces').is(':checked');
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
  dialog.on('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dialog.find('.modal-footer .btn-primary').trigger('click');
    }
  });
}
