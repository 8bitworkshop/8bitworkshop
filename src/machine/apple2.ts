import { MOS6502, MOS6502State } from "../common/cpu/MOS6502";
import { MOS65C02 } from "../common/cpu/MOS65C02";
import { Bus, BasicScanlineMachine, SavesState, AcceptsBIOS, AcceptsPaddleInput } from "../common/devices";
import { KeyFlags } from "../common/emu"; // TODO
import { hex, lzgmini, stringToByteArray, RGBA, printFlags, arrayCompare } from "../common/util";
import { MasterAudio, AY38910_Audio } from "../common/audio";
import { VIA6522, VIA6522Host } from "./chips/via6522";

interface AppleIIStateBase {
   ram: Uint8Array<ArrayBuffer>;
   auxram?: Uint8Array<ArrayBuffer>; // 64K auxiliary RAM (//e only)
   iie?: AppleIIEnhancedSwitches;
   soundstate: number;
   auxRAMselected, writeinhibit: boolean;
   auxRAMbank: number;
}

/** The //e-only memory/video soft switches ($C000-$C00F). */
interface AppleIIEnhancedSwitches {
   ramrd: boolean;      // read $0200-$BFFF from aux RAM
   ramwrt: boolean;     // write $0200-$BFFF to aux RAM
   store80: boolean;    // 80STORE: PAGE2 selects main/aux for text/HGR page
   col80: boolean;      // 80COL: display 80 columns from main+aux
   altcharset: boolean; // ALTCHARSET: alternate character set (not yet rendered)
   intcxrom: boolean;   // INTCXROM: internal ROM at $C100-$CFFF
   an3?: boolean;       // annunciator 3 ($C05E clears, $C05F sets); clear = double hi-res
}

interface AppleIIControlsState {
   inputs: Uint8Array<ArrayBuffer>; // unused?
   kbdlatch: number;
}

interface AppleIIState extends AppleIIStateBase, AppleIIControlsState {
   c: MOS6502State;
   grswitch: number;
   slots: SlotDevice[];
   paddleValues: number[];
   paddleButtons: boolean[];
}

interface SlotDevice extends Bus {
   readROM(address: number): number;
   readConst(address: number): number;
   writeROM?(address: number, value: number): void;
}

export class AppleII extends BasicScanlineMachine implements AcceptsBIOS, AcceptsPaddleInput {

   // approx: http://www.cs.columbia.edu/~sedwards/apple2fpga/
   cpuFrequency = 1022727;
   sampleRate = this.cpuFrequency;
   cpuCyclesPerLine = 65;
   cpuCyclesPerFrame = this.cpuCyclesPerLine * 262;
   canvasWidth = 280;
   numVisibleScanlines = 192;
   numTotalScanlines = 262;
   defaultROMSize = 0x13000; // we'll never need one that big, but...
   cpuCyclesPaddleUnit = 11; // ~11 cycles per paddle unit
   cpuCyclesPaddleMax = 255 * this.cpuCyclesPaddleUnit;

   // these are set later
   LOAD_BASE = 0;
   HDR_SIZE = 0;

   ram = new Uint8Array(0x13000); // 64K + 16K LC RAM - 4K hardware + 12K ROM
   // Apple //e: full 64K auxiliary RAM and the //e-only soft switches
   enhanced = false;
   auxRAM: Uint8Array;
   ramrd = false;
   ramwrt = false;
   store80 = false;
   col80 = false;
   altcharset = false;
   intcxrom = true;
   // AN3 doubles as the //e's DHIRES switch: $C05E clears it (double hi-res on),
   // $C05F sets it. It starts set, so 80COL+HIRES alone is plain hi-res.
   an3 = true;
   bios: Uint8Array;
   // The //e has a 65C02, the II+ does not. This field is initialised here
   // because other fields/factories run first; the constructor swaps in a
   // MOS65C02 when `enhanced` is set.
   cpu: MOS6502 = new MOS6502();
   grdirty = new Array(0xc000 >> 7);
   grparams = { dirty: this.grdirty, grswitch: GR_TXMODE, mem: this.ram, auxmem: null as Uint8Array, col80: false, an3: true, enhanced: false };
   ap2disp;
   kbdlatch = 0;
   soundstate = 0;
   // language card switches
   auxRAMselected = false;
   auxRAMbank = 1;
   writeinhibit = true;
   // value to add when reading & writing each of these banks
   // bank 1 is E000-FFFF, bank 2 is D000-DFFF
   bank2rdoffset = 0;
   bank2wroffset = 0;
   // Paddle/joystick, PDL0-PDL3 values (0-255).
   paddleValues = [0, 0, 0, 0];
   paddleButtons = [false, false, false];
   paddleLastTriggered = 0;
   // disk II
   slots: SlotDevice[] = new Array(8);
   // Mockingboard sound card (slot 4, $C400)
   mb: Mockingboard;
   // fake disk drive that loads program into RAM
   fakeDrive: SlotDevice = {
      readROM: (a) => {
         var pc = this.cpu.getPC();
         if (pc >= 0xC600 && pc < 0xC700) {
            // We're reading code to EXECUTE.
            // Load the built program directly into memory, and "read"
            // a JMP directly to it.
            //console.log(`fakeDrive (EXEC): ${a.toString(16)}`);
            switch (a) {
               // JMP VM_BASE
               case 0:
                  // SHOULD load program into RAM here, but have to do it
                  // below instead.
                  return 0;
               case 1: return this.LOAD_BASE & 0xff;
               case 2: return (this.LOAD_BASE >> 8) & 0xff;
               default: return 0;
            }
         }
         else {
            // We're reading code, but not executing it.
            // This is probably the Monitor routine to identify whether
            // this slot is a Disk ][ drive, so... give it what it wants.
            //console.log(`fakeDrive (NOEX): ${a.toString(16)}`);
            switch (a) {
               case 0:
                  // Actually, if we get here, we probably ARE being
                  // executed. For some reason, the instruction at $C600
                  // gets read for execution, BEFORE the PC gets set to
                  // the correct location. So we handle loading the program
                  // into RAM and returning the JMP here, instead of above
                  // where it would otherwise belong.
                  if (this.rom) {
                     this.loadRAMWithProgram();
                  }
                  return 0x4c; // JMP
               case 1: return 0x20;
               case 3: return 0x00;
               case 5: return 0x03;
               case 7: return 0x3c;
               default: return 0;
            }
         }
      },
      readConst: (a) => {
         return 0;
      },
      read: (a) => { return this.floatbus(); },
      write: (a, v) => { }
   };

