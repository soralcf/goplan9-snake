# Go Assembly Tools

这是一个 **workspace-local** VS Code 扩展，只对当前项目生效。

它把 Go Plan 9 汇编的开发体验都放进同一个扩展里：语法高亮、补全、保存时自动格式化、头文件/宏定义/局部 label 跳转、hover、Outline 和折叠。

## 安装

1. 用 VS Code 打开本项目，并信任工作区（不要停留在 Restricted Mode）。
2. 打开 Extensions 视图，搜索 `@recommended`。
3. 找到 **Go Assembly Tools**（publisher: `local`），点击 **Install**。
4. 执行 `Developer: Reload Window`。

安装后打开 `add_arm64.s`，语言模式应显示为 **Go Assembly**。

如果修改了本扩展的 `package.json` 但版本没有更新：在 Extensions → Installed → Workspace 中先 **Uninstall**，再回到 `@recommended` 重新 **Install**，最后 Reload Window。

## 功能

- **语法高亮**：指令、ARM64 寄存器（`R0-R30`、`F0-F31`、`V0-V31`、`ZR/FP/SP/SB/PC/LR/TLS`）、伪指令、标志、符号、label、偏移、`#include`、注释、数字、字符串。
- **补全提示**：
  - 指令：从本机 Go 的 `$GOROOT/src/cmd/internal/obj/arm64/anames.go`（或 `x86/anames.go`）动态读取，按文件名/`//go:build` 自动选择架构。
  - 寄存器：ARM64 `R0-R30`、`F0-F31`、`V0-V31`、`ZR/FP/SP/SB/PC/LR/TLS`；amd64 常用寄存器。
  - `TEXT`/`GLOBL` flags：`NOSPLIT`、`NOFRAME`、`RODATA`、`NOPTR`、`DUPOK` 等，带说明。
  - 当前文件中的 label（在 `B`/`BL`/`BEQ` 等分支后优先提示）。
  - Snippet：`TEXT`/`DATA`/`GLOBL`/`#include`/`MOVD`/`ADD`，参考 `quillaja.goasm` 的补全片段并补上了 Go 语法中的 `$`。
  - `#include "` 后提示 `textflag.h`、`funcdata.h`、`go_asm.h`。
- **保存时自动格式化**：扩展通过 `onWillSaveTextDocument` 在每次保存前调用 `asmfmt`，包括 `files.autoSave: "afterDelay"` 的自动保存。因为 VS Code 原生 `formatOnSave` 会跳过 `afterDelay`，所以 `[go.asm]` 的 `editor.formatOnSave` 故意设为 `false`，由扩展的 save participant 统一处理，避免手动保存时双重格式化。也仍然可以手动执行 `Format Document`。
- **定义跳转**：
  - `#include "textflag.h"` → `$GOROOT/pkg/include/textflag.h`（不存在时回退到 `$GOROOT/src/runtime/textflag.h`）。
  - `NOSPLIT`、`DUPOK`、`RODATA`、`GO_ARGS`、`NO_LOCAL_POINTERS` 等宏 → 对应头文件中的 `#define` 行。
  - 当前文件里的 label 定义。
- **Hover**：宏上方官方注释、`#define` 行和定义位置；寄存器、常用指令和伪指令的说明。
- **Outline / 面包屑**：自动列出 `TEXT`、`DATA`、`GLOBL` 符号。
- **代码折叠**：按 `TEXT` 函数折叠。
- **命令**（Command Palette）：
  - `Go Assembly: Format All .s Files`
  - `Go Assembly: Check .s Formatting`

## 说明

- 语言 id 仍然是 Go 扩展注册的 `go.asm`，因此 Go 扩展的汇编符号跳转等功能不受影响。
- 格式化使用 `asmfmt`；默认查找 `~/go/bin/asmfmt`，也可以用 `ASMFMT` 环境变量指定。
- 查找 GOROOT 时优先使用 Go 扩展的 `go.goroot` 设置，其次使用 `GOROOT` 环境变量，最后执行 `go env GOROOT`。
- 修改扩展代码或 grammar 后需要 `Developer: Reload Window`。
- 主题对 scope 的配色不同；如果某个 token 没有颜色，可以用 `Developer: Inspect Editor Tokens and Scopes` 查看它的 scope。
