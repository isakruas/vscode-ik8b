const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

class IkError extends Error {
  constructor(message, line, col) {
    super(message);
    this.line = Math.max(0, line || 0);
    this.col = Math.max(0, col || 0);
  }
}

function isIdentStart(ch) {
  return /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch) {
  return /[A-Za-z0-9_./]/.test(ch);
}

function tokenize(text) {
  const tokens = [];
  let i = 0;
  let line = 0;
  let col = 0;

  const keywords = new Set(['import', 'namespace', 'const', 'mut', 'imut', 'ram', 'eeprom', 'flash', 'return', 'loop', 'switch', 'true', 'false']);
  const types = new Set(['u8', 'u16', 'void']);

  function push(kind, value, tokLine = line, tokCol = col) {
    tokens.push({ kind, value, line: tokLine, col: tokCol });
  }

  function peek(n = 0) {
    return text[i + n] || '';
  }

  function advance() {
    const ch = text[i++] || '';
    if (ch === '\n') {
      line += 1;
      col = 0;
    } else {
      col += 1;
    }
    return ch;
  }

  const multi = ['->+', '->-', '->&', '->|', '->^', '->', '..', '==', '!=', '<=', '>=', '&&', '||'];
  const single = new Set(['{', '}', '(', ')', '[', ']', ',', ':', '?', '*', '+', '-', '/', '%', '&', '|', '^', '~', '!', '<', '>', '=']);

  while (i < text.length) {
    const ch = peek();

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      advance();
      continue;
    }

    if (ch === '#') {
      while (i < text.length && peek() !== '\n') advance();
      continue;
    }

    if (ch === '\'') {
      const l = line;
      const c = col;
      advance();
      if (i >= text.length || peek() === '\n') {
        throw new IkError('Unterminated character literal', l, c);
      }
      if (peek() === '\\') {
        advance();
        const esc = peek();
        if (!'nrt0\\\''.includes(esc)) {
          throw new IkError(`Invalid character escape \\${esc}`, line, col);
        }
        advance();
      } else {
        advance();
      }
      if (peek() !== '\'') {
        throw new IkError('Character literal must contain exactly one character', l, c);
      }
      advance();
      push('char', 'char', l, c);
      continue;
    }

    let matched = false;
    for (const op of multi) {
      if (text.startsWith(op, i)) {
        push('sym', op);
        for (let k = 0; k < op.length; k += 1) advance();
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (single.has(ch)) {
      push('sym', ch);
      advance();
      continue;
    }

    if (ch === '@' || ch === '$' || ch === '%' || isIdentStart(ch)) {
      const l = line;
      const c = col;
      let s = '';
      s += advance();
      while (isIdentPart(peek())) s += advance();

      if (types.has(s)) {
        push('type', s, l, c);
      } else if (keywords.has(s)) {
        push('kw', s, l, c);
      } else {
        push('id', s, l, c);
      }
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const l = line;
      const c = col;
      let s = '';
      if (ch === '0' && (peek(1) === 'x' || peek(1) === 'X')) {
        s += advance();
        s += advance();
        if (!/[0-9A-Fa-f]/.test(peek())) {
          throw new IkError('Invalid hexadecimal literal', l, c);
        }
        while (/[0-9A-Fa-f]/.test(peek())) s += advance();
      } else {
        while (/[0-9]/.test(peek())) s += advance();
      }
      push('num', s, l, c);
      continue;
    }

    throw new IkError(`Unexpected character '${ch}'`, line, col);
  }

  push('eof', '<eof>', line, col);
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.t = tokens;
    this.i = 0;
  }

  p(n = 0) { return this.t[this.i + n]; }
  at(kind, value = undefined) {
    const tok = this.p();
    if (!tok) return false;
    if (tok.kind !== kind) return false;
    if (value !== undefined && tok.value !== value) return false;
    return true;
  }
  take() { return this.t[this.i++]; }
  expect(kind, value = undefined, msg = 'Unexpected token') {
    const tok = this.p();
    if (!this.at(kind, value)) {
      throw new IkError(`${msg}. Got '${tok ? tok.value : 'EOF'}'`, tok ? tok.line : 0, tok ? tok.col : 0);
    }
    return this.take();
  }

  parseProgram() {
    while (!this.at('eof')) this.parseTopLevel();
  }

  parseTopLevel() {
    if (this.at('kw', 'import')) return this.parseImport();
    if (this.at('kw', 'namespace')) return this.parseNamespace();
    if (this.at('kw', 'const')) return this.parseConst();
    if (this.at('sym', '?')) return this.parseCompileTimeConditional();
    if (this.at('id') && this.p().value.startsWith('@')) return this.parseFunction();
    const tok = this.p();
    throw new IkError('Expected top-level declaration (import, namespace, const or function)', tok.line, tok.col);
  }

  parseImport() {
    this.expect('kw', 'import');
    this.expect('id', undefined, 'Expected import path');
  }

  parseNamespace() {
    this.expect('kw', 'namespace');
    this.expect('id', undefined, 'Expected namespace identifier');
  }

  parseConst() {
    this.expect('kw', 'const');
    const id = this.expect('id', undefined, 'Expected register constant name');
    if (!id.value.startsWith('%')) throw new IkError('Constant name must start with %', id.line, id.col);
    this.expect('sym', ':', 'Expected :');
    this.expect('type', undefined, 'Expected type');
    this.expect('sym', '=', 'Expected =');
    this.expect('num', undefined, 'Expected number literal');
  }

  parseCompileTimeConditional() {
    this.expect('sym', '?');
    this.expect('kw', 'namespace', "Expected 'namespace' in compile-time condition");
    this.expect('sym', '==', 'Expected ==');
    this.expect('id', undefined, 'Expected namespace identifier');
    this.parseTopLevelBlock();
  }

  parseTopLevelBlock() {
    this.expect('sym', '{', 'Expected {');
    while (!this.at('sym', '}')) this.parseTopLevel();
    this.expect('sym', '}', 'Expected }');
  }

  parseFunction() {
    const fn = this.expect('id', undefined, 'Expected function name');
    if (!fn.value.startsWith('@')) throw new IkError('Function name must start with @', fn.line, fn.col);

    if (this.at('sym', '(')) {
      this.take();
      if (!this.at('sym', ')')) {
        while (true) {
          const p = this.expect('id', undefined, 'Expected parameter name');
          if (!p.value.startsWith('$')) throw new IkError('Parameter must start with $', p.line, p.col);
          this.expect('sym', ':', 'Expected : in parameter');
          this.expect('type', undefined, 'Expected parameter type');
          if (this.at('sym', ',')) {
            this.take();
            continue;
          }
          break;
        }
      }
      this.expect('sym', ')', 'Expected )');
    }

    if (this.at('sym', '->')) {
      this.take();
      this.expect('type', undefined, 'Expected return type');
    }

    this.parseBlock();
  }

  parseBlock() {
    this.expect('sym', '{', 'Expected {');
    while (!this.at('sym', '}')) this.parseStatement();
    this.expect('sym', '}', 'Expected }');
  }

  parseStatement() {
    if (this.at('kw', 'ram') || this.at('kw', 'eeprom') || this.at('kw', 'flash')) {
      return this.parseVarDecl();
    }
    if (this.at('kw', 'mut') || this.at('kw', 'imut')) {
      const tok = this.take();
      throw new IkError(`Syntax Error: Variable declarations must explicitly specify a storage location (ram, eeprom, or flash) before the mutability specifier`, tok.line, tok.col);
    }
    if (this.at('kw', 'loop')) return this.parseLoop();
    if (this.at('kw', 'switch')) return this.parseSwitch();
    if (this.at('kw', 'return')) return this.parseReturn();
    if (this.at('sym', '?')) return this.parseIf();

    this.parseExpr();
    if (this.at('sym', '->') || this.at('sym', '->+') || this.at('sym', '->-') || this.at('sym', '->&') || this.at('sym', '->|') || this.at('sym', '->^')) {
      this.take();
      this.parseExpr();
    }
  }

  parseVarDecl() {
    const storage = this.take(); // ram, eeprom, flash
    const mutability = this.expect('kw', undefined, 'Expected mutability specifier (mut or imut)');
    if (mutability.value !== 'mut' && mutability.value !== 'imut') {
      throw new IkError(`Expected mutability specifier (mut or imut) after ${storage.value}`, mutability.line, mutability.col);
    }
    if (storage.value === 'flash' && mutability.value === 'mut') {
      throw new IkError(`flash variables must be immutable: flash imut expected`, storage.line, storage.col);
    }
    const v = this.expect('id', undefined, 'Expected variable name');
    if (!v.value.startsWith('$')) throw new IkError('Variable must start with $', v.line, v.col);
    this.expect('sym', ':', 'Expected :');
    this.expect('type', undefined, 'Expected type');
    if (this.at('sym', '[')) {
      this.take();
      this.expect('num', undefined, 'Expected array size number');
      this.expect('sym', ']', 'Expected ]');
    }
    this.expect('sym', '=', 'Expected =');
    this.parseExpr();
  }

  parseLoop() {
    this.expect('kw', 'loop');
    if (this.at('sym', '*')) {
      this.take();
      this.parseBlock();
      return;
    }
    this.parseExpr();
    this.expect('sym', '..', 'Expected .. in range loop');
    this.parseExpr();
    this.expect('sym', '->', 'Expected -> in range loop');
    const v = this.expect('id', undefined, 'Expected loop variable');
    if (!v.value.startsWith('$')) throw new IkError('Loop variable must start with $', v.line, v.col);
    this.parseBlock();
  }

  parseSwitch() {
    this.expect('kw', 'switch');
    this.parseExpr();
    this.expect('sym', '{', 'Expected {');
    while (!this.at('sym', '}')) {
      if (this.at('sym', '*')) {
        this.take();
        this.expect('sym', '->', 'Expected -> after *');
        this.parseBlock();
      } else {
        this.parseExpr();
        this.expect('sym', '->', 'Expected -> in case branch');
        this.parseBlock();
      }
    }
    this.expect('sym', '}', 'Expected }');
  }

  parseReturn() {
    this.expect('kw', 'return');
    // `return` without value is valid; only parse expression when the next token
    // can actually start one.
    if (this.canStartExpr()) {
      this.parseExpr();
    }
  }

  parseIf() {
    this.expect('sym', '?');
    this.parseExpr();
    this.parseBlock();
    if (this.at('sym', ':')) {
      this.take();
      this.parseBlock();
    }
  }

  parseExpr() { this.parseLogicalOr(); }
  canStartExpr() {
    return (
      this.at('num') ||
      this.at('char') ||
      this.at('kw', 'true') ||
      this.at('kw', 'false') ||
      this.at('id') ||
      this.at('sym', '(') ||
      this.at('sym', '!') ||
      this.at('sym', '~') ||
      this.at('sym', '-')
    );
  }
  parseLogicalOr() {
    this.parseLogicalAnd();
    while (this.at('sym', '||')) { this.take(); this.parseLogicalAnd(); }
  }
  parseLogicalAnd() {
    this.parseBitOr();
    while (this.at('sym', '&&')) { this.take(); this.parseBitOr(); }
  }
  parseBitOr() {
    this.parseBitXor();
    while (this.at('sym', '|')) { this.take(); this.parseBitXor(); }
  }
  parseBitXor() {
    this.parseBitAnd();
    while (this.at('sym', '^')) { this.take(); this.parseBitAnd(); }
  }
  parseBitAnd() {
    this.parseEquality();
    while (this.at('sym', '&')) { this.take(); this.parseEquality(); }
  }
  parseEquality() {
    this.parseRel();
    while (this.at('sym', '==') || this.at('sym', '!=')) { this.take(); this.parseRel(); }
  }
  parseRel() {
    this.parseAdd();
    while (this.at('sym', '<') || this.at('sym', '>') || this.at('sym', '<=') || this.at('sym', '>=')) { this.take(); this.parseAdd(); }
  }
  parseAdd() {
    this.parseMul();
    while (this.at('sym', '+') || this.at('sym', '-')) { this.take(); this.parseMul(); }
  }
  parseMul() {
    this.parseUnary();
    while (this.at('sym', '*') || this.at('sym', '/') || this.at('sym', '%')) { this.take(); this.parseUnary(); }
  }
  parseUnary() {
    if (this.at('sym', '!') || this.at('sym', '~') || this.at('sym', '-')) {
      this.take();
      this.parseUnary();
      return;
    }
    this.parsePrimary();
  }

  parsePrimary() {
    if (this.at('num') || this.at('char')) {
      this.take();
      return;
    }
    if (this.at('kw', 'true') || this.at('kw', 'false')) {
      this.take();
      return;
    }
    if (this.at('id')) {
      const id = this.take();
      if (id.value.startsWith('@') && this.at('sym', '(')) {
        this.take();
        if (!this.at('sym', ')')) {
          while (true) {
            this.parseExpr();
            if (this.at('sym', ',')) {
              this.take();
              continue;
            }
            break;
          }
        }
        this.expect('sym', ')', 'Expected ) after call');
        return;
      }
      if (this.at('sym', '[')) {
        this.take();
        this.parseExpr();
        this.expect('sym', ']', 'Expected ] after index');
      }
      return;
    }
    if (this.at('sym', '(')) {
      this.take();
      this.parseExpr();
      this.expect('sym', ')', 'Expected )');
      return;
    }
    const tok = this.p();
    throw new IkError(`Unexpected token '${tok.value}' in expression`, tok.line, tok.col);
  }
}

