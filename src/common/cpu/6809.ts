"use strict";
/*
The MIT License (MIT)
Copyright (c) 2014 Martin Maly, http://retrocip.cz, http://www.uelectronics.info,
twitter: @uelectronics

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

export function CPU6809() {

var ticks;
var rA,rB,rX,rY,rU,rS,PC,CC,DP,
F_CARRY     =1,
F_OVERFLOW  =2,
F_ZERO      =4,
F_NEGATIVE  =8,
F_IRQMASK   =16,
F_HALFCARRY =32,
F_FIRQMASK  =64,
F_ENTIRE    =128,

vecRESET = 0xFFFE,
vecNMI = 0xFFFC,
vecSWI = 0xFFFA,
vecIRQ = 0xFFF8,
vecFIRQ = 0xFFF6,
vecSWI2 = 0xFFF4,
vecSWI3 = 0xFFF2,

T=0;

var IRQs;

var byteTo, byteAt;

var cycles = [
      6,0,0,6,6,0,6,6,6,6,6,0,6,6,3,6,          /* 00-0F */
      0,0,2,4,0,0,5,9,0,2,3,0,3,2,8,6,          /* 10-1F */
      3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,          /* 20-2F */
      4,4,4,4,5,5,5,5,0,5,3,6,9,11,0,19,        /* 30-3F */
      2,0,0,2,2,0,2,2,2,2,2,0,2,2,0,2,          /* 40-4F */
      2,0,0,2,2,0,2,2,2,2,2,0,2,2,0,2,          /* 50-5F */
      6,0,0,6,6,0,6,6,6,6,6,0,6,6,3,6,          /* 60-6F */
      7,0,0,7,7,0,7,7,7,7,7,0,7,7,4,7,          /* 70-7F */
      2,2,2,4,2,2,2,0,2,2,2,2,4,7,3,0,          /* 80-8F */
      4,4,4,6,4,4,4,4,4,4,4,4,6,7,5,5,          /* 90-9F */
      4,4,4,6,4,4,4,4,4,4,4,4,6,7,5,5,          /* A0-AF */
      5,5,5,7,5,5,5,5,5,5,5,5,7,8,6,6,          /* B0-BF */
      2,2,2,4,2,2,2,0,2,2,2,2,3,0,3,0,          /* C0-CF */
      4,4,4,6,4,4,4,4,4,4,4,4,5,5,5,5,          /* D0-DF */
      4,4,4,6,4,4,4,4,4,4,4,4,5,5,5,5,          /* E0-EF */
      5,5,5,7,5,5,5,5,5,5,5,5,6,6,6,6];         /* F0-FF */

/* Instruction timing for the two-byte opcodes */
var cycles2 = [
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,          /* 00-0F */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,          /* 10-1F */
      0,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,          /* 20-2F */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,20,         /* 30-3F */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,          /* 40-4F */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,          /* 50-5F */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,          /* 60-6F */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,          /* 70-7F */
      0,0,0,5,0,0,0,0,0,0,0,0,5,0,4,0,          /* 80-8F */
      0,0,0,7,0,0,0,0,0,0,0,0,7,0,6,6,          /* 90-9F */
      0,0,0,7,0,0,0,0,0,0,0,0,7,0,6,6,          /* A0-AF */
      0,0,0,8,0,0,0,0,0,0,0,0,8,0,7,7,          /* B0-BF */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,0,          /* C0-CF */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,6,          /* D0-DF */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,6,          /* E0-EF */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,7];         /* F0-FF */

/* Negative and zero flags for quicker flag settings */
var flagsNZ = [
      4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,          /* 00-0F */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,          /* 10-1F */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,          /* 20-2F */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,          /* 30-3F */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,          /* 40-4F */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,          /* 50-5F */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,          /* 60-6F */
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,          /* 70-7F */
      8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,          /* 80-8F */
      8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,          /* 90-9F */
      8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,          /* A0-AF */
      8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,          /* B0-BF */
      8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,          /* C0-CF */
      8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,          /* D0-DF */
      8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,          /* E0-EF */
      8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8];         /* F0-FF */

var setV8 = function(a,b,r) {CC |= (((a^b^r^(r>>1))&0x80)>>6);};
var setV16 = function(a,b,r) {CC |= (((a^b^r^(r>>1))&0x8000)>>14);};
var getD = function() {return (rA<<8)+rB;};
var setD = function(v) {rA = (v>>8)& 0xff;rB=v&0xff;};
var PUSHB = function(b) {
    byteTo(--rS, b & 0xff);
};
var PUSHW = function(b) {
    byteTo(--rS, b & 0xff);
    byteTo(--rS, (b>>8) & 0xff);
};

var PUSHBU = function(b) {
    byteTo(--rU, b & 0xff);
};
var PUSHWU = function(b) {
    byteTo(--rU, b & 0xff);
    byteTo(--rU, (b>>8) & 0xff);
};
var PULLB = function() {
    return byteAt(rS++);
};
var PULLW = function() {
    return byteAt(rS++) * 256 + byteAt(rS++);
};

var PULLBU = function() {
    return byteAt(rU++);
};
var PULLWU = function() {
    return byteAt(rU++) * 256 + byteAt(rU++);
};

var PSHS = function(ucTemp)  {
      var i = 0;
         if (ucTemp & 0x80) {PUSHW(PC);i += 2;}
         if (ucTemp & 0x40) {PUSHW(rU);i += 2;}
         if (ucTemp & 0x20){PUSHW(rY);i += 2;}
         if (ucTemp & 0x10){PUSHW(rX);i += 2;}
         if (ucTemp & 0x8){PUSHB(DP); i++;}
         if (ucTemp & 0x4){PUSHB(rB); i++;}
         if (ucTemp & 0x2){PUSHB(rA); i++;}
         if (ucTemp & 0x1){PUSHB(CC); i++;}
         T+=i; //timing
};
var PSHU = function(ucTemp)  {
      var i = 0;
         if (ucTemp & 0x80) {PUSHWU(PC);i += 2;}
         if (ucTemp & 0x40) {PUSHWU(rS);i += 2;}
         if (ucTemp & 0x20){PUSHWU(rY);i += 2;}
         if (ucTemp & 0x10){PUSHWU(rX);i += 2;}
         if (ucTemp & 0x8){PUSHBU(DP); i++;}
         if (ucTemp & 0x4){PUSHBU(rB); i++;}
         if (ucTemp & 0x2){PUSHBU(rA); i++;}
         if (ucTemp & 0x1){PUSHBU(CC); i++;}
         T+=i; //timing
};
var PULS = function(ucTemp)  {
      var i = 0;
      if (ucTemp & 0x1){CC = PULLB(); i++;}
      if (ucTemp & 0x2){rA = PULLB(); i++;}
      if (ucTemp & 0x4){rB = PULLB(); i++;}
      if (ucTemp & 0x8){DP = PULLB(); i++;}
      if (ucTemp & 0x10){rX = PULLW();i += 2;}
      if (ucTemp & 0x20){rY = PULLW();i += 2;}
      if (ucTemp & 0x40) {rU = PULLW();i += 2;}
      if (ucTemp & 0x80) {PC = PULLW();i += 2;}
      T+=i; //timing
};
var PULU = function(ucTemp)  {
      var i = 0;
      if (ucTemp & 0x1){CC = PULLBU(); i++;}
      if (ucTemp & 0x2){rA = PULLBU(); i++;}
      if (ucTemp & 0x4){rB = PULLBU(); i++;}
      if (ucTemp & 0x8){DP = PULLBU(); i++;}
      if (ucTemp & 0x10){rX = PULLWU();i += 2;}
      if (ucTemp & 0x20){rY = PULLWU();i += 2;}
      if (ucTemp & 0x40) {rS = PULLWU();i += 2;}
      if (ucTemp & 0x80) {PC = PULLWU();i += 2;}
      T+=i; //timing
};


var getPBR = function(ucPostByte) {
    switch(ucPostByte & 0xf) {
       case 0x00: /* D */
            return getD();
       case 0x1: /* X */
          return rX;
       case 0x2: /* Y */
          return rY;
       case 0x3: /* U */
          return rU;
       case 0x4: /* S */
          return rS;
       case 0x5: /* PC */
          return PC;
       case 0x8: /* A */
          return rA;
       case 0x9: /* B */
          return rB;
       case 0xA: /* CC */
          return CC;
       case 0xB: /* DP */
          return DP;
       default: /* illegal */
          return null;
       }
};
var setPBR = function(ucPostByte, v) {
    switch(ucPostByte & 0xf) /* Get destination register */
       {
       case 0x00: /* D */
            setD(v);return;
       case 0x1: /* X */
          rX = v; return;
       case 0x2: /* Y */
          rY = v; return;
       case 0x3: /* U */
          rU = v; return;
       case 0x4: /* S */
          rS = v; return;
       case 0x5: /* PC */
          PC = v; return;
       case 0x8: /* A */
          rA = v; return;
       case 0x9: /* B */
          rB = v; return;
       case 0xA: /* CC */
          CC = v; return;
       case 0xB: /* DP */
          DP = v; return;
       default: /* illegal */
          return;
       }
};

var TFREXG = function(ucPostByte, bExchange)
{

   var ucTemp = ucPostByte & 0x88;
   if (ucTemp == 0x80 || ucTemp == 0x08)
      ucTemp = 0; /* PROBLEM! */

    if (bExchange)
          {
          ucTemp = getPBR(ucPostByte>>4);
          setPBR(ucPostByte>>4, getPBR(ucPostByte));
          setPBR(ucPostByte, ucTemp);
          }
       else /* Transfer */ {
          setPBR(ucPostByte, getPBR(ucPostByte>>4));
        }
} ;

