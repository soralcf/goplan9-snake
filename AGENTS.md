# AGENTS.md

本文件是本仓库的代理工作说明。通用规则见 `~/.agents/AGENTS.md`；两者冲突时，本文件只覆盖项目特有的部分。

## 项目

用 Go Plan 9 汇编（darwin/arm64）从零实现一个自动寻路的 CLI 贪吃蛇。这是学习项目，重点是把 ABI0、`TEXT`/`GLOBL`、寄存器、分支、系统调用、BSS、测试与调试完整走一遍。

- 路线图与验收标准：`docs/ROADMAP.md`
- 技术设计：`docs/DESIGN.md`
- 参考资料：`docs/REFERENCES.md`
- 各里程碑笔记：`docs/M0-NOTES.md`、后续的 `docs/M*-NOTES.md`
- 当前进度：以 ROADMAP 中已勾选的复选框和最新笔记为准。

## 环境

- macOS Apple Silicon（darwin/arm64），Go 1.27.x，模块名 `goplan9snake`（目录名为 `goplan9-snake`；模块路径不能带 `-`，否则汇编无法引用跨包符号）。
- 无第三方依赖；只使用标准库和 Go 运行时。
- VS Code 工作区扩展 `.vscode/extensions/go-asm-tools`：`.s` 高亮/补全/`asmfmt`，`.go` 保存时 `gofmt`（包括 Auto Save；自动保存时保护光标/选区所在行）。
- 修改工作区扩展后需要 `Developer: Reload Window`；提升 `package.json` 的 `version` 后，按扩展 README 的说明重新安装。

## 代码边界（硬性）

产品 Go 文件只允许：

- `main` 入口；
- 汇编函数声明（无函数体）；
- 常量（供 `go_asm.h` 使用）；
- `//go:cgo_import_dynamic`；
- 测试和测试用 Go 参考实现。

游戏状态、移动、碰撞、食物生成、寻路、渲染、系统调用必须写在 `*_arm64.s`。不要用 `fmt`/`os`/`time`/`math/rand`/`syscall` 在 Go 里实现游戏逻辑，也不要用 Go 切片/映射保存游戏状态。

## 汇编约定

- 文件名：`*_arm64.s`；文件头 `#include "textflag.h"`，需要常量时再 `#include "go_asm.h"`。
- 手写汇编按 ABI0 编写；`TEXT ·Name(SB), NOSPLIT, $frame-argsize` 中的 argsize 是**参数 + 返回值**的总字节数。
- `a+0(FP)`、`b+8(FP)` 等名称必须与 Go 声明一致；`go vet` 会检查名称、偏移和参数大小。
- 不要使用 `R18`、`R27`、`R28`、`R29`、`R30`；通用寄存器用 `R0`–`R17`、`R19`–`R26`。
- BSS 用 `GLOBL ·name(SB), NOPTR, $bytes`；大小是字节数，不是元素个数。
- 改完汇编必须跑 `go vet ./...`：`go build` 不检查参数大小和 FP 偏移。

## 测试与验收

- 先纯函数 + 表驱动测试，再状态机 + 不变量测试，最后接终端。
- 每个里程碑都要保持以下命令通过：

```bash
gofmt -l .                 # 应为空
go test ./... -count=1
go vet ./...
go build -o snake .
```

- 共享 BSS 的测试不要使用 `t.Parallel()`。
- 随机/长跑测试必须有 tick 或时间上限断言，避免算法 bug 时测试挂死。
- 验收时实际运行命令并阅读汇编，不要只凭代码推断；结论写入对应的 `docs/M*-NOTES.md`。
- 不要勾选 ROADMAP 中尚未实际验证的复选框。

## 协作方式

- 默认不要替用户写里程碑实现代码，除非用户明确要求。提示按三级递进：概念 → 伪代码/数据流 → 具体指令/语法。
- 涉及架构、公开行为、数据布局、平台/依赖或破坏性操作的决策，先与用户确认。
- 只有用户明确要求时才提交。用户说“提交”时直接提交，不再单独确认 commit message。
- 提交信息参考历史提交，使用 Conventional Commits（`feat|fix|docs|chore(scope): summary`）。代理提交时不要写 `by welkin`，在正文声明 `Agent:` 和 `Model:`。