   constructor(enhanced: boolean = false) {
      super();
      if (enhanced) {
         this.enhanced = true;
         this.auxRAM = new Uint8Array(0x10000);
         this.grparams.auxmem = this.auxRAM;
         // draw glyphs from the //e video ROM instead of the II+ charset
         this.grparams.enhanced = true;
         // 80 columns is 560 pixels; 40-column modes are drawn at 2x
         this.canvasWidth = 560;
         // 560x192 is the same 4:3 tube as the 280x192 II+ raster, with half-as-
         // wide pixels. Without this the canvas would keep its 560/192 shape and
         // the picture would look stretched horizontally.
         this.aspectRatio = 4 / 3;
         // cc65's apple2enh target and the real //e ROM use 65C02 opcodes
         // (STZ, BRA, PHX/PLX, INC A, (zp), fixed JMP ($xxFF)).
         this.cpu = new MOS65C02();
      }
      this.loadBIOS(new lzgmini().decode(stringToByteArray(atob(APPLEIIGO_LZG))), true);
      this.connectCPUMemoryBus(this);
      // This line is inappropriate for real ROMs, but was there for
      // the APPLE][GO ROM, so keeping it only when the built-in ROM is
      // used (in case it really is important for this address to be an RTS).
      if (this.bios.length == 0x3000) this.bios[0xD39A - 0xD000] = 0x60;  // $d39a = RTS
      this.mb = new Mockingboard(this.cpuFrequency);
      this.slots[4] = this.mb;
   }
   saveState(): AppleIIState {
      // TODO: automagic
      return {
         c: this.cpu.saveState(),
         ram: this.ram.slice(),
         auxram: this.auxRAM ? this.auxRAM.slice() : undefined,
         iie: this.enhanced ? {
            ramrd: this.ramrd, ramwrt: this.ramwrt, store80: this.store80,
            col80: this.col80, altcharset: this.altcharset, intcxrom: this.intcxrom,
            an3: this.an3
         } : undefined,
         kbdlatch: this.kbdlatch,
         soundstate: this.soundstate,
         grswitch: this.grparams.grswitch,
         auxRAMselected: this.auxRAMselected,
         auxRAMbank: this.auxRAMbank,
         writeinhibit: this.writeinhibit,
         slots: this.slots.map((slot) => { return slot && slot['saveState'] && slot['saveState']() }),
         paddleValues: this.paddleValues.slice(),
         paddleButtons: this.paddleButtons.slice(),
         inputs: this.ram.slice(0, 0) // unused
      };
   }
   loadState(s: AppleIIState) {
      this.cpu.loadState(s.c);
      this.ram.set(s.ram);
      if (s.auxram && this.auxRAM) this.auxRAM.set(s.auxram);
      if (s.iie) {
         this.ramrd = s.iie.ramrd;
         this.ramwrt = s.iie.ramwrt;
         this.store80 = s.iie.store80;
         this.col80 = s.iie.col80;
         this.altcharset = s.iie.altcharset;
         this.intcxrom = s.iie.intcxrom;
         this.an3 = s.iie.an3 !== false; // states saved before AN3 existed
      }
      this.grparams.an3 = this.an3;
      this.kbdlatch = s.kbdlatch;
      this.soundstate = s.soundstate;
      this.grparams.grswitch = s.grswitch;
      this.grparams.col80 = this.col80;
      this.auxRAMselected = s.auxRAMselected;
      this.auxRAMbank = s.auxRAMbank;
      this.writeinhibit = s.writeinhibit;
      this.setupLanguageCardConstants();
      for (var i = 0; i < this.slots.length; i++)
         if (this.slots[i] && this.slots[i]['loadState'])
            this.slots[i]['loadState'](s.slots[i]);
      this.paddleValues = s.paddleValues.slice();
      this.paddleButtons = s.paddleButtons.slice();
      if (this.ap2disp) this.ap2disp.invalidate(); // repaint entire screen
   }
   saveControlsState(): AppleIIControlsState {
      return { inputs: null, kbdlatch: this.kbdlatch };
   }
   loadControlsState(s: AppleIIControlsState) {
      this.kbdlatch = s.kbdlatch;
   }
   loadBIOS(data, title?) {
      if (data.length != 0x3000 && data.length != 0x4000) {
         console.log(`apple2 loadBIOS !!!WARNING!!!: BIOS wants length 0x3000 (//+) or 0x4000 (//e), but BIOS '${title}' has length 0x${data.length.toString(16)}`);
         console.log("will load BIOS to end of memory anyway...");
      }
      this.bios = Uint8Array.from(data);
   }
   loadROM(data, title?, origin?: number) {
      // is it a 16-sector 35-track disk image?
      if (data.length == 16 * 35 * 256) {
         var diskii = new DiskII(this, data);
         this.slots[6] = diskii;
         this.reset();
      } else { // it's a binary, use a fake drive
         // set this.rom variable
         super.loadROM(data);
         // AppleSingle header? https://github.com/cc65/cc65/blob/master/libsrc/apple2/exehdr.s
         if (arrayCompare(this.rom.slice(0, 4), [0x00, 0x05, 0x16, 0x00])) {
            this.LOAD_BASE = this.rom[0x39] | (this.rom[0x38] << 8); // big endian
            this.HDR_SIZE = 58;
         } else {
            // 4-byte DOS header? (TODO: hacky detection)
            const hdrOrigin = this.rom[0] | (this.rom[1] << 8);
            const size = this.rom[2] | (this.rom[3] << 8);
            let isPlausible = hdrOrigin < 0xc000
               && hdrOrigin + size < 0x13000;
            if (size == data.length - 4 && isPlausible) {
               this.LOAD_BASE = hdrOrigin;
               this.HDR_SIZE = 4;
            } else {
               // Load @ specified origin, fallback to $803
               this.LOAD_BASE = origin ?? 0x803;
               this.HDR_SIZE = 0;
            }
         }
         this.slots[6] = this.fakeDrive;
      }
   }
   loadRAMWithProgram() {
      console.log(`Loading program into Apple ][ RAM at \$${this.LOAD_BASE.toString(16)} (${this.HDR_SIZE} bytes skipped for header)`);
      // truncate if needed to fit into RAM
      const exedata = this.rom.slice(this.HDR_SIZE, this.HDR_SIZE + this.ram.length - this.LOAD_BASE);
      this.ram.set(exedata, this.LOAD_BASE);
      // fake DOS detect for CC65 (TODO?)
      if (this.HDR_SIZE == 58) {
         this.ram[0xbf00] = 0x4c;
         this.ram[0xbf6f] = 0x01;
      }
   }
   reset() {
      this.auxRAMselected = false;
      this.auxRAMbank = 1;
      this.writeinhibit = true;
      this.ramrd = false;
      this.ramwrt = false;
      this.store80 = false;
      this.col80 = false;
      this.altcharset = false;
      this.intcxrom = true;
      this.an3 = true;
      this.grparams.col80 = false;
      this.grparams.an3 = true;
      this.ram.fill(0, 0x300, 0x400); // Clear soft-reset vector
      this.mb && this.mb.reset();
      // (force hard reset)
      super.reset();
      this.skipboot();
   }
   skipboot() {
      // execute until $c600 boot
      for (var i = 0; i < 2000000; i++) {
         this.cpu.advanceClock();
         if ((this.cpu.getPC() >> 8) == 0xc6) break;
      }
      // get out of $c600 boot
      for (var i = 0; i < 2000000; i++) {
         this.cpu.advanceClock();
         if ((this.cpu.getPC() >> 8) < 0xc6) break;
      }
   }
   /** True when a 16K //e ROM is loaded, covering $C000-$FFFF (incl. slot ROM). */
   hasInternalROM(): boolean {
      return this.enhanced && this.bios != null && this.bios.length >= 0x4000;
   }
   readInternalROM(address: number): number {
      return this.bios[address - (0x10000 - this.bios.length)] | 0;
   }
   /** Which RAM bank ($0200-$BFFF) this address reads from. */
   readBank(address: number): Uint8Array {
      return this.auxBankFor(address, this.ramrd) ? this.auxRAM : this.ram;
   }
   /** Which RAM bank ($0200-$BFFF) this address writes to. */
   writeBank(address: number): Uint8Array {
      return this.auxBankFor(address, this.ramwrt) ? this.auxRAM : this.ram;
   }
   auxBankFor(address: number, ramswitch: boolean): boolean {
      // the zero page and stack are always in main RAM on the //e
      if (address < 0x200) return false;
      // with 80STORE on, PAGE2 (not RAMRD/RAMWRT) picks the bank for the
      // text and hi-res pages
      if (this.store80 && ((address >= 0x400 && address < 0x800) || (address >= 0x2000 && address < 0x4000)))
         return (this.grparams.grswitch & GR_PAGE1) != 0;
      return ramswitch;
   }
   readConst(address: number): number {
      if (address < 0xc000) {
         return (this.auxRAM ? this.readBank(address) : this.ram)[address];
      } else if (address >= 0xd000) {
         if (!this.auxRAMselected)
            return this.bios[address - (0x10000 - this.bios.length)];
         else if (address >= 0xe000)
            return this.ram[address];
         else
            return this.ram[address + this.bank2rdoffset];
      } else if (address >= 0xc100 && address < 0xc800) {
         var slot = (address >> 8) & 7;
         var dev = this.slots[slot];
         // a slot device (disk controller, Mockingboard) wins, so the fake
         // drive can boot even when internal ROM is selected
         if (dev) return dev.readConst(address & 0xff) | 0;
         if (this.hasInternalROM()) return this.readInternalROM(address);
         return 0;
      } else if (address >= 0xc800 && address < 0xd000) {
         if (this.hasInternalROM()) return this.readInternalROM(address);
         return 0;
      } else {
         return 0;
      }
   }
   read(address: number): number {
      address &= 0xffff;
      if (address < 0xc000 || address >= 0xd000) {
         return this.readConst(address);
      } else if (address < 0xc100) {
         this.probe.logIORead(address, 0); // TODO: value
         var slot = (address >> 4) & 0x0f;
         switch (slot) {
            case 0: // $C00x
               // $C000 is the keyboard; the //e's 80STORE/RAMRD/RAMWRT/80COL/
               // ALTCHARSET switches here are write-only (reads of the other
               // $C00x addresses float).
               if (this.enhanced && address != 0xc000) return this.floatbus() | 0x80;
               return this.kbdlatch;
            case 1: // $C01x
               this.kbdlatch &= 0x7f;
               break;
            case 3: // $C03x
               this.soundstate = this.soundstate ^ 1;
               break;
            case 5: // $C05x
               if ((address & 0x0f) < 8) {
                  // graphics
                  if ((address & 1) != 0)
                     this.grparams.grswitch |= 1 << ((address >> 1) & 0x07);
                  else
                     this.grparams.grswitch &= ~(1 << ((address >> 1) & 0x07));
               } else if (this.enhanced && (address & 0x0e) == 0x0e) {
                  // $C05E/$C05F: AN3 off/on, which is also DHIRES on/off
                  this.an3 = (address & 1) != 0;
                  this.grparams.an3 = this.an3;
               }
               break;
            case 6: // $C06x
               // tapein, joystick, buttons
               switch (address & 7) {
                  case 1: // $C061 / $C069 - GAME SW0
                  case 2: // $C062 / $C06A - GAME SW1
                  case 3: // $C063 / $C06B - GAME SW2
                     // buttons
                     var btn = (address & 7) - 1;
                     if (this.paddleButtons[btn])
                        return this.floatbus() | 0x80;
                     else
                        return this.floatbus() & 0x7f;
                  case 4: // $C064 / $C06C - GAME PDL0
                  case 5: // $C065 / $C06D - GAME PDL1
                  case 6: // $C066 / $C06E - GAME PDL2
                  case 7: // $C067 / $C06F - GAME PDL3
                     var pdl = (address & 0x0f) - 4;
                     var elapsed = this.frameCycles - this.paddleLastTriggered;
                     // Bit 7 remains high until paddle value reached.
                     if (elapsed < this.paddleValues[pdl] * this.cpuCyclesPaddleUnit)
                        return this.floatbus() | 0x80;
                     else
                        return this.floatbus() & 0x7f;
                  default:
                     return this.floatbus();
               }
            case 7: // $C07x
               // Strobing PTRIG ($C070) triggers paddles.
               if (address == 0xc070) {
                  this.paddleLastTriggered = this.frameCycles;
                  return this.floatbus() | 0x80;
               }
            case 8: // $C08x
               return this.doLanguageCardIO(address);
            case 9: // $C09x
            case 10: // $C0Ax
            case 11: // $C0Bx
            case 12: // $C0Cx
            case 13: // $C0Dx
            case 14: // $C0Ex
            case 15: // $C0Fx
               return (this.slots[slot - 8] && this.slots[slot - 8].read(address & 0xf)) | 0;
         }
      } else if (address >= 0xc100 && address < 0xc800) {
         var slot = (address >> 8) & 7;
         var dev = this.slots[slot];
         if (dev) return dev.readROM(address & 0xff) | 0;
         if (this.hasInternalROM()) return this.readInternalROM(address);
         return 0;
      }
      return this.floatbus();
   }
   /**
    * The //e soft switches at $C000-$C00F. These are write-only: a program
    * sets them with a store (or any write cycle), and reading the address
    * gives the keyboard ($C000) or the floating bus.
    */
   writeEnhancedSwitch(address: number): void {
      switch (address) {
         case 0xc000: this.store80 = false; break;    // 80STORE off
         case 0xc001: this.store80 = true; break;     // 80STORE on
         case 0xc002: this.ramrd = false; break;      // read main RAM
         case 0xc003: this.ramrd = true; break;       // read aux RAM
         case 0xc004: this.ramwrt = false; break;     // write main RAM
         case 0xc005: this.ramwrt = true; break;      // write aux RAM
         case 0xc006: this.intcxrom = false; break;   // slot ROM
         case 0xc007: this.intcxrom = true; break;    // internal ROM
         case 0xc00c: this.col80 = false; break;      // 40 columns
         case 0xc00d: this.col80 = true; break;       // 80 columns
         case 0xc00e: this.altcharset = false; break; // normal charset
         case 0xc00f: this.altcharset = true; break;  // alternate charset
      }
      this.grparams.col80 = this.col80;
   }
   write(address: number, val: number): void {
      address &= 0xffff;
      val &= 0xff;
      if (address < 0xc000) {
         if (this.auxRAM) this.writeBank(address)[address] = val;
         else this.ram[address] = val;
         this.grdirty[address >> 7] = 1;
      } else if (address < 0xc090) {
         if (this.enhanced && address < 0xc010)
            this.writeEnhancedSwitch(address);
         else
            this.read(address); // strobe address, discard result
      } else if (address < 0xc100) {
         var slot = (address >> 4) & 0x0f;
         this.slots[slot - 8] && this.slots[slot - 8].write(address & 0xf, val);
         this.probe.logIOWrite(address, val);
      } else if (address >= 0xc100 && address < 0xc800) {
         var slot = (address >> 8) & 7;
         var dev = this.slots[slot];
         if (dev && dev.writeROM) dev.writeROM(address & 0xff, val);
         this.probe.logIOWrite(address, val);
      } else if (address >= 0xd000 && !this.writeinhibit) {
         if (address >= 0xe000)
            this.ram[address] = val;
         else
            this.ram[address + this.bank2wroffset] = val;
      }
   }
   // http://www.deater.net/weave/vmwprod/megademo/vapor_lock.html
   // https://retrocomputing.stackexchange.com/questions/14012/what-is-dram-refresh-and-why-is-the-weird-apple-ii-video-memory-layout-affected
   // http://www.apple-iigs.info/doc/fichiers/TheappleIIcircuitdescription1.pdf
   // http://rich12345.tripod.com/aiivideo/softalk.html
   // https://github.com/MiSTer-devel/Apple-II_MiSTer/blob/master/rtl/timing_generator.vhd
   floatbus(): number {
      // no video scanner hooked up yet (e.g. saveState() before the platform
      // starts, or a headless machine)
      if (!this.ap2disp) return 0xff;
      var fcyc = this.frameCycles;
      var yline = Math.floor(fcyc / 65);
      var xcyc = Math.floor(fcyc % 65);
      var addr = this.ap2disp.getAddressForScanline(yline);
      return this.readConst(addr + xcyc);
   }

   connectVideo(pixels: Uint32Array) {
      super.connectVideo(pixels);
      this.ap2disp = this.pixels && new Apple2Display(this.pixels, this.grparams, this.canvasWidth);
   }
   startScanline() {
   }
   drawScanline() {
      // TODO: draw scanline via ap2disp
   }
   advanceFrame(trap): number {
      var clocks = super.advanceFrame(trap);
      this.ap2disp && this.ap2disp.updateScreen();
      return clocks;
   }
   postFrame() {
      this.paddleLastTriggered -= this.frameCycles;
      // Prevent extreme negative values if paddles aren't read.
      if (this.paddleLastTriggered < -this.cpuCyclesPaddleMax) {
         this.paddleLastTriggered = -this.cpuCyclesPaddleMax;
      }
   }
   advanceCPU() {
      this.audio.feedSample(this.soundstate, 1);
      if (this.mb) {
         this.mb.step();
         if (this.mb.irq()) this.cpu.IRQ();
      }
      return super.advanceCPU();
   }

   startAudio() {
      this.mb && this.mb.startAudio();
   }

   stopAudio() {
      this.mb && this.mb.stopAudio();
   }

   setKeyInput(key: number, code: number, flags: number): void {
      console.log(`setKeyInput: ${key} ${code} ${flags}`);
      if (flags & KeyFlags.KeyDown) {
         code = 0;
         switch (key) {
            case 16: case 17: case 18: case 91:
               return; // ignore shift/ctrl/alt - don't set any key
            case 8:
               code = 8; // left
               if (flags & KeyFlags.Shift) {
                  // (possibly) soft reset
                  this.cpu.reset();
                  return;
               }
               break;
            case 13: code = 13; break; // return
            case 27: code = 27; break; // escape
            case 37: code = 8; break; // left
            case 39: code = 21; break; // right
            case 38: code = 11; break; // up
            case 40: code = 10; break; // down
            case 48: code = (flags & KeyFlags.Shift) ? 0x29 : 0x30; break; // ) or 0
            case 49: code = (flags & KeyFlags.Shift) ? 0x21 : 0x31; break; // ! or 1
            case 50: code = (flags & KeyFlags.Shift) ? 0x40 : 0x32; break; // @ or 2
            case 51: code = (flags & KeyFlags.Shift) ? 0x23 : 0x33; break; // # or 3
            case 52: code = (flags & KeyFlags.Shift) ? 0x24 : 0x34; break; // $ or 4
            case 53: code = (flags & KeyFlags.Shift) ? 0x25 : 0x35; break; // % or 5
            case 54: code = (flags & KeyFlags.Shift) ? 0x5e : 0x36; break; // ^ or 6
            case 55: code = (flags & KeyFlags.Shift) ? 0x26 : 0x37; break; // & or 7
            case 56: code = (flags & KeyFlags.Shift) ? 0x2a : 0x38; break; // * or 8
            case 57: code = (flags & KeyFlags.Shift) ? 0x28 : 0x39; break; // ( or 9
            case 61: code = (flags & KeyFlags.Shift) ? 0x5f : 0x2d; break; // _ or -
            case 173: code = (flags & KeyFlags.Shift) ? 0x2b : 0x3d; break; // + or =
            case 59: code = (flags & KeyFlags.Shift) ? 0x3a : 0x3b; break; // : or ;
            case 186: code = (flags & KeyFlags.Shift) ? 0x3a : 0x3b; break; // : or ;
            case 187: code = (flags & KeyFlags.Shift) ? 0x2b : 0x3d; break; // + or =
            case 188: code = (flags & KeyFlags.Shift) ? 0x3c : 0x2c; break;
            case 189: code = (flags & KeyFlags.Shift) ? 0x5f : 0x2d; break; // _ or -
            case 190: code = (flags & KeyFlags.Shift) ? 0x3e : 0x2e; break;
            case 191: code = (flags & KeyFlags.Shift) ? 0x3f : 0x2f; break;
            case 222: code = (flags & KeyFlags.Shift) ? 0x22 : 0x27; break;
            default:
               code = key;
               // convert to uppercase for Apple ][
               if (code >= 0x61 && code <= 0x7a) code -= 32;
               // convert to control codes if Ctrl pressed
               if (code >= 65 && code < 65 + 26) {
                  if (flags & KeyFlags.Ctrl) code -= 64; // ctrl
               }
         }
         if (code) {
            this.kbdlatch = (code | 0x80) & 0xff;
         }
      }
   }