var signed = function(x) {
    return (x>127)?(x-256):x;
};
var signed16 = function(x) {
    return (x>32767)?(x-65536):x;
};

var fetch = function() {
    var v = byteAt(PC++);
    PC &= 0xffff;
    return v;
};
var fetch16 = function() {
    var v1 = byteAt(PC++);
    PC &= 0xffff;
    var v2 = byteAt(PC++);
    PC &= 0xffff;
    return v1*256+v2;
};

var ReadWord = function(addr) {
    var v1 = byteAt(addr++);
    addr &= 0xffff;
    var v2 = byteAt(addr++);
    addr &= 0xffff;
    return v1*256+v2;
};
var WriteWord = function(addr,v) {
    byteTo(addr++,(v>>8)&0xff);
    addr &= 0xffff;
    byteTo(addr,v&0xff);
};

var PostByte = function() {
    var pb = fetch();
    var preg;
    switch (pb & 0x60) {
        case 0:
            preg = rX; break;
        case 0x20:
            preg = rY; break;
        case 0x40:
            preg = rU; break;
        case 0x60:
            preg = rS; break;
    }

    var xchg = null;
    var addr = null;
    var sTemp;

    if (pb & 0x80) /* Complex stuff */
       {
       switch (pb & 0x0f)
          {
          case 0: /* EA = ,reg+ */
             addr = preg;
             xchg = preg + 1;
             T += 2;
             break;
          case 1: /* EA = ,reg++ */
             addr = preg;
             xchg = preg + 2;
             T += 3;
             break;
          case 2: /* EA = ,-reg */
             xchg = preg - 1;
             addr = xchg;
             T += 2;
             break;
          case 3: /* EA = ,--reg */
             xchg = preg - 2;
             addr = xchg;
             T += 3;
             break;
          case 4: /* EA = ,reg */
             addr = preg;
             break;
          case 5: /* EA = ,reg + B */
             //usAddr = *pReg + (signed short)(signed char)regs->ucRegB;
             addr = preg + signed(rB);
             T += 1;
             break;
          case 6: /* EA = ,reg + A */
              addr = preg + signed(rA);
              T += 1;
             break;
          case 7: /* illegal */
             addr = 0;
             break;
          case 8: /* EA = ,reg + 8-bit offset */
             addr = preg + signed(fetch());
             T += 1;
             break;
          case 9: /* EA = ,reg + 16-bit offset */
             addr = preg + signed16(fetch16());
             T += 4;
             break;
          case 0xA: /* illegal */
             addr = 0;
             break;
          case 0xB: /* EA = ,reg + D */
             T += 4;
             addr = preg + getD();
             break;
          case 0xC: /* EA = PC + 8-bit offset */
             sTemp = signed(fetch());
             addr = PC + sTemp;
             T += 1;
             break;
          case 0xD: /* EA = PC + 16-bit offset */
             sTemp =  signed16(fetch16());
             addr = PC + sTemp;
             T += 5;
             break;
          case 0xe: /* Illegal */
             addr = 0;
             break;
          case 0xF: /* EA = [,address] */
             T += 2; // +3 for indirect below makes 5 total, per the manual
             addr = fetch16();
             break;
          } /* switch */

       addr &= 0xffff;

       if (pb & 0x10) /* Indirect addressing */
          {
          addr = byteAt(addr)*256+byteAt((addr+1) & 0xffff);
          T += 3;
          }
       }
    else /* Just a 5 bit signed offset + register */
       {
       var sByte = pb & 0x1f;
       if (sByte > 15) /* Two's complement 5-bit value */
          sByte -= 32;
       addr = preg + sByte;
       T += 1;
       }

    if (xchg!==null) {
        switch (pb & 0x60) {
            case 0:
                rX = xchg; break;
            case 0x20:
                rY = xchg; break;
            case 0x40:
                rU = xchg; break;
            case 0x60:
                rS = xchg; break;
        }

    }

    return addr & 0xffff; /* Return the effective address */
};

var flagsNZ16 = function(word) {
    CC &= ~(F_ZERO | F_NEGATIVE);
    if (word===0) CC |= F_ZERO;
    if (word & 0x8000) CC |= F_NEGATIVE;
};

// ============= Operations

var oINC = function(b) {
   b++;
   b &= 0xff;
   CC &= ~(F_ZERO | F_OVERFLOW | F_NEGATIVE);
   CC |= flagsNZ[b];
   if (b == 0x80) CC |= F_OVERFLOW; // only 0x7f -> 0x80 overflows
   return b;
};
var oDEC = function(b) {
   b--;
   b &= 0xff;
   CC &= ~(F_ZERO | F_OVERFLOW | F_NEGATIVE);
   CC |= flagsNZ[b];
   if (b === 0x7f) CC |= F_OVERFLOW; // only 0x80 -> 0x7f overflows
   return b;
};
var oSUB = function(b,v) {
   var temp = b-v;
   //temp &= 0xff;
   CC &= ~(F_CARRY | F_ZERO | F_OVERFLOW | F_NEGATIVE);
   CC |= flagsNZ[temp & 0xff];
   if (temp&0x100) CC|=F_CARRY;
   setV8(b,v,temp);
   return temp&0xff;
};
var oSUB16 = function(b,v) {
   var temp = b-v;
   //temp &= 0xff;
   CC &= ~(F_CARRY | F_ZERO | F_OVERFLOW | F_NEGATIVE);
   if ((temp&0xffff)===0) CC|=F_ZERO;
   if (temp&0x8000) CC|=F_NEGATIVE;
   if (temp&0x10000) CC|=F_CARRY;
   setV16(b,v,temp);
   return temp&0xffff;
};
var oADD = function(b,v) {
   var temp = b+v;
   //temp &= 0xff;
   CC &= ~(F_HALFCARRY | F_CARRY | F_ZERO | F_OVERFLOW | F_NEGATIVE);
   CC |= flagsNZ[temp & 0xff];
   if (temp&0x100) CC|=F_CARRY;
   setV8(b,v,temp);
   if ((temp ^ b ^ v)&0x10) CC |= F_HALFCARRY;
   return temp&0xff;
};
var oADD16 = function(b,v) {
   var temp = b+v;
   //temp &= 0xff;
   CC &= ~(F_CARRY | F_ZERO | F_OVERFLOW | F_NEGATIVE);
   if ((temp&0xffff)===0) CC|=F_ZERO;
   if (temp&0x8000) CC|=F_NEGATIVE;
   if (temp&0x10000) CC|=F_CARRY;
   setV16(b,v,temp);
   return temp&0xffff;
};
var oADC = function(b,v) {
   var temp = b+v+(CC & F_CARRY);
   //temp &= 0xff;
   CC &= ~(F_HALFCARRY | F_CARRY | F_ZERO | F_OVERFLOW | F_NEGATIVE);
   CC |= flagsNZ[temp & 0xff];
   if (temp&0x100) CC|=F_CARRY;
   setV8(b,v,temp);
   if ((temp ^ b ^ v)&0x10) CC |= F_HALFCARRY;
   return temp&0xff;
};
var oSBC = function(b,v) {
   var temp = b-v-(CC & F_CARRY);
   //temp &= 0xff;
   CC &= ~(F_CARRY | F_ZERO | F_OVERFLOW | F_NEGATIVE);
   CC |= flagsNZ[temp & 0xff];
   if (temp&0x100) CC|=F_CARRY;
   setV8(b,v,temp);
   return temp&0xff;
};
var oCMP = function(b,v) {
   var temp = b-v;
   //temp &= 0xff;
   CC &= ~(F_CARRY | F_ZERO | F_OVERFLOW | F_NEGATIVE);
   CC |= flagsNZ[temp & 0xff];
   if (temp&0x100) CC|=F_CARRY;
   setV8(b,v,temp);
   return;
};
var oCMP16 = function(b,v) {
   var temp = b-v;
   //temp &= 0xff;
   CC &= ~(F_CARRY | F_ZERO | F_OVERFLOW | F_NEGATIVE);
   if ((temp&0xffff)===0) CC|=F_ZERO;
   if (temp&0x8000) CC|=F_NEGATIVE;
   if (temp&0x10000) CC|=F_CARRY;
   setV16(b,v,temp);
   return;
};

var oNEG = function(b) {
    CC &= ~(F_CARRY | F_ZERO | F_OVERFLOW | F_NEGATIVE);
   if (b == 0x80)
      CC |= F_OVERFLOW;
   b = (((~b)&0xff) + 1) & 0xff; // mask: NEG 0 gives 0x100 before masking
   CC |= flagsNZ[b];
   if (b !== 0) CC |= F_CARRY; // C = borrow, set for any nonzero operand
   return b;
};

var oLSR = function(b) {
    CC &= ~(F_ZERO | F_CARRY | F_NEGATIVE);
    if (b & 0x01) CC |= F_CARRY;
    b >>= 1;
    if (b === 0) CC |= F_ZERO;
    return b & 0xff;
};
var oASR = function(b) {
    CC &= ~(F_ZERO | F_CARRY | F_NEGATIVE);
    if (b & 0x01) CC |= F_CARRY;
    b = (b & 0x80) | (b>>1);
    CC |= flagsNZ[b];
    return b;
};
var oASL = function(b) {
    var temp = b;
    CC &= ~(F_ZERO | F_CARRY | F_NEGATIVE | F_OVERFLOW);
    if (b & 0x80) CC |= F_CARRY;
    b = (b << 1) & 0xff; // mask so flagsNZ lookup sees N and Z
    CC |= flagsNZ[b];
    if ((b ^ temp) & 0x80) CC|=F_OVERFLOW;
    return b;
};
var oROL = function(b) {
    var temp = b;
    var oldc = CC&F_CARRY;
    CC &= ~(F_ZERO | F_CARRY | F_NEGATIVE | F_OVERFLOW);
    if (b & 0x80) CC |= F_CARRY;
    b = ((b << 1) | (oldc ? 1 : 0)) & 0xff; // mask so flagsNZ lookup sees N and Z
    CC |= flagsNZ[b];
    if ((b ^ temp) & 0x80) CC|=F_OVERFLOW;
    return b;
};
var oROR = function(b) {
    var oldc = CC&F_CARRY;
    CC &= ~(F_ZERO | F_CARRY | F_NEGATIVE);
    if (b & 0x01) CC |= F_CARRY;
    b = b>>1 | oldc<<7;
    CC |= flagsNZ[b];
//    if ((b ^ temp) & 0x80) CC|=F_OVERFLOW;
    return b;
};