function createDiagnostic(doc, line, col, message, severity = vscode.DiagnosticSeverity.Error) {
  const safeLine = Math.max(0, Math.min(line, Math.max(0, doc.lineCount - 1)));
  const safeCol = Math.max(0, col);
  const p = new vscode.Position(safeLine, safeCol);
  const range = new vscode.Range(p, p);
  const d = new vscode.Diagnostic(range, message, severity);
  d.source = 'ik8b';
  return d;
}

function parseLineFromCompilerError(message) {
  const m = message.match(/at line\s+(\d+)/i);
  if (!m) return 0;
  const n = Number.parseInt(m[1], 10);
  if (Number.isNaN(n) || n <= 0) return 0;
  return n - 1;
}

function resolveCompilerPath(doc) {
  const cfg = vscode.workspace.getConfiguration('ik8b', doc.uri);
  const configured = cfg.get('compilerPath', '');
  if (configured && typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim();
  }
  const ws = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (ws) return path.join(ws.uri.fsPath, 'ik8b');
  return 'ik8b';
}

function runCompilerValidation(doc, diagnostics) {
  const cfg = vscode.workspace.getConfiguration('ik8b', doc.uri);
  const enabled = cfg.get('enableCompilerDiagnostics', false);
  if (!enabled) return;

  const compilerPath = resolveCompilerPath(doc);
  const sourceText = doc.getText();
  const base = path.basename(doc.uri.fsPath || 'untitled', '.ik') || 'untitled';
  const tmpIn = path.join(os.tmpdir(), `ik8b_lint_${process.pid}_${base}_${Date.now()}.ik`);
  const tmpOut = path.join(os.tmpdir(), `ik8b_lint_${process.pid}_${Date.now()}.hex`);

  try {
    fs.writeFileSync(tmpIn, sourceText, 'utf8');
    const res = cp.spawnSync(compilerPath, [tmpIn, '-o', tmpOut], { encoding: 'utf8', timeout: 6000 });
    if (res.error) {
      diagnostics.push(createDiagnostic(doc, 0, 0, `Compiler invocation failed: ${res.error.message}`, vscode.DiagnosticSeverity.Warning));
    } else if (res.status !== 0) {
      const msg = `${res.stderr || res.stdout || 'Unknown compiler error'}`.trim();
      diagnostics.push(createDiagnostic(doc, parseLineFromCompilerError(msg), 0, msg));
    }
  } finally {
    try { fs.unlinkSync(tmpIn); } catch (_) {}
    try { fs.unlinkSync(tmpOut); } catch (_) {}
  }
}