   setPaddleInput(controller: number, value: number): void {
      if (controller >= 0 && controller < this.paddleValues.length) {
         this.paddleValues[controller] = value & 0xff;
      }
   }

   setPaddleButton(index: number, pressed: boolean): void {
      if (index >= 0 && index < this.paddleButtons.length) {
         this.paddleButtons[index] = pressed;
      }
   }

   doLanguageCardIO(address: number) {
      // TODO: require two writes in a row for some things
      switch (address & 0x0f) {
         // Select aux RAM bank 2, write protected.
         case 0x0:
         case 0x4:
            this.auxRAMselected = true;
            this.auxRAMbank = 2;
            this.writeinhibit = true;
            break;
         // Select ROM, write enable aux RAM bank 2.
         case 0x1:
         case 0x5:
            this.auxRAMselected = false;
            this.auxRAMbank = 2;
            this.writeinhibit = false;
            break;
         // Select ROM, write protect aux RAM (either bank).
         case 0x2:
         case 0x6:
         case 0xA:
         case 0xE:
            this.auxRAMselected = false;
            this.writeinhibit = true;
            break;
         // Select aux RAM bank 2, write enabled.
         case 0x3:
         case 0x7:
            this.auxRAMselected = true;
            this.auxRAMbank = 2;
            this.writeinhibit = false;
            break;
         // Select aux RAM bank 1, write protected.
         case 0x8:
         case 0xC:
            this.auxRAMselected = true;
            this.auxRAMbank = 1;
            this.writeinhibit = true;
            break;
         // Select ROM, write enable aux RAM bank 1.
         case 0x9:
         case 0xD:
            this.auxRAMselected = false;
            this.auxRAMbank = 1;
            this.writeinhibit = false;
            break;
         // Select aux RAM bank 1, write enabled.
         case 0xB:
         case 0xF:
            this.auxRAMselected = true;
            this.auxRAMbank = 1;
            this.writeinhibit = false;
            break;
      }
      this.setupLanguageCardConstants();
      return this.floatbus();
   }

   setupLanguageCardConstants() {
      // reset language card constants
      if (this.auxRAMbank == 2)
         this.bank2rdoffset = -0x1000;   // map 0xd000-0xdfff -> 0xc000-0xcfff
      else
         this.bank2rdoffset = 0x3000; // map 0xd000-0xdfff -> 0x10000-0x10fff
      if (this.auxRAMbank == 2)
         this.bank2wroffset = -0x1000;   // map 0xd000-0xdfff -> 0xc000-0xcfff
      else
         this.bank2wroffset = 0x3000; // map 0xd000-0xdfff -> 0x10000-0x10fff
   }

   getDebugCategories() {
      return ['CPU', 'Stack', 'I/O', 'Disk'];
   }
   getDebugInfo(category: string, state: AppleIIState) {
      switch (category) {
         case 'I/O': return "AUX RAM Bank:   " + state.auxRAMbank +
            "\nAUX RAM Select: " + state.auxRAMselected +
            "\nAUX RAM Write:  " + !state.writeinhibit +
            (this.enhanced ?
               "\nRAMRD/RAMWRT:   " + (state.iie && state.iie.ramrd ? "aux" : "main") + "/" +
               (state.iie && state.iie.ramwrt ? "aux" : "main") +
               "\n80STORE/80COL:  " + (state.iie && state.iie.store80) + "/" + (state.iie && state.iie.col80) +
               "\nALTCHARSET:     " + (state.iie && state.iie.altcharset) +
               "\nDHIRES (AN3):   " + (state.iie && state.iie.an3 === false ? "on" : "off") : "") +
            "\n\nGR Switches: " + printFlags(state.grswitch, ["Graphics", "Mixed", "Page2", "Hires"], false) +
            "\n";
         case 'Disk': return (this.slots[6] && this.slots[6]['toLongString'] && this.slots[6]['toLongString']()) || "\n";
      }
   }
}

const GR_TXMODE = 1;
const GR_MIXMODE = 2;
const GR_PAGE1 = 4;
const GR_HIRES = 8;

type AppleGRParams = {
   dirty: boolean[], grswitch: number, mem: Uint8Array,
   // Apple //e video: 64K auxiliary RAM and the 80COL switch
   auxmem?: Uint8Array, col80?: boolean, an3?: boolean,
   // use the //e character generator (incl. lowercase) instead of the II+ one
   enhanced?: boolean
};

var Apple2Display = function (pixels: Uint32Array, apple: AppleGRParams, width: number = 280) {
   var XSIZE = width;
   var YSIZE = 192;
   var PIXELON = 0xffffffff;
   var PIXELOFF = 0xff000000;
   // 40-column modes are stretched 2x on the //e's 560-pixel raster
   var HSCALE = Math.max(1, Math.floor(XSIZE / 280));

   var oldgrmode = -1;
   var textbuf = new Array(80 * 24);

   const flashInterval = 250;

   // https://mrob.com/pub/xapple2/colors.html
   const loresColor = [
      RGBA(0, 0, 0),
      RGBA(227, 30, 96),
      RGBA(96, 78, 189),
      RGBA(255, 68, 253),
      RGBA(0, 163, 96),
      RGBA(156, 156, 156),
      RGBA(20, 207, 253),
      RGBA(208, 195, 255),
      RGBA(96, 114, 3),
      RGBA(255, 106, 60),
      RGBA(156, 156, 156),
      RGBA(255, 160, 208),
      RGBA(20, 245, 60),
      RGBA(208, 221, 141),
      RGBA(114, 255, 208),
      RGBA(255, 255, 255)
   ];

   const text_lut = [
      0x000, 0x080, 0x100, 0x180, 0x200, 0x280, 0x300, 0x380,
      0x028, 0x0a8, 0x128, 0x1a8, 0x228, 0x2a8, 0x328, 0x3a8,
      0x050, 0x0d0, 0x150, 0x1d0, 0x250, 0x2d0, 0x350, 0x3d0
   ];

   const hires_lut = [
      0x0000, 0x0400, 0x0800, 0x0c00, 0x1000, 0x1400, 0x1800, 0x1c00,
      0x0080, 0x0480, 0x0880, 0x0c80, 0x1080, 0x1480, 0x1880, 0x1c80,
      0x0100, 0x0500, 0x0900, 0x0d00, 0x1100, 0x1500, 0x1900, 0x1d00,
      0x0180, 0x0580, 0x0980, 0x0d80, 0x1180, 0x1580, 0x1980, 0x1d80,
      0x0200, 0x0600, 0x0a00, 0x0e00, 0x1200, 0x1600, 0x1a00, 0x1e00,
      0x0280, 0x0680, 0x0a80, 0x0e80, 0x1280, 0x1680, 0x1a80, 0x1e80,
      0x0300, 0x0700, 0x0b00, 0x0f00, 0x1300, 0x1700, 0x1b00, 0x1f00,
      0x0380, 0x0780, 0x0b80, 0x0f80, 0x1380, 0x1780, 0x1b80, 0x1f80,
      0x0028, 0x0428, 0x0828, 0x0c28, 0x1028, 0x1428, 0x1828, 0x1c28,
      0x00a8, 0x04a8, 0x08a8, 0x0ca8, 0x10a8, 0x14a8, 0x18a8, 0x1ca8,
      0x0128, 0x0528, 0x0928, 0x0d28, 0x1128, 0x1528, 0x1928, 0x1d28,
      0x01a8, 0x05a8, 0x09a8, 0x0da8, 0x11a8, 0x15a8, 0x19a8, 0x1da8,
      0x0228, 0x0628, 0x0a28, 0x0e28, 0x1228, 0x1628, 0x1a28, 0x1e28,
      0x02a8, 0x06a8, 0x0aa8, 0x0ea8, 0x12a8, 0x16a8, 0x1aa8, 0x1ea8,
      0x0328, 0x0728, 0x0b28, 0x0f28, 0x1328, 0x1728, 0x1b28, 0x1f28,
      0x03a8, 0x07a8, 0x0ba8, 0x0fa8, 0x13a8, 0x17a8, 0x1ba8, 0x1fa8,
      0x0050, 0x0450, 0x0850, 0x0c50, 0x1050, 0x1450, 0x1850, 0x1c50,
      0x00d0, 0x04d0, 0x08d0, 0x0cd0, 0x10d0, 0x14d0, 0x18d0, 0x1cd0,
      0x0150, 0x0550, 0x0950, 0x0d50, 0x1150, 0x1550, 0x1950, 0x1d50,
      0x01d0, 0x05d0, 0x09d0, 0x0dd0, 0x11d0, 0x15d0, 0x19d0, 0x1dd0,
      0x0250, 0x0650, 0x0a50, 0x0e50, 0x1250, 0x1650, 0x1a50, 0x1e50,
      0x02d0, 0x06d0, 0x0ad0, 0x0ed0, 0x12d0, 0x16d0, 0x1ad0, 0x1ed0,
      0x0350, 0x0750, 0x0b50, 0x0f50, 0x1350, 0x1750, 0x1b50, 0x1f50,
      0x03d0, 0x07d0, 0x0bd0, 0x0fd0, 0x13d0, 0x17d0, 0x1bd0, 0x1fd0,
      // just for floating bus, y >= 192
      0x0078, 0x0478, 0x0878, 0x0c78, 0x1078, 0x1478, 0x1878, 0x1c78,
      0x00f8, 0x04f8, 0x08f8, 0x0cf8, 0x10f8, 0x14f8, 0x18f8, 0x1cf8,
      0x0178, 0x0578, 0x0978, 0x0d78, 0x1178, 0x1578, 0x1978, 0x1d78,
      0x01f8, 0x05f8, 0x09f8, 0x0df8, 0x11f8, 0x15f8, 0x19f8, 0x1df8,
      0x0278, 0x0678, 0x0a78, 0x0e78, 0x1278, 0x1678, 0x1a78, 0x1e78,
      0x02f8, 0x06f8, 0x0af8, 0x0ef8, 0x12f8, 0x16f8, 0x1af8, 0x1ef8,
      0x0378, 0x0778, 0x0b78, 0x0f78, 0x1378, 0x1778, 0x1b78, 0x1f78,
      0x03f8, 0x07f8, 0x0bf8, 0x0ff8, 0x13f8, 0x17f8, 0x1bf8, 0x1ff8,
      0x0000, 0x0400, 0x0800, 0x0c00, 0x1000, 0x1400,
   ];

   var colors_lut;

   /**
     * This function makes the color lookup table for hires mode.
     * We make a table of 1024 * 2 * 7 entries.
     * Why? Because we assume each color byte has 10 bits
     * (8 real bits + 1 on each side) and we need different colors
     * for odd and even addresses (2) and each byte displays 7 pixels.
     */
   {
      colors_lut = new Array(256 * 4 * 2 * 7);
      var i, j;
      var c1, c2, c3 = 15;
      var base = 0;

      // go thru odd and even
      for (j = 0; j < 2; j++) {
         // go thru 1024 values
         for (var b1 = 0; b1 < 1024; b1++) {
            // see if the hi bit is set
            if ((b1 & 0x80) == 0) {
               c1 = 3; c2 = 12;    // purple & green
            } else {
               c1 = 6; c2 = 9;     // blue & orange
            }
            // make a value consisting of:
            // the 8th bit, then bits 0-7, then the 9th bit
            var b = ((b1 & 0x100) >> 8) | ((b1 & 0x7f) << 1) |
               ((b1 & 0x200) >> 1);
            // go through each pixel
            for (i = 0; i < 7; i++) {
               var c;
               // is this pixel lit?
               if (((2 << i) & b) != 0) {
                  // are there pixels lit on both sides of this one?
                  if (((7 << i) & b) == (7 << i))
                     // yes, make it white
                     c = 15;
                  else
                     // no, choose color based on odd/even byte
                     // and odd/even pixel column
                     c = ((((j ^ i) & 1) == 0) ? c1 : c2);
               } else {
                  // are there pixels lit in the previous & next
                  // column but none in this?
                  if (((5 << i) & b) == (5 << i))
                     // color this pixel
                     c = ((((j ^ i) & 1) != 0) ? c1 : c2);
                  else
                     c = 0;
               }
               colors_lut[base] = loresColor[c];
               base++;
            }
         }
      }
   }

   function fillPixels(base, n, c) {
      for (var i = 0; i < n; i++) pixels[base + i] = c;
   }

   function drawLoresChar(x, y, b, scale) {
      var base = (y << 3) * XSIZE + x * 7 * scale;
      var w = 7 * scale;
      var c = loresColor[b & 0x0f];
      for (var i = 0; i < 4; i++) {
         fillPixels(base, w, c);
         base += XSIZE;
      }
      c = loresColor[b >> 4];
      for (var i = 0; i < 4; i++) {
         fillPixels(base, w, c);
         base += XSIZE;
      }
   }

   /** Rotate a 4-bit color number left one bit (bit 3 wraps to bit 0). */
   function rolNibble(n) {
      return ((n << 1) | (n >> 3)) & 0x0f;
   }

   /** Double lo-res (80COL + lo-res): 80 columns of 7x4 blocks, aux (even column) then main (odd). */
   function drawDloResChar(x, y, mb, ab) {
      var base = (y << 3) * XSIZE + x * 14;
      for (var half = 0; half < 2; half++) {
         // aux memory is the left (even) column, main the right (odd) one.
         // The aux column is shifted out a quarter color cycle off main's phase,
         // so an aux nibble shows as the lo-res color it equals rotated left one
         // bit (aux 1 is dark blue, aux 8 magenta), as in MAME's aux_colors table.
         var c1 = loresColor[rolNibble(half ? (ab >> 4) : (ab & 0x0f))];
         var c2 = loresColor[half ? (mb >> 4) : (mb & 0x0f)];
         for (var i = 0; i < 4; i++) {
            fillPixels(base, 7, c1);
            fillPixels(base + 7, 7, c2);
            base += XSIZE;
         }
      }
   }

   function drawTextChar(x, y, b, invert, scale) {
      var w = 7 * scale;
      var base = (y << 3) * XSIZE + x * w;
      var on = invert ? PIXELOFF : PIXELON;
      var off = invert ? PIXELON : PIXELOFF;
      for (var yy = 0; yy < 8; yy++) {
         var chr = apple.enhanced ? getApple2eVideoROM()[(b << 3) + yy] : apple2_charset[(b << 3) + yy];
         for (var px = 0; px < 7; px++) {
            fillPixels(base + px * scale, scale, ((chr & (64 >> px)) != 0) ? on : off);
         }
         base += XSIZE;
      }
   }

   this.getAddressForScanline = function (y: number): number {
      var base = hires_lut[y];
      if ((apple.grswitch & GR_HIRES) && (y < 160 || !(apple.grswitch & GR_MIXMODE)))
         base = base | ((apple.grswitch & GR_PAGE1) ? 0x4000 : 0x2000);
      else
         base = (base & 0x3ff) | ((apple.grswitch & GR_PAGE1) ? 0x800 : 0x400);
      return base;
   }

   function drawHiresLines(y, maxy) {
      var yb = y * XSIZE;
      for (; y < maxy; y++) {
         var base = hires_lut[y] + (((apple.grswitch & GR_PAGE1) != 0) ? 0x4000 : 0x2000);
         if (!apple.dirty[base >> 7]) {
            yb += XSIZE;
            continue;
         }
         var b = 0;
         var b1 = apple.mem[base] & 0xff;
         for (var x1 = 0; x1 < 20; x1++) {
            var b2 = apple.mem[base + 1] & 0xff;
            var b3 = apple.mem[base + 2] & 0xff;
            var d1 = (((b & 0x40) << 2) | b1 | b2 << 9) & 0x3ff;
            for (var i = 0; i < 7; i++) {
               var c1 = colors_lut[d1 * 7 + i];
               for (var k = 0; k < HSCALE; k++) pixels[yb + i * HSCALE + k] = c1;
            }
            var d2 = (((b1 & 0x40) << 2) | b2 | b3 << 9) & 0x3ff;
            for (var i = 0; i < 7; i++) {
               var c2 = colors_lut[d2 * 7 + 7168 + i];
               for (var k = 0; k < HSCALE; k++) pixels[yb + 7 * HSCALE + i * HSCALE + k] = c2;
            }
            yb += 14 * HSCALE;
            base += 2;
            b = b2;
            b1 = b3;
         }
      }
   }

   /**
    * Double hi-res (80COL + HIRES + DHIRES): 560 dots per line, of which every
    * 4 consecutive dots form one of 16 colors (140 pixels). The scanner shifts
    * out aux bits 0-6 then main bits 0-6 of each column, low bit first, bit 7
    * is ignored (there is no palette bit). The nibbles straddle byte boundaries
    * (4 bytes make 7 pixels), so keep a bit accumulator.
    *
    * The DHR nibble is the lo-res color number rotated right by one bit (yellow,
    * lo-res 13 = 1101, is 1110 in DHR; magenta 1 is 8; dark blue 2 is 1), so the
    * palette index is the nibble rotated back left. 0000 and 1111 are unchanged.
    */
   function drawDHRLines(y, maxy) {
      var mem = apple.mem, aux = apple.auxmem;
      var yb = y * XSIZE;
      var pw = XSIZE / 140; // pixel width in buffer pixels
      for (; y < maxy; y++) {
         var base = hires_lut[y] + (((apple.grswitch & GR_PAGE1) != 0) ? 0x4000 : 0x2000);
         if (!apple.dirty[base >> 7]) {
            yb += XSIZE;
            continue;
         }
         var bits = 0, nbits = 0, px = yb;
         for (var x = 0; x < 40; x++) {
            bits |= ((aux[base + x] & 0x7f) | ((mem[base + x] & 0x7f) << 7)) << nbits;
            nbits += 14;
            while (nbits >= 4) {
               var n = bits & 0x0f;
               fillPixels(px, pw, loresColor[rolNibble(n)]);
               px += pw;
               bits >>= 4;
               nbits -= 4;
            }
         }
         yb += XSIZE;
      }
   }


   function drawLoresLine(y, scale) {
      // get the base address of this line
      var base = text_lut[y] +
         (((apple.grswitch & GR_PAGE1) != 0) ? 0x800 : 0x400);
      for (var x = 0; x < 40; x++) {
         var b = apple.mem[base + x] & 0xff;
         // if the char. changed, draw it
         if (b != textbuf[y * 80 + x]) {
            drawLoresChar(x, y, b, scale);
            textbuf[y * 80 + x] = b;
         }
      }
   }

   function drawDloResLine(y) {
      var base = text_lut[y] +
         (((apple.grswitch & GR_PAGE1) != 0) ? 0x800 : 0x400);
      for (var x = 0; x < 40; x++) {
         var mb = apple.mem[base + x] & 0xff;
         var ab = apple.auxmem[base + x] & 0xff;
         var key = (mb << 8) | ab;
         if (key != textbuf[y * 80 + x]) {
            drawDloResChar(x, y, mb, ab);
            textbuf[y * 80 + x] = key;
         }
      }
   }

   function drawTextLine(y, flash) {
      // get the base address of this line
      var base = text_lut[y] +
         (((apple.grswitch & GR_PAGE1) != 0) ? 0x800 : 0x400);
      for (var x = 0; x < 40; x++) {
         var b = apple.mem[base + x] & 0xff;
         var invert;
         // invert flash characters 1/2 of the time
         if (b >= 0x80) {
            invert = false;
         } else if (b >= 0x40) {
            invert = flash;
            if (flash)
               b -= 0x40;
            else
               b += 0x40;
         } else
            invert = true;
         // if the char. changed, draw it
         if (b != textbuf[y * 80 + x]) {
            drawTextChar(x, y, b & 0x7f, invert, HSCALE);
            textbuf[y * 80 + x] = b;
         }
      }
   }

   /** 80-column text: 40 cells, each main byte then aux byte, 7 pixels each. */
   function drawTextLine80(y) {
      var base = text_lut[y] +
         (((apple.grswitch & GR_PAGE1) != 0) ? 0x800 : 0x400);
      for (var x = 0; x < 40; x++) {
         var mb = apple.mem[base + x] & 0xff;
         var ab = apple.auxmem[base + x] & 0xff;
         var key = (mb << 8) | ab;
         if (key != textbuf[y * 80 + x]) {
            // high bit clear is inverse (there is no flashing in 80 columns)
            // aux memory holds the even columns, main the odd ones
            drawTextChar(x * 2, y, ab & 0x7f, (ab & 0x80) == 0, 1);
            drawTextChar(x * 2 + 1, y, mb & 0x7f, (mb & 0x80) == 0, 1);
            textbuf[y * 80 + x] = key;
         }
      }
   }

   this.updateScreen = function (totalrepaint) {
      var y;
      var flash = (new Date().getTime() % (flashInterval << 1)) > flashInterval;
      var is80 = !!(apple.auxmem && apple.col80);
      // double hi-res needs 80COL and DHIRES (AN3 clear); otherwise hi-res is
      // drawn at twice the width like the other 40-column modes
      var isDHR = is80 && apple.an3 === false;
      var modekey = apple.grswitch | (is80 ? 0x100 : 0) | (isDHR ? 0x200 : 0);

      // if graphics mode changed, repaint whole screen
      if (modekey != oldgrmode) {
         oldgrmode = modekey;
         totalrepaint = true;
      }
      if (totalrepaint) {
         for (y = 0; y < 24 * 80; y++)
            textbuf[y] = -1;
         for (var i = 0; i < apple.dirty.length; i++)
            apple.dirty[i] = true;
      }

      // first, draw top part of window
      if ((apple.grswitch & GR_TXMODE) != 0) {
         for (y = 0; y < 20; y++)
            is80 ? drawTextLine80(y) : drawTextLine(y, flash);
      } else {
         if ((apple.grswitch & GR_HIRES) != 0) {
            if (isDHR) drawDHRLines(0, 160);
            else drawHiresLines(0, 160);
         } else {
            for (y = 0; y < 20; y++)
               is80 ? drawDloResLine(y) : drawLoresLine(y, HSCALE);
         }
      }

      // now do mixed part of window
      if ((apple.grswitch & GR_TXMODE) != 0 || (apple.grswitch & GR_MIXMODE) != 0) {
         for (y = 20; y < 24; y++)
            is80 ? drawTextLine80(y) : drawTextLine(y, flash);
      } else {
         if ((apple.grswitch & GR_HIRES) != 0) {
            if (isDHR) drawDHRLines(160, 192);
            else drawHiresLines(160, 192);
         } else {
            for (y = 20; y < 24; y++)
               is80 ? drawDloResLine(y) : drawLoresLine(y, HSCALE);
         }
      }
      for (var i = 0; i < apple.dirty.length; i++)
         apple.dirty[i] = false;
   }

   this.invalidate = function () {
      oldgrmode = -1;
   }
}

