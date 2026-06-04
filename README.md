# ik8b Language Support for VS Code

Visual Studio Code support for the **ik8b** language (`.ik`) used for AVR-8 embedded development.

## Features

- Syntax highlighting for:
  - Keywords, control flow, and all scalar types (`u8`, `u16`, `i8`, `i16`, `bool`, `char`, `r8`, `r16`, `void`)
  - Pointer (`ptr`), string (`str`), and function-pointer (`fn`) type constructors
  - Sigil identifiers (`%register`, `$variable`, `@function`)
  - Function pointers: address-of `&@func` and indirect calls `@$var(...)`
  - Numbers (decimal, hex, fixed-point), booleans, character literals, and string literals (with `\xHH` escapes)
  - Operators, assignments, and punctuation
- Language-aware editor behavior:
  - Line comments with `#`
  - Auto-closing pairs for `{}`, `[]`, `()`, and `'...'`
  - Bracket matching and surrounding pairs
  - Folding support for blocks
- target validation:
  - By default, the extension requires at least one target declaration in the file.
  - Example: `target atmega328p`
  - Can be disabled via `ik8b.requiretarget`.
- Built-in parser diagnostics:
  - The extension includes an internal lexer/parser for real-time syntax validation.
  - Errors are reported with line and column directly in the editor.
- Optional compiler diagnostics:
  - You can also enable external compiler diagnostics via `ik8b.enableCompilerDiagnostics`.
  - Compiler path is configurable with `ik8b.compilerPath`.
- Productivity snippets:
  - target declarations
  - Compile-time target conditions
  - Function templates
  - Loops, conditionals, switch, assignments
  - Register constants and variable declarations

## Included Files

- `package.json`: VS Code extension manifest
- `language-configuration.json`: comments, brackets, folding, word pattern
- `syntaxes/ik8b.tmLanguage.json`: TextMate grammar
- `snippets/ik8b.code-snippets`: ready-to-use snippets

## Installation (Local Development)

1. Open this folder in VS Code:
   - `vscode-ik8b`
2. Press `F5` to launch an Extension Development Host.
3. Open or create any `.ik` file and start coding.

## Package as VSIX

Install `vsce` once:

```bash
npm install -g @vscode/vsce
```

Package:

```bash
vsce package
```

Install the generated `.vsix` in VS Code:

```bash
code --install-extension ik8b-language-support-0.1.0.vsix
```
