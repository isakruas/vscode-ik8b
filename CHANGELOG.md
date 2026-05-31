# Changelog

## 0.2.0

- Synced grammar and diagnostics with the current ik8b compiler:
  - Keywords: added `ptr`, `str`, `fn`.
  - Types: added `i8`, `i16`, `bool`, `char`, `r8`, `r16` (highlighting).
  - Strings: double-quoted string literals with escapes, including `\xHH`.
  - Function pointers: `&@func` address-of and `@$var(...)` indirect-call
    highlighting; `fn(...)`/`fn(...) -> R` types.
- Rewrote the background validator to accept the full current grammar:
  pointer/string/function-pointer declarations, `str flash`, fractional
  (fixed-point) literals, `%REG` register references, address-of/dereference
  operators, and compile-time `? namespace == ...` checks inside blocks.
  Infix operators now respect statement boundaries (a `*`/`-`/`&` starting a
  line is no longer glued onto the previous statement).
- Added snippets: pointer/string/flash-string declarations, function-pointer
  parameters and locals, indirect calls, and `&@func`.
- Added hover documentation for `ptr`, `str`, and `fn`.

## 0.1.0

- Initial release.
- Added `.ik` language registration.
- Added syntax highlighting grammar for ik8b.
- Added language configuration for comments, brackets, pairs, and folding.
- Added practical snippets for common ik8b constructs.