var oEOR = function(b,v) {
    CC &= ~(F_ZERO | F_NEGATIVE | F_OVERFLOW);
    b ^= v;
    CC |= flagsNZ[b];
    return b;
};
var oOR = function(b,v) {
    CC &= ~(F_ZERO | F_NEGATIVE | F_OVERFLOW);
    b |= v;
    CC |= flagsNZ[b];
    return b;
};
var oAND = function(b,v) {
    CC &= ~(F_ZERO | F_NEGATIVE | F_OVERFLOW);
    b &= v;
    CC |= flagsNZ[b];
    return b;
};
var oCOM = function(b) {
    CC &= ~(F_ZERO | F_NEGATIVE | F_OVERFLOW);
    b ^= 0xff;
    CC |= flagsNZ[b];
    CC |= F_CARRY;
    return b;
};

//----common
var dpadd = function() {
    //direct page + 8bit index
    return DP*256 + fetch();
};

var step = function() {
    var oldT = T;

    var addr = null;
    var pb = null;

    var oldPC = PC;
    var opcode = fetch();
    T+=cycles[opcode];
    switch (opcode) {
        case 0x00: //NEG DP
            addr = dpadd();
            byteTo(addr, oNEG(byteAt(addr)));
            break;
        case 0x03: //COM DP
            addr = dpadd();
            byteTo(addr, oCOM(byteAt(addr)));
            break;
        case 0x04: //LSR DP
            addr = dpadd();
            byteTo(addr, oLSR(byteAt(addr)));
            break;
        case 0x06: //ROR DP
            addr = dpadd();
            byteTo(addr, oROR(byteAt(addr)));
        break;
        case 0x07: //ASR DP
            addr = dpadd();
            byteTo(addr, oASR(byteAt(addr)));
        break;
        case 0x08: //ASL DP
            addr = dpadd();
            byteTo(addr, oASL(byteAt(addr)));
        break;
        case 0x09: //ROL DP
            addr = dpadd();
            byteTo(addr, oROL(byteAt(addr)));
        break;

        case 0x0A: //DEC DP
            addr = dpadd();
            byteTo(addr, oDEC(byteAt(addr)));
        break;
        case 0x0C: //INC DP
            addr = dpadd();
            byteTo(addr, oINC(byteAt(addr)));
        break;

        case 0x0D: //TST DP
            addr = dpadd();
            pb = byteAt(addr);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[pb];
        break;

        case 0x0E: //JMP DP
            addr = dpadd();
            PC = addr;
        break;
        case 0x0F: //CLR DP
            addr = dpadd();
            byteTo(addr,0);
            CC&=~(F_CARRY|F_NEGATIVE|F_OVERFLOW);
            CC |= F_ZERO;
        break;

        case 0x12: //NOP
            break;
        case 0x13: //SYNC
            break;
        case 0x16: //LBRA relative
            addr = signed16(fetch16());
            PC += addr;
            break;
        case 0x17: //LBSR relative
            addr = signed16(fetch16());
            PUSHW(PC);
            PC += addr;
            break;
        case 0x19: //DAA
            var cf = 0;
            var nhi = rA & 0xf0, nlo = rA & 0x0f;
            if( nlo>0x09 || CC & 0x20 ) cf |= 0x06;
            if( nhi>0x80 && nlo>0x09 ) cf |= 0x60;
            if( nhi>0x90 || CC & 0x01 ) cf |= 0x60;
            addr = cf + rA;
            CC  &= ~(F_NEGATIVE | F_ZERO | F_OVERFLOW); // C is preserved, only set below
            if (addr & 0x100)
               CC  |= F_CARRY;
            rA = addr & 0xff;
            CC  |= flagsNZ[rA];
            break;
        case 0x1A: //ORCC
            CC |= fetch();
            break;
        case 0x1C: //ANDCC
            CC &= fetch();
            break;
        case 0x1D: //SEX
            rA = (rB & 0x80)?0xff:0;
            flagsNZ16(getD()); // V is unaffected
            break;
        case 0x1E: //EXG
            pb = fetch();
            TFREXG(pb,true);
            break;
        case 0x1F: //EXG
            pb = fetch();
            TFREXG(pb,false);
            break;

        case 0x20: //BRA
            addr = signed(fetch());
            PC += addr;
            break;
        case 0x21: //BRN
            addr = signed(fetch());
            break;
        case 0x22: //BHI
            addr = signed(fetch());
            if (!(CC&(F_CARRY | F_ZERO))) PC += addr;
        break;
        case 0x23: //BLS
            addr = signed(fetch());
            if (CC&(F_CARRY | F_ZERO)) PC += addr;
        break;
        case 0x24: //BCC
            addr = signed(fetch());
            if (!(CC&F_CARRY)) PC += addr;
        break;
        case 0x25: //BCS
            addr = signed(fetch());
            if (CC&F_CARRY) PC += addr;
        break;
        case 0x26: //BNE
            addr = signed(fetch());
            if (!(CC&F_ZERO)) PC += addr;
        break;
        case 0x27: //BEQ
            addr = signed(fetch());
            if (CC&F_ZERO) PC += addr;
        break;
        case 0x28: //BVC
            addr = signed(fetch());
            if (!(CC&F_OVERFLOW)) PC += addr;
        break;
        case 0x29: //BVS
            addr = signed(fetch());
            if (CC&F_OVERFLOW) PC += addr;
        break;
        case 0x2A: //BPL
            addr = signed(fetch());
            if (!(CC&F_NEGATIVE)) PC += addr;
        break;
        case 0x2B: //BMI
            addr = signed(fetch());
            if (CC&F_NEGATIVE) PC += addr;
        break;
        case 0x2C: //BGE
            addr = signed(fetch());
            if (!((CC&F_NEGATIVE) ^ ((CC&F_OVERFLOW)<<2))) PC += addr;
        break;
        case 0x2D: //BLT
            addr = signed(fetch());
            if ((CC&F_NEGATIVE) ^ ((CC&F_OVERFLOW)<<2)) PC += addr;
        break;
        case 0x2E: //BGT
            addr = signed(fetch());
            if (!((CC&F_NEGATIVE) ^ ((CC&F_OVERFLOW)<<2) || (CC&F_ZERO))) PC += addr;
        break;
        case 0x2F: //BLE
            addr = signed(fetch());
            if ((CC&F_NEGATIVE) ^ ((CC&F_OVERFLOW)<<2) || (CC&F_ZERO)) PC += addr;
        break;

        case 0x30: //LEAX
            rX = PostByte();
            if (rX===0) CC|=F_ZERO; else CC&=~F_ZERO;
        break;
        case 0x31: //LEAY
            rY = PostByte();
            if (rY===0) CC|=F_ZERO; else CC&=~F_ZERO;
        break;
        case 0x32: //LEAS
            rS = PostByte();
        break;
        case 0x33: //LEAU
            rU = PostByte();
        break;

        case 0x34: //PSHS
            PSHS(fetch());
        break;
        case 0x35: //PULS
            PULS(fetch());
        break;
        case 0x36: //PSHU
            PSHU(fetch());
        break;
        case 0x37: //PULU
            PULU(fetch());
        break;
        case 0x39: //RTS
            PC = PULLW();
        break;
        case 0x3A: //ABX
            rX += rB;
        break;
        case 0x3B: //RTI
            CC = PULLB();
            if (CC & F_ENTIRE) {
                T+=9;
                rA = PULLB();
                rB = PULLB();
                DP = PULLB();
                rX = PULLW();
                rY = PULLW();
                rU = PULLW();
            }
            PC = PULLW();
        break;
        case 0x3C: //CWAI **todo
            CC &= fetch();
        break;
        case 0x3D: //MUL
            addr = rA * rB;
            if (addr===0) CC|=F_ZERO; else CC&=~F_ZERO;
            if (addr&0x80) CC|=F_CARRY; else CC&=~F_CARRY;
            setD(addr);
        break;
        case 0x3F: //SWI
            CC |= F_ENTIRE;
            PUSHW(PC);
            PUSHW(rU);
            PUSHW(rY);
            PUSHW(rX);
            PUSHB(DP);
            PUSHB(rB);
            PUSHB(rA);
            PUSHB(CC);
            CC |= F_IRQMASK | F_FIRQMASK;
            PC = ReadWord(vecSWI);
        break;

        case 0x40:
            rA = oNEG(rA);
        break;
        case 0x43:
            rA = oCOM(rA);
        break;
        case 0x44:
            rA = oLSR(rA);
        break;
        case 0x46:
            rA = oROR(rA);
        break;
        case 0x47:
            rA = oASR(rA);
        break;
        case 0x48:
            rA = oASL(rA);
        break;
        case 0x49:
            rA = oROL(rA);
        break;
        case 0x4A:
            rA = oDEC(rA);
        break;
        case 0x4C:
            rA = oINC(rA);
        break;
        case 0x4D:
            CC &= ~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rA];
        break;
        case 0x4F:
            rA = 0;
            CC &= ~(F_NEGATIVE|F_OVERFLOW|F_CARRY);
            CC |= F_ZERO;
        break;

        case 0x50:
            rB = oNEG(rB);
        break;
        case 0x53:
            rB = oCOM(rB);
        break;
        case 0x54:
            rB = oLSR(rB);
        break;
        case 0x56:
            rB = oROR(rB);
        break;
        case 0x57:
            rB = oASR(rB);
        break;
        case 0x58:
            rB = oASL(rB);
        break;
        case 0x59:
            rB = oROL(rB);
        break;
        case 0x5A:
            rB = oDEC(rB);
        break;
        case 0x5C:
            rB = oINC(rB);
        break;
        case 0x5D:
            CC &= ~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rB];
        break;
        case 0x5F:
            rB = 0;
            CC &= ~(F_NEGATIVE|F_OVERFLOW|F_CARRY);
            CC |= F_ZERO;
        break;

        case 0x60: //NEG indexed
            addr = PostByte();
            byteTo(addr, oNEG(byteAt(addr)));
            break;
        case 0x63: //COM indexed
            addr = PostByte();
            byteTo(addr, oCOM(byteAt(addr)));
            break;
        case 0x64: //LSR indexed
            addr = PostByte();
            byteTo(addr, oLSR(byteAt(addr)));
            break;
        case 0x66: //ROR indexed
            addr = PostByte();
            byteTo(addr, oROR(byteAt(addr)));
        break;
        case 0x67: //ASR indexed
            addr = PostByte();
            byteTo(addr, oASR(byteAt(addr)));
        break;
        case 0x68: //ASL indexed
            addr = PostByte();
            byteTo(addr, oASL(byteAt(addr)));
        break;
        case 0x69: //ROL indexed
            addr = PostByte();
            byteTo(addr, oROL(byteAt(addr)));
        break;

        case 0x6A: //DEC indexed
            addr = PostByte();
            byteTo(addr, oDEC(byteAt(addr)));
        break;
        case 0x6C: //INC indexed
            addr = PostByte();
            byteTo(addr, oINC(byteAt(addr)));
        break;

        case 0x6D: //TST indexed
            addr = PostByte();
            pb = byteAt(addr);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[pb];
        break;

        case 0x6E: //JMP indexed
            addr = PostByte();
            PC = addr;
        break;
        case 0x6F: //CLR indexed
            addr = PostByte();
            byteTo(addr,0);
            CC&=~(F_CARRY|F_NEGATIVE|F_OVERFLOW);
            CC |= F_ZERO;
        break;


        case 0x70: //NEG extended
            addr = fetch16();
            byteTo(addr, oNEG(byteAt(addr)));
            break;
        case 0x73: //COM extended
            addr = fetch16();
            byteTo(addr, oCOM(byteAt(addr)));
            break;
        case 0x74: //LSR extended
            addr = fetch16();
            byteTo(addr, oLSR(byteAt(addr)));
            break;
        case 0x76: //ROR extended
            addr = fetch16();
            byteTo(addr, oROR(byteAt(addr)));
        break;
        case 0x77: //ASR extended
            addr = fetch16();
            byteTo(addr, oASR(byteAt(addr)));
        break;
        case 0x78: //ASL extended
            addr = fetch16();
            byteTo(addr, oASL(byteAt(addr)));
        break;
        case 0x79: //ROL extended
            addr = fetch16();
            byteTo(addr, oROL(byteAt(addr)));
        break;

        case 0x7A: //DEC extended
            addr = fetch16();
            byteTo(addr, oDEC(byteAt(addr)));
        break;
        case 0x7C: //INC extended
            addr = fetch16();
            byteTo(addr, oINC(byteAt(addr)));
        break;

        case 0x7D: //TST extended
            addr = fetch16();
            pb = byteAt(addr);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[pb];
        break;

        case 0x7E: //JMP extended
            addr = fetch16();
            PC = addr;
        break;
        case 0x7F: //CLR extended
            addr = fetch16();
            byteTo(addr,0);
            CC&=~(F_CARRY|F_NEGATIVE|F_OVERFLOW);
            CC |= F_ZERO;
        break;

        // regs A,X

        case 0x80: //SUBA imm
            rA = oSUB(rA, fetch());
        break;
        case 0x81: //CMPA imm
            oCMP(rA, fetch());
        break;
        case 0x82: //SBCA imm
            rA = oSBC(rA, fetch());
        break;
        case 0x83: //SUBD imm
            setD(oSUB16(getD(),fetch16()));
        break;
        case 0x84: //ANDA imm
            rA = oAND(rA, fetch());
        break;
        case 0x85: //BITA imm
            oAND(rA, fetch());
        break;
        case 0x86: //LDA imm
            rA = fetch();
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rA];
        break;
        case 0x88: //EORA imm
            rA = oEOR(rA, fetch());
        break;
        case 0x89: //ADCA imm
            rA = oADC(rA, fetch());
        break;
        case 0x8A: //ORA imm
            rA = oOR(rA, fetch());
        break;
        case 0x8B: //ADDA imm
            rA = oADD(rA, fetch());
        break;
        case 0x8C: //CMPX imm
            oCMP16(rX, fetch16());
        break;

        case 0x8D: //JSR imm
            addr = signed(fetch());
            PUSHW(PC);
            PC+=addr;
        break;
        case 0x8E: //LDX imm
            rX = fetch16();
            flagsNZ16(rX);
            CC&=~F_OVERFLOW;
        break;


        case 0x90: //SUBA direct
            addr = dpadd();
            rA = oSUB(rA, byteAt(addr));
        break;
        case 0x91: //CMPA direct
            addr = dpadd();
            oCMP(rA, byteAt(addr));
        break;
        case 0x92: //SBCA direct
            addr = dpadd();
            rA = oSBC(rA, byteAt(addr));
        break;
        case 0x93: //SUBD direct
            addr = dpadd();
            setD(oSUB16(getD(),ReadWord(addr)));
        break;
        case 0x94: //ANDA direct
            addr = dpadd();
            rA = oAND(rA, byteAt(addr));
        break;
        case 0x95: //BITA direct
            addr = dpadd();
            oAND(rA, byteAt(addr));
        break;
        case 0x96: //LDA direct
            addr = dpadd();
            rA = byteAt(addr);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rA];
        break;
        case 0x97: //STA direct
            addr = dpadd();
            byteTo(addr,rA);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rA];
        break;
        case 0x98: //EORA direct
            addr = dpadd();
            rA = oEOR(rA, byteAt(addr));
        break;
        case 0x99: //ADCA direct
            addr = dpadd();
            rA = oADC(rA, byteAt(addr));
        break;
        case 0x9A: //ORA direct
            addr = dpadd();
            rA = oOR(rA, byteAt(addr));
        break;
        case 0x9B: //ADDA direct
            addr = dpadd();
            rA = oADD(rA, byteAt(addr));
        break;
        case 0x9C: //CMPX direct
            addr = dpadd();
            oCMP16(rX, ReadWord(addr));
        break;

        case 0x9D: //JSR direct
            addr = dpadd();
            PUSHW(PC);
            PC=addr;
        break;
        case 0x9E: //LDX direct
            addr = dpadd();
            rX = ReadWord(addr);
            flagsNZ16(rX);
            CC&=~F_OVERFLOW;
        break;
        case 0x9F: //STX direct
            addr = dpadd();
            WriteWord(addr,rX);
            flagsNZ16(rX);
            CC&=~F_OVERFLOW;
        break;
        case 0xA0: //SUBA indexed
            addr = PostByte();
            rA = oSUB(rA, byteAt(addr));
        break;
        case 0xA1: //CMPA indexed
            addr = PostByte();
            oCMP(rA, byteAt(addr));
        break;
        case 0xA2: //SBCA indexed
            addr = PostByte();
            rA = oSBC(rA, byteAt(addr));
        break;
        case 0xA3: //SUBD indexed
            addr = PostByte();
            setD(oSUB16(getD(),ReadWord(addr)));
        break;
        case 0xA4: //ANDA indexed
            addr = PostByte();
            rA = oAND(rA, byteAt(addr));
        break;
        case 0xA5: //BITA indexed
            addr = PostByte();
            oAND(rA, byteAt(addr));
        break;
        case 0xA6: //LDA indexed
            addr = PostByte();
            rA = byteAt(addr);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rA];
        break;
        case 0xA7: //STA indexed
            addr = PostByte();
            byteTo(addr,rA);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rA];
        break;
        case 0xA8: //EORA indexed
            addr = PostByte();
            rA = oEOR(rA, byteAt(addr));
        break;
        case 0xA9: //ADCA indexed
            addr = PostByte();
            rA = oADC(rA, byteAt(addr));
        break;
        case 0xAA: //ORA indexed
            addr = PostByte();
            rA = oOR(rA, byteAt(addr));
        break;
        case 0xAB: //ADDA indexed
            addr = PostByte();
            rA = oADD(rA, byteAt(addr));
        break;
        case 0xAC: //CMPX indexed
            addr = PostByte();
            oCMP16(rX, ReadWord(addr));
        break;

        case 0xAD: //JSR indexed
            addr = PostByte();
            PUSHW(PC);
            PC=addr;
        break;
        case 0xAE: //LDX indexed
            addr = PostByte();
            rX = ReadWord(addr);
            flagsNZ16(rX);
            CC&=~F_OVERFLOW;
        break;
        case 0xAF: //STX indexed
            addr = PostByte();
            WriteWord(addr,rX);
            flagsNZ16(rX);
            CC&=~F_OVERFLOW;
        break;


        case 0xB0: //SUBA extended
            addr = fetch16();
            rA = oSUB(rA, byteAt(addr));
        break;
        case 0xB1: //CMPA extended
            addr = fetch16();
            oCMP(rA, byteAt(addr));
        break;
        case 0xB2: //SBCA extended
            addr = fetch16();
            rA = oSBC(rA, byteAt(addr));
        break;
        case 0xB3: //SUBD extended
            addr = fetch16();
            setD(oSUB16(getD(),ReadWord(addr)));
        break;
        case 0xB4: //ANDA extended
            addr = fetch16();
            rA = oAND(rA, byteAt(addr));
        break;
        case 0xB5: //BITA extended
            addr = fetch16();
            oAND(rA, byteAt(addr));
        break;
        case 0xB6: //LDA extended
            addr = fetch16();
            rA = byteAt(addr);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rA];
        break;
        case 0xB7: //STA extended
            addr = fetch16();
            byteTo(addr,rA);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rA];
        break;
        case 0xB8: //EORA extended
            addr = fetch16();
            rA = oEOR(rA, byteAt(addr));
        break;
        case 0xB9: //ADCA extended
            addr = fetch16();
            rA = oADC(rA, byteAt(addr));
        break;
        case 0xBA: //ORA extended
            addr = fetch16();
            rA = oOR(rA, byteAt(addr));
        break;
        case 0xBB: //ADDA extended
            addr = fetch16();
            rA = oADD(rA, byteAt(addr));
        break;
        case 0xBC: //CMPX extended
            addr = fetch16();
            oCMP16(rX, ReadWord(addr));
        break;

        case 0xBD: //JSR extended
            addr = fetch16();
            PUSHW(PC);
            PC=addr;
        break;
        case 0xBE: //LDX extended
            addr = fetch16();
            rX = ReadWord(addr);
            flagsNZ16(rX);
            CC&=~F_OVERFLOW;
        break;
        case 0xBF: //STX extended
            addr = fetch16();
            WriteWord(addr,rX);
            flagsNZ16(rX);
            CC&=~F_OVERFLOW;
        break;

        //Regs B, Y

        case 0xC0: //SUBB imm
            rB = oSUB(rB, fetch());
        break;
        case 0xC1: //CMPB imm
            oCMP(rB, fetch());
        break;
        case 0xC2: //SBCB imm
            rB = oSBC(rB, fetch());
        break;
        case 0xC3: //ADDD imm
            setD(oADD16(getD(),fetch16()));
        break;
        case 0xC4: //ANDB imm
            rB = oAND(rB, fetch());
        break;
        case 0xC5: //BITB imm
            oAND(rB, fetch());
        break;
        case 0xC6: //LDB imm
            rB = fetch();
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rB];
        break;
        case 0xC8: //EORB imm
            rB = oEOR(rB, fetch());
        break;
        case 0xC9: //ADCB imm
            rB = oADC(rB, fetch());
        break;
        case 0xCA: //ORB imm
            rB = oOR(rB, fetch());
        break;
        case 0xCB: //ADDB imm
            rB = oADD(rB, fetch());
        break;
        case 0xCC: //LDD imm
            addr = fetch16();
            setD(addr);
            flagsNZ16(addr);
            CC&=~F_OVERFLOW;
        break;

        case 0xCE: //LDU imm
            rU = fetch16();
            flagsNZ16(rU);
            CC&=~F_OVERFLOW;
        break;


        case 0xD0: //SUBB direct
            addr = dpadd();
            rB = oSUB(rB, byteAt(addr));
        break;
        case 0xD1: //CMPB direct
            addr = dpadd();
            oCMP(rB, byteAt(addr));
        break;
        case 0xD2: //SBCB direct
            addr = dpadd();
            rB = oSBC(rB, byteAt(addr));
        break;
        case 0xD3: //ADDD direct
            addr = dpadd();
            setD(oADD16(getD(),ReadWord(addr)));
        break;
        case 0xD4: //ANDB direct
            addr = dpadd();
            rB = oAND(rB, byteAt(addr));
        break;
        case 0xD5: //BITB direct
            addr = dpadd();
            oAND(rB, byteAt(addr));
        break;
        case 0xD6: //LDB direct
            addr = dpadd();
            rB = byteAt(addr);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rB];
        break;
        case 0xD7: //STB direct
            addr = dpadd();
            byteTo(addr,rB);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rB];
        break;
        case 0xD8: //EORB direct
            addr = dpadd();
            rB = oEOR(rB, byteAt(addr));
        break;
        case 0xD9: //ADCB direct
            addr = dpadd();
            rB = oADC(rB, byteAt(addr));
        break;
        case 0xDA: //ORB direct
            addr = dpadd();
            rB = oOR(rB, byteAt(addr));
        break;
        case 0xDB: //ADDB direct
            addr = dpadd();
            rB = oADD(rB, byteAt(addr));
        break;
        case 0xDC: //LDD direct
            addr = dpadd();
            pb = ReadWord(addr);
            setD(pb);
            flagsNZ16(pb);
            CC&=~F_OVERFLOW;
        break;

        case 0xDD: //STD direct
            addr = dpadd();
            WriteWord(addr, getD());
            flagsNZ16(getD());
            CC&=~F_OVERFLOW;
        break;
        case 0xDE: //LDU direct
            addr = dpadd();
            rU = ReadWord(addr);
            flagsNZ16(rU);
            CC&=~F_OVERFLOW;
        break;
        case 0xDF: //STU direct
            addr = dpadd();
            WriteWord(addr,rU);
            flagsNZ16(rU);
            CC&=~F_OVERFLOW;
        break;
        case 0xE0: //SUBB indexed
            addr = PostByte();
            rB = oSUB(rB, byteAt(addr));
        break;
        case 0xE1: //CMPB indexed
            addr = PostByte();
            oCMP(rB, byteAt(addr));
        break;
        case 0xE2: //SBCB indexed
            addr = PostByte();
            rB = oSBC(rB, byteAt(addr));
        break;
        case 0xE3: //ADDD indexed
            addr = PostByte();
            setD(oADD16(getD(),ReadWord(addr)));
        break;
        case 0xE4: //ANDB indexed
            addr = PostByte();
            rB = oAND(rB, byteAt(addr));
        break;
        case 0xE5: //BITB indexed
            addr = PostByte();
            oAND(rB, byteAt(addr));
        break;
        case 0xE6: //LDB indexed
            addr = PostByte();
            rB = byteAt(addr);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rB];
        break;
        case 0xE7: //STB indexed
            addr = PostByte();
            byteTo(addr,rB);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rB];
        break;
        case 0xE8: //EORB indexed
            addr = PostByte();
            rB = oEOR(rB, byteAt(addr));
        break;
        case 0xE9: //ADCB indexed
            addr = PostByte();
            rB = oADC(rB, byteAt(addr));
        break;
        case 0xEA: //ORB indexed
            addr = PostByte();
            rB = oOR(rB, byteAt(addr));
        break;
        case 0xEB: //ADDB indexed
            addr = PostByte();
            rB = oADD(rB, byteAt(addr));
        break;
        case 0xEC: //LDD indexed
            addr = PostByte();
            pb = ReadWord(addr);
            setD(pb);
            flagsNZ16(pb);
            CC&=~F_OVERFLOW;
        break;

        case 0xED: //STD indexed
            addr = PostByte();
            WriteWord(addr, getD());
            flagsNZ16(getD());
            CC&=~F_OVERFLOW;
        break;
        case 0xEE: //LDU indexed
            addr = PostByte();
            rU = ReadWord(addr);
            flagsNZ16(rU);
            CC&=~F_OVERFLOW;
        break;
        case 0xEF: //STU indexed
            addr = PostByte();
            WriteWord(addr,rU);
            flagsNZ16(rU);
            CC&=~F_OVERFLOW;
        break;


        case 0xF0: //SUBB extended
            addr = fetch16();
            rB = oSUB(rB, byteAt(addr));
        break;
        case 0xF1: //CMPB extended
            addr = fetch16();
            oCMP(rB, byteAt(addr));
        break;
        case 0xF2: //SBCB extended
            addr = fetch16();
            rB = oSBC(rB, byteAt(addr));
        break;
        case 0xF3: //ADDD extended
            addr = fetch16();
            setD(oADD16(getD(),ReadWord(addr)));
        break;
        case 0xF4: //ANDB extended
            addr = fetch16();
            rB = oAND(rB, byteAt(addr));
        break;
        case 0xF5: //BITB extended
            addr = fetch16();
            oAND(rB, byteAt(addr));
        break;
        case 0xF6: //LDB extended
            addr = fetch16();
            rB = byteAt(addr);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rB];
        break;
        case 0xF7: //STB extended
            addr = fetch16();
            byteTo(addr,rB);
            CC&=~(F_ZERO|F_NEGATIVE|F_OVERFLOW);
            CC |= flagsNZ[rB];
        break;
        case 0xF8: //EORB extended
            addr = fetch16();
            rB = oEOR(rB, byteAt(addr));
        break;
        case 0xF9: //ADCB extended
            addr = fetch16();
            rB = oADC(rB, byteAt(addr));
        break;
        case 0xFA: //ORB extended
            addr = fetch16();
            rB = oOR(rB, byteAt(addr));
        break;
        case 0xFB: //ADDB extended
            addr = fetch16();
            rB = oADD(rB, byteAt(addr));
        break;
        case 0xFC: //LDD extended
            addr = fetch16();
            pb = ReadWord(addr);
            setD(pb);
            flagsNZ16(pb);
            CC&=~F_OVERFLOW;
        break;

        case 0xFD: //STD extended
            addr = fetch16();
            WriteWord(addr, getD());
            flagsNZ16(getD());
            CC&=~F_OVERFLOW;
        break;
        case 0xFE: //LDU extended
            addr = fetch16();
            rU = ReadWord(addr);
            flagsNZ16(rU);
            CC&=~F_OVERFLOW;
        break;
        case 0xFF: //STU extended
            addr = fetch16();
            WriteWord(addr,rU);
            flagsNZ16(rU);
            CC&=~F_OVERFLOW;
        break;

        // page 1
        case 0x10: //page 1
            {
                opcode = fetch();
                T+=cycles2[opcode];
                switch(opcode) {
                    case 0x21: //BRN
                        addr = signed16(fetch16());
                        break;
                    case 0x22: //BHI
                        addr = signed16(fetch16());
                        if (!(CC&(F_CARRY | F_ZERO))) { PC += addr; T++; } // taken long branch takes 1 extra cycle
                    break;
                    case 0x23: //BLS
                        addr = signed16(fetch16());
                        if (CC&(F_CARRY | F_ZERO)) { PC += addr; T++; } // taken long branch takes 1 extra cycle
                    break;
                    case 0x24: //BCC
                        addr = signed16(fetch16());
                        if (!(CC&F_CARRY)) { PC += addr; T++; } // taken long branch takes 1 extra cycle
                    break;
                    case 0x25: //BCS
                        addr = signed16(fetch16());
                        if (CC&F_CARRY) { PC += addr; T++; } // taken long branch takes 1 extra cycle
                    break;
                    case 0x26: //BNE
                        addr = signed16(fetch16());
                        if (!(CC&F_ZERO)) { PC += addr; T++; } // taken long branch takes 1 extra cycle
                    break;
                    case 0x27: //BEQ
                        addr = signed16(fetch16());
                        if (CC&F_ZERO) { PC += addr; T++; } // taken long branch takes 1 extra cycle
                    break;
                    case 0x28: //BVC
                        addr = signed16(fetch16());
                        if (!(CC&F_OVERFLOW)) { PC += addr; T++; } // taken long branch takes 1 extra cycle
                    break;
                    case 0x29: //BVS
                        addr = signed16(fetch16());
                        if (CC&F_OVERFLOW) { PC += addr; T++; } // taken long branch takes 1 extra cycle
                    break;
                    case 0x2A: //BPL
                        addr = signed16(fetch16());
                        if (!(CC&F_NEGATIVE)) { PC += addr; T++; } // taken long branch takes 1 extra cycle
                    break;
                    case 0x2B: //BMI
                        addr = signed16(fetch16());
                        if (CC&F_NEGATIVE) { PC += addr; T++; } // taken long branch takes 1 extra cycle
                    break;
                    case 0x2C: //BGE
                        addr = signed16(fetch16());
                        if (!((CC&F_NEGATIVE) ^ ((CC&F_OVERFLOW)<<2))) { PC += addr; T++; } // taken long branch takes 1 extra cycle
                    break;
                    case 0x2D: //BLT
                        addr = signed16(fetch16());
                        if ((CC&F_NEGATIVE) ^ ((CC&F_OVERFLOW)<<2)) { PC += addr; T++; } // taken long branch takes 1 extra cycle
                    break;
                    case 0x2E: //BGT
                        addr = signed16(fetch16());
                        if (!((CC&F_NEGATIVE) ^ ((CC&F_OVERFLOW)<<2) || (CC&F_ZERO))) { PC += addr; T++; } // taken long branch takes 1 extra cycle
                    break;
                    case 0x2F: //BLE
                        addr = signed16(fetch16());
                        if ((CC&F_NEGATIVE) ^ ((CC&F_OVERFLOW)<<2) || (CC&F_ZERO)) { PC += addr; T++; } // taken long branch takes 1 extra cycle
                    break;
                    case 0x3f: //SWI2
                        CC |= F_ENTIRE;
                        PUSHW(PC);
                        PUSHW(rU);
                        PUSHW(rY);
                        PUSHW(rX);
                        PUSHB(DP);
                        PUSHB(rB);
                        PUSHB(rA);
                        PUSHB(CC);
                        // unlike SWI, SWI2 doesn't set I or F
                        PC = ReadWord(vecSWI2);
                    break;
                    case 0x83: //CMPD imm
                        oCMP16(getD(),fetch16());
                    break;
                    case 0x8C: //CMPY imm
                        oCMP16(rY,fetch16());
                    break;
                    case 0x8E: //LDY imm
                        rY = fetch16();
                        flagsNZ16(rY);
                        CC&=~F_OVERFLOW;
                    break;
                    case 0x93: //CMPD direct
                        addr = dpadd();
                        oCMP16(getD(),ReadWord(addr));
                    break;
                    case 0x9C: //CMPY direct
                        addr = dpadd();
                        oCMP16(rY,ReadWord(addr));
                    break;
                    case 0x9E: //LDY direct
                        addr = dpadd();
                        rY = ReadWord(addr);
                        flagsNZ16(rY);
                        CC&=~F_OVERFLOW;
                    break;
                    case 0x9F: //STY direct
                        addr = dpadd();
                        WriteWord(addr,rY);
                        flagsNZ16(rY);
                        CC&=~F_OVERFLOW;
                    break;
                    case 0xA3: //CMPD indexed
                        addr = PostByte();
                        oCMP16(getD(),ReadWord(addr));
                    break;
                    case 0xAC: //CMPY indexed
                        addr = PostByte();
                        oCMP16(rY,ReadWord(addr));
                    break;
                    case 0xAE: //LDY indexed
                        addr = PostByte();
                        rY = ReadWord(addr);
                        flagsNZ16(rY);
                        CC&=~F_OVERFLOW;
                    break;
                    case 0xAF: //STY indexed
                        addr = PostByte();
                        WriteWord(addr,rY);
                        flagsNZ16(rY);
                        CC&=~F_OVERFLOW;
                    break;
                    case 0xB3: //CMPD extended
                        addr = fetch16();
                        oCMP16(getD(),ReadWord(addr));
                    break;
                    case 0xBC: //CMPY extended
                        addr = fetch16();
                        oCMP16(rY,ReadWord(addr));
                    break;
                    case 0xBE: //LDY extended
                        addr = fetch16();
                        rY = ReadWord(addr);
                        flagsNZ16(rY);
                        CC&=~F_OVERFLOW;
                    break;
                    case 0xBF: //STY extended
                        addr = fetch16();
                        WriteWord(addr,rY);
                        flagsNZ16(rY);
                        CC&=~F_OVERFLOW;
                    break;
                    case 0xCE: //LDS imm
                        rS = fetch16();
                        flagsNZ16(rS);
                        CC&=~F_OVERFLOW;
                    break;
                    case 0xDE: //LDS direct
                        addr = dpadd();
                        rS = ReadWord(addr);
                        flagsNZ16(rS);
                        CC&=~F_OVERFLOW;
                    break;
                    case 0xDF: //STS direct
                        addr = dpadd();
                        WriteWord(addr,rS);
                        flagsNZ16(rS);
                        CC&=~F_OVERFLOW;
                    break;
                    case 0xEE: //LDS indexed
                        addr = PostByte();
                        rS = ReadWord(addr);
                        flagsNZ16(rS);
                        CC&=~F_OVERFLOW;
                    break;
                    case 0xEF: //STS indexed
                        addr = PostByte();
                        WriteWord(addr,rS);
                        flagsNZ16(rS);
                        CC&=~F_OVERFLOW;
                    break;
                    case 0xFE: //LDS extended
                        addr = fetch16();
                        rS = ReadWord(addr);
                        flagsNZ16(rS);
                        CC&=~F_OVERFLOW;
                    break;
                    case 0xFF: //STS extended
                        addr = fetch16();
                        WriteWord(addr,rS);
                        flagsNZ16(rS);
                        CC&=~F_OVERFLOW;
                    break;
                }
            }
        break;
        // page 2
        case 0x11: //page 2
            {
                opcode = fetch();
                T+=cycles2[opcode];
                switch(opcode) {
                    case 0x3f: //SWI3
                        CC |= F_ENTIRE;
                        PUSHW(PC);
                        PUSHW(rU);
                        PUSHW(rY);
                        PUSHW(rX);
                        PUSHB(DP);
                        PUSHB(rB);
                        PUSHB(rA);
                        PUSHB(CC);
                        // unlike SWI, SWI3 doesn't set I or F
                        PC = ReadWord(vecSWI3);
                    break;
                    case 0x83: //CMPU imm
                        oCMP16(rU, fetch16());
                    break;
                    case 0x8C: //CMPS imm
                        oCMP16(rS, fetch16());
                    break;
                    case 0x93: //CMPU imm
                        addr = dpadd();
                        oCMP16(rU, ReadWord(addr));
                    break;
                    case 0x9C: //CMPS imm
                        addr = dpadd();
                        oCMP16(rS, ReadWord(addr));
                    break;
                    case 0xA3: //CMPU imm
                        addr = PostByte();
                        oCMP16(rU, ReadWord(addr));
                    break;
                    case 0xAC: //CMPS imm
                        addr = PostByte();
                        oCMP16(rS, ReadWord(addr));
                    break;
                    case 0xB3: //CMPU imm
                        addr = fetch16();
                        oCMP16(rU, ReadWord(addr));
                    break;
                    case 0xBC: //CMPS imm
                        addr = fetch16();
                        oCMP16(rS, ReadWord(addr));
                    break;

                }
            }
        break;


    }

    rA &= 0xff;
    rB &= 0xff;
    CC &= 0xff;
    DP &= 0xff;
    rX &= 0xffff;
    rY &= 0xffff;
    rU &= 0xffff;
    rS &= 0xffff;
    PC &= 0xffff;
    return T-oldT;

};

