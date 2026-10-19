'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function firstExisting(candidates, fallback) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return fallback;
}

function resolveAsmfmt() {
  if (process.env.ASMFMT) {
    return process.env.ASMFMT;
  }
  return firstExisting(
    [
      path.join(os.homedir(), 'go', 'bin', 'asmfmt'),
      '/opt/homebrew/bin/asmfmt',
      '/usr/local/bin/asmfmt',
    ],
    'asmfmt'
  );
}

function resolveGo() {
  if (process.env.GO) {
    return process.env.GO;
  }
  return firstExisting(
    [
      '/opt/homebrew/bin/go',
      '/usr/local/go/bin/go',
      '/usr/local/bin/go',
      path.join(os.homedir(), 'go', 'bin', 'go'),
    ],
    'go'
  );
}

const asmfmt = resolveAsmfmt();
const go = resolveGo();
let gorootCache;

function execFile(file, args, options, input) {
  return new Promise((resolve, reject) => {
    const child = cp.execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        const message = (stderr || error.message || '').trim();
        reject(new Error(message || `${file} exited with code ${error.code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.on('error', () => {
      // The child may exit before stdin is fully written (e.g. `go env`).
    });
    child.stdin.end(input === undefined ? undefined : input);
  });
}

async function formatText(text) {
  const { stdout } = await execFile(
    asmfmt,
    [],
    { timeout: 10000, maxBuffer: 16 * 1024 * 1024 },
    text
  );
  return stdout;
}

async function runAsmfmt(args, cwd) {
  return execFile(asmfmt, args, {
    cwd,
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function getGoroot() {
  if (gorootCache) {
    return gorootCache;
  }
  if (process.env.GOROOT) {
    gorootCache = process.env.GOROOT;
    return gorootCache;
  }
  const { stdout } = await execFile(go, ['env', 'GOROOT'], { timeout: 5000 });
  gorootCache = stdout.trim();
  return gorootCache;
}

function headerSearchPaths(goroot, name) {
  return [
    path.join(goroot, 'pkg', 'include', name),
    path.join(goroot, 'src', 'runtime', name),
    path.join(goroot, 'src', 'cmd', 'internal', 'obj', name),
  ];
}

async function findHeader(name, documentPath, gorootOverride) {
  if (!name) {
    return undefined;
  }
  if (path.isAbsolute(name)) {
    return fs.existsSync(name) ? name : undefined;
  }

  // Relative includes are resolved against the source file first.
  if (documentPath) {
    const local = path.resolve(path.dirname(documentPath), name);
    if (fs.existsSync(local)) {
      return local;
    }
  }

  const roots = [];
  if (gorootOverride) {
    roots.push(gorootOverride);
  }
  try {
    roots.push(await getGoroot());
  } catch {
    // Fall through to the override (if any).
  }

  for (const root of new Set(roots)) {
    for (const candidate of headerSearchPaths(root, name)) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

const MACRO_HEADERS = ['textflag.h', 'funcdata.h'];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const fileLineCache = new Map();

function readCachedLines(file) {
  try {
    const stat = fs.statSync(file);
    const cached = fileLineCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.lines;
    }
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    fileLineCache.set(file, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      lines,
    });
    return lines;
  } catch {
    return undefined;
  }
}

async function findMacro(word, documentPath, gorootOverride) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(word)) {
    return undefined;
  }
  for (const header of MACRO_HEADERS) {
    const file = await findHeader(header, documentPath, gorootOverride);
    if (!file) {
      continue;
    }
    const lines = readCachedLines(file);
    if (!lines) {
      continue;
    }
    const re = new RegExp(`^\\s*#\\s*define\\s+${escapeRegExp(word)}\\b`);
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) {
        continue;
      }
      const comments = [];
      for (let j = i - 1; j >= 0; j--) {
        const comment = /^\s*\/\/\s?(.*)$/.exec(lines[j]);
        if (!comment) {
          break;
        }
        comments.unshift(comment[1]);
      }
      return {
        file,
        line: i,
        column: Math.max(0, lines[i].indexOf(word)),
        text: lines[i],
        comments,
      };
    }
  }
  return undefined;
}

function parseInclude(lineText) {
  const match = /^\s*#\s*include\s+["<]([^">]+)[">]/.exec(lineText);
  return match ? match[1] : undefined;
}

const fallbackInstructions = {
  arm64: [
    'MOVD', 'MOVW', 'MOVH', 'MOVB', 'MOVBU', 'MOVHU', 'MOVWU',
    'ADD', 'ADDS', 'SUB', 'SUBS', 'MUL', 'MADD', 'MSUB', 'SDIV', 'UDIV',
    'AND', 'ANDS', 'ORR', 'EOR', 'BIC', 'MVN', 'LSL', 'LSR', 'ASR', 'ROR',
    'CMP', 'CMN', 'TST', 'B', 'BL', 'BR', 'BLR', 'BEQ', 'BNE', 'BCS',
    'BCC', 'BMI', 'BPL', 'BVS', 'BVC', 'BHI', 'BLS', 'BGE', 'BLT', 'BGT',
    'BLE', 'CBZ', 'CBNZ', 'TBZ', 'TBNZ', 'RET', 'NOP', 'LDP', 'STP',
    'LDR', 'STR', 'LDRB', 'STRB', 'LDRH', 'STRH', 'LDAR', 'STLR',
    'FMOVS', 'FMOVD', 'FADD', 'FSUB', 'FMUL', 'FDIV', 'FABS', 'FNEG',
    'FSQRT', 'FCMP', 'CSEL', 'CSINC', 'CSINV', 'CSNEG', 'CSET', 'CSETM',
    'SXTB', 'SXTH', 'SXTW', 'UXTB', 'UXTH', 'UXTW', 'CLZ', 'RBIT',
    'REV', 'REV16', 'REV32',
  ],
  amd64: [
    'MOVQ', 'MOVL', 'MOVW', 'MOVB', 'ADDQ', 'ADDL', 'SUBQ', 'SUBL',
    'IMULQ', 'IDIVQ', 'ANDQ', 'ORQ', 'XORQ', 'CMPQ', 'CMPL', 'TESTQ',
    'TESTL', 'LEAQ', 'JMP', 'JZ', 'JNZ', 'JEQ', 'JNE', 'CALL', 'RET',
    'PUSHQ', 'POPQ', 'SHLQ', 'SHRQ', 'SARQ', 'MOVSS', 'MOVSD', 'ADDSS',
    'ADDSD', 'SUBSS', 'SUBSD', 'MULSS', 'MULSD', 'DIVSS', 'DIVSD',
    'CMPSS', 'CMPSD', 'CVTSI2SS', 'CVTSI2SD', 'CVTSS2SD', 'CVTSD2SS',
  ],
};

const KNOWN_ARCHES = [
  'arm64', 'arm', 'amd64', '386', 'ppc64le', 'ppc64', 's390x',
  'riscv64', 'loong64', 'mips64le', 'mips64', 'mipsle', 'mips', 'wasm',
];

const ARCH_DIRS = {
  arm64: 'arm64',
  arm: 'arm',
  amd64: 'x86',
  '386': 'x86',
  ppc64: 'ppc64',
  ppc64le: 'ppc64',
  s390x: 's390x',
  riscv64: 'riscv64',
  loong64: 'loong64',
  mips: 'mips',
  mipsle: 'mips',
  mips64: 'mips',
  mips64le: 'mips',
  wasm: 'wasm',
};

const GENERIC_INSTRUCTIONS = ['RET', 'NOP', 'WORD', 'DWORD', 'QUAD'];
const instructionCache = new Map();

const ARCH_PATTERNS = KNOWN_ARCHES.map((arch) => ({
  arch,
  suffix: `_${arch}.s`,
  positive: new RegExp(`(?<!!)\\b${arch}\\b`),
  negated: new RegExp(`!\\s*${arch}\\b`),
}));

function architectureFor(filePath, text) {
  const base = path.basename(filePath || '').toLowerCase();
  for (const pattern of ARCH_PATTERNS) {
    if (base.endsWith(pattern.suffix)) {
      return pattern.arch;
    }
  }

  const head = (text || '').split(/\r?\n/).slice(0, 8).join('\n');
  const build = /\/\/go:build\s+([^\n]+)/.exec(head);
  if (build) {
    const expression = build[1];
    let sawNegation = false;
    for (const pattern of ARCH_PATTERNS) {
      if (pattern.negated.test(expression)) {
        sawNegation = true;
      }
      if (
        pattern.positive.test(expression) &&
        !pattern.negated.test(expression)
      ) {
        return pattern.arch;
      }
    }
    if (sawNegation) {
      return undefined;
    }
  }

  if (process.arch === 'arm64') {
    return 'arm64';
  }
  if (process.arch === 'x64') {
    return 'amd64';
  }
  return undefined;
}

function fallbackFor(key) {
  if (key === '386') {
    return fallbackInstructions.amd64;
  }
  return fallbackInstructions[key] || GENERIC_INSTRUCTIONS;
}

async function getInstructionNames(arch, gorootOverride) {
  const key = arch || 'generic';
  const dir = ARCH_DIRS[key];
  if (!dir) {
    return GENERIC_INSTRUCTIONS;
  }

  const roots = [];
  if (gorootOverride) {
    roots.push(gorootOverride);
  }
  try {
    roots.push(await getGoroot());
  } catch {
    // Fall back to the override (if any).
  }

  const fallback = fallbackFor(key);
  for (const goroot of new Set(roots)) {
    const cacheKey = `${key}|${goroot}`;
    if (instructionCache.has(cacheKey)) {
      return instructionCache.get(cacheKey);
    }

    const file = path.join(
      goroot,
      'src',
      'cmd',
      'internal',
      'obj',
      dir,
      'anames.go'
    );
    try {
      const source = fs.readFileSync(file, 'utf8');
      const names = [...source.matchAll(/"([A-Z][A-Z0-9_]*)"/g)]
        .map((match) => match[1])
        .filter((name) => name !== 'LAST');
      const result = [...new Set([...names, ...GENERIC_INSTRUCTIONS])].sort();
      const final = result.length > 0 ? result : fallback;
      instructionCache.set(cacheKey, final);
      return final;
    } catch {
      // Try the next GOROOT candidate.
    }
  }
  return fallback;
}

module.exports = {
  architectureFor,
  findHeader,
  findMacro,
  formatText,
  getGoroot,
  getInstructionNames,
  parseInclude,
  resolveAsmfmt,
  runAsmfmt,
};
