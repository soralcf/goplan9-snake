'use strict';

const crypto = require('crypto');
const path = require('path');
const vscode = require('vscode');
const tooling = require('./tooling');
const { renderMarkdown } = require('./markdown');

const selector = { language: 'go.asm', scheme: 'file' };
const output = vscode.window.createOutputChannel('Go Assembly');
let warnedMissingAsmfmt = false;
let warnedMissingGofmt = false;
let handbookPanel;

const DIRECTIVES = {
  TEXT: 'Declares a function symbol: `TEXT symbol(SB), flags, $framesize-argsize`.',
  DATA: 'Declares initialized data: `DATA symbol+offset(SB)/width, value`.',
  GLOBL: 'Declares a global symbol: `GLOBL symbol(SB), flags, size`.',
  FUNCDATA: 'Attaches GC metadata to the current function.',
  PCDATA: 'Attaches PC-value table metadata to the current function.',
};

const FLAGS = {
  NOSPLIT: "Don't insert a stack check preamble.",
  NOFRAME: 'Do not insert frame pointer save/restore instructions.',
  RODATA: 'Put this data in a read-only section.',
  NOPTR: 'This data contains no pointers.',
  DUPOK: 'Allow multiple definitions; the linker picks one.',
  WRAPPER: 'Mark this function as a wrapper (no frame).',
  NEEDCTXT: 'Pass the closure context pointer in the context register.',
  TLSBSS: 'TLS BSS symbol.',
  LOCAL: 'Local symbol.',
  USEFIELD: 'Use the field offset.',
  GO_ARGS: 'The Go prototype defines the argument pointer map.',
  GO_RESULTS_INITIALIZED: 'The result slots are already initialized.',
  NO_LOCAL_POINTERS: 'The frame contains no local pointers.',
};

const REGISTER_DOCS = {
  FP: 'Frame pointer pseudo-register.',
  SP: 'Stack pointer.',
  SB: 'Static base pseudo-register.',
  PC: 'Program counter.',
  ZR: 'ARM64 zero register.',
  LR: 'ARM64 link register (alias for R30).',
  TLS: 'TLS pseudo-register.',
};

const INSTRUCTION_DOCS = {
  MOVD: 'Move a doubleword (64-bit on ARM64).',
  MOVW: 'Move a word.',
  MOVH: 'Move a halfword.',
  MOVB: 'Move a byte.',
  MOVBU: 'Move an unsigned byte.',
  MOVHU: 'Move an unsigned halfword.',
  MOVWU: 'Move an unsigned word.',
  ADD: 'Add.',
  ADDS: 'Add and set flags.',
  SUB: 'Subtract.',
  SUBS: 'Subtract and set flags.',
  MUL: 'Multiply.',
  SDIV: 'Signed divide.',
  UDIV: 'Unsigned divide.',
  AND: 'Bitwise AND.',
  ORR: 'Bitwise OR.',
  EOR: 'Bitwise exclusive OR.',
  CMP: 'Compare.',
  B: 'Branch.',
  BL: 'Branch with link.',
  BEQ: 'Branch if equal.',
  BNE: 'Branch if not equal.',
  CBZ: 'Compare and branch if zero.',
  CBNZ: 'Compare and branch if non-zero.',
  LDP: 'Load pair.',
  STP: 'Store pair.',
  FMOVD: 'Move a double-precision floating-point value.',
  FADD: 'Floating-point add.',
  RET: 'Return from the function.',
};

const BRANCH_LINE = /^\s*(B|BL|BR|BLR|BEQ|BNE|BCS|BCC|BMI|BPL|BVS|BVC|BHI|BLS|BGE|BLT|BGT|BLE|CBZ|CBNZ|TBZ|TBNZ)\s+[A-Za-z_]*$/;

