/**
 * Sharp PC-1403 Display Controller
 * 24-character LCD display with 5×7 dot matrix characters
 */
class PC1403Display {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.text = '';
    this.indicators = {
      DEG: false, RAD: false, GRA: false,
      RUN: false, PRO: false, SHIFT: false,
      HYP: false, M: false, E: false, DE: false
    };
    this.cursorPos = -1;
    this.blinkState = true;
    
    // LCD green color scheme
    this.LCD_BG = '#8BAC0F';
    this.LCD_DARK = '#0F380F';
    this.LCD_MED = '#306230';
    
    this._setupCanvas();
    this._startBlink();
  }

  _setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    // Use a safe default if the element has no layout yet
    const w = this.canvas.clientWidth || this.canvas.width || 400;
    const h = 56;
    this.canvas.width  = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(1,0,0,1,0,0);
    this.ctx.scale(dpr, dpr);
    this.W = w;
    this.H = h;
    this.render();
  }

  _startBlink() {
    setInterval(() => {
      this.blinkState = !this.blinkState;
      this.render();
    }, 500);
  }

  showText(text) {
    this.text = String(text).slice(0, 24);
    this.render();
  }

  setIndicator(name, val) {
    this.indicators[name] = val;
    this.render();
  }

  setCursor(pos) {
    this.cursorPos = pos;
    this.render();
  }

  clear() {
    this.text = '';
    this.render();
  }

  render() {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    
    // Background
    ctx.fillStyle = this.LCD_BG;
    ctx.fillRect(0, 0, W, H);
    
    // Subtle scanline effect
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    for (let y = 0; y < H; y += 2) {
      ctx.fillRect(0, y, W, 1);
    }

    // Draw indicators at top
    this._drawIndicators(ctx, W);
    
    // Character area
    const charAreaTop = 18;
    const charH = H - charAreaTop - 4;
    const charW = Math.floor((W - 20) / 24);
    const startX = 10;
    
    for (let i = 0; i < 24; i++) {
      const x = startX + i * charW;
      const ch = this.text[i] || ' ';
      const isCursor = (i === this.cursorPos && this.blinkState);
      this._drawChar(ctx, ch, x, charAreaTop, charW, charH, isCursor);
    }
  }

  _drawIndicators(ctx, W) {
    const indicators = [
      { name: 'DEG', x: 10 },
      { name: 'RAD', x: 42 },
      { name: 'GRA', x: 74 },
      { name: 'SHIFT', x: 115, label: 'S' },
      { name: 'HYP', x: 145 },
      { name: 'M', x: 185 },
      { name: 'E', x: W - 50 },
      { name: 'RUN', x: W - 80 },
      { name: 'PRO', x: W - 115 },
    ];
    
    ctx.font = 'bold 8px "Courier New", monospace';
    for (const ind of indicators) {
      const active = this.indicators[ind.name];
      ctx.fillStyle = active ? this.LCD_DARK : this.LCD_MED;
      ctx.globalAlpha = active ? 1 : 0.3;
      ctx.fillText(ind.label || ind.name, ind.x, 11);
    }
    ctx.globalAlpha = 1;
  }

  _drawChar(ctx, ch, x, y, w, h, cursor) {
    // Background for cursor
    if (cursor) {
      ctx.fillStyle = this.LCD_DARK;
      ctx.fillRect(x, y, w - 1, h);
    }
    
    const bitmap = CHAR_BITMAPS[ch] || CHAR_BITMAPS[' '];
    const pixW = Math.floor(w / 6);
    const pixH = Math.floor(h / 8);
    const offX = Math.floor((w - 5*pixW) / 2);
    const offY = Math.floor((h - 7*pixH) / 2);
    
    for (let row = 0; row < 7; row++) {
      const rowData = bitmap[row] || 0;
      for (let col = 0; col < 5; col++) {
        const on = (rowData >> (4 - col)) & 1;
        if (on) {
          ctx.fillStyle = cursor ? this.LCD_BG : this.LCD_DARK;
          ctx.fillRect(x + offX + col*pixW, y + offY + row*pixH, pixW, pixH);
        } else if (!cursor) {
          // Draw dim dots for LCD look
          ctx.fillStyle = 'rgba(15,56,15,0.15)';
          ctx.fillRect(x + offX + col*pixW + Math.floor(pixW/4), 
                       y + offY + row*pixH + Math.floor(pixH/4), 
                       Math.max(1, pixW/2), Math.max(1, pixH/2));
        }
      }
    }
  }
}

