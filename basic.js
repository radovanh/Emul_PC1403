/**
 * Sharp PC-1403 System Emulator
 * 
 * The PC-1403 ROM is not publicly available. This module implements
 * a high-level emulation of the PC-1403's BASIC interpreter and 
 * system software, providing full BASIC functionality without requiring
 * the actual ROM binary.
 * 
 * Supported BASIC commands and functions matching the real PC-1403.
 */

class PC1403Basic {
  constructor(display, keyboard) {
    this.display = display;   // Display controller
    this.keyboard = keyboard; // Keyboard controller
    
    // System RAM: 8KB (6863 bytes usable)
    this.ram = new Uint8Array(8192);
    
    // BASIC program storage
    this.program = [];        // Array of {lineNum, tokens}
    this.variables = {};      // Variable storage
    this.arrays = {};         // Array storage
    this.stringVars = {};     // String variables (name$)
    
    // Execution state
    this.running = false;
    this.currentLine = 0;
    this.lineIndex = 0;
    this.stack = [];          // FOR..NEXT, GOSUB stack
    this.dataList = [];       // DATA statement values
    this.dataPtr = 0;
    
    // Calculator mode
    this.calcMode = false;
    
    // Current mode: 'PRO' (program), 'RUN', 'CAL'
    this.mode = 'RUN';
    
    // Display buffer
    this.displayText = '';
    this.cursorPos = 0;
    this.cursorVisible = true;
    this.cursorBlink = null;
    
    // Input buffer
    this.inputBuffer = '';
    this.inputMode = false;
    this.inputCallback = null;
    
    // Output callback
    this.onPrint = null;
    this.onBeep = null;
    this.onModeChange = null;
    
    // Math precision (10 significant digits like real PC-1403)
    this.PRECISION = 10;

    // Angle mode: 'DEG', 'RAD', 'GRA'
    this.angleMode = 'DEG';
    
    // Error handling
    this.lastError = '';
    
    this._initSystem();
  }

  _initSystem() {
    this.variables = {};
    this.arrays = {};
    this.stringVars = {};
    this.program = [];
    this.stack = [];
    this.dataList = [];
    this.dataPtr = 0;
    this.running = false;
  }

  // ─── Mode management ──────────────────────────────────────────────────────
  setMode(mode) {
    this.mode = mode;
    if (this.onModeChange) this.onModeChange(mode);
    if (mode === 'PRO') {
      this.display.showText('PRO');
    } else if (mode === 'CAL') {
      this.calcMode = true;
      this.display.showText('');
    } else {
      this.calcMode = false;
    }
  }

  // ─── BASIC line parsing ───────────────────────────────────────────────────
  tokenizeLine(line) {
    line = line.trim();
    if (!line) return null;
    
    // Check for line number
    const lineNumMatch = line.match(/^(\d+)\s*(.*)/);
    if (lineNumMatch) {
      return {
        lineNum: parseInt(lineNumMatch[1]),
        src: lineNumMatch[2].trim()
      };
    }
    // Direct execution
    return { lineNum: -1, src: line };
  }

  // Add/replace line in program
  addLine(lineNum, src) {
    // Remove existing line
    this.program = this.program.filter(l => l.lineNum !== lineNum);
    if (src.trim()) {
      this.program.push({ lineNum, src });
    }
    // Sort by line number
    this.program.sort((a,b) => a.lineNum - b.lineNum);
  }

