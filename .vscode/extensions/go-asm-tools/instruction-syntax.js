'use strict';

// Operand forms for the arm64 hover. Each entry lists only forms accepted by
// the Go assembler; `example` holds concrete operands and is assembled by
// scripts/check-syntax.js. W/S variants reuse the base entry at lookup time.

function f(args, effect, example, suffix) {
  return { args, effect, example, suffix };
}

function addSub(operator, setFlags) {
  const flags = setFlags ? ' and set the condition flags' : '';
  return {
    forms: [
      f('Rm, Rn, Rd', `Rd = Rn ${operator} Rm${flags}`, 'R1, R2, R3'),
      f('Rm, Rn', `Rn ${operator}= Rm (two-operand form)${flags}`, 'R1, R2'),
      f('$imm, Rn, Rd', `Rd = Rn ${operator} imm${flags}`, '$1, R2, R3'),
      f('$imm, Rn', `Rn ${operator}= imm (two-operand form)${flags}`, '$1, R2'),
      f('Rm<<n, Rn, Rd', `Rd = Rn ${operator} (Rm << n)${flags}`, 'R1<<2, R2, R3'),
      f('Rm.EXT, Rn, Rd', `Rd = Rn ${operator} extend(Rm)${flags}`, 'R1.SXTH, R2, R3'),
    ],
    operands:
      'Rm/Rn/Rd are registers; $imm is an encodable immediate; n is a shift count; .EXT is SXTB/SXTH/SXTW/UXTB/UXTH/UXTW.',
    notes:
      'Only the first source may be shifted or extended; the second source must be a plain register. Two-operand forms write the second operand.',
  };
}

function logical(operator, setFlags) {
  const flags = setFlags ? ' and set the condition flags' : '';
  return {
    forms: [
      f('Rm, Rn, Rd', `Rd = Rn ${operator} Rm${flags}`, 'R1, R2, R3'),
      f('Rm, Rn', `Rn ${operator}= Rm (two-operand form)${flags}`, 'R1, R2'),
      f('$imm, Rn, Rd', `Rd = Rn ${operator} imm${flags}`, '$1, R2, R3'),
      f('$imm, Rn', `Rn ${operator}= imm (two-operand form)${flags}`, '$1, R2'),
      f('Rm<<n, Rn, Rd', `Rd = Rn ${operator} (Rm << n)${flags}`, 'R1<<2, R2, R3'),
    ],
    operands:
      'Rm/Rn/Rd are registers; $imm is an encodable immediate; n is a shift count.',
    notes:
      'Logical forms accept a shifted register but not an extended register. Two-operand forms write the second operand.',
  };
}

function regBinary(effect3, effect2) {
  return {
    forms: [
      f('Rm, Rn, Rd', effect3, 'R1, R2, R3'),
      f('Rm, Rn', `${effect2} (two-operand form)`, 'R1, R2'),
    ],
    operands: 'Rm/Rn/Rd are registers.',
    notes: 'Register operands only; an immediate is rejected.',
  };
}

function regUnary(effect) {
  return {
    forms: [f('Rm, Rd', effect, 'R1, R2')],
    operands: 'Rm/Rd are registers.',
    notes: 'Exactly two operands; there is no one-operand form.',
  };
}

function regUnaryShifted(effect) {
  return {
    forms: [
      f('Rm, Rd', effect, 'R1, R2'),
      f('Rm<<n, Rd', `${effect} (shifted source)`, 'R1<<2, R2'),
    ],
    operands: 'Rm/Rd are registers; n is a shift count.',
    notes: 'At least two operands; one-operand forms such as `NEG R1` are rejected.',
  };
}

function compare(opText) {
  return {
    forms: [
      f('Rm, Rn', `set flags from Rn ${opText} Rm`, 'R1, R2'),
      f('$imm, Rn', `set flags from Rn ${opText} imm`, '$1, R1'),
      f('Rm<<n, Rn', `set flags from Rn ${opText} (Rm << n)`, 'R1<<2, R2'),
      f('Rm.EXT, Rn', `set flags from Rn ${opText} extend(Rm)`, 'R1.SXTH, R2'),
    ],
    operands:
      'Rm/Rn are registers; $imm is an encodable immediate; n is a shift count; .EXT is SXTB/SXTH/SXTW/UXTB/UXTH/UXTW.',
    notes:
      'No destination operand; the second operand is the value tested. A one-operand form is rejected.',
  };
}

function fpBinary(operator) {
  return {
    forms: [
      f('Fm, Fn, Fd', `Fd = Fn ${operator} Fm`, 'F1, F2, F3'),
      f('Fm, Fd', `Fd ${operator}= Fm (two-operand form)`, 'F1, F2'),
    ],
    operands: 'Fm/Fn/Fd are F0–F31.',
    notes: 'Immediates and general registers are rejected; two-operand forms write the second operand.',
  };
}

function fpUnary(effect) {
  return {
    forms: [f('Fm, Fd', effect, 'F1, F2')],
    operands: 'Fm/Fd are F0–F31.',
    notes: 'Exactly two operands; immediates and general registers are rejected.',
  };
}

