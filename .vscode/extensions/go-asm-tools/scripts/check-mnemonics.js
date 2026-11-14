#!/usr/bin/env node
'use strict';

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  INSTRUCTION_DOCS,
  fallbackInstructions,
  instructionDoc,
} = require('../instruction-data');
const {
  ARCH_ALIASES,
  architectureFor,
  getInstructionNames,
} = require('../tooling');

const extensionRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(extensionRoot, '..', '..', '..');
const handbookPath = path.join(extensionRoot, 'handbook', 'ASM-HANDBOOK.md');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function goroot() {
  if (process.env.GOROOT) {
    return process.env.GOROOT;
  }
  return cp
    .execFileSync(process.env.GO || 'go', ['env', 'GOROOT'], {
      encoding: 'utf8',
    })
    .trim();
}

function addStrings(target, source) {
  for (const match of source.matchAll(/"([A-Z][A-Z0-9_]*)"/g)) {
    if (match[1] !== 'LAST' && match[1] !== 'XXX') {
      target.add(match[1]);
    }
  }
}

function loadOpcodeSets(root) {
  const util = read(
    path.join(root, 'src', 'cmd', 'internal', 'obj', 'util.go')
  );
  const common = new Set();
  const block = /var Anames = \[\]string\{([\s\S]*?)\n\}/.exec(util);
  if (block) {
    addStrings(common, block[1]);
  }

  const sets = {};
  for (const [arch, dir] of Object.entries({ arm64: 'arm64', amd64: 'x86' })) {
    const names = new Set(common);
    const anames = read(
      path.join(root, 'src', 'cmd', 'internal', 'obj', dir, 'anames.go')
    );
    addStrings(names, anames);
    for (const alias of ARCH_ALIASES[arch] || []) {
      names.add(alias);
    }
    sets[arch] = names;
  }
  return sets;
}

function handbookMnemonics() {
  const text = read(handbookPath);
  const start = text.indexOf('## 8. 指令参考');
  const end = text.indexOf('## 9. 条件码');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('cannot locate handbook section 8');
  }

  const names = new Set();
  for (const line of text.slice(start, end).split('\n')) {
    if (!line.startsWith('| `')) {
      continue;
    }
    const firstCell = line.split('|')[1] || '';
    for (const match of firstCell.matchAll(/`([A-Z][A-Z0-9]*)`/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith('.s')) {
      out.push(full);
    }
  }
  return out;
}

function projectMnemonics() {
  const names = new Map();
  const directives = new Set([
    'TEXT',
    'DATA',
    'GLOBL',
    'FUNCDATA',
    'PCDATA',
  ]);

  for (const file of walk(workspaceRoot, [])) {
    const text = read(file);
    if (architectureFor(file, text) !== 'arm64') {
      continue;
    }
    for (const line of text.split('\n')) {
      const match = /^\s+([A-Z][A-Z0-9]*)\b/.exec(line);
      if (!match || directives.has(match[1])) {
        continue;
      }
      if (!names.has(match[1])) {
        names.set(match[1], file);
      }
    }
  }
  return names;
}

function reportInvalid(errors, label, names, valid) {
  const invalid = [...names].filter((name) => !valid.has(name)).sort();
  if (invalid.length > 0) {
    errors.push(`${label}: ${invalid.join(', ')}`);
  }
}

async function main() {
  const sets = loadOpcodeSets(goroot());
  const errors = [];

  reportInvalid(
    errors,
    'INSTRUCTION_DOCS not in arm64 opcodes',
    Object.keys(INSTRUCTION_DOCS),
    sets.arm64
  );

  reportInvalid(
    errors,
    'arm64 completion not in opcodes',
    await getInstructionNames('arm64'),
    sets.arm64
  );

  for (const name of ['NEGW', 'NEGSW', 'ADDSW', 'SUBSW', 'CMPW', 'CSELW', 'CBZW']) {
    if (!/32-bit/.test(instructionDoc(name, 'arm64') || '')) {
      errors.push(`missing derived arm64 hover doc: ${name}`);
    }
    if (instructionDoc(name, 'amd64')) {
      errors.push(`amd64 must not get an arm64-derived hover doc: ${name}`);
    }
  }
  for (const arch of ['arm64', 'amd64']) {
    reportInvalid(
      errors,
      `fallback ${arch} not in opcodes`,
      fallbackInstructions[arch],
      sets[arch]
    );
  }

  const handbook = handbookMnemonics();
  reportInvalid(
    errors,
    'handbook 8.x not in arm64 opcodes',
    handbook,
    sets.arm64
  );

  const project = projectMnemonics();
  for (const [name, file] of project) {
    const relative = path.relative(workspaceRoot, file);
    if (!sets.arm64.has(name)) {
      errors.push(`project mnemonic ${name} (${relative}) not in arm64 opcodes`);
    } else if (!instructionDoc(name, 'arm64')) {
      errors.push(`project mnemonic ${name} (${relative}) has no hover doc`);
    }
  }

  if (errors.length > 0) {
    console.error('check-mnemonics: FAILED');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `check-mnemonics: OK (${Object.keys(INSTRUCTION_DOCS).length} docs, ` +
      `${fallbackInstructions.arm64.length} arm64 fallback, ` +
      `${handbook.size} handbook, ${project.size} project mnemonics)`
  );
}

main().catch((error) => {
  console.error(`check-mnemonics: ${error.message || error}`);
  process.exit(1);
});
