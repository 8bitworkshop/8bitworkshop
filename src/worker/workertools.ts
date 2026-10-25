
import * as misc from './tools/misc'
import * as cc65 from './tools/cc65'
import * as dasm from './tools/dasm'
import * as sdcc from './tools/sdcc'
import * as verilog from './tools/verilog'
import * as m6809 from './tools/m6809'
import * as m6502 from './tools/m6502'
import * as z80 from './tools/z80'
import * as x86 from './tools/x86'
import * as arm from './tools/arm'
import * as ecs from './tools/ecs'
import * as remote from './tools/remote'
import * as acme from './tools/acme'
import * as cc7800 from './tools/cc7800'
import * as cc2600 from './tools/cc2600'
import * as bataribasic from './tools/bataribasic'
import * as oscar64 from './tools/oscar64'
import * as xa from './tools/xa'
import * as urust from './tools/urust'
import * as dialog from './tools/dialog'
import * as cvbasic from './tools/cvbasic'


export const TOOLS = {
  'dasm': dasm.assembleDASM,
  'acme': acme.assembleACME,
  'cc65': cc65.compileCC65,
  'ca65': cc65.assembleCA65,
  'ld65': cc65.linkLD65,
  //'z80asm': assembleZ80ASM,
  //'sccz80': compileSCCZ80,
  'sdasz80': sdcc.assembleSDASZ80,
  'sdasgb': sdcc.assembleSDASGB,
  'sdldz80': sdcc.linkSDLDZ80,
  'sdas6500': sdcc.assembleSDAS6500,
  'sdld6808': sdcc.linkSDLD6808,
  'sdcc': sdcc.compileSDCC,
  'xasm6809': m6809.assembleXASM6809,
  'cmoc': m6809.compileCMOC,
  'lwasm': m6809.assembleLWASM,
  'lwlink': m6809.linkLWLINK,
  //'naken': assembleNAKEN,
  'verilator': verilog.compileVerilator,
  'yosys': verilog.compileYosys,
  'jsasm': verilog.compileJSASMStep,
  'zmac': z80.assembleZMAC,
  'nesasm': m6502.assembleNESASM,
  'smlrc': x86.compileSmallerC,
  'yasm': x86.assembleYASM,
  'bataribasic': bataribasic.compileBatariBasic,
  'inform6': misc.compileInform6,
  'merlin32': m6502.assembleMerlin32,
  'fastbasic': m6502.compileFastBasic,
  'basic': misc.compileBASIC,
  'silice': verilog.compileSilice,
  'wiz': misc.compileWiz,
  'armips': arm.assembleARMIPS,
  'vasmarm': arm.assembleVASMARM,
  'ecs': ecs.assembleECS,
  'remote': remote.buildRemote,
  'cc7800': cc7800.compileCC7800,
  'cc2600': cc2600.compilecc2600,
  'armtcc': arm.compileARMTCC,
  'armtcclink': arm.linkARMTCC,
  'oscar64': oscar64.compileOscar64,
  'xa': xa.assembleXA,
  'urust': urust.compileUrust,
  'dialog': dialog.compileDialog,
  'cvbasic': cvbasic.compileCVBasic,
}
