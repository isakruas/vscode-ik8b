# ik8b Language Support for VS Code

Visual Studio Code support for the **ik8b** language (`.ik`) used for AVR-8 embedded development.

## Features

- Syntax highlighting for:
  - Keywords, control flow, and types
  - Sigil identifiers (`%register`, `$variable`, `@function`)
  - Numbers (decimal and hex), booleans, and character literals
  - Operators, assignments, and punctuation
- Language-aware editor behavior:
  - Line comments with `#`
  - Auto-closing pairs for `{}`, `[]`, `()`, and `'...'`
  - Bracket matching and surrounding pairs
  - Folding support for blocks
- Namespace validation:
  - By default, the extension requires at least one namespace declaration in the file.
  - Example: `namespace atmega328p`
  - Can be disabled via `ik8b.requireNamespace`.
- Built-in parser diagnostics:
  - The extension includes an internal lexer/parser for real-time syntax validation.
  - Errors are reported with line and column directly in the editor.
- Optional compiler diagnostics:
  - You can also enable external compiler diagnostics via `ik8b.enableCompilerDiagnostics`.
  - Compiler path is configurable with `ik8b.compilerPath`.
- Productivity snippets:
  - Namespace declarations
  - Compile-time namespace conditions
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
   - `ik8b/vscode-ik8b`
2. Press `F5` to launch an Extension Development Host.
3. Open or create any `.ik` file and start coding.

## Package as VSIX

Install `vsce` once:

```bash
npm install -g @vscode/vsce
```

Package:

```bash
cd vscode-ik8b
vsce package
```

Install the generated `.vsix` in VS Code:

```bash
code --install-extension ik8b-language-support-0.1.0.vsix
```

## Publish to Visual Studio Marketplace

1. Create a publisher in Marketplace.
2. Update `publisher` in `package.json`.
3. Login and publish:

```bash
cd vscode-ik8b
vsce login <your-publisher>
vsce publish
```

## Notes

- This extension focuses on language ergonomics and readability.
- For optional compiler diagnostics, keep the `ik8b` binary available in the workspace root (`./ik8b`) or set `ik8b.compilerPath`.
- If you want richer IDE features (go-to-definition, document symbols, hover docs), the next step is adding a full Language Server (LSP).

## Color Clarity (Optional Theme)

This extension ships with an optional built-in theme: **ik8b Clean**.

To enable it:
1. Open Command Palette (`Ctrl+Shift+P`).
2. Run `Preferences: Color Theme`.
3. Select `ik8b Clean`.
