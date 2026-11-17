
import { hex } from "../util";

/// One entry of a 6502-family opcode table: mnemonic, addressing mode (a string
/// with `aa`/`AAAA`/`branch` placeholders), byte length, illegal-on-NMOS flag,
/// base cycles, extra cycles, writes, branch and flags-modified mask.
export interface Op6502 {
  mn: string; am: string; nb: number; il: number;
  c1: number; c2: number; nw: number; br: number; mod: string;
}

export var OPS_6502: Op6502[] = [
  {mn:"BRK",am:"",nb:1,il:0,c1:7,c2:0,nw:3,br:1,mod:"SI"}, // 0
  {mn:"ORA",am:"(aa,x)",nb:2,il:0,c1:6,c2:0,nw:0,br:0,mod:"AZN"}, // 1
  {mn:"KIL",am:"",nb:1,il:2,c1:3,c2:0,nw:0,br:1,mod:""}, // 2
  {mn:"SLO",am:"(aa,x)",nb:2,il:1,c1:8,c2:0,nw:2,br:0,mod:"ACZN"}, // 3
  {mn:"NOP",am:"aa",nb:2,il:1,c1:3,c2:0,nw:0,br:0,mod:""}, // 4
  {mn:"ORA",am:"aa",nb:2,il:0,c1:3,c2:0,nw:0,br:0,mod:"AZN"}, // 5
  {mn:"ASL",am:"aa",nb:2,il:0,c1:5,c2:0,nw:2,br:0,mod:"CZN"}, // 6
  {mn:"SLO",am:"aa",nb:2,il:1,c1:5,c2:0,nw:2,br:0,mod:"ACZN"}, // 7
  {mn:"PHP",am:"",nb:1,il:0,c1:3,c2:0,nw:1,br:0,mod:"S"}, // 8
  {mn:"ORA",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:"AZN"}, // 9
  {mn:"ASL",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"ACZN"}, // a
  {mn:"ANC",am:"#aa",nb:2,il:1,c1:2,c2:0,nw:0,br:0,mod:"ACZN"}, // b
  {mn:"NOP",am:"AAAA",nb:3,il:1,c1:3,c2:0,nw:0,br:0,mod:""}, // c
  {mn:"ORA",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:0,br:0,mod:"AZN"}, // d
  {mn:"ASL",am:"AAAA",nb:3,il:0,c1:6,c2:0,nw:2,br:0,mod:"CZN"}, // e
  {mn:"SLO",am:"AAAA",nb:3,il:1,c1:6,c2:0,nw:2,br:0,mod:"ACZN"}, // f
  {mn:"BPL",am:"branch",nb:2,il:0,c1:2,c2:2,nw:0,br:1,mod:""}, // 10
  {mn:"ORA",am:"(aa),y",nb:2,il:0,c1:5,c2:1,nw:0,br:0,mod:"AZN"}, // 11
  {mn:"KIL",am:"",nb:1,il:2,c1:3,c2:0,nw:0,br:1,mod:""}, // 12
  {mn:"SLO",am:"(aa),y",nb:2,il:1,c1:8,c2:0,nw:2,br:0,mod:"ACZN"}, // 13
  {mn:"NOP",am:"aa,x",nb:2,il:1,c1:4,c2:0,nw:0,br:0,mod:""}, // 14
  {mn:"ORA",am:"aa,x",nb:2,il:0,c1:4,c2:0,nw:0,br:0,mod:"AZN"}, // 15
  {mn:"ASL",am:"aa,x",nb:2,il:0,c1:6,c2:0,nw:2,br:0,mod:"CZN"}, // 16
  {mn:"SLO",am:"aa,x",nb:2,il:1,c1:6,c2:0,nw:2,br:0,mod:"ACZN"}, // 17
  {mn:"CLC",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"C"}, // 18
  {mn:"ORA",am:"AAAA,y",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"AZN"}, // 19
  {mn:"NOP",am:"",nb:1,il:1,c1:2,c2:0,nw:0,br:0,mod:""}, // 1a
  {mn:"SLO",am:"AAAA,y",nb:3,il:1,c1:7,c2:0,nw:2,br:0,mod:"ACZN"}, // 1b
  {mn:"NOP",am:"AAAA,x",nb:3,il:1,c1:4,c2:0,nw:0,br:0,mod:""}, // 1c
  {mn:"ORA",am:"AAAA,x",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"AZN"}, // 1d
  {mn:"ASL",am:"AAAA,x",nb:3,il:0,c1:7,c2:0,nw:2,br:0,mod:"CZN"}, // 1e
  {mn:"SLO",am:"AAAA,x",nb:3,il:1,c1:7,c2:0,nw:2,br:0,mod:"ACZN"}, // 1f
  {mn:"JSR",am:"AAAA",nb:3,il:0,c1:6,c2:0,nw:2,br:1,mod:"S"}, // 20
  {mn:"AND",am:"(aa,x)",nb:2,il:0,c1:6,c2:0,nw:0,br:0,mod:"AZN"}, // 21
  {mn:"KIL",am:"",nb:1,il:2,c1:3,c2:0,nw:0,br:1,mod:""}, // 22
  {mn:"RLA",am:"(aa,x)",nb:2,il:1,c1:8,c2:0,nw:2,br:0,mod:"ACZN"}, // 23
  {mn:"BIT",am:"aa",nb:2,il:0,c1:3,c2:0,nw:0,br:0,mod:"ZVN"}, // 24
  {mn:"AND",am:"aa",nb:2,il:0,c1:3,c2:0,nw:0,br:0,mod:"AZN"}, // 25
  {mn:"ROL",am:"aa",nb:2,il:0,c1:5,c2:0,nw:2,br:0,mod:"CZN"}, // 26
  {mn:"RLA",am:"aa",nb:2,il:1,c1:5,c2:0,nw:2,br:0,mod:"ACZN"}, // 27
  {mn:"PLP",am:"",nb:1,il:0,c1:4,c2:0,nw:0,br:0,mod:"SCZIDVN"}, // 28
  {mn:"AND",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:"AZN"}, // 29
  {mn:"ROL",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"ACZN"}, // 2a
  {mn:"ANC",am:"#aa",nb:2,il:1,c1:2,c2:0,nw:0,br:0,mod:"ACZN"}, // 2b
  {mn:"BIT",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:0,br:0,mod:"ZVN"}, // 2c
  {mn:"AND",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:0,br:0,mod:"AZN"}, // 2d
  {mn:"ROL",am:"AAAA",nb:3,il:0,c1:6,c2:0,nw:2,br:0,mod:"CZN"}, // 2e
  {mn:"RLA",am:"AAAA",nb:3,il:1,c1:6,c2:0,nw:2,br:0,mod:"ACZN"}, // 2f
  {mn:"BMI",am:"branch",nb:2,il:0,c1:2,c2:2,nw:0,br:1,mod:""}, // 30
  {mn:"AND",am:"(aa),y",nb:2,il:0,c1:5,c2:1,nw:0,br:0,mod:"AZN"}, // 31
  {mn:"KIL",am:"",nb:1,il:2,c1:3,c2:0,nw:0,br:1,mod:""}, // 32
  {mn:"RLA",am:"(aa),y",nb:2,il:1,c1:8,c2:0,nw:2,br:0,mod:"ACZN"}, // 33
  {mn:"NOP",am:"aa,x",nb:2,il:1,c1:4,c2:0,nw:0,br:0,mod:""}, // 34
  {mn:"AND",am:"aa,x",nb:2,il:0,c1:4,c2:0,nw:0,br:0,mod:"AZN"}, // 35
  {mn:"ROL",am:"aa,x",nb:2,il:0,c1:6,c2:0,nw:2,br:0,mod:"CZN"}, // 36
  {mn:"RLA",am:"aa,x",nb:2,il:1,c1:6,c2:0,nw:2,br:0,mod:"ACZN"}, // 37
  {mn:"SEC",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"C"}, // 38
  {mn:"AND",am:"AAAA,y",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"AZN"}, // 39
  {mn:"NOP",am:"",nb:1,il:1,c1:2,c2:0,nw:0,br:0,mod:""}, // 3a
  {mn:"RLA",am:"AAAA,y",nb:3,il:1,c1:7,c2:0,nw:2,br:0,mod:"ACZN"}, // 3b
  {mn:"NOP",am:"AAAA,x",nb:3,il:1,c1:4,c2:0,nw:0,br:0,mod:""}, // 3c
  {mn:"AND",am:"AAAA,x",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"AZN"}, // 3d
  {mn:"ROL",am:"AAAA,x",nb:3,il:0,c1:7,c2:0,nw:2,br:0,mod:"CZN"}, // 3e
  {mn:"RLA",am:"AAAA,x",nb:3,il:1,c1:7,c2:0,nw:2,br:0,mod:"ACZN"}, // 3f
  {mn:"RTI",am:"",nb:1,il:0,c1:6,c2:0,nw:0,br:1,mod:"SCZIDVN"}, // 40
  {mn:"EOR",am:"(aa,x)",nb:2,il:0,c1:6,c2:0,nw:0,br:0,mod:"AZN"}, // 41
  {mn:"KIL",am:"",nb:1,il:2,c1:3,c2:0,nw:0,br:1,mod:""}, // 42
  {mn:"SRE",am:"(aa,x)",nb:2,il:1,c1:8,c2:0,nw:2,br:0,mod:"ACZN"}, // 43
  {mn:"NOP",am:"aa",nb:2,il:1,c1:3,c2:0,nw:0,br:0,mod:""}, // 44
  {mn:"EOR",am:"aa",nb:2,il:0,c1:3,c2:0,nw:0,br:0,mod:"AZN"}, // 45
  {mn:"LSR",am:"aa",nb:2,il:0,c1:5,c2:0,nw:2,br:0,mod:"CZN"}, // 46
  {mn:"SRE",am:"aa",nb:2,il:1,c1:5,c2:0,nw:2,br:0,mod:"ACZN"}, // 47
  {mn:"PHA",am:"",nb:1,il:0,c1:3,c2:0,nw:1,br:0,mod:"S"}, // 48
  {mn:"EOR",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:"AZN"}, // 49
  {mn:"LSR",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"ACZN"}, // 4a
  {mn:"ASR",am:"#aa",nb:2,il:1,c1:2,c2:0,nw:0,br:0,mod:"ACZN"}, // 4b
  {mn:"JMP",am:"AAAA",nb:3,il:0,c1:3,c2:0,nw:0,br:1,mod:""}, // 4c
  {mn:"EOR",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:0,br:0,mod:"AZN"}, // 4d
  {mn:"LSR",am:"AAAA",nb:3,il:0,c1:6,c2:0,nw:2,br:0,mod:"CZN"}, // 4e
  {mn:"SRE",am:"AAAA",nb:3,il:1,c1:6,c2:0,nw:2,br:0,mod:"ACZN"}, // 4f
  {mn:"BVC",am:"branch",nb:2,il:0,c1:2,c2:2,nw:0,br:1,mod:""}, // 50
  {mn:"EOR",am:"(aa),y",nb:2,il:0,c1:5,c2:1,nw:0,br:0,mod:"AZN"}, // 51
  {mn:"KIL",am:"",nb:1,il:2,c1:3,c2:0,nw:0,br:1,mod:""}, // 52
  {mn:"SRE",am:"(aa),y",nb:2,il:1,c1:8,c2:0,nw:2,br:0,mod:"ACZN"}, // 53
  {mn:"NOP",am:"aa,x",nb:2,il:1,c1:4,c2:0,nw:0,br:0,mod:""}, // 54
  {mn:"EOR",am:"aa,x",nb:2,il:0,c1:4,c2:0,nw:0,br:0,mod:"AZN"}, // 55
  {mn:"LSR",am:"aa,x",nb:2,il:0,c1:6,c2:0,nw:2,br:0,mod:"CZN"}, // 56
  {mn:"SRE",am:"aa,x",nb:2,il:1,c1:6,c2:0,nw:2,br:0,mod:"ACZN"}, // 57
  {mn:"CLI",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"I"}, // 58
  {mn:"EOR",am:"AAAA,y",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"AZN"}, // 59
  {mn:"NOP",am:"",nb:1,il:1,c1:2,c2:0,nw:0,br:0,mod:""}, // 5a
  {mn:"SRE",am:"AAAA,y",nb:3,il:1,c1:7,c2:0,nw:2,br:0,mod:"ACZN"}, // 5b
  {mn:"NOP",am:"AAAA,x",nb:3,il:1,c1:4,c2:0,nw:0,br:0,mod:""}, // 5c
  {mn:"EOR",am:"AAAA,x",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"AZN"}, // 5d
  {mn:"LSR",am:"AAAA,x",nb:3,il:0,c1:7,c2:0,nw:2,br:0,mod:"CZN"}, // 5e
  {mn:"SRE",am:"AAAA,x",nb:3,il:1,c1:7,c2:0,nw:2,br:0,mod:"ACZN"}, // 5f
  {mn:"RTS",am:"",nb:1,il:0,c1:6,c2:0,nw:0,br:1,mod:"S"}, // 60
  {mn:"ADC",am:"(aa,x)",nb:2,il:0,c1:6,c2:0,nw:0,br:0,mod:"ACZVN"}, // 61
  {mn:"KIL",am:"",nb:1,il:2,c1:3,c2:0,nw:0,br:1,mod:""}, // 62
  {mn:"RRA",am:"(aa,x)",nb:2,il:1,c1:8,c2:0,nw:2,br:0,mod:"ACZVN"}, // 63
  {mn:"NOP",am:"aa",nb:2,il:1,c1:3,c2:0,nw:0,br:0,mod:""}, // 64
  {mn:"ADC",am:"aa",nb:2,il:0,c1:3,c2:0,nw:0,br:0,mod:"ACZVN"}, // 65
  {mn:"ROR",am:"aa",nb:2,il:0,c1:5,c2:0,nw:2,br:0,mod:"CZN"}, // 66
  {mn:"RRA",am:"aa",nb:2,il:1,c1:5,c2:0,nw:2,br:0,mod:"ACZVN"}, // 67
  {mn:"PLA",am:"",nb:1,il:0,c1:4,c2:0,nw:0,br:0,mod:"SAZN"}, // 68
  {mn:"ADC",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:"ACZVN"}, // 69
  {mn:"ROR",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"ACZN"}, // 6a
  {mn:"ARR",am:"#aa",nb:2,il:1,c1:2,c2:0,nw:0,br:0,mod:"ACZVN"}, // 6b
  {mn:"JMP",am:"(AAAA)",nb:3,il:0,c1:5,c2:0,nw:0,br:1,mod:""}, // 6c
  {mn:"ADC",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:0,br:0,mod:"ACZVN"}, // 6d
  {mn:"ROR",am:"AAAA",nb:3,il:0,c1:6,c2:0,nw:2,br:0,mod:"CZN"}, // 6e
  {mn:"RRA",am:"AAAA",nb:3,il:1,c1:6,c2:0,nw:2,br:0,mod:"ACZVN"}, // 6f
  {mn:"BVS",am:"branch",nb:2,il:0,c1:2,c2:2,nw:0,br:1,mod:""}, // 70
  {mn:"ADC",am:"(aa),y",nb:2,il:0,c1:5,c2:1,nw:0,br:0,mod:"ACZVN"}, // 71
  {mn:"KIL",am:"",nb:1,il:2,c1:3,c2:0,nw:0,br:1,mod:""}, // 72
  {mn:"RRA",am:"(aa),y",nb:2,il:1,c1:8,c2:0,nw:2,br:0,mod:"ACZVN"}, // 73
  {mn:"NOP",am:"aa,x",nb:2,il:1,c1:4,c2:0,nw:0,br:0,mod:""}, // 74
  {mn:"ADC",am:"aa,x",nb:2,il:0,c1:4,c2:0,nw:0,br:0,mod:"ACZVN"}, // 75
  {mn:"ROR",am:"aa,x",nb:2,il:0,c1:6,c2:0,nw:2,br:0,mod:"CZN"}, // 76
  {mn:"RRA",am:"aa,x",nb:2,il:1,c1:6,c2:0,nw:2,br:0,mod:"ACZVN"}, // 77
  {mn:"SEI",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"I"}, // 78
  {mn:"ADC",am:"AAAA,y",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"ACZVN"}, // 79
  {mn:"NOP",am:"",nb:1,il:1,c1:2,c2:0,nw:0,br:0,mod:""}, // 7a
  {mn:"RRA",am:"AAAA,y",nb:3,il:1,c1:7,c2:0,nw:2,br:0,mod:"ACZVN"}, // 7b
  {mn:"NOP",am:"AAAA,x",nb:3,il:1,c1:4,c2:0,nw:0,br:0,mod:""}, // 7c
  {mn:"ADC",am:"AAAA,x",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"ACZVN"}, // 7d
  {mn:"ROR",am:"AAAA,x",nb:3,il:0,c1:7,c2:0,nw:2,br:0,mod:"CZN"}, // 7e
  {mn:"RRA",am:"AAAA,x",nb:3,il:1,c1:7,c2:0,nw:2,br:0,mod:"ACZVN"}, // 7f
  {mn:"NOP",am:"#aa",nb:2,il:1,c1:2,c2:0,nw:0,br:0,mod:""}, // 80
  {mn:"STA",am:"(aa,x)",nb:2,il:0,c1:6,c2:0,nw:1,br:0,mod:""}, // 81
  {mn:"NOP",am:"#aa",nb:2,il:1,c1:2,c2:0,nw:0,br:0,mod:""}, // 82
  {mn:"SAX",am:"(aa,x)",nb:2,il:1,c1:6,c2:0,nw:1,br:0,mod:""}, // 83
  {mn:"STY",am:"aa",nb:2,il:0,c1:3,c2:0,nw:1,br:0,mod:""}, // 84
  {mn:"STA",am:"aa",nb:2,il:0,c1:3,c2:0,nw:1,br:0,mod:""}, // 85
  {mn:"STX",am:"aa",nb:2,il:0,c1:3,c2:0,nw:1,br:0,mod:""}, // 86
  {mn:"SAX",am:"aa",nb:2,il:1,c1:3,c2:0,nw:1,br:0,mod:""}, // 87
  {mn:"DEY",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"YZN"}, // 88
  {mn:"NOP",am:"#aa",nb:2,il:1,c1:2,c2:0,nw:0,br:0,mod:""}, // 89
  {mn:"TXA",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"AZN"}, // 8a
  {mn:"ANE",am:"#aa",nb:2,il:1,c1:2,c2:0,nw:0,br:0,mod:"AZN"}, // 8b
  {mn:"STY",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:1,br:0,mod:""}, // 8c
  {mn:"STA",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:1,br:0,mod:""}, // 8d
  {mn:"STX",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:1,br:0,mod:""}, // 8e
  {mn:"SAX",am:"AAAA",nb:3,il:1,c1:4,c2:0,nw:1,br:0,mod:""}, // 8f
  {mn:"BCC",am:"branch",nb:2,il:0,c1:2,c2:2,nw:0,br:1,mod:""}, // 90
  {mn:"STA",am:"(aa),y",nb:2,il:0,c1:6,c2:0,nw:1,br:0,mod:""}, // 91
  {mn:"KIL",am:"",nb:1,il:2,c1:3,c2:0,nw:0,br:1,mod:""}, // 92
  {mn:"SHA",am:"(aa),y",nb:2,il:1,c1:6,c2:0,nw:1,br:0,mod:""}, // 93
  {mn:"STY",am:"aa,x",nb:2,il:0,c1:4,c2:0,nw:1,br:0,mod:""}, // 94
  {mn:"STA",am:"aa,x",nb:2,il:0,c1:4,c2:0,nw:1,br:0,mod:""}, // 95
  {mn:"STX",am:"aa,y",nb:2,il:0,c1:4,c2:0,nw:1,br:0,mod:""}, // 96
  {mn:"SAX",am:"aa,y",nb:3,il:1,c1:4,c2:0,nw:1,br:1,mod:""}, // 97
  {mn:"TYA",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"AZN"}, // 98
  {mn:"STA",am:"AAAA,y",nb:3,il:0,c1:5,c2:0,nw:1,br:0,mod:""}, // 99
  {mn:"TXS",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"S"}, // 9a
  {mn:"SHS",am:"AAAA,y",nb:3,il:1,c1:5,c2:0,nw:1,br:0,mod:"S"}, // 9b
  {mn:"SHY",am:"AAAA,x",nb:3,il:1,c1:5,c2:0,nw:1,br:0,mod:""}, // 9c
  {mn:"STA",am:"AAAA,x",nb:3,il:0,c1:5,c2:0,nw:1,br:0,mod:""}, // 9d
  {mn:"SHX",am:"AAAA,y",nb:3,il:1,c1:5,c2:0,nw:1,br:0,mod:""}, // 9e
  {mn:"SHA",am:"AAAA,y",nb:3,il:1,c1:5,c2:0,nw:1,br:0,mod:""}, // 9f
  {mn:"LDY",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:"YZN"}, // a0
  {mn:"LDA",am:"(aa,x)",nb:2,il:0,c1:6,c2:0,nw:0,br:0,mod:"AZN"}, // a1
  {mn:"LDX",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:"XZN"}, // a2
  {mn:"LAX",am:"(aa,x)",nb:2,il:1,c1:6,c2:0,nw:0,br:0,mod:"AXZN"}, // a3
  {mn:"LDY",am:"aa",nb:2,il:0,c1:3,c2:0,nw:0,br:0,mod:"YZN"}, // a4
  {mn:"LDA",am:"aa",nb:2,il:0,c1:3,c2:0,nw:0,br:0,mod:"AZN"}, // a5
  {mn:"LDX",am:"aa",nb:2,il:0,c1:3,c2:0,nw:0,br:0,mod:"XZN"}, // a6
  {mn:"LAX",am:"aa",nb:2,il:1,c1:3,c2:0,nw:0,br:0,mod:"AXZN"}, // a7
  {mn:"TAY",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"YZN"}, // a8
  {mn:"LDA",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:"AZN"}, // a9
  {mn:"TAX",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"XZN"}, // aa
  {mn:"LXA",am:"#aa",nb:2,il:1,c1:2,c2:0,nw:0,br:0,mod:"AXZN"}, // ab
  {mn:"LDY",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:0,br:0,mod:"YZN"}, // ac
  {mn:"LDA",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:0,br:0,mod:"AZN"}, // ad
  {mn:"LDX",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:0,br:0,mod:"XZN"}, // ae
  {mn:"LAX",am:"AAAA",nb:3,il:1,c1:4,c2:0,nw:0,br:0,mod:"AXZN"}, // af
  {mn:"BCS",am:"branch",nb:2,il:0,c1:2,c2:2,nw:0,br:1,mod:""}, // b0
  {mn:"LDA",am:"(aa),y",nb:2,il:0,c1:5,c2:1,nw:0,br:0,mod:"AZN"}, // b1
  {mn:"KIL",am:"",nb:1,il:2,c1:3,c2:0,nw:0,br:1,mod:""}, // b2
  {mn:"LAX",am:"(aa),y",nb:2,il:1,c1:5,c2:1,nw:0,br:0,mod:"AXZN"}, // b3
  {mn:"LDY",am:"aa,x",nb:2,il:0,c1:4,c2:0,nw:0,br:0,mod:"YZN"}, // b4
  {mn:"LDA",am:"aa,x",nb:2,il:0,c1:4,c2:0,nw:0,br:0,mod:"AZN"}, // b5
  {mn:"LDX",am:"aa,y",nb:2,il:0,c1:4,c2:0,nw:0,br:0,mod:"XZN"}, // b6
  {mn:"LAX",am:"aa,y",nb:2,il:1,c1:4,c2:0,nw:0,br:0,mod:"AXZN"}, // b7
  {mn:"CLV",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"V"}, // b8
  {mn:"LDA",am:"AAAA,y",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"AZN"}, // b9
  {mn:"TSX",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"XZN"}, // ba
  {mn:"LAS",am:"AAAA,y",nb:3,il:1,c1:4,c2:1,nw:0,br:0,mod:"SAXZN"}, // bb
  {mn:"LDY",am:"AAAA,x",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"YZN"}, // bc
  {mn:"LDA",am:"AAAA,x",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"AZN"}, // bd
  {mn:"LDX",am:"AAAA,y",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"XZN"}, // be
  {mn:"LAX",am:"AAAA,y",nb:3,il:1,c1:4,c2:1,nw:0,br:0,mod:"AXZN"}, // bf
  {mn:"CPY",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:"CZN"}, // c0
  {mn:"CMP",am:"(aa,x)",nb:2,il:0,c1:6,c2:0,nw:0,br:0,mod:"CZN"}, // c1
  {mn:"NOP",am:"#aa",nb:2,il:1,c1:2,c2:0,nw:0,br:0,mod:""}, // c2
  {mn:"DCP",am:"(aa,x)",nb:2,il:1,c1:8,c2:0,nw:2,br:0,mod:"CZN"}, // c3
  {mn:"CPY",am:"aa",nb:2,il:0,c1:3,c2:0,nw:0,br:0,mod:"CZN"}, // c4
  {mn:"CMP",am:"aa",nb:2,il:0,c1:3,c2:0,nw:0,br:0,mod:"CZN"}, // c5
  {mn:"DEC",am:"aa",nb:2,il:0,c1:5,c2:0,nw:2,br:0,mod:"ZN"}, // c6
  {mn:"DCP",am:"aa",nb:2,il:1,c1:5,c2:0,nw:2,br:0,mod:"CZN"}, // c7
  {mn:"INY",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"YZN"}, // c8
  {mn:"CMP",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:"CZN"}, // c9
  {mn:"DEX",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"XZN"}, // ca
  {mn:"SBX",am:"#aa",nb:2,il:1,c1:2,c2:0,nw:0,br:0,mod:"XCZN"}, // cb
  {mn:"CPY",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:0,br:0,mod:"CZN"}, // cc
  {mn:"CMP",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:0,br:0,mod:"CZN"}, // cd
  {mn:"DEC",am:"AAAA",nb:3,il:0,c1:6,c2:0,nw:2,br:0,mod:"ZN"}, // ce
  {mn:"DCP",am:"AAAA",nb:3,il:1,c1:6,c2:0,nw:2,br:0,mod:"CZN"}, // cf
  {mn:"BNE",am:"branch",nb:2,il:0,c1:2,c2:2,nw:0,br:1,mod:""}, // d0
  {mn:"CMP",am:"(aa),y",nb:2,il:0,c1:5,c2:1,nw:0,br:0,mod:"CZN"}, // d1
  {mn:"KIL",am:"",nb:1,il:2,c1:3,c2:0,nw:0,br:1,mod:""}, // d2
  {mn:"DCP",am:"(aa),y",nb:2,il:1,c1:8,c2:0,nw:2,br:0,mod:"CZN"}, // d3
  {mn:"NOP",am:"aa,x",nb:2,il:1,c1:4,c2:0,nw:0,br:0,mod:""}, // d4
  {mn:"CMP",am:"aa,x",nb:2,il:0,c1:4,c2:0,nw:0,br:0,mod:"CZN"}, // d5
  {mn:"DEC",am:"aa,x",nb:2,il:0,c1:6,c2:0,nw:2,br:0,mod:"ZN"}, // d6
  {mn:"DCP",am:"aa,x",nb:2,il:1,c1:6,c2:0,nw:2,br:0,mod:"CZN"}, // d7
  {mn:"CLD",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"D"}, // d8
  {mn:"CMP",am:"AAAA,y",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"CZN"}, // d9
  {mn:"NOP",am:"",nb:1,il:1,c1:2,c2:0,nw:0,br:0,mod:""}, // da
  {mn:"DCP",am:"AAAA,y",nb:3,il:1,c1:7,c2:0,nw:2,br:0,mod:"CZN"}, // db
  {mn:"NOP",am:"AAAA,x",nb:3,il:1,c1:4,c2:0,nw:0,br:0,mod:""}, // dc
  {mn:"CMP",am:"AAAA,x",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"CZN"}, // dd
  {mn:"DEC",am:"AAAA,x",nb:3,il:0,c1:7,c2:0,nw:2,br:0,mod:"ZN"}, // de
  {mn:"DCP",am:"AAAA,x",nb:3,il:1,c1:7,c2:0,nw:2,br:0,mod:"CZN"}, // df
  {mn:"CPX",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:"CZN"}, // e0
  {mn:"SBC",am:"(aa,x)",nb:2,il:0,c1:6,c2:0,nw:0,br:0,mod:"ACZVN"}, // e1
  {mn:"NOP",am:"#aa",nb:2,il:1,c1:2,c2:0,nw:0,br:0,mod:""}, // e2
  {mn:"ISB",am:"(aa,x)",nb:2,il:1,c1:8,c2:0,nw:2,br:0,mod:"ACZVN"}, // e3
  {mn:"CPX",am:"aa",nb:2,il:0,c1:3,c2:0,nw:0,br:0,mod:"CZN"}, // e4
  {mn:"SBC",am:"aa",nb:2,il:0,c1:3,c2:0,nw:0,br:0,mod:"ACZVN"}, // e5
  {mn:"INC",am:"aa",nb:2,il:0,c1:5,c2:0,nw:2,br:0,mod:"ZN"}, // e6
  {mn:"ISB",am:"aa",nb:2,il:1,c1:5,c2:0,nw:2,br:0,mod:"ACZVN"}, // e7
  {mn:"INX",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"XZN"}, // e8
  {mn:"SBC",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:"ACZVN"}, // e9
  {mn:"NOP",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:""}, // ea
  {mn:"SBC",am:"#aa",nb:2,il:1,c1:2,c2:0,nw:0,br:0,mod:"ACZVN"}, // eb
  {mn:"CPX",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:0,br:0,mod:"CZN"}, // ec
  {mn:"SBC",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:0,br:0,mod:"ACZVN"}, // ed
  {mn:"INC",am:"AAAA",nb:3,il:0,c1:6,c2:0,nw:2,br:0,mod:"ZN"}, // ee
  {mn:"ISB",am:"AAAA",nb:3,il:1,c1:6,c2:0,nw:2,br:0,mod:"ACZVN"}, // ef
  {mn:"BEQ",am:"branch",nb:2,il:0,c1:2,c2:2,nw:0,br:1,mod:""}, // f0
  {mn:"SBC",am:"(aa),y",nb:2,il:0,c1:5,c2:1,nw:0,br:0,mod:"ACZVN"}, // f1
  {mn:"KIL",am:"",nb:1,il:2,c1:3,c2:0,nw:0,br:1,mod:""}, // f2
  {mn:"ISB",am:"(aa),y",nb:2,il:1,c1:8,c2:0,nw:2,br:0,mod:"ACZVN"}, // f3
  {mn:"NOP",am:"aa,x",nb:2,il:1,c1:4,c2:0,nw:0,br:0,mod:""}, // f4
  {mn:"SBC",am:"aa,x",nb:2,il:0,c1:4,c2:0,nw:0,br:0,mod:"ACZVN"}, // f5
  {mn:"INC",am:"aa,x",nb:2,il:0,c1:6,c2:0,nw:2,br:0,mod:"ZN"}, // f6
  {mn:"ISB",am:"aa,x",nb:2,il:1,c1:6,c2:0,nw:2,br:0,mod:"ACZVN"}, // f7
  {mn:"SED",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"D"}, // f8
  {mn:"SBC",am:"AAAA,y",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"ACZVN"}, // f9
  {mn:"NOP",am:"",nb:1,il:1,c1:2,c2:0,nw:0,br:0,mod:""}, // fa
  {mn:"ISB",am:"AAAA,y",nb:3,il:1,c1:7,c2:0,nw:2,br:0,mod:"ACZVN"}, // fb
  {mn:"NOP",am:"AAAA,x",nb:3,il:1,c1:4,c2:0,nw:0,br:0,mod:""}, // fc
  {mn:"SBC",am:"AAAA,x",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"ACZVN"}, // fd
  {mn:"INC",am:"AAAA,x",nb:3,il:0,c1:7,c2:0,nw:2,br:0,mod:"ZN"}, // fe
  {mn:"ISB",am:"AAAA,x",nb:3,il:1,c1:7,c2:0,nw:2,br:0,mod:"ACZVN"}, // ff
];

