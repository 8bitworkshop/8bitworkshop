/*
 * Copyright (c) 2024 Steven E. Hugg
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

export var PLATFORM_PARAMS = {
    'vcs': {
      arch: '6502',
      code_start: 0x1000,
      code_size: 0xf000,
      data_start: 0x80,
      data_size: 0x80,
      wiz_rom_ext: '.a26',
      wiz_inc_dir: '2600',
      cfgfile: 'atari2600.cfg',
      libargs: ['crt0.o', 'atari2600.lib'],
      extra_link_files: ['crt0.o', 'atari2600.cfg'],
      // a hand-written ca65 program brings its own reset code and vectors, so
      // it links as a plain 4K cart with no C runtime (see applyAsmProjectParams)
      asm_cfgfile: 'atari2600-asm.cfg',
      asm_libargs: [],
      asm_extra_link_files: ['atari2600-asm.cfg'],
      // DASM's standard headers, which dasm programs include
      extra_compile_files: ['vcs.h', 'macro.h'],
      define: ['__ATARI2600__'],
    },
    'mw8080bw': {
      arch: 'z80',
      code_start: 0x0,
      rom_size: 0x2000,
      data_start: 0x2000,
      data_size: 0x400,
      stack_end: 0x2400,
    },
    'vicdual': {
      arch: 'z80',
      code_start: 0x0,
      rom_size: 0x4020,
      data_start: 0xe400,
      data_size: 0x400,
      stack_end: 0xe800,
    },
    'galaxian': {
      arch: 'z80',
      code_start: 0x0,
      rom_size: 0x4000,
      data_start: 0x4000,
      data_size: 0x400,
      stack_end: 0x4800,
    },
    'galaxian-scramble': {
      arch: 'z80',
      code_start: 0x0,
      rom_size: 0x5020,
      data_start: 0x4000,
      data_size: 0x400,
      stack_end: 0x4800,
    },
    'pacman': {
      arch: 'z80',
      code_start: 0x0,
      /* ABS CRT (_HEADER) ends ~0xCA; _CODE follows immediately (uses former hole). */
      codeseg_start: 0xca,
      rom_size: 0x8000,   // 16KB prog + 8KB gfx + palette, padded to 32KB
      /* Real hardware: 0x4800-0x4BFF open bus; work RAM 0x4C00-0x4FEF.
       * Namco sound soft-regs live at 0x4E8C-0x4EFB — keep _DATA below that
       * or the WSG engine stomps game vars every VBLANK (e.g. mouth anim). */
      data_start: 0x4c00,
      data_size: 0x28c,   // 0x4c00-0x4e8b (stop before sound soft-regs)
      stack_end: 0x4fc0,  // above sound block; sprite attrs at 0x4ff0-0x4fff
    },
    'williams': {
      arch: '6809',
      code_start: 0x0,
      rom_size: 0xc000,
      data_start: 0x9800,
      data_size: 0x2800,
      stack_end: 0xc000,
      set_stack_end: 0xc000,
      extra_link_files: ['williams.scr', 'libcmoc-crt-vec.a', 'libcmoc-std-vec.a'],
      extra_link_args: ['-swilliams.scr', '-lcmoc-crt-vec', '-lcmoc-std-vec'],
      extra_compile_files: ['assert.h','cmoc.h','stdarg.h','stdlib.h'],
      //extra_compile_args: ['--vectrex'],
    },
    'williams-defender': {
      arch: '6809',
      code_start: 0x0,
      rom_size: 0xc000,
      data_start: 0x9800,
      data_size: 0x2800,
      stack_end: 0xc000,
    },
    'williams-z80': {
      arch: 'z80',
      code_start: 0x0,
      rom_size: 0x9800,
      data_start: 0x9800,
      data_size: 0x2800,
      stack_end: 0xc000,
    },
    'vector-z80color': {
      arch: 'z80',
      code_start: 0x0,
      rom_size: 0x8000,
      data_start: 0xe000,
      data_size: 0x2000,
      stack_end: 0x0,
    },
    'vector-ataricolor': { //TODO
      arch: '6502',
      define: ['__VECTOR__'],
      cfgfile: 'vector-color.cfg',
      libargs: ['crt0.o', 'none.lib'],
      extra_link_files: ['crt0.o', 'vector-color.cfg'],
    },
    'sound_williams-z80': {
      arch: 'z80',
      code_start: 0x0,
      rom_size: 0x4000,
      data_start: 0x4000,
      data_size: 0x400,
      stack_end: 0x8000,
    },
    'base_z80': {
      arch: 'z80',
      code_start: 0x0,
      rom_size: 0x8000,
      data_start: 0x8000,
      data_size: 0x8000,
      stack_end: 0x0,
    },
    'coleco': {
      arch: 'z80',
      rom_start: 0x8000,
      code_start: 0x8100,
      rom_size: 0x8000,
      data_start: 0x7000,
      data_size: 0x400,
      stack_end: 0x8000,
      extra_preproc_args: ['-I', '/share/include/coleco', '-D', 'CV_CV'],
      extra_link_args: ['-k', '/share/lib/coleco', '-l', 'libcv', '-l', 'libcvu', 'crt0.rel'],
    },
    'msx': {
      arch: 'z80',
      rom_start: 0x4000,
      code_start: 0x4000,
      rom_size: 0x8000,
      data_start: 0xc000,
      data_size: 0x3000,
      stack_end: 0xffff,
      extra_link_args: ['crt0-msx.rel'],
      extra_link_files: ['crt0-msx.rel', 'crt0-msx.lst'],
      wiz_sys_type: 'z80',
      wiz_inc_dir: 'msx',
    },
    'msx-libcv': {
      arch: 'z80',
      rom_start: 0x4000,
      code_start: 0x4000,
      rom_size: 0x8000,
      data_start: 0xc000,
      data_size: 0x3000,
      stack_end: 0xffff,
      extra_preproc_args: ['-I', '.', '-D', 'CV_MSX'],
      extra_link_args: ['-k', '.', '-l', 'libcv-msx', '-l', 'libcvu-msx', 'crt0-msx.rel'],
      extra_link_files: ['libcv-msx.lib', 'libcvu-msx.lib', 'crt0-msx.rel', 'crt0-msx.lst'],
      extra_compile_files: ['cv.h','cv_graphics.h','cv_input.h','cv_sound.h','cv_support.h','cvu.h','cvu_c.h','cvu_compression.h','cvu_f.h','cvu_graphics.h','cvu_input.h','cvu_sound.h'],
    },
    'sms-sg1000-libcv': {
      arch: 'z80',
      rom_start: 0x0000,
      code_start: 0x0100,
      rom_size: 0xc000,
      data_start: 0xc000,
      data_size: 0x400,
      stack_end: 0xe000,
      extra_preproc_args: ['-I', '.', '-D', 'CV_SMS'],
      extra_link_args: ['-k', '.', '-l', 'libcv-sms', '-l', 'libcvu-sms', 'crt0-sms.rel'],
      extra_link_files: ['libcv-sms.lib', 'libcvu-sms.lib', 'crt0-sms.rel', 'crt0-sms.lst'],
      extra_compile_files: ['cv.h','cv_graphics.h','cv_input.h','cv_sound.h','cv_support.h','cvu.h','cvu_c.h','cvu_compression.h','cvu_f.h','cvu_graphics.h','cvu_input.h','cvu_sound.h'],
    },
    'nes': { //TODO
      arch: '6502',
      define: ['__NES__'],
      cfgfile: 'neslib2.cfg',
      libargs: ['crt0.o', 'nes.lib', 'neslib2.lib',
        '-D', 'NES_MAPPER=0', // NROM
        '-D', 'NES_PRG_BANKS=2', // 2 16K PRG banks
        '-D', 'NES_CHR_BANKS=1', // 1 CHR bank
        '-D', 'NES_MIRRORING=0', // horizontal mirroring
        ],
      extra_link_files: ['crt0.o', 'neslib2.lib', 'neslib2.cfg', 'nesbanked.cfg'],
      extra_compile_files: ['neslib.h'],
      // source link symbol -> linker config (was hardcoded in fixParamsWithDefines)
      symbolConfigs: { NES_MAPPER: { '4': 'nesbanked.cfg' } },
      // iNES header and CHR data are not in CPU address space
      ignore_segments: ['HEADER', 'CHARS'],
      wiz_rom_ext: '.nes',
    },
    'apple2': {
      arch: '6502',
      define: ['__APPLE2__'],
      cfgfile: 'apple2.cfg',
      libargs: [ '--lib-path', '/share/target/apple2/drv', 'apple2.lib'],
      __CODE_RUN__: 16384,
      code_start: 0x803,
      // for SDCC (-sdcc.c): a DOS 3.3 binary at $803 with data above the program
      rom_size: 0x9400 - 0x803,
      data_start: 0x9400,
      zp_start: 0x60,
      load_header: 'dos33',
      acmeargs: ['-f', 'apple'],
    },
    'apple2-e': {
      arch: '6502',
      define: ['__APPLE2__'],
      cfgfile: 'apple2.cfg',
      libargs: ['apple2.lib'],
      acmeargs: ['-f', 'apple'],
    },
    'atari8-800xl.disk': {
      arch: '6502',
      define: ['__ATARI__'],
      cfgfile: 'atari.cfg',
      libargs: ['atari.lib'],
      fastbasic_cfgfile: 'fastbasic-cart.cfg',
      // XEX file headers and trailer are not in CPU address space
      ignore_segments: ['EXEHDR', 'SYSCHKHDR', 'SYSCHKTRL', 'MAINHDR', 'AUTOSTRT'],
    },
    'atari8-800xl': {
      arch: '6502',
      define: ['__ATARI__'],
      cfgfile: 'atari-cart.cfg',
      libargs: ['atari.lib', '-D', '__CARTFLAGS__=4'],
      fastbasic_cfgfile: 'fastbasic-cart.cfg',
    },
    'atari8-800': {
      arch: '6502',
      define: ['__ATARI__'],
      cfgfile: 'atari-cart.cfg',
      libargs: ['atari.lib', '-D', '__CARTFLAGS__=4'],
      fastbasic_cfgfile: 'fastbasic-cart.cfg',
    },
    'atari8-5200': {
      arch: '6502',
      define: ['__ATARI5200__'],
      cfgfile: 'atari5200.cfg',
      libargs: ['atari5200.lib', '-D', '__CARTFLAGS__=255'],
      fastbasic_cfgfile: 'fastbasic-cart.cfg',
    },
    'verilog': {
      arch: 'verilog',
      extra_compile_files: ['8bitworkshop.v'],
    },
    'astrocade': {
      arch: 'z80',
      code_start: 0x2000,
        rom_size: 0x2000,
      data_start: 0x4e10,
       data_size: 0x1f0,
       stack_end: 0x5000,
    },
    'astrocade-arcade': {
      arch: 'z80',
      code_start: 0x0000,
        rom_size: 0x4000,
      data_start: 0x7de0,
       data_size: 0x220,
       stack_end: 0x8000,
    },
    'astrocade-bios': {
      arch: 'z80',
      code_start: 0x0000,
        rom_size: 0x2000,
      data_start: 0x4fce,
       data_size: 50,
       stack_end: 0x4fce,
    },
    'atari7800': {
      arch: '6502',
      define: ['__ATARI7800__'],
      cfgfile: 'atari7800.cfg',
      libargs: ['crt0.o', 'none.lib'],
      extra_link_files: ['crt0.o', 'atari7800.cfg'],
    },
    'c64': {
      arch: '6502',
      define: ['__CBM__', '__C64__'],
      cfgfile: 'c64.cfg', // SYS 2061
      libargs: ['openroms-compat.o', 'c64.lib'],
      extra_link_files: ['openroms-compat.o'],
      // for SDCC (-sdcc.c): a PRG with a BASIC SYS stub, code at $80D, data in upper RAM
      code_start: 0x80d,
      rom_size: 0xa000 - 0x80d,
      data_start: 0xc000,
      zp_start: 0x2,
      load_header: 'prg',
      acmeargs: ['-f', 'cbm'],
      //extra_link_files: ['c64-cart.cfg'],
    },
    'vic20': {
      arch: '6502',
      define: ['__CBM__', '__VIC20__'],
      cfgfile: 'vic20.cfg',
      libargs: ['vic20.lib'],
      acmeargs: ['-f', 'cbm'],
      //extra_link_files: ['c64-cart.cfg'],
    },
    'kim1': {
      arch: '6502',
    },
    'vectrex': {
      arch: '6809',
      code_start: 0x0,
      rom_size: 0x8000,
      data_start: 0xc880,
      data_size: 0x380,
      stack_end: 0xcc00,
      extra_compile_files: ['assert.h','cmoc.h','stdarg.h','vectrex.h','stdlib.h','bios.h'],
      extra_link_files: ['vectrex.scr', 'libcmoc-crt-vec.a', 'libcmoc-std-vec.a'],
      extra_compile_args: ['--vectrex'],
      extra_link_args: ['-svectrex.scr', '-lcmoc-crt-vec', '-lcmoc-std-vec'],
    },
    'coco': {
      // Tandy Color Computer 1/2: cmoc's Extended Color BASIC (ecb) target,
      // linked as a DECB .bin that the emulator loads straight into RAM.
      arch: '6809',
      code_start: 0x2800,   // cmoc's default for a DECB program (above the PMODE pages)
      rom_size: 0x5800,     // $2800-$7FFF
      stack_end: 0x7f00,
      link_format: 'decb',
      // cmoc's own headers say #include <cmoc.h>; the library files sit in mcpp's cwd.
      // coco.h hides everything unless _COCO_BASIC_ is set, which cmoc defines
      // for itself but mcpp (which runs first) has to be told.
      extra_preproc_args: ['-I', '.', '-D', '_COCO_BASIC_=1', '-D', '_CMOC_VERSION_=1067'],
      extra_compile_files: ['assert.h','cmoc.h','coco.h','stdarg.h'],
      extra_link_files: ['coco.scr', 'libcmoc-crt-ecb.a', 'libcmoc-std-ecb.a'],
      extra_link_args: ['-scoco.scr', '-lcmoc-crt-ecb', '-lcmoc-std-ecb'],
    },
    'x86': {
      arch: 'x86',
    },
    'zx': {
      arch: 'z80',
      code_start: 0x5ccb,
      rom_size: 0xff58-0x5ccb,
      data_start: 0xf000,
      data_size: 0xfe00-0xf000,
      stack_end: 0xff58,
      extra_link_args: ['crt0-zx.rel'],
      extra_link_files: ['crt0-zx.rel', 'crt0-zx.lst'],
    },
    'devel-6502': {
      arch: '6502',
      cfgfile: 'devel-6502.cfg',
      libargs: ['crt0.o', 'none.lib'],
      extra_link_files: ['crt0.o', 'devel-6502.cfg'],
      // for SDCC (-sdcc.c): ROM at $8000 with vectors at $FFFA, data above zero page
      code_start: 0x8000,
      rom_size: 0x8000,
      data_start: 0x200,
    },
    // https://github.com/cpcitor/cpc-dev-tool-chain
    'cpc.rslib': {
      arch: 'z80',
      code_start: 0x4000,
      rom_size: 0xb100-0x4000,
      data_start: 0xb100,
      data_size: 0xb100-0xc000,
      stack_end: 0xc000,
      extra_compile_files: ['cpcrslib.h'],
      extra_link_args: ['crt0-cpc.rel', 'cpcrslib.lib'],
      extra_link_files: ['crt0-cpc.rel', 'crt0-cpc.lst', 'cpcrslib.lib', 'cpcrslib.lst'],
    },
    // https://lronaldo.github.io/cpctelera/ (TODO)
    'cpc': {
      arch: 'z80',
      code_start: 0x4000,
      rom_size: 0xb100-0x4000,
      data_start: 0xb100,
      data_size: 0xb100-0xc000,
      stack_end: 0xc000,
      extra_compile_files: ['cpctelera.h'],
      extra_link_args: ['crt0-cpc.rel', 'cpctelera.lib'],
      extra_link_files: ['crt0-cpc.rel', 'crt0-cpc.lst', 'cpctelera.lib', 'cpctelera.lst'],
    },
    'pce': {
      arch: 'huc6280',
      define: ['__PCE__'],
      cfgfile: 'pce.cfg',
      libargs: ['pce.lib', '-D', '__CARTSIZE__=0x8000'],
    },
    'exidy': {
      define: ['__EXIDY__'],
      cfgfile: 'exidy.cfg',
      libargs: ['crt0.o', 'none.lib'],
      extra_link_files: ['crt0.o', 'exidy.cfg'],
      //extra_compile_files: ['exidy.h'],
    },
    'arm32': {
      arch: 'arm32',
      define: ['__ARM__', 'DISABLE_UNIMPLEMENTED_LIBC_APIS', 'PRINTF_ALIAS_STANDARD_FUNCTION_NAMES_SOFT'],
      extra_compile_args: ['-I./arch/arm/include', '-I./openlibm/include', '-I./openlibm/src', '-I./printf/src'],
      extra_link_files: ['crt0.c', 'libc.a'],
      extra_link_args: ['crt0.c', '-lc'],
    },
    'gb': {
      arch: 'gbz80',
      code_start: 0x0,      // ROM starts @ 0x0, header @ 0x100, etc.
      codeseg_start: 0x200, // _CODE area starts here
      rom_size: 0x8000,     // grows to fit the highest bank
      rom_banking: { size: 0x4000, window: 0x4000 }, // #pragma bank N -> _CODE_N @ 0xN4000
      data_start: 0xc0a0,
      data_size: 0x1f60,
      stack_end: 0xe000,
      extra_link_files: ['gbz80.lib', 'gb.lib', 'sfr.rel', 'sfr.lst', 'crt0.rel', 'crt0.lst'],
      // GBDK runtime, from crt0.sgb and sfr.sgb (see src/worker/lib/gb/Makefile)
      startup_objs: ['sfr.rel', 'crt0.rel'],
      // an assembly program (gingerbread.sgb) brings its own header and vectors
      asm_startup_objs: [],
      // GBDK 4.0.6 headers for gb.lib (#include "gb/gb.h")
      extra_compile_files: ['gb/bgb_emu.h', 'gb/cgb.h', 'gb/crash_handler.h', 'gb/drawing.h',
        'gb/emu_debug.h', 'gb/gb.h', 'gb/gbdecompress.h', 'gb/hardware.h', 'gb/isr.h',
        'gb/metasprites.h', 'gb/sgb.h', 'gb/types.h'],
      extra_link_args: [
        '-l', 'gb',
        '-g', '_shadow_OAM=0xC000',
        '-g', '.STACK=0xE000',
        '-g', '.refresh_OAM=0xFF80',
        '-g', 'GB_MAPPER=0x0',
        '-g', 'GB_ROM_SIZE=0x0',
        '-g', 'GB_RAM_SIZE=0x0',
        '-g', 'GB_CGB_FLAGS=0x0',
      ],
      wiz_sys_type: 'gb',
      wiz_inc_dir: 'gb',
    },
    'mcr': {
      arch: 'z80',
      code_start: 0x0,
      rom_size: 0xe000 + 0x4000 + 0x8000,
      data_start: 0xe000,
      data_size: 0x800,
      stack_end: 0xe800,
      // TODO: IHX can't handle > 64 KB, so ihx2sms looks for segments in a certain order
    },
};
  
// SMS/GG mode-4 variants of the shared libcv common.[ch] (2 bytes per tile, 32x28)
PLATFORM_PARAMS['sms-sms-libcv'] = {
  ...PLATFORM_PARAMS['sms-sg1000-libcv'],
  extra_preproc_args: ['-I', '.', '-D', 'CV_SMS', '-D', 'CV_MODE4']
};

PLATFORM_PARAMS['sms-gg-libcv'] = PLATFORM_PARAMS['sms-sms-libcv'];

PLATFORM_PARAMS['gb.color'] = {
  ...PLATFORM_PARAMS['gb'],
  extra_link_args: PLATFORM_PARAMS['gb'].extra_link_args.map(arg => arg === 'GB_CGB_FLAGS=0x0' ? 'GB_CGB_FLAGS=0x80' : arg)
}