// Apple //e video ROM (342-0133-A, US 1982), LZG-compressed: the 4K character
// generator. Page 0 ($000-$3FF) holds the normal glyphs for codes $00-$7F
// (including lowercase at $60-$7F), page 1 ($400) is its inverse, and pages
// 2-3 ($800/$C00) are the ALTCHARSET/MouseText set. The ROM stores each pixel
// row with bit 0 leftmost, the opposite of apple2_charset, so the bytes are
// bit-reversed when decoded.
const APPLE2E_VIDEO_ROM_LZG =
   "TFpHAAAQAAAACrZ66/4EAQEDBQccIio6GgI8AAgUIiI+IiIAHiIiB0IAHCICAgIiHAVIBwEeAD4CAh4CAj4H5QIA" +
   "PAeBMiI8AAUVBS8iABwIBwIcACAHAgUwIhIKBgoSIgAFHwcBPgAiNioqBWAiIiYqMgVoAwNQAwNYAwNIBUgqEiwF" +
   "iAVwHCICHAMCQD4DA1AIBTAF6AfDFAWIKio2AwJIFAMCswfjBWA+IBAIBAMCoAYHAj4AAAIECBAgAAA+MAcCBQgD" +
   "AuIHoQcFfwflAAMEXggAFBQUBYgUFD4HIRQACDwKHCgeCAAGJhAIBDIwAAQKCgQDAqAFZgWwBAICAgQFMhAgICAQ" +
   "B+EqHAgcKgUUCAg+AwUbBQMEB8IDAnUHBQURAwOgAAAcIjIqJiIcAAgMAyQ4HCIgGAMDuCAQGAMC+BAYFBI+EBAA" +
   "PgIeAyNQOAQCHgMiAAMD4AQEBSgiB0IH4jwgEA4DA1QDBZIDA3AFHgMC+gMDdwMCeQUEBXIFKBADA+gcAz/4Az74" +
   "Az34BwR/AyQUBwIcIDwiPAACAyJXIh4FCAMC2jwAIAUOIgUQBRgiPgUIGCQEHgMicAVIIjwgHAXoIgAIAAMiuRwA" +
   "EAAYEBAQEgwCAiISDhIiBY4FUAAANioqKgMCcgXoBbgiBVADBPoAADwDAkggAAA6BgMiCAUIAhwgHgAEAwJnJBgF" +
   "CAUnMiwH5BQDItoDA/kH4gMC+QXQPCAcAAA+EAgEPgA4DAwGDAw4A0TQBwEOGBgwGBgOACwaAwXnKhQHIQAA493V" +
   "xeX9w//3693dwd3d/+Hd3QdC/+Pd/f393eMFSAcB4f/B/f3h/f3BB+X9/8MHgc3dw/8FFQUv3f/j9wcC4//fBwIF" +
   "MN3t9fn17d3/BR8HAcH/3cnV1QVg3d3Z1c0FaAMDUAMDWAMDSAVI1e3TBYgFcOPd/eMDAkDBAwNQ9wUwBegHw+sF" +
   "iNXVyQMCSOsDArMH4wVgwd/v9/sDAqD5BwLB///9+/fv3///wc8HAgUIAwLiB6EHBYAH5f8DBF73/+vr6wWI6+vB" +
   "ByHr//fD9ePX4ff/+dnv9/vNz//79fX7AwKgBWYFsPv9/f37BTLv39/f7wfh1eP349UFFPf3wQMFGwUD+wfCAwJ1" +
   "BwUFEQMDoP//493N1dnd4//38wMkOOPd3+cDA7jf7+cDAvjv5+vtwe/v/8H94QMjUMf7/eEDIgADA+D7+wUo3QdC" +
   "B+LD3+/xAwNUAwWSAwNwBR4DAvoDA3cDAnkFBAVyBSjvAwPoAz/4Az/4AyQUBwLj38Pdw//9AyJX3eEFCAMC2sP/" +
   "3wUO3QUQBRjdwQUI59v74QMicAVI3cPf4wXo3f/3/wMiueP/7//n7+/v7fP9/d3t8e3dBY4FUP//ydXV1QMCcgXo" +
   "BbjdBVADBPr//8MDAkjf///F+QMiCAUI/ePf4f/7AwJn2+cFCAUnzdMH5OsDItoDA/kH4gMC+QXQw9/j///B7/f7" +
   "wf/H8/P58/PHA0TQBwHx5+fP5+fx/9PlAwXn1esHIQMoAf7+7rv+/v///f3ddwMCd/z8zDP8/P//+/u77gMC5/r6" +
   "qqr6+v//+fmZZvn5///4+Igi+PgDQtR33QNC4Pb2Zpn29v//9fVVVfX1///09EQR9PT///PzM8zz8///8vIiiPLy" +
   "///x8RFE8fH///DwAADw8P//7+8HYu677u4HZO3t3Xft7e677OzMM+zs7rvr67vu6+vuu+rqqqrq6u676emZZunp" +
   "7rvo6Igi6Ojuu+fnd93n5+675uZmmebm7rvl5VVV5eXuu+TkRBHk5O674+MzzOPj7rvi4iKI4uLuu+HhEUTh4e67" +
   "4OAAAODg7rsDImrf39133t7uu97e3Xfd3Qdk3NzMM9zc3Xfb27vu29vdd9raqqra2t132dmZZtnZ3XfY2Igi2Njd" +
   "d9fXd93X19131tZmmdbW3XfV1VVV1dXdd9TURBHU1N1309MzzNPT3XfS0iKI0tLdd9HREUTR0d130NAAANDQ3XfP" +
   "z///z8/MM87O7rvOzswzzc3dd83NzDPMzAdky8u77svLzDPKyqqqysrMM8nJmWbJycwzyMiIIsjIzDPHx3fdx8fM" +
   "M8bGZpnGxswzxcVVVcXFzDPExEQRxMTMM8PDM8zDw8wzwsIiiMLCzDPBwRFEwcHMM8DAAADAwMwzv7///7+/u+6+" +
   "vu67vr677r293Xe9vbvuvLzMM7y8u+67uwdkurqqqrq6u+65uZlmubm77ri4iCK4uLvut7d33be3u+62tmaZtra7" +
   "7rW1VVW1tbvutLREEbS0u+6zszPMs7O77rKyIoiysrvusbERRLGxu+6wsAAAsLC77q+v//+vr6qqrq7uu66uqqqt" +
   "rd13ra2qqqyszDOsrKqqq6u77qurqgcHqamZZqmpqqqoqIgiqKiqqqend92np6qqpqZmmaamqqqlpVVVpaWqqqSk" +
   "RBGkpKqqo6MzzKOjqqqioiKIoqKqqqGhEUShoaqqoKAAAKCgqqqfn///n5+ZZp6e7ruenplmnZ3dd52dmWacnMwz" +
   "nJyZZpubu+6bm5lmmpqqqpqamWaZmQdkmJiIIpiYmWaXl3fdl5eZZpaWZpmWlplmlZVVVZWVmWaUlEQRlJSZZpOT" +
   "M8yTk5lmkpIiiJKSmWaRkRFEkZGZZpCQAACQkJlmj4///4+PiCKOju67jo6IIo2N3XeNjYgijIzMM4yMiCKLi7vu" +
   "i4uIIoqKqqqKiogiiYmZZomJiCKIiAdkh4d33YeHiCKGhmaZhoaIIoWFVVWFhYgihIREEYSEiCKDgzPMg4OIIoKC" +
   "IoiCgogigYERRIGBiCKAgAAAgICIIgNk9nfdA2T4d90DZPh33QNk+HfdA2T4d90DZPh33QNk+HfdA2T4A2L0B2QD" +
   "ZPh33QNk+HfdA2T4d90DZPh33QNk+HfdA2T4d90DZPh33QNk+GaZA2T4ZpkDZPhmmQNk+GaZA2T4ZpkDZPhmmQNk" +
   "+GaZA2T4ZpkDZPgDYvQHZANk+GaZA2T4ZpkDZPhmmQNk+GaZA2T4ZpkDZPhmmQNk+FVVA2T4VVUDZPhVVQNk+FVV" +
   "A2T4VVUDZPhVVQNk+FVVA2T4VVUDZPhVVQNk+ANi9AdkA2T4VVUDZPhVVQNk+FVVA2T4VVUDZPhVVQNk+EQRA2T4" +
   "RBEDZPhEEQNk+EQRA2T4RBEDZPhEEQNk+EQRA2T4RBEDZPhEEQNk+EQRA2T4A2L0B2QDZPhEEQNk+EQRA2T4RBED" +
   "ZPhEEQNk+DPMA2T4M8wDZPgzzANk+DPMA2T4M8wDZPgzzANk+DPMA2T4M8wDZPgzzANk+DPMA2T4M8wDZPgDYvQH" +
   "ZANk+DPMA2T4M8wDZPgzzANk+CKIA2T4IogDZPgiiANk+CKIA2T4IogDZPYiiANk+CKIA2T4IogDZPgiiANk+CKI" +
   "A2T4IogDZPgiiANk+ANi9AdkA2T4IogDZPgiiANk+BFEA2T4EUQDZPgRRANk+BFEA2T4EUQDZPgRRANk+BFEA2T4" +
   "EUQDZPgRRANk+BFEA2T4EUQDZPgRRANk+BFEA2T4A2L0B2QDZPgRRANk+AAAA2T4AAADZPgAAANk+AAAA2T4AAAD" +
   "ZPgAAANk+AAAA2T4AAADZPgAAANk+AAAA2T4AAADZPgAAANk+AAAA2T4AAADZPgDYvQHZA==";
