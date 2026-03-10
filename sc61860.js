/**
 * SC61860 CPU Emulator
 * Sharp PC-1403 pocket computer CPU emulation
 * Based on ESR-H architecture by Hitachi
 * 
 * Architecture:
 * - 8-bit data bus, 64KB address space
 * - 96 bytes internal RAM (scratchpad)
 * - Registers: A, B, I, J, K, L, M, N (8-bit)
 * - Pointers: P, Q, R (7-bit, internal RAM)
 * - Data pointer: DP (16-bit)
 * - Program counter: PC (16-bit)
 * - X, Y (16-bit RAM pointers mapped to internal RAM)
 * - Flags: carry (c), zero (z)
 */

class SC61860 {
  constructor(memory) {
    this.mem = memory; // external memory interface

    // Internal RAM: 96 bytes
    this.iram = new Uint8Array(96);

    // 16-bit registers (not in iram directly)
    this.PC = 0x0000;
    this.DP = 0x0000;

    // Internal RAM pointer registers (7-bit)
    this._P = 0x00;
    this._Q = 0x00;
    this._R = 0x5B; // stack starts at 0x5B

    // Flags
    this.carry = 0;
    this.zero = 0;

    // H pseudo-register
    this.H = 0;

    // Cycle counter
    this.cycles = 0;

    // Halted state
    this.halted = false;

    // I/O ports
    this.portIA = 0x00;
    this.portIB = 0x00;
    this.portF0 = 0x00;
    this.portC  = 0x00;

    // Callbacks for I/O
    this.onOutA = null;
    this.onOutB = null;
    this.onOutC = null;
    this.onOutF = null;
    this.onInA  = null;
    this.onInB  = null;
  }

  // ─── Internal RAM register getters/setters ────────────────────────────────
  get A()  { return this.iram[0x02]; }
  set A(v) { this.iram[0x02] = v & 0xFF; }

  get B()  { return this.iram[0x03]; }
  set B(v) { this.iram[0x03] = v & 0xFF; }

  get I()  { return this.iram[0x00]; }
  set I(v) { this.iram[0x00] = v & 0xFF; }

  get J()  { return this.iram[0x01]; }
  set J(v) { this.iram[0x01] = v & 0xFF; }

  get K()  { return this.iram[0x08]; }
  set K(v) { this.iram[0x08] = v & 0xFF; }

  get L()  { return this.iram[0x09]; }
  set L(v) { this.iram[0x09] = v & 0xFF; }

  get M()  { return this.iram[0x0A]; }
  set M(v) { this.iram[0x0A] = v & 0xFF; }

  get N()  { return this.iram[0x0B]; }
  set N(v) { this.iram[0x0B] = v & 0xFF; }

  // X = 16-bit pointer at iram[0x04..0x05]
  get Xl() { return this.iram[0x04]; }
  set Xl(v){ this.iram[0x04] = v & 0xFF; }
  get Xh() { return this.iram[0x05]; }
  set Xh(v){ this.iram[0x05] = v & 0xFF; }
  get X()  { return (this.iram[0x05] << 8) | this.iram[0x04]; }
  set X(v) { this.iram[0x04] = v & 0xFF; this.iram[0x05] = (v >> 8) & 0xFF; }

  // Y = 16-bit pointer at iram[0x06..0x07]
  get Yl() { return this.iram[0x06]; }
  set Yl(v){ this.iram[0x06] = v & 0xFF; }
  get Yh() { return this.iram[0x07]; }
  set Yh(v){ this.iram[0x07] = v & 0xFF; }
  get Y()  { return (this.iram[0x07] << 8) | this.iram[0x06]; }
  set Y(v) { this.iram[0x06] = v & 0xFF; this.iram[0x07] = (v >> 8) & 0xFF; }

  // P, Q, R (7-bit internal RAM pointers)
  get P()  { return this._P & 0x7F; }
  set P(v) { this._P = v & 0x7F; }
  get Q()  { return this._Q & 0x7F; }
  set Q(v) { this._Q = v & 0x7F; }
  get R()  { return this._R & 0x7F; }
  set R(v) { this._R = v & 0x7F; }

  // ─── Memory read/write ────────────────────────────────────────────────────
  readMem(addr) {
    return this.mem.read(addr & 0xFFFF);
  }

  writeMem(addr, val) {
    this.mem.write(addr & 0xFFFF, val & 0xFF);
  }

  // Internal RAM read (used by instructions referencing P,Q,R)
  readIram(addr) {
    addr &= 0x7F;
    if (addr >= 0x5B && addr <= 0x5E) {
      // I/O mapped area
      if (addr === 0x5C) return this.portIA;
      if (addr === 0x5D) return this.portIB;
      if (addr === 0x5E) return this.portF0;
    }
    if (addr < 96) return this.iram[addr];
    return 0;
  }

