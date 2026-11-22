# goplan9-snake

用 Go Plan 9 汇编（darwin/arm64）从零实现一个自动寻路的 CLI 贪食蛇。程序启动后无需输入：蛇自动吃食物，最终占满整个棋盘。

这是**学习项目**，不是产品。目标是把 Go 汇编的关键知识（ABI0、`TEXT`/`GLOBL`、寄存器、分支、系统调用、BSS、测试与调试）在实践中完整走一遍。

> 仓库里的计划文档不包含游戏实现代码。代码由你亲手写；Claude 负责设定验收目标、提供参考资料、审查和调试协助。

## 当前进度

- 唯一进度源：[docs/2.1-CHECKLIST.md](docs/2.1-CHECKLIST.md)。下一件要做的事以清单里第一个“依赖已完成的待办条目”为准。
- M0、M1 已完成并验收；记录见 [4.1 工程骨架笔记](docs/4.1-ENGINEERING-NOTES.md) 和 [4.2 基本功笔记](docs/4.2-FUNDAMENTALS-NOTES.md)。
- 当前里程碑：M2 — Darwin 系统调用与终端生命周期。
- 已冻结的函数签名和全局约定见 [docs/2.2-CONTRACTS.md](docs/2.2-CONTRACTS.md)。

---

## 最终验收（Definition of Done）