const intrinsicsDoc = {
  'nop': '**Intrinsic @nop()**\n\nNo operation. Emits a physical `NOP` instruction. Consumes 1 clock cycle.',
  'sleep': '**Intrinsic @sleep()**\n\nEnter sleep mode. Emits `SLEEP` to shut down the CPU or peripherals based on MCU settings.',
  'wdr': '**Intrinsic @wdr()**\n\nWatchdog Reset. Emits `WDR` to reset the watchdog timer and prevent automatic watchdog reset.',
  'break': '**Intrinsic @break()**\n\nOn-chip debug break. Emits `BREAK` to halt execution on debugger-equipped hardware.',
  'reti': '**Intrinsic @reti()**\n\nReturn from Interrupt. Emits `RETI` to return from an ISR and re-enable global interrupts.',
  'lpm': '**Intrinsic @lpm()**\n\nLoad Program Memory. Emits `LPM` to read a byte from program Flash memory using Z pointer.',
  'elpm': '**Intrinsic @elpm()**\n\nExtended Load Program Memory. Emits `ELPM` for MCUs with >64KB flash to read using Z and RAMPZ.',
  'spm': '**Intrinsic @spm()**\n\nStore Program Memory. Emits `SPM` to write page/words into program Flash.',
  'ijmp': '**Intrinsic @ijmp()**\n\nIndirect Jump. Emits `IJMP` to perform a jump to the instruction address loaded in register Z.',
  'icall': '**Intrinsic @icall()**\n\nIndirect Call. Emits `ICALL` to call a function address loaded in register Z.',
  'movw': '**Intrinsic @movw()**\n\nMove Word. Emits `MOVW` to copy a 16-bit register pair efficiently in 1 clock cycle.',
  'mul': '**Intrinsic @mul()**\n\nMultiply unsigned. Emits `MUL` to multiply two 8-bit values and place the 16-bit product in R0:R1.',
  'muls': '**Intrinsic @muls()**\n\nMultiply signed. Emits `MULS` to multiply two signed 8-bit values.',
  'mulsu': '**Intrinsic @mulsu()**\n\nMultiply signed with unsigned. Emits `MULSU` to multiply signed and unsigned 8-bit values.'
};

