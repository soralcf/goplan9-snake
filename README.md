# goplan9-snake

用 Go Plan 9 汇编（darwin/arm64）从零实现一个自动寻路的 CLI 贪吃蛇。程序启动后无需键盘输入：蛇自动寻路吃食物，直至占满整个棋盘。

这是**学习项目**，核心目标是把 Go 汇编的关键知识（ABI0、`TEXT`/`GLOBL`、寄存器、分支、系统调用、BSS、测试与反汇编调试）在实践中完整走一遍。汇编实现与关键 Go 声明由你亲手编写；代理负责起草契约与测试、提供三级提示、审查反汇编与协助调试。

## 最终验收（Definition of Done）

在真实终端运行 `go build -o snake . && ./snake`，完成状态以 [2.1-CHECKLIST 的 M8 关卡](docs/2.1-CHECKLIST.md#m8) 为准：

- 自动进入备用屏幕并隐藏光标，棋盘尺寸自适应当前终端（受 `MaxW`/`MaxH` 上限保护）；非 tty 或终端过小时有明确回退或报错。
- 蛇从长度 1 开始自动移动、吃食物、增长；Hamiltonian 环兜底保命，安全窗口内 BFS 捷径加速，全程无撞墙、无自撞。
- 最终 `length == W*H`，填满帧保持可见后恢复光标和主屏幕，打印胜利摘要，退出码 0。
- 无头模式（不渲染、不睡眠）在固定种子下确定性通关，且满足测试内 tick 预算断言。
- `gofmt -l .`、`./scripts/check-docs.sh`、`go test ./... -count=1`、`go vet ./...`、`go build -o snake .` 全部通过。
- 产品代码边界：Go 文件仅含入口、无函数体声明、常量与动态导入指令；游戏状态、移动、寻路、渲染、系统调用全部位于 `*_arm64.s`。

---

## 技术约束与已验证前提

| 项 | 约定 |
|---|---|
| 平台 / Go | macOS darwin/arm64（Apple Silicon），Go 1.27.x（模块名 `goplan9snake`） |
| 汇编与 ABI | Go Plan 9 汇编，ABI0（栈传参，`go vet` 校验帧与参数偏移） |
| 寄存器 | 通用 `R0`–`R17`、`R19`–`R26`；保留 `R18`、`R27`、`R28`(g)、`R29`(FP)、`R30`(LR) |
| 系统调用 | `write`(4) / `ioctl`(54) / `exit`(1) 用裸 `SVC $0x80`（`R16` 放调用号，carry 置位表示失败且 `R0` 为 errno） |
| 睡眠 | `//go:cgo_import_dynamic` 导入 libSystem `usleep`，按 5ms 分片调用 `BL libc_usleep(SB)`（规避裸 `poll`/`select` 被 Go 异步抢占打断） |
| 终端与渲染 | ANSI 转义序列，`TIOCGWINSZ (0x40087468)` 读取 8 字节 `winsize`；两字符一格，每帧一次 `write` |
| 内存与依赖 | 静态 `NOPTR` BSS（避免 GC 扫描）；仅用标准库与 Go 运行时，无第三方依赖 |

完整探针结论与设计论证见 [docs/3.1-DESIGN.md](docs/3.1-DESIGN.md) §1。

---

## 目录与代码分工

| 路径 | 职责 | 语言 |
|---|---|---|
| `main.go` | 唯一入口；M2-07 前调用 `arith.Add(1, 1)`，之后改为 `term.Run()` | Go |
| `internal/arith/` | `Add`、`Clamp`、`AbsDiff`、`SumTo` | Go 声明 + Plan 9 asm |
| `internal/grid/` | `CellIndex`（二维坐标转一维索引） | Go 声明 + Plan 9 asm |
| `internal/rng/` | `Xorshift64`（无状态伪随机数步进） | Go 声明 + Plan 9 asm |
| `internal/mem/` | `FillByte`（连续字节填充） | Go 声明 + Plan 9 asm |
| `internal/counter/` | `Inc`、`Reset`（包级 `NOPTR` BSS 计数器） | Go 声明 + Plan 9 asm |
| `internal/term/` | Darwin 系统调用常量、`sysWrite` 等终端与系统调用封装（M2 进行中） | Go 声明 + Plan 9 asm |
| `internal/*/*_test.go` | 表驱动测试、Go oracle、随机对拍与边界断言 | Go（仅测试） |

后续里程碑继续按 `internal/game`、`internal/render`、`internal/path` 分包；共享 BSS 的模块放在同一包内，跨包调用的汇编函数首字母大写导出。

---

## 里程碑进度

唯一任务级进度源为 [docs/2.1-CHECKLIST.md](docs/2.1-CHECKLIST.md)；下表仅在里程碑关卡通过时更新：

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

---

## 协作流程与文档导航

每轮会话按 [AGENTS.md](AGENTS.md) 推进一个清单条目：`/next` 选条目并确认契约 → 代理写测试与四段式「本轮学习点」 → 你写汇编实现（代理按概念 → 数据流 → 指令三级提示协助） → 你发「验收」触发实测、`objdump` 审查、优化建议整理与自动提交。

按阅读顺序组织的文档体系：

1. [docs/1.1-OVERVIEW.md](docs/1.1-OVERVIEW.md) — 通俗心智模型、核心数据结构与函数职责。
2. [docs/1.2-ROADMAP.md](docs/1.2-ROADMAP.md) — M0–M8 里程碑目标、学习点、验收口径与常见坑。
3. [docs/2.1-CHECKLIST.md](docs/2.1-CHECKLIST.md) — 唯一任务级进度源：条目顺序、状态、证据与关卡。
4. [docs/2.2-CONTRACTS.md](docs/2.2-CONTRACTS.md) — 已冻结签名、编码、BSS 布局，以及 M2 契约草案和开放决策。
5. [docs/3.1-DESIGN.md](docs/3.1-DESIGN.md) — 技术蓝图、BSS 容量估算、算法不变量与安全性论证。
6. [docs/3.2-REFERENCES.md](docs/3.2-REFERENCES.md) — 官方文档、Go 标准库汇编示例、调试工具与按条目的阅读地图。
7. 里程碑与专题笔记：[4.1 工程骨架](docs/4.1-ENGINEERING-NOTES.md)、[4.2 基本功](docs/4.2-FUNDAMENTALS-NOTES.md)、[4.3 补码与 AbsDiff](docs/4.3-TWOS-COMPLEMENT-NOTES.md)、[4.4 终端与系统调用](docs/4.4-TERMINAL-NOTES.md)（M7/M8 另产 `5.1-PERF.md`、`5.2-DEMO.md`）。

---

## 非目标

- 键盘控制、分数排行榜、存档、网络对战。
- 引入 `tcell`/`bubbletea` 等第三方 TUI 库。
- Linux/Windows 系统调用移植（游戏与寻路逻辑保持平台无关，系统调用仅实现 Darwin）。
- 极限 SIMD 优化；性能目标是“全屏自动通关在可接受时间内完成”。