在真实终端中运行 `./snake`。完成状态以 [2.1-CHECKLIST 的 M8 关卡](docs/2.1-CHECKLIST.md#m8) 为准；这里只列验收口径。

- 自动进入备用屏幕、隐藏光标，棋盘尺寸与当前终端匹配（有安全上限）。
- 蛇从长度 1 开始，自动移动、吃食物、变长；全程无键盘输入。
- Hamiltonian 环保证安全；BFS 安全窗口内的捷径加速；无撞墙、无自撞。
- 最终 `length == W*H`，最后一帧显示整个棋盘被蛇填满。
- 显示胜利信息，恢复光标和主屏幕，退出码 0。
- 非 tty / 终端过小时有明确回退或报错，不崩溃。
- `go test ./... -count=1` 全部通过；`go vet ./...` 无输出；`go build` 成功。
- 无头模式（不渲染、不睡眠）在固定种子下确定性通关，并有 tick 预算断言。
- 产品代码边界：Go 只包含入口、函数声明、常量和测试；游戏状态、移动、寻路、渲染、系统调用全部在 `*_arm64.s`。

最终演示时，把下面这条命令和输出保存到 `docs/5.2-DEMO.md`（你自己记录）：

```bash
go build -o snake . && ./snake
# 期望：终端全屏显示棋盘，蛇自动填满，打印胜利信息，退出码 0
```

---

## 技术约束

| 项 | 选择 |
|---|---|
| 平台 | macOS darwin/arm64（Apple Silicon） |
| Go | 1.27.x（本机 1.27.2） |
| 汇编 | Go Plan 9 汇编，ABI0（栈传参） |
| 终端 | ANSI 转义序列，不引入 TUI 库 |
| 系统调用 | `write` / `ioctl` / `exit` 用裸 `SVC $0x80`；帧率睡眠用 libSystem `usleep` 分片 |
| 内存 | 静态 BSS，无 Go 指针，避免 GC 扫描 |
| 依赖 | 标准库 + Go 运行时；不引入第三方依赖 |
| 输入 | 无（全自动）；保留调试用的方向注入接口 |
| 渲染 | ASCII，两字符一格；每个帧一次 `write` |

### 本机预研结论（2026-10-18，Go 1.27.2 darwin/arm64）

这些结论已经在本机用临时探针验证过，可作为设计前提：

- `write`（`SYS_write = 4`）、`ioctl`（`SYS_ioctl = 54`）、`exit`（`SYS_exit = 1`）都可以在 Go 汇编里用 `SVC $0x80` 直接调用。
- arm64 Darwin 的约定：系统调用号放 `R16`，参数放 `R0`–`R5`，`SVC $0x80`；成功时 carry 清空，失败时 carry 置位且 `R0` 为 errno。
- `TIOCGWINSZ = 0x40087468`，`struct winsize` 是 4 个 `uint16`：`row, col, xpixel, ypixel`；在 pty 下实测能正确读到 `40 120`。
- `poll`/`select` 裸系统调用会被 Go runtime 的异步抢占信号反复打断（实测返回 `EINTR`）。因此睡眠采用 libSystem `usleep`，按约 5ms 分片循环；实测 120ms 请求耗时约 108–120ms，可靠。
- `//go:cgo_import_dynamic libc_usleep usleep "/usr/lib/libSystem.B.dylib"` 放在 Go 文件里即可，无需 cgo；汇编里 `BL libc_usleep(SB)`。
- Go arm64 保留寄存器：`R18`（平台）、`R27`/`R28`（编译器/链接器）、`R29`（FP）、`R30`（LR）。通用代码用 `R0`–`R17`、`R19`–`R26`。
- Go 源文件里的 `const` 会生成到 `go_asm.h`，汇编里 `#include "go_asm.h"` 后用 `const_Name` 引用。
- 包级汇编 BSS 可以不声明在 Go 里：`GLOBL ·buf(SB), NOPTR, $const_MaxCells*4` 可直接链接；跨 `.s` 文件用 `·buf(SB)` 访问。
- Go 调用手写汇编函数时，编译器生成 ABIInternal → ABI0 包装；`go tool objdump` 会显示 `goplan9snake/internal/arith.Add.abi0` 这类符号，而汇编函数本身是 ABI0。

更详细的技术说明见 [docs/3.1-DESIGN.md](docs/3.1-DESIGN.md)。

---

## 目录与代码分工

当前（M0–M1）：

| 文件 | 职责 | 语言 |
|---|---|---|
| `main.go` | 入口；M2-07 前调用 `arith.Add(1, 1)` 验证链路，之后改为 `term.Run()` | Go |
| `internal/arith/arith.go` | `Add`、`Clamp`、`AbsDiff`、`SumTo` 的无函数体声明 | Go（无逻辑） |
| `internal/arith/arith_arm64.s` | 上述函数的汇编实现 | Plan 9 asm |
| `internal/grid/grid_arm64.s` | `CellIndex` | Plan 9 asm |
| `internal/rng/rng_arm64.s` | `Xorshift64` | Plan 9 asm |
| `internal/mem/mem_arm64.s` | `FillByte` | Plan 9 asm |
| `internal/counter/counter_arm64.s` | `Inc`、`Reset`（BSS 计数器） | Plan 9 asm |
| `internal/*/*_test.go` | 表驱动测试、Go oracle、随机对拍 | Go（仅测试） |

M2 起继续按 `internal/<pkg>/` 分包：系统调用、游戏状态/移动、寻路、渲染、主循环各成模块。共享 BSS 的模块建议放在同一个包内，避免跨包引用私有符号；跨包可调用的汇编函数必须导出。文件名带 `_arm64.s` 后缀即可被 Go 工具链识别为 arm64 专用；系统调用文件建议带 `_darwin_arm64.s`，方便以后考虑 Linux 移植。

---

## 进度

状态摘要用于快速浏览，**以 [docs/2.1-CHECKLIST.md](docs/2.1-CHECKLIST.md) 为准**；本表只在里程碑关卡通过时更新。

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 工程骨架与 ABI0 热身 | 已完成（[笔记](docs/4.1-ENGINEERING-NOTES.md)） |
| M1 | 汇编基本功：数据、循环、分支、BSS | 已完成（[笔记](docs/4.2-FUNDAMENTALS-NOTES.md)） |
| M2 | Darwin 系统调用与终端生命周期 | 进行中（[清单](docs/2.1-CHECKLIST.md#m2)） |
| M3 | 游戏状态与移动核心 | 未开始（[清单](docs/2.1-CHECKLIST.md#m3)） |
| M4 | 帧渲染与主循环 | 未开始（[清单](docs/2.1-CHECKLIST.md#m4)） |
| M5 | Hamiltonian 环，保证通关 | 未开始（[清单](docs/2.1-CHECKLIST.md#m5)） |
| M6 | BFS 寻路（独立验证） | 未开始（[清单](docs/2.1-CHECKLIST.md#m6)） |
| M7 | 安全窗口混合策略与性能 | 未开始（[清单](docs/2.1-CHECKLIST.md#m7)） |
| M8 | 打磨、最终验收与文档 | 未开始（[清单](docs/2.1-CHECKLIST.md#m8)） |

条目顺序、状态和证据见 [docs/2.1-CHECKLIST.md](docs/2.1-CHECKLIST.md)；里程碑目标、学习点和常见坑见 [docs/1.2-ROADMAP.md](docs/1.2-ROADMAP.md)。

---

## 协作方式

你可以按自己的节奏推进。每完成一个函数或里程碑，按需提供：

1. 相关文件或 `git diff`。
2. 你运行过的命令和完整输出（测试、`go vet`、`go build`）。
3. 卡住的地方，以及你已经尝试过什么。

我会：

- 阅读代码并实际运行测试/构建来验收。
- 指出正确性、边界条件和汇编层面的问题。
- 在你明确要求之前，**不替你写实现代码**。
- 按三级提示协助：概念提示 → 伪代码/数据流提示 → 具体指令/语法提示。

如果某个决定会影响架构或验收（例如主循环是否仍留在汇编、是否做 SIGINT 清理），我会先和你确认。

---

## 文档

按从上到下的阅读顺序：

1. [docs/1.1-OVERVIEW.md](docs/1.1-OVERVIEW.md) — 用通俗语言说明各模块和函数职责。
2. [docs/1.2-ROADMAP.md](docs/1.2-ROADMAP.md) — M0–M8 里程碑目标、学习点、验收口径和常见坑。
3. [docs/2.1-CHECKLIST.md](docs/2.1-CHECKLIST.md) — 唯一进度源：条目顺序、状态、证据和关卡。
4. [docs/2.2-CONTRACTS.md](docs/2.2-CONTRACTS.md) — 已冻结的签名、编码、BSS 布局，以及 M2 草案和开放决策。
5. [docs/3.1-DESIGN.md](docs/3.1-DESIGN.md) — 架构、BSS 布局、ABI0、系统调用、Hamiltonian + 安全窗口 BFS、渲染与性能。
6. [docs/3.2-REFERENCES.md](docs/3.2-REFERENCES.md) — 官方文档、中文教材、Go 源码示例、ARM64 手册、调试工具和按条目的阅读地图。
7. [docs/4.1-ENGINEERING-NOTES.md](docs/4.1-ENGINEERING-NOTES.md) — M0：工程骨架、ABI0、`go vet` 与 objdump 验收记录。
8. [docs/4.2-FUNDAMENTALS-NOTES.md](docs/4.2-FUNDAMENTALS-NOTES.md) — M1：函数契约、测试、符号扩展、BSS 与验收记录。
9. [docs/4.3-TWOS-COMPLEMENT-NOTES.md](docs/4.3-TWOS-COMPLEMENT-NOTES.md) — 补码、溢出与 `AbsDiff` 契约专题。
10. [docs/4.4-TERMINAL-NOTES.md](docs/4.4-TERMINAL-NOTES.md) — M2：系统调用与终端生命周期笔记。

计划中的产物文档：`docs/5.1-PERF.md`（M7 性能对比）、`docs/5.2-DEMO.md`（M8 演示记录），在对应关卡通过时创建。

文档一致性自检：`./scripts/check-docs.sh`。

---

## 非目标

- 键盘控制、分数排行榜、存档、网络对战。
- 使用 `tcell`/`bubbletea` 等 TUI 库。
- 在 Linux/Windows 上直接运行（可把游戏逻辑保持可移植，但系统调用文件只实现 Darwin）。
- 追求极限性能；本项目的性能目标是“全屏自动通关在可接受时间内完成”，而不是基准测试夺冠。