const SNIPPETS = [
  {
    label: 'TEXT function',
    detail: 'TEXT ·name(SB), flags, $framesize-argsize',
    insertText: 'TEXT ·${1:name}(SB), ${2|NOSPLIT,NOFRAME,0|}, \\$${3:0-0}',
  },
  {
    label: 'DATA template',
    detail: 'DATA ·symbol+offset(SB)/width, value',
    insertText: 'DATA ·${1:symbol}+${2:0}(SB)/${3:8}, \\$${4:0}',
  },
  {
    label: 'GLOBL template',
    detail: 'GLOBL ·symbol(SB), flags, size',
    insertText: 'GLOBL ·${1:symbol}(SB), ${2|RODATA,NOPTR,DUPOK|}, \\$${3:8}',
  },
  {
    label: '#include textflag.h',
    detail: 'Go assembly flags such as NOSPLIT/RODATA',
    insertText: '#include "textflag.h"',
  },
  {
    label: '#include funcdata.h',
    detail: 'Go assembly GC metadata macros',
    insertText: '#include "funcdata.h"',
  },
  {
    label: 'MOVD immediate',
    detail: 'MOVD $imm, Rn',
    insertText: 'MOVD \\$${1:0}, ${2:R0}',
  },
  {
    label: 'ADD registers',
    detail: 'ADD Rn, Rm',
    insertText: 'ADD ${1:R0}, ${2:R1}',
  },
];

const ARM64_REGISTERS = (() => {
  const registers = [];
  for (let i = 0; i <= 30; i++) {
    registers.push(`R${i}`);
  }
  for (let i = 0; i <= 31; i++) {
    registers.push(`V${i}`, `F${i}`);
  }
  registers.push('ZR', 'FP', 'SP', 'SB', 'PC', 'LR', 'TLS');
  return [...new Set(registers)];
})();

const ARM_REGISTERS = (() => {
  const registers = [];
  for (let i = 0; i <= 15; i++) {
    registers.push(`R${i}`);
  }
  registers.push('FP', 'SP', 'SB', 'PC', 'LR');
  return [...new Set(registers)];
})();

const AMD64_REGISTERS = (() => {
  const registers = [
    'AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'BP', 'SP', 'FP', 'SB', 'PC', 'TLS',
  ];
  for (let i = 8; i <= 15; i++) {
    registers.push(`R${i}`);
  }
  for (let i = 0; i <= 15; i++) {
    registers.push(`X${i}`, `Y${i}`);
  }
  for (let i = 0; i <= 31; i++) {
    registers.push(`Z${i}`);
  }
  return [...new Set(registers)];
})();

const COMMON_REGISTERS = ['FP', 'SP', 'SB', 'PC', 'TLS'];

function registersFor(arch) {
  if (arch === 'arm64') {
    return ARM64_REGISTERS;
  }
  if (arch === 'arm') {
    return ARM_REGISTERS;
  }
  if (arch === 'amd64' || arch === '386') {
    return AMD64_REGISTERS;
  }
  return COMMON_REGISTERS;
}

function registerDoc(register, arch) {
  if (REGISTER_DOCS[register]) {
    return REGISTER_DOCS[register];
  }
  if (arch === 'amd64' || arch === '386') {
    if (/^[XYZ]\d+$/.test(register)) {
      return 'amd64 vector register.';
    }
    return 'amd64 general-purpose register.';
  }
  if (arch === 'arm64') {
    if (/^R\d+$/.test(register)) {
      return 'ARM64 general-purpose register.';
    }
    if (/^V\d+$/.test(register)) {
      return 'ARM64 SIMD/FP vector register. Add a lane suffix such as `.S` or `.D` when needed.';
    }
    if (/^F\d+$/.test(register)) {
      return 'ARM64 floating-point register (alias of the corresponding V register).';
    }
  }
  if (arch === 'arm' && /^R\d+$/.test(register)) {
    return 'ARM general-purpose register.';
  }
  return 'Register.';
}

function isRegister(word, arch) {
  return registersFor(arch).includes(word);
}

function messageOf(error) {
  return error && error.message ? error.message : String(error);
}

function gorootOverride() {
  return vscode.workspace.getConfiguration('go').get('goroot') || undefined;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function minimalEdit(document, before, after) {
  if (before === after) {
    return [];
  }

  let start = 0;
  const sharedLength = Math.min(before.length, after.length);
  while (
    start < sharedLength &&
    before.charCodeAt(start) === after.charCodeAt(start)
  ) {
    start++;
  }

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)
  ) {
    beforeEnd--;
    afterEnd--;
  }

  const range = new vscode.Range(
    document.positionAt(start),
    document.positionAt(beforeEnd)
  );
  return [vscode.TextEdit.replace(range, after.slice(start, afterEnd))];
}

