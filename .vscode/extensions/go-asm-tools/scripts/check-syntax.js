#!/usr/bin/env node
'use strict';

// Verifies that every documented arm64 mnemonic has operand syntax and that
// every listed form assembles. Negative cases pin the forms we deliberately do
// not document (immediate where only registers are allowed, no short form).

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { INSTRUCTION_DOCS, ARM64_DERIVED_VARIANTS } = require('../instruction-data');
const { INSTRUCTION_SYNTAX, instructionSyntax, syntaxEntry } = require('../instruction-syntax');
const { resolveGo } = require('../tooling');

const goBin = resolveGo();

function goroot() {
  if (process.env.GOROOT) {
    return process.env.GOROOT;
  }
  return cp
    .execFileSync(goBin, ['env', 'GOROOT'], {
      encoding: 'utf8',
    })
    .trim();
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goasm-syntax-'));
const includeDir = path.join(goroot(), 'pkg', 'include');

function assemble(instruction, index) {
  const source = [
    '#include "textflag.h"',
    'GLOBL ·foo(SB), NOPTR, $16',
    'TEXT ·syntax(SB), NOSPLIT, $0-0',
    `\t${instruction}`,
    'lbl:',
    '\tNOP',
    '\tRET',
    '',
  ].join('\n');
  const file = path.join(tempDir, `case${index}.s`);
  const object = path.join(tempDir, `case${index}.o`);
  fs.writeFileSync(file, source);
  try {
    cp.execFileSync(
      goBin,
      ['tool', 'asm', '-I', includeDir, '-o', object, file],
      {
        encoding: 'utf8',
        env: { ...process.env, GOARCH: 'arm64' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    return undefined;
  } catch (error) {
    const output = `${error.stderr || ''}${error.stdout || ''}`;
    return output.trim().split('\n')[0] || error.message;
  }
}

const INVALID = [
  ['MUL $2, R1, R2', 'MUL takes registers only'],
  ['SDIV $2, R1, R2', 'SDIV takes registers only'],
  ['CMP R1', 'CMP has no one-operand form'],
  ['CMN R1', 'CMN has no one-operand form'],
  ['NEG R1', 'NEG has no one-operand form'],
  ['MVN R1', 'MVN has no one-operand form'],
  ['TST R1', 'TST has no one-operand form'],
  ['CBZ $1, lbl', 'CBZ requires a register'],
  ['TBZ R2, R1, lbl', 'TBZ requires an immediate bit number'],
  ['JMP R1', 'JMP requires parentheses for a register target'],
  ['MOVD F1, R1', 'MOVD does not move between R and F registers'],
  ['MOVD $1, (R1)', 'only $0 is special-cased to ZR for an immediate store'],
  ['MOVD.P R1, R2', 'post-index requires a base register in the address'],
  ['STP.P (R1, R2), 7(R3)', 'pair writeback offset must be a multiple of 8'],
  ['MOVH $1, R1', 'MOVH does not accept an immediate'],
  ['MOVWU $1, R1', 'MOVWU does not accept an immediate'],
  ['MOVB $1, R1', 'MOVB does not accept an immediate'],
  ['CSEL EQ, R1, R2', 'CSEL has no three-operand shorthand'],
  ['CSEL EQ, R1, R2, RSP', 'CSEL rejects SP as a destination'],
  ['CSET EQ, R2, R3', 'CSET has no three-operand form'],
  ['MADD R1, R2, R3', 'MADD has no three-operand shorthand'],
  ['ADD R1, R2<<2, R3', 'only the first source may be shifted'],
  ['AND R1.SXTH, R2, R3', 'logical forms do not accept extended registers'],
  ['LDAR 8(R1), R2', 'LDAR accepts only zero offset'],
  ['LDP (R1), R2', 'LDP requires a register pair destination'],
  ['STP R1, R2, (R3)', 'STP requires a register pair source'],
  ['FADDD ZR, F2, F3', 'floating-point forms reject general registers'],
];

function main() {
  const errors = [];
  const docs = Object.keys(INSTRUCTION_DOCS);
  const names = [...new Set([...docs, ...ARM64_DERIVED_VARIANTS, 'LDARW', 'STLRW'])];

  for (const name of Object.keys(INSTRUCTION_SYNTAX)) {
    if (!docs.includes(name)) {
      errors.push(`syntax entry ${name} has no matching instruction doc`);
    }
  }

  // Hover looks up dotted names such as MOVD.P separately; each lookup must
  // yield exactly the rows carrying that suffix, and only when the base entry
  // documents the suffix at all.
  for (const [name, entry] of Object.entries(INSTRUCTION_SYNTAX)) {
    for (const suffix of ['.P', '.W']) {
      const forms = entry.forms.filter((form) => form.suffix === suffix);
      const dotted = syntaxEntry(`${name}${suffix}`, 'arm64');
      if (forms.length > 0 && !dotted) {
        errors.push(`missing suffixed syntax: ${name}${suffix}`);
      }
      if (forms.length === 0 && dotted) {
        errors.push(`unexpected suffixed syntax: ${name}${suffix}`);
      }
      if (dotted && dotted.forms.some((form) => form.suffix !== suffix)) {
        errors.push(`suffixed syntax leaks other forms: ${name}${suffix}`);
      }
    }
  }

  let checked = 0;
  let index = 0;
  for (const name of names) {
    if (!instructionSyntax(name, 'arm64')) {
      errors.push(`missing arm64 syntax: ${name}`);
      continue;
    }
    const entry = syntaxEntry(name, 'arm64');
    if (!entry) {
      continue;
    }
    for (const form of entry.forms) {
      const instruction = `${name}${form.suffix || ''} ${form.example}`.trim();
      const failure = assemble(instruction, index);
      index += 1;
      checked += 1;
      if (failure) {
        errors.push(`does not assemble: ${instruction} (${failure})`);
      }
    }
  }

  for (const [instruction] of INVALID) {
    const failure = assemble(instruction, index);
    index += 1;
    if (!failure) {
      errors.push(`unexpectedly assembles: ${instruction}`);
    }
  }

  if (errors.length > 0) {
    console.error('check-syntax: FAILED');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `check-syntax: OK (${names.length} mnemonics, ${checked} valid forms, ` +
      `${INVALID.length} invalid forms)`
  );
}

try {
  main();
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