const FMOV_FORMS = {
  forms: [
    f('$fconst, Fd', 'load a floating-point immediate', '$1.5, F1'),
    f('Fm, Fd', 'copy a floating-point register', 'F1, F2'),
    f('(Rn), Fd', 'load from [Rn]', '(R1), F1'),
    f('off(Rn), Fd', 'load at an offset', '8(R1), F1'),
    f('sym(SB), Fd', 'load from a symbol', '·foo(SB), F1'),
    f('Fd, (Rn)', 'store to [Rn]', 'F1, (R2)'),
    f('Fd, off(Rn)', 'store at an offset', 'F1, 8(R2)'),
    f('Fd, sym(SB)', 'store to a symbol', 'F1, ·foo(SB)'),
    f('Rm, Fd', 'move an integer register to a floating-point register', 'R1, F1'),
    f('Fm, Rd', 'move a floating-point register to an integer register', 'F1, R1'),
    f('off(Rn), Fd', 'post-index load: load the value, then Rn += off', '8(R1), F1', '.P'),
    f('Fd, off(Rn)', 'post-index store: store the value, then Rn += off', 'F1, 8(R2)', '.P'),
    f('off(Rn), Fd', 'pre-index load: Rn += off, then load the value', '8(R1), F1', '.W'),
    f('Fd, off(Rn)', 'pre-index store: Rn += off, then store the value', 'F1, 8(R2)', '.W'),
  ],
  operands:
    'Fd/Fm are F0–F31; Rm/Rd are integer registers; off(Rn) is a signed offset; sym(SB) is a static symbol.',
  notes:
    'FMOVS moves 32-bit values and FMOVD moves 64-bit values. .P/.W add post-/pre-index writeback to loads and stores; the writeback offset is a signed 9-bit byte offset (-256..255).',
};

const BRANCH_FORMS = {
  forms: [
    f('target', 'branch to a local label', 'lbl'),
    f('off(PC)', 'PC-relative branch', '1(PC)'),
  ],
  operands: 'target is a local label; off(PC) is a PC-relative instruction offset.',
};