  writeIram(addr, val) {
    addr &= 0x7F;
    val &= 0xFF;
    if (addr < 96) this.iram[addr] = val;
  }

  // ─── Flag helpers ─────────────────────────────────────────────────────────
  setZero(v)  { this.zero  = (v === 0) ? 1 : 0; }
  setCarry(v) { this.carry = (v >> 8) & 1; }
  setFlags(v) { this.setCarry(v); this.setZero(v & 0xFF); }

  // ─── Stack operations ─────────────────────────────────────────────────────
  stackPush(val) {
    this.writeIram(this.R, val & 0xFF);
    this.R = (this.R - 1) & 0x7F;
  }

  stackPop() {
    this.R = (this.R + 1) & 0x7F;
    return this.readIram(this.R);
  }

  // Push 16-bit address (PC) onto stack
  pushAddr(addr) {
    this.stackPush(addr & 0xFF);         // low byte first
    this.stackPush((addr >> 8) & 0xFF);  // high byte
    // R now points to high byte location - 1
  }

  // Pop 16-bit address from stack
  popAddr() {
    const hi = this.stackPop();
    const lo = this.stackPop();
    return ((hi << 8) | lo) & 0xFFFF;
  }

  // ─── Fetch helpers ────────────────────────────────────────────────────────
  fetch8() {
    const v = this.readMem(this.PC);
    this.PC = (this.PC + 1) & 0xFFFF;
    return v;
  }

  fetch16() {
    const hi = this.fetch8();
    const lo = this.fetch8();
    return (hi << 8) | lo;
  }

  // ─── BCD multi-byte operations ────────────────────────────────────────────
  bcdAdd(n) {
    let carry = 0;
    for (let i = 0; i <= n; i++) {
      let a = this.readIram(this.P);
      let sum;
      if (i === 0) sum = a + this.A + carry;
      else         sum = a + carry;
      // BCD adjust
      if ((sum & 0x0F) > 9) sum += 6;
      if ((sum >> 4) > 9)   sum += 0x60;
      carry = (sum > 0x99) ? 1 : 0;
      this.writeIram(this.P, sum & 0xFF);
      this.P = (this.P - 1) & 0x7F;
    }
    this.carry = carry;
    this.P = (this.P - 1) & 0x7F;
  }

  bcdSub(n) {
    let borrow = 0;
    for (let i = 0; i <= n; i++) {
      let a = this.readIram(this.P);
      let diff;
      if (i === 0) diff = a - this.A - borrow;
      else         diff = a - borrow;
      if ((diff & 0x0F) > 9) diff -= 6;
      if (diff < 0)          diff -= 0x60;
      borrow = (diff < 0) ? 1 : 0;
      this.writeIram(this.P, diff & 0xFF);
      this.P = (this.P - 1) & 0x7F;
    }
    this.carry = borrow;
    this.P = (this.P - 1) & 0x7F;
  }