var reset = function(){
    PC = ReadWord(vecRESET);
    DP = 0;
    CC |= F_FIRQMASK | F_IRQMASK;
    T=0;
    rA=rB=DP=rX=rY=rU=rS=0;
};

//---------- Disassembler

/*
ILLEGAL 0
DIRECT 1
INHERENT 2
BRANCH_REL_16 3
IMMEDIAT_8 4
BRANCH_REL_8 5
INDEXED 6
EXTENDED 7
IMMEDIAT_16 8

PSHS 10
PSHU 11

EXG, TFR 20
*/
var ds = [
[2,  1,"NEG"],
[1,  0,"???"],
[1,  0,"???"],
[2,  1,"COM"],
[2,  1,"LSR"],
[1,  0,"???"],
[2,  1,"ROR"],
[2,  1,"ASR"],
[2,  1,"LSL"],
[2,  1,"ROL"],
[2,  1,"DEC"],
[1,  0,"???"],
[2,  1,"INC"],
[2,  1,"TST"],
[2,  1,"JMP"],
[2,  1,"CLR"],
[1,  0,"Prefix"],
[1,  0,"Prefix"],
[1,  2,"NOP"],
[1,  2,"SYNC"],
[1,  0,"???"],
[1,  0,"???"],
[3,  3,"LBRA"],
[3,  3,"LBSR"],
[1,  0,"???"],
[1,  2,"DAA"],
[2,  4,"ORCC"],
[1,  0,"???"],
[2,  4,"ANDCC"],
[1,  2,"SEX"],
[2,  20,"EXG"],
[2,  20,"TFR"],
[2,  5,"BRA"],
[2,  5,"BRN"],
[2,  5,"BHI"],
[2,  5,"BLS"],
[2,  5,"BCC"],
[2,  5,"BCS"],
[2,  5,"BNE"],
[2,  5,"BEQ"],
[2,  5,"BVC"],
[2,  5,"BVS"],
[2,  5,"BPL"],
[2,  5,"BMI"],
[2,  5,"BGE"],
[2,  5,"BLT"],
[2,  5,"BGT"],
[2,  5,"BLE"],
[2,  6,"LEAX"],
[2,  6,"LEAY"],
[2,  6,"LEAS"],
[2,  6,"LEAU"],
[2,  10,"PSHS"],
[2,  10,"PULS"],
[2,  11,"PSHU"],
[2,  11,"PULU"],
[1,  0,"???"],
[1,  2,"RTS"],
[1,  2,"ABX"],
[1,  2,"RTI"],
[2,  2,"CWAI"],
[1,  2,"MUL"],
[1,  2,"RESET"],
[1,  2,"SWI1"],
[1,  2,"NEGA"],
[1,  0,"???"],
[1,  0,"???"],
[1,  2,"COMA"],
[1,  2,"LSRA"],
[1,  0,"???"],
[1,  2,"RORA"],
[1,  2,"ASRA"],
[1,  2,"ASLA"],
[1,  2,"ROLA"],
[1,  2,"DECA"],
[1,  0,"???"],
[1,  2,"INCA"],
[1,  2,"TSTA"],
[1,  0,"???"],
[1,  2,"CLRA"],
[1,  2,"NEGB"],
[1,  0,"???"],
[1,  0,"???"],
[1,  2,"COMB"],
[1,  2,"LSRB"],
[1,  0,"???"],
[1,  2,"RORB"],
[1,  2,"ASRB"],
[1,  2,"ASLB"],
[1,  2,"ROLB"],
[1,  2,"DECB"],
[1,  0,"???"],
[1,  2,"INCB"],
[1,  2,"TSTB"],
[1,  0,"???"],
[1,  2,"CLRB"],
[2,  6,"NEG"],
[1,  0,"???"],
[1,  0,"???"],
[2,  6,"COM"],
[2,  6,"LSR"],
[1,  0,"???"],
[2,  6,"ROR"],
[2,  6,"ASR"],
[2,  6,"LSL"],
[2,  6,"ROL"],
[2,  6,"DEC"],
[1,  0,"???"],
[2,  6,"INC"],
[2,  6,"TST"],
[2,  6,"JMP"],
[2,  6,"CLR"],
[3,  7,"NEG"],
[1,  0,"???"],
[1,  0,"???"],
[3,  7,"COM"],
[3,  7,"LSR"],
[1,  0,"???"],
[3,  7,"ROR"],
[3,  7,"ASR"],
[3,  7,"LSL"],
[3,  7,"ROL"],
[3,  7,"DEC"],
[1,  0,"???"],
[3,  7,"INC"],
[3,  7,"TST"],
[3,  7,"JMP"],
[3,  7,"CLR"],
[2,  4,"SUBA"],
[2,  4,"CMPA"],
[2,  4,"SBCA"],
[3,  8,"SUBD"],
[2,  4,"ANDA"],
[2,  4,"BITA"],
[2,  4,"LDA"],
[1,  0,"???"],
[2,  4,"EORA"],
[2,  4,"ADCA"],
[2,  4,"ORA"],
[2,  4,"ADDA"],
[3,  8,"CMPX"],
[2,  5,"BSR"],
[3,  8,"LDX"],
[1,  0,"???"],
[2,  1,"SUBA"],
[2,  1,"CMPA"],
[2,  1,"SBCA"],
[2,  1,"SUBd"],
[2,  1,"ANDA"],
[2,  1,"BITA"],
[2,  1,"LDA"],
[2,  1,"STA"],
[2,  1,"EORA"],
[2,  1,"ADCA"],
[2,  1,"ORA"],
[2,  1,"ADDA"],
[2,  1,"CMPX"],
[2,  1,"JSR"],
[2,  1,"LDX"],
[2,  1,"STX"],
[2,  6,"SUBA"],
[2,  6,"CMPA"],
[2,  6,"SBCA"],
[2,  6,"SUBD"],
[2,  6,"ANDA"],
[2,  6,"BITA"],
[2,  6,"LDA"],
[2,  6,"STA"],
[2,  6,"EORA"],
[2,  6,"ADCA"],
[2,  6,"ORA"],
[2,  6,"ADDA"],
[2,  6,"CMPX"],
[2,  6,"JSR"],
[2,  6,"LDX"],
[2,  6,"STX"],
[3,  7,"SUBA"],
[3,  7,"CMPA"],
[3,  7,"SBCA"],
[3,  7,"SUBD"],
[3,  7,"ANDA"],
[3,  7,"BITA"],
[3,  7,"LDA"],
[3,  7,"STA"],
[3,  7,"EORA"],
[3,  7,"ADCA"],
[3,  7,"ORA"],
[3,  7,"ADDA"],
[3,  7,"CMPX"],
[3,  7,"JSR"],
[3,  7,"LDX"],
[3,  7,"STX"],
[2,  4,"SUBB"],
[2,  4,"CMPB"],
[2,  4,"SBCB"],
[3,  8,"ADDD"],
[2,  4,"ANDB"],
[2,  4,"BITB"],
[2,  4,"LDB"],
[1,  0,"???"],
[2,  4,"EORB"],
[2,  4,"ADCB"],
[2,  4,"ORB"],
[2,  4,"ADDB"],
[3,  8,"LDD"],
[1,  0,"???"],
[3,  8,"LDU"],
[1,  0,"???"],
[2,  1,"SUBB"],
[2,  1,"CMPB"],
[2,  1,"SBCB"],
[2,  1,"ADDD"],
[2,  1,"ANDB"],
[2,  1,"BITB"],
[2,  1,"LDB"],
[2,  1,"STB"],
[2,  1,"EORB"],
[2,  1,"ADCB"],
[2,  1,"ORB "],
[2,  1,"ADDB"],
[2,  1,"LDD "],
[2,  1,"STD "],
[2,  1,"LDU "],
[2,  1,"STU "],
[2,  6,"SUBB"],
[2,  6,"CMPB"],
[2,  6,"SBCB"],
[2,  6,"ADDD"],
[2,  6,"ANDB"],
[2,  6,"BITB"],
[2,  6,"LDB"],
[2,  6,"STB"],
[2,  6,"EORB"],
[2,  6,"ADCB"],
[2,  6,"ORB"],
[2,  6,"ADDB"],
[2,  6,"LDD"],
[2,  6,"STD"],
[2,  6,"LDU"],
[2,  6,"STU"],
[3,  7,"SUBB"],
[3,  7,"CMPB"],
[3,  7,"SBCB"],
[3,  7,"ADDD"],
[3,  7,"ANDB"],
[3,  7,"BITB"],
[3,  7,"LDB"],
[3,  7,"STB"],
[3,  7,"EORB"],
[3,  7,"ADCB"],
[3,  7,"ORB"],
[3,  7,"ADDB"],
[3,  7,"LDD"],
[3,  7,"STD"],
[3,  7,"LDU"],
[3,  7,"STU"]
];

