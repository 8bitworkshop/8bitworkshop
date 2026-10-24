// presetindex - writes out/presets.json: every platform the extension offers,
// its templates (the IDE's examples plus a blank program per skeleton), the
// files each template reads, and the header table platform detection uses.
// Bundled by build.mjs and run after the build:
//
//   node out/presetindex.js [rootDir] [outFile]

import * as fs from 'fs';
import * as path from 'path';
import { importPlatform } from '../../src/platform/_index';
import { PLATFORMS } from '../../src/common/emu';
import { installNodeMocks } from '../../src/tools/emutarget';
import { getToolForPlatform } from '../../src/common/toolselect';
import { REMOTE_BUILDS } from '../src/projectinfo';
import { TOOL_META, getSkeletonName } from '../../src/common/toolmeta';
import { getBasePlatform, getRootBasePlatform, isProbablyBinary } from '../../src/common/util';
import { resolveDependencies } from '../../src/common/projectcore';
import { headersFromPresets } from '../../src/common/detect';
import { EXTENSION_SKIP_FAMILIES, EXTENSION_SKIP_PLATFORMS } from '../../src/tools/exclusions';
import type { PresetIndex, TemplateInfo } from '../../src/tools/presettypes';

const rootDir = path.resolve(process.argv[2] || path.join(__dirname, '../..'));
const outFile = path.resolve(process.argv[3] || path.join(__dirname, 'presets.json'));
const presetsDir = path.join(rootDir, 'presets');

/** The IDE's platform menu: [family, id, name], in menu order. */
function readPlatformMenu(): [string, string, string][] {
  // strip HTML comments: commented-out menu entries (e.g. vectrex) aren't offered
  var html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8').replace(/<!--[\s\S]*?-->/g, '');
  var out: [string, string, string][] = [];
  var family = '';
  var re = /href="javascript:void\(0\)">([^<]+)<|href="\?platform=([^"&]+)">([^<]+)</g;
  var m: RegExpExecArray | null;
  while ((m = re.exec(html)) != null) {
    if (m[1]) family = m[1].trim();
    else if (family) out.push([family, m[2], m[3].replace(/&amp;/g, '&').trim()]);
  }
  return out;
}

/** The ROM file extension the platform's builds produce, for export. */
function defaultROMExtension(plat: any): string {
  try {
    return (plat.getROMExtension && plat.getROMExtension(null)) || '.bin';
  } catch (e) {
    return '.bin';
  }
}

function language(tool: string): string {
  var meta = TOOL_META[tool];
  var style = meta && meta.editorStyle || '';
  if (/csrc/.test(style)) return 'C';
  if (/c\+\+/.test(style)) return 'C++';
  if (/basic/i.test(style) || /basic/i.test(tool)) return 'BASIC';
  if (/verilog/.test(style)) return 'Verilog';
  if (/rust/.test(style)) return 'Rust';
  if (meta && meta.kind === 'assembler') return 'assembly';
  return meta ? meta.name : tool;
}

/** The name a blank program gets: main + an extension that picks this tool. */
function blankFileName(platform: string, tool: string, defaultExts: string[]): string | null {
  var meta = TOOL_META[tool];
  var exts = (meta && meta.extensions || []).concat(defaultExts);
  for (var ext of exts) {
    if (ext === '.h' || ext === '.inc') continue;
    if (getToolForPlatform(platform, 'main' + ext) === tool) return 'main' + ext;
  }
  return null;
}

async function templatesFor(platform: string, plat: any): Promise<TemplateInfo[]> {
  var dir = getBasePlatform(platform);
  var read = (rel: string) => {
    var p = path.join(presetsDir, dir, rel);
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
    return isProbablyBinary(rel) ? new Uint8Array(fs.readFileSync(p)) : fs.readFileSync(p, 'utf-8');
  };
  var getTool = (fn: string) => getToolForPlatform(platform, fn);
  var templates: TemplateInfo[] = [];

  // blank programs first: one per tool the platform offers with a skeleton
  var defaultExts: string[] = plat.getDefaultExtensions ? plat.getDefaultExtensions() : [];
  var seenTools = new Set<string>();
  for (var ext of defaultExts) {
    var tool = getTool('main' + ext);
    if (!tool || seenTools.has(tool) || tool.startsWith('remote:')) continue;
    seenTools.add(tool);
    var skel = 'skeleton.' + getSkeletonName(tool);
    if (read(skel) == null) continue;
    var name = blankFileName(platform, tool, defaultExts);
    if (!name) continue;
    templates.push({
      id: skel, name: `Blank ${language(tool)} program (${TOOL_META[tool]?.name || tool})`,
      category: 'Start here', tool, saveAs: name, files: [], shared: [],
    });
  }

  var presets: { id: string, name: string, category?: string }[] = plat.getPresets ? plat.getPresets() : [];
  var category = '';
  for (var preset of presets) {
    // the IDE puts a category on the first preset of each group
    if (preset.category) category = preset.category;
    var text = read(preset.id);
    if (typeof text !== 'string') continue;
    var tool = getTool(preset.id);
    if (tool.startsWith('remote:') && !REMOTE_BUILDS) continue;
    var deps = await resolveDependencies({ readFile: async (p: string) => read(p) }, preset.id, text, platform, getTool);
    templates.push({
      id: preset.id, name: preset.name, category: category || 'Examples', tool,
      remote: tool.startsWith('remote:') || undefined,
      files: deps.map(d => d.path), shared: [],
    });
  }

  // a file more than one template reads is a library: it resolves from the
  // presets directory unless the user asks for a copy
  var uses = new Map<string, number>();
  for (var t of templates) for (var f of t.files) uses.set(f, (uses.get(f) || 0) + 1);
  for (var t of templates) {
    t.shared = t.files.filter(f => uses.get(f)! > 1);
    t.files = t.files.filter(f => uses.get(f)! <= 1);
  }
  return templates;
}

async function main() {
  installNodeMocks(rootDir);
  var index: PresetIndex = { version: 1, platforms: [], headers: {} };
  var listing: { [platform: string]: string[] } = {};
  for (var [family, id, name] of readPlatformMenu()) {
    if (EXTENSION_SKIP_FAMILIES.includes(family)) continue;
    if (EXTENSION_SKIP_PLATFORMS.includes(id)) continue;
    var dir = getBasePlatform(id);
    if (!fs.existsSync(path.join(presetsDir, dir))) continue;
    try {
      await importPlatform(getRootBasePlatform(id));
      var cls = PLATFORMS[id] || PLATFORMS[dir] || PLATFORMS[getRootBasePlatform(id)];
      if (!cls) throw new Error('not registered');
      var plat = new cls(null);
      var templates = await templatesFor(id, plat);
    } catch (e) {
      console.error(`presetindex: skipping ${id}: ${e && e.message || e}`);
      continue;
    }
    index.platforms.push({ id, name, family, dir, romext: defaultROMExtension(plat), templates });
    listing[dir] = fs.readdirSync(path.join(presetsDir, dir));
  }
  index.headers = headersFromPresets(listing);
  fs.writeFileSync(outFile, JSON.stringify(index));
  var count = index.platforms.reduce((n, p) => n + p.templates.length, 0);
  console.error(`presetindex: ${index.platforms.length} platforms, ${count} templates -> ${path.relative(process.cwd(), outFile)}`);
  // emulator libraries leave timers behind
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
