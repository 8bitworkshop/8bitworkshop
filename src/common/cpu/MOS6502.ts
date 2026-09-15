
import { CPU, Bus, ClockBased, SavesState, Interruptable } from "../devices";
import { EmuHalt } from "../emu";
import { hex } from "../util";

// Copyright 2015 by Paulo Augusto Peccin. See license.txt distributed with this file.

// Passed to a variant's patch function (see MOS65C02.ts) so it can override specific
// opcode-table slots in place -- these are the live arrays/builders, not copies.
export interface MOS6502PatchContext {
    opcodes: string[];
    instructions: (() => void)[][];
    cycletime: number[];
    extracycles: number[];
    insnlengths: number[];
    validinsns: number[];
    rX: number;
    rY: number;
    [name: string]: any; // addressing-mode and operation builder functions
}

export var _MOS6502 = function(patchFn?: (ctx: MOS6502PatchContext) => void) {
    var self = this;

    this.powerOn = function() {
        this.reset();
    };

    this.powerOff = function() {
    };

    this.clockPulse = function() {
        if (!RDY) return;      // TODO Should be ignored in the last cycle of the instruction
        T++;
        instruction[T]();
    };

    this.connectBus = function(aBus) {
        bus = aBus;
    };

    this.setRDY = function(boo) {
        RDY = boo;
    };

    this.isRDY = function() {
        return RDY;
    }

    this.reset = function() {
        I = 1;
        T = -1;
        instruction = [ fetchOpcodeAndDecodeInstruction ];    // Bootstrap instruction
        PC = bus.read(RESET_VECTOR) | (bus.read(RESET_VECTOR + 1) << 8);
        this.setRDY(true);
    };

    // Interfaces
    var bus : Bus;
    var RDY : boolean = false;

    // Registers
    var PC : number = 0;
    var SP : number = 0;
    var A : number = 0;
    var X : number = 0;
    var Y : number = 0;

    // Status Bits
    var N : number = 0;
    var V : number = 0;
    var D : number = 0;
    var I : number = 0;
    var Z : number = 0;
    var C : number = 0;

    // Internal decoding registers
    var T : number = -1;
    var opcode : number = -1;
    var instruction : (() => void)[];
    var data : number = 0;
    var AD : number = 0;
    var BA : number = 0;
    var BALCrossed : boolean = false;
    var IA : number = 0;
    var branchOffset : number = 0;
    var branchOffsetCrossAdjust : number = 0;

    // Vectors
    const NMI_VECTOR = 0xfffa;
    const RESET_VECTOR = 0xfffc;
    const IRQ_VECTOR = 0xfffe;

    // Index registers names
    const rX = 0;
    const rY = 1;

    // Status bits names
    const bN = 7;
    const bV = 6;
    // const bE = 5;	// Not used
    // const bB = 4;	// Not used
    // const bD = 3;  // Not used
    // const bI = 2;  // Not used
    const bZ = 1;
    const bC = 0;

    // Auxiliary variables
    // TODO
    //noinspection JSUnusedGlobalSymbols
    this.debug = false;
    //noinspection JSUnusedGlobalSymbols
    this.trace = false;


    // Internal operations

    var fetchOpcodeAndDecodeInstruction = function() {
        opcode = bus.read(PC);
        instruction = instructions[opcode];
        T = 0;

        // if (self.trace) self.breakpoint("TRACE");
        // console.log("PC: " + PC + ", op: " + opcode + ": " + opcodes[opcode]);

        PC++;
    };

    var fetchNextOpcode = fetchOpcodeAndDecodeInstruction;

    var fetchOpcodeAndDiscard = function() {
        bus.read(PC);
    };

    var fetchBranchOffset = function() {
        branchOffset = bus.read(PC);
        PC++;
    };

    var fetchADL = function() {
        AD = bus.read(PC);
        PC++;
    };

    var fetchADH = function() {
        AD |= bus.read(PC) << 8;
        PC++;
    };

    var fetchADLFromBA = function() {
        AD = bus.read(BA);
    };

    var fetchADHFromBA = function() {
        AD |= bus.read(BA) << 8;
    };

    var fetchBAL = function() {
        BA = bus.read(PC);
        PC++;
    };

    var fetchBAH = function() {
        BA |= bus.read(PC) << 8;
        PC++;
    };

    var fetchBALFromIA = function() {
        BA = bus.read(IA);
    };

    var fetchBAHFromIA = function() {
        BA |= bus.read(IA) << 8;
    };

    var addXtoBAL = function() {
        var low = (BA & 255) + X;
        BALCrossed = low > 255;
        BA = (BA & 0xff00) | (low & 255);
    };

    var addYtoBAL = function() {
        var low = (BA & 255) + Y;
        BALCrossed = low > 255;
        BA = (BA & 0xff00) | (low & 255);
    };

    var add1toBAL = function() {
        var low = (BA & 255) + 1;
        BALCrossed = low > 255;
        BA = (BA & 0xff00) | (low & 255);
    };

    var add1toBAHifBALCrossed = function() {
        if (BALCrossed)
            BA = (BA + 0x0100) & 0xffff;
    };

    var fetchIAL = function() {
        IA = bus.read(PC);
        PC++;
    };

    var fetchIAH = function() {
        IA |= bus.read(PC) << 8;
        PC++;
    };

    var add1toIAL = function() {
        var low = (IA & 255) + 1;
        IA = (IA & 0xff00) | (low & 255);
    };

    var fetchDataFromImmediate = function() {
        data = bus.read(PC);
        PC++;
    };

    var fetchDataFromAD = function() {
        data = bus.read(AD);
    };

    var fetchDataFromBA = function() {
        data = bus.read(BA);
    };

    var writeDataToAD = function() {
        bus.write(AD, data);
    };

    var writeDataToBA = function() {
        bus.write(BA, data);
    };

    var addBranchOffsetToPCL = function() {
        var oldLow = (PC & 0x00ff);
        var newLow = (oldLow + branchOffset) & 255;
        // Negative offset?
        if (branchOffset > 127)
            branchOffsetCrossAdjust = (newLow > oldLow) ? -0x0100 : 0;
        else
            branchOffsetCrossAdjust = (newLow < oldLow) ? 0x0100 : 0;
        PC = (PC & 0xff00) | newLow;
    };

    var adjustPCHForBranchOffsetCross = function() {
        PC = (PC + branchOffsetCrossAdjust) & 0xffff;
    };

    var setZ = function(val) {
        Z = (val === 0) ? 1 : 0;
    };

    var setN = function(val) {
        N = (val & 0x080) ? 1 : 0;
    };

    var setV = function(boo) {
        V = boo ? 1 : 0;
    };

    var setC = function(boo) {
        C = boo ? 1 : 0;
    };

    var popFromStack = function() {
        SP = (SP + 1) & 255;
        return bus.read(0x0100 + SP);
    };

    var peekFromStack = function() {
        return bus.read(0x0100 + SP);
    };

    var pushToStack = function(val) {
        bus.write(0x0100 + SP, val);
        SP = (SP - 1) & 255;
    };

    var getStatusBits = function() {
        return N << 7 | V << 6 | 0x30                 // Always push with E (bit 5) and B (bit 4) ON
            |  D << 3 | I << 2 | Z << 1 | C;
    };

    var setStatusBits = function(val) {
        N = val >>> 7; V = val >>> 6 & 1;             // E and B flags actually do not exist as real flags, so ignore
        D = val >>> 3 & 1; I = val >>> 2 & 1; Z = val >>> 1 & 1; C = val & 1;
    };

    var illegalOpcode = function(op) {
        if (self.debug) self.breakpoint("Illegal Opcode: " + op);
    };

    var haltOpcode = function() {
        illegalOpcode("KIL/HLT/JAM");
        // PC has already advanced past the opcode, so the halt is at PC-1
        const addr = (PC - 1) & 0xffff;
        throw new EmuHalt(`CPU executed halt instruction ($${hex(opcode,2)}) at $${hex(addr,4)}`);
    }


    // Addressing routines

    var implied = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchOpcodeAndDiscard,
            function() {
                operation();
                fetchNextOpcode();
            }
        ];
    };

    var immediateRead = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchDataFromImmediate,
            function() {
                operation();
                fetchNextOpcode();
            }
        ];
    };

    var zeroPageRead = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchADL,                        // ADH will be zero
            fetchDataFromAD,
            function() {
                operation();
                fetchNextOpcode();
            }
        ];
    };

    var absoluteRead = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchADL,
            fetchADH,
            fetchDataFromAD,
            function() {
                operation();
                fetchNextOpcode();
            }
        ];
    };

    var indirectXRead = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchBAL,                        // BAH will be zero
            fetchDataFromBA,
            function() {
                addXtoBAL();
                fetchADLFromBA();
            },
            function() {
                add1toBAL();
                fetchADHFromBA();
            },
            fetchDataFromAD,
            function() {
                operation();
                fetchNextOpcode();
            }
        ];
    };

    var absoluteIndexedRead = function(index) {
        var addIndex = index === rX ? addXtoBAL : addYtoBAL;
        return function(operation) {
            return [
                fetchOpcodeAndDecodeInstruction,
                fetchBAL,
                fetchBAH,
                function() {
                    addIndex();
                    fetchDataFromBA();
                    add1toBAHifBALCrossed();
                },
                function() {
                    if (BALCrossed) {
                        fetchDataFromBA();
                    } else {
                        operation();
                        fetchNextOpcode();
                    }
                },
                function() {
                    operation();
                    fetchNextOpcode();
                }
            ];
        };
    };

    var zeroPageIndexedRead = function(index) {
        var addIndex = index === rX ? addXtoBAL : addYtoBAL;
        return function(operation) {
            return [
                fetchOpcodeAndDecodeInstruction,
                fetchBAL,                        // BAH will be zero
                fetchDataFromBA,
                function() {
                    addIndex();
                    fetchDataFromBA();
                },
                function() {
                    operation();
                    fetchNextOpcode();
                }
            ];
        };
    };

    var indirectYRead = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchIAL,                           // IAH will be zero
            fetchBALFromIA,
            function() {
                add1toIAL();
                fetchBAHFromIA();
            },
            function() {
                addYtoBAL();
                fetchDataFromBA();
                add1toBAHifBALCrossed();
            },
            function() {
                if(BALCrossed) {
                    fetchDataFromBA();
                } else {
                    operation();
                    fetchNextOpcode();
                }
            },
            function() {
                operation();
                fetchNextOpcode();
            }
        ];
    };

    var zeroPageWrite = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchADL,                        // ADH will be zero
            function() {
                operation();
                writeDataToAD();
            },
            fetchNextOpcode
        ];
    };

    var absoluteWrite = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchADL,
            fetchADH,
            function() {
                operation();
                writeDataToAD();
            },
            fetchNextOpcode
        ];
    };

    var indirectXWrite = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchBAL,                        // BAH will be zero
            fetchDataFromBA,
            function() {
                addXtoBAL();
                fetchADLFromBA();
            },
            function() {
                add1toBAL();
                fetchADHFromBA();
            },
            function() {
                operation();
                writeDataToAD();
            },
            fetchNextOpcode
        ];
    };

    var absoluteIndexedWrite = function(index) {
        var addIndex = index === rX ? addXtoBAL : addYtoBAL;
        return function(operation) {
            return [
                fetchOpcodeAndDecodeInstruction,
                fetchBAL,
                fetchBAH,
                function() {
                    addIndex();
                    fetchDataFromBA();
                    add1toBAHifBALCrossed();
                },
                function() {
                    operation();
                    writeDataToBA();
                },
                fetchNextOpcode
            ];
        };
    };

    var zeroPageIndexedWrite = function(index) {
        var addIndex = index === rX ? addXtoBAL : addYtoBAL;
        return function(operation) {
            return [
                fetchOpcodeAndDecodeInstruction,
                fetchBAL,                        // BAH will be zero
                fetchDataFromBA,
                function() {
                    addIndex();
                    operation();
                    writeDataToBA();
                },
                fetchNextOpcode
            ];
        };
    };

    var indirectYWrite = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchIAL,                           // IAH will be zero
            fetchBALFromIA,
            function() {
                add1toIAL();
                fetchBAHFromIA();
            },
            function() {
                addYtoBAL();
                fetchDataFromBA();
                add1toBAHifBALCrossed();
            },
            function() {
                operation();
                writeDataToBA();
            },
            fetchNextOpcode
        ];
    };


    // 65C02 "(zp)" addressing -- like indirectYRead/Write but with no index added,
    // so there's no page-cross penalty cycle.
    var zeroPageIndirectRead = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchIAL,                           // IAH will be zero
            fetchBALFromIA,
            function() {
                add1toIAL();
                fetchBAHFromIA();
            },
            fetchDataFromBA,
            function() {
                operation();
                fetchNextOpcode();
            }
        ];
    };

    var zeroPageIndirectWrite = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchIAL,                           // IAH will be zero
            fetchBALFromIA,
            function() {
                add1toIAL();
                fetchBAHFromIA();
            },
            function() {
                operation();
                writeDataToBA();
            },
            fetchNextOpcode
        ];
    };

    var zeroPageReadModifyWrite = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchADL,                        // ADH will be zero
            fetchDataFromAD,
            writeDataToAD,
            function() {
                operation();
                writeDataToAD();
            },
            fetchNextOpcode
        ];
    };

    var absoluteReadModifyWrite = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchADL,
            fetchADH,
            fetchDataFromAD,
            writeDataToAD,
            function() {
                operation();
                writeDataToAD();
            },
            fetchNextOpcode
        ];
    };

    var zeroPageIndexedReadModifyWrite = function(index) {
        var addIndex = index === rX ? addXtoBAL : addYtoBAL;
        return function(operation) {
            return [
                fetchOpcodeAndDecodeInstruction,
                fetchBAL,                        // BAH will be zero
                fetchDataFromBA,
                function () {
                    addIndex();
                    fetchDataFromBA();
                },
                writeDataToBA,
                function () {
                    operation();
                    writeDataToBA();
                },
                fetchNextOpcode
            ];
        };
    };

    var absoluteIndexedReadModifyWrite = function(index) {
        var addIndex = index === rX ? addXtoBAL : addYtoBAL;
        return function(operation) {
            return [
                fetchOpcodeAndDecodeInstruction,
                fetchBAL,
                fetchBAH,
                function () {
                    addIndex();
                    fetchDataFromBA();
                    add1toBAHifBALCrossed();
                },
                fetchDataFromBA,
                writeDataToBA,
                function () {
                    operation();
                    writeDataToBA();
                },
                fetchNextOpcode
            ];
        };
    };

    var indirectXReadModifyWrite = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchBAL,                        // BAH will be zero
            fetchDataFromBA,
            function() {
                addXtoBAL();
                fetchADLFromBA();
            },
            function() {
                add1toBAL();
                fetchADHFromBA();
            },
            fetchDataFromAD,
            writeDataToAD,
            function() {
                operation();
                writeDataToAD();
            },
            fetchNextOpcode
        ];
    };

    var indirectYReadModifyWrite = function(operation) {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchIAL,                           // IAH will be zero
            fetchBALFromIA,
            function() {
                add1toIAL();
                fetchBAHFromIA();
            },
            function() {
                addYtoBAL();
                fetchDataFromBA();
                add1toBAHifBALCrossed();
            },
            fetchDataFromBA,
            writeDataToBA,
            function() {
                operation();
                writeDataToBA();
            },
            fetchNextOpcode
        ];
    };


    // Instructions  ========================================================================================

    // Complete instruction set
    var opcodes =      new Array(256);
    var instructions = new Array(256);

    opcodes[0x00] = "BRK";  instructions[0x00] = BRK();
    opcodes[0x01] = "ORA";  instructions[0x01] = ORA(indirectXRead);
    opcodes[0x02] = "uKIL"; instructions[0x02] = uKIL();
    opcodes[0x03] = "uSLO"; instructions[0x03] = uSLO(indirectXReadModifyWrite);
    opcodes[0x04] = "uNOP"; instructions[0x04] = uNOP(zeroPageRead);
    opcodes[0x05] = "ORA";  instructions[0x05] = ORA(zeroPageRead);
    opcodes[0x06] = "ASL";  instructions[0x06] = ASL(zeroPageReadModifyWrite);
    opcodes[0x07] = "uSLO"; instructions[0x07] = uSLO(zeroPageReadModifyWrite);
    opcodes[0x08] = "PHP";  instructions[0x08] = PHP();
    opcodes[0x09] = "ORA";  instructions[0x09] = ORA(immediateRead);
    opcodes[0x0a] = "ASL";  instructions[0x0a] = ASL_ACC();
    opcodes[0x0b] = "uANC"; instructions[0x0b] = uANC(immediateRead);
    opcodes[0x0c] = "uNOP"; instructions[0x0c] = uNOP(absoluteRead);
    opcodes[0x0d] = "ORA";  instructions[0x0d] = ORA(absoluteRead);
    opcodes[0x0e] = "ASL";  instructions[0x0e] = ASL(absoluteReadModifyWrite);
    opcodes[0x0f] = "uSLO"; instructions[0x0f] = uSLO(absoluteReadModifyWrite);
    opcodes[0x10] = "BPL";  instructions[0x10] = Bxx(bN, 0);                 // BPL
    opcodes[0x11] = "ORA";  instructions[0x11] = ORA(indirectYRead);
    opcodes[0x12] = "uKIL"; instructions[0x12] = uKIL();
    opcodes[0x13] = "uSLO"; instructions[0x13] = uSLO(indirectYReadModifyWrite);
    opcodes[0x14] = "uNOP"; instructions[0x14] = uNOP(zeroPageIndexedRead(rX));
    opcodes[0x15] = "ORA";  instructions[0x15] = ORA(zeroPageIndexedRead(rX));
    opcodes[0x16] = "ASL";  instructions[0x16] = ASL(zeroPageIndexedReadModifyWrite(rX));
    opcodes[0x17] = "uSLO"; instructions[0x17] = uSLO(zeroPageIndexedReadModifyWrite(rX));
    opcodes[0x18] = "CLC";  instructions[0x18] = CLC();
    opcodes[0x19] = "ORA";  instructions[0x19] = ORA(absoluteIndexedRead(rY));
    opcodes[0x1a] = "uNOP"; instructions[0x1a] = uNOP(implied);
    opcodes[0x1b] = "uSLO"; instructions[0x1b] = uSLO(absoluteIndexedReadModifyWrite(rY));
    opcodes[0x1c] = "uNOP"; instructions[0x1c] = uNOP(absoluteIndexedRead(rX));
    opcodes[0x1d] = "ORA";  instructions[0x1d] = ORA(absoluteIndexedRead(rX));
    opcodes[0x1e] = "ASL";  instructions[0x1e] = ASL(absoluteIndexedReadModifyWrite(rX));
    opcodes[0x1f] = "uSLO"; instructions[0x1f] = uSLO(absoluteIndexedReadModifyWrite(rX));
    opcodes[0x20] = "JSR";  instructions[0x20] = JSR();
    opcodes[0x21] = "AND";  instructions[0x21] = AND(indirectXRead);
    opcodes[0x22] = "uKIL"; instructions[0x22] = uKIL();
    opcodes[0x23] = "uRLA"; instructions[0x23] = uRLA(indirectXReadModifyWrite);
    opcodes[0x24] = "BIT";  instructions[0x24] = BIT(zeroPageRead);
    opcodes[0x25] = "AND";  instructions[0x25] = AND(zeroPageRead);
    opcodes[0x26] = "ROL";  instructions[0x26] = ROL(zeroPageReadModifyWrite);
    opcodes[0x27] = "uRLA"; instructions[0x27] = uRLA(zeroPageReadModifyWrite);
    opcodes[0x28] = "PLP";  instructions[0x28] = PLP();
    opcodes[0x29] = "AND";  instructions[0x29] = AND(immediateRead);
    opcodes[0x2a] = "ROL";  instructions[0x2a] = ROL_ACC();
    opcodes[0x2b] = "uANC"; instructions[0x2b] = uANC(immediateRead);
    opcodes[0x2c] = "BIT";  instructions[0x2c] = BIT(absoluteRead);
    opcodes[0x2d] = "AND";  instructions[0x2d] = AND(absoluteRead);
    opcodes[0x2e] = "ROL";  instructions[0x2e] = ROL(absoluteReadModifyWrite);
    opcodes[0x2f] = "uRLA"; instructions[0x2f] = uRLA(absoluteReadModifyWrite);
    opcodes[0x30] = "BMI";  instructions[0x30] = Bxx(bN, 1);                 // BMI
    opcodes[0x31] = "AND";  instructions[0x31] = AND(indirectYRead);
    opcodes[0x32] = "uKIL"; instructions[0x32] = uKIL();
    opcodes[0x33] = "uRLA"; instructions[0x33] = uRLA(indirectYReadModifyWrite);
    opcodes[0x34] = "uNOP"; instructions[0x34] = uNOP(zeroPageIndexedRead(rX));
    opcodes[0x35] = "AND";  instructions[0x35] = AND(zeroPageIndexedRead(rX));
    opcodes[0x36] = "ROL";  instructions[0x36] = ROL(zeroPageIndexedReadModifyWrite(rX));
    opcodes[0x37] = "uRLA"; instructions[0x37] = uRLA(zeroPageIndexedReadModifyWrite(rX));
    opcodes[0x38] = "SEC";  instructions[0x38] = SEC();
    opcodes[0x39] = "AND";  instructions[0x39] = AND(absoluteIndexedRead(rY));
    opcodes[0x3a] = "uNOP"; instructions[0x3a] = uNOP(implied);
    opcodes[0x3b] = "uRLA"; instructions[0x3b] = uRLA(absoluteIndexedReadModifyWrite(rY));
    opcodes[0x3c] = "uNOP"; instructions[0x3c] = uNOP(absoluteIndexedRead(rX));
    opcodes[0x3d] = "AND";  instructions[0x3d] = AND(absoluteIndexedRead(rX));
    opcodes[0x3e] = "ROL";  instructions[0x3e] = ROL(absoluteIndexedReadModifyWrite(rX));
    opcodes[0x3f] = "uRLA"; instructions[0x3f] = uRLA(absoluteIndexedReadModifyWrite(rX));
    opcodes[0x40] = "RTI";  instructions[0x40] = RTI();
    opcodes[0x41] = "EOR";  instructions[0x41] = EOR(indirectXRead);
    opcodes[0x42] = "uKIL"; instructions[0x42] = uKIL();
    opcodes[0x43] = "uSRE"; instructions[0x43] = uSRE(indirectXReadModifyWrite);
    opcodes[0x44] = "uNOP"; instructions[0x44] = uNOP(zeroPageRead);
    opcodes[0x45] = "EOR";  instructions[0x45] = EOR(zeroPageRead);
    opcodes[0x46] = "LSR";  instructions[0x46] = LSR(zeroPageReadModifyWrite);
    opcodes[0x47] = "uSRE"; instructions[0x47] = uSRE(zeroPageReadModifyWrite);
    opcodes[0x48] = "PHA";  instructions[0x48] = PHA();
    opcodes[0x49] = "EOR";  instructions[0x49] = EOR(immediateRead);
    opcodes[0x4a] = "LSR";  instructions[0x4a] = LSR_ACC();
    opcodes[0x4b] = "uASR"; instructions[0x4b] = uASR(immediateRead);
    opcodes[0x4c] = "JMP";  instructions[0x4c] = JMP_ABS();
    opcodes[0x4d] = "EOR";  instructions[0x4d] = EOR(absoluteRead);
    opcodes[0x4e] = "LSR";  instructions[0x4e] = LSR(absoluteReadModifyWrite);
    opcodes[0x4f] = "uSRE"; instructions[0x4f] = uSRE(absoluteReadModifyWrite);
    opcodes[0x50] = "BVC";  instructions[0x50] = Bxx(bV, 0);                 // BVC
    opcodes[0x51] = "EOR";  instructions[0x51] = EOR(indirectYRead);
    opcodes[0x52] = "uKIL"; instructions[0x52] = uKIL();
    opcodes[0x53] = "uSRE"; instructions[0x53] = uSRE(indirectYReadModifyWrite);
    opcodes[0x54] = "uNOP"; instructions[0x54] = uNOP(zeroPageIndexedRead(rX));
    opcodes[0x55] = "EOR";  instructions[0x55] = EOR(zeroPageIndexedRead(rX));
    opcodes[0x56] = "LSR";  instructions[0x56] = LSR(zeroPageIndexedReadModifyWrite(rX));
    opcodes[0x57] = "uSRE"; instructions[0x57] = uSRE(zeroPageIndexedReadModifyWrite(rX));
    opcodes[0x58] = "CLI";  instructions[0x58] = CLI();
    opcodes[0x59] = "EOR";  instructions[0x59] = EOR(absoluteIndexedRead(rY));
    opcodes[0x5a] = "uNOP"; instructions[0x5a] = uNOP(implied);
    opcodes[0x5b] = "uSRE"; instructions[0x5b] = uSRE(absoluteIndexedReadModifyWrite(rY));
    opcodes[0x5c] = "uNOP"; instructions[0x5c] = uNOP(absoluteIndexedRead(rX));
    opcodes[0x5d] = "EOR";  instructions[0x5d] = EOR(absoluteIndexedRead(rX));
    opcodes[0x5e] = "LSR";  instructions[0x5e] = LSR(absoluteIndexedReadModifyWrite(rX));
    opcodes[0x5f] = "uSRE"; instructions[0x5f] = uSRE(absoluteIndexedReadModifyWrite(rX));
    opcodes[0x60] = "RTS";  instructions[0x60] = RTS();
    opcodes[0x61] = "ADC";  instructions[0x61] = ADC(indirectXRead);
    opcodes[0x62] = "uKIL"; instructions[0x62] = uKIL();
    opcodes[0x63] = "uRRA"; instructions[0x63] = uRRA(indirectXReadModifyWrite);
    opcodes[0x64] = "uNOP"; instructions[0x64] = uNOP(zeroPageRead);
    opcodes[0x65] = "ADC";  instructions[0x65] = ADC(zeroPageRead);
    opcodes[0x66] = "ROR";  instructions[0x66] = ROR(zeroPageReadModifyWrite);
    opcodes[0x67] = "uRRA"; instructions[0x67] = uRRA(zeroPageReadModifyWrite);
    opcodes[0x68] = "PLA";  instructions[0x68] = PLA();
    opcodes[0x69] = "ADC";  instructions[0x69] = ADC(immediateRead);
    opcodes[0x6a] = "ROR";  instructions[0x6a] = ROR_ACC();
    opcodes[0x6b] = "uARR"; instructions[0x6b] = uARR(immediateRead);
    opcodes[0x6c] = "JMP";  instructions[0x6c] = JMP_IND();
    opcodes[0x6d] = "ADC";  instructions[0x6d] = ADC(absoluteRead);
    opcodes[0x6e] = "ROR";  instructions[0x6e] = ROR(absoluteReadModifyWrite);
    opcodes[0x6f] = "uRRA"; instructions[0x6f] = uRRA(absoluteReadModifyWrite);
    opcodes[0x70] = "BVS";  instructions[0x70] = Bxx(bV, 1);                 // BVS
    opcodes[0x71] = "ADC";  instructions[0x71] = ADC(indirectYRead);
    opcodes[0x72] = "uKIL"; instructions[0x72] = uKIL();
    opcodes[0x73] = "uRRA"; instructions[0x73] = uRRA(indirectYReadModifyWrite);
    opcodes[0x74] = "uNOP"; instructions[0x74] = uNOP(zeroPageIndexedRead(rX));
    opcodes[0x75] = "ADC";  instructions[0x75] = ADC(zeroPageIndexedRead(rX));
    opcodes[0x76] = "ROR";  instructions[0x76] = ROR(zeroPageIndexedReadModifyWrite(rX));
    opcodes[0x77] = "uRRA"; instructions[0x77] = uRRA(zeroPageIndexedReadModifyWrite(rX));
    opcodes[0x78] = "SEI";  instructions[0x78] = SEI();
    opcodes[0x79] = "ADC";  instructions[0x79] = ADC(absoluteIndexedRead(rY));
    opcodes[0x7a] = "uNOP"; instructions[0x7a] = uNOP(implied);
    opcodes[0x7b] = "uRRA"; instructions[0x7b] = uRRA(absoluteIndexedReadModifyWrite(rY));
    opcodes[0x7c] = "uNOP"; instructions[0x7c] = uNOP(absoluteIndexedRead(rX));
    opcodes[0x7d] = "ADC";  instructions[0x7d] = ADC(absoluteIndexedRead(rX));
    opcodes[0x7e] = "ROR";  instructions[0x7e] = ROR(absoluteIndexedReadModifyWrite(rX));
    opcodes[0x7f] = "uRRA"; instructions[0x7f] = uRRA(absoluteIndexedReadModifyWrite(rX));
    opcodes[0x80] = "uNOP"; instructions[0x80] = uNOP(immediateRead);
    opcodes[0x81] = "STA";  instructions[0x81] = STA(indirectXWrite);
    opcodes[0x82] = "uNOP"; instructions[0x82] = uNOP(immediateRead);
    opcodes[0x83] = "uSAX"; instructions[0x83] = uSAX(indirectXWrite);
    opcodes[0x84] = "STY";  instructions[0x84] = STY(zeroPageWrite);
    opcodes[0x85] = "STA";  instructions[0x85] = STA(zeroPageWrite);
    opcodes[0x86] = "STX";  instructions[0x86] = STX(zeroPageWrite);
    opcodes[0x87] = "uSAX"; instructions[0x87] = uSAX(zeroPageWrite);
    opcodes[0x88] = "DEY";  instructions[0x88] = DEY();
    opcodes[0x89] = "uNOP"; instructions[0x89] = uNOP(immediateRead);
    opcodes[0x8a] = "TXA";  instructions[0x8a] = TXA();
    opcodes[0x8b] = "uANE"; instructions[0x8b] = uANE(immediateRead);
    opcodes[0x8c] = "STY";  instructions[0x8c] = STY(absoluteWrite);
    opcodes[0x8d] = "STA";  instructions[0x8d] = STA(absoluteWrite);
    opcodes[0x8e] = "STX";  instructions[0x8e] = STX(absoluteWrite);
    opcodes[0x8f] = "uSAX"; instructions[0x8f] = uSAX(absoluteWrite);
    opcodes[0x90] = "BCC";  instructions[0x90] = Bxx(bC, 0);                 // BCC
    opcodes[0x91] = "STA";  instructions[0x91] = STA(indirectYWrite);
    opcodes[0x92] = "uKIL"; instructions[0x92] = uKIL();
    opcodes[0x93] = "uSHA"; instructions[0x93] = uSHA(indirectYWrite);
    opcodes[0x94] = "STY";  instructions[0x94] = STY(zeroPageIndexedWrite(rX));
    opcodes[0x95] = "STA";  instructions[0x95] = STA(zeroPageIndexedWrite(rX));
    opcodes[0x96] = "STX";  instructions[0x96] = STX(zeroPageIndexedWrite(rY));
    opcodes[0x97] = "uSAX"; instructions[0x97] = uSAX(zeroPageIndexedWrite(rY));
    opcodes[0x98] = "TYA";  instructions[0x98] = TYA();
    opcodes[0x99] = "STA";  instructions[0x99] = STA(absoluteIndexedWrite(rY));
    opcodes[0x9a] = "TXS";  instructions[0x9a] = TXS();
    opcodes[0x9b] = "uSHS"; instructions[0x9b] = uSHS(absoluteIndexedWrite(rY));
    opcodes[0x9c] = "uSHY"; instructions[0x9c] = uSHY(absoluteIndexedWrite(rX));
    opcodes[0x9d] = "STA";  instructions[0x9d] = STA(absoluteIndexedWrite(rX));
    opcodes[0x9e] = "uSHX"; instructions[0x9e] = uSHX(absoluteIndexedWrite(rY));
    opcodes[0x9f] = "uSHA"; instructions[0x9f] = uSHA(absoluteIndexedWrite(rY));
    opcodes[0xa0] = "LDY";  instructions[0xa0] = LDY(immediateRead);
    opcodes[0xa1] = "LDA";  instructions[0xa1] = LDA(indirectXRead);
    opcodes[0xa2] = "LDX";  instructions[0xa2] = LDX(immediateRead);
    opcodes[0xa3] = "uLAX"; instructions[0xa3] = uLAX(indirectXRead);
    opcodes[0xa4] = "LDY";  instructions[0xa4] = LDY(zeroPageRead);
    opcodes[0xa5] = "LDA";  instructions[0xa5] = LDA(zeroPageRead);
    opcodes[0xa6] = "LDX";  instructions[0xa6] = LDX(zeroPageRead);
    opcodes[0xa7] = "uLAX"; instructions[0xa7] = uLAX(zeroPageRead);
    opcodes[0xa8] = "TAY";  instructions[0xa8] = TAY();
    opcodes[0xa9] = "LDA";  instructions[0xa9] = LDA(immediateRead);
    opcodes[0xaa] = "TAX";  instructions[0xaa] = TAX();
    opcodes[0xab] = "uLXA"; instructions[0xab] = uLXA(immediateRead);
    opcodes[0xac] = "LDY";  instructions[0xac] = LDY(absoluteRead);
    opcodes[0xad] = "LDA";  instructions[0xad] = LDA(absoluteRead);
    opcodes[0xae] = "LDX";  instructions[0xae] = LDX(absoluteRead);
    opcodes[0xaf] = "uLAX"; instructions[0xaf] = uLAX(absoluteRead);
    opcodes[0xb0] = "BCS";  instructions[0xb0] = Bxx(bC, 1);                 // BCS
    opcodes[0xb1] = "LDA";  instructions[0xb1] = LDA(indirectYRead);
    opcodes[0xb2] = "uKIL"; instructions[0xb2] = uKIL();
    opcodes[0xb3] = "uLAX"; instructions[0xb3] = uLAX(indirectYRead);
    opcodes[0xb4] = "LDY";  instructions[0xb4] = LDY(zeroPageIndexedRead(rX));
    opcodes[0xb5] = "LDA";  instructions[0xb5] = LDA(zeroPageIndexedRead(rX));
    opcodes[0xb6] = "LDX";  instructions[0xb6] = LDX(zeroPageIndexedRead(rY));
    opcodes[0xb7] = "uLAX"; instructions[0xb7] = uLAX(zeroPageIndexedRead(rY));
    opcodes[0xb8] = "CLV";  instructions[0xb8] = CLV();
    opcodes[0xb9] = "LDA";  instructions[0xb9] = LDA(absoluteIndexedRead(rY));
    opcodes[0xba] = "TSX";  instructions[0xba] = TSX();
    opcodes[0xbb] = "uLAS"; instructions[0xbb] = uLAS(absoluteIndexedRead(rY));
    opcodes[0xbc] = "LDY";  instructions[0xbc] = LDY(absoluteIndexedRead(rX));
    opcodes[0xbd] = "LDA";  instructions[0xbd] = LDA(absoluteIndexedRead(rX));
    opcodes[0xbe] = "LDX";  instructions[0xbe] = LDX(absoluteIndexedRead(rY));
    opcodes[0xbf] = "uLAX"; instructions[0xbf] = uLAX(absoluteIndexedRead(rY));
    opcodes[0xc0] = "CPY";  instructions[0xc0] = CPY(immediateRead);
    opcodes[0xc1] = "CMP";  instructions[0xc1] = CMP(indirectXRead);
    opcodes[0xc2] = "uNOP"; instructions[0xc2] = uNOP(immediateRead);
    opcodes[0xc3] = "uDCP"; instructions[0xc3] = uDCP(indirectXReadModifyWrite);
    opcodes[0xc4] = "CPY";  instructions[0xc4] = CPY(zeroPageRead);
    opcodes[0xc5] = "CMP";  instructions[0xc5] = CMP(zeroPageRead);
    opcodes[0xc6] = "DEC";  instructions[0xc6] = DEC(zeroPageReadModifyWrite);
    opcodes[0xc7] = "uDCP"; instructions[0xc7] = uDCP(zeroPageReadModifyWrite);
    opcodes[0xc8] = "INY";  instructions[0xc8] = INY();
    opcodes[0xc9] = "CMP";  instructions[0xc9] = CMP(immediateRead);
    opcodes[0xca] = "DEX";  instructions[0xca] = DEX();
    opcodes[0xcb] = "uSBX"; instructions[0xcb] = uSBX(immediateRead);
    opcodes[0xcc] = "CPY";  instructions[0xcc] = CPY(absoluteRead);
    opcodes[0xcd] = "CMP";  instructions[0xcd] = CMP(absoluteRead);
    opcodes[0xce] = "DEC";  instructions[0xce] = DEC(absoluteReadModifyWrite);
    opcodes[0xcf] = "uDCP"; instructions[0xcf] = uDCP(absoluteReadModifyWrite);
    opcodes[0xd0] = "BNE";  instructions[0xd0] = Bxx(bZ, 0);                 // BNE
    opcodes[0xd1] = "CMP";  instructions[0xd1] = CMP(indirectYRead);
    opcodes[0xd2] = "uKIL"; instructions[0xd2] = uKIL();
    opcodes[0xd3] = "uDCP"; instructions[0xd3] = uDCP(indirectYReadModifyWrite);
    opcodes[0xd4] = "uNOP"; instructions[0xd4] = uNOP(zeroPageIndexedRead(rX));
    opcodes[0xd5] = "CMP";  instructions[0xd5] = CMP(zeroPageIndexedRead(rX));
    opcodes[0xd6] = "DEC";  instructions[0xd6] = DEC(zeroPageIndexedReadModifyWrite(rX));
    opcodes[0xd7] = "uDCP"; instructions[0xd7] = uDCP(zeroPageIndexedReadModifyWrite(rX));
    opcodes[0xd8] = "CLD";  instructions[0xd8] = CLD();
    opcodes[0xd9] = "CMP";  instructions[0xd9] = CMP(absoluteIndexedRead(rY));
    opcodes[0xda] = "uNOP"; instructions[0xda] = uNOP(implied);
    opcodes[0xdb] = "uDCP"; instructions[0xdb] = uDCP(absoluteIndexedReadModifyWrite(rY));
    opcodes[0xdc] = "uNOP"; instructions[0xdc] = uNOP(absoluteIndexedRead(rX));
    opcodes[0xdd] = "CMP";  instructions[0xdd] = CMP(absoluteIndexedRead(rX));
    opcodes[0xde] = "DEC";  instructions[0xde] = DEC(absoluteIndexedReadModifyWrite(rX));
    opcodes[0xdf] = "uDCP"; instructions[0xdf] = uDCP(absoluteIndexedReadModifyWrite(rX));
    opcodes[0xe0] = "CPX";  instructions[0xe0] = CPX(immediateRead);
    opcodes[0xe1] = "SBC";  instructions[0xe1] = SBC(indirectXRead);
    opcodes[0xe2] = "uNOP"; instructions[0xe2] = uNOP(immediateRead);
    opcodes[0xe3] = "uISB"; instructions[0xe3] = uISB(indirectXReadModifyWrite);
    opcodes[0xe4] = "CPX";  instructions[0xe4] = CPX(zeroPageRead);
    opcodes[0xe5] = "SBC";  instructions[0xe5] = SBC(zeroPageRead);
    opcodes[0xe6] = "INC";  instructions[0xe6] = INC(zeroPageReadModifyWrite);
    opcodes[0xe7] = "uISB"; instructions[0xe7] = uISB(zeroPageReadModifyWrite);
    opcodes[0xe8] = "INX";  instructions[0xe8] = INX();
    opcodes[0xe9] = "SBC";  instructions[0xe9] = SBC(immediateRead);
    opcodes[0xea] = "NOP";  instructions[0xea] = NOP();
    opcodes[0xeb] = "SBC";  instructions[0xeb] = SBC(immediateRead);
    opcodes[0xec] = "CPX";  instructions[0xec] = CPX(absoluteRead);
    opcodes[0xed] = "SBC";  instructions[0xed] = SBC(absoluteRead);
    opcodes[0xee] = "INC";  instructions[0xee] = INC(absoluteReadModifyWrite);
    opcodes[0xef] = "uISB"; instructions[0xef] = uISB(absoluteReadModifyWrite);
    opcodes[0xf0] = "BEQ";  instructions[0xf0] = Bxx(bZ, 1);                 // BEQ
    opcodes[0xf1] = "SBC";  instructions[0xf1] = SBC(indirectYRead);
    opcodes[0xf2] = "uKIL"; instructions[0xf2] = uKIL();
    opcodes[0xf3] = "uISB"; instructions[0xf3] = uISB(indirectYReadModifyWrite);
    opcodes[0xf4] = "uNOP"; instructions[0xf4] = uNOP(zeroPageIndexedRead(rX));
    opcodes[0xf5] = "SBC";  instructions[0xf5] = SBC(zeroPageIndexedRead(rX));
    opcodes[0xf6] = "INC";  instructions[0xf6] = INC(zeroPageIndexedReadModifyWrite(rX));
    opcodes[0xf7] = "uISB"; instructions[0xf7] = uISB(zeroPageIndexedReadModifyWrite(rX));
    opcodes[0xf8] = "SED";  instructions[0xf8] = SED();
    opcodes[0xf9] = "SBC";  instructions[0xf9] = SBC(absoluteIndexedRead(rY));
    opcodes[0xfa] = "uNOP"; instructions[0xfa] = uNOP(implied);
    opcodes[0xfb] = "uISB"; instructions[0xfb] = uISB(absoluteIndexedReadModifyWrite(rY));
    opcodes[0xfc] = "uNOP"; instructions[0xfc] = uNOP(absoluteIndexedRead(rX));
    opcodes[0xfd] = "SBC";  instructions[0xfd] = SBC(absoluteIndexedRead(rX));
    opcodes[0xfe] = "INC";  instructions[0xfe] = INC(absoluteIndexedReadModifyWrite(rX));
    opcodes[0xff] = "uISB"; instructions[0xff] = uISB(absoluteIndexedReadModifyWrite(rX));


    // Single Byte instructions

    function ASL_ACC() {
        return implied(function() {
            setC(A > 127);
            A = (A << 1) & 255;
            setZ(A);
            setN(A);
        });
    }

    function CLC() {
        return implied(function() {
            C = 0;
        });
    }

    function CLD() {
        return implied(function() {
            D = 0;
        });
    }

    function CLI() {
        return implied(function() {
            I = 0;
        });
    }

    function CLV() {
        return implied(function() {
            V = 0;
        });
    }

    function DEX() {
        return implied(function() {
            X = (X - 1) & 255;
            setZ(X);
            setN(X);
        });
    }

    function DEY() {
        return implied(function() {
            Y = (Y - 1) & 255;
            setZ(Y);
            setN(Y);
        });
    }

    function INX() {
        return implied(function() {
            X = (X + 1) & 255;
            setZ(X);
            setN(X);
        });
    }

    function INY() {
        return implied(function() {
            Y = (Y + 1) & 255;
            setZ(Y);
            setN(Y);
        });
    }

    function LSR_ACC() {
        return implied(function() {
            C = A & 0x01;
            A >>>= 1;
            setZ(A);
            N = 0;
        });
    }

    function NOP() {
        return implied(function() {
            // nothing
        });
    }

    function ROL_ACC() {
        return implied(function() {
            var newC = A > 127;
            A = ((A << 1) | C) & 255;
            setC(newC);
            setZ(A);
            setN(A);
        });
    }

    function ROR_ACC() {
        return implied(function() {
            var newC = A & 0x01;
            A = (A >>> 1) | (C << 7);
            setC(newC);
            setZ(A);
            setN(A);
        });
    }

    // 65C02 INC A / DEC A (accumulator increment/decrement, opcodes 0x1A/0x3A)
    function INC_ACC() {
        return implied(function() {
            A = (A + 1) & 255;
            setZ(A);
            setN(A);
        });
    }

    function DEC_ACC() {
        return implied(function() {
            A = (A - 1) & 255;
            setZ(A);
            setN(A);
        });
    }

    function SEC() {
        return implied(function() {
            C = 1;
        });
    }

    function SED() {
        return implied(function() {
            D = 1;
        });
    }

    function SEI() {
        return implied(function() {
            I = 1;
        });
    }

    function TAX() {
        return implied(function() {
            X = A;
            setZ(X);
            setN(X);
        });
    }

    function TAY() {
        return implied(function() {
            Y = A;
            setZ(Y);
            setN(Y);
        });
    }

    function TSX() {
        return implied(function() {
            X = SP;
            setZ(X);
            setN(X);
        });
    }

    function TXA() {
        return implied(function() {
            A = X;
            setZ(A);
            setN(A);
        });
    }

    function TXS() {
        return implied(function() {
            SP = X;
        });
    }

    function TYA() {
        return implied(function() {
            A = Y;
            setZ(A);
            setN(A);
        });
    }

    function uKIL() {
        return [
            fetchOpcodeAndDecodeInstruction,
            function() {
                haltOpcode();
            },
            function() {
                T--;        // Causes the processor to be stuck in this instruction forever
            }
        ];
    }

    function uNOP(addressing) {
        return addressing(function() {
            illegalOpcode("NOP/DOP");
            // nothing
        });
    }


    // Internal Execution on Memory Data

    function ADC(addressing) {
        return addressing(function() {
            if (D) {
                var operand = data;
                var AL = (A & 15) + (operand & 15) + C;
                if (AL > 9) { AL += 6; }
                var AH = ((A >> 4) + (operand >> 4) + ((AL > 15)?1:0)) << 4;
                setZ((A + operand + C) & 255);
                setN(AH);
                setV(((A ^AH) & ~(A ^ operand)) & 128);
                if (AH > 0x9f) { AH += 0x60; }
                setC(AH > 255);
                A = (AH | (AL & 15)) & 255;
            } else {
                var add = A + data + C;
                setC(add > 255);
                setV(((A ^ add) & (data ^ add)) & 0x80);
                A = add & 255;
                setZ(A);
                setN(A);
            }
        });
    }

    function AND(addressing) {
        return addressing(function() {
            A &= data;
            setZ(A);
            setN(A);
        });
    }

    function BIT(addressing) {
        return addressing(function() {
            var par = data;
            setZ(A & par);
            setV(par & 0x40);
            setN(par);
        });
    }

    // 65C02 BIT immediate (opcode 0x89) only affects Z, unlike memory BIT which also sets N/V
    function BIT_IMM(addressing) {
        return addressing(function() {
            setZ(A & data);
        });
    }

    function CMP(addressing) {
        return addressing(function() {
            var val = (A - data) & 255;
            setC(A >= data);
            setZ(val);
            setN(val);
        });
    }

    function CPX(addressing) {
        return addressing(function() {
            var val = (X - data) & 255;
            setC(X >= data);
            setZ(val);
            setN(val);
        });
    }

    function CPY(addressing) {
        return addressing(function() {
            var val = (Y - data) & 255;
            setC(Y >= data);
            setZ(val);
            setN(val);
        });
    }

    function EOR(addressing) {
        return addressing(function() {
            A ^= data;
            setZ(A);
            setN(A);
        });
    }

    function LDA(addressing) {
        return addressing(function() {
            A = data;
            setZ(A);
            setN(A);
        });
    }

    function LDX(addressing) {
        return addressing(function() {
            X = data;
            setZ(X);
            setN(X);
        });
    }

    function LDY(addressing) {
        return addressing(function() {
            Y = data;
            setZ(Y);
            setN(Y);
        });
    }

    function ORA(addressing) {
        return addressing(function() {
            A |= data;
            setZ(A);
            setN(A);
        });
    }

    function SBC(addressing) {
        return addressing(function() {
            if (D) {
                var operand = data;
                var AL = (A & 15) - (operand & 15) - (1-C);
                var AH = (A >> 4) - (operand >> 4) - ((AL < 0)?1:0);
                if (AL < 0) { AL -= 6; }
                if (AH < 0) { AH -= 6; }
                var sub = A - operand - (1-C);
                setC(~sub & 256);
                setV(((A ^ operand) & (A ^ sub)) & 128);
                setZ(sub & 255);
                setN(sub);
                A = ((AH << 4) | (AL & 15)) & 255;
            } else {
                operand = (~data) & 255;
                sub = A + operand + C;
                setC(sub > 255);
                setV(((A ^ sub) & (operand ^ sub) & 0x80));
                A = sub & 255;
                setZ(A);
                setN(A);
            }
        });
    }

    function uANC(addressing) {
        return addressing(function() {
            illegalOpcode("ANC");
            A &= data;
            setZ(A);
            N = C = (A & 0x080) ? 1 : 0;
        });
    }

    function uANE(addressing) {
        return addressing(function() {
            illegalOpcode("ANE");
            // Exact operation unknown. Do nothing
        });
    }

    function uARR(addressing) {
        // Some sources say flags are affected per ROR, others say its more complex. The complex one is chosen
        return addressing(function() {
            illegalOpcode("ARR");
            var val = A & data;
            var oldC = C ? 0x80 : 0;
            val = (val >>> 1) | oldC;
            A = val;
            setZ(val);
            setN(val);
            var comp = A & 0x60;
            if (comp == 0x60) 		{ C = 1; V = 0; }
            else if (comp == 0x00) 	{ C = 0; V = 0; }
            else if (comp == 0x20) 	{ C = 0; V = 1; }
            else if (comp == 0x40) 	{ C = 1; V = 1; }
        });
    }

    function uASR(addressing) {
        return addressing(function() {
            illegalOpcode("ASR");
            var val = A & data;
            C = (val & 0x01);		// bit 0
            val = val >>> 1;
            A = val;
            setZ(val);
            N = 0;
        });
    }

    function uLAS(addressing) {
        return addressing(function() {
            illegalOpcode("LAS");
            var val = SP & data;
            A = val;
            X = val;
            SP = val;
            setZ(val);
            setN(val);
        });
    }

    function uLAX(addressing) {
        return addressing(function() {
            illegalOpcode("LAX");
            var val = data;
            A = val;
            X = val;
            setZ(val);
            setN(val);
        });
    }

    function uLXA(addressing) {
        return addressing(function() {
            // Some sources say its an OR with $EE then AND with IMM, others exclude the OR,
            // others exclude both the OR and the AND. Excluding just the OR...
            illegalOpcode("LXA");
            var val = A /* | 0xEE) */ & data;
            A = val;
            X = val;
            setZ(val);
            setN(val);
        });
    }

    function uSBX(addressing) {
        return addressing(function() {
            illegalOpcode("SBX");
            var par = A & X;
            var val = data;
            var newX = (par - val) & 255;
            X = newX;
            setC(par >= val);
            setZ(newX);
            setN(newX);
        });
    }


    // Store operations

    function STA(addressing) {
        return addressing(function() {
            data = A;
        });
    }

    function STX(addressing) {
        return addressing(function() {
            data = X;
        });
    }

    function STY(addressing) {
        return addressing(function() {
            data = Y;
        });
    }

    // 65C02 STZ (store zero)
    function STZ(addressing) {
        return addressing(function() {
            data = 0;
        });
    }

    function uSAX(addressing) {
        return addressing(function() {
            // Some sources say it would affect N and Z flags, some say it wouldn't. Chose not to affect
            illegalOpcode("SAX");
            data = A & X;
        });
    }

    function uSHA(addressing) {
        return addressing(function() {
            illegalOpcode("SHA");
            data = A & X & ((BA >>> 8) + 1) & 255; // A & X & (High byte of effective address + 1) !!!
            // data would also be stored BAH if page boundary is crossed. Unobservable, not needed here
        });
    }

    function uSHS(addressing) {
        return addressing(function() {
            illegalOpcode("SHS");
            var val = A & X;
            SP = val;
            data = val & ((BA >>> 8) + 1) & 255; // A & X & (High byte of effective address + 1) !!!
            // data would also be stored BAH if page boundary is crossed. Unobservable, not needed here
        });
    }

    function uSHX(addressing) {
        return addressing(function() {
            illegalOpcode("SHX");
            data = X & ((BA >>> 8) + 1) & 255; // X & (High byte of effective address + 1) !!!
            // data would also be stored BAH if page boundary is crossed. Unobservable, not needed here
        });
    }

    function uSHY(addressing) {
        return addressing(function() {
            illegalOpcode("SHY");
            data = Y & ((BA >>> 8) + 1) & 255; // Y & (High byte of effective address + 1) !!!
            // data would also be stored BAH if page boundary is crossed. Unobservable, not needed here
        });
    }


    // Read-Modify-Write operations

    function ASL(addressing) {
        return addressing(function() {
            setC(data > 127);
            var par = (data << 1) & 255;
            data = par;
            setZ(par);
            setN(par);
        });
    }

    function DEC(addressing) {
        return addressing(function() {
            var par = (data - 1) & 255;
            data = par;
            setZ(par);
            setN(par);
        });
    }

    function INC(addressing) {
        return addressing(function() {
            var par = (data + 1) & 255;
            data = par;
            setZ(par);
            setN(par);
        });
    }

    // 65C02 TSB (Test and Set Bits) / TRB (Test and Reset Bits)
    function TSB(addressing) {
        return addressing(function() {
            setZ(A & data);
            data = data | A;
        });
    }

    function TRB(addressing) {
        return addressing(function() {
            setZ(A & data);
            data = data & (~A & 0xff);
        });
    }

    function LSR(addressing) {
        return addressing(function() {
            C = data & 0x01;
            data >>>= 1;
            setZ(data);
            N = 0;
        });
    }

    function ROL(addressing) {
        return addressing(function() {
            var newC = data > 127;
            var par = ((data << 1) | C) & 255;
            data = par;
            setC(newC);
            setZ(par);
            setN(par);
        });
    }

    function ROR(addressing) {
        return addressing(function() {
            var newC = data & 0x01;
            var par = (data >>> 1) | (C << 7);
            data = par;
            setC(newC);
            setZ(par);
            setN(par);
        });
    }

    function uDCP(addressing) {
        return addressing(function() {
            illegalOpcode("DCP");
            var par = (data - 1) & 255;
            data = par;
            par = A - par;
            setC(par >= 0);
            setZ(par);
            setN(par);
        });
    }

    function uISB(addressing) {
        return addressing(function() {
            illegalOpcode("ISB");
            data = (data + 1) & 255;    // ISB is the same as SBC but incs the operand first
            if (D) {
                var operand = data;
                var AL = (A & 15) - (operand & 15) - (1-C);
                var AH = (A >> 4) - (operand >> 4) - ((AL < 0)?1:0);
                if (AL < 0) { AL -= 6; }
                if (AH < 0) { AH -= 6; }
                var sub = A - operand - (1-C);
                setC(~sub & 256);
                setV(((A ^ operand) & (A ^ sub)) & 128);
                setZ(sub & 255);
                setN(sub);
                A = ((AH << 4) | (AL & 15)) & 255;
            } else {
                operand = (~data) & 255;
                sub = A + operand + C;
                setC(sub > 255);
                setV(((A ^ sub) & (operand ^ sub) & 0x80));
                A = sub & 255;
                setZ(A);
                setN(A);
            }
        });
    }

    function uRLA(addressing) {
        return addressing(function() {
            illegalOpcode("RLA");
            var val = data;
            var oldC = C;
            setC(val & 0x80);		// bit 7 was set
            val = ((val << 1) | oldC) & 255;
            data = val;
            A &= val;
            setZ(val);              // TODO Verify. May be A instead of val in the flags setting
            setN(val);
        });
    }

    function uRRA(addressing) {
        return addressing(function() {
            illegalOpcode("RRA");
            var val = data;
            var oldC = C ? 0x80 : 0;
            setC(val & 0x01);		// bit 0 was set
            val = (val >>> 1) | oldC;
            data = val;
            // RRA is the same as ADC from here
            if (D) {
                var operand = data;
                var AL = (A & 15) + (operand & 15) + C;
                if (AL > 9) { AL += 6; }
                var AH = ((A >> 4) + (operand >> 4) + ((AL > 15)?1:0)) << 4;
                setZ((A + operand + C) & 255);
                setN(AH);
                setV(((A ^AH) & ~(A ^ operand)) & 128);
                if (AH > 0x9f) { AH += 0x60; }
                setC(AH > 255);
                A = (AH | (AL & 15)) & 255;
            } else {
                var add = A + data + C;
                setC(add > 255);
                setV(((A ^ add) & (data ^ add)) & 0x80);
                A = add & 255;
                setZ(A);
                setN(A);
            }
        });
    }

    function uSLO(addressing) {
        return addressing(function() {
            illegalOpcode("SLO");
            var val = data;
            setC(val & 0x80);		// bit 7 was set
            val = (val << 1) & 255;
            data = val;
            val = A | val;
            A = val;
            setZ(val);
            setN(val);
        });
    }

    function uSRE(addressing) {
        return addressing(function() {
            illegalOpcode("SRE");
            var val = data;
            setC(val & 0x01);		// bit 0 was set
            val = val >>> 1;
            data = val;
            val = (A ^ val) & 255;
            A = val;
            setZ(val);
            setN(val);
        });
    }


    // Miscellaneous operations

    function PHA() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchOpcodeAndDiscard,
            function() { pushToStack(A); },
            fetchNextOpcode
        ];
    }

    function PHP() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchOpcodeAndDiscard,
            function() { pushToStack(getStatusBits()); },
            fetchNextOpcode
        ];
    }

    function PLA() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchOpcodeAndDiscard,
            peekFromStack,
            function() {
                A = popFromStack();
                setZ(A);
                setN(A);
            },
            fetchNextOpcode
        ];
    }

    function PLP() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchOpcodeAndDiscard,
            peekFromStack,
            function() { setStatusBits(popFromStack()); },
            fetchNextOpcode
        ];
    }

    // 65C02 PHX / PHY / PLX / PLY
    function PHX() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchOpcodeAndDiscard,
            function() { pushToStack(X); },
            fetchNextOpcode
        ];
    }

    function PHY() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchOpcodeAndDiscard,
            function() { pushToStack(Y); },
            fetchNextOpcode
        ];
    }

    function PLX() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchOpcodeAndDiscard,
            peekFromStack,
            function() {
                X = popFromStack();
                setZ(X);
                setN(X);
            },
            fetchNextOpcode
        ];
    }

    function PLY() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchOpcodeAndDiscard,
            peekFromStack,
            function() {
                Y = popFromStack();
                setZ(Y);
                setN(Y);
            },
            fetchNextOpcode
        ];
    }

    function JSR() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchADL,
            peekFromStack,
            function() { pushToStack((PC >>> 8)  & 0xff); },
            function() { pushToStack(PC & 0xff); },
            fetchADH,
            function() { PC = AD; fetchNextOpcode(); }
        ];
    }

    function BRK() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchDataFromImmediate,                 // For debugging purposes, use operand as an arg for BRK!
            function() {
                if (self.debug) self.breakpoint("BRK " + data);
                pushToStack((PC >>> 8) & 0xff);
            },
            function() { pushToStack(PC & 0xff); },
            function() { pushToStack(getStatusBits()); }, // set B flag
            function() { AD = bus.read(IRQ_VECTOR); },
            function() { AD |= bus.read(IRQ_VECTOR + 1) << 8; },
            function() { PC = AD; I = 1; fetchNextOpcode(); }
        ];
    }

    function IRQ() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchDataFromImmediate,                 // For debugging purposes, use operand as an arg for BRK!
            function() {
                if (self.debug) self.breakpoint("IRQ " + data);
                pushToStack((PC >>> 8) & 0xff);
            },
            function() { pushToStack(PC & 0xff); },
            function() { pushToStack(getStatusBits() & ~0x10); }, // no BRK flag
            function() { AD = bus.read(IRQ_VECTOR); },
            function() { AD |= bus.read(IRQ_VECTOR + 1) << 8; },
            function() { PC = AD; fetchNextOpcode(); }
        ];
    }

    function NMI() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchDataFromImmediate,
            function() {
                if (self.debug) self.breakpoint("NMI " + data);
                pushToStack((PC >>> 8) & 0xff);
            },
            function() { pushToStack(PC & 0xff); },
            function() { pushToStack(getStatusBits() & ~0x10); }, // no BRK flag
            function() { AD = bus.read(NMI_VECTOR); },
            function() { AD |= bus.read(NMI_VECTOR + 1) << 8; },
            function() { PC = AD; fetchNextOpcode(); }
        ];
    }

    function RTI() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchOpcodeAndDiscard,
            peekFromStack,
            function() { setStatusBits(popFromStack()); },
            function() { AD = popFromStack(); },
            function() { AD |= popFromStack() << 8; },
            function() { PC = AD; fetchNextOpcode(); }
        ];
    }

    function RTS() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchOpcodeAndDiscard,
            peekFromStack,
            function() { AD = popFromStack(); },
            function() { AD |= popFromStack() << 8; },
            function() { PC = AD; fetchDataFromImmediate(); },
            fetchNextOpcode
        ];
    }

    function JMP_ABS() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchADL,
            fetchADH,
            function() { PC = AD; fetchNextOpcode(); }
        ];
    }

    function JMP_IND() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchIAL,                           // IAH will be zero
            fetchIAH,
            fetchBALFromIA,
            function() {
                add1toIAL();
                fetchBAHFromIA();
            },
            function() { PC = BA; fetchNextOpcode(); }
        ];
    }

    // 65C02 fixes the NMOS "JMP ($xxFF)" page-wrap bug: the pointer's high byte
    // is now fetched from a properly carried address, at the cost of one extra cycle.
    function JMP_IND_CMOS() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchIAL,
            fetchIAH,
            fetchOpcodeAndDiscard,
            fetchBALFromIA,
            function() {
                IA = (IA + 1) & 0xffff;
                fetchBAHFromIA();
            },
            function() { PC = BA; fetchNextOpcode(); }
        ];
    }

    // 65C02 JMP ($xxxx,X) (opcode 0x7C)
    function JMP_ABS_X() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchIAL,
            fetchIAH,
            fetchOpcodeAndDiscard,
            function() { IA = (IA + X) & 0xffff; },
            fetchBALFromIA,
            function() {
                IA = (IA + 1) & 0xffff;
                fetchBAHFromIA();
            },
            function() { PC = BA; fetchNextOpcode(); }
        ];
    }

    // 65C02 BRA (unconditional branch, opcode 0x80)
    function BRA() {
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchBranchOffset,
            function() {
                fetchOpcodeAndDiscard();
                addBranchOffsetToPCL();
            },
            function() {
                if (branchOffsetCrossAdjust) {
                    fetchOpcodeAndDiscard();
                    adjustPCHForBranchOffsetCross();
                } else {
                    fetchNextOpcode();
                }
            },
            fetchNextOpcode
        ];
    }

    function Bxx(reg, cond) {
        var branchTaken;
        if      (reg === bZ) branchTaken = function() { return Z === cond; };
        else if (reg === bN) branchTaken = function() { return N === cond; };
        else if (reg === bC) branchTaken = function() { return C === cond; };
        else                 branchTaken = function() { return V === cond; };
        return [
            fetchOpcodeAndDecodeInstruction,
            fetchBranchOffset,
            function() {
                if (branchTaken()) {
                    fetchOpcodeAndDiscard();
                    addBranchOffsetToPCL();
                } else {
                    fetchNextOpcode();
                }
            },
            function() {
                if(branchOffsetCrossAdjust) {
                    fetchOpcodeAndDiscard();
                    adjustPCHForBranchOffsetCross();
                } else {
                    fetchNextOpcode();
                }
            },
            fetchNextOpcode
        ];
    }


    // Savestate  -------------------------------------------

    this.saveState = function():MOS6502State {
        return {
            PC: (PC-1) & 0xffff,
            A: A, X: X, Y: Y, SP: SP,
            N: N, V: V, D: D, I: I, Z: Z, C: C,
            T: T, o: opcode, R: RDY?1:0,
            d: data, AD: AD, BA: BA, BC: BALCrossed?1:0, IA: IA,
            bo: branchOffset, boa: branchOffsetCrossAdjust
        };
    };

    this.loadState = function(state:MOS6502State) {
        PC = (state.PC+1) & 0xffff;
        A = state.A; X = state.X; Y = state.Y; SP = state.SP;
        N = state.N; V = state.V; D = state.D; I = state.I; Z = state.Z; C = state.C;
        T = state.T; opcode = state.o; RDY = !!state.R;
        data = state.d; AD = state.AD; BA = state.BA; BALCrossed = !!state.BC; IA = state.IA;
        branchOffset = state.bo; branchOffsetCrossAdjust = state.boa;
        instruction = opcode < 0 ? [ fetchOpcodeAndDecodeInstruction ] : instructions[opcode];
    };


    // Accessory methods

    this.toString = function() {
        return "CPU " +
            " PC: " + PC.toString(16) + "  op: " + opcode.toString() + "  T: " + T + "  data: " + data + "\n" +
            " A: " + A.toString(16) + "  X: " + X.toString(16) + "  Y: " + Y.toString(16) + "  SP: " + SP.toString(16) + "     " +
            "N" + N + "  " + "V" + V + "  " + "D" + D + "  " + "I" + I + "  " + "Z" + Z + "  " + "C" + C + "  ";
    };

    this.breakpoint = function(mes) {
        //jt.Util.log(mes);
        if (this.trace) {
            var text = "CPU Breakpoint!  " + (mes ? "(" + mes + ")" : "") + "\n\n" + this.toString();
            //jt.Util.message(text);
        }
    };

    var cycletime = [
      7, 6, 0, 8, 3, 3, 5, 5, 3, 2, 2, 2, 4, 4, 6, 6,
      2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 0, 7, 4, 4, 7, 7,
      6, 6, 0, 8, 3, 3, 5, 5, 4, 2, 2, 2, 4, 4, 6, 6,
      2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 0, 7, 4, 4, 7, 7,
      6, 6, 0, 8, 3, 3, 5, 5, 3, 2, 2, 2, 3, 4, 6, 6,
      2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 0, 7, 4, 4, 7, 7,
      6, 6, 0, 8, 3, 3, 5, 5, 4, 2, 2, 2, 5, 4, 6, 6,
      2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 0, 7, 4, 4, 7, 7,
      0, 6, 0, 6, 3, 3, 3, 3, 2, 0, 2, 0, 4, 4, 4, 4,
      2, 6, 0, 0, 4, 4, 4, 4, 2, 5, 2, 0, 0, 5, 0, 0,
      2, 6, 2, 6, 3, 3, 3, 3, 2, 2, 2, 0, 4, 4, 4, 4,
      2, 5, 0, 5, 4, 4, 4, 4, 2, 4, 2, 0, 4, 4, 4, 4,
      2, 6, 0, 8, 3, 3, 5, 5, 2, 2, 2, 2, 4, 4, 6, 6,
      2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 0, 7, 4, 4, 7, 7,
      2, 6, 0, 8, 3, 3, 5, 5, 2, 2, 2, 0, 4, 4, 6, 6,
      2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 0, 7, 4, 4, 7, 7
    ];

    var extracycles = [
      0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1,
      0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1,
      0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1,
      0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1,
      0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      2, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1,
      0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1,
      0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1
    ];

    var insnlengths = [
      1, 2, 0, 2, 2, 2, 2, 2, 1, 2, 1, 2, 3, 3, 3, 3,
      2, 2, 0, 2, 2, 2, 2, 2, 1, 3, 0, 3, 3, 3, 3, 3,
      3, 2, 0, 2, 2, 2, 2, 2, 1, 2, 1, 2, 3, 3, 3, 3,
      2, 2, 0, 2, 2, 2, 2, 2, 1, 3, 0, 3, 3, 3, 3, 3,
      1, 2, 0, 2, 2, 2, 2, 2, 1, 2, 1, 2, 3, 3, 3, 3,
      2, 2, 0, 2, 2, 2, 2, 2, 1, 3, 0, 3, 3, 3, 3, 3,
      1, 2, 0, 2, 2, 2, 2, 2, 1, 2, 1, 2, 3, 3, 3, 3,
      2, 2, 0, 2, 2, 2, 2, 2, 1, 3, 0, 3, 3, 3, 3, 3,
      0, 2, 0, 2, 2, 2, 2, 2, 1, 0, 1, 0, 3, 3, 3, 3,
      2, 2, 0, 0, 2, 2, 2, 3, 1, 3, 1, 0, 0, 3, 0, 0,
      2, 2, 2, 2, 2, 2, 2, 2, 1, 2, 1, 0, 3, 3, 3, 3,
      2, 2, 0, 2, 2, 2, 2, 2, 1, 3, 1, 0, 3, 3, 3, 3,
      2, 2, 0, 2, 2, 2, 2, 2, 1, 2, 1, 2, 3, 3, 3, 3,
      2, 2, 0, 2, 2, 2, 2, 2, 1, 3, 0, 3, 3, 3, 3, 3,
      2, 2, 0, 2, 2, 2, 2, 2, 1, 2, 1, 0, 3, 3, 3, 3,
      2, 2, 0, 2, 2, 2, 2, 2, 1, 3, 0, 3, 3, 3, 3, 3
    ];

    var validinsns = [
      1, 2, 0, 0, 0, 2, 2, 0, 1, 2, 1, 0, 0, 3, 3, 0,
      2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0,
      3, 2, 0, 0, 2, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0,
      2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0,
      1, 2, 0, 0, 0, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0,
      2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0,
      1, 2, 0, 0, 0, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0,
      2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0,
      0, 2, 0, 0, 2, 2, 2, 0, 1, 0, 1, 0, 3, 3, 3, 0,
      2, 2, 0, 0, 2, 2, 2, 0, 1, 3, 1, 0, 0, 3, 0, 0,
      2, 2, 2, 0, 2, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0,
      2, 2, 0, 0, 2, 2, 2, 0, 1, 3, 1, 0, 3, 3, 3, 0,
      2, 2, 0, 0, 2, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0,
      2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0,
      2, 2, 0, 0, 2, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0,
      2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0
    ];

    // Variant hook  -------------------------------------------
    // Lets a subclass (e.g. 65C02) override specific opcode-table slots in place,
    // without duplicating these tables. See MOS65C02.ts.
    if (patchFn) {
        patchFn({
            opcodes: opcodes, instructions: instructions,
            cycletime: cycletime, extracycles: extracycles,
            insnlengths: insnlengths, validinsns: validinsns,
            rX: rX, rY: rY,
            implied: implied, immediateRead: immediateRead,
            zeroPageRead: zeroPageRead, absoluteRead: absoluteRead,
            zeroPageIndexedRead: zeroPageIndexedRead, absoluteIndexedRead: absoluteIndexedRead,
            indirectXRead: indirectXRead, indirectYRead: indirectYRead, zeroPageIndirectRead: zeroPageIndirectRead,
            zeroPageWrite: zeroPageWrite, absoluteWrite: absoluteWrite,
            zeroPageIndexedWrite: zeroPageIndexedWrite, absoluteIndexedWrite: absoluteIndexedWrite,
            zeroPageIndirectWrite: zeroPageIndirectWrite,
            zeroPageReadModifyWrite: zeroPageReadModifyWrite, absoluteReadModifyWrite: absoluteReadModifyWrite,
            zeroPageIndexedReadModifyWrite: zeroPageIndexedReadModifyWrite,
            absoluteIndexedReadModifyWrite: absoluteIndexedReadModifyWrite,
            ORA: ORA, AND: AND, EOR: EOR, ADC: ADC, SBC: SBC, CMP: CMP,
            LDA: LDA, STA: STA, BIT: BIT, ASL: ASL, LSR: LSR, ROL: ROL, ROR: ROR, INC: INC, DEC: DEC,
            STZ: STZ, TSB: TSB, TRB: TRB,
            PHX: PHX, PHY: PHY, PLX: PLX, PLY: PLY,
            BRA: BRA, INC_ACC: INC_ACC, DEC_ACC: DEC_ACC, BIT_IMM: BIT_IMM,
            JMP_IND_CMOS: JMP_IND_CMOS, JMP_ABS_X: JMP_ABS_X,
            NOP: NOP,
        });
    }

    this.getOpcodeMetadata = function(opcode, address) {
      // TODO: more intelligent maximum cycles
      //var i = instructions[opcode];
      return {
        opcode:opcode,
        mnenomic:opcodes[opcode],
        minCycles:cycletime[opcode],
        maxCycles:cycletime[opcode] + extracycles[opcode],
        insnlength:insnlengths[opcode]
      };
    }

    // only call when isPCStable() is true
    this.setNMI = function() {
      instruction = NMI();
      T = 1;
      PC = (PC-1) & 0xffff;
    }
    this.setIRQ = function() {
      if (!I) { // only if not disabled
        instruction = IRQ();
        T = 1;
        PC = (PC-1) & 0xffff;
      }
    }

    this.getSP = function() { return SP; }
    this.getPC = function() { return (PC-1) & 0xffff; }
    this.getT = function() { return T; }
    this.isHalted = function() { return opcodes[opcode] == "uKIL"; }
    
    this.isPCStable = function() {
      return T == 0;
    }
};

