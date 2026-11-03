import { EditorState, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { ToolIncludePattern } from "../../common/toolmeta";

// Include link detection — shows a clickable badge on lines with include
// directives (#include, .include, `include, !src, ...) to open a read-only
// view of the referenced file. Patterns come from the tool registry
// (src/common/toolmeta.ts) so all languages are supported.

class IncludeLinkWidget extends WidgetType {
  constructor(readonly filename: string, readonly system: boolean, readonly handleClick: (filename: string, system: boolean) => void) { super() }

  toDOM() {
    const span = document.createElement("span");
    span.className = "include-link-badge";
    span.textContent = "→";
    span.title = (this.system ? "System header: " : "View ") + this.filename;
    span.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleClick(this.filename, this.system);
    });
    return span;
  }

  eq(other: IncludeLinkWidget) { return this.filename === other.filename && this.system === other.system; }
  ignoreEvent() { return false; }
}

/** One include badge: the document position to draw it at (end of its line). */
export interface IncludeLink {
  pos: number;
  filename: string;
  system: boolean;
}

/**
 * Find the include badges for the given document ranges. A single directive
 * can match several patterns -- urust's `mod foo;` resolves to both foo.rs
 * and foo/mod.rs -- and gets one badge, not one per pattern, so `mod` lines
 * no longer show two arrows. When `resolveFile` is given, the candidate it
 * names is preferred, so the badge links to the file that exists. Pure: no
 * editor or DOM needed.
 */
export function findIncludeLinks(
  doc: Text,
  ranges: readonly { from: number, to: number }[],
  patterns: (RegExp | ToolIncludePattern)[],
  resolveFile?: (filename: string) => boolean,
): IncludeLink[] {
  // group matches by the directive that produced them: line number + match offset
  const groups = new Map<string, { line: number, candidates: { filename: string, system: boolean }[] }>();
  for (let { from, to } of ranges) {
    const text = doc.sliceString(from, to);
    for (let pat of patterns) {
      const p: ToolIncludePattern = pat instanceof RegExp ? { re: pat } : pat;
      const add = (filename: string, keyIndex: number, endIndex: number) => {
        const matchEnd = Math.min(from + endIndex, doc.length);
        const line = doc.lineAt(matchEnd);
        const key = line.number + ':' + (from + keyIndex);
        let group = groups.get(key);
        if (!group) {
          group = { line: line.number, candidates: [] };
          groups.set(key, group);
        }
        group.candidates.push({ filename, system: !!p.system });
      };
      if (p.re) {
        p.re.lastIndex = 0; // patterns are shared and global, so rewind first
        let m;
        while ((m = p.re.exec(text))) {
          const matched = m[p.group != null ? p.group : m.length - 1];
          if (!matched) continue;
          // let the pattern rewrite the name (urust `rs8::nes::util` ->
          // `nes/util`) before any implicit extension (e.g. wiz `import "nes"`
          // -> "nes.wiz"), same as matchDependencyPatterns() does for build deps
          const name = p.transform ? p.transform(matched, m) : matched;
          add(p.suffix ? name + p.suffix : name, m.index, m.index + m[0].length);
        }
      }
      // A scan enumerates what one match cannot (the items of
      // `use rs8::{io, reset}`); its names are already final paths.
      if (p.scan) {
        for (const hit of p.scan(text)) add(hit.name, hit.index, hit.index);
      }
    }
  }
  const links: IncludeLink[] = [];
  for (let group of groups.values()) {
    let chosen = group.candidates[0];
    if (resolveFile) {
      chosen = group.candidates.find(c => resolveFile(c.filename)) || chosen;
    }
    links.push({ pos: doc.line(group.line).to, filename: chosen.filename, system: chosen.system });
  }
  return links;
}

function buildIncludeLinkDecorations(
  state: EditorState,
  ranges: readonly { from: number, to: number }[],
  patterns: (RegExp | ToolIncludePattern)[],
  handleClick: (filename: string, system: boolean) => void,
  resolveFile?: (filename: string) => boolean,
): DecorationSet {
  const widgets = findIncludeLinks(state.doc, ranges, patterns, resolveFile).map(link =>
    Decoration.widget({
      widget: new IncludeLinkWidget(link.filename, link.system, handleClick),
      side: 1,
    }).range(link.pos));
  return Decoration.set(widgets, true);
}

export function createIncludeLinkPlugin(
  getPatterns: () => (RegExp | ToolIncludePattern)[],
  onClick: (filename: string, system: boolean) => void,
  resolveFile?: (filename: string) => boolean,
) {
  function build(view: EditorView): DecorationSet {
    const patterns = getPatterns();
    if (!patterns || !patterns.length) return Decoration.none;
    return buildIncludeLinkDecorations(view.state, view.visibleRanges, patterns, onClick, resolveFile);
  }
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = build(update.view);
      }
    }
  }, {
    decorations: v => v.decorations,
  });
}