/// 65C02 entries that differ from the NMOS table above. Kept to the subset the
/// MOS65C02 core actually implements (the 65SC02 one: no Rockwell BBR/BBS/RMB/
/// SMB, no WDC WAI/STP), so disassembly never claims an opcode the core doesn't
/// execute. The unofficial NMOS opcodes the core still treats as themselves
/// (uSLO, uANC, ...) are left alone here for the same reason.
const OPS_65C02_PATCH: {[opcode:number]: Partial<Op6502>} = {
  // new "(zp)" addressing mode (indirect, no index, no page-cross penalty)
  0x12:{mn:"ORA",am:"(aa)",nb:2,il:0,c1:5,c2:0,nw:0,br:0,mod:"AZN"},
  0x32:{mn:"AND",am:"(aa)",nb:2,il:0,c1:5,c2:0,nw:0,br:0,mod:"AZN"},
  0x52:{mn:"EOR",am:"(aa)",nb:2,il:0,c1:5,c2:0,nw:0,br:0,mod:"AZN"},
  0x72:{mn:"ADC",am:"(aa)",nb:2,il:0,c1:5,c2:0,nw:0,br:0,mod:"ACZVN"},
  0x92:{mn:"STA",am:"(aa)",nb:2,il:0,c1:5,c2:0,nw:1,br:0,mod:""},
  0xb2:{mn:"LDA",am:"(aa)",nb:2,il:0,c1:5,c2:0,nw:0,br:0,mod:"AZN"},
  0xd2:{mn:"CMP",am:"(aa)",nb:2,il:0,c1:5,c2:0,nw:0,br:0,mod:"AZN"},
  0xf2:{mn:"SBC",am:"(aa)",nb:2,il:0,c1:5,c2:0,nw:0,br:0,mod:"ACZVN"},
  // TSB / TRB
  0x04:{mn:"TSB",am:"aa",nb:2,il:0,c1:5,c2:0,nw:2,br:0,mod:"Z"},
  0x0c:{mn:"TSB",am:"AAAA",nb:3,il:0,c1:6,c2:0,nw:2,br:0,mod:"Z"},
  0x14:{mn:"TRB",am:"aa",nb:2,il:0,c1:5,c2:0,nw:2,br:0,mod:"Z"},
  0x1c:{mn:"TRB",am:"AAAA",nb:3,il:0,c1:6,c2:0,nw:2,br:0,mod:"Z"},
  // BIT gains immediate (Z only) and indexed addressing
  0x89:{mn:"BIT",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:"Z"},
  0x34:{mn:"BIT",am:"aa,x",nb:2,il:0,c1:4,c2:0,nw:0,br:0,mod:"ZVN"},
  0x3c:{mn:"BIT",am:"AAAA,x",nb:3,il:0,c1:4,c2:1,nw:0,br:0,mod:"ZVN"},
  // STZ
  0x64:{mn:"STZ",am:"aa",nb:2,il:0,c1:3,c2:0,nw:1,br:0,mod:""},
  0x74:{mn:"STZ",am:"aa,x",nb:2,il:0,c1:4,c2:0,nw:1,br:0,mod:""},
  0x9c:{mn:"STZ",am:"AAAA",nb:3,il:0,c1:4,c2:0,nw:1,br:0,mod:""},
  0x9e:{mn:"STZ",am:"AAAA,x",nb:3,il:0,c1:5,c2:0,nw:1,br:0,mod:""},
  // stack / accumulator ops
  0x5a:{mn:"PHY",am:"",nb:1,il:0,c1:3,c2:0,nw:1,br:0,mod:"S"},
  0x7a:{mn:"PLY",am:"",nb:1,il:0,c1:4,c2:0,nw:0,br:0,mod:"SZN"},
  0xda:{mn:"PHX",am:"",nb:1,il:0,c1:3,c2:0,nw:1,br:0,mod:"S"},
  0xfa:{mn:"PLX",am:"",nb:1,il:0,c1:4,c2:0,nw:0,br:0,mod:"SZN"},
  0x1a:{mn:"INC",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"ZN"},
  0x3a:{mn:"DEC",am:"",nb:1,il:0,c1:2,c2:0,nw:0,br:0,mod:"ZN"},
  // branch always, indexed indirect jump, fixed indirect jump (+1 cycle)
  0x80:{mn:"BRA",am:"branch",nb:2,il:0,c1:3,c2:1,nw:0,br:1,mod:""},
  0x7c:{mn:"JMP",am:"(AAAA,x)",nb:3,il:0,c1:6,c2:0,nw:0,br:1,mod:""},
  0x6c:{mn:"JMP",am:"(AAAA)",nb:3,il:0,c1:6,c2:0,nw:0,br:1,mod:""},
  // former KIL slots are 2-byte NOPs (no 65C02 opcode halts the CPU)
  0x02:{mn:"NOP",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:""},
  0x22:{mn:"NOP",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:""},
  0x42:{mn:"NOP",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:""},
  0x62:{mn:"NOP",am:"#aa",nb:2,il:0,c1:2,c2:0,nw:0,br:0,mod:""},
};