const keywordsDoc = {
  'ram': '**ram** storage space specifier\n\nAllocates the variable in Static RAM (SRAM) for normal runtime read/write operations.',
  'eeprom': '**eeprom** storage space specifier\n\nAllocates the variable in persistent, electrically-erasable read-write non-volatile memory (EEPROM) that survives power cycles.',
  'flash': '**flash** storage space specifier\n\nAllocates the variable as a read-only constant directly in program Flash memory.',
  'mut': '**mut** mutability specifier\n\nDeclares a mutable variable that can be reassigned or updated during program execution.',
  'imut': '**imut** mutability specifier\n\nDeclares an immutable variable (constant) whose value is computed at compile-time and cannot be changed.',
  'const': '**const** keyword\n\nDeclares a compile-time alias for registers (e.g. `const %PORTB: u16 = 0x0025`).',
  'import': '**import** keyword\n\nImports a standard library or external module (e.g., `import std/gpio`).',
  'namespace': '**namespace** keyword\n\nSets the active compilation target namespace or evaluates target-specific conditional blocks.',
  'loop': '**loop** keyword\n\nDeclares loops, including infinite loops (`loop *`) and range loops (`loop 0..10 -> $i`).',
  'switch': '**switch** keyword\n\nDeclares multi-way branch selection switches.'
};