let apple2e_video_rom: number[];
function getApple2eVideoROM(): number[] {
   if (!apple2e_video_rom) {
      var rom = new lzgmini().decode(stringToByteArray(atob(APPLE2E_VIDEO_ROM_LZG)));
      // reverse the low 7 bits of each row: ROM bit 0 is the leftmost pixel
      for (var i = 0; i < rom.length; i++) {
         var b = rom[i] & 0x7f, r = 0;
         for (var k = 0; k < 7; k++)
            if (b & (1 << k)) r |= 0x40 >> k;
         rom[i] = r | (rom[i] & 0x80);
      }
      apple2e_video_rom = rom;
   }
   return apple2e_video_rom;
}

/*exported apple2_charset */

const apple2_charset = [
   0x00, 0x1c, 0x22, 0x2a, 0x2e, 0x2c, 0x20, 0x1e,
   0x00, 0x08, 0x14, 0x22, 0x22, 0x3e, 0x22, 0x22,
   0x00, 0x3c, 0x22, 0x22, 0x3c, 0x22, 0x22, 0x3c,
   0x00, 0x1c, 0x22, 0x20, 0x20, 0x20, 0x22, 0x1c,
   0x00, 0x3c, 0x22, 0x22, 0x22, 0x22, 0x22, 0x3c,
   0x00, 0x3e, 0x20, 0x20, 0x3c, 0x20, 0x20, 0x3e,
   0x00, 0x3e, 0x20, 0x20, 0x3c, 0x20, 0x20, 0x20,
   0x00, 0x1e, 0x20, 0x20, 0x20, 0x26, 0x22, 0x1e,
   0x00, 0x22, 0x22, 0x22, 0x3e, 0x22, 0x22, 0x22,
   0x00, 0x1c, 0x08, 0x08, 0x08, 0x08, 0x08, 0x1c,
   0x00, 0x02, 0x02, 0x02, 0x02, 0x02, 0x22, 0x1c,
   0x00, 0x22, 0x24, 0x28, 0x30, 0x28, 0x24, 0x22,
   0x00, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x3e,
   0x00, 0x22, 0x36, 0x2a, 0x2a, 0x22, 0x22, 0x22,
   0x00, 0x22, 0x22, 0x32, 0x2a, 0x26, 0x22, 0x22,
   0x00, 0x1c, 0x22, 0x22, 0x22, 0x22, 0x22, 0x1c,
   0x00, 0x3c, 0x22, 0x22, 0x3c, 0x20, 0x20, 0x20,
   0x00, 0x1c, 0x22, 0x22, 0x22, 0x2a, 0x24, 0x1a,
   0x00, 0x3c, 0x22, 0x22, 0x3c, 0x28, 0x24, 0x22,
   0x00, 0x1c, 0x22, 0x20, 0x1c, 0x02, 0x22, 0x1c,
   0x00, 0x3e, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08,
   0x00, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x1c,
   0x00, 0x22, 0x22, 0x22, 0x22, 0x22, 0x14, 0x08,
   0x00, 0x22, 0x22, 0x22, 0x2a, 0x2a, 0x36, 0x22,
   0x00, 0x22, 0x22, 0x14, 0x08, 0x14, 0x22, 0x22,
   0x00, 0x22, 0x22, 0x14, 0x08, 0x08, 0x08, 0x08,
   0x00, 0x3e, 0x02, 0x04, 0x08, 0x10, 0x20, 0x3e,
   0x00, 0x3e, 0x30, 0x30, 0x30, 0x30, 0x30, 0x3e,
   0x00, 0x00, 0x20, 0x10, 0x08, 0x04, 0x02, 0x00,
   0x00, 0x3e, 0x06, 0x06, 0x06, 0x06, 0x06, 0x3e,
   0x00, 0x00, 0x00, 0x08, 0x14, 0x22, 0x00, 0x00,
   0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3e,
   0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
   0x00, 0x08, 0x08, 0x08, 0x08, 0x08, 0x00, 0x08,
   0x00, 0x14, 0x14, 0x14, 0x00, 0x00, 0x00, 0x00,
   0x00, 0x14, 0x14, 0x3e, 0x14, 0x3e, 0x14, 0x14,
   0x00, 0x08, 0x1e, 0x28, 0x1c, 0x0a, 0x3c, 0x08,
   0x00, 0x30, 0x32, 0x04, 0x08, 0x10, 0x26, 0x06,
   0x00, 0x10, 0x28, 0x28, 0x10, 0x2a, 0x24, 0x1a,
   0x00, 0x08, 0x08, 0x08, 0x00, 0x00, 0x00, 0x00,
   0x00, 0x08, 0x10, 0x20, 0x20, 0x20, 0x10, 0x08,
   0x00, 0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08,
   0x00, 0x08, 0x2a, 0x1c, 0x08, 0x1c, 0x2a, 0x08,
   0x00, 0x00, 0x08, 0x08, 0x3e, 0x08, 0x08, 0x00,
   0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x08, 0x10,
   0x00, 0x00, 0x00, 0x00, 0x3e, 0x00, 0x00, 0x00,
   0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08,
   0x00, 0x00, 0x02, 0x04, 0x08, 0x10, 0x20, 0x00,
   0x00, 0x1c, 0x22, 0x26, 0x2a, 0x32, 0x22, 0x1c,
   0x00, 0x08, 0x18, 0x08, 0x08, 0x08, 0x08, 0x1c,
   0x00, 0x1c, 0x22, 0x02, 0x0c, 0x10, 0x20, 0x3e,
   0x00, 0x3e, 0x02, 0x04, 0x0c, 0x02, 0x22, 0x1c,
   0x00, 0x04, 0x0c, 0x14, 0x24, 0x3e, 0x04, 0x04,
   0x00, 0x3e, 0x20, 0x3c, 0x02, 0x02, 0x22, 0x1c,
   0x00, 0x0e, 0x10, 0x20, 0x3c, 0x22, 0x22, 0x1c,
   0x00, 0x3e, 0x02, 0x04, 0x08, 0x10, 0x10, 0x10,
   0x00, 0x1c, 0x22, 0x22, 0x1c, 0x22, 0x22, 0x1c,
   0x00, 0x1c, 0x22, 0x22, 0x1e, 0x02, 0x04, 0x38,
   0x00, 0x00, 0x00, 0x08, 0x00, 0x08, 0x00, 0x00,
   0x00, 0x00, 0x00, 0x08, 0x00, 0x08, 0x08, 0x10,
   0x00, 0x04, 0x08, 0x10, 0x20, 0x10, 0x08, 0x04,
   0x00, 0x00, 0x00, 0x3e, 0x00, 0x3e, 0x00, 0x00,
   0x00, 0x10, 0x08, 0x04, 0x02, 0x04, 0x08, 0x10,
   0x00, 0x1c, 0x22, 0x04, 0x08, 0x08, 0x00, 0x08,
   0x80, 0x9c, 0xa2, 0xaa, 0xae, 0xac, 0xa0, 0x9e,
   0x80, 0x88, 0x94, 0xa2, 0xa2, 0xbe, 0xa2, 0xa2,
   0x80, 0xbc, 0xa2, 0xa2, 0xbc, 0xa2, 0xa2, 0xbc,
   0x80, 0x9c, 0xa2, 0xa0, 0xa0, 0xa0, 0xa2, 0x9c,
   0x80, 0xbc, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0xbc,
   0x80, 0xbe, 0xa0, 0xa0, 0xbc, 0xa0, 0xa0, 0xbe,
   0x80, 0xbe, 0xa0, 0xa0, 0xbc, 0xa0, 0xa0, 0xa0,
   0x80, 0x9e, 0xa0, 0xa0, 0xa0, 0xa6, 0xa2, 0x9e,
   0x80, 0xa2, 0xa2, 0xa2, 0xbe, 0xa2, 0xa2, 0xa2,
   0x80, 0x9c, 0x88, 0x88, 0x88, 0x88, 0x88, 0x9c,
   0x80, 0x82, 0x82, 0x82, 0x82, 0x82, 0xa2, 0x9c,
   0x80, 0xa2, 0xa4, 0xa8, 0xb0, 0xa8, 0xa4, 0xa2,
   0x80, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xbe,
   0x80, 0xa2, 0xb6, 0xaa, 0xaa, 0xa2, 0xa2, 0xa2,
   0x80, 0xa2, 0xa2, 0xb2, 0xaa, 0xa6, 0xa2, 0xa2,
   0x80, 0x9c, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0x9c,
   0x80, 0xbc, 0xa2, 0xa2, 0xbc, 0xa0, 0xa0, 0xa0,
   0x80, 0x9c, 0xa2, 0xa2, 0xa2, 0xaa, 0xa4, 0x9a,
   0x80, 0xbc, 0xa2, 0xa2, 0xbc, 0xa8, 0xa4, 0xa2,
   0x80, 0x9c, 0xa2, 0xa0, 0x9c, 0x82, 0xa2, 0x9c,
   0x80, 0xbe, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88,
   0x80, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0x9c,
   0x80, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0x94, 0x88,
   0x80, 0xa2, 0xa2, 0xa2, 0xaa, 0xaa, 0xb6, 0xa2,
   0x80, 0xa2, 0xa2, 0x94, 0x88, 0x94, 0xa2, 0xa2,
   0x80, 0xa2, 0xa2, 0x94, 0x88, 0x88, 0x88, 0x88,
   0x80, 0xbe, 0x82, 0x84, 0x88, 0x90, 0xa0, 0xbe,
   0x80, 0xbe, 0xb0, 0xb0, 0xb0, 0xb0, 0xb0, 0xbe,
   0x80, 0x80, 0xa0, 0x90, 0x88, 0x84, 0x82, 0x80,
   0x80, 0xbe, 0x86, 0x86, 0x86, 0x86, 0x86, 0xbe,
   0x80, 0x80, 0x80, 0x88, 0x94, 0xa2, 0x80, 0x80,
   0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0xbe,
   0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
   0x80, 0x88, 0x88, 0x88, 0x88, 0x88, 0x80, 0x88,
   0x80, 0x94, 0x94, 0x94, 0x80, 0x80, 0x80, 0x80,
   0x80, 0x94, 0x94, 0xbe, 0x94, 0xbe, 0x94, 0x94,
   0x80, 0x88, 0x9e, 0xa8, 0x9c, 0x8a, 0xbc, 0x88,
   0x80, 0xb0, 0xb2, 0x84, 0x88, 0x90, 0xa6, 0x86,
   0x80, 0x90, 0xa8, 0xa8, 0x90, 0xaa, 0xa4, 0x9a,
   0x80, 0x88, 0x88, 0x88, 0x80, 0x80, 0x80, 0x80,
   0x80, 0x88, 0x90, 0xa0, 0xa0, 0xa0, 0x90, 0x88,
   0x80, 0x88, 0x84, 0x82, 0x82, 0x82, 0x84, 0x88,
   0x80, 0x88, 0xaa, 0x9c, 0x88, 0x9c, 0xaa, 0x88,
   0x80, 0x80, 0x88, 0x88, 0xbe, 0x88, 0x88, 0x80,
   0x80, 0x80, 0x80, 0x80, 0x80, 0x88, 0x88, 0x90,
   0x80, 0x80, 0x80, 0x80, 0xbe, 0x80, 0x80, 0x80,
   0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x88,
   0x80, 0x80, 0x82, 0x84, 0x88, 0x90, 0xa0, 0x80,
   0x80, 0x9c, 0xa2, 0xa6, 0xaa, 0xb2, 0xa2, 0x9c,
   0x80, 0x88, 0x98, 0x88, 0x88, 0x88, 0x88, 0x9c,
   0x80, 0x9c, 0xa2, 0x82, 0x8c, 0x90, 0xa0, 0xbe,
   0x80, 0xbe, 0x82, 0x84, 0x8c, 0x82, 0xa2, 0x9c,
   0x80, 0x84, 0x8c, 0x94, 0xa4, 0xbe, 0x84, 0x84,
   0x80, 0xbe, 0xa0, 0xbc, 0x82, 0x82, 0xa2, 0x9c,
   0x80, 0x8e, 0x90, 0xa0, 0xbc, 0xa2, 0xa2, 0x9c,
   0x80, 0xbe, 0x82, 0x84, 0x88, 0x90, 0x90, 0x90,
   0x80, 0x9c, 0xa2, 0xa2, 0x9c, 0xa2, 0xa2, 0x9c,
   0x80, 0x9c, 0xa2, 0xa2, 0x9e, 0x82, 0x84, 0xb8,
   0x80, 0x80, 0x80, 0x88, 0x80, 0x88, 0x80, 0x80,
   0x80, 0x80, 0x80, 0x88, 0x80, 0x88, 0x88, 0x90,
   0x80, 0x84, 0x88, 0x90, 0xa0, 0x90, 0x88, 0x84,
   0x80, 0x80, 0x80, 0xbe, 0x80, 0xbe, 0x80, 0x80,
   0x80, 0x90, 0x88, 0x84, 0x82, 0x84, 0x88, 0x90,
   0x80, 0x9c, 0xa2, 0x84, 0x88, 0x88, 0x80, 0x88,
   0x00, 0x1c, 0x22, 0x2a, 0x2e, 0x2c, 0x20, 0x1e,
   0x00, 0x08, 0x14, 0x22, 0x22, 0x3e, 0x22, 0x22,
   0x00, 0x3c, 0x22, 0x22, 0x3c, 0x22, 0x22, 0x3c,
   0x00, 0x1c, 0x22, 0x20, 0x20, 0x20, 0x22, 0x1c,
   0x00, 0x3c, 0x22, 0x22, 0x22, 0x22, 0x22, 0x3c,
   0x00, 0x3e, 0x20, 0x20, 0x3c, 0x20, 0x20, 0x3e,
   0x00, 0x3e, 0x20, 0x20, 0x3c, 0x20, 0x20, 0x20,
   0x00, 0x1e, 0x20, 0x20, 0x20, 0x26, 0x22, 0x1e,
   0x00, 0x22, 0x22, 0x22, 0x3e, 0x22, 0x22, 0x22,
   0x00, 0x1c, 0x08, 0x08, 0x08, 0x08, 0x08, 0x1c,
   0x00, 0x02, 0x02, 0x02, 0x02, 0x02, 0x22, 0x1c,
   0x00, 0x22, 0x24, 0x28, 0x30, 0x28, 0x24, 0x22,
   0x00, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x3e,
   0x00, 0x22, 0x36, 0x2a, 0x2a, 0x22, 0x22, 0x22,
   0x00, 0x22, 0x22, 0x32, 0x2a, 0x26, 0x22, 0x22,
   0x00, 0x1c, 0x22, 0x22, 0x22, 0x22, 0x22, 0x1c,
   0x00, 0x3c, 0x22, 0x22, 0x3c, 0x20, 0x20, 0x20,
   0x00, 0x1c, 0x22, 0x22, 0x22, 0x2a, 0x24, 0x1a,
   0x00, 0x3c, 0x22, 0x22, 0x3c, 0x28, 0x24, 0x22,
   0x00, 0x1c, 0x22, 0x20, 0x1c, 0x02, 0x22, 0x1c,
   0x00, 0x3e, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08,
   0x00, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x1c,
   0x00, 0x22, 0x22, 0x22, 0x22, 0x22, 0x14, 0x08,
   0x00, 0x22, 0x22, 0x22, 0x2a, 0x2a, 0x36, 0x22,
   0x00, 0x22, 0x22, 0x14, 0x08, 0x14, 0x22, 0x22,
   0x00, 0x22, 0x22, 0x14, 0x08, 0x08, 0x08, 0x08,
   0x00, 0x3e, 0x02, 0x04, 0x08, 0x10, 0x20, 0x3e,
   0x00, 0x3e, 0x30, 0x30, 0x30, 0x30, 0x30, 0x3e,
   0x00, 0x00, 0x20, 0x10, 0x08, 0x04, 0x02, 0x00,
   0x00, 0x3e, 0x06, 0x06, 0x06, 0x06, 0x06, 0x3e,
   0x00, 0x00, 0x00, 0x08, 0x14, 0x22, 0x00, 0x00,
   0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3e,
   0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
   0x00, 0x08, 0x08, 0x08, 0x08, 0x08, 0x00, 0x08,
   0x00, 0x14, 0x14, 0x14, 0x00, 0x00, 0x00, 0x00,
   0x00, 0x14, 0x14, 0x3e, 0x14, 0x3e, 0x14, 0x14,
   0x00, 0x08, 0x1e, 0x28, 0x1c, 0x0a, 0x3c, 0x08,
   0x00, 0x30, 0x32, 0x04, 0x08, 0x10, 0x26, 0x06,
   0x00, 0x10, 0x28, 0x28, 0x10, 0x2a, 0x24, 0x1a,
   0x00, 0x08, 0x08, 0x08, 0x00, 0x00, 0x00, 0x00,
   0x00, 0x08, 0x10, 0x20, 0x20, 0x20, 0x10, 0x08,
   0x00, 0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08,
   0x00, 0x08, 0x2a, 0x1c, 0x08, 0x1c, 0x2a, 0x08,
   0x00, 0x00, 0x08, 0x08, 0x3e, 0x08, 0x08, 0x00,
   0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x08, 0x10,
   0x00, 0x00, 0x00, 0x00, 0x3e, 0x00, 0x00, 0x00,
   0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08,
   0x00, 0x00, 0x02, 0x04, 0x08, 0x10, 0x20, 0x00,
   0x00, 0x1c, 0x22, 0x26, 0x2a, 0x32, 0x22, 0x1c,
   0x00, 0x08, 0x18, 0x08, 0x08, 0x08, 0x08, 0x1c,
   0x00, 0x1c, 0x22, 0x02, 0x0c, 0x10, 0x20, 0x3e,
   0x00, 0x3e, 0x02, 0x04, 0x0c, 0x02, 0x22, 0x1c,
   0x00, 0x04, 0x0c, 0x14, 0x24, 0x3e, 0x04, 0x04,
   0x00, 0x3e, 0x20, 0x3c, 0x02, 0x02, 0x22, 0x1c,
   0x00, 0x0e, 0x10, 0x20, 0x3c, 0x22, 0x22, 0x1c,
   0x00, 0x3e, 0x02, 0x04, 0x08, 0x10, 0x10, 0x10,
   0x00, 0x1c, 0x22, 0x22, 0x1c, 0x22, 0x22, 0x1c,
   0x00, 0x1c, 0x22, 0x22, 0x1e, 0x02, 0x04, 0x38,
   0x00, 0x00, 0x00, 0x08, 0x00, 0x08, 0x00, 0x00,
   0x00, 0x00, 0x00, 0x08, 0x00, 0x08, 0x08, 0x10,
   0x00, 0x04, 0x08, 0x10, 0x20, 0x10, 0x08, 0x04,
   0x00, 0x00, 0x00, 0x3e, 0x00, 0x3e, 0x00, 0x00,
   0x00, 0x10, 0x08, 0x04, 0x02, 0x04, 0x08, 0x10,
   0x00, 0x1c, 0x22, 0x04, 0x08, 0x08, 0x00, 0x08,
   0x80, 0x9c, 0xa2, 0xaa, 0xae, 0xac, 0xa0, 0x9e,
   0x80, 0x88, 0x94, 0xa2, 0xa2, 0xbe, 0xa2, 0xa2,
   0x80, 0xbc, 0xa2, 0xa2, 0xbc, 0xa2, 0xa2, 0xbc,
   0x80, 0x9c, 0xa2, 0xa0, 0xa0, 0xa0, 0xa2, 0x9c,
   0x80, 0xbc, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0xbc,
   0x80, 0xbe, 0xa0, 0xa0, 0xbc, 0xa0, 0xa0, 0xbe,
   0x80, 0xbe, 0xa0, 0xa0, 0xbc, 0xa0, 0xa0, 0xa0,
   0x80, 0x9e, 0xa0, 0xa0, 0xa0, 0xa6, 0xa2, 0x9e,
   0x80, 0xa2, 0xa2, 0xa2, 0xbe, 0xa2, 0xa2, 0xa2,
   0x80, 0x9c, 0x88, 0x88, 0x88, 0x88, 0x88, 0x9c,
   0x80, 0x82, 0x82, 0x82, 0x82, 0x82, 0xa2, 0x9c,
   0x80, 0xa2, 0xa4, 0xa8, 0xb0, 0xa8, 0xa4, 0xa2,
   0x80, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xbe,
   0x80, 0xa2, 0xb6, 0xaa, 0xaa, 0xa2, 0xa2, 0xa2,
   0x80, 0xa2, 0xa2, 0xb2, 0xaa, 0xa6, 0xa2, 0xa2,
   0x80, 0x9c, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0x9c,
   0x80, 0xbc, 0xa2, 0xa2, 0xbc, 0xa0, 0xa0, 0xa0,
   0x80, 0x9c, 0xa2, 0xa2, 0xa2, 0xaa, 0xa4, 0x9a,
   0x80, 0xbc, 0xa2, 0xa2, 0xbc, 0xa8, 0xa4, 0xa2,
   0x80, 0x9c, 0xa2, 0xa0, 0x9c, 0x82, 0xa2, 0x9c,
   0x80, 0xbe, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88,
   0x80, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0x9c,
   0x80, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0x94, 0x88,
   0x80, 0xa2, 0xa2, 0xa2, 0xaa, 0xaa, 0xb6, 0xa2,
   0x80, 0xa2, 0xa2, 0x94, 0x88, 0x94, 0xa2, 0xa2,
   0x80, 0xa2, 0xa2, 0x94, 0x88, 0x88, 0x88, 0x88,
   0x80, 0xbe, 0x82, 0x84, 0x88, 0x90, 0xa0, 0xbe,
   0x80, 0xbe, 0xb0, 0xb0, 0xb0, 0xb0, 0xb0, 0xbe,
   0x80, 0x80, 0xa0, 0x90, 0x88, 0x84, 0x82, 0x80,
   0x80, 0xbe, 0x86, 0x86, 0x86, 0x86, 0x86, 0xbe,
   0x80, 0x80, 0x80, 0x88, 0x94, 0xa2, 0x80, 0x80,
   0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0xbe,
   0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
   0x80, 0x88, 0x88, 0x88, 0x88, 0x88, 0x80, 0x88,
   0x80, 0x94, 0x94, 0x94, 0x80, 0x80, 0x80, 0x80,
   0x80, 0x94, 0x94, 0xbe, 0x94, 0xbe, 0x94, 0x94,
   0x80, 0x88, 0x9e, 0xa8, 0x9c, 0x8a, 0xbc, 0x88,
   0x80, 0xb0, 0xb2, 0x84, 0x88, 0x90, 0xa6, 0x86,
   0x80, 0x90, 0xa8, 0xa8, 0x90, 0xaa, 0xa4, 0x9a,
   0x80, 0x88, 0x88, 0x88, 0x80, 0x80, 0x80, 0x80,
   0x80, 0x88, 0x90, 0xa0, 0xa0, 0xa0, 0x90, 0x88,
   0x80, 0x88, 0x84, 0x82, 0x82, 0x82, 0x84, 0x88,
   0x80, 0x88, 0xaa, 0x9c, 0x88, 0x9c, 0xaa, 0x88,
   0x80, 0x80, 0x88, 0x88, 0xbe, 0x88, 0x88, 0x80,
   0x80, 0x80, 0x80, 0x80, 0x80, 0x88, 0x88, 0x90,
   0x80, 0x80, 0x80, 0x80, 0xbe, 0x80, 0x80, 0x80,
   0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x88,
   0x80, 0x80, 0x82, 0x84, 0x88, 0x90, 0xa0, 0x80,
   0x80, 0x9c, 0xa2, 0xa6, 0xaa, 0xb2, 0xa2, 0x9c,
   0x80, 0x88, 0x98, 0x88, 0x88, 0x88, 0x88, 0x9c,
   0x80, 0x9c, 0xa2, 0x82, 0x8c, 0x90, 0xa0, 0xbe,
   0x80, 0xbe, 0x82, 0x84, 0x8c, 0x82, 0xa2, 0x9c,
   0x80, 0x84, 0x8c, 0x94, 0xa4, 0xbe, 0x84, 0x84,
   0x80, 0xbe, 0xa0, 0xbc, 0x82, 0x82, 0xa2, 0x9c,
   0x80, 0x8e, 0x90, 0xa0, 0xbc, 0xa2, 0xa2, 0x9c,
   0x80, 0xbe, 0x82, 0x84, 0x88, 0x90, 0x90, 0x90,
   0x80, 0x9c, 0xa2, 0xa2, 0x9c, 0xa2, 0xa2, 0x9c,
   0x80, 0x9c, 0xa2, 0xa2, 0x9e, 0x82, 0x84, 0xb8,
   0x80, 0x80, 0x80, 0x88, 0x80, 0x88, 0x80, 0x80,
   0x80, 0x80, 0x80, 0x88, 0x80, 0x88, 0x88, 0x90,
   0x80, 0x84, 0x88, 0x90, 0xa0, 0x90, 0x88, 0x84,
   0x80, 0x80, 0x80, 0xbe, 0x80, 0xbe, 0x80, 0x80,
   0x80, 0x90, 0x88, 0x84, 0x82, 0x84, 0x88, 0x90,
   0x80, 0x9c, 0xa2, 0x84, 0x88, 0x88, 0x80, 0x88
];

