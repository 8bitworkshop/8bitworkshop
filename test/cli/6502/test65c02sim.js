
var assert = require('assert');

var MOS6502 = require("gen/common/cpu/MOS6502.js");
var MOS65C02 = require("gen/common/cpu/MOS65C02.js");

function newMachine(Ctor) {
  var mem = new Uint8Array(65536);
  var bus = {
    read:  (a)   => { return mem[a]; },
    write: (a,v) => { mem[a] = v; }
  };
  var cpu = new Ctor();
  cpu.connectMemoryBus(bus);
  return { mem: mem, cpu: cpu };
}

function put(mem, addr, bytes) {
  bytes.forEach((b,i) => mem[addr+i] = b);
}

function runUntil(cpu, targetPC, maxSteps) {
  for (var i = 0; i < maxSteps; i++) {
    if (cpu.getPC() === targetPC) return i;
    cpu.advanceInsn();
  }
  throw new Error('never reached PC=$' + targetPC.toString(16) + ' (stuck at $' + cpu.getPC().toString(16) + ')');
}

describe('MOS65C02', function() {

  it('should execute the new 65C02 instructions correctly', function() {
    var { mem, cpu } = newMachine(MOS65C02.MOS65C02);

    put(mem, 0x0200, [
      0xA9, 0xAA,       // 0200 LDA #$AA
      0x85, 0x10,       // 0202 STA $10
      0xA9, 0x0F,       // 0204 LDA #$0F
      0x04, 0x10,       // 0206 TSB $10  -> mem[$10] = 0xAA|0x0F = 0xAF
      0xA9, 0xF0,       // 0208 LDA #$F0
      0x14, 0x10,       // 020A TRB $10  -> mem[$10] = 0xAF & ~0xF0 = 0x0F
      0x64, 0x11,       // 020C STZ $11  -> mem[$11] = 0
      0xA2, 0x55,       // 020E LDX #$55
      0xDA,             // 0210 PHX
      0xA2, 0x00,       // 0211 LDX #$00
      0xFA,             // 0213 PLX      -> X = $55
      0xA0, 0x66,       // 0214 LDY #$66
      0x5A,             // 0216 PHY
      0xA0, 0x00,       // 0217 LDY #$00
      0x7A,             // 0219 PLY      -> Y = $66
      0xA9, 0x01,       // 021A LDA #$01
      0x1A,             // 021C INC A    -> A=2
      0x3A,             // 021D DEC A    -> A=1
      0x3A,             // 021E DEC A    -> A=0
      0x89, 0xFF,       // 021F BIT #$FF -> Z=1 (A&FF==0), N/V must stay 0 (unlike mem BIT)
      0x80, 0x02,       // 0221 BRA +2   -> skip next instr
      0xA9, 0xFF,       // 0223 LDA #$FF (must be skipped)
      0xA9, 0x77,       // 0225 LDA #$77 <- BRA target
      0xA9, 0x30,       // 0227 LDA #$30
      0x85, 0x20,       // 0229 STA $20
      0xA9, 0x00,       // 022B LDA #$00
      0x85, 0x21,       // 022D STA $21   ; ($20) -> $0030
      0xA9, 0x42,       // 022F LDA #$42
      0x85, 0x30,       // 0231 STA $30   ; mem[$30] = $42
      0xA9, 0x00,       // 0233 LDA #$00
      0x12, 0x20,       // 0235 ORA ($20) -> A = mem[$30] = $42
      0xA9, 0x02,       // 0237 LDA #$02
      0xAA,             // 0239 TAX       -> X = 2
      0x7C, 0x3D, 0x02, // 023A JMP ($023D,X) -> reads ptr at $023F
    ]);
    put(mem, 0x023D, [0x00, 0x00, 0x50, 0x02]); // table: [X=0]=unused, [X=2]=$0250
    put(mem, 0x0250, [0xA9, 0x5A, 0x00]);       // LDA #$5A <- JMP(abs,X) target, then BRK

    mem[0xFFFC] = 0x00; mem[0xFFFD] = 0x02; // reset vector -> $0200
    cpu.reset();

    // BIT immediate only touches Z, unlike memory BIT which also sets N/V from the operand.
    runUntil(cpu, 0x021f, 50);
    cpu.advanceInsn();
    var s = cpu.saveState();
    assert.equal(s.A, 0, 'A after DEC A DEC A');
    assert.equal(s.Z, 1, 'Z after BIT #$FF');
    assert.equal(s.N, 0, 'N must NOT be set by BIT immediate (operand bit7 is set)');
    assert.equal(s.V, 0, 'V must NOT be set by BIT immediate (operand bit6 is set)');

    // BRA must land straight on $0225, never visiting $0223 (LDA #$FF).
    assert.equal(cpu.getPC(), 0x0221, 'expected to be sitting at BRA');
    cpu.advanceInsn();
    assert.equal(cpu.getPC(), 0x0225, 'BRA should jump straight to $0225, skipping LDA #$FF at $0223');
    cpu.advanceInsn();
    s = cpu.saveState();
    assert.equal(s.A, 0x77, 'LDA #$77 at BRA target');

    runUntil(cpu, 0x0237, 50); // through the (zp) pointer setup + ORA ($20)
    s = cpu.saveState();
    assert.equal(mem[0x10], 0x0f, 'TSB/TRB result in mem[$10]');
    assert.equal(mem[0x11], 0x00, 'STZ result in mem[$11]');
    assert.equal(s.A, 0x42, 'ORA ($20) zp-indirect read');

    runUntil(cpu, 0x0250, 50); // through LDA #2 / TAX / JMP ($023D,X)
    cpu.advanceInsn(); // execute LDA #$5A at the JMP(abs,X) target
    s = cpu.saveState();
    assert.equal(s.A, 0x5a, 'JMP (abs,X) should land on $0250');
  });

  it('should restore X and Y through PHX/PLX and PHY/PLY', function() {
    var { mem, cpu } = newMachine(MOS65C02.MOS65C02);
    put(mem, 0x0200, [
      0xA2, 0x55,       // LDX #$55
      0xDA,             // PHX
      0xA2, 0x00,       // LDX #$00
      0xFA,             // PLX
      0xA0, 0x66,       // LDY #$66
      0x5A,             // PHY
      0xA0, 0x00,       // LDY #$00
      0x7A,             // PLY
    ]);
    mem[0xFFFC] = 0x00; mem[0xFFFD] = 0x02;
    cpu.reset();
    runUntil(cpu, 0x020c, 50); // just past PLY
    var s = cpu.saveState();
    assert.equal(s.X, 0x55, 'PLX should restore X');
    assert.equal(s.Y, 0x66, 'PLY should restore Y');
  });

  it('should fix the NMOS JMP ($xxFF) page-wrap bug', function() {
    function jmpIndPage(Ctor) {
      var { mem, cpu } = newMachine(Ctor);
      mem[0x0200] = 0x6C; mem[0x0201] = 0xFF; mem[0x0202] = 0x02; // JMP ($02FF)
      mem[0x02FF] = 0x34; // pointer low byte
      mem[0x0300] = 0x12; // pointer high byte, on the following page
      mem[0xFFFC] = 0x00; mem[0xFFFD] = 0x02;
      cpu.reset();
      runUntil(cpu, 0x0200, 5);
      cpu.advanceInsn();
      return cpu.getPC();
    }
    // NMOS bug: high byte wrongly re-read from $0200 (same page as the pointer), not $0300.
    assert.equal(jmpIndPage(MOS6502.MOS6502), 0x6c34, 'NMOS 6502 should reproduce the page-wrap bug');
    // 65C02 fix: high byte correctly read from $0300.
    assert.equal(jmpIndPage(MOS65C02.MOS65C02), 0x1234, '65C02 should fix the page-wrap bug');
  });

  it('should leave plain MOS6502 behavior untouched (no patchFn)', function() {
    var { mem, cpu } = newMachine(MOS6502.MOS6502);
    // $80 is an undocumented 2-byte NMOS NOP, not BRA, on plain MOS6502.
    put(mem, 0x0200, [0xA9, 0x11, 0x80, 0x02, 0xA9, 0x22]);
    mem[0xFFFC] = 0x00; mem[0xFFFD] = 0x02;
    cpu.reset();
    runUntil(cpu, 0x0206, 50);
    var s = cpu.saveState();
    assert.equal(s.A, 0x22, 'plain 6502 should fall through $80 as a NOP, not branch');
  });

});