/// The NMOS table with the 65C02's changes applied, for machines with a 65C02.
export var OPS_65C02: Op6502[] = OPS_6502.map((op, i) => ({ ...op, ...(OPS_65C02_PATCH[i] || {}) }));

export function disassemble6502(pc:number, b0:number, b1:number, b2:number, ops:Op6502[] = OPS_6502): {line:string, nbytes:number, isaddr:boolean, iscall?:boolean} {

  var op = ops[b0];
  if (op == null) return {line:"???", nbytes:1, isaddr:false};
  var s = op.mn;
  var am = op.am;
  var isaddr = false;
  if (am == 'branch') {
    var offset = (b1 < 0x80) ? (pc+2+b1) : (pc+2-(256-b1));
    offset &= 0xffff;
    am = '$'+hex(offset, 4);
    isaddr = true;
  } else {
    am = am.replace('aa','$'+hex(b1, 2));
    am = am.replace('AAAA','$'+hex(b1+(b2<<8), 4));
    if (am.indexOf('#') < 0 && am.indexOf('$') >= 0)
      isaddr = true;
  }
  return {line:op.mn + " " + am, nbytes:op.nb, isaddr:isaddr, iscall:op.mn=="JSR"};
};

/// Disassemble one 65C02 instruction (for machines with a 65C02 such as the
/// Apple //e); `b0`/`b1`/`b2` are the bytes at, and after, `pc`.
export function disassemble65C02(pc:number, b0:number, b1:number, b2:number) {
  return disassemble6502(pc, b0, b1, b2, OPS_65C02);
}