// public domain ROM (http://a2go.applearchives.com/roms/)
const APPLEIIGO_LZG = `TFpHAAAwAAAABYxwdy2NARUZHjRBUFBMRUlJR08gUk9NMS4wADQfNB80HzQfNB80HzQfNB80HDQGIADgGR97GR+uNB80Hxk/azQfNB8ZP2UZH4s0HzQfNB80HzQfNB80HzQfNB80HzQfNB80HTQPoCA0HCAgoBkOKAEQEAwFEw8GFCAODxQgARYBCQwBAgwFGRAoxs/SoM3P0sWgyc4eA83B1MnPzqDQzMXB08Wgw8zJw8ugHgigGQgo1MjFoMHQHhnJycfPoMzPNIHCxczP1x4cNAoZHvhMA+AgWPyiJ70A352ABMoQ9x4DMN+dAAUewx5OGQUDYB4DBh7DkB4ZBx4DTEDgNEEZP7s0HzQfNB80HzQfNB80HzQfNB80HzQfNB80HzQfNB80HzQfNB80HzQfNB80HjQYyc6w7snJkOrJzPDm0OjqNAtISikDCQSFKWgpGJACaX+FKAoKBSiFKGAZHnQApSUgwftlIBkdSzQVpSJIICT8pSiFKqUphSukIYhoaQHFI7ANHk6xKJEqiBD5MOGgACCe/LCGpCSpoJEoyMQhkPkZHsc0G6QksShIKT8JQJEoaGw4GRMbIAz9IKX7NKHJm/DzGRyNNAYgjv2lMyDt/aIBivDzyiA1/cmV0AKxKMngkAIp350AAsmN0LIgnPypjdBbpD2mPB4nIED5oACprUzt/RlfdjQfNB80HzQfNB80HzQfNB80HzQfNB80HjQFqQCFHKXmhRugAIQapRyRGiB+9MjQ9uYbpRspH9DuYIXihuCE4UgpwIUmSkoFJoUmaIUnCgoKJic0QmYmpScpHwXmhSeKwADwBaAjaQTI6Qew+4Tlqr259IUwmEql5IUcsBUcACM0BArJwBAGpRxJf4UcGf7aNB80HzQfNB80HzQfNBw0CkoIIEf4KKkPkAJp4IUusSZFMCUuUSaRJmAgAPjELLARyCAO+JD2aQFIHghoxS2Q9WCgL9ACoCeELaAnqQCFMCAo+IgQ9mAVBQR+JxUGBH4mCgoZgjRgpTAYaQMpD4UwCjQBBTCFMBln35AESjQBKQ8Za/CoSpAJarAQyaLwDCmHSqq9YvkgefjQBKCAqQCqvab5hS4pA4UvmCmPqpigA+CK8AtKkAhKSgkgiND6yIjQ8hmfOzQfNB80FNgghP4gL/sgk/4gif6tWMCtWsCtXcCtX8Ct/88sEMDYIDr/IGD7qQCFAKnGhQFsGR5vNB0VAxNs3dvHzxkKDa1wwKAA6uq9ZMAQBMjQ+IhgqQCFSK1WwK1UwK1RwKkA8AutUMCtU8AgNvipFIUiHhYgqSiFIakYhSOpF4UlTCL8IFj8oAm5CPuZDgSI0PdgrfMDSaWN9ANgyY3QGKwAwBATwJPQDywQwB5E+8CD8AMeBEz9+xUdB/gVEAf4yYfQEqlAIKj8oMCpDDTBrTDAiND1YKQkkSjmJKUkxSGwZmDJoLDvqBDsyY3wWsmKNGGI0MnGJBDopSGFJMYkpSLFJbALxiUVHAf4AEggJPwgnvygAGhpAMUjkPCwyqUihSWgAIQk8OSpAIUk5h4+HhC2xiUVHQf4FQYH+DhI6QHQ/Gg0gfZg5kLQAuZDpTzFPqU95T/mPB4GPRl99BUcB/jmTtAC5k8sAMAQ9ZEorQDALBDAYBUKB/j+YKUySKn/hTK9AAIg7f1oHoHJiPAdyZjwCuD4kAMgOv/o0BOp3B4VFQoH+P4VHgf4NBsASBmiWCDl/WgpDwmwybqQAmkGbDYAyaCQAiUyhDVIIHj7aKQ1GTEvQBkKBRkLGLE8kUIgtPyQ9xm+YTQBoD/QAqD/hDIZYlI+ojigG9AIHoI2oPClPikP8AYJwKAA8AKp/ZQAlQFg6upMFR8eQzQHqYdM7f2lSEilRaZGpEcZbhYZ34Q0GzQB9QP7A2L6Yvo=`;

