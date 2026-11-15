'use strict';

// Human-readable instruction docs for hover and completion. Completion gets
// the authoritative mnemonic list from GOROOT; this map only supplies text for
// the arm64 instruction families covered by the handbook. Exact entries win;
// for arm64, a trailing W (32-bit form) or S (set flags) is derived from the
// base entry, so NEGW/NEGSW/ADDSW/CMPW/CBZW/... do not need separate rows.
// An un-suffixed mnemonic is the 64-bit form: arithmetic and compare mnemonics
// have no D width suffix (CMP is already 64-bit; there is no CMPD).
const INSTRUCTION_DOCS = {
  // 8.1 Data movement
  MOVD: 'Move a doubleword (64-bit on ARM64).',
  MOVW: 'Move a word (32-bit on ARM64).',
  MOVWU: 'Move an unsigned word (32-bit).',
  MOVH: 'Move a halfword (16-bit).',
  MOVHU: 'Move an unsigned halfword (16-bit).',
  MOVB: 'Move a byte (8-bit).',
  MOVBU: 'Move an unsigned byte (8-bit).',
  MOVZ: 'Move a 16-bit immediate into a register, clearing the other bits (64-bit).',
  MOVK: 'Move a 16-bit immediate into one halfword, keeping the other bits (64-bit).',
  MOVN: 'Move the bitwise complement of a 16-bit immediate (64-bit).',
  LDP: 'Load a pair of registers (64-bit).',
  STP: 'Store a pair of registers (64-bit).',
  LDPSW: 'Load a pair of signed words, sign-extending each to 64 bits.',
  LDAR: 'Load-acquire a 64-bit value.',
  STLR: 'Store-release a 64-bit value.',

  // 8.2 Arithmetic and logic
  ADD: 'Add (64-bit).',
  ADDS: 'Add and set the condition flags (64-bit).',
  SUB: 'Subtract (64-bit).',
  SUBS: 'Subtract and set the condition flags (64-bit).',
  MUL: 'Multiply (64-bit); overflow wraps instead of trapping.',
  MADD: 'Multiply-add (64-bit): `MADD Rm, Ra, Rn, Rd` computes `Rd = Ra + Rn*Rm`.',
  MSUB: 'Multiply-subtract (64-bit).',
  SDIV: 'Signed divide (64-bit); division by zero yields zero instead of trapping.',
  UDIV: 'Unsigned divide (64-bit); division by zero yields zero instead of trapping.',
  AND: 'Bitwise AND (64-bit).',
  ANDS: 'Bitwise AND and set the condition flags (64-bit).',
  ORR: 'Bitwise OR (64-bit).',
  EOR: 'Bitwise exclusive OR (64-bit).',
  BIC: 'Bit clear (64-bit): `BIC Rm, Rn, Rd` computes `Rd = Rn &^ Rm`.',
  BICS: 'Bit clear and set the condition flags (64-bit).',
  MVN: 'Bitwise NOT / move not (64-bit).',
  NEG: 'Negate (64-bit): `NEG Rm, Rd` computes `Rd = -Rm`.',
  NEGS: 'Negate and set the condition flags (64-bit).',
  LSL: 'Logical shift left (64-bit).',
  LSR: 'Logical shift right (64-bit).',
  ASR: 'Arithmetic shift right (64-bit).',
  ROR: 'Rotate right (64-bit).',
  TST: 'Test bits (64-bit): like ANDS but discards the result.',

  // 8.3 Compare and branch
  CMP: 'Compare (64-bit by default; there is no `CMPD`): `CMP Rm, Rn` sets flags from Rn - Rm, so Rn is the value being tested. `CMPW` compares only the low 32 bits.',
  CMN: 'Compare negative (64-bit by default; there is no `CMND`): sets flags from Rn + Rm. `CMNW` compares only the low 32 bits.',
  CCMP: 'Conditional compare (64-bit; `CCMPW` is the 32-bit form): compares only when the condition holds; otherwise writes the given NZCV flags.',
  CCMN: 'Conditional compare negative (64-bit; `CCMNW` is the 32-bit form): like CCMP but adds.',
  CBZ: 'Compare and branch if zero (64-bit): `CBZ Rn, label`. `CBZW` tests only the low 32 bits.',
  CBNZ: 'Compare and branch if non-zero (64-bit): `CBNZ Rn, label`. `CBNZW` tests only the low 32 bits.',
  TBZ: 'Test one bit and branch if it is zero (64-bit; there is no W form): `TBZ $bit, Rn, label`.',
  TBNZ: 'Test one bit and branch if it is non-zero (64-bit; there is no W form): `TBNZ $bit, Rn, label`.',
  B: 'Unconditional branch (alias of JMP).',
  BL: 'Branch with link: save the return address in LR, then branch (alias of CALL).',
  JMP: 'Jump to the address in a register (alias of BR).',
  CALL: 'Call the address in a register (alias of BLR).',
  RET: 'Return from the function.',

  // 8.4 Conditional select
  CSEL: 'Conditional select (64-bit; `CSELW` is the 32-bit form): `CSEL cond, Rn, Rm, Rd` picks Rn if cond holds, otherwise Rm.',
  CSET: 'Conditional set (64-bit; `CSETW` is the 32-bit form): write 1 if cond holds, otherwise 0.',
  CSETM: 'Conditional set mask (64-bit; `CSETMW` is the 32-bit form): write all ones if cond holds, otherwise 0.',
  CSINC: 'Conditional select increment (64-bit; `CSINCW` is the 32-bit form): pick Rn if cond holds, otherwise Rm+1.',
  CSINV: 'Conditional select invert (64-bit; `CSINVW` is the 32-bit form): pick Rn if cond holds, otherwise bitwise NOT of Rm.',
  CSNEG: 'Conditional select negate (64-bit; `CSNEGW` is the 32-bit form): pick Rn if cond holds, otherwise -Rm.',

  // Branch conditions
  BEQ: 'Branch if equal (Z set).',
  BNE: 'Branch if not equal (Z clear).',
  BCS: 'Branch if carry set: unsigned higher or same (>=). Alias of BHS.',
  BCC: 'Branch if carry clear: unsigned lower (<). Alias of BLO.',
  BHS: 'Branch if unsigned higher or same (>=). Alias of BCS.',
  BLO: 'Branch if unsigned lower (<). Alias of BCC.',
  BHI: 'Branch if unsigned higher (>).',
  BLS: 'Branch if unsigned lower or same (<=).',
  BGE: 'Branch if signed greater than or equal (>=).',
  BLT: 'Branch if signed less than (<).',
  BGT: 'Branch if signed greater than (>).',
  BLE: 'Branch if signed less than or equal (<=).',
  BMI: 'Branch if minus (N set).',
  BPL: 'Branch if plus or zero (N clear).',
  BVS: 'Branch if overflow set.',
  BVC: 'Branch if overflow clear.',

  // Extends, bit operations, and system instructions
  SXTB: 'Sign-extend a byte to 64 bits.',
  SXTH: 'Sign-extend a halfword to 64 bits.',
  SXTW: 'Sign-extend a word to 64 bits.',
  UXTB: 'Zero-extend a byte to 64 bits.',
  UXTH: 'Zero-extend a halfword to 64 bits.',
  UXTW: 'Zero-extend a word to 64 bits.',
  CLZ: 'Count leading zeros (64-bit).',
  RBIT: 'Reverse the bit order (64-bit).',
  REV: 'Reverse the byte order (64-bit).',
  REV16: 'Reverse the byte order within each halfword (64-bit).',
  REV32: 'Reverse the byte order within each 32-bit word of a 64-bit register.',
  SVC: 'Supervisor call: `SVC $imm` traps to the kernel.',
  NOP: 'No operation.',

  // Floating point. Go arm64 requires the D/S suffix: FADDD/FADDS, not FADD.
  // Here D means double precision (as in FCMPD), not a 64-bit integer width.
  FMOVS: 'Move a single-precision floating-point value.',
  FMOVD: 'Move a double-precision floating-point value.',
  FADDS: 'Single-precision floating-point add.',
  FADDD: 'Double-precision floating-point add.',
  FSUBS: 'Single-precision floating-point subtract.',
  FSUBD: 'Double-precision floating-point subtract.',
  FMULS: 'Single-precision floating-point multiply.',
  FMULD: 'Double-precision floating-point multiply.',
  FDIVS: 'Single-precision floating-point divide.',
  FDIVD: 'Double-precision floating-point divide.',
  FABSS: 'Single-precision floating-point absolute value.',
  FABSD: 'Double-precision floating-point absolute value.',
  FNEGS: 'Single-precision floating-point negate.',
  FNEGD: 'Double-precision floating-point negate.',
  FSQRTS: 'Single-precision floating-point square root.',
  FSQRTD: 'Double-precision floating-point square root.',
  FCMPS: 'Single-precision floating-point compare.',
  FCMPD: 'Double-precision floating-point compare.',
};