const INSTRUCTION_SYNTAX = {
  // 8.1 Data movement
  MOVD: {
    forms: [
      f('$imm, Rd', 'load an immediate (assembler may expand)', '$1, R1'),
      f('$0, (Rn)', 'store zero (encoded as ZR)', '$0, (R1)'),
      f('Rm, Rd', 'copy a register', 'R1, R2'),
      f('(Rn), Rd', 'load 64 bits', '(R1), R2'),
      f('off(Rn), Rd', 'load at an offset', '8(R1), R2'),
      f('sym(SB), Rd', 'load from a symbol', '·foo(SB), R1'),
      f('Rd, (Rn)', 'store 64 bits', 'R1, (R2)'),
      f('Rd, off(Rn)', 'store at an offset', 'R1, 8(R2)'),
      f('Rd, sym(SB)', 'store to a symbol', 'R1, ·foo(SB)'),
      f('off(Rn), Rd', 'post-index load: load 64 bits, then Rn += off', '8(R1), R2', '.P'),
      f('Rd, off(Rn)', 'post-index store: store 64 bits, then Rn += off', 'R1, 8(R2)', '.P'),
      f('off(Rn), Rd', 'pre-index load: Rn += off, then load 64 bits', '8(R1), R2', '.W'),
      f('Rd, off(Rn)', 'pre-index store: Rn += off, then store 64 bits', 'R1, 8(R2)', '.W'),
    ],
    operands:
      'Rd is a register; $imm is an immediate; off(Rn) is a signed offset from Rn; sym(SB) is a static symbol.',
    notes:
      'Exactly two operands. .P/.W add post-/pre-index writeback to loads and stores; the writeback offset is an unscaled signed 9-bit byte offset (-256..255). Use FMOVD to move between R and F registers.',
  },
  MOVW: {
    forms: [
      f('$imm, Rd', 'load a 32-bit immediate', '$1, R1'),
      f('Rm, Rd', 'copy a register', 'R1, R2'),
      f('(Rn), Rd', 'load 32 bits with sign extension', '(R1), R2'),
      f('off(Rn), Rd', 'load at an offset', '8(R1), R2'),
      f('sym(SB), Rd', 'load from a symbol', '·foo(SB), R1'),
      f('Rd, (Rn)', 'store 32 bits', 'R1, (R2)'),
      f('Rd, off(Rn)', 'store at an offset', 'R1, 8(R2)'),
      f('Rd, sym(SB)', 'store to a symbol', 'R1, ·foo(SB)'),
      f('off(Rn), Rd', 'post-index load: load signed 32 bits, then Rn += off', '8(R1), R2', '.P'),
      f('Rd, off(Rn)', 'post-index store: store low 32 bits, then Rn += off', 'R1, 8(R2)', '.P'),
      f('off(Rn), Rd', 'pre-index load: Rn += off, then load signed 32 bits', '8(R1), R2', '.W'),
      f('Rd, off(Rn)', 'pre-index store: Rn += off, then store low 32 bits', 'R1, 8(R2)', '.W'),
    ],
    operands:
      'Rd is a register; $imm is an immediate; off(Rn) is a signed offset from Rn; sym(SB) is a static symbol.',
    notes:
      'Exactly two operands. Loads sign-extend into the 64-bit destination. .P/.W add post-/pre-index writeback to loads and stores; the writeback offset is a signed 9-bit byte offset (-256..255).',
  },
  MOVWU: {
    forms: [
      f('Rm, Rd', 'copy a register', 'R1, R2'),
      f('(Rn), Rd', 'load 32 bits with zero extension', '(R1), R2'),
      f('off(Rn), Rd', 'load at an offset', '8(R1), R2'),
      f('sym(SB), Rd', 'load from a symbol', '·foo(SB), R1'),
      f('Rd, (Rn)', 'store 32 bits', 'R1, (R2)'),
      f('Rd, off(Rn)', 'store at an offset', 'R1, 8(R2)'),
      f('Rd, sym(SB)', 'store to a symbol', 'R1, ·foo(SB)'),
      f('off(Rn), Rd', 'post-index load: load 32 bits unsigned, then Rn += off', '8(R1), R2', '.P'),
      f('Rd, off(Rn)', 'post-index store: store low 32 bits, then Rn += off (canonical MOVW.P)', 'R1, 8(R2)', '.P'),
      f('off(Rn), Rd', 'pre-index load: Rn += off, then load 32 bits unsigned', '8(R1), R2', '.W'),
      f('Rd, off(Rn)', 'pre-index store: Rn += off, then store low 32 bits (canonical MOVW.W)', 'R1, 8(R2)', '.W'),
    ],
    operands:
      'Rd is a register; off(Rn) is a signed offset from Rn; sym(SB) is a static symbol.',
    notes: 'Exactly two operands. An immediate load is not accepted; use MOVW for that. .P/.W add post-/pre-index writeback; a store writeback canonicalizes to MOVW.P/MOVW.W.',
  },
  MOVH: {
    forms: [
      f('Rm, Rd', 'copy a register', 'R1, R2'),
      f('(Rn), Rd', 'load 16 bits with sign extension', '(R1), R2'),
      f('off(Rn), Rd', 'load at an offset', '8(R1), R2'),
      f('sym(SB), Rd', 'load from a symbol', '·foo(SB), R1'),
      f('Rd, (Rn)', 'store 16 bits', 'R1, (R2)'),
      f('Rd, off(Rn)', 'store at an offset', 'R1, 8(R2)'),
      f('Rd, sym(SB)', 'store to a symbol', 'R1, ·foo(SB)'),
      f('off(Rn), Rd', 'post-index load: load signed 16 bits, then Rn += off', '8(R1), R2', '.P'),
      f('Rd, off(Rn)', 'post-index store: store low 16 bits, then Rn += off', 'R1, 8(R2)', '.P'),
      f('off(Rn), Rd', 'pre-index load: Rn += off, then load signed 16 bits', '8(R1), R2', '.W'),
      f('Rd, off(Rn)', 'pre-index store: Rn += off, then store low 16 bits', 'R1, 8(R2)', '.W'),
    ],
    operands:
      'Rd is a register; off(Rn) is a signed offset from Rn; sym(SB) is a static symbol.',
    notes: 'Exactly two operands. An immediate load is not accepted. .P/.W add post-/pre-index writeback; the writeback offset is a signed 9-bit byte offset (-256..255).',
  },
  MOVHU: {
    forms: [
      f('Rm, Rd', 'copy a register', 'R1, R2'),
      f('(Rn), Rd', 'load 16 bits with zero extension', '(R1), R2'),
      f('off(Rn), Rd', 'load at an offset', '8(R1), R2'),
      f('sym(SB), Rd', 'load from a symbol', '·foo(SB), R1'),
      f('Rd, (Rn)', 'store 16 bits', 'R1, (R2)'),
      f('Rd, off(Rn)', 'store at an offset', 'R1, 8(R2)'),
      f('Rd, sym(SB)', 'store to a symbol', 'R1, ·foo(SB)'),
      f('off(Rn), Rd', 'post-index load: load 16 bits unsigned, then Rn += off', '8(R1), R2', '.P'),
      f('Rd, off(Rn)', 'post-index store: store low 16 bits, then Rn += off (canonical MOVH.P)', 'R1, 8(R2)', '.P'),
      f('off(Rn), Rd', 'pre-index load: Rn += off, then load 16 bits unsigned', '8(R1), R2', '.W'),
      f('Rd, off(Rn)', 'pre-index store: Rn += off, then store low 16 bits (canonical MOVH.W)', 'R1, 8(R2)', '.W'),
    ],
    operands:
      'Rd is a register; off(Rn) is a signed offset from Rn; sym(SB) is a static symbol.',
    notes: 'Exactly two operands. An immediate load is not accepted. .P/.W add post-/pre-index writeback; a store writeback canonicalizes to MOVH.P/MOVH.W.',
  },
  MOVB: {
    forms: [
      f('Rm, Rd', 'copy a register', 'R1, R2'),
      f('(Rn), Rd', 'load 8 bits with sign extension', '(R1), R2'),
      f('off(Rn), Rd', 'load at an offset', '8(R1), R2'),
      f('sym(SB), Rd', 'load from a symbol', '·foo(SB), R1'),
      f('Rd, (Rn)', 'store 8 bits', 'R1, (R2)'),
      f('Rd, off(Rn)', 'store at an offset', 'R1, 8(R2)'),
      f('Rd, sym(SB)', 'store to a symbol', 'R1, ·foo(SB)'),
      f('off(Rn), Rd', 'post-index load: load signed 8 bits, then Rn += off', '8(R1), R2', '.P'),
      f('Rd, off(Rn)', 'post-index store: store low 8 bits, then Rn += off', 'R1, 8(R2)', '.P'),
      f('off(Rn), Rd', 'pre-index load: Rn += off, then load signed 8 bits', '8(R1), R2', '.W'),
      f('Rd, off(Rn)', 'pre-index store: Rn += off, then store low 8 bits', 'R1, 8(R2)', '.W'),
    ],
    operands:
      'Rd is a register; off(Rn) is a signed offset from Rn; sym(SB) is a static symbol.',
    notes: 'Exactly two operands. An immediate load is not accepted. .P/.W add post-/pre-index writeback; the writeback offset is a signed 9-bit byte offset (-256..255).',
  },
  MOVBU: {
    forms: [
      f('Rm, Rd', 'copy a register', 'R1, R2'),
      f('(Rn), Rd', 'load 8 bits with zero extension', '(R1), R2'),
      f('off(Rn), Rd', 'load at an offset', '8(R1), R2'),
      f('sym(SB), Rd', 'load from a symbol', '·foo(SB), R1'),
      f('Rd, (Rn)', 'store 8 bits', 'R1, (R2)'),
      f('Rd, off(Rn)', 'store at an offset', 'R1, 8(R2)'),
      f('Rd, sym(SB)', 'store to a symbol', 'R1, ·foo(SB)'),
      f('off(Rn), Rd', 'post-index load: load 8 bits unsigned, then Rn += off', '8(R1), R2', '.P'),
      f('Rd, off(Rn)', 'post-index store: store low 8 bits, then Rn += off (canonical MOVB.P)', 'R1, 8(R2)', '.P'),
      f('off(Rn), Rd', 'pre-index load: Rn += off, then load 8 bits unsigned', '8(R1), R2', '.W'),
      f('Rd, off(Rn)', 'pre-index store: Rn += off, then store low 8 bits (canonical MOVB.W)', 'R1, 8(R2)', '.W'),
    ],
    operands:
      'Rd is a register; off(Rn) is a signed offset from Rn; sym(SB) is a static symbol.',
    notes: 'Exactly two operands. An immediate load is not accepted. .P/.W add post-/pre-index writeback; a store writeback canonicalizes to MOVB.P/MOVB.W.',
  },
  MOVZ: {
    forms: [
      f('$imm, Rd', 'write a 16-bit field and zero the rest', '$(1<<16), R1'),
    ],
    operands: '$imm is an immediate; encode a shift as `$((value)<<n)`.',
    notes: 'Exactly two operands; register and memory forms are not accepted. W forms write 32 bits.',
  },
  MOVK: {
    forms: [
      f('$imm, Rd', 'write a 16-bit field and keep the rest', '$(1<<16), R1'),
    ],
    operands: '$imm is an immediate; encode a shift as `$((value)<<n)`.',
    notes: 'Exactly two operands; register and memory forms are not accepted. W forms write 32 bits.',
  },
  MOVN: {
    forms: [
      f('$imm, Rd', 'write the complement of a 16-bit field', '$(1<<16), R1'),
    ],
    operands: '$imm is an immediate; encode a shift as `$((value)<<n)`.',
    notes: 'Exactly two operands; register and memory forms are not accepted. W forms write 32 bits.',
  },
  LDP: {
    forms: [
      f('(Rn), (Rd1, Rd2)', 'load a pair from [Rn]', '(R1), (R2, R3)'),
      f('off(Rn), (Rd1, Rd2)', 'load a pair at an offset', '8(R1), (R2, R3)'),
      f('sym(SB), (Rd1, Rd2)', 'load a pair from a symbol', '·foo(SB), (R1, R2)'),
      f('off(Rn), (Rd1, Rd2)', 'post-index load: load the pair, then Rn += off', '16(R1), (R2, R3)', '.P'),
      f('off(Rn), (Rd1, Rd2)', 'pre-index load: Rn += off, then load the pair', '16(R1), (R2, R3)', '.W'),
    ],
    operands:
      'Rd1/Rd2 are written as a parenthesized register pair; Rn is the base register; off is a signed offset.',
    notes:
      'Exactly two operands, and the destination is always a register pair. .P/.W add post-/pre-index writeback: `LDP.P off(Rn), (Rd1, Rd2)`. The writeback offset is scaled by the access size and must be a multiple of it (8 bytes for LDP, 4 for LDPW).',
  },
  STP: {
    forms: [
      f('(Rs1, Rs2), (Rn)', 'store a pair to [Rn]', '(R1, R2), (R3)'),
      f('(Rs1, Rs2), off(Rn)', 'store a pair at an offset', '(R1, R2), 8(R3)'),
      f('(Rs1, Rs2), sym(SB)', 'store a pair to a symbol', '(R1, R2), ·foo(SB)'),
      f('(Rs1, Rs2), off(Rn)', 'post-index store: store the pair, then Rn += off', '(R1, R2), 16(R3)', '.P'),
      f('(Rs1, Rs2), off(Rn)', 'pre-index store: Rn += off, then store the pair', '(R1, R2), 16(R3)', '.W'),
    ],
    operands:
      'Rs1/Rs2 are written as a parenthesized register pair; Rn is the base register; off is a signed offset.',
    notes:
      'Exactly two operands, and the source is always a register pair. .P/.W add post-/pre-index writeback: `STP.P (Rs1, Rs2), off(Rn)`. The writeback offset is scaled by the access size and must be a multiple of it (8 bytes for STP, 4 for STPW).',
  },
  LDPSW: {
    forms: [
      f('(Rn), (Rd1, Rd2)', 'load a pair of signed words', '(R1), (R2, R3)'),
      f('off(Rn), (Rd1, Rd2)', 'load a pair at an offset', '8(R1), (R2, R3)'),
    ],
    operands:
      'Rd1/Rd2 are a parenthesized register pair; Rn is the base register; off is a signed offset.',
    notes: 'Sign-extends each 32-bit load to 64 bits. Exactly two operands; the destination is a register pair.',
  },
  LDAR: {
    forms: [f('(Rn), Rd', 'load-acquire from [Rn]', '(R1), R2')],
    operands: 'Rn is the base register; Rd is the destination register.',
    notes: 'Zero offset only: `8(Rn)` is rejected. LDARB/LDARH/LDARW select the width.',
  },
  STLR: {
    forms: [f('Rs, (Rn)', 'store-release to [Rn]', 'R2, (R1)')],
    operands: 'Rs is the source register; Rn is the base register.',
    notes: 'Zero offset only: `8(Rn)` is rejected. STLRB/STLRH/STLRW select the width.',
  },

  // 8.2 Arithmetic and logic
  ADD: addSub('+', false),
  ADDS: addSub('+', true),
  SUB: addSub('-', false),
  SUBS: addSub('-', true),
  MUL: regBinary('Rd = Rn * Rm', 'Rn *= Rm'),
  MADD: {
    forms: [f('Rm, Ra, Rn, Rd', 'Rd = Ra + Rn*Rm', 'R1, R2, R3, R4')],
    operands: 'All four operands are registers.',
    notes: 'Exactly four operands; there is no two- or three-operand form.',
  },
  MSUB: {
    forms: [f('Rm, Ra, Rn, Rd', 'Rd = Ra - Rn*Rm', 'R1, R2, R3, R4')],
    operands: 'All four operands are registers.',
    notes: 'Exactly four operands; there is no two- or three-operand form.',
  },
  SDIV: regBinary('Rd = Rn / Rm (signed)', 'Rn /= Rm (signed)'),
  UDIV: regBinary('Rd = Rn / Rm (unsigned)', 'Rn /= Rm (unsigned)'),
  AND: logical('&', false),
  ANDS: logical('&', true),
  ORR: logical('|', false),
  EOR: logical('^', false),
  BIC: logical('&^', false),
  BICS: logical('&^', true),
  MVN: regUnaryShifted('Rd = ^Rm'),
  NEG: regUnaryShifted('Rd = -Rm'),
  NEGS: regUnaryShifted('Rd = -Rm and set the condition flags'),
  LSL: {
    forms: [
      f('$n, Rn, Rd', 'Rd = Rn << n', '$2, R1, R2'),
      f('$n, Rd', 'Rd <<= n (two-operand form)', '$2, R1'),
      f('Rm, Rn, Rd', 'Rd = Rn << Rm', 'R2, R1, R3'),
      f('Rm, Rd', 'Rd <<= Rm (two-operand form)', 'R2, R1'),
    ],
    operands: '$n is a shift amount; Rm/Rn/Rd are registers.',
    notes:
      'Shift amount may be an immediate or a register. Two-operand forms write the register that is also the destination.',
  },
  LSR: {
    forms: [
      f('$n, Rn, Rd', 'Rd = Rn >> n (logical)', '$2, R1, R2'),
      f('$n, Rd', 'Rd >>= n (two-operand form, logical)', '$2, R1'),
      f('Rm, Rn, Rd', 'Rd = Rn >> Rm (logical)', 'R2, R1, R3'),
      f('Rm, Rd', 'Rd >>= Rm (two-operand form, logical)', 'R2, R1'),
    ],
    operands: '$n is a shift amount; Rm/Rn/Rd are registers.',
    notes:
      'Shift amount may be an immediate or a register. Two-operand forms write the register that is also the destination.',
  },
  ASR: {
    forms: [
      f('$n, Rn, Rd', 'Rd = Rn >> n (arithmetic)', '$2, R1, R2'),
      f('$n, Rd', 'Rd >>= n (two-operand form, arithmetic)', '$2, R1'),
      f('Rm, Rn, Rd', 'Rd = Rn >> Rm (arithmetic)', 'R2, R1, R3'),
      f('Rm, Rd', 'Rd >>= Rm (two-operand form, arithmetic)', 'R2, R1'),
    ],
    operands: '$n is a shift amount; Rm/Rn/Rd are registers.',
    notes:
      'Shift amount may be an immediate or a register. Two-operand forms write the register that is also the destination.',
  },
  ROR: {
    forms: [
      f('$n, Rn, Rd', 'Rd = rotateRight(Rn, n)', '$2, R1, R2'),
      f('$n, Rd', 'Rd = rotateRight(Rd, n) (two-operand form)', '$2, R1'),
      f('Rm, Rn, Rd', 'Rd = rotateRight(Rn, Rm)', 'R2, R1, R3'),
      f('Rm, Rd', 'Rd = rotateRight(Rd, Rm) (two-operand form)', 'R2, R1'),
    ],
    operands: '$n is a shift amount; Rm/Rn/Rd are registers.',
    notes:
      'Shift amount may be an immediate or a register. Two-operand forms write the register that is also the destination.',
  },
  TST: {
    forms: [
      f('Rm, Rn', 'set flags from Rn & Rm', 'R1, R2'),
      f('$imm, Rn', 'set flags from Rn & imm', '$0xff, R1'),
      f('Rm<<n, Rn', 'set flags from Rn & (Rm << n)', 'R1<<2, R2'),
    ],
    operands: 'Rm/Rn are registers; $imm is an encodable immediate; n is a shift count.',
    notes:
      'No destination operand; a one-operand form is rejected. Shifted registers are accepted, extended registers are not.',
  },

  // 8.3 Compare and branch
  CMP: compare('-'),
  CMN: compare('+'),
  CCMP: {
    forms: [
      f('cond, Rn, Rm, $nzcv', 'compare if cond holds, else write nzcv', 'EQ, R1, R2, $0'),
      f('cond, Rn, $imm, $nzcv', 'compare with an immediate if cond holds, else write nzcv', 'EQ, R1, $1, $0'),
    ],
    operands: 'cond is a condition mnemonic such as EQ; $imm is an immediate; $nzcv is a 4-bit flag value.',
    notes: 'Exactly four operands; cond is a bare token, not a register. This is a conditional compare, not a branch.',
  },
  CCMN: {
    forms: [
      f('cond, Rn, Rm, $nzcv', 'add-compare if cond holds, else write nzcv', 'EQ, R1, R2, $0'),
      f('cond, Rn, $imm, $nzcv', 'add-compare with an immediate if cond holds, else write nzcv', 'EQ, R1, $1, $0'),
    ],
    operands: 'cond is a condition mnemonic such as EQ; $imm is an immediate; $nzcv is a 4-bit flag value.',
    notes: 'Exactly four operands; cond is a bare token, not a register. This is a conditional compare, not a branch.',
  },
  CBZ: {
    forms: [
      f('Rn, target', 'branch if Rn == 0', 'R1, lbl'),
      f('Rn, off(PC)', 'PC-relative branch if Rn == 0', 'R1, 1(PC)'),
    ],
    operands: 'Rn is a register; target is a local label; off(PC) is a PC-relative instruction offset.',
    notes: 'The tested operand must be a register; an immediate is rejected. CBZW tests the low 32 bits.',
  },
  CBNZ: {
    forms: [
      f('Rn, target', 'branch if Rn != 0', 'R1, lbl'),
      f('Rn, off(PC)', 'PC-relative branch if Rn != 0', 'R1, 1(PC)'),
    ],
    operands: 'Rn is a register; target is a local label; off(PC) is a PC-relative instruction offset.',
    notes: 'The tested operand must be a register; an immediate is rejected. CBNZW tests the low 32 bits.',
  },
  TBZ: {
    forms: [
      f('$bit, Rn, target', 'branch if bit is zero', '$3, R1, lbl'),
      f('$bit, Rn, off(PC)', 'PC-relative branch if bit is zero', '$3, R1, 1(PC)'),
    ],
    operands: '$bit is a bit number 0–63; Rn is a register; target is a local label or PC-relative offset.',
    notes: 'Exactly three operands; there is no W form.',
  },
  TBNZ: {
    forms: [
      f('$bit, Rn, target', 'branch if bit is non-zero', '$3, R1, lbl'),
      f('$bit, Rn, off(PC)', 'PC-relative branch if bit is non-zero', '$3, R1, 1(PC)'),
    ],
    operands: '$bit is a bit number 0–63; Rn is a register; target is a local label or PC-relative offset.',
    notes: 'Exactly three operands; there is no W form.',
  },
  B: {
    forms: [
      f('target', 'branch to a label', 'lbl'),
      f('sym(SB)', 'branch to a symbol', '·foo(SB)'),
      f('off(PC)', 'PC-relative branch', '1(PC)'),
      f('(Rn)', 'branch to the address in Rn', '(R1)'),
    ],
    operands: 'target is a local label; sym(SB) is a static symbol; off(PC) is a PC-relative offset.',
    notes: 'JMP is the canonical name. Register targets use parentheses: `JMP (Rn)`.',
  },
  BL: {
    forms: [
      f('target', 'branch with link to a label', 'lbl'),
      f('sym(SB)', 'branch with link to a symbol', '·foo(SB)'),
      f('off(PC)', 'PC-relative branch with link', '1(PC)'),
      f('(Rn)', 'branch with link to the address in Rn', '(R1)'),
    ],
    operands: 'target is a local label; sym(SB) is a static symbol; off(PC) is a PC-relative offset.',
    notes: 'CALL is the canonical name. Register targets use parentheses: `CALL (Rn)`.',
  },
  JMP: {
    forms: [
      f('target', 'branch to a label', 'lbl'),
      f('sym(SB)', 'branch to a symbol', '·foo(SB)'),
      f('(Rn)', 'branch to the address in Rn', '(R1)'),
    ],
    operands: 'target is a local label; sym(SB) is a static symbol; Rn is a register.',
    notes: 'This is the canonical spelling of `B`. A bare register (`JMP R1`) is rejected; use `JMP (R1)`.',
  },
  CALL: {
    forms: [
      f('target', 'call a label', 'lbl'),
      f('sym(SB)', 'call a symbol', '·foo(SB)'),
      f('(Rn)', 'call the address in Rn', '(R1)'),
    ],
    operands: 'target is a local label; sym(SB) is a static symbol; Rn is a register.',
    notes: 'This is the canonical spelling of `BL`. Register targets use parentheses: `CALL (Rn)`.',
  },
  RET: {
    forms: [
      f('', 'return to LR (R30)', ''),
      f('Rn', 'return to the address in Rn', 'R1'),
    ],
    operands: 'Rn is a register.',
    notes: 'With no operand, RET returns to LR. A one-operand form selects a different return address.',
  },

  // 8.4 Conditional select
  CSEL: {
    forms: [f('cond, Rn, Rm, Rd', 'Rd = Rn if cond holds, otherwise Rm', 'EQ, R1, R2, R3')],
    operands: 'cond is a condition mnemonic such as EQ; Rn/Rm/Rd are registers (SP is rejected).',
    notes: 'Exactly four operands; there is no two- or three-operand shorthand.',
  },
  CSET: {
    forms: [f('cond, Rd', 'Rd = 1 if cond holds, otherwise 0', 'EQ, R1')],
    operands: 'cond is a condition mnemonic such as EQ; Rd is a register.',
    notes: 'Exactly two operands; there is no three-operand form.',
  },
  CSETM: {
    forms: [f('cond, Rd', 'Rd = all ones if cond holds, otherwise 0', 'EQ, R1')],
    operands: 'cond is a condition mnemonic such as EQ; Rd is a register.',
    notes: 'Exactly two operands; there is no three-operand form.',
  },
  CSINC: {
    forms: [f('cond, Rn, Rm, Rd', 'Rd = Rn if cond holds, otherwise Rm+1', 'EQ, R1, R2, R3')],
    operands: 'cond is a condition mnemonic such as EQ; Rn/Rm/Rd are registers.',
    notes: 'Exactly four operands; there is no two- or three-operand shorthand.',
  },
  CSINV: {
    forms: [f('cond, Rn, Rm, Rd', 'Rd = Rn if cond holds, otherwise ^Rm', 'EQ, R1, R2, R3')],
    operands: 'cond is a condition mnemonic such as EQ; Rn/Rm/Rd are registers.',
    notes: 'Exactly four operands; there is no two- or three-operand shorthand.',
  },
  CSNEG: {
    forms: [f('cond, Rn, Rm, Rd', 'Rd = Rn if cond holds, otherwise -Rm', 'EQ, R1, R2, R3')],
    operands: 'cond is a condition mnemonic such as EQ; Rn/Rm/Rd are registers.',
    notes: 'Exactly four operands; there is no two- or three-operand shorthand.',
  },

  // Extends, bit operations, and system instructions
  SXTB: regUnary('Sign-extend the low 8 bits into 64 bits.'),
  SXTH: regUnary('Sign-extend the low 16 bits into 64 bits.'),
  SXTW: regUnary('Sign-extend the low 32 bits into 64 bits.'),
  UXTB: regUnary('Zero-extend the low 8 bits into 64 bits.'),
  UXTH: regUnary('Zero-extend the low 16 bits into 64 bits.'),
  UXTW: regUnary('Zero-extend the low 32 bits into 64 bits.'),
  CLZ: regUnary('Count leading zeros in a 64-bit register.'),
  RBIT: regUnary('Reverse the bit order of a 64-bit register.'),
  REV: regUnary('Reverse the byte order of a 64-bit register.'),
  REV16: regUnary('Reverse the byte order within each halfword.'),
  REV32: regUnary('Reverse the byte order within each 32-bit word of a 64-bit register.'),
  SVC: {
    forms: [
      f('$imm', 'trap to the kernel with an immediate', '$0'),
      f('', 'trap with immediate 0', ''),
    ],
    operands: '$imm is the supervisor call number.',
    notes: 'At most one operand; a bare SVC uses 0.',
  },
  NOP: {
    forms: [f('', 'no operation', '')],
    operands: '',
    notes: 'Takes no operands.',
  },

  // Floating point. The D/S suffix selects double/single precision.
  FMOVS: FMOV_FORMS,
  FMOVD: FMOV_FORMS,
  FADDS: fpBinary('+'),
  FADDD: fpBinary('+'),
  FSUBS: fpBinary('-'),
  FSUBD: fpBinary('-'),
  FMULS: fpBinary('*'),
  FMULD: fpBinary('*'),
  FDIVS: fpBinary('/'),
  FDIVD: fpBinary('/'),
  FABSS: fpUnary('Fd = |Fm| (single precision).'),
  FABSD: fpUnary('Fd = |Fm| (double precision).'),
  FNEGS: fpUnary('Fd = -Fm (single precision).'),
  FNEGD: fpUnary('Fd = -Fm (double precision).'),
  FSQRTS: fpUnary('Fd = sqrt(Fm) (single precision).'),
  FSQRTD: fpUnary('Fd = sqrt(Fm) (double precision).'),
  FCMPS: {
    forms: [
      f('Fm, Fn', 'compare Fn with Fm and set flags', 'F1, F2'),
      f('$fconst, Fn', 'compare Fn with a floating-point immediate', '$1.5, F2'),
    ],
    operands: 'Fm/Fn are F0–F31; $fconst is a floating-point immediate.',
    notes: 'Exactly two operands; a one-operand form is rejected.',
  },
  FCMPD: {
    forms: [
      f('Fm, Fn', 'compare Fn with Fm and set flags', 'F1, F2'),
      f('$fconst, Fn', 'compare Fn with a floating-point immediate', '$1.5, F2'),
    ],
    operands: 'Fm/Fn are F0–F31; $fconst is a floating-point immediate.',
    notes: 'Exactly two operands; a one-operand form is rejected.',
  },
};