export interface MOS6502State {
PC : number;
SP : number;
A : number;
X : number;
Y : number;
N : number;
V : number;
D : number;
I : number;
Z : number;
C : number;
T : number;
o : number;
R : number;
d : number;
AD : number;
BA : number;
BC : number;
IA : number;
bo : number;
boa : number;
}

export enum MOS6502Interrupts { None=0, NMI=1, IRQ=2 };

export class MOS6502 implements CPU, ClockBased, SavesState<MOS6502State>, Interruptable<MOS6502Interrupts> {

  cpu;
  interruptType : MOS6502Interrupts = MOS6502Interrupts.None;

  // A subclass (e.g. MOS65C02) can pass a patch function to override specific opcode-table
  // slots; plain `new MOS6502()` keeps the default NMOS 6502 behavior unchanged.
  constructor(patchFn?: (ctx: MOS6502PatchContext) => void) {
    this.cpu = new _MOS6502(patchFn);
  }

  connectMemoryBus(bus:Bus) {
    this.cpu.connectBus(bus);
  }
  advanceClock() {
    if (this.interruptType && this.isStable()) {
      switch (this.interruptType) {
        case MOS6502Interrupts.NMI: this.cpu.setNMI(); break;
        case MOS6502Interrupts.IRQ: this.cpu.setIRQ(); break;
      }
      this.interruptType = 0;
    }
    this.cpu.clockPulse();
  }
  advanceInsn() {
    do {
      this.advanceClock();
    } while (!this.isStable());
  }
  reset() {
    this.cpu.reset();
    this.interruptType = 0;
  }
  interrupt(itype:number) {
    if (this.interruptType != MOS6502Interrupts.NMI) {
        this.interruptType = itype;
    }
  }
  NMI() {
    this.interrupt(MOS6502Interrupts.NMI);
  }
  IRQ() {
    this.interrupt(MOS6502Interrupts.IRQ);
  }
  getSP() {
    return this.cpu.getSP();
  }
  getPC() {
    return this.cpu.getPC();
  }
  isHalted() {
    return this.cpu.isHalted();
  }
  saveState() {
    var s = this.cpu.saveState();
    s.it = this.interruptType;
    return s;
  }
  loadState(s) {
    this.cpu.loadState(s);
    this.interruptType = s.it;
  }
  isStable() : boolean {
    return this.cpu.isPCStable();
  }
  getOpcodeMetadata(op: number) {
    return this.cpu.getOpcodeMetadata(op);
  }
}