function collectLabels(text) {
  const labels = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_.$·][\w.$·<>]*):/.exec(line);
    if (match) {
      labels.add(match[1]);
    }
  }
  return [...labels];
}

function includeAt(document, position) {
  const line = document.lineAt(position.line).text;
  const name = tooling.parseInclude(line);
  if (!name) {
    return undefined;
  }
  const start = line.indexOf(name);
  const end = start + name.length;
  if (start < 0 || position.character < start || position.character > end) {
    return undefined;
  }
  return name;
}

function findLocalLabel(document, word) {
  const lines = document.getText().split(/\r?\n/);
  const pattern = new RegExp(`^\\s*${escapeRegExp(word)}:`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      const character = lines[i].indexOf(word);
      return new vscode.Location(
        document.uri,
        new vscode.Position(i, Math.max(0, character))
      );
    }
  }
  return undefined;
}

// 0-based line numbers the user is currently editing: cursor and every
// selection in the active editor for this document. Auto Save must not
// rewrite them, otherwise an unfinished instruction is reformatted mid-typing.
function editingLines(document) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
    return [];
  }
  const lines = new Set();
  for (const selection of editor.selections) {
    for (let line = selection.start.line; line <= selection.end.line; line++) {
      lines.add(line);
    }
  }
  return [...lines];
}

async function formattingEdits(document, protectedLines) {
  const before = document.getText();
  const version = document.version;
  const masked = tooling.maskLines(
    before,
    protectedLines || [],
    (id) => `\tNOP //${id}`
  );
  let after;
  try {
    after = await tooling.formatText(masked.text);
  } catch (error) {
    const message = messageOf(error);
    output.appendLine(`[format] ${document.uri.fsPath}: ${message}`);
    if (!warnedMissingAsmfmt && /ENOENT|not found|No such file/i.test(message)) {
      warnedMissingAsmfmt = true;
      vscode.window.showErrorMessage(
        'Go Assembly: asmfmt not found. Install it or set the ASMFMT environment variable.'
      );
    }
    return [];
  }
  // Do not clobber edits made while asmfmt was running.
  if (document.version !== version) {
    return [];
  }
  return minimalEdit(document, before, masked.restore(after));
}

class AsmFormatter {
  provideDocumentFormattingEdits(document) {
    return formattingEdits(document);
  }
}

async function goFormattingEdits(document, protectedLines) {
  const before = document.getText();
  const version = document.version;
  const masked = tooling.maskLines(before, protectedLines || []);
  let after;
  try {
    after = await tooling.formatGoText(masked.text);
  } catch (error) {
    const message = messageOf(error);
    output.appendLine(`[gofmt] ${document.uri.fsPath}: ${message}`);
    if (!warnedMissingGofmt && /ENOENT|not found|No such file/i.test(message)) {
      warnedMissingGofmt = true;
      vscode.window.showErrorMessage(
        'Go Assembly: gofmt not found. Install Go or set the GOFMT environment variable.'
      );
    }
    return [];
  }
  // Do not clobber edits made while gofmt was running.
  if (document.version !== version) {
    return [];
  }
  return minimalEdit(document, before, masked.restore(after));
}

class AsmDefinitionProvider {
  async provideDefinition(document, position) {
    const include = includeAt(document, position);
    if (include) {
      const file = await tooling.findHeader(
        include,
        document.uri.fsPath,
        gorootOverride()
      );
      if (file) {
        return new vscode.Location(vscode.Uri.file(file), new vscode.Position(0, 0));
      }
      return undefined;
    }

    const range = document.getWordRangeAtPosition(
      position,
      /[A-Za-z_][A-Za-z0-9_]*/
    );
    if (!range) {
      return undefined;
    }
    const word = document.getText(range);

    const definition = await tooling.findMacro(
      word,
      document.uri.fsPath,
      gorootOverride()
    );
    if (definition) {
      return new vscode.Location(
        vscode.Uri.file(definition.file),
        new vscode.Position(definition.line, definition.column)
      );
    }

    return findLocalLabel(document, word);
  }
}

