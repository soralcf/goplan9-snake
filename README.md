# goplan9-snake

用 Go Plan 9 汇编（darwin/arm64）从零实现一个自动寻路的 CLI 贪食蛇。程序启动后无需输入：蛇自动吃食物，最终占满整个棋盘。

这是**学习项目**，不是产品。目标是把 Go 汇编的关键知识（ABI0、`TEXT`/`GLOBL`、寄存器、分支、系统调用、BSS、测试与调试）在实践中完整走一遍。

> 仓库里的计划文档不包含游戏实现代码。代码由你亲手写；Claude 负责设定验收目标、提供参考资料、审查和调试协助。

---

## 最终验收（Definition of Done）

在真实终端中运行 `./snake`：

- [ ] 自动进入备用屏幕、隐藏光标，棋盘尺寸与当前终端匹配（有安全上限）。
- [ ] 蛇从长度 1 开始，自动移动、吃食物、变长；全程无键盘输入。
- [ ] Hamiltonian 环保证安全；BFS 安全窗口内的捷径加速；无撞墙、无自撞。
- [ ] 最终 `length == W*H`，最后一帧显示整个棋盘被蛇填满。
- [ ] 显示胜利信息，恢复光标和主屏幕，退出码 0。
- [ ] 非 tty / 终端过小时有明确回退或报错，不崩溃。
- [ ] `go test ./... -count=1` 全部通过；`go vet ./...` 无输出；`go build` 成功。
- [ ] 无头模式（不渲染、不睡眠）在固定种子下确定性通关，并有 tick 预算断言。
- [ ] 产品代码边界：Go 只包含入口、函数声明、常量和测试；游戏状态、移动、寻路、渲染、系统调用全部在 `*_arm64.s`。

最终演示时，把下面这条命令和输出保存到 `docs/DEMO.md`（你自己记录）：

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
- Go 调用汇编函数时使用 ABI0；`go tool objdump` 会显示 `main.foo.abi0` 符号，编译器自动生成 ABI 包装。

更详细的技术说明见 [docs/DESIGN.md](docs/DESIGN.md)。

---

## 建议目录

| 文件 | 职责 | 语言 |
|---|---|---|
| `main.go` | `func main() { run() }`；仅入口 | Go |
| `api.go` | 汇编函数的 Go 声明、状态码常量、`go:cgo_import_dynamic` | Go（无逻辑） |
| `game_arm64.s` | 棋盘状态、初始化、移动、吃食物、胜负判定 | Plan 9 asm |
| `path_arm64.s` | Hamiltonian 环、环位置、安全窗口 BFS、兜底策略 | Plan 9 asm |
| `render_arm64.s` | 帧缓冲、HUD、边框、ANSI 序列 | Plan 9 asm |
| `sys_darwin_arm64.s` | `write`、`ioctl`、`exit`、`usleep` 分片封装 | Plan 9 asm |
| `main_darwin_arm64.s` | 主循环、终端生命周期、胜利/失败收尾 | Plan 9 asm |
| `*_test.go` | 单元测试、不变量测试、Go 参考实现、pty/性能测试 | Go（仅测试） |

文件名带 `_arm64.s` 后缀即可被 Go 工具链识别为 arm64 专用；系统调用文件建议带 `_darwin_arm64.s`，方便以后考虑 Linux 移植。

---

## 进度

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 工程骨架与 ABI0 热身 | 未开始 |
| M1 | 汇编基本功：数据、循环、分支、BSS | 未开始 |
| M2 | Darwin 系统调用与终端生命周期 | 未开始 |
| M3 | 游戏状态与移动核心 | 未开始 |
| M4 | 帧渲染与主循环 | 未开始 |
| M5 | Hamiltonian 环，保证通关 | 未开始 |
| M6 | BFS 寻路（独立验证） | 未开始 |
| M7 | 安全窗口混合策略与性能 | 未开始 |
| M8 | 打磨、最终验收与文档 | 未开始 |

完整任务、验收命令和常见坑见 [docs/ROADMAP.md](docs/ROADMAP.md)。

---

## 协作方式

你可以按自己的节奏推进。每完成一个里程碑，把下面内容发给我：

1. 相关文件或 `git diff`。
2. 你运行过的命令和完整输出（测试、`go vet`、`go build`）。
3. 对“本里程碑你应该能回答的问题”的答案（用自己的话）。
4. 卡住的地方，以及你已经尝试过什么。

我会：

- 阅读代码并实际运行测试/构建来验收。
- 指出正确性、边界条件和汇编层面的问题。
- 在你明确要求之前，**不替你写实现代码**。
- 按三级提示协助：概念提示 → 伪代码/数据流提示 → 具体指令/语法提示。

如果某个决定会影响架构或验收（例如主循环是否仍留在汇编、是否做 SIGINT 清理），我会先和你确认。

---

## 文档

- [docs/ROADMAP.md](docs/ROADMAP.md) — M0–M8 里程碑、验收标准、常见坑、学习检查点。
- [docs/DESIGN.md](docs/DESIGN.md) — 架构、BSS 布局、ABI0、系统调用、Hamiltonian + 安全窗口 BFS、渲染与性能。
- [docs/REFERENCES.md](docs/REFERENCES.md) — 官方文档、中文教材、Go 源码示例、ARM64 手册、调试工具和阅读顺序。

---

## 非目标

- 键盘控制、分数排行榜、存档、网络对战。
- 使用 `tcell`/`bubbletea` 等 TUI 库。
- 在 Linux/Windows 上直接运行（可把游戏逻辑保持可移植，但系统调用文件只实现 Darwin）。
- 追求极限性能；本项目的性能目标是“全屏自动通关在可接受时间内完成”，而不是基准测试夺冠。