var ds11 = {
0x3F: [2,2,"SWI3"],
0x83: [4,8,"CMPU"],
0x8C: [4,8,"CMPS"],
0x93: [3,1,"CMPU"],
0x9C: [3,1,"CMPS"],
0xA3: [3,6,"CMPU"],
0xAC: [3,6,"CMPS"],
0xB3: [4,7,"CMPU"],
0xBC: [4,7,"CMPS"]
};

var ds10 = {
0x21:[5,3,"LBRN"],
0x22:[5,3,"LBHI"],
0x23:[5,3,"LBLS"],
0x24:[5,3,"LBCC"],
0x25:[5,3,"LBCS"],
0x26:[5,3,"LBNE"],
0x27:[5,3,"LBEQ"],
0x28:[5,3,"LBVC"],
0x29:[5,3,"LBVS"],
0x2a:[5,3,"LBPL"],
0x2b:[5,3,"LBMI"],
0x2c:[5,3,"LBGE"],
0x2d:[5,3,"LBLT"],
0x2e:[5,3,"LBGT"],
0x2f:[5,3,"LBLE"],
0x3F:[2,2,"SWI2"],
0x83:[4,8,"CMPD"],
0x8C:[4,8,"CMPY"],
0x8E:[4,8,"LDY"],
0x93:[3,1,"CMPD"],
0x9C:[3,1,"CMPY"],
0x9E:[3,1,"LDY"],
0x9F:[3,1,"STY"],
0xA3:[3,6,"CMPD"],
0xAC:[3,6,"CMPY"],
0xAE:[3,6,"LDY"],
0xAF:[3,6,"STY"],
0xB3:[4,7,"CMPD"],
0xBC:[4,7,"CMPY"],
0xBE:[4,7,"LDY"],
0xBF:[4,7,"STY"],
0xCE:[4,8,"LDS"],
0xDE:[3,1,"LDS"],
0xDF:[3,1,"STS"],
0xEE:[3,6,"LDS"],
0xEF:[3,6,"STS"],
0xFE:[4,7,"LDS"],
0xFF:[4,7,"STS"]
};
/*
ILLEGAL 0
DIRECT 1
INHERENT 2
BRANCH_REL_16 3
IMMEDIAT_8 4
BRANCH_REL_8 5
INDEXED 6
EXTENDED 7
IMMEDIAT_16 8
*/