const ARM64_W_NOTE = '32-bit (W) form: operates on the low 32 bits.';
const ARM64_S_NOTE = 'Also sets the condition flags (N/Z/C/V).';

// Exact docs first. W/S derivation is arm64-only: NEGW means a 16-bit negate
// on amd64, so deriving the arm64 meaning there would be wrong.
function instructionDoc(name, arch) {
  const exact = INSTRUCTION_DOCS[name];
  if (exact) {
    return exact;
  }
  if (arch !== 'arm64') {
    return undefined;
  }
  if (name.endsWith('W')) {
    const base = instructionDoc(name.slice(0, -1), arch);
    return base ? `${base} ${ARM64_W_NOTE}` : undefined;
  }
  if (name.endsWith('S')) {
    const base = instructionDoc(name.slice(0, -1), arch);
    return base ? `${base} ${ARM64_S_NOTE}` : undefined;
  }
  return undefined;
}

// Variants that are derived at lookup time. Listing them explicitly keeps the
// fallback completion list complete even when GOROOT cannot be read.
const ARM64_DERIVED_VARIANTS = [
  'ADDW', 'ADDSW', 'SUBW', 'SUBSW',
  'MULW', 'MADDW', 'MSUBW', 'SDIVW', 'UDIVW',
  'ANDW', 'ANDSW', 'ORRW', 'EORW', 'BICW', 'BICSW', 'MVNW',
  'NEGW', 'NEGSW', 'LSLW', 'LSRW', 'ASRW', 'RORW',
  'CMPW', 'CMNW', 'CCMPW', 'CCMNW', 'TSTW',
  'CBZW', 'CBNZW',
  'CSELW', 'CSETW', 'CSETMW', 'CSINCW', 'CSINVW', 'CSNEGW',
  'MOVZW', 'MOVKW', 'MOVNW', 'LDPW', 'STPW',
  'REVW', 'REV16W', 'CLZW', 'RBITW',
];