for (const name of [
  'BEQ', 'BNE', 'BCS', 'BCC', 'BHS', 'BLO', 'BHI', 'BLS',
  'BGE', 'BLT', 'BGT', 'BLE', 'BMI', 'BPL', 'BVS', 'BVC',
]) {
  INSTRUCTION_SYNTAX[name] = BRANCH_FORMS;
}

const SUFFIXED_NAME = /^([A-Z][A-Z0-9]*)\.([PW])$/;

function lookup(name) {
  const exact = INSTRUCTION_SYNTAX[name];
  if (exact) {
    return exact;
  }
  const suffixed = SUFFIXED_NAME.exec(name);
  if (suffixed) {
    const base = lookup(suffixed[1]);
    if (!base) {
      return undefined;
    }
    const suffix = `.${suffixed[2]}`;
    const forms = base.forms.filter((form) => form.suffix === suffix);
    return forms.length > 0 ? { ...base, forms } : undefined;
  }
  if (name.endsWith('W')) {
    const base = INSTRUCTION_SYNTAX[name.slice(0, -1)];
    if (base) {
      return base;
    }
  }
  if (name.endsWith('S')) {
    return INSTRUCTION_SYNTAX[name.slice(0, -1)];
  }
  return undefined;
}

function instructionSyntax(name, arch) {
  if (arch !== 'arm64') {
    return undefined;
  }
  const entry = lookup(name);
  if (!entry) {
    return undefined;
  }
  const rows = entry.forms.map(({ args, effect, suffix }) => ({
    syntax: args
      ? `${name}${suffix && !name.endsWith(suffix) ? suffix : ''}  ${args}`
      : name,
    effect,
  }));
  const width = rows.reduce((max, row) => Math.max(max, row.syntax.length), 0);
  const lines = rows.map(({ syntax, effect }) => {
    const padded = syntax.padEnd(width);
    return effect ? `  ${padded}  // ${effect}` : `  ${syntax}`;
  });
  const parts = ['**Syntax**', '```asm', ...lines, '```'];
  if (entry.operands) {
    parts.push('', `Operands: ${entry.operands}`);
  }
  if (entry.notes) {
    parts.push('', `Note: ${entry.notes}`);
  }
  return parts.join('\n');
}

function syntaxEntry(name, arch) {
  if (arch !== 'arm64') {
    return undefined;
  }
  return lookup(name);
}

module.exports = {
  INSTRUCTION_SYNTAX,
  instructionSyntax,
  syntaxEntry,
};
