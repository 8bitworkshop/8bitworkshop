// Tool diagnostics are plain text that quotes identifiers and snippets with
// backticks (`text!("..")`, `let mut`, ...). This is the one piece of Markdown
// the error views render, on purpose: a full renderer would let a compiler's
// message inject structure (and links) into the IDE.

/** A run of error text: plain, or a `code` span from a backtick pair. */
export interface ErrorTextPart {
  text: string;
  code?: boolean;
}

/**
 * Split tool error text into plain and backtick-quoted runs. An unmatched
 * backtick stays literal, and a code span cannot cross a newline.
 */
export function parseErrorText(text: string): ErrorTextPart[] {
  const parts: ErrorTextPart[] = [];
  const re = /`([^`\n]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ text: text.substring(last, m.index) });
    parts.push({ text: m[1], code: true });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ text: text.substring(last) });
  return parts;
}
