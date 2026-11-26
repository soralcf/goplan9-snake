# Go Assembly Tools

这是一个 **workspace-local** VS Code 扩展，只对当前项目生效。

它把 Go Plan 9 汇编的开发体验都放进同一个扩展里：语法高亮、补全、保存时自动格式化、头文件/宏定义/局部 label 跳转、hover、Outline、折叠，以及一份离线手册。同时，它会在保存时用 `gofmt` 格式化 Go 文件，覆盖 Auto Save 场景。

## 安装

1. 用 VS Code 打开本项目，并信任工作区（不要停留在 Restricted Mode）。
2. 打开 Extensions 视图，搜索 `@recommended`。
3. 找到 **Go Assembly Tools**（publisher: `local`），点击 **Install**。
4. 执行 `Developer: Reload Window`。

安装后打开 `internal/arith/arith_arm64.s`，语言模式应显示为 **Go Assembly**。

如果修改了本扩展的 `package.json` 但版本没有更新：在 Extensions → Installed → Workspace 中先 **Uninstall**，再回到 `@recommended` 重新 **Install**，最后 Reload Window。

## 功能

- **语法高亮**：指令、ARM64 寄存器（`R0-R30`、`F0-F31`、`V0-V31`（含 `.S4`/`.D2` 排列后缀）、`ZR/FP/SP/RSP/SB/PC/LR/TLS`）、伪指令、标志、符号、label、偏移、`#include`、注释、数字、字符串。
- **补全提示**：
  - 指令：从本机 Go 的 `$GOROOT/src/cmd/internal/obj/arm64/anames.go`（或 `x86/anames.go`）动态读取，按文件名/`//go:build` 自动选择架构。
  - 寄存器：ARM64 `R0-R30`、`F0-F31`、`V0-V31`、`ZR/FP/SP/RSP/SB/PC/LR/TLS`；amd64 常用寄存器。
  - `TEXT`/`GLOBL` flags：`NOSPLIT`、`NOFRAME`、`RODATA`、`NOPTR`、`DUPOK` 等，带说明。
  - 当前文件中的 label（在 `B`/`BL`/`BEQ` 等分支后优先提示）。
  - Snippet：`TEXT`/`DATA`/`GLOBL`/`#include`/`MOVD`/`ADD`，参考 `quillaja.goasm` 的补全片段并补上了 Go 语法中的 `$`。
  - `#include "` 后提示 `textflag.h`、`funcdata.h`、`go_asm.h`。
- **保存时自动格式化**：
  - `.s`：扩展通过 `onWillSaveTextDocument` 在每次保存前调用 `asmfmt`，包括 `files.autoSave: "afterDelay"` 的自动保存。因为 VS Code 原生 `formatOnSave` 会跳过 Auto Save，所以 `[go.asm]` 的 `editor.formatOnSave` 故意设为 `false`，由扩展的 save participant 统一处理，避免手动保存时双重格式化。
  - `.go`：同一 save participant 在每次保存前调用 `gofmt`，因此 Auto Save 也会格式化。`[go]` 的 `editor.formatOnSave` 同样设为 `false`，避免与 Go 扩展在手动保存时重复格式化。gopls 目前不提供 on-type/range formatting，所以格式化发生在保存时（手动或自动），而不是每次按键。
  - Auto Save 与手动保存的区别：Auto Save（`afterDelay`/失焦）会**保护光标和选区所在行**，这些行整行原样保留，避免打字中途被 `asmfmt`/`gofmt` 改写（例如尾随逗号、空格或制表符被吞掉）；手动保存（`Cmd+S`）和 `Format Document` 会格式化整篇，包括光标行。`.s` 和 `.go` 规则一致。在最后一行输入时文件暂时没有结尾换行，Auto Save 也不会补上它，避免正在输入的行被换行拆开。
  - 仍然可以手动执行 `Format Document`。
- **定义跳转**：
  - `#include "textflag.h"` → `$GOROOT/pkg/include/textflag.h`（不存在时回退到 `$GOROOT/src/runtime/textflag.h`）。
  - `NOSPLIT`、`DUPOK`、`RODATA`、`GO_ARGS`、`NO_LOCAL_POINTERS` 等宏 → 对应头文件中的 `#define` 行。
  - 当前文件里的 label 定义。
- **Hover**：宏上方官方注释、`#define` 行和定义位置；寄存器、常用指令和伪指令的说明；`MOVD.P`/`MOVD.W` 这类带后缀的助记符按整个 token 悬停，单独显示后/前索引 load/store 语法。
- **Outline / 面包屑**：自动列出 `TEXT`、`DATA`、`GLOBL` 符号。
- **代码折叠**：按 `TEXT` 函数折叠。
- **内置手册**：`Go Assembly: Open Handbook` 打开 Webview 手册，内容随扩展一起安装，不依赖项目里的 `docs/`。手册包含 ABI0、栈帧、数据、寻址、指令、条件码、Darwin 系统调用和排错速查；内容按 `[通用]`、`[arm64]`、`[darwin]`、`[amd64]` 标注架构，关键表格附英文缩写展开列；左侧自动生成目录，支持 `Ctrl+F` / `Cmd+F` 页内搜索（计数显示 `当前 / 总数`，`Enter` / `↓` 下一个、`Shift+Enter` / `↑` 上一个，也可点击搜索框旁的上下按钮），代码块可一键复制。
- **命令**（Command Palette）：
  - `Go Assembly: Open Handbook`
  - `Go Assembly: Format All .s Files`
  - `Go Assembly: Check .s Formatting`

## 说明

- 语言 id 仍然是 Go 扩展注册的 `go.asm`，因此 Go 扩展的汇编符号跳转等功能不受影响。
- `.s` 格式化使用 `asmfmt`；默认查找 `~/go/bin/asmfmt`，也可以用 `ASMFMT` 环境变量指定。
- `.go` 格式化使用 `gofmt`；默认从 `go` 同目录或 Homebrew 路径查找，也可以用 `GOFMT` 环境变量指定。
- 查找 GOROOT 时优先使用 Go 扩展的 `go.goroot` 设置，其次使用 `GOROOT` 环境变量，最后执行 `go env GOROOT`。
- 手册源文件是扩展内的 `handbook/ASM-HANDBOOK.md`；修改后重新执行 `Go Assembly: Open Handbook` 即可刷新（面板已打开时会重新渲染）。手册里的项目链接（如 `docs/1.2-ROADMAP.md`）按工作区根目录解析。
- 指令 hover 文档和 fallback 补全列表在 `instruction-data.js`，逐条操作数语法在 `instruction-syntax.js`（仅 hover 使用，补全保持一句话说明），手册第 8 章在 `handbook/ASM-HANDBOOK.md`。修改后运行 `npm run check`：`check-mnemonics.js` 校验助记符是否都在本机 Go 的 `anames.go` 中、项目 `.s` 用到的助记符是否都有 hover 说明；`check-syntax.js` 会把每条语法示例真正交给 `go tool asm` 汇编，并断言常见错误写法必须失败。
- 修改扩展代码或 grammar 后需要 `Developer: Reload Window`。
- 主题对 scope 的配色不同；如果某个 token 没有颜色，可以用 `Developer: Inspect Editor Tokens and Scopes` 查看它的 scope。
