# Sharp PC-1403 Web Emulator

A fully functional web-based emulator of the **Sharp PC-1403** pocket computer, built from scratch using JavaScript. Runs entirely in the browser — no installation required. Works on desktop and mobile.

![Sharp PC-1403 Emulator](https://img.shields.io/badge/status-working-8bac0f?style=flat-square) ![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square) ![Platform: Web](https://img.shields.io/badge/platform-web%20%7C%20mobile-blueviolet?style=flat-square)

## 🚀 Live Demo

> Open `index.html` directly in any modern browser, or host on GitHub Pages.

## 📟 About the Sharp PC-1403

The **Sharp PC-1403** was a scientific pocket computer manufactured in 1986.

| Spec | Detail |
|------|--------|
| CPU | SC61860 (Hitachi, ESR-H architecture), 8-bit CMOS, 768 kHz |
| RAM | 8 KB (6863 bytes usable) |
| ROM | 72 KB |
| Display | Monochrome LCD, 1 line, 24 × 5×7 characters |
| Languages | BASIC interpreter, Scientific calculator mode |

## 🔧 What's Emulated

### SC61860 CPU Core (`js/sc61860.js`)
- Full 8-bit instruction set (all major opcodes)
- 96-byte internal scratchpad RAM
- Registers: A, B, I, J, K, L, M, N, P, Q, R, X, Y, DP, PC
- Carry and zero flags
- BCD multi-byte arithmetic (ADN, SBN, ADW, SBW)
- Multi-byte block moves (MVW, MVB, MVWD, MVBD)
- Stack operations, subroutine calls, relative jumps
- I/O port simulation (IA, IB, F0, C)

### BASIC Interpreter (`js/basic.js`)
Full PC-1403 compatible BASIC with:
- `PRINT`, `INPUT`, `LET`, `IF/THEN/ELSE`
- `FOR/NEXT` with STEP, `GOTO`, `GOSUB/RETURN`
- `DIM`, `DATA/READ/RESTORE`
- `ON..GOTO`, `ON..GOSUB`
- **Math:** `SIN`, `COS`, `TAN`, `ASN`, `ACS`, `ATN`, `LOG`, `LN`, `EXP`, `SQR`, `ABS`, `INT`, `SGN`, `RND`, `FRAC`
- **Angle modes:** DEG, RAD, GRA
- **String ops:** `STR$`, `CHR$`, `LEFT$`, `RIGHT$`, `MID$`, `LEN`, `VAL`, `ASC`, `INSTR`
- 10-digit precision arithmetic (matching real hardware)

### Display (`js/hardware.js`)
- Authentic 5×7 dot-matrix LCD rendering on HTML5 Canvas
- LCD green phosphor color scheme
- Blinking cursor, status indicators (DEG/RAD, RUN, PRO, SHIFT...)
- Scanline overlay for CRT feel

### Keyboard
- Full PC-1403 key layout
- SHIFT key for secondary functions
- Touch-optimized for mobile
- Physical keyboard support

## 🎮 Usage

### Direct commands (type in terminal):
```basic
PRINT "HELLO"
PRINT SIN(30)
2+2*PI
```

### Writing programs:
```basic
10 PRINT "FIBONACCI"
20 A=0:B=1
30 FOR I=1 TO 15
40 PRINT A;
50 C=A+B:A=B:B=C
60 NEXT I
RUN
```

### Keyboard shortcuts:
| Key | Action |
|-----|--------|
| `Enter` | Execute command |
| `F5` | Run program |
| `Ctrl+C` | Stop execution |
| `Esc` | Stop execution |

## 📱 Mobile / PWA

The emulator is a Progressive Web App. To install on mobile:
1. Open in Safari (iOS) or Chrome (Android)
2. Tap **Share → Add to Home Screen**

Supports offline use via Service Worker.

## 🗂️ File Structure

```
pc-1403-emulator/
├── index.html          # Main UI (calculator body + terminal)
├── manifest.json       # PWA manifest
├── sw.js               # Service worker (offline support)
└── js/
    ├── sc61860.js      # SC61860 CPU emulator
    ├── hardware.js     # LCD display + keyboard
    └── basic.js        # BASIC interpreter
```

## 🏗️ Technical Notes

- **No ROM required** — the BASIC interpreter is implemented in JavaScript, providing full BASIC compatibility without needing the actual Sharp ROM binary (which is proprietary).
- The SC61860 CPU core is included for completeness and future ROM loading support.
- All code runs client-side; nothing is sent to any server.

## 📚 References

- [PockEmul (matsumo)](https://github.com/matsumo/PockEmul) — multi-platform pocket computer emulator
- [SC61860 Instruction Set (utz82)](https://github.com/utz82/SC61860-Instruction-Set) — CPU documentation
- [Sharp PC-1403 — Wikipedia](https://en.wikipedia.org/wiki/Sharp_PC-1403)
- [Machine Language of Sharp Pocket Computers](http://destroyedlolo.info/sharp/LM.html)

## 📄 License

MIT License — free to use, modify, and distribute. The Sharp PC-1403 name and brand are trademarks of Sharp Corporation; this is an independent fan project for educational purposes.