const ARM64_FALLBACK = [
  ...new Set([...Object.keys(INSTRUCTION_DOCS), ...ARM64_DERIVED_VARIANTS]),
].sort();

const AMD64_FALLBACK = [
  'MOVQ', 'MOVL', 'MOVW', 'MOVB', 'ADDQ', 'ADDL', 'SUBQ', 'SUBL',
  'IMULQ', 'IDIVQ', 'ANDQ', 'ORQ', 'XORQ', 'CMPQ', 'CMPL', 'TESTQ',
  'TESTL', 'LEAQ', 'JMP', 'JEQ', 'JNE', 'CALL', 'RET',
  'PUSHQ', 'POPQ', 'SHLQ', 'SHRQ', 'SARQ', 'MOVSS', 'MOVSD', 'ADDSS',
  'ADDSD', 'SUBSS', 'SUBSD', 'MULSS', 'MULSD', 'DIVSS', 'DIVSD',
  'CMPSS', 'CMPSD', 'VCVTSI2SSQ', 'VCVTSI2SSL', 'VCVTSI2SDQ', 'VCVTSI2SDL',
  'CVTSS2SD', 'CVTSD2SS',
];

const fallbackInstructions = {
  arm64: ARM64_FALLBACK,
  amd64: AMD64_FALLBACK,
};

module.exports = {
  ARM64_DERIVED_VARIANTS,
  INSTRUCTION_DOCS,
  fallbackInstructions,
  instructionDoc,
};
