// Parser registry - central place to map editorStyle -> parser for both editor and extractor.
// This keeps editors.ts and the indexer in sync.

import { StreamLanguage, StreamParser } from "@codemirror/language";
import { LanguageSupport } from "@codemirror/language";
import * as lang_c from "./lang-c";
import { asm6502 } from "./lang-6502";
import { asmZ80 } from "./lang-z80";
import { wiz, wizStreamParser } from "./lang-wiz";
import { verilog, verilogStreamParser } from "./lang-verilog";
import { inform6, inform6StreamParser } from "./lang-inform6";
import { dialog, dialogStreamParser } from "./lang-dialog";
import { uasm, uasmStreamParser } from "./lang-uasm";
import { basic, basicStreamParser } from "./lang-basic";
import { fastBasic, fastBasicStreamParser } from "./lang-fastbasic";
import { batariBasic, batariBasicStreamParser } from "./lang-bataribasic";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";

export type SymbolKind =
  | 'func' | 'macro' | 'type' | 'struct' | 'enum' | 'var'
  | 'label' | 'equate' | 'proc' | 'module' | 'doc';

export type SymbolSourceKind = 'project' | 'toolchain' | 'docs';

export interface SymbolRecord {
  id: string;
  name: string;
  kind: SymbolKind;
  signature?: string;
  brief?: string;
  detail?: string;
  section?: string;
  source: SymbolSourceKind;
  file: string;
  line?: number;
  url?: string;
}

export interface ToolDeclPattern { re: RegExp; group?: number; kind: SymbolKind; }

export interface ParserRegistryEntry {
  /** Language support for the editor (used by CodeMirror) */
  language: LanguageSupport;
  /** Raw StreamParser for the extractor (null if not available) */
  parser: StreamParser<any> | null;
}

export const parserRegistry: Record<string, ParserRegistryEntry> = {
  'text/x-csrc': {
    language: lang_c.c(),
    parser: null // Lezer-based, extracted via lrextract.ts
  },
  rust: {
    language: rust(),
    parser: null // Lezer-based, extracted via lrextract.ts
  },
  '6502': {
    language: asm6502(),
    parser: null // Lezer-based, extracted via lrextract.ts
  },
  z80: {
    language: asmZ80(),
    parser: null // Lezer-based, extracted via lrextract.ts
  },
  'text/x-wiz': {
    language: wiz(),
    parser: wizStreamParser
  },
  uasm: {
    language: uasm(),
    parser: uasmStreamParser
  },
  verilog: {
    language: verilog(),
    parser: verilogStreamParser
  },
  inform6: {
    language: inform6(),
    parser: inform6StreamParser
  },
  dialog: {
    language: dialog(),
    parser: dialogStreamParser
  },
  basic: {
    language: basic(),
    parser: basicStreamParser
  },
  fastbasic: {
    language: fastBasic(),
    parser: fastBasicStreamParser
  },
  bataribasic: {
    language: batariBasic(),
    parser: batariBasicStreamParser
  },
  markdown: {
    language: markdown(),
    parser: null
  },
  // Tier C - no parser available
  '6809': {
    language: null,
    parser: null
  },
  vasm: {
    language: null,
    parser: null
  },
  gas: {
    language: null,
    parser: null
  },
  ecs: {
    language: null,
    parser: null
  }
};

export function getParserForStyle(editorStyle: string): StreamParser<any> | null {
  const entry = parserRegistry[editorStyle];
  return entry?.parser ?? null;
}

export function getLanguageSupportForStyle(editorStyle: string): LanguageSupport | null {
  const entry = parserRegistry[editorStyle];
  return entry?.language ?? null;
}

export function getDefaultLanguageParser() {
  return lang_c.c();
}