class AsmHoverProvider {
  async provideHover(document, position) {
    const include = includeAt(document, position);
    if (include) {
      const file = await tooling.findHeader(
        include,
        document.uri.fsPath,
        gorootOverride()
      );
      if (!file) {
        return undefined;
      }
      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown('**Go assembly include**\n\n');
      markdown.appendCodeblock(file, 'text');
      return new vscode.Hover(markdown);
    }

    const range = document.getWordRangeAtPosition(
      position,
      /[A-Za-z_][A-Za-z0-9_]*/
    );
    if (!range) {
      return undefined;
    }
    const word = document.getText(range);

    const definition = await tooling.findMacro(
      word,
      document.uri.fsPath,
      gorootOverride()
    );
    if (definition) {
      const markdown = new vscode.MarkdownString();
      if (definition.comments.length > 0) {
        markdown.appendMarkdown(`${definition.comments.join(' ')}\n\n`);
      }
      markdown.appendCodeblock(definition.text.trim(), 'c');
      markdown.appendMarkdown(
        `\n\nDefined in \`${definition.file}:${definition.line + 1}\``
      );
      return new vscode.Hover(markdown, range);
    }

    if (DIRECTIVES[word]) {
      return new vscode.Hover(new vscode.MarkdownString(DIRECTIVES[word]), range);
    }
    if (FLAGS[word]) {
      return new vscode.Hover(new vscode.MarkdownString(FLAGS[word]), range);
    }
    if (INSTRUCTION_DOCS[word]) {
      return new vscode.Hover(
        new vscode.MarkdownString(INSTRUCTION_DOCS[word]),
        range
      );
    }

    const arch = tooling.architectureFor(
      document.uri.fsPath,
      document.getText()
    );
    if (isRegister(word, arch)) {
      return new vscode.Hover(
        new vscode.MarkdownString(registerDoc(word, arch)),
        range
      );
    }
    return undefined;
  }
}

