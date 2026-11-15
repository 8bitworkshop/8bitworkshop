import { SymbolIndex } from "./symbolindex";
import { SymbolRecord, SymbolSourceKind } from "../../common/searchtypes";
import { SearchHit, SearchSource } from "./types";
import { extractSymbols } from "../../common/symbols";

// Avoid a hard dependency on ../ui (which pulls in the whole IDE and its
// language grammar imports that crash under plain Node). ui.ts registers a
// getter here during startup instead.
export interface SearchableProject {
  mainPath: string;
  platform_id?: string;
  getToolForFilename?(path: string): string;
  iterateFiles(cb: (path: string, data: any) => void): void;
  queryWorker?(msg: any): Promise<any | null>;
}

type ProjectProvider = () => SearchableProject | null;
let projectProvider: ProjectProvider = () => null;

export function setProjectProvider(fn: ProjectProvider) {
  projectProvider = fn;
}

export function getProject(): SearchableProject | null {
  return projectProvider();
}

export class ProjectSource implements SearchSource {
  id: string = 'project';
  kind: SymbolSourceKind = 'project';
  private index: SymbolIndex;
  private rebuilt: boolean = false;

  constructor() {
    this.index = new SymbolIndex([]);
  }

  async ready() {
    await this.index.init();
    // Lazily index the current project files on first query.
    if (!this.rebuilt) {
      this.rebuilt = true;
      await this.rebuild();
    }
  }

  query(needle: string, limit: number): SearchHit[] {
    // Symbol/name matches first (high priority), then full-text line matches
    // at low priority so code text (not just identifiers) is searchable.
    const symbolHits = this.index.query(needle, limit);
    const textHits = this.fulltextQuery(needle, limit);

    const hits = symbolHits.concat(textHits);
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  /**
   * Low-priority full-text search over the raw project source text.
   * Rather than a real index, we scan current_project.filedata directly
   * (project files are small and few); results rank below any symbol hit.
   */
  private fulltextQuery(needle: string, limit: number): SearchHit[] {
    if (needle.length < 2) return [];

    const needleLower = needle.toLowerCase();
    const hits: SearchHit[] = [];
    const MAX_PER_FILE = Math.max(limit, 10);

    const project = getProject();
    if (!project) return [];

    project.iterateFiles((path, data) => {
      if (typeof data !== 'string') return;
      const lines = data.split('\n');
      let fileCount = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineLower = line.toLowerCase();
        const col = lineLower.indexOf(needleLower);
        if (col >= 0) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          hits.push({
            record: {
              id: `text:${path}:${i + 1}`,
              name: trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed,
              kind: 'text',
              source: 'project',
              file: path,
              line: i + 1,
            },
            // Well below symbol matches (BASE_MATCH_SCORE ~1000) but above 0.
            // Slight bonus for a match near the start of the line.
            score: 200 + Math.max(0, 100 - col * 2),
            ranges: [col, col + needle.length],
          });
          if (++fileCount >= MAX_PER_FILE) break;
        }
      }
    });

    return hits;
  }

  async onFileChanged(path: string, data: Uint8Array | string) {
    const records = this.extractSymbolsFromFile(path, data, 'project');
    this.index.pushRecords(records);
  }

  private extractSymbolsFromFile(path: string, data: Uint8Array | string, source: SymbolSourceKind): SymbolRecord[] {
    if (typeof data !== 'string') return [];
    const editorStyle = this.detectEditorStyle(path);
    return extractSymbols(data, path, editorStyle, source);
  }

  private detectEditorStyle(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'c':
      case 'h':
        return 'text/x-csrc';
      case 'rs':
        return 'rust';
      case 'uasm':
        return 'uasm';
      case 'asm':
      case 'a65':
      case 'inc':
        return '6502';
      case 'v':
        return 'verilog';
      case 'wiz':
        return 'text/x-wiz';
      case 'bas':
      case 'basic':
        return 'basic';
      case 'fb':
      case 'fastbasic':
        return 'fastbasic';
      case 'bac':
      case 'bataribasic':
        return 'bataribasic';
      case 'i':
        return 'inform6';
      case 'd':
        return 'dialog';
      default:
        return 'text/x-csrc';
    }
  }

  async rebuild() {
    this.index.clear();
    await this.index.init();

    const project = getProject();
    if (!project) return;

    const records: SymbolRecord[] = [];
    project.iterateFiles((path, data) => {
      if (typeof data !== 'string') return;
      const editorStyle = this.detectEditorStyle(path);
      const fileRecords = extractSymbols(data, path, editorStyle, 'project');
      records.push(...fileRecords);
    });

    this.index.pushRecords(records);
  }
}