// 5×7 character bitmaps (rows, each row is 5 bits)
const CHAR_BITMAPS = {
  ' ': [0,0,0,0,0,0,0],
  '0': [0b01110,0b10001,0b10011,0b10101,0b11001,0b10001,0b01110],
  '1': [0b00100,0b01100,0b00100,0b00100,0b00100,0b00100,0b01110],
  '2': [0b01110,0b10001,0b00001,0b00010,0b00100,0b01000,0b11111],
  '3': [0b11111,0b00010,0b00100,0b00010,0b00001,0b10001,0b01110],
  '4': [0b00010,0b00110,0b01010,0b10010,0b11111,0b00010,0b00010],
  '5': [0b11111,0b10000,0b11110,0b00001,0b00001,0b10001,0b01110],
  '6': [0b00110,0b01000,0b10000,0b11110,0b10001,0b10001,0b01110],
  '7': [0b11111,0b00001,0b00010,0b00100,0b01000,0b01000,0b01000],
  '8': [0b01110,0b10001,0b10001,0b01110,0b10001,0b10001,0b01110],
  '9': [0b01110,0b10001,0b10001,0b01111,0b00001,0b00010,0b01100],
  'A': [0b01110,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
  'B': [0b11110,0b10001,0b10001,0b11110,0b10001,0b10001,0b11110],
  'C': [0b01110,0b10001,0b10000,0b10000,0b10000,0b10001,0b01110],
  'D': [0b11110,0b10001,0b10001,0b10001,0b10001,0b10001,0b11110],
  'E': [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b11111],
  'F': [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b10000],
  'G': [0b01110,0b10001,0b10000,0b10111,0b10001,0b10001,0b01111],
  'H': [0b10001,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
  'I': [0b01110,0b00100,0b00100,0b00100,0b00100,0b00100,0b01110],
  'J': [0b00111,0b00010,0b00010,0b00010,0b00010,0b10010,0b01100],
  'K': [0b10001,0b10010,0b10100,0b11000,0b10100,0b10010,0b10001],
  'L': [0b10000,0b10000,0b10000,0b10000,0b10000,0b10000,0b11111],
  'M': [0b10001,0b11011,0b10101,0b10001,0b10001,0b10001,0b10001],
  'N': [0b10001,0b11001,0b10101,0b10011,0b10001,0b10001,0b10001],
  'O': [0b01110,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
  'P': [0b11110,0b10001,0b10001,0b11110,0b10000,0b10000,0b10000],
  'Q': [0b01110,0b10001,0b10001,0b10001,0b10101,0b10010,0b01101],
  'R': [0b11110,0b10001,0b10001,0b11110,0b10100,0b10010,0b10001],
  'S': [0b01110,0b10001,0b10000,0b01110,0b00001,0b10001,0b01110],
  'T': [0b11111,0b00100,0b00100,0b00100,0b00100,0b00100,0b00100],
  'U': [0b10001,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
  'V': [0b10001,0b10001,0b10001,0b10001,0b10001,0b01010,0b00100],
  'W': [0b10001,0b10001,0b10001,0b10101,0b10101,0b11011,0b10001],
  'X': [0b10001,0b10001,0b01010,0b00100,0b01010,0b10001,0b10001],
  'Y': [0b10001,0b10001,0b01010,0b00100,0b00100,0b00100,0b00100],
  'Z': [0b11111,0b00001,0b00010,0b00100,0b01000,0b10000,0b11111],
  'a': [0b00000,0b01110,0b00001,0b01111,0b10001,0b10011,0b01101],
  'b': [0b10000,0b10000,0b11110,0b10001,0b10001,0b10001,0b11110],
  'c': [0b00000,0b01110,0b10001,0b10000,0b10000,0b10001,0b01110],
  'd': [0b00001,0b00001,0b01111,0b10001,0b10001,0b10001,0b01111],
  'e': [0b00000,0b01110,0b10001,0b11111,0b10000,0b10000,0b01110],
  'f': [0b00110,0b01000,0b11110,0b01000,0b01000,0b01000,0b01000],
  'g': [0b00000,0b01111,0b10001,0b10001,0b01111,0b00001,0b01110],
  'h': [0b10000,0b10000,0b11110,0b10001,0b10001,0b10001,0b10001],
  'i': [0b00100,0b00000,0b01100,0b00100,0b00100,0b00100,0b01110],
  'j': [0b00010,0b00000,0b00110,0b00010,0b00010,0b10010,0b01100],
  'k': [0b10000,0b10000,0b10010,0b10100,0b11000,0b10100,0b10010],
  'l': [0b01100,0b00100,0b00100,0b00100,0b00100,0b00100,0b01110],
  'm': [0b00000,0b11010,0b10101,0b10101,0b10001,0b10001,0b10001],
  'n': [0b00000,0b11110,0b10001,0b10001,0b10001,0b10001,0b10001],
  'o': [0b00000,0b01110,0b10001,0b10001,0b10001,0b10001,0b01110],
  'p': [0b00000,0b11110,0b10001,0b10001,0b11110,0b10000,0b10000],
  'q': [0b00000,0b01111,0b10001,0b10001,0b01111,0b00001,0b00001],
  'r': [0b00000,0b01110,0b10001,0b10000,0b10000,0b10000,0b10000],
  's': [0b00000,0b01111,0b10000,0b01110,0b00001,0b10001,0b01110],
  't': [0b01000,0b01000,0b11110,0b01000,0b01000,0b01001,0b00110],
  'u': [0b00000,0b10001,0b10001,0b10001,0b10001,0b10011,0b01101],
  'v': [0b00000,0b10001,0b10001,0b10001,0b01010,0b01010,0b00100],
  'w': [0b00000,0b10001,0b10001,0b10101,0b10101,0b01010,0b01010],
  'x': [0b00000,0b10001,0b01010,0b00100,0b01010,0b10001,0b00000],
  'y': [0b00000,0b10001,0b10001,0b01111,0b00001,0b10001,0b01110],
  'z': [0b00000,0b11111,0b00010,0b00100,0b01000,0b10000,0b11111],
  '+': [0b00000,0b00100,0b00100,0b11111,0b00100,0b00100,0b00000],
  '-': [0b00000,0b00000,0b00000,0b11111,0b00000,0b00000,0b00000],
  '*': [0b00000,0b10101,0b01110,0b11111,0b01110,0b10101,0b00000],
  '/': [0b00001,0b00001,0b00010,0b00100,0b01000,0b10000,0b10000],
  '=': [0b00000,0b00000,0b11111,0b00000,0b11111,0b00000,0b00000],
  '<': [0b00010,0b00100,0b01000,0b10000,0b01000,0b00100,0b00010],
  '>': [0b01000,0b00100,0b00010,0b00001,0b00010,0b00100,0b01000],
  '.': [0b00000,0b00000,0b00000,0b00000,0b00000,0b01100,0b01100],
  ',': [0b00000,0b00000,0b00000,0b00000,0b00110,0b00100,0b01000],
  '!': [0b00100,0b00100,0b00100,0b00100,0b00000,0b00100,0b00100],
  '?': [0b01110,0b10001,0b00001,0b00110,0b00100,0b00000,0b00100],
  '(': [0b00010,0b00100,0b01000,0b01000,0b01000,0b00100,0b00010],
  ')': [0b01000,0b00100,0b00010,0b00010,0b00010,0b00100,0b01000],
  '[': [0b01110,0b01000,0b01000,0b01000,0b01000,0b01000,0b01110],
  ']': [0b01110,0b00010,0b00010,0b00010,0b00010,0b00010,0b01110],
  '_': [0b00000,0b00000,0b00000,0b00000,0b00000,0b00000,0b11111],
  '$': [0b00100,0b01111,0b10100,0b01110,0b00101,0b11110,0b00100],
  '%': [0b11000,0b11001,0b00010,0b00100,0b01000,0b10011,0b00011],
  '^': [0b00100,0b01010,0b10001,0b00000,0b00000,0b00000,0b00000],
  ':': [0b00000,0b01100,0b01100,0b00000,0b01100,0b01100,0b00000],
  ';': [0b00000,0b01100,0b01100,0b00000,0b01100,0b00100,0b01000],
  '#': [0b01010,0b01010,0b11111,0b01010,0b11111,0b01010,0b01010],
  '@': [0b01110,0b10001,0b10001,0b10111,0b10110,0b10000,0b01110],
  '"': [0b01010,0b01010,0b00000,0b00000,0b00000,0b00000,0b00000],
  "'": [0b00100,0b00100,0b00000,0b00000,0b00000,0b00000,0b00000],
  '`': [0b01000,0b00100,0b00000,0b00000,0b00000,0b00000,0b00000],
  '~': [0b00000,0b01101,0b10110,0b00000,0b00000,0b00000,0b00000],
  '|': [0b00100,0b00100,0b00100,0b00100,0b00100,0b00100,0b00100],
  '\\': [0b10000,0b10000,0b01000,0b00100,0b00010,0b00001,0b00001],
  '{': [0b00110,0b00100,0b00100,0b01000,0b00100,0b00100,0b00110],
  '}': [0b01100,0b00100,0b00100,0b00010,0b00100,0b00100,0b01100],
  'E': [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b11111],
};

// ─── Keyboard Layout ───────────────────────────────────────────────────────
// PC-1403 keyboard layout
const PC1403_KEYS = [
  // Row 0
  [
    { id:'OFF',   label:'OFF',   w:1, cls:'key-sys' },
    { id:'MODE',  label:'MODE',  w:1, cls:'key-sys' },
    { id:'SHIFT', label:'SHIFT', w:1, cls:'key-shift' },
    { id:'DEF',   label:'DEF',   w:1, cls:'key-func' },
    { id:'CTL',   label:'CTL',   w:1, cls:'key-func' },
  ],
  // Row 1
  [
    { id:'CALC',  label:'CAL',   w:1, cls:'key-sys',  sub:'RUN' },
    { id:'DEG',   label:'DEG',   w:1, cls:'key-func', sub:'HYP' },
    { id:'SIN',   label:'SIN',   w:1, cls:'key-func', sub:'ASN' },
    { id:'COS',   label:'COS',   w:1, cls:'key-func', sub:'ACS' },
    { id:'TAN',   label:'TAN',   w:1, cls:'key-func', sub:'ATN' },
  ],
  // Row 2
  [
    { id:'M+',    label:'M+',    w:1, cls:'key-func', sub:'M-' },
    { id:'LOG',   label:'log',   w:1, cls:'key-func', sub:'10x' },
    { id:'LN',    label:'ln',    w:1, cls:'key-func', sub:'ex' },
    { id:'SQR',   label:'√',     w:1, cls:'key-func', sub:'x²' },
    { id:'POW',   label:'xʸ',    w:1, cls:'key-func', sub:'ʸ√x' },
  ],
  // Row 3
  [
    { id:'MR',    label:'MR',    w:1, cls:'key-func', sub:'MC' },
    { id:'PAREN_L', label:'(',   w:1, cls:'key-num' },
    { id:'PAREN_R', label:')',   w:1, cls:'key-num' },
    { id:'REC',   label:'→r,θ', w:1, cls:'key-func', sub:'→x,y' },
    { id:'EXP',   label:'EXP',   w:1, cls:'key-num', sub:'π' },
  ],
  // Row 4
  [
    { id:'BS',    label:'DEL',   w:1, cls:'key-edit' },
    { id:'7',     label:'7',     w:1, cls:'key-num',  sub:'&' },
    { id:'8',     label:'8',     w:1, cls:'key-num',  sub:'\'' },
    { id:'9',     label:'9',     w:1, cls:'key-num',  sub:'(' },
    { id:'DIV',   label:'÷',     w:1, cls:'key-op' },
  ],
  // Row 5
  [
    { id:'CLS',   label:'CLS',   w:1, cls:'key-edit' },
    { id:'4',     label:'4',     w:1, cls:'key-num',  sub:'$' },
    { id:'5',     label:'5',     w:1, cls:'key-num',  sub:'%' },
    { id:'6',     label:'6',     w:1, cls:'key-num',  sub:')' },
    { id:'MUL',   label:'×',     w:1, cls:'key-op' },
  ],
  // Row 6
  [
    { id:'INS',   label:'INS',   w:1, cls:'key-edit' },
    { id:'1',     label:'1',     w:1, cls:'key-num',  sub:'!' },
    { id:'2',     label:'2',     w:1, cls:'key-num',  sub:'"' },
    { id:'3',     label:'3',     w:1, cls:'key-num',  sub:'#' },
    { id:'SUB',   label:'-',     w:1, cls:'key-op' },
  ],
  // Row 7
  [
    { id:'ENTER', label:'ENT',   w:1, cls:'key-enter' },
    { id:'0',     label:'0',     w:1, cls:'key-num',  sub:'@' },
    { id:'DOT',   label:'.',     w:1, cls:'key-num',  sub:',' },
    { id:'NEG',   label:'+/-',   w:1, cls:'key-num',  sub:'=' },
    { id:'ADD',   label:'+',     w:1, cls:'key-op' },
  ],
];

class PC1403Keyboard {
  constructor(container, onKey) {
    this.container = container;
    this.onKey = onKey;
    this.shiftActive = false;
    this._build();
  }

  _build() {
    this.container.innerHTML = '';
    this.container.className = 'keyboard';
    
    for (const row of PC1403_KEYS) {
      const rowEl = document.createElement('div');
      rowEl.className = 'key-row';
      
      for (const key of row) {
        const btn = document.createElement('button');
        btn.className = `key ${key.cls || ''}`;
        btn.dataset.keyId = key.id;
        
        const mainLabel = document.createElement('span');
        mainLabel.className = 'key-main';
        mainLabel.textContent = key.label;
        btn.appendChild(mainLabel);
        
        if (key.sub) {
          const subLabel = document.createElement('span');
          subLabel.className = 'key-sub';
          subLabel.textContent = key.sub;
          btn.appendChild(subLabel);
        }
        
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this._handleKey(key.id, key);
        });
        
        // Touch support
        btn.addEventListener('touchstart', (e) => {
          e.preventDefault();
          btn.classList.add('pressed');
        }, { passive: false });
        btn.addEventListener('touchend', (e) => {
          e.preventDefault();
          btn.classList.remove('pressed');
          this._handleKey(key.id, key);
        }, { passive: false });
        
        rowEl.appendChild(btn);
      }
      this.container.appendChild(rowEl);
    }
  }

  _handleKey(id, key) {
    if (id === 'SHIFT') {
      this.shiftActive = !this.shiftActive;
      this.container.classList.toggle('shifted', this.shiftActive);
      return;
    }
    
    const isShifted = this.shiftActive;
    if (isShifted) {
      this.shiftActive = false;
      this.container.classList.remove('shifted');
    }
    
    if (this.onKey) this.onKey(id, isShifted, key);
  }

  setShift(val) {
    this.shiftActive = val;
    this.container.classList.toggle('shifted', val);
  }
}

if (typeof module !== 'undefined') module.exports = { PC1403Display, PC1403Keyboard, CHAR_BITMAPS };