var disasm = function(i,a,b,c,d,pc) {
    var toHexN = function(n,d) {
      var s = n.toString(16);
      while (s.length <d) {s = '0'+s;}
      return s.toUpperCase();
    };

    var toHex2 = function(n) {return toHexN(n & 0xff,2);};
    var toHex4 = function(n) {return toHexN(n,4);};
    var rx,ro,j;
      var sx = ds[i];
      if (i===0x10) {
        sx = ds10[a];
        if (sx===undefined) {
            return ["???",2];
        }
        i=a;a=b;b=c;c=d;
      }
      if (i===0x11) {
        sx = ds11[a];
        if (sx===undefined) {
            return ["???",2];
        }
        i=a;a=b;b=c;c=d;
      }
      var bytes = sx[0] as number;
      var mode = sx[1] as number;
      var mnemo = sx[2];

      switch (mode) {
        case 0: //invalid
            break;
        case 1: //direct page
            mnemo+="\t$"+toHex2(a); break;
        case 2: // inherent
            break;
        case 3: //brel16
            mnemo+="\t#$"+toHex4((a*256+b)<32768 ? (a*256+b+pc):(a*256+b+pc-65536)); break;
        case 4: //imm8
            mnemo+="\t#$"+toHex2(a); break;
        case 5: //brel8
            mnemo+="\t#$"+toHex4((a)<128 ? (a+pc+2):(a+pc-254)); break;
        case 6: //indexed, postbyte etc.
            mnemo+='\t';
            var pb = a;
            var ixr = ["X","Y","U","S"][(pb & 0x60)>>5];
            if (!(pb & 0x80)) {
                //direct5
                var disp = pb & 0x1f;
                if (disp>15) disp = disp-32;
                mnemo+=disp+','+ixr;
                break;
            }
            var ind = pb & 0x10;
            var mod = pb & 0x0f;
            var ofs8 = (b>127)?(b-256):b;
            var ofs16 = ((b*256+c)>32767)?((b*256+c)-65536):(b*256+c);
            if (!ind) {
                switch (mod) {
                    case 0: mnemo += ","+ixr+'+'; break;
                    case 1: mnemo += ","+ixr+'++'; break;
                    case 2: mnemo += ",-"+ixr; break;
                    case 3: mnemo += ",--"+ixr; break;
                    case 4: mnemo += ","+ixr; break;
                    case 5: mnemo += "B,"+ixr; break;
                    case 6: mnemo += "A,"+ixr; break;
                    case 7: mnemo += "???"; break;
                    case 8: mnemo += ofs8+","+ixr; bytes++; break;
                    case 9: mnemo += ofs16+","+ixr; bytes+=2; break;
                    case 10: mnemo += "???"; break;
                    case 11: mnemo += "D,"+ixr; break;
                    case 12: mnemo += ofs8+",PC"; bytes++; break;
                    case 13: mnemo += ofs16+",PC"; bytes+=2; break;
                    case 14: mnemo += "???"; break;
                    case 15: mnemo += "$"+toHex4((b*256+c)); bytes+=2; break;
                }
            }  else {
                switch (mod) {
                    case 0: mnemo += "???"; break;
                    case 1: mnemo += "[,"+ixr+'++]'; break;
                    case 2: mnemo += "???"; break;
                    case 3: mnemo += "[,--"+ixr+']'; break;
                    case 4: mnemo += "[,"+ixr+']'; break;
                    case 5: mnemo += "[B,"+ixr+']'; break;
                    case 6: mnemo += "[A,"+ixr+']'; break;
                    case 7: mnemo += "???"; break;
                    case 8: mnemo += "["+ofs8+","+ixr+']'; bytes++; break;
                    case 9: mnemo += "["+ofs16+","+ixr+']'; bytes+=2; break;
                    case 10: mnemo += "???"; break;
                    case 11: mnemo += "[D,"+ixr+']'; break;
                    case 12: mnemo += "["+ofs8+",PC]"; bytes++; break;
                    case 13: mnemo += "["+ofs16+",PC]"; bytes+=2; break;
                    case 14: mnemo += "???"; break;
                    case 15: mnemo += "[$"+toHex4((b*256+c))+']'; bytes+=2; break;
                }
            }

            break;
        case 7: //extended
            mnemo+="\t$"+toHex4(a*256+b); break;
        case 8: //imm16
            mnemo+="\t#$"+toHex4(a*256+b); break;

        case 10: //pshs, puls
            rx = ['PC','U','Y','X','DP','B','A','CC'];
            ro = [];
            for (j=0;j<8;j++) {
                if ((a & 1)!==0) {ro.push(rx[7-j]);}
                a>>=1;
            }
            mnemo += '\t'+ro.join(',');
            break;
        case 11: //pshs, puls
            rx = ['PC','S','Y','X','DP','B','A','CC'];
            ro = [];
            for (j=0;j<8;j++) {
                if ((a & 1)!==0) {ro.push(rx[7-j]);}
                a>>=1;
            }
            mnemo += '\t'+ro.join(',');
            break;
        case 20: //TFR etc
            rx = ['D','X','Y','U','S','PC','?','?','A','B','CC','DP','?','?','?','?'];
            mnemo += '\t'+rx[a>>4]+','+rx[a&0x0f];
            break;
      }

      return {line:mnemo,nbytes:bytes};
    };


