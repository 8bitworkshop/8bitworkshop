
import { MOS6502, MOS6502PatchContext } from "./MOS6502";

// 65C02 opcode-table patch, covering the subset implemented by the WDC 65SC02
// (used by the Atari Lynx): new addressing mode + instructions, plus the fixed
// JMP ($xxFF) page-wrap bug. Does NOT include the Rockwell bit instructions
// (BBR/BBS/RMB/SMB) or WDC-only WAI/STP, which the 65SC02 lacks.
//
// This overrides slots in place on the arrays/builders handed to it by
// _MOS6502 -- it never duplicates the base opcode tables.
export function patch65C02(ctx: MOS6502PatchContext) {
    function set(op: number, mnemonic: string, instruction: (() => void)[], cycles: number, extra: number, length: number) {
        ctx.opcodes[op] = mnemonic;
        ctx.instructions[op] = instruction;
        ctx.cycletime[op] = cycles;
        ctx.extracycles[op] = extra;
        ctx.insnlengths[op] = length;
        ctx.validinsns[op] = length;
    }

    // New "(zp)" addressing mode (indirect, no index)
    set(0x12, "ORA", ctx.ORA(ctx.zeroPageIndirectRead), 5, 0, 2);
    set(0x32, "AND", ctx.AND(ctx.zeroPageIndirectRead), 5, 0, 2);
    set(0x52, "EOR", ctx.EOR(ctx.zeroPageIndirectRead), 5, 0, 2);
    set(0x72, "ADC", ctx.ADC(ctx.zeroPageIndirectRead), 5, 0, 2);
    set(0x92, "STA", ctx.STA(ctx.zeroPageIndirectWrite), 5, 0, 2);
    set(0xb2, "LDA", ctx.LDA(ctx.zeroPageIndirectRead), 5, 0, 2);
    set(0xd2, "CMP", ctx.CMP(ctx.zeroPageIndirectRead), 5, 0, 2);
    set(0xf2, "SBC", ctx.SBC(ctx.zeroPageIndirectRead), 5, 0, 2);

    // TSB / TRB
    set(0x04, "TSB", ctx.TSB(ctx.zeroPageReadModifyWrite), 5, 0, 2);
    set(0x0c, "TSB", ctx.TSB(ctx.absoluteReadModifyWrite), 6, 0, 3);
    set(0x14, "TRB", ctx.TRB(ctx.zeroPageReadModifyWrite), 5, 0, 2);
    set(0x1c, "TRB", ctx.TRB(ctx.absoluteReadModifyWrite), 6, 0, 3);

    // BIT gains immediate (Z only) and indexed addressing
    set(0x89, "BIT", ctx.BIT_IMM(ctx.immediateRead), 2, 0, 2);
    set(0x34, "BIT", ctx.BIT(ctx.zeroPageIndexedRead(ctx.rX)), 4, 0, 2);
    set(0x3c, "BIT", ctx.BIT(ctx.absoluteIndexedRead(ctx.rX)), 4, 1, 3);

    // STZ
    set(0x64, "STZ", ctx.STZ(ctx.zeroPageWrite), 3, 0, 2);
    set(0x74, "STZ", ctx.STZ(ctx.zeroPageIndexedWrite(ctx.rX)), 4, 0, 2);
    set(0x9c, "STZ", ctx.STZ(ctx.absoluteWrite), 4, 0, 3);
    set(0x9e, "STZ", ctx.STZ(ctx.absoluteIndexedWrite(ctx.rX)), 5, 0, 3);

    // Stack / accumulator ops
    set(0x5a, "PHY", ctx.PHY(), 3, 0, 1);
    set(0x7a, "PLY", ctx.PLY(), 4, 0, 1);
    set(0xda, "PHX", ctx.PHX(), 3, 0, 1);
    set(0xfa, "PLX", ctx.PLX(), 4, 0, 1);
    set(0x1a, "INC", ctx.INC_ACC(), 2, 0, 1);
    set(0x3a, "DEC", ctx.DEC_ACC(), 2, 0, 1);

    // Branch always / indexed indirect jump / fixed indirect jump
    set(0x80, "BRA", ctx.BRA(), 2, 2, 2);
    set(0x7c, "JMP", ctx.JMP_ABS_X(), 6, 0, 3);
    set(0x6c, "JMP", ctx.JMP_IND_CMOS(), 6, 0, 3); // fixes NMOS page-wrap bug, +1 cycle

    // Remaining former-KIL slots become 2-byte/2-cycle NOPs on 65C02 (no opcode halts the CPU)
    for (const op of [0x02, 0x22, 0x42, 0x62]) {
        set(op, "NOP", ctx.immediateRead(function() {}), 2, 0, 2);
    }

    // Note: the other ex-"unofficial" NMOS opcodes (uSLO/uANC/uNOP/etc.) are left as-is.
    // They're all reserved multi-byte NOPs on real 65C02 hardware, but no assembler emits
    // them and they never halt, so getting their exact byte length/cycle count right is
    // low priority -- revisit if disassembling real-world 65C02 ROMs turns out to need it.
}

export class MOS65C02 extends MOS6502 {
    constructor() {
        super(patch65C02);
    }
}