  // ─── Main step ───────────────────────────────────────────────────────────
  step() {
    if (this.halted) return 1;

    const opcode = this.fetch8();
    let cycles = 2;

    switch (opcode) {
      // ── LII, LIJ, LIA, LIB ─────────────────────────────────────────────
      case 0x00: this.I = this.fetch8(); cycles=4; break;
      case 0x01: this.J = this.fetch8(); cycles=4; break;
      case 0x02: { const n=this.fetch8(); this.A=n; this.H=n; cycles=4; } break;
      case 0x03: { const n=this.fetch8(); this.B=n; cycles=4; } break;

      // ── IX, IY, DX, DY ──────────────────────────────────────────────────
      case 0x04: { // IX
        this.X = (this.X+1)&0xFFFF; this.DP=this.X; this.Q=5; this.H=this.Xh;
        cycles=6;
      } break;
      case 0x05: { // DX
        this.X = (this.X-1)&0xFFFF; this.DP=this.X; this.Q=5; this.H=this.Xl;
        cycles=6;
      } break;
      case 0x06: { // IY
        this.Y = (this.Y+1)&0xFFFF; this.DP=this.Y; this.Q=7; this.H=this.Yh;
        cycles=6;
      } break;
      case 0x07: { // DY
        this.Y = (this.Y-1)&0xFFFF; this.DP=this.Y; this.Q=7; this.H=this.Yl;
        cycles=6;
      } break;

      // ── MVW, EXW, MVB, EXB ──────────────────────────────────────────────
      case 0x08: { // MVW: (Q)..(Q+I) -> (P)..(P+I)
        for(let i=0;i<=this.I;i++){
          this.writeIram((this.P+i)&0x7F, this.readIram((this.Q+i)&0x7F));
        }
        this.P=(this.P+this.I+1)&0x7F;
        this.Q=(this.Q+this.I+1)&0x7F;
        cycles=5+2*this.I;
      } break;
      case 0x09: { // EXW
        for(let i=0;i<=this.I;i++){
          const t=this.readIram((this.P+i)&0x7F);
          this.writeIram((this.P+i)&0x7F, this.readIram((this.Q+i)&0x7F));
          this.writeIram((this.Q+i)&0x7F, t);
        }
        this.P=(this.P+this.I+1)&0x7F;
        this.Q=(this.Q+this.I+1)&0x7F;
        cycles=6+3*this.I;
      } break;
      case 0x0A: { // MVB: (Q)..(Q+J) -> (P)..(P+J)
        for(let i=0;i<=this.J;i++){
          this.writeIram((this.P+i)&0x7F, this.readIram((this.Q+i)&0x7F));
        }
        this.P=(this.P+this.J+1)&0x7F;
        this.Q=(this.Q+this.J+1)&0x7F;
        cycles=5+2*this.J;
      } break;
      case 0x0B: { // EXB
        for(let i=0;i<=this.J;i++){
          const t=this.readIram((this.P+i)&0x7F);
          this.writeIram((this.P+i)&0x7F, this.readIram((this.Q+i)&0x7F));
          this.writeIram((this.Q+i)&0x7F, t);
        }
        this.P=(this.P+this.J+1)&0x7F;
        this.Q=(this.Q+this.J+1)&0x7F;
        cycles=6+3*this.J;
      } break;

      // ── ADN, SBN, ADW, SBW ──────────────────────────────────────────────
      case 0x0C: { // ADN - BCD add n+1 bytes at P, using A
        this.bcdAdd(this.I);
        cycles=7+3*this.I;
      } break;
      case 0x0D: { // SBN
        this.bcdSub(this.I);
        cycles=7+3*this.I;
      } break;
      case 0x0E: { // ADW - BCD add I+1 bytes (P) + (Q)
        let carry=0;
        for(let i=0;i<=this.I;i++){
          const pa=(this.P-i)&0x7F, qa=(this.Q-i)&0x7F;
          let sum=this.readIram(pa)+this.readIram(qa)+carry;
          if((sum&0xF)>9) sum+=6;
          if((sum>>4)>9)  sum+=0x60;
          carry=(sum>0x99)?1:0;
          this.writeIram(pa,sum&0xFF);
        }
        this.carry=carry;
        this.P=(this.P-this.I-1)&0x7F;
        this.Q=(this.Q-this.I-2)&0x7F;
        cycles=7+3*this.I;
      } break;
      case 0x0F: { // SBW
        let borrow=0;
        for(let i=0;i<=this.I;i++){
          const pa=(this.P-i)&0x7F, qa=(this.Q-i)&0x7F;
          let diff=this.readIram(pa)-this.readIram(qa)-borrow;
          if((diff&0xF)>9) diff-=6;
          if(diff<0) diff-=0x60;
          borrow=(diff<0)?1:0;
          this.writeIram(pa,diff&0xFF);
        }
        this.carry=borrow;
        this.P=(this.P-this.I-1)&0x7F;
        this.Q=(this.Q-this.I-2)&0x7F;
        cycles=7+3*this.I;
      } break;

      // ── LIDP, LIDL ──────────────────────────────────────────────────────
      case 0x10: { // LIDP nm
        const hi=this.fetch8(), lo=this.fetch8();
        this.DP=(hi<<8)|lo; this.H=hi;
        cycles=8;
      } break;
      case 0x11: { // LIDL n
        const n=this.fetch8();
        this.DP=(this.DP&0xFF00)|n; this.H=n;
        cycles=5;
      } break;

      // ── LIP, LIQ ────────────────────────────────────────────────────────
      case 0x12: { const n=this.fetch8(); this.P=n; this.H=0; cycles=4; } break;
      case 0x13: { const n=this.fetch8(); this.Q=n; this.H=n; cycles=4; } break;

      // ── ADB, SBB ────────────────────────────────────────────────────────
      case 0x14: { // ADB
        let r=(this.readIram(this.P)+this.A)&0xFF;
        this.writeIram(this.P,r);
        let r2=(this.readIram((this.P+1)&0x7F)+this.B+this.carry);
        this.carry=(r2>>8)&1; r2&=0xFF;
        this.writeIram((this.P+1)&0x7F,r2);
        this.P=(this.P+1)&0x7F;
        this.setZero(r2);
        cycles=5;
      } break;
      case 0x15: { // SBB
        let r=this.readIram(this.P)-this.A;
        const borrow1=(r<0)?1:0; r&=0xFF;
        this.writeIram(this.P,r);
        let r2=this.readIram((this.P+1)&0x7F)-this.B-borrow1;
        this.carry=(r2<0)?1:0; r2&=0xFF;
        this.writeIram((this.P+1)&0x7F,r2);
        this.P=(this.P+1)&0x7F;
        this.setZero(r2);
        cycles=5;
      } break;

      // ── MVWD, EXWD, MVBD, EXBD ──────────────────────────────────────────
      case 0x18: { // MVWD: (DP)..(DP+I) -> (P)..(P+I)
        for(let i=0;i<=this.I;i++){
          this.writeIram((this.P+i)&0x7F, this.readMem((this.DP+i)&0xFFFF));
        }
        this.P=(this.P+this.I+1)&0x7F;
        this.DP=(this.DP+this.I)&0xFFFF;
        cycles=5+4*this.I;
      } break;
      case 0x19: { // EXWD
        for(let i=0;i<=this.I;i++){
          const t=this.readIram((this.P+i)&0x7F);
          this.writeIram((this.P+i)&0x7F, this.readMem((this.DP+i)&0xFFFF));
          this.writeMem((this.DP+i)&0xFFFF, t);
        }
        this.P=(this.P+this.I+1)&0x7F;
        this.DP=(this.DP+this.I)&0xFFFF;
        cycles=7+6*this.I;
      } break;
      case 0x1A: { // MVBD
        for(let i=0;i<=this.J;i++){
          this.writeIram((this.P+i)&0x7F, this.readMem((this.DP+i)&0xFFFF));
        }
        this.P=(this.P+this.J+1)&0x7F;
        this.DP=(this.DP+this.J)&0xFFFF;
        cycles=5+4*this.J;
      } break;
      case 0x1B: { // EXBD
        for(let i=0;i<=this.J;i++){
          const t=this.readIram((this.P+i)&0x7F);
          this.writeIram((this.P+i)&0x7F, this.readMem((this.DP+i)&0xFFFF));
          this.writeMem((this.DP+i)&0xFFFF, t);
        }
        this.P=(this.P+this.J+1)&0x7F;
        this.DP=(this.DP+this.J)&0xFFFF;
        cycles=7+6*this.J;
      } break;

      // ── SRW, SLW ────────────────────────────────────────────────────────
      case 0x1C: { // SRW: shift right by 4 bits, I+1 bytes
        for(let i=0;i<=this.I;i++){
          const cur=this.readIram((this.P+i)&0x7F);
          const next=(i<this.I)?this.readIram((this.P+i+1)&0x7F):0;
          this.writeIram((this.P+i)&0x7F, ((cur>>4)|(next<<4))&0xFF);
        }
        this.P=(this.P+this.I+1)&0x7F;
        cycles=5+this.I;
      } break;
      case 0x1D: { // SLW: shift left by 4 bits
        for(let i=this.I;i>=0;i--){
          const cur=this.readIram((this.P-i)&0x7F);
          const prev=(i>0)?this.readIram((this.P-i+1)&0x7F):0;
          this.writeIram((this.P-i)&0x7F, ((cur<<4)|(prev>>4))&0xFF);
        }
        this.P=(this.P-this.I-1)&0x7F;
        cycles=5+this.I;
      } break;

      // ── FILM, FILD ──────────────────────────────────────────────────────
      case 0x1E: { // FILM: fill I+1 bytes at P with A
        for(let i=0;i<=this.I;i++){
          this.writeIram(this.P, this.A);
          this.P=(this.P+1)&0x7F;
        }
        this.H=this.A;
        cycles=5+this.I;
      } break;
      case 0x1F: { // FILD: fill I+1 bytes at DP with A
        for(let i=0;i<=this.I;i++){
          this.writeMem(this.DP, this.A);
          this.DP=(this.DP+1)&0xFFFF;
        }
        cycles=4+3*this.I;
      } break;

      // ── LDP, LDQ, LDR ────────────────────────────────────────────────────
      case 0x20: this.A=this.P; cycles=2; break;
      case 0x21: this.A=this.Q; cycles=2; break;
      case 0x22: this.A=this.R; cycles=2; break;
      case 0x23: this.A=0; this.H=0; cycles=2; break; // CLRA

      // ── IXL, IYS, DXL, DYS ──────────────────────────────────────────────
      case 0x24: { // IXL: IX + load A from (DP)
        this.X=(this.X+1)&0xFFFF; this.DP=this.X;
        this.A=this.readMem(this.DP); this.Q=5;
        cycles=7;
      } break;
      case 0x25: { // DXL
        this.X=(this.X-1)&0xFFFF; this.DP=this.X;
        this.A=this.readMem(this.DP); this.Q=5; this.H=this.Xl;
        cycles=7;
      } break;
      case 0x26: { // IYS: IY + store A to (DP)
        this.Y=(this.Y+1)&0xFFFF; this.DP=this.Y;
        this.writeMem(this.DP, this.A); this.Q=7;
        cycles=7;
      } break;
      case 0x27: { // DYS
        this.Y=(this.Y-1)&0xFFFF; this.DP=this.Y;
        this.writeMem(this.DP, this.A); this.Q=7; this.H=this.Yl;
        cycles=7;
      } break;

      // ── JRP, JRM ─────────────────────────────────────────────────────────
      case 0x2C: { const n=this.fetch8(); this.PC=(this.PC+1+n)&0xFFFF; cycles=7; } break;
      case 0x2D: { const n=this.fetch8(); this.PC=(this.PC+1-n)&0xFFFF; cycles=7; } break;

      // ── JRNZP, JRNZM ─────────────────────────────────────────────────────
      case 0x28: { const n=this.fetch8(); if(!this.zero){ this.PC=(this.PC+1+n)&0xFFFF; cycles=7;} else cycles=4; } break;
      case 0x29: { const n=this.fetch8(); if(!this.zero){ this.PC=(this.PC+1-n)&0xFFFF; cycles=7;} else cycles=4; } break;
      case 0x2A: { const n=this.fetch8(); if(!this.carry){ this.PC=(this.PC+1+n)&0xFFFF; cycles=7;} else cycles=4; } break;
      case 0x2B: { const n=this.fetch8(); if(!this.carry){ this.PC=(this.PC+1-n)&0xFFFF; cycles=7;} else cycles=4; } break;
      case 0x2F: { // LOOP: (R)-1 -> (R), if c=0 jump back
        const n=this.fetch8();
        let cnt=this.readIram(this.R)-1;
        this.writeIram(this.R, cnt&0xFF);
        if((cnt&0xFF)!==0 && !this.carry){ this.PC=(this.PC+1-n)&0xFFFF; cycles=10;}
        else { this.carry=0; cycles=7; }
      } break;

      // ── STP, STQ, STR, STH ────────────────────────────────────────────────
      case 0x30: this.P=this.A; this.H=this.A; cycles=2; break;
      case 0x31: this.Q=this.A; this.H=this.A; cycles=2; break;
      case 0x32: this.R=this.A; cycles=2; break;
      case 0x33: this.H=this.A; cycles=2; break; // STH

      // ── PUSH ─────────────────────────────────────────────────────────────
      case 0x34: this.stackPush(this.A); cycles=3; break;

      // ── DATA: read I+1 bytes from internal ROM at BA -> (P) ──────────────
      case 0x35: {
        // For PC-1403, internal ROM is at 0x0000-0x11FF (system area)
        // BA = (B<<8)|A pointer into internal ROM
        const base=(this.B<<8)|this.A;
        for(let i=0;i<=this.I;i++){
          this.writeIram(this.P, this.readMem((base+i)&0xFFFF));
          this.P=(this.P+1)&0x7F;
        }
        cycles=11+4*this.I;
      } break;

      // ── RTN ──────────────────────────────────────────────────────────────
      case 0x37: {
        this.PC=this.popAddr();
        cycles=4;
      } break;

      // ── JRZP, JRZM, JRCM, JRCP ───────────────────────────────────────────
      case 0x38: { const n=this.fetch8(); if(this.zero){ this.PC=(this.PC+1+n)&0xFFFF; cycles=7;} else cycles=4; } break;
      case 0x39: { const n=this.fetch8(); if(this.zero){ this.PC=(this.PC+1-n)&0xFFFF; cycles=7;} else cycles=4; } break;
      case 0x3A: { const n=this.fetch8(); if(this.carry){ this.PC=(this.PC+1+n)&0xFFFF; cycles=7;} else cycles=4; } break;
      case 0x3B: { const n=this.fetch8(); if(this.carry){ this.PC=(this.PC+1-n)&0xFFFF; cycles=7;} else cycles=4; } break;

      // ── INCI, INCJ, INCA, INCB, INCK, INCL, INCM, INCN ─────────────────
      case 0x40: { const r=(this.I+1)&0xFF; this.I=r; this.Q=0; this.setFlags(r); cycles=4; } break;
      case 0x41: { const r=(this.I-1)&0xFF; this.I=r; this.Q=0; this.setFlags(r); cycles=4; } break;
      case 0x42: { const r=(this.A+1)&0xFF; this.A=r; this.Q=2; this.setFlags(r); cycles=4; } break;
      case 0x43: { const r=(this.A-1)&0xFF; this.A=r; this.Q=2; this.setFlags(r); cycles=4; } break;
      case 0x44: { // ADM: (P)+A -> (P)
        const r=this.readIram(this.P)+this.A;
        this.setFlags(r); this.writeIram(this.P,r&0xFF); cycles=3;
      } break;
      case 0x45: { // SBM
        const r=this.readIram(this.P)-this.A;
        this.setFlags(r); this.writeIram(this.P,r&0xFF); cycles=3;
      } break;
      case 0x46: { // ANMA
        const r=this.readIram(this.P)&this.A;
        this.zero=(r===0)?1:0; this.writeIram(this.P,r); cycles=3;
      } break;
      case 0x47: { // ORMA
        const r=this.readIram(this.P)|this.A;
        this.zero=(r===0)?1:0; this.writeIram(this.P,r); cycles=3;
      } break;
      case 0x48: { const r=(this.K+1)&0xFF; this.K=r; this.Q=8; this.setFlags(r); cycles=4; } break;
      case 0x49: { const r=(this.K-1)&0xFF; this.K=r; this.Q=8; this.setFlags(r); cycles=4; } break;
      case 0x4A: { const r=(this.M+1)&0xFF; this.M=r; this.Q=10; this.setFlags(r); cycles=4; } break;
      case 0x4B: { const r=(this.M-1)&0xFF; this.M=r; this.Q=10; this.setFlags(r); cycles=4; } break;
      case 0x4C: { // INA
        this.A=(this.onInA)?this.onInA():this.portIA;
        this.zero=(this.A===0)?1:0; cycles=2;
      } break;
      case 0x4D: cycles=2; break; // NOPW
      case 0x4E: { const n=this.fetch8(); cycles=6+n; } break; // WAIT n
      case 0x4F: cycles=2; break; // CUP (simplified)

      // ── INCP, DECP ───────────────────────────────────────────────────────
      case 0x50: this.P=(this.P+1)&0x7F; cycles=2; break;
      case 0x51: this.P=(this.P-1)&0x7F; cycles=2; break;

      // ── STD, MVDM, MVMP, MVMD, LDD ───────────────────────────────────────
      case 0x52: this.writeMem(this.DP, this.A); cycles=2; break;
      case 0x53: this.writeMem(this.DP, this.readIram(this.P)); cycles=3; break;
      case 0x54: this.writeIram(this.P, this.readMem(this.PC+1)); cycles=3; break; // MVMP
      case 0x55: this.writeIram(this.P, this.readMem(this.DP)); cycles=3; break;   // MVMD
      case 0x56: { // LDPC: A <- (PC+1)
        this.A=this.readMem(this.PC+1); cycles=3;
      } break;
      case 0x57: this.A=this.readMem(this.DP); cycles=3; break; // LDD
      case 0x58: this.A=((this.A>>4)|(this.A<<4))&0xFF; cycles=2; break; // SWP
      case 0x59: this.A=this.readIram(this.P); cycles=2; break; // LDM
      case 0x5A: { // SL: shift left with carry
        const c=(this.A>>7)&1;
        this.A=((this.A<<1)|this.carry)&0xFF;
        this.carry=c; cycles=2;
      } break;
      case 0x5B: { // POP
        this.A=this.stackPop(); cycles=2;
      } break;
      case 0x5D: { // OUTA
        this.portIA=this.readIram(0x5C);
        if(this.onOutA) this.onOutA(this.portIA);
        this.Q=0x5C; cycles=3;
      } break;
      case 0x5F: { // OUTF
        this.portF0=this.readIram(0x5E);
        if(this.onOutF) this.onOutF(this.portF0);
        this.Q=0x5E; cycles=3;
      } break;

      // ── TSIM, ANIM, SBIM, CPIM ───────────────────────────────────────────
      case 0x60: { const n=this.fetch8(); const r=(this.readIram(this.P)&n); this.zero=(r===0)?1:0; this.writeIram(this.P,r); cycles=4; } break; // ANIM
      case 0x61: { const n=this.fetch8(); const r=(this.readIram(this.P)|n); this.zero=(r===0)?1:0; this.writeIram(this.P,r); cycles=4; } break; // ORIM
      case 0x62: { const n=this.fetch8(); this.zero=((this.readIram(this.P)&n)===0)?1:0; cycles=4; } break; // TSIM
      case 0x63: { // CPIM
        const n=this.fetch8(); const r=this.readIram(this.P)-n;
        this.carry=(r<0)?1:0; this.zero=((r&0xFF)===0)?1:0; cycles=4;
      } break;
      case 0x64: { const n=this.fetch8(); const r=(this.A&n)&0xFF; this.zero=(r===0)?1:0; this.A=r; cycles=4; } break; // ANIA
      case 0x65: { const n=this.fetch8(); const r=(this.A|n)&0xFF; this.zero=(r===0)?1:0; this.A=r; cycles=4; } break; // ORIA
      case 0x66: { const n=this.fetch8(); this.zero=((this.A&n)===0)?1:0; cycles=4; } break; // TSIA
      case 0x67: { // CPIA
        const n=this.fetch8(); const r=this.A-n;
        this.carry=(r<0)?1:0; this.zero=((r&0xFF)===0)?1:0; cycles=4;
      } break;

      // ── ADM2 (ADIM), SBIM2 (SBIM) ────────────────────────────────────────
      case 0x70: { const n=this.fetch8(); const r=this.readIram(this.P)+n; this.setFlags(r); this.writeIram(this.P,r&0xFF); cycles=4; } break;
      case 0x71: { const n=this.fetch8(); const r=this.readIram(this.P)-n; this.setFlags(r); this.writeIram(this.P,r&0xFF); cycles=4; } break;
      case 0x74: { const n=this.fetch8(); const r=this.A+n; this.setFlags(r); this.A=r&0xFF; cycles=4; } break; // ADIA
      case 0x75: { const n=this.fetch8(); const r=this.A-n; this.setFlags(r); this.A=r&0xFF; cycles=4; } break; // SBIA

      // ── HALT ─────────────────────────────────────────────────────────────
      case 0x7B: this.halted=true; cycles=1; break;

      // ── JP, CALL, RTN, JPNZ, JPNC, JPZ, JPC ─────────────────────────────
      case 0x79: { this.PC=this.fetch16(); cycles=6; } break;
      case 0x7A: { // PTC (prepare table call)
        const k=this.fetch8();
        const hi=this.fetch8(), lo=this.fetch8();
        const retAddr=((hi<<8)|lo)&0xFFFF;
        this.pushAddr(retAddr);
        this.writeIram(this.R, k);
        cycles=9;
      } break;
      case 0x78: { // CALL nm
        const addr=this.fetch16();
        this.pushAddr(this.PC);
        this.PC=addr; cycles=8;
      } break;
      case 0x7C: { const addr=this.fetch16(); if(!this.zero) this.PC=addr; cycles=6; } break;
      case 0x7D: { const addr=this.fetch16(); if(!this.carry) this.PC=addr; cycles=6; } break;
      case 0x7E: { const addr=this.fetch16(); if(this.zero) this.PC=addr; cycles=6; } break;
      case 0x7F: { const addr=this.fetch16(); if(this.carry) this.PC=addr; cycles=6; } break;

      // ── LP n (short form: 0x80 to 0xBF) ─────────────────────────────────
      // opcodes 0x80..0xBF: LP (P = opcode - 0x80)
      default:
        if (opcode >= 0x80 && opcode <= 0xBF) {
          this.P = opcode - 0x80;
          this.H = opcode;
          cycles = 2;
        }
        // ── CAL nm (short call: 0xE0+n, with next byte as lo address) ───
        else if (opcode >= 0xE0 && opcode <= 0xFF) {
          const lo=this.fetch8();
          const n=opcode&0x1F;
          const addr=(n<<8)|lo;
          this.pushAddr(this.PC);
          this.PC=addr; cycles=7;
        }
        // ── INCB, DECB, INB, OUTB, etc. ─────────────────────────────────
        else switch(opcode) {
          case 0xC0: { const r=(this.J+1)&0xFF; this.J=r; this.Q=1; this.setFlags(r); cycles=4; } break; // INCJ
          case 0xC1: { const r=(this.J-1)&0xFF; this.J=r; this.Q=1; this.setFlags(r); cycles=4; } break; // DECJ
          case 0xC2: { const r=(this.B+1)&0xFF; this.B=r; this.Q=3; this.setFlags(r); cycles=4; } break; // INCB
          case 0xC3: { const r=(this.B-1)&0xFF; this.B=r; this.Q=3; this.setFlags(r); cycles=4; } break; // DECB
          case 0xC4: { const r=this.readIram(this.P)+this.A+this.carry; this.setFlags(r); this.writeIram(this.P,r&0xFF); cycles=3; } break; // ADCM
          case 0xC5: { const r=this.readIram(this.P)-this.A-this.carry; this.setFlags(r); this.writeIram(this.P,r&0xFF); cycles=3; } break; // SBCM
          case 0xC6: { this.zero=((this.readIram(this.P)&this.A)===0)?1:0; cycles=3; } break; // TSMA
          case 0xC7: { const r=this.readIram(this.P)-this.A; this.carry=(r<0)?1:0; this.zero=((r&0xFF)===0)?1:0; cycles=3; } break; // CPMA
          case 0xC8: { const r=(this.L+1)&0xFF; this.L=r; this.Q=9; this.setFlags(r); cycles=4; } break; // INCL
          case 0xC9: { const r=(this.L-1)&0xFF; this.L=r; this.Q=9; this.setFlags(r); cycles=4; } break; // DECL
          case 0xCA: { const r=(this.N+1)&0xFF; this.N=r; this.Q=11; this.setFlags(r); cycles=4; } break; // INCN
          case 0xCB: { const r=(this.N-1)&0xFF; this.N=r; this.Q=11; this.setFlags(r); cycles=4; } break; // DECN
          case 0xCC: cycles=2; break; // NOPW alt
          case 0xCE: cycles=3; break; // NOPT
          case 0xCC: cycles=2; break; // NOPW alt
          case 0xD0: this.carry=1; this.zero=1; cycles=2; break; // SC
          case 0xD1: this.carry=0; this.zero=1; cycles=2; break; // RC
          case 0xD2: { // SR: shift right with carry
            const c=this.A&1;
            this.A=((this.A>>1)|(this.carry<<7))&0xFF;
            this.carry=c; cycles=2;
          } break;
          case 0xD4: { // ANID
            const n=this.fetch8(); const r=this.readMem(this.DP)&n;
            this.writeMem(this.DP,r);
            this.writeIram((this.R-1)&0x7F, r);
            this.zero=(r===0)?1:0; cycles=6;
          } break;
          case 0xD5: { // ORID
            const n=this.fetch8(); const r=this.readMem(this.DP)|n;
            this.writeMem(this.DP,r);
            this.writeIram((this.R-2)&0x7F, r);
            this.zero=(r===0)?1:0; cycles=6;
          } break;
          case 0xD6: { // TSID
            const n=this.fetch8();
            const r=this.readMem(this.DP)&n;
            this.writeIram((this.R-1)&0x7F, this.readMem(this.DP));
            this.zero=(r===0)?1:0; cycles=6;
          } break;
          case 0xD7: { // CPID
            const n=this.fetch8(); const r=this.readMem(this.DP)-n;
            this.carry=(r<0)?1:0; this.zero=((r&0xFF)===0)?1:0; cycles=6;
          } break;
          case 0xD8: { this.writeIram(this.R,0); cycles=2; } break; // LEAVE
          case 0xDA: { const t=this.A; this.A=this.B; this.B=t; cycles=3; } break; // EXAB
          case 0xDB: { const t=this.A; this.A=this.readIram(this.P); this.writeIram(this.P,t); cycles=3; } break; // EXAM
          case 0xDD: { // OUTB
            this.portIB=this.readIram(0x5D);
            if(this.onOutB) this.onOutB(this.portIB);
            this.Q=0x5D; cycles=2;
          } break;
          case 0xDF: { // OUTC
            this.portC=this.readIram(0x5F);
            if(this.onOutC) this.onOutC(this.portC);
            cycles=2;
          } break;
          case 0xCC: { this.A=this.portIB; this.zero=(this.A===0)?1:0; cycles=2; } break; // INB
          // DTC - do table call
          case 0x69: { // DTC
            // compare A against table entries
            let k=this.readIram(this.R); // k from PTC
            let matched=false;
            for(let i=0;i<k;i++){
              const cond=this.readMem(this.PC); this.PC=(this.PC+1)&0xFFFF;
              const hi=this.readMem(this.PC); this.PC=(this.PC+1)&0xFFFF;
              const lo=this.readMem(this.PC); this.PC=(this.PC+1)&0xFFFF;
              if(!matched && this.A===cond){
                const addr=(hi<<8)|lo;
                this.pushAddr(this.PC);
                this.PC=addr;
                matched=true;
              }
            }
            // default entry
            const dhi=this.readMem(this.PC); this.PC=(this.PC+1)&0xFFFF;
            const dlo=this.readMem(this.PC); this.PC=(this.PC+1)&0xFFFF;
            if(!matched){
              const addr=(dhi<<8)|dlo;
              this.pushAddr(this.PC);
              this.PC=addr;
            }
            this.H=this.A;
            this.zero=(k===0)?1:0;
            cycles=5+7*k;
          } break;
          case 0x6B: { // TEST n (test against byte at DP)
            const n=this.fetch8();
            const testByte=this.readMem(this.DP);
            this.zero=((testByte&n)===0)?1:0; cycles=4;
          } break;
          case 0x6F: cycles=2; break; // CDN (simplified - scan input)
          case 0xCC: break; // alt NOPW
          default:
            // Unknown opcode - NOP
            cycles=2;
            break;
        }
        break;
    }

    this.cycles += cycles;
    return cycles;
  }

  // Run for approximately n cycles
  runCycles(n) {
    let ran = 0;
    while (ran < n && !this.halted) {
      ran += this.step();
    }
    return ran;
  }

  reset() {
    this.iram.fill(0);
    this.PC   = 0x0000;
    this.DP   = 0x0000;
    this._P   = 0x00;
    this._Q   = 0x00;
    this._R   = 0x5B;
    this.carry = 0;
    this.zero  = 0;
    this.H     = 0;
    this.cycles= 0;
    this.halted= false;
    this.portIA= 0;
    this.portIB= 0;
    this.portF0= 0;
    this.portC = 0;
  }
}

// Export for module use
if (typeof module !== 'undefined') module.exports = { SC61860 };