class IkHoverProvider {
  provideHover(document, position, token) {
    const range = document.getWordRangeAtPosition(position, /[A-Za-z0-9_@$%#.-]+/);
    if (!range) return null;
    const word = document.getText(range);

    if (word.startsWith('@')) {
      const name = word.slice(1);
      if (intrinsicsDoc[name]) {
        return new vscode.Hover(new vscode.MarkdownString(intrinsicsDoc[name]));
      }
    }

    if (keywordsDoc[word]) {
      return new vscode.Hover(new vscode.MarkdownString(keywordsDoc[word]));
    }

    if (word.startsWith('%')) {
      return new vscode.Hover(new vscode.MarkdownString(`**Hardware Register Access: \`${word}\`**\n\nRepresents direct memory-mapped microchip/AVR control register at this address.`));
    }

    return null;
  }
}

class IkDocumentSymbolProvider {
  provideDocumentSymbols(document, token) {
    const symbols = [];
    try {
      const text = document.getText();
      const tokens = tokenize(text);
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok.kind === 'kw' && tok.value === 'namespace') {
          const next = tokens[i + 1];
          if (next && next.kind === 'id') {
            const range = new vscode.Range(tok.line, tok.col, next.line, next.col + next.value.length);
            symbols.push(new vscode.DocumentSymbol(
              next.value,
              'namespace',
              vscode.SymbolKind.Namespace,
              range,
              range
            ));
          }
        } else if (tok.kind === 'id' && tok.value.startsWith('@')) {
          // Function declaration
          const range = new vscode.Range(tok.line, tok.col, tok.line, tok.col + tok.value.length);
          symbols.push(new vscode.DocumentSymbol(
            tok.value,
            'function',
            vscode.SymbolKind.Function,
            range,
            range
          ));
        } else if (tok.kind === 'kw' && tok.value === 'const') {
          const next = tokens[i + 1];
          if (next && next.kind === 'id' && next.value.startsWith('%')) {
            const range = new vscode.Range(tok.line, tok.col, next.line, next.col + next.value.length);
            symbols.push(new vscode.DocumentSymbol(
              next.value,
              'register constant',
              vscode.SymbolKind.Constant,
              range,
              range
            ));
          }
        } else if (tok.kind === 'kw' && (tok.value === 'ram' || tok.value === 'eeprom' || tok.value === 'flash')) {
          const mut = tokens[i + 1];
          if (mut && mut.kind === 'kw' && (mut.value === 'mut' || mut.value === 'imut')) {
            const name = tokens[i + 2];
            if (name && name.kind === 'id' && name.value.startsWith('$')) {
              const range = new vscode.Range(tok.line, tok.col, name.line, name.col + name.value.length);
              symbols.push(new vscode.DocumentSymbol(
                name.value,
                `${tok.value} ${mut.value}`,
                vscode.SymbolKind.Variable,
                range,
                range
              ));
            }
          }
        }
      }
    } catch (e) {
      // Ignore tokenization errors while typing to keep outline stable
    }
    return symbols;
  }
}