//---------- Exports

return {
    steps: function(Ts){
        //T=0;
        while (Ts>0){
            Ts-=step();
        }
    },
    runFrame: function(Tt){
        while (T<Tt){
          step();
        }
    },
    advanceInsn: function() {
        return step();
    },
    T:function(){return T;},
    getTstates:function(){return T;},
    setTstates:function(t){T=t;},
    reset: reset,
    init: function(bt,ba,tck){
        byteTo=bt;
        byteAt=ba;
        ticks=tck;
        reset();
    },
    getPC: function() { return PC; },
    getSP: function() { return rS; },
    saveState: function() {
        return {
            PC:PC,
            SP:rS,
            U:rU,
            A:rA,
            B:rB,
            X:rX,
            Y:rY,
            DP:DP,
            CC:CC,
            T:T
        };
    },
    loadState: function(s) {
      PC=s.PC;
      rS=s.SP;
      rU=s.U;
      rA=s.A;
      rB=s.B;
      rX=s.X;
      rY=s.Y;
      DP=s.DP;
      CC=s.CC;
      T=s.T;
    },
    firq: function() {
      if (CC & F_FIRQMASK) return;
      PUSHW(PC);
      CC &= ~F_ENTIRE;
      PUSHB(CC);
      CC |= F_IRQMASK | F_FIRQMASK;
      PC = ReadWord(vecFIRQ);
      T += 9;
    },
    interrupt: function() {
      if (CC & F_IRQMASK) return;
      PUSHW(PC);
      PUSHW(rU);
      PUSHW(rY);
      PUSHW(rX);
      PUSHB(DP);
      PUSHB(rB);
      PUSHB(rA);
      CC |= F_ENTIRE;
      PUSHB(CC);
      CC |= F_IRQMASK;
      PC = ReadWord(vecIRQ);
      T += 18;
    },
    nmi: function() {
      PUSHW(PC);
      PUSHW(rU);
      PUSHW(rY);
      PUSHW(rX);
      PUSHB(DP);
      PUSHB(rB);
      PUSHB(rA);
      CC |= F_ENTIRE;
      PUSHB(CC);
      CC |= F_IRQMASK | F_FIRQMASK;
      PC = ReadWord(vecNMI);
      T += 18;
    },
    set:function(reg,value) {
        switch (reg.toUpperCase()) {
            case "PC": PC=value;return;
            case "A": rA=value;return;
            case "B": rB=value;return;
            case "X": rX=value;return;
            case "Y": rY=value;return;
            case "SP": rS=value;return;
            case "U": rU=value;return;
            case "FLAGS": CC=value;return;
        }
    },
    flagsToString: function() {
        var f='',fx = "EFHINZVC";
        for (var i=0;i<8;i++) {
            var n = CC&(0x80>>i);
            if (n===0) {f+=fx[i].toLowerCase();} else {f+=fx[i];}
        }
        return f;
    },
    disasm: disasm,
    isStable: function() { return true; }
};

};
