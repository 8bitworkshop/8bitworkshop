// Rendering for tool diagnostics: plain text with `backtick` code spans, the
// tool's advice lines, and a link to its help page. DOM nodes only, never
// innerHTML, because the text comes from a compiler.

import { parseErrorText } from "../../common/errormarkup";
import { urustErrorDocURL } from "../../common/toolmeta";

/** Append `text`, rendering backtick runs as <code>. */
export function appendErrorText(parent: Node, text: string): void {
  for (const part of parseErrorText(text)) {
    if (part.code) {
      const code = document.createElement("code");
      code.textContent = part.text;
      parent.appendChild(code);
    } else {
      parent.appendChild(document.createTextNode(part.text));
    }
  }
}

/** Append the tool's `= help:` lines and, for a known topic, its docs link. */
export function appendErrorHelp(parent: HTMLElement, help?: string[], topic?: string): void {
  for (const text of help || []) {
    const line = document.createElement("span");
    line.className = "error-help";
    line.appendChild(document.createTextNode("= help: "));
    appendErrorText(line, text);
    parent.appendChild(line);
  }
  const url = urustErrorDocURL(topic);
  if (url) {
    const line = document.createElement("span");
    line.className = "error-help error-help-link";
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "More about this error";
    line.appendChild(link);
    parent.appendChild(line);
  }
}