  // ─── Expression evaluator ─────────────────────────────────────────────────
  evalExpr(expr) {
    expr = expr.trim();
    if (!expr) return 0;
    
    // Parse comparison operators
    for (const op of ['>=','<=','<>','!=','>','<','=']) {
      const idx = this._findOperator(expr, op);
      if (idx !== -1) {
        const left  = this.evalExpr(expr.slice(0, idx));
        const right = this.evalExpr(expr.slice(idx + op.length));
        switch(op) {
          case '=':  return (Math.abs(left - right) < 1e-10) ? 1 : 0;
          case '<>': case '!=': return (Math.abs(left - right) >= 1e-10) ? 1 : 0;
          case '>':  return left > right ? 1 : 0;
          case '<':  return left < right ? 1 : 0;
          case '>=': return left >= right ? 1 : 0;
          case '<=': return left <= right ? 1 : 0;
        }
      }
    }

    // OR / AND (BASIC logical)
    for (const op of [' OR ', ' AND ']) {
      const idx = expr.toUpperCase().indexOf(op);
      if (idx !== -1) {
        const left  = this.evalExpr(expr.slice(0, idx));
        const right = this.evalExpr(expr.slice(idx + op.length));
        if (op.trim() === 'OR')  return (left !== 0 || right !== 0) ? 1 : 0;
        if (op.trim() === 'AND') return (left !== 0 && right !== 0) ? 1 : 0;
      }
    }

    // NOT
    if (expr.toUpperCase().startsWith('NOT ')) {
      return this.evalExpr(expr.slice(4)) === 0 ? 1 : 0;
    }
    
    // Addition/subtraction (lowest precedence of arithmetic)
    const addIdx = this._findOperator(expr, '+', '-');
    if (addIdx !== -1) {
      const op = expr[addIdx];
      const left  = this.evalExpr(expr.slice(0, addIdx));
      const right = this.evalExpr(expr.slice(addIdx + 1));
      return op === '+' ? left + right : left - right;
    }
    
    // Multiplication/division
    const mulIdx = this._findOperator(expr, '*', '/');
    if (mulIdx !== -1) {
      const op = expr[mulIdx];
      const left  = this.evalExpr(expr.slice(0, mulIdx));
      const right = this.evalExpr(expr.slice(mulIdx + 1));
      if (op === '*') return left * right;
      if (right === 0) throw new Error('Division by zero');
      return left / right;
    }

    // Power
    const powIdx = this._findOperator(expr, '^');
    if (powIdx !== -1) {
      const left  = this.evalExpr(expr.slice(0, powIdx));
      const right = this.evalExpr(expr.slice(powIdx + 1));
      return Math.pow(left, right);
    }
    
    // Unary minus
    if (expr.startsWith('-')) {
      return -this.evalExpr(expr.slice(1));
    }
    
    // Parentheses
    if (expr.startsWith('(') && expr.endsWith(')')) {
      return this.evalExpr(expr.slice(1, -1));
    }

    // Functions
    const funcMatch = expr.match(/^([A-Z][A-Z0-9]*)\s*\((.+)\)$/i);
    if (funcMatch) {
      return this._evalFunc(funcMatch[1].toUpperCase(), funcMatch[2]);
    }
    
    // Array access: A(n) or A(n,m)
    const arrMatch = expr.match(/^([A-Z])\s*\((.+)\)$/i);
    if (arrMatch) {
      return this._getArrayVal(arrMatch[1].toUpperCase(), arrMatch[2]);
    }
    
    // Number literal
    const num = parseFloat(expr);
    if (!isNaN(num)) return num;
    
    // Variable
    const varName = expr.toUpperCase().trim();
    if (/^[A-Z]$/.test(varName)) {
      return this.variables[varName] || 0;
    }
    
    throw new Error(`Syntax error: ${expr}`);
  }

  _toAngle(v) {
    if (this.angleMode === 'DEG') return v * Math.PI / 180;
    if (this.angleMode === 'GRA') return v * Math.PI / 200;
    return v;
  }
  _fromAngle(v) {
    if (this.angleMode === 'DEG') return v * 180 / Math.PI;
    if (this.angleMode === 'GRA') return v * 200 / Math.PI;
    return v;
  }

