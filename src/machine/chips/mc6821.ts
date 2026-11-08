// Motorola MC6821 Peripheral Interface Adapter (PIA).
//
// Two 8-bit ports (A and B), each with a data-direction register, a control
// register and two control lines (C1 = input only, C2 = input or output).
// Register select (RS1:RS0):
//   0: port A data (CRA bit 2 = 1) or DDRA (CRA bit 2 = 0)
//   1: control register A
//   2: port B data (CRB bit 2 = 1) or DDRB (CRB bit 2 = 0)
//   3: control register B
//
// Control register bits:
//   7   IRQ1 flag (C1 active edge seen)      read-only, cleared by reading data
//   6   IRQ2 flag (C2 active edge, input)    read-only, cleared by reading data
//   5   C2 direction (1 = output)
//   4:3 C2 mode. Input: bit 4 = edge (1 = rising), bit 3 = IRQ enable.
//       Output: bits 5:4 = 11 is "manual": bit 3 is the level driven on C2.
//   2   data register select (1 = data, 0 = DDR)
//   1   C1 edge (1 = rising)
//   0   C1 IRQ enable
//
// The chip knows nothing about what is wired to it: the owner supplies the
// levels on the peripheral pins through the readInA/readInB callbacks, and
// is told about output writes through onWriteA/onWriteB.

export interface PIAState {
  ora: number; ddra: number; cra: number; ca1: boolean; ca2: boolean;
  orb: number; ddrb: number; crb: number; cb1: boolean; cb2: boolean;
}

export class MC6821 {
  ora = 0; ddra = 0; cra = 0;
  orb = 0; ddrb = 0; crb = 0;

  // input levels on the control lines (needed to detect edges)
  ca1 = false; ca2 = false;
  cb1 = false; cb2 = false;

  // levels on the peripheral data pins (driven by the outside world)
  readInA: () => number = () => 0xff;
  readInB: () => number = () => 0xff;
  // called when the CPU writes the output register of a port
  onWriteA: (v: number) => void = null;
  onWriteB: (v: number) => void = null;

  reset() {
    this.ora = this.ddra = this.cra = 0;
    this.orb = this.ddrb = this.crb = 0;
  }

  /** What the CPU would read from the A pins: outputs read back, inputs are the peripheral. */
  get portA(): number { return (this.readInA() & ~this.ddra) | (this.ora & this.ddra); }
  get portB(): number { return (this.readInB() & ~this.ddrb) | (this.orb & this.ddrb); }
  /** Levels the PIA drives onto the pins: output bits only, the rest float high. */
  get outA(): number { return (this.ora & this.ddra) | (~this.ddra & 0xff); }
  get outB(): number { return (this.orb & this.ddrb) | (~this.ddrb & 0xff); }

  /** Level the PIA drives on C2 when it is configured as a manual output. */
  get c2a(): boolean { return (this.cra & 0x30) == 0x30 ? !!(this.cra & 0x08) : true; }
  get c2b(): boolean { return (this.crb & 0x30) == 0x30 ? !!(this.crb & 0x08) : true; }

  read(rs: number): number {
    switch (rs & 3) {
      case 0:
        if (!(this.cra & 4)) return this.ddra;
        this.cra &= 0x3f; // reading the data register clears both flags
        return this.portA;
      case 1: return this.cra;
      case 2:
        if (!(this.crb & 4)) return this.ddrb;
        this.crb &= 0x3f;
        return this.portB;
      default: return this.crb;
    }
  }

  /** Read without side effects (debugger). */
  peek(rs: number): number {
    switch (rs & 3) {
      case 0: return (this.cra & 4) ? this.portA : this.ddra;
      case 1: return this.cra;
      case 2: return (this.crb & 4) ? this.portB : this.ddrb;
      default: return this.crb;
    }
  }

  write(rs: number, v: number) {
    v &= 0xff;
    switch (rs & 3) {
      case 0:
        if (this.cra & 4) { this.ora = v; this.onWriteA && this.onWriteA(v); }
        else this.ddra = v;
        break;
      case 1: this.cra = (this.cra & 0xc0) | (v & 0x3f); break;
      case 2:
        if (this.crb & 4) { this.orb = v; this.onWriteB && this.onWriteB(v); }
        else this.ddrb = v;
        break;
      case 3: this.crb = (this.crb & 0xc0) | (v & 0x3f); break;
    }
  }

  // Drive the control input lines; an active edge sets the IRQ flag.
  setCA1(level: boolean) {
    if (level != this.ca1) {
      if (level == !!(this.cra & 2)) this.cra |= 0x80;
      this.ca1 = level;
    }
  }
  setCB1(level: boolean) {
    if (level != this.cb1) {
      if (level == !!(this.crb & 2)) this.crb |= 0x80;
      this.cb1 = level;
    }
  }
  setCA2(level: boolean) {
    if (level != this.ca2) {
      if (!(this.cra & 0x20) && level == !!(this.cra & 0x10)) this.cra |= 0x40;
      this.ca2 = level;
    }
  }
  setCB2(level: boolean) {
    if (level != this.cb2) {
      if (!(this.crb & 0x20) && level == !!(this.crb & 0x10)) this.crb |= 0x40;
      this.cb2 = level;
    }
  }

  /** IRQA output (active = true): C1 flag and enable, or C2 (input mode) flag and enable. */
  get irqA(): boolean {
    return ((this.cra & 0x81) == 0x81) || ((this.cra & 0x68) == 0x48);
  }
  get irqB(): boolean {
    return ((this.crb & 0x81) == 0x81) || ((this.crb & 0x68) == 0x48);
  }

  saveState(): PIAState {
    return {
      ora: this.ora, ddra: this.ddra, cra: this.cra, ca1: this.ca1, ca2: this.ca2,
      orb: this.orb, ddrb: this.ddrb, crb: this.crb, cb1: this.cb1, cb2: this.cb2,
    };
  }
  loadState(s: PIAState) {
    Object.assign(this, s);
  }
}