function formatCode(text) {
  const lines = text.split(/\r?\n/);
  const formattedLines = [];
  let indent = 0;
  const indentStr = '    '; // 4 spaces

  for (let line of lines) {
    let trimmed = line.trim();
    if (!trimmed) {
      formattedLines.push('');
      continue;
    }

    // Check for closing brace at the start of the line to decrease indent first
    if (trimmed.startsWith('}')) {
      indent = Math.max(0, indent - 1);
    }

    let codePart = trimmed;
    let commentPart = '';
    const hashIndex = trimmed.indexOf('#');
    if (hashIndex !== -1) {
      codePart = trimmed.substring(0, hashIndex).trimEnd();
      commentPart = trimmed.substring(hashIndex);
    }

    if (codePart) {
      // Apply clean spacing to standard constructs:
      // 1. Spacing around assignment arrows: ->, ->+, ->-, ->&, ->|, ->^
      codePart = codePart.replace(/\s*(->[+\-&|^]?)\s*/g, ' $1 ');

      // 2. Spacing around = (excluding inside arrows like ->)
      codePart = codePart.replace(/(?<!-)\s*=\s*(?!>)/g, ' = ');

      // 3. Spacing after commas and colons
      codePart = codePart.replace(/\s*:\s*/g, ': ');
      codePart = codePart.replace(/\s*,\s*/g, ', ');

      // Clean up multiple spaces
      codePart = codePart.replace(/ {2,}/g, ' ');
    }

    // Reconstruct the indented line
    let formattedLine = indentStr.repeat(indent) + (codePart + (commentPart ? (codePart ? ' ' : '') + commentPart : ''));
    formattedLines.push(formattedLine);

    // If the line contains { and not a closing }, or ends with {, increase indent
    const openBraces = (trimmed.match(/\{/g) || []).length;
    const closeBraces = (trimmed.match(/\}/g) || []).length;
    indent += (openBraces - closeBraces);
    if (indent < 0) indent = 0;
  }

  return formattedLines.join('\n');
}