class AsmCompletionProvider {
  async provideCompletionItems(document, position) {
    const line = document.lineAt(position.line).text;
    const before = line.slice(0, position.character);
    const wordRange = document.getWordRangeAtPosition(
      position,
      /[A-Za-z0-9_.·$<>]+/
    );
    const range = wordRange || new vscode.Range(position, position);
    const word = wordRange ? document.getText(wordRange) : '';

    const includeFile = /^\s*#\s*include\s+"([^"]*)$/.exec(before);
    if (includeFile) {
      const start = before.lastIndexOf('"') + 1;
      const includeRange = new vscode.Range(
        position.line,
        start,
        position.line,
        position.character
      );
      return ['textflag.h', 'funcdata.h', 'go_asm.h'].map((header) => {
        const item = new vscode.CompletionItem(
          header,
          vscode.CompletionItemKind.File
        );
        item.detail = 'Go assembly header';
        item.range = includeRange;
        item.documentation = new vscode.MarkdownString(
          `\`#include "${header}"\``
        );
        return item;
      });
    }

    if (/^\s*#\s*(include)?\s*$/i.test(before)) {
      const hash = before.lastIndexOf('#');
      const item = new vscode.CompletionItem(
        '#include',
        vscode.CompletionItemKind.Snippet
      );
      item.detail = 'Go assembly include';
      item.insertText = '#include "${1|textflag.h,funcdata.h,go_asm.h|}"';
      item.insertTextFormat = vscode.InsertTextFormat.Snippet;
      item.range = new vscode.Range(
        position.line,
        Math.max(0, hash),
        position.line,
        position.character
      );
      return [item];
    }

    const text = document.getText();
    const arch = tooling.architectureFor(document.uri.fsPath, text);
    const labels = collectLabels(text);
    const items = [];

    if (/^[RVFXYZ]\d*$/i.test(word)) {
      for (const register of registersFor(arch)) {
        const item = new vscode.CompletionItem(
          register,
          vscode.CompletionItemKind.Variable
        );
        item.detail = 'register';
        item.documentation = new vscode.MarkdownString(
          registerDoc(register, arch)
        );
        item.range = range;
        item.sortText = `0${register}`;
        items.push(item);
      }
      for (const label of labels) {
        const item = new vscode.CompletionItem(
          label,
          vscode.CompletionItemKind.Reference
        );
        item.detail = 'local label';
        item.range = range;
        item.sortText = `1${label}`;
        items.push(item);
      }
      return items;
    }

    if (BRANCH_LINE.test(before)) {
      for (const label of labels) {
        const item = new vscode.CompletionItem(
          label,
          vscode.CompletionItemKind.Reference
        );
        item.detail = 'local label';
        item.range = range;
        item.sortText = `0${label}`;
        items.push(item);
      }
      return items;
    }

    const instructions = await tooling.getInstructionNames(
      arch,
      gorootOverride()
    );

    for (const [name, doc] of Object.entries(DIRECTIVES)) {
      const item = new vscode.CompletionItem(
        name,
        vscode.CompletionItemKind.Keyword
      );
      item.detail = 'Go assembly directive';
      item.documentation = new vscode.MarkdownString(doc);
      item.range = range;
      item.sortText = `1${name}`;
      items.push(item);
    }

    for (const [name, doc] of Object.entries(FLAGS)) {
      const item = new vscode.CompletionItem(
        name,
        vscode.CompletionItemKind.Constant
      );
      item.detail = 'TEXT/GLOBL flag';
      item.documentation = new vscode.MarkdownString(doc);
      item.range = range;
      item.sortText = `3${name}`;
      items.push(item);
    }

    for (const register of registersFor(arch)) {
      const item = new vscode.CompletionItem(
        register,
        vscode.CompletionItemKind.Variable
      );
      item.detail = 'register';
      item.documentation = new vscode.MarkdownString(
        registerDoc(register, arch)
      );
      item.range = range;
      item.sortText = `4${register}`;
      items.push(item);
    }

    const reserved = new Set([...Object.keys(DIRECTIVES), ...Object.keys(FLAGS)]);
    const prefix = word.toUpperCase();
    for (const name of instructions) {
      if (reserved.has(name) || (prefix && !name.startsWith(prefix))) {
        continue;
      }
      const item = new vscode.CompletionItem(
        name,
        vscode.CompletionItemKind.Keyword
      );
      item.detail =
        arch === 'amd64' || arch === '386'
          ? 'amd64 instruction'
          : arch === 'arm64'
            ? 'ARM64 instruction'
            : 'Go assembly instruction';
      if (INSTRUCTION_DOCS[name]) {
        item.documentation = new vscode.MarkdownString(INSTRUCTION_DOCS[name]);
      }
      item.range = range;
      item.sortText = `5${name}`;
      items.push(item);
    }

    for (const label of labels) {
      const item = new vscode.CompletionItem(
        label,
        vscode.CompletionItemKind.Reference
      );
      item.detail = 'local label';
      item.range = range;
      item.sortText = `2${label}`;
      items.push(item);
    }

    for (const snippet of SNIPPETS) {
      const item = new vscode.CompletionItem(
        snippet.label,
        vscode.CompletionItemKind.Snippet
      );
      item.detail = snippet.detail;
      item.insertText = snippet.insertText;
      item.insertTextFormat = vscode.InsertTextFormat.Snippet;
      item.range = range;
      item.sortText = `0${snippet.label}`;
      items.push(item);
    }

    return items;
  }
}

class AsmDocumentSymbolProvider {
  provideDocumentSymbols(document) {
    const symbols = [];
    const lines = document.getText().split(/\r?\n/);
    const textPattern = /^\s*TEXT\s+([·\w.$<>]+)\(SB\)/;
    const dataPattern = /^\s*(DATA|GLOBL)\s+([·\w.$<>]+)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const range = new vscode.Range(i, 0, i, line.length);

      let match = textPattern.exec(line);
      if (match) {
        const start = line.indexOf(match[1]);
        const selection = new vscode.Range(
          i,
          start,
          i,
          start + match[1].length
        );
        symbols.push(
          new vscode.DocumentSymbol(
            match[1],
            'TEXT',
            vscode.SymbolKind.Function,
            range,
            selection
          )
        );
        continue;
      }

      match = dataPattern.exec(line);
      if (match) {
        const start = line.indexOf(match[2]);
        const selection = new vscode.Range(
          i,
          start,
          i,
          start + match[2].length
        );
        symbols.push(
          new vscode.DocumentSymbol(
            match[2],
            match[1],
            vscode.SymbolKind.Variable,
            range,
            selection
          )
        );
      }
    }
    return symbols;
  }
}