///
/// Disk II
///

const NUM_DRIVES = 2;
const NUM_TRACKS = 35;
const TRACK_SIZE = 0x1880;
const SECTOR_SIZE = 383;

const DISKII_PROM = [
   0xA2, 0x20, 0xA0, 0x00, 0xA2, 0x03, 0x86, 0x3C, 0x8A, 0x0A, 0x24, 0x3C, 0xF0, 0x10, 0x05, 0x3C
   , 0x49, 0xFF, 0x29, 0x7E, 0xB0, 0x08, 0x4A, 0xD0, 0xFB, 0x98, 0x9D, 0x56, 0x03, 0xC8, 0xE8, 0x10
   , 0xE5, 0x20, 0x58, 0xFF, 0xBA, 0xBD, 0x00, 0x01, 0x0A, 0x0A, 0x0A, 0x0A, 0x85, 0x2B, 0xAA, 0xBD
   , 0x8E, 0xC0, 0xBD, 0x8C, 0xC0, 0xBD, 0x8A, 0xC0, 0xBD, 0x89, 0xC0, 0xA0, 0x50, 0xBD, 0x80, 0xC0
   , 0x98, 0x29, 0x03, 0x0A, 0x05, 0x2B, 0xAA, 0xBD, 0x81, 0xC0, 0xA9, 0x56,
      /*0x20,0xA8,0xFC,*/0xa9, 0x00, 0xea, 0x88
   , 0x10, 0xEB, 0x85, 0x26, 0x85, 0x3D, 0x85, 0x41, 0xA9, 0x08, 0x85, 0x27, 0x18, 0x08, 0xBD, 0x8C
   , 0xC0, 0x10, 0xFB, 0x49, 0xD5, 0xD0, 0xF7, 0xBD, 0x8C, 0xC0, 0x10, 0xFB, 0xC9, 0xAA, 0xD0, 0xF3
   , 0xEA, 0xBD, 0x8C, 0xC0, 0x10, 0xFB, 0xC9, 0x96, 0xF0, 0x09, 0x28, 0x90, 0xDF, 0x49, 0xAD, 0xF0
   , 0x25, 0xD0, 0xD9, 0xA0, 0x03, 0x85, 0x40, 0xBD, 0x8C, 0xC0, 0x10, 0xFB, 0x2A, 0x85, 0x3C, 0xBD
   , 0x8C, 0xC0, 0x10, 0xFB, 0x25, 0x3C, 0x88, 0xD0, 0xEC, 0x28, 0xC5, 0x3D, 0xD0, 0xBE, 0xA5, 0x40
   , 0xC5, 0x41, 0xD0, 0xB8, 0xB0, 0xB7, 0xA0, 0x56, 0x84, 0x3C, 0xBC, 0x8C, 0xC0, 0x10, 0xFB, 0x59
   , 0xD6, 0x02, 0xA4, 0x3C, 0x88, 0x99, 0x00, 0x03, 0xD0, 0xEE, 0x84, 0x3C, 0xBC, 0x8C, 0xC0, 0x10
   , 0xFB, 0x59, 0xD6, 0x02, 0xA4, 0x3C, 0x91, 0x26, 0xC8, 0xD0, 0xEF, 0xBC, 0x8C, 0xC0, 0x10, 0xFB
   , 0x59, 0xD6, 0x02, 0xD0, 0x87, 0xA0, 0x00, 0xA2, 0x56, 0xCA, 0x30, 0xFB, 0xB1, 0x26, 0x5E, 0x00
   , 0x03, 0x2A, 0x5E, 0x00, 0x03, 0x2A, 0x91, 0x26, 0xC8, 0xD0, 0xEE, 0xE6, 0x27, 0xE6, 0x3D, 0xA5
   , 0x3D, 0xCD, 0x00, 0x08, 0xA6, 0x2B, 0x90, 0xDB, 0x4C, 0x01, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00
];

class DiskIIState {
   data: Uint8Array[];
   track: number = 0;
   read_mode: boolean = true;
   write_protect: boolean = false;
   motor: boolean = false;
   track_index: number = 0;
}

class DiskII extends DiskIIState implements SlotDevice, SavesState<DiskIIState> {
   emu: AppleII;
   track_data: Uint8Array;

   constructor(emu: AppleII, image: Uint8Array) {
      super();
      this.emu = emu;
      this.data = new Array(NUM_TRACKS);
      for (var i = 0; i < NUM_TRACKS; i++) {
         var ofs = i * 16 * 256;
         this.data[i] = nibblizeTrack(254, i, image.slice(ofs, ofs + 16 * 256));
      }
   }

   saveState(): DiskIIState {
      var s = {
         data: new Array(NUM_TRACKS),
         track: this.track,
         read_mode: this.read_mode,
         write_protect: this.write_protect,
         motor: this.motor,
         track_index: this.track_index
      };
      for (var i = 0; i < NUM_TRACKS; i++)
         s.data[i] = this.data[i].slice(0);
      return s;
   }

   loadState(s: DiskIIState) {
      for (var i = 0; i < NUM_TRACKS; i++)
         this.data[i].set(s.data[i]);
      this.track = s.track;
      this.read_mode = s.read_mode;
      this.write_protect = s.write_protect;
      this.motor = s.motor;
      this.track_index = s.track_index;
      if ((this.track & 1) == 0)
         this.track_data = this.data[this.track >> 1];
      else
         this.track_data = null;
   }

   toLongString() {
      return "Track:  " + (this.track / 2) +
         "\nOffset: " + (this.track_index) +
         "\nMode:   " + (this.read_mode ? "READ" : "WRITE") +
         "\nMotor:  " + this.motor +
         "\nData:   " + (this.track_data ? hex(this.track_data[this.track_index]) : '-') +
         "\n";
   }