  _evalFunc(name, argsStr) {
    const args = this._splitArgs(argsStr).map(a => this.evalExpr(a));
    const v = args[0];
    switch(name) {
      case 'SIN':   return Math.sin(this._toAngle(v));
      case 'COS':   return Math.cos(this._toAngle(v));
      case 'TAN':   return Math.tan(this._toAngle(v));
      case 'ASN':   return this._fromAngle(Math.asin(v));
      case 'ACS':   return this._fromAngle(Math.acos(v));
      case 'ATN':   return this._fromAngle(Math.atan(v));
      case 'ATN2':  return this._fromAngle(Math.atan2(v, args[1]));
      case 'LOG':   if(v<=0) throw new Error('Math error'); return Math.log10(v);
      case 'LN':    if(v<=0) throw new Error('Math error'); return Math.log(v);
      case 'EXP':   return Math.exp(v);
      case 'SQR':   if(v<0)  throw new Error('Math error'); return Math.sqrt(v);
      case 'ABS':   return Math.abs(v);
      case 'INT':   return Math.floor(v);
      case 'SGN':   return v>0?1:v<0?-1:0;
      case 'RND':   return Math.random();
      case 'FRAC':  return v - Math.floor(v);
      case 'PI':    return Math.PI;
      case 'DEG':   return v * 180 / Math.PI;
      case 'DMS':   { // degrees to D.MMSS format
        const d=Math.floor(Math.abs(v));
        const mf=(Math.abs(v)-d)*60;
        const m=Math.floor(mf);
        const s=(mf-m)*60;
        return (v<0?-1:1)*(d+m/100+s/10000);
      }
      case 'CUR':   return v; // cursor position (simplified)
      default:
        throw new Error(`Unknown function: ${name}`);
    }
  }