class AsmFoldingProvider {
  provideFoldingRanges(document) {
    const lines = document.getText().split(/\r?\n/);
    const starts = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*TEXT\s+/.test(lines[i])) {
        starts.push(i);
      }
    }

    const ranges = [];
    for (let i = 0; i < starts.length; i++) {
      const limit =
        i + 1 < starts.length ? starts[i + 1] - 1 : lines.length - 1;
      let end = limit;
      // Fold through the last RET before the next TEXT, so trailing
      // DATA/GLOBL declarations are not swallowed by the last function.
      for (let j = limit; j > starts[i]; j--) {
        if (/^\s*RET\b/.test(lines[j])) {
          end = j;
          break;
        }
      }
      if (end > starts[i]) {
        ranges.push(
          new vscode.FoldingRange(
            starts[i],
            end,
            vscode.FoldingRangeKind.Region
          )
        );
      }
    }
    return ranges;
  }
}

function workspaceCwds() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    vscode.window.showWarningMessage('Go Assembly: no workspace folder is open.');
    return [];
  }
  return folders.map((folder) => folder.uri.fsPath);
}

async function formatAll() {
  const cwds = workspaceCwds();
  if (cwds.length === 0) {
    return;
  }
  try {
    for (const cwd of cwds) {
      await tooling.runAsmfmt(['-w', '.'], cwd);
    }
    vscode.window.showInformationMessage('Go Assembly: formatted all .s files.');
  } catch (error) {
    const message = messageOf(error);
    output.appendLine(`[format-all] ${message}`);
    vscode.window.showErrorMessage(`Go Assembly: asmfmt failed: ${message}`);
  }
}

async function checkAll() {
  const cwds = workspaceCwds();
  if (cwds.length === 0) {
    return;
  }
  try {
    const unformatted = [];
    for (const cwd of cwds) {
      const { stdout } = await tooling.runAsmfmt(['-l', '.'], cwd);
      const files = stdout.trim();
      if (files) {
        unformatted.push(`${cwd}:\n${files}`);
      }
    }
    if (unformatted.length > 0) {
      const report = unformatted.join('\n\n');
      output.appendLine(`[check] unformatted files:\n${report}`);
      vscode.window.showWarningMessage(
        `Go Assembly: unformatted files:\n${report}`
      );
    } else {
      vscode.window.showInformationMessage(
        'Go Assembly: all .s files are formatted.'
      );
    }
  } catch (error) {
    const message = messageOf(error);
    output.appendLine(`[check] ${message}`);
    vscode.window.showErrorMessage(`Go Assembly: asmfmt failed: ${message}`);
  }
}

function firstWorkspaceFolder() {
  const folders = vscode.workspace.workspaceFolders || [];
  return folders.length > 0 ? folders[0] : undefined;
}

async function openWorkspaceFile(relativePath) {
  const folder = firstWorkspaceFolder();
  if (!folder) {
    vscode.window.showWarningMessage(
      'Go Assembly: open a workspace folder to follow local handbook links.'
    );
    return;
  }

  const segments = relativePath.split('/').filter((segment) => segment && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) {
    return;
  }

  const target = vscode.Uri.joinPath(folder.uri, ...segments);
  const root = folder.uri.fsPath.endsWith(path.sep)
    ? folder.uri.fsPath
    : folder.uri.fsPath + path.sep;
  if (!target.fsPath.startsWith(root)) {
    return;
  }

  try {
    if (target.fsPath.endsWith('.md')) {
      try {
        await vscode.commands.executeCommand('markdown.showPreview', target);
        return;
      } catch (error) {
        // Fall back to the text editor if the Markdown extension is unavailable.
      }
    }
    const document = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(document, { preview: true });
  } catch (error) {
    vscode.window.showErrorMessage(
      `Go Assembly: cannot open ${relativePath}: ${messageOf(error)}`
    );
  }
}

async function handleHandbookMessage(message) {
  if (!message || typeof message !== 'object') {
    return;
  }
  if (message.type === 'copy' && typeof message.text === 'string') {
    await vscode.env.clipboard.writeText(message.text);
    return;
  }
  if (message.type === 'openExternal' && typeof message.url === 'string') {
    if (/^https?:\/\//i.test(message.url)) {
      await vscode.env.openExternal(vscode.Uri.parse(message.url));
    }
    return;
  }
  if (message.type === 'openFile' && typeof message.path === 'string') {
    await openWorkspaceFile(message.path);
  }
}

