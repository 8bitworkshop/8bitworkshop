// hard-code platform files for esbuild code-splitting

export function importPlatform(name: string) : Promise<any> {
    switch (name) {
      case "apple2": return import("../platform/apple2");
      case "arm32": return import("../platform/arm32");
      case "astrocade": return import("../platform/astrocade");
      case "atari7800": return import("../platform/atari7800");
      case "atari8": return import("../platform/atari8");
      case "basic": return import("../platform/basic");
      case "c64": return import("../platform/c64");
      case "channelf": return import("../platform/channelf");
      case "coleco": return import("../platform/coleco");
      case "coco": return import("../platform/coco");
      case "cpc": return import("../platform/cpc");
      case "devel": return import("../platform/devel");
      case "exidy": return import("../platform/exidy");
      case "galaxian": return import("../platform/galaxian");
      case "gb": return import("../platform/gb");
      case "gameboy": return import("../platform/gb");
      case "kim1": return import("../platform/kim1");
      case "mcr": return import("../platform/mcr");
      case "msx": return import("../platform/msx");
      case "mw8080bw": return import("../platform/mw8080bw");
      case "nes": return import("../platform/nes");
      case "pacman": return import("../platform/pacman");
      case "pce": return import("../platform/pce");
      case "sms": return import("../platform/sms");
      case "sound_konami": return import("../platform/sound_konami");
      case "sound_williams": return import("../platform/sound_williams");
      case "vcs": return import("../platform/vcs");
      case "vector": return import("../platform/vector");
      case "vectrex": return import("../platform/vectrex");
      case "verilog": return import("../platform/verilog");
      case "vic20": return import("../platform/vic20");
      case "vicdual": return import("../platform/vicdual");
      case "williams": return import("../platform/williams");
      case "x86": return import("../platform/x86");
      case "zmachine": return import("../platform/zmachine");
      case "zx": return import("../platform/zx");
      default: throw new Error(`Platform not recognized: '${name}'`)
    }
  }
  
  