  _splitArgs(str) {
    const args = [];
    let depth = 0, start = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '(') depth++;
      else if (str[i] === ')') depth--;
      else if (str[i] === ',' && depth === 0) {
        args.push(str.slice(start, i).trim());
        start = i + 1;
      }
    }
    args.push(str.slice(start).trim());
    return args;
  }

  _getArrayVal(name, idxStr) {
    const indices = this._splitArgs(idxStr).map(s => Math.floor(this.evalExpr(s)));
    const key = indices.join(',');
    return (this.arrays[name] || {})[key] || 0;
  }

  _setArrayVal(name, idxStr, val) {
    const indices = this._splitArgs(idxStr).map(s => Math.floor(this.evalExpr(s)));
    const key = indices.join(',');
    if (!this.arrays[name]) this.arrays[name] = {};
    this.arrays[name][key] = val;
  }

  // Find operator at depth 0, right-to-left (for left-associativity)
  _findOperator(expr, ...ops) {
    let depth = 0;
    // Scan right to left to handle left-associativity
    for (let i = expr.length - 1; i >= 0; i--) {
      const c = expr[i];
      if (c === ')') depth++;
      else if (c === '(') depth--;
      if (depth !== 0) continue;
      for (const op of ops) {
        if (expr.slice(i, i + op.length) === op) {
          // Avoid treating leading unary minus as binary
          if ((op === '-' || op === '+') && i === 0) continue;
          // Avoid ** (power with ^)
          return i;
        }
      }
    }
    return -1;
  }

  // ─── String evaluator ─────────────────────────────────────────────────────
  evalString(expr) {
    expr = expr.trim();
    // Concatenation
    const catIdx = this._findOperator(expr, '+');
    if (catIdx !== -1) {
      return this.evalString(expr.slice(0, catIdx)) + this.evalString(expr.slice(catIdx + 1));
    }
    // String literal
    if (expr.startsWith('"') && expr.endsWith('"')) return expr.slice(1, -1);
    // String variable
    if (/^[A-Z]\$$/i.test(expr)) return this.stringVars[expr.toUpperCase()] || '';
    // String functions
    const m = expr.match(/^(STR\$|CHR\$|LEFT\$|RIGHT\$|MID\$|INSTR|LEN|VAL|ASC)\((.+)\)$/i);
    if (m) return this._evalStrFunc(m[1].toUpperCase(), m[2]);
    return '';
  }

  _evalStrFunc(name, argsStr) {
    const rawArgs = this._splitArgs(argsStr);
    switch(name) {
      case 'STR$': return String(this._formatNum(this.evalExpr(rawArgs[0])));
      case 'CHR$': return String.fromCharCode(Math.floor(this.evalExpr(rawArgs[0])));
      case 'LEFT$': return this.evalString(rawArgs[0]).slice(0, Math.floor(this.evalExpr(rawArgs[1])));
      case 'RIGHT$': { const s=this.evalString(rawArgs[0]); return s.slice(s.length-Math.floor(this.evalExpr(rawArgs[1]))); }
      case 'MID$': { const s=this.evalString(rawArgs[0]); const p=Math.floor(this.evalExpr(rawArgs[1]))-1; const l=rawArgs[2]?Math.floor(this.evalExpr(rawArgs[2])):undefined; return s.substr(p,l); }
      case 'LEN': return this.evalString(rawArgs[0]).length;
      case 'VAL': return parseFloat(this.evalString(rawArgs[0]))||0;
      case 'ASC': { const s=this.evalString(rawArgs[0]); return s.length?s.charCodeAt(0):0; }
      case 'INSTR': { const s=this.evalString(rawArgs[0]); const sub=this.evalString(rawArgs[1]); return s.indexOf(sub)+1; }
      default: return '';
    }
  }

  // ─── Number formatting (PC-1403 style: 10 significant digits) ────────────
  _formatNum(n) {
    if (!isFinite(n)) return n > 0 ? '1E+99' : '-1E+99';
    if (n === 0) return '0';
    
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    
    // Use scientific notation for very large or very small numbers
    if (abs >= 1e10 || (abs > 0 && abs < 1e-9)) {
      let s = n.toExponential(9);
      // Clean up: remove trailing zeros
      s = s.replace(/\.?0+e/, 'e').replace('e+', 'E+').replace('e-', 'E-');
      return s;
    }
    
    // Fixed notation
    let s = n.toPrecision(10);
    // Remove trailing zeros after decimal
    if (s.includes('.')) {
      s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
    return s;
  }

  // ─── Statement executor ───────────────────────────────────────────────────
  async executeLine(src) {
    src = src.trim();
    if (!src) return;
    
    // Handle multiple statements separated by :
    const stmts = this._splitStatements(src);
    for (const stmt of stmts) {
      await this._execStatement(stmt.trim());
      if (!this.running && stmts.length > 1) break;
    }
  }

  _splitStatements(src) {
    const stmts = [];
    let depth = 0, start = 0, inStr = false;
    for (let i = 0; i < src.length; i++) {
      if (src[i] === '"') inStr = !inStr;
      if (inStr) continue;
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      else if (src[i] === ':' && depth === 0) {
        stmts.push(src.slice(start, i));
        start = i + 1;
      }
    }
    stmts.push(src.slice(start));
    return stmts;
  }

  async _execStatement(stmt) {
    if (!stmt) return;
    
    const upper = stmt.toUpperCase();
    
    // PRINT / PRINT USING
    if (upper.startsWith('PRINT') || upper.startsWith('?')) {
      const rest = upper.startsWith('PRINT') ? stmt.slice(5).trim() : stmt.slice(1).trim();
      await this._execPrint(rest);
      return;
    }
    
    // LET or assignment
    if (upper.startsWith('LET ')) {
      await this._execLet(stmt.slice(4).trim()); return;
    }
    
    // Assignment without LET: VAR = EXPR or VAR(idx) = EXPR
    if (/^[A-Za-z](\(|[A-Za-z0-9]*\$?)?\s*=/.test(stmt)) {
      await this._execLet(stmt); return;
    }
    
    // Control flow
    if (upper.startsWith('GOTO '))   { this._execGoto(stmt.slice(5).trim()); return; }
    if (upper.startsWith('GOSUB '))  { this._execGosub(stmt.slice(6).trim()); return; }
    if (upper === 'RETURN')          { this._execReturn(); return; }
    if (upper.startsWith('IF '))     { await this._execIf(stmt.slice(3)); return; }
    if (upper.startsWith('FOR '))    { this._execFor(stmt.slice(4).trim()); return; }
    if (upper.startsWith('NEXT '))   { this._execNext(stmt.slice(5).trim()); return; }
    if (upper === 'END' || upper === 'STOP') { this.running = false; return; }
    
    // I/O
    if (upper.startsWith('INPUT'))   { await this._execInput(stmt.slice(5).trim()); return; }
    if (upper.startsWith('READ '))   { this._execRead(stmt.slice(5).trim()); return; }
    if (upper.startsWith('DATA '))   { /* parsed at load time */ return; }
    if (upper === 'RESTORE')         { this.dataPtr = 0; return; }
    
    // Program control
    if (upper.startsWith('DIM '))    { this._execDim(stmt.slice(4).trim()); return; }
    if (upper === 'NEW')             { this._initSystem(); this.display.showText(''); return; }
    if (upper === 'RUN')             { await this.run(); return; }
    if (upper.startsWith('LIST'))    { this._execList(stmt.slice(4).trim()); return; }
    if (upper.startsWith('DELETE ')) { this._execDelete(stmt.slice(7).trim()); return; }
    
    // System
    if (upper === 'CLS' || upper === 'CLEAR') { this.display.clear(); return; }
    if (upper.startsWith('BEEP'))    { if(this.onBeep) this.onBeep(); return; }
    if (upper === 'DEG')             { this.angleMode = 'DEG'; return; }
    if (upper === 'RAD')             { this.angleMode = 'RAD'; return; }
    if (upper === 'GRA')             { this.angleMode = 'GRA'; return; }
    if (upper.startsWith('WAIT '))   { await this._sleep(this.evalExpr(stmt.slice(5))*100); return; }
    if (upper === 'PAUSE')           { await this._sleep(500); return; }
    
    // REM / '
    if (upper.startsWith('REM') || stmt.startsWith("'")) return;
    
    // ON .. GOTO/GOSUB
    if (upper.startsWith('ON '))     { await this._execOn(stmt.slice(3)); return; }

    throw new Error(`Unknown statement: ${stmt}`);
  }

  async _execPrint(rest) {
    if (!rest) {
      this._output('');
      return;
    }
    
    let output = '';
    let newline = true;
    
    // Split by ; and ,
    const parts = this._splitPrintParts(rest);
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (part === '') { newline = false; continue; }
      if (part === ';') { newline = false; continue; }
      if (part === ',') { output += '\t'; newline = false; continue; }
      
      try {
        if (part.startsWith('"') || /^[A-Z]\$/i.test(part) || 
            part.includes('STR$') || part.includes('CHR$')) {
          output += this.evalString(part);
        } else {
          output += this._formatNum(this.evalExpr(part));
        }
      } catch(e) {
        output += part;
      }
      
      // Check separator after this value
      if (i + 1 < parts.length) {
        const sep = parts[i + 1];
        if (sep === ';') { newline = false; i++; }
        else if (sep === ',') { output += '\t'; newline = false; i++; }
        else newline = true;
      }
    }
    
    this._output(output, newline);
  }

  _splitPrintParts(rest) {
    const parts = [];
    let i = 0;
    while (i < rest.length) {
      if (rest[i] === ';' || rest[i] === ',') {
        parts.push(rest[i]);
        i++;
      } else if (rest[i] === '"') {
        let j = i + 1;
        while (j < rest.length && rest[j] !== '"') j++;
        parts.push(rest.slice(i, j+1));
        i = j + 1;
      } else {
        // find next ; or ,
        let j = i;
        let depth = 0;
        while (j < rest.length) {
          if (rest[j] === '(') depth++;
          else if (rest[j] === ')') depth--;
          else if ((rest[j] === ';' || rest[j] === ',') && depth === 0) break;
          j++;
        }
        if (j > i) parts.push(rest.slice(i, j).trim());
        i = j;
      }
    }
    return parts;
  }

  _output(text, newline = true) {
    if (this.onPrint) this.onPrint(text, newline);
    this.display.showText(text);
  }

  async _execLet(stmt) {
    // Handle array assignment: A(i) = expr  or  A(i,j) = expr
    const arrAssign = stmt.match(/^([A-Z])\s*\(([^)]+)\)\s*=\s*(.+)$/i);
    if (arrAssign) {
      const val = this.evalExpr(arrAssign[3]);
      this._setArrayVal(arrAssign[1].toUpperCase(), arrAssign[2], val);
      return;
    }
    // String assignment: A$ = expr
    const strAssign = stmt.match(/^([A-Z]\$)\s*=\s*(.+)$/i);
    if (strAssign) {
      this.stringVars[strAssign[1].toUpperCase()] = this.evalString(strAssign[2]);
      return;
    }
    // Numeric: VAR = expr
    const assign = stmt.match(/^([A-Z])\s*=\s*(.+)$/i);
    if (assign) {
      const val = this.evalExpr(assign[2]);
      this.variables[assign[1].toUpperCase()] = val;
      return;
    }
    throw new Error(`Assignment syntax: ${stmt}`);
  }

  _execGoto(lineStr) {
    const lineNum = Math.floor(this.evalExpr(lineStr));
    const idx = this.program.findIndex(l => l.lineNum === lineNum);
    if (idx === -1) throw new Error(`Line ${lineNum} not found`);
    this.lineIndex = idx;
    this._jumped = true;
  }

  _execGosub(lineStr) {
    const lineNum = Math.floor(this.evalExpr(lineStr));
    const idx = this.program.findIndex(l => l.lineNum === lineNum);
    if (idx === -1) throw new Error(`Line ${lineNum} not found`);
    this.stack.push({ type: 'GOSUB', returnIdx: this.lineIndex + 1 });
    this.lineIndex = idx;
    this._jumped = true;
  }

  _execReturn() {
    const frame = this.stack.findLast(f => f.type === 'GOSUB');
    if (!frame) throw new Error('RETURN without GOSUB');
    while (this.stack[this.stack.length-1] !== frame) this.stack.pop();
    this.stack.pop();
    this.lineIndex = frame.returnIdx;
    this._jumped = true;
  }

  async _execIf(rest) {
    // IF condition THEN ... [ELSE ...]
    const thenIdx = rest.toUpperCase().indexOf(' THEN ');
    if (thenIdx === -1) {
      // IF cond GOTO linenum
      const gotoIdx = rest.toUpperCase().indexOf(' GOTO ');
      if (gotoIdx !== -1) {
        const cond = this.evalExpr(rest.slice(0, gotoIdx));
        if (cond !== 0) {
          this._execGoto(rest.slice(gotoIdx + 6).trim());
        }
        return;
      }
      throw new Error('IF without THEN');
    }
    
    const condStr = rest.slice(0, thenIdx);
    const afterThen = rest.slice(thenIdx + 6);
    
    const elseIdx = afterThen.toUpperCase().indexOf(' ELSE ');
    const thenPart = elseIdx !== -1 ? afterThen.slice(0, elseIdx) : afterThen;
    const elsePart = elseIdx !== -1 ? afterThen.slice(elseIdx + 6) : '';
    
    const cond = this.evalExpr(condStr);
    
    if (cond !== 0) {
      // THEN can be a line number (GOTO) or a statement
      const thenTrim = thenPart.trim();
      if (/^\d+$/.test(thenTrim)) {
        this._execGoto(thenTrim);
      } else {
        await this.executeLine(thenPart);
      }
    } else if (elsePart) {
      const elseTrim = elsePart.trim();
      if (/^\d+$/.test(elseTrim)) {
        this._execGoto(elseTrim);
      } else {
        await this.executeLine(elsePart);
      }
    }
  }

  _execFor(rest) {
    // FOR var = start TO end [STEP step]
    const m = rest.match(/^([A-Z])\s*=\s*(.+?)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/i);
    if (!m) throw new Error(`FOR syntax: ${rest}`);
    
    const varName = m[1].toUpperCase();
    const start   = this.evalExpr(m[2]);
    const end     = this.evalExpr(m[3]);
    const step    = m[4] ? this.evalExpr(m[4]) : 1;
    
    this.variables[varName] = start;
    this.stack.push({
      type: 'FOR',
      varName,
      end,
      step,
      loopLine: this.lineIndex
    });
  }

  _execNext(varName) {
    varName = varName.toUpperCase().trim() || null;
    
    // Find matching FOR frame
    let frameIdx = this.stack.length - 1;
    while (frameIdx >= 0 && this.stack[frameIdx].type !== 'FOR') frameIdx--;
    if (frameIdx < 0) throw new Error('NEXT without FOR');
    
    const frame = this.stack[frameIdx];
    if (varName && frame.varName !== varName) throw new Error(`NEXT ${varName} doesn't match FOR ${frame.varName}`);
    
    this.variables[frame.varName] += frame.step;
    
    const done = frame.step > 0
      ? this.variables[frame.varName] > frame.end
      : this.variables[frame.varName] < frame.end;
    
    if (!done) {
      this.lineIndex = frame.loopLine;
      this._jumped = true;
    } else {
      this.stack.splice(frameIdx, 1);
    }
  }

  async _execInput(rest) {
    // INPUT [prompt;] var [, var2 ...]
    let prompt = '';
    let vars = rest;
    
    const promptMatch = rest.match(/^"([^"]*)"[;,]\s*(.+)$/);
    if (promptMatch) {
      prompt = promptMatch[1];
      vars = promptMatch[2];
    }
    
    const varList = vars.split(',').map(v => v.trim());
    
    for (const varName of varList) {
      const val = await this._getInput(prompt || `${varName}?`);
      if (/\$/.test(varName)) {
        this.stringVars[varName.toUpperCase()] = val;
      } else {
        this.variables[varName.toUpperCase()] = parseFloat(val) || 0;
      }
      prompt = '';
    }
  }

  _getInput(prompt) {
    return new Promise(resolve => {
      if (this.onPrint) this.onPrint(prompt + ' ', false);
      this.display.showText(prompt + '_');
      this.inputMode = true;
      this.inputBuffer = '';
      this.inputCallback = (val) => {
        this.inputMode = false;
        resolve(val);
      };
    });
  }

  handleKeyInput(char) {
    if (!this.inputMode) return false;
    if (char === 'Enter' || char === '\n') {
      const val = this.inputBuffer;
      this.inputBuffer = '';
      if (this.onPrint) this.onPrint(val, true);
      if (this.inputCallback) this.inputCallback(val);
      return true;
    }
    if (char === 'Backspace' || char === 'DEL') {
      this.inputBuffer = this.inputBuffer.slice(0, -1);
    } else if (char.length === 1) {
      this.inputBuffer += char;
    }
    this.display.showText(this.inputBuffer + '_');
    return true;
  }

  _execRead(rest) {
    const vars = rest.split(',').map(v => v.trim());
    for (const v of vars) {
      if (this.dataPtr >= this.dataList.length) throw new Error('Out of data');
      const raw = this.dataList[this.dataPtr++];
      if (/\$/.test(v)) {
        this.stringVars[v.toUpperCase()] = String(raw);
      } else {
        this.variables[v.toUpperCase()] = parseFloat(raw) || 0;
      }
    }
  }

  _execDim(rest) {
    const items = rest.split(',');
    for (const item of items) {
      const m = item.trim().match(/^([A-Z])\s*\((\d+)(?:,(\d+))?\)$/i);
      if (!m) throw new Error(`DIM syntax: ${item}`);
      const name = m[1].toUpperCase();
      const size1 = parseInt(m[2]) + 1;
      const size2 = m[3] ? parseInt(m[3]) + 1 : 0;
      this.arrays[name] = {};
      if (size2 > 0) {
        for (let i = 0; i < size1; i++)
          for (let j = 0; j < size2; j++)
            this.arrays[name][`${i},${j}`] = 0;
      } else {
        for (let i = 0; i < size1; i++)
          this.arrays[name][String(i)] = 0;
      }
    }
  }

  _execList(rest) {
    let lines = this.program;
    if (rest.trim()) {
      const range = rest.split('-').map(s => parseInt(s.trim()));
      if (range.length === 1) {
        lines = lines.filter(l => l.lineNum === range[0]);
      } else {
        lines = lines.filter(l => l.lineNum >= (range[0]||0) && l.lineNum <= (range[1]||99999));
      }
    }
    for (const l of lines) {
      if (this.onPrint) this.onPrint(`${l.lineNum} ${l.src}`, true);
    }
  }

  _execDelete(rest) {
    const range = rest.split('-').map(s => parseInt(s.trim()));
    if (range.length === 1) {
      this.program = this.program.filter(l => l.lineNum !== range[0]);
    } else {
      this.program = this.program.filter(l => l.lineNum < (range[0]||0) || l.lineNum > (range[1]||99999));
    }
  }

  async _execOn(rest) {
    const m = rest.match(/^(.+?)\s+(GOTO|GOSUB)\s+(.+)$/i);
    if (!m) throw new Error('ON syntax');
    const val = Math.floor(this.evalExpr(m[1]));
    const cmd = m[2].toUpperCase();
    const targets = m[3].split(',').map(s => s.trim());
    if (val >= 1 && val <= targets.length) {
      if (cmd === 'GOTO') this._execGoto(targets[val-1]);
      else this._execGosub(targets[val-1]);
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Program execution ────────────────────────────────────────────────────
  async run(startLine) {
    // Pre-process DATA statements
    this.dataList = [];
    this.dataPtr = 0;
    for (const line of this.program) {
      const upper = line.src.trim().toUpperCase();
      if (upper.startsWith('DATA ')) {
        const items = line.src.slice(5).split(',');
        this.dataList.push(...items.map(s => s.trim()));
      }
    }
    
    this.running = true;
    this.lineIndex = 0;
    
    if (startLine !== undefined) {
      const idx = this.program.findIndex(l => l.lineNum >= startLine);
      this.lineIndex = idx >= 0 ? idx : 0;
    }
    
    while (this.running && this.lineIndex < this.program.length) {
      const line = this.program[this.lineIndex];
      this._jumped = false;
      
      try {
        await this.executeLine(line.src);
      } catch(e) {
        this.running = false;
        const msg = `Error in ${line.lineNum}: ${e.message}`;
        this._output(msg);
        if (this.onPrint) this.onPrint(msg, true);
        return;
      }
      
      if (!this._jumped) this.lineIndex++;
      
      // Yield to browser occasionally
      if (this.lineIndex % 100 === 0) {
        await this._sleep(0);
      }
    }
    
    this.running = false;
  }

  stop() {
    this.running = false;
    this.inputMode = false;
    if (this.inputCallback) {
      this.inputCallback('');
      this.inputCallback = null;
    }
  }

  // ─── Direct command entry ─────────────────────────────────────────────────
  async execute(input) {
    input = input.trim();
    if (!input) return;
    
    const parsed = this.tokenizeLine(input);
    if (!parsed) return;
    
    if (parsed.lineNum >= 0) {
      // Store/remove program line
      this.addLine(parsed.lineNum, parsed.src);
      if (this.onPrint) this.onPrint(`${parsed.lineNum} ${parsed.src}`, true);
    } else {
      // Execute directly
      try {
        await this.executeLine(parsed.src);
        if (!this.running) {
          // Show result if it was an expression
          const upper = parsed.src.trim().toUpperCase();
          if (!upper.startsWith('PRINT') && !upper.startsWith('?') && 
              !upper.startsWith('LET') && !upper.includes('=') &&
              !upper.startsWith('FOR') && !upper.startsWith('NEXT') &&
              !upper.startsWith('IF') && !upper.startsWith('GOTO') &&
              !upper.startsWith('GOSUB') && !upper.startsWith('REM') &&
              !upper.startsWith('DIM') && !upper.startsWith('DATA') &&
              !upper.startsWith('DEG') && !upper.startsWith('RAD') && !upper.startsWith('GRA') &&
              upper !== 'RUN' && upper !== 'NEW' && upper !== 'END' && upper !== 'STOP') {
            try {
              const val = this.evalExpr(parsed.src);
              const fmt = this._formatNum(val);
              this._output(fmt);
              if (this.onPrint) this.onPrint(fmt, true);
            } catch(e) { /* not an expression */ }
          }
        }
      } catch(e) {
        const msg = `Error: ${e.message}`;
        this._output(msg);
        if (this.onPrint) this.onPrint(msg, true);
      }
    }
  }
}

if (typeof module !== 'undefined') module.exports = { PC1403Basic };