function handbookHtml(webview, extensionUri, body, nonce) {
  const media = vscode.Uri.joinPath(extensionUri, 'media');
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(media, 'handbook.css')
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(media, 'handbook.js')
  );
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${styleUri}">
<title>Go 汇编手册</title>
</head>
<body>
<a class="skip-link" href="#content">跳到正文</a>
<header class="topbar">
  <button id="toc-toggle" type="button" aria-label="打开目录" aria-expanded="false">目录</button>
  <div class="brand">Go 汇编手册</div>
  <div class="search-wrap">
    <input id="search" type="search" placeholder="搜索手册（Ctrl/Cmd+F）" autocomplete="off" spellcheck="false" aria-label="搜索手册">
  </div>
  <span id="search-count" aria-live="polite"></span>
  <div class="search-actions" role="group" aria-label="搜索导航">
    <button id="search-prev" type="button" class="search-nav" title="上一个匹配（Shift+Enter / ↑）" aria-label="上一个匹配" disabled>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 7.5 6 3.5l4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <button id="search-next" type="button" class="search-nav" title="下一个匹配（Enter / ↓）" aria-label="下一个匹配" disabled>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.5 6 8.5l4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </div>
</header>
<div class="app">
  <aside id="toc" aria-label="目录">
    <div class="toc-title">目录</div>
    <nav id="toc-list"></nav>
  </aside>
  <main id="content">
${body}
  </main>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

async function openHandbook(context) {
  let markdown;
  try {
    const source = vscode.Uri.joinPath(
      context.extensionUri,
      'handbook',
      'ASM-HANDBOOK.md'
    );
    const bytes = await vscode.workspace.fs.readFile(source);
    markdown = Buffer.from(bytes).toString('utf8');
  } catch (error) {
    vscode.window.showErrorMessage(
      `Go Assembly: cannot read handbook: ${messageOf(error)}`
    );
    return;
  }

  const body = renderMarkdown(markdown, { baseDir: '' });
  const nonce = crypto.randomBytes(16).toString('base64');

  if (handbookPanel) {
    handbookPanel.webview.html = handbookHtml(
      handbookPanel.webview,
      context.extensionUri,
      body,
      nonce
    );
    handbookPanel.reveal(vscode.ViewColumn.Active);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'goAsm.handbook',
    'Go 汇编手册',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    }
  );
  handbookPanel = panel;
  panel.webview.html = handbookHtml(
    panel.webview,
    context.extensionUri,
    body,
    nonce
  );
  panel.webview.onDidReceiveMessage(handleHandbookMessage);
  panel.onDidDispose(() => {
    if (handbookPanel === panel) {
      handbookPanel = undefined;
    }
  });
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('goAsm.openHandbook', () =>
      openHandbook(context)
    ),
    output,
    vscode.languages.registerDocumentFormattingEditProvider(
      selector,
      new AsmFormatter()
    ),
    vscode.languages.registerDefinitionProvider(
      selector,
      new AsmDefinitionProvider()
    ),
    vscode.languages.registerHoverProvider(selector, new AsmHoverProvider()),
    vscode.languages.registerCompletionItemProvider(
      selector,
      new AsmCompletionProvider(),
      '#',
      '.',
      '·',
      '$'
    ),
    vscode.languages.registerDocumentSymbolProvider(
      selector,
      new AsmDocumentSymbolProvider()
    ),
    vscode.languages.registerFoldingRangeProvider(
      selector,
      new AsmFoldingProvider()
    ),
    vscode.commands.registerCommand('goAsm.formatAll', formatAll),
    vscode.commands.registerCommand('goAsm.check', checkAll),
    vscode.workspace.onWillSaveTextDocument((event) => {
      // Manual saves format everything. Auto Save (afterDelay/focus changes)
      // must not rewrite the line being typed: protect cursor/selection lines.
      const lines =
        event.reason === vscode.TextDocumentSaveReason.Manual
          ? []
          : editingLines(event.document);
      if (event.document.languageId === 'go.asm') {
        // Runs for manual saves and for Auto Save (afterDelay/focus changes).
        event.waitUntil(formattingEdits(event.document, lines));
        return;
      }
      if (
        event.document.languageId === 'go' &&
        event.document.uri.scheme === 'file'
      ) {
        // The Go extension's formatOnSave does not run on Auto Save, so format
        // Go files here as well; this participant runs for all save reasons.
        event.waitUntil(goFormattingEdits(event.document, lines));
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