class IkFormattingProvider {
  provideDocumentFormattingEdits(document, options, token) {
    const text = document.getText();
    const formatted = formatCode(text);
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(text.length)
    );
    return [vscode.TextEdit.replace(fullRange, formatted)];
  }
}

function activate(context) {
  const collection = vscode.languages.createDiagnosticCollection('ik8b');
  context.subscriptions.push(collection);
  const timers = new Map();

  function validateDocument(doc) {
    if (doc.languageId !== 'ik8b') return;

    const diagnostics = [];
    const cfg = vscode.workspace.getConfiguration('ik8b', doc.uri);

    try {
      const text = doc.getText();
      const tokens = tokenize(text);

      if (cfg.get('requireNamespace', true)) {
        const hasNamespace = tokens.some((t) => t.kind === 'kw' && t.value === 'namespace');
        if (!hasNamespace) {
          diagnostics.push(createDiagnostic(doc, 0, 0, 'Missing required namespace declaration. Add: namespace <target>, for example: namespace atmega328p'));
        }
      }

      const parser = new Parser(tokens);
      parser.parseProgram();
    } catch (err) {
      if (err instanceof IkError) {
        diagnostics.push(createDiagnostic(doc, err.line, err.col, err.message));
      } else {
        diagnostics.push(createDiagnostic(doc, 0, 0, `Internal parser error: ${err.message || String(err)}`, vscode.DiagnosticSeverity.Warning));
      }
    }

    runCompilerValidation(doc, diagnostics);
    collection.set(doc.uri, diagnostics);
  }

  function scheduleValidation(doc) {
    if (doc.languageId !== 'ik8b') return;
    const key = doc.uri.toString();
    if (timers.has(key)) clearTimeout(timers.get(key));
    const t = setTimeout(() => {
      timers.delete(key);
      validateDocument(doc);
    }, 180);
    timers.set(key, t);
  }

  if (vscode.window.activeTextEditor) scheduleValidation(vscode.window.activeTextEditor.document);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(scheduleValidation),
    vscode.workspace.onDidChangeTextDocument((event) => scheduleValidation(event.document)),
    vscode.workspace.onDidSaveTextDocument(scheduleValidation),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) scheduleValidation(editor.document);
    }),
    vscode.languages.registerHoverProvider('ik8b', new IkHoverProvider()),
    vscode.languages.registerDocumentSymbolProvider('ik8b', new IkDocumentSymbolProvider()),
    vscode.languages.registerDocumentFormattingEditProvider('ik8b', new IkFormattingProvider())
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