   read_latch(): number {
      this.track_index = (this.track_index + 1) % TRACK_SIZE;
      if (this.track_data) {
         return (this.track_data[this.track_index] & 0xff);
      } else
         return this.emu.floatbus() | 0x80;
   }

   write_latch(value: number) {
      this.track_index = (this.track_index + 1) % TRACK_SIZE;
      if (this.track_data != null)
         this.track_data[this.track_index] = value;
   }

   readROM(address) { return DISKII_PROM[address]; }
   readConst(address) { return DISKII_PROM[address]; }
   read(address) { return this.doIO(address, 0); }
   write(address, value) { this.doIO(address, value); }

   doIO(address, value): number {
      switch (address & 0x0f) {
         /*
          * Turn motor phases 0 to 3 on.  Turning on the previous phase + 1
          * increments the track position, turning on the previous phase - 1
          * decrements the track position.  In this scheme phase 0 and 3 are
          * considered to be adjacent.  The previous phase number can be
          * computed as the track number % 4.
          */
         case 0x1:
         case 0x3:
         case 0x5:
         case 0x7:
            var phase, lastphase, new_track;
            new_track = this.track;
            phase = (address >> 1) & 3;

            // if new phase is even and current phase is odd
            if (phase == ((new_track - 1) & 3)) {
               if (new_track > 0)
                  new_track--;
            } else
               if (phase == ((new_track + 1) & 3)) {
                  if (new_track < NUM_TRACKS * 2 - 1)
                     new_track++;
               }
            if ((new_track & 1) == 0) {
               this.track_data = this.data[new_track >> 1];
               console.log('track', new_track / 2);
            } else
               this.track_data = null;
            this.track = new_track;
            break;
         /*
          * Turn drive motor off.
          */
         case 0x8:
            this.motor = false;
            break;
         /*
          * Turn drive motor on.
          */
         case 0x9:
            this.motor = true;
            break;
         /*
          * Select drive 1.
          */
         case 0xa:
            //drive = 0;
            break;
         /*
          * Select drive 2.
          */
         case 0xb:
            //drive = 1;
            break;
         /*
          * Select write mode.
          */
         case 0xf:
            this.read_mode = false;
         /*
          * Read a disk byte if read mode is active.
          */
         case 0xC:
            if (this.read_mode)
               return this.read_latch();
            break;
         /*
          * Select read mode and read the write protect status.
          */
         case 0xE:
            this.read_mode = true;
         /*
          * Write a disk byte if write mode is active and the disk is not
          * write protected.
          */
         case 0xD:
            if (value >= 0 && !this.read_mode && !this.write_protect)
               this.write_latch(value);
            /*
             * Read the write protect status only.
             */
            return this.write_protect ? 0x80 : 0x00;
      }
      return this.emu.floatbus();
   }

}

/* --------------- TRACK CONVERSION ROUTINES ---------------------- */

/*
 * Normal byte (lower six bits only) -> disk byte translation table.
 */
const byte_translation = [
   0x96, 0x97, 0x9a, 0x9b, 0x9d, 0x9e, 0x9f, 0xa6,
   0xa7, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb2, 0xb3,
   0xb4, 0xb5, 0xb6, 0xb7, 0xb9, 0xba, 0xbb, 0xbc,
   0xbd, 0xbe, 0xbf, 0xcb, 0xcd, 0xce, 0xcf, 0xd3,
   0xd6, 0xd7, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde,
   0xdf, 0xe5, 0xe6, 0xe7, 0xe9, 0xea, 0xeb, 0xec,
   0xed, 0xee, 0xef, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6,
   0xf7, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff
];

/*
 * Sector skewing table.
 */

const skewing_table = [
   0, 7, 14, 6, 13, 5, 12, 4, 11, 3, 10, 2, 9, 1, 8, 15
];

/*
 * Encode a 256-byte sector as SECTOR_SIZE disk bytes as follows:
 *
 *   14 sync bytes
 *   3 address header bytes
 *   8 address block bytes
 *   3 address trailer bytes
 *   6 sync bytes
 *   3 data header bytes
 * 343 data block bytes
 *   3 data trailer bytes
 */
function nibblizeSector(vol, trk, sector, inn, in_ofs, out, i) {
   var loop, checksum, prev_value, value;
   var sector_buffer = new Uint8Array(258);
   value = 0;

   /*
    * Step 1: write 6 sync bytes (0xff's).  Normally these would be
    * written as 10-bit bytes with two extra zero bits, but for the
    * purpose of emulation normal 8-bit bytes will do, since the
    * emulated drive will always be in sync.
    */
   for (loop = 0; loop < 14; loop++)
      out[i++] = 0xff;

   /*
    * Step 2: write the 3-byte address header (0xd5 0xaa 0x96).
    */
   out[i++] = 0xd5;
   out[i++] = 0xaa;
   out[i++] = 0x96;

   /*
    * Step 3: write the address block.  Use 4-and-4 encoding to convert
    * the volume, track and sector and checksum into 2 disk bytes each.
    * The checksum is a simple exclusive OR of the first three values.
    */
   out[i++] = ((vol >> 1) | 0xaa);
   out[i++] = (vol | 0xaa);
   checksum = vol;
   out[i++] = ((trk >> 1) | 0xaa);
   out[i++] = (trk | 0xaa);
   checksum ^= trk;
   out[i++] = ((sector >> 1) | 0xaa);
   out[i++] = (sector | 0xaa);
   checksum ^= sector;
   out[i++] = ((checksum >> 1) | 0xaa);
   out[i++] = (checksum | 0xaa);

   /*
    * Step 4: write the 3-byte address trailer (0xde 0xaa 0xeb).
    */
   out[i++] = (0xde);
   out[i++] = (0xaa);
   out[i++] = (0xeb);

   /*
    * Step 5: write another 6 sync bytes.
    */
   for (loop = 0; loop < 6; loop++)
      out[i++] = (0xff);

   /*
    * Step 6: write the 3-byte data header.
    */
   out[i++] = (0xd5);
   out[i++] = (0xaa);
   out[i++] = (0xad);

   /*
    * Step 7: read the next 256-byte sector from the old disk image file,
    * and add two zero bytes to bring the number of bytes up to a multiple
    * of 3.
    */
   for (loop = 0; loop < 256; loop++)
      sector_buffer[loop] = inn[loop + in_ofs] & 0xff;
   sector_buffer[256] = 0;
   sector_buffer[257] = 0;

   /*
    * Step 8: write the first 86 disk bytes of the data block, which
    * encodes the bottom two bits of each sector byte into six-bit
    * values as follows:
    *
    * disk byte n, bit 0 = sector byte n,       bit 1
    * disk byte n, bit 1 = sector byte n,       bit 0
    * disk byte n, bit 2 = sector byte n +  86, bit 1
    * disk byte n, bit 3 = sector byte n +  86, bit 0
    * disk byte n, bit 4 = sector byte n + 172, bit 1
    * disk byte n, bit 5 = sector byte n + 172, bit 0
    *
    * The scheme allows each pair of bits to be shifted to the right out
    * of the disk byte, then shifted to the left into the sector byte.
    *
    * Before the 6-bit value is translated to a disk byte, it is exclusive
    * ORed with the previous 6-bit value, hence the values written are
    * really a running checksum.
    */
   prev_value = 0;
   for (loop = 0; loop < 86; loop++) {
      value = (sector_buffer[loop] & 0x01) << 1;
      value |= (sector_buffer[loop] & 0x02) >> 1;
      value |= (sector_buffer[loop + 86] & 0x01) << 3;
      value |= (sector_buffer[loop + 86] & 0x02) << 1;
      value |= (sector_buffer[loop + 172] & 0x01) << 5;
      value |= (sector_buffer[loop + 172] & 0x02) << 3;
      out[i++] = (byte_translation[value ^ prev_value]);
      prev_value = value;
   }

   /*
    * Step 9: write the last 256 disk bytes of the data block, which
    * encodes the top six bits of each sector byte.  Again, each value
    * is exclusive ORed with the previous value to create a running
    * checksum (the first value is exclusive ORed with the last value of
    * the previous step).
    */

   for (loop = 0; loop < 256; loop++) {
      value = (sector_buffer[loop] >> 2);
      out[i++] = (byte_translation[value ^ prev_value]);
      prev_value = value;
   }

   /*
    * Step 10: write the last value as the checksum.
    */
   out[i++] = (byte_translation[value]);

   /*
    * Step 11: write the 3-byte data trailer.
    */
   out[i++] = (0xde);
   out[i++] = (0xaa);
   out[i++] = (0xeb);

}

function nibblizeTrack(vol, trk, inn) {
   var out = new Uint8Array(TRACK_SIZE);
   var out_pos = 0;
   for (var sector = 0; sector < 16; sector++) {
      nibblizeSector(vol, trk, sector,
         inn, skewing_table[sector] << 8,
         out, out_pos);
      out_pos += SECTOR_SIZE;
   }
   while (out_pos < TRACK_SIZE)
      out[out_pos++] = (0xff);
   return out;
}

// Apple II Mockingboard / Phasor "Mockingboard mode" sound card.
//
// A Mockingboard C has two sub-units, each a 6522 VIA driving one AY-3-8913
// PSG. The card occupies a slot's 256-byte ROM/I/O window (conventionally slot
// 4, so $C400): the first sub-unit is at $Cn00-$Cn7F, the second at
// $Cn80-$CnFF. The AY is not directly bus-visible -- it hangs off the 6522
// ports:
//
//   Port A = AY data/address bus
//   Port B bit 0 = BC1, bit 1 = BDIR, bit 2 = /RESET (active low)
//
//   BC1/BDIR:  0/0 inactive   1/0 read   0/1 write   1/1 latch address
//
// The AY only accepts a bus function when it is currently inactive, so
// software brackets each latch/write/read with an inactive write.
// See AppleWin's Mockingboard.cpp for reference.

const AY_INACTIVE = 0;
const AY_READ = 1;
const AY_WRITE = 2;
const AY_LATCH = 3;

class MockingboardUnit implements VIA6522Host {
  via = new VIA6522(this);
  ay: AY38910_Audio;
  ayFunc = AY_INACTIVE;
  addressLatched = false;

  constructor(master: MasterAudio, clock: number) {
    this.ay = new AY38910_Audio(master);
    // AY is clocked from the Apple II CPU clock. TSS divides its clock by 32
    // where a real AY divides by 16, so it wants twice the chip's clock.
    this.ay.psg.setClock(clock * 2);
  }

  reset() {
    this.via.reset();
    this.ay.reset();
    this.ayFunc = AY_INACTIVE;
    this.addressLatched = false;
  }

  step() {
    this.via.step0();
    this.via.step1();
  }

  irq(): boolean {
    return (this.via.ifr & 0x80) != 0;
  }

  read(offset: number, peek = false): number {
    return this.via.read(offset & 0xf, peek);
  }

  write(offset: number, val: number): void {
    this.via.write(offset & 0xf, val);
  }

  saveState() {
    return {
      via: this.via.saveState(),
      ayFunc: this.ayFunc,
      addressLatched: this.addressLatched,
      ayRegs: this.ay.psg.register.slice(0),
    };
  }

  loadState(s) {
    this.via.loadState(s.via);
    this.ayFunc = s.ayFunc;
    this.addressLatched = s.addressLatched;
    this.ay.psg.register.set(s.ayRegs);
  }

  // --- VIA6522Host ---

  readPortB(): number {
    return 0;
  }

  readPortA(): number | undefined {
    if (this.ayFunc == AY_READ && this.addressLatched) {
      return this.ay.readData();
    }
    return undefined;
  }

  writePortB(value: number): void {
    if ((value & 0x04) == 0) {
      /* /RESET asserted */
      this.ay.reset();
      this.ayFunc = AY_INACTIVE;
      this.addressLatched = false;
      return;
    }
    const func = value & 0x03;
    if (this.ayFunc == AY_INACTIVE) {
      switch (func) {
        case AY_WRITE:
          if (this.addressLatched)
            this.ay.setData(this.via.ora);
          break;
        case AY_LATCH:
          if (this.via.ora <= 0x0f) {
            this.ay.selectRegister(this.via.ora);
            this.addressLatched = true;
          }
          break;
      }
    }
    this.ayFunc = func;
  }

  writePortA(value: number): void {
  }
}

export class Mockingboard {
  units: MockingboardUnit[] = [];
  master = new MasterAudio();

  constructor(clock: number) {
    for (var i = 0; i < 2; i++) {
      var unit = new MockingboardUnit(this.master, clock);
      unit.reset();
      this.units.push(unit);
    }
  }

  private unit(offset: number): MockingboardUnit {
    return this.units[(offset >> 7) & 1];
  }

  startAudio() { this.master.start(); }
  stopAudio() { this.master.stop(); }

  reset() {
    for (var unit of this.units)
      unit.reset();
  }

  step() {
    for (var unit of this.units)
      unit.step();
  }

  irq(): boolean {
    return this.units.some((unit) => unit.irq());
  }

  // --- slot device (Bus + SlotDevice shape) ---

  readROM(offset: number): number {
    return this.unit(offset).read(offset);
  }
  readConst(offset: number): number {
    return this.unit(offset).read(offset, true);
  }
  read(offset: number): number {
    return this.unit(offset).read(offset);
  }
  write(offset: number, value: number): void {
    this.unit(offset).write(offset, value);
  }
  writeROM(offset: number, value: number): void {
    this.unit(offset).write(offset, value);
  }

  saveState() {
    return this.units.map((unit) => unit.saveState());
  }
  loadState(s) {
    for (var i = 0; i < this.units.length; i++)
      if (s && s[i]) this.units[i].loadState(s[i]);
  }
}
