# M1 笔记：数据、循环、分支、BSS

状态：已完成（2026-11-23）。

- 专题笔记：[补码、整数溢出与 AbsDiff 契约](M1-TWOS-COMPLEMENT-NOTES.md)
- 前一个里程碑：[M0-NOTES.md](M0-NOTES.md)

## 代码组织

代码按职责拆到 `internal/<pkg>/`：

| 包 | 函数 |
|---|---|
| `internal/arith` | `Add`、`Clamp`、`AbsDiff`、`SumTo` |
| `internal/grid` | `CellIndex` |
| `internal/rng` | `Xorshift64` |
| `internal/mem` | `FillByte` |
| `internal/counter` | `Inc`、`Reset` |

每个包只有三类文件：`<pkg>.go`（无函数体声明和常量）、`<pkg>_arm64.s`（实现）、`<pkg>_test.go`（测试与 Go oracle）。模块名必须是不带 `-` 的 `goplan9snake`，跨包汇编才能写成 `CALL goplan9snake/internal/grid·CellIndex(SB)`。

M1 的函数统一使用导出名：跨包汇编只能引用导出符号，小写名会导致链接失败。

## 函数契约与测试

| 函数 | 契约要点 | 测试 |
|---|---|---|
| `Add(a, b int64) int64` | 64 位加法，溢出按补码回绕 | `TestAdd`（含 MinInt64 / MaxInt64 边界） |
| `Clamp(v, lo, hi int32) int32` | `lo > hi` 时返回 `hi`；否则夹到 `[lo, hi]` | `TestClamp`（四条出口、负数、int32 极值） |
| `AbsDiff(a, b int32) int32` | 32 位补码回绕；真实差装得下 int32 时精确 | `TestAbsDiff`；细节见专题笔记 |
| `SumTo(n int64) int64` | `n <= 0` 返回 0；正 n 按 int64 回绕 | `TestSumTo`、`TestSumToReference` |
| `CellIndex(x, y, w int32) int32` | `y*w + x`，32 位运算 | `TestCellIndex`、100k 组随机对拍 |
| `Xorshift64(state uint64) uint64` | 移位 13 / 7 / 17；0 是吸收态，调用方保证种子非零 | 冻结向量、零状态 1000 步、10k 步序列、100k 组对拍 |
| `FillByte(buf *byte, n int32, v byte)` | 只写 `[buf, buf+n)`；`n <= 0` 是空操作 | 整段 / 前缀 / 精确边界、`nil` + 非正 n、1 MiB、1000 组对拍 |
| `Inc() int64` / `Reset()` | `Inc` 先加一再返回新值；`Reset` 清零；包级共享状态不支持并发 | `TestInc`、`TestIncReturnsRunningTotal`、`TestReset` |

共享 BSS 的测试在每个用例前 `Reset`，不使用 `t.Parallel()`。

## 关键知识

### 用 objdump 阅读汇编

`go tool objdump` 读的是**可执行文件/测试二进制**，不能直接读 `.s` 源码。步骤：

1. 编译出包含该函数的二进制（`-c` 只编译不运行，`-o` 指定输出路径）：

```bash
go test -c ./internal/grid -o /tmp/grid.test
```

不加 `-o` 时会在当前目录生成 `grid.test`。`/tmp/grid.test` 是 Mach-O arm64 可执行文件，包含测试入口、包机器码、运行时、符号表和 DWARF 信息。改完 `.s` 后必须重新执行这一步，否则反汇编的是旧代码。

2. 查符号全名：

```bash
go tool nm /tmp/grid.test | grep 'grid\.CellIndex'
# 10011f7d0 T goplan9snake/internal/grid.CellIndex.abi0
```

手写汇编按 ABI0 实现，链接后符号带 `.abi0` 后缀。下文地址来自 2026-11-23 的构建，重新编译后会变化；行号以当前源码为准。

3. 按正则反汇编：

```bash
go tool objdump -s 'goplan9snake/internal/grid\.CellIndex' /tmp/grid.test
```

实际输出：

```text
TEXT goplan9snake/internal/grid.CellIndex.abi0(SB) .../internal/grid/grid_arm64.s
  grid_arm64.s:5   0x10011f7d0  b9800be0  MOVW 8(RSP), R0
  grid_arm64.s:6   0x10011f7d4  b9800fe1  MOVW 12(RSP), R1
  grid_arm64.s:7   0x10011f7d8  b98013e2  MOVW 16(RSP), R2
  grid_arm64.s:8   0x10011f7dc  1b017c42  MULW R1, R2, R2
  grid_arm64.s:9   0x10011f7e0  0b000042  ADDW R0, R2, R2
  grid_arm64.s:10  0x10011f7e4  b9001be2  MOVW R2, 24(RSP)
  grid_arm64.s:11  0x10011f7e8  d65f03c0  RET
  grid_arm64.s:11  0x10011f7ec  00000000  ?
```

尾部那行 `?`（机器码全 0）不属于源码逻辑，是符号范围内的填充字节，忽略即可。

输出列：`.s` 行号、指令地址、机器码、Go 语法反汇编。

读输出的要点：

- `x+0(FP)` → `8(RSP)`：ABI0 下进入函数时 `0(RSP)` 是返回地址，虚 FP 从 `8(RSP)` 开始；所以 `x/y/w` 在 `8/12/16(RSP)`，`ret+16(FP)` 在 `24(RSP)`。
- 源码的双操作数伪指令会被展开：`MULW R1, R2` → `MULW R1, R2, R2`，`ADDW R0, R2` → `ADDW R0, R2, R2`。
- objdump 默认显示 Go 语法，`-gnu` 可同时显示 GNU 语法（`MOVW` 对应 `ldrsw`，`MULW` 对应 `mul`）。
- `-S` 尝试附带 Go 源码；`-s` 后面是 Go 正则，`.` 能匹配任意字符，严格写法是 `grid\.CellIndex`。
- 也可按地址范围反汇编：`go tool objdump /tmp/grid.test 0x10011eed0 0x10011eeec`。

流程：`.s` 源码 → `go test -c` → 可执行文件 → `go tool objdump` → 反汇编。`/tmp/grid.test` 可随时删除，需要时重新生成。

### 为什么参数加返回值是 `$0-20` 而不是 `$0-16`

`CellIndex(x, y, w int32) int32` 的四个值各 4 字节，共 16 字节，但 Go ABI 规定**栈上结果区之前要做指针/寄存器对齐**（64 位为 8 字节）：

- 输入按各自对齐排布：`x+0`、`y+4`、`w+8`，输入结束于 12。
- 分配结果前，编译器 `abiutils.go` 执行 `stackOffset = RoundUp(stackOffset, types.RegSize)`：12 → 16，所以 `ret+16(FP)`，12–15 是 4 字节填充。
- `go vet` 的 asmdecl 用同一规则：结果前 `offset += -offset & (maxAlign-1)`，`maxAlign = Alignof(int64) = 8`。

ABI 文档中对应栈序列的 `pointer-alignment`（stack-assigned arguments 与 results 之间）。最终大小 = 16（结果偏移）+ 4（int32）= 20。

可在调用点验证：`TestCellIndex.func1` 把 x 写到 `8(RSP)`、y/w 写到 `12(RSP)`，`CALL CellIndex.abi0` 后从 `24(RSP)` 读返回值——即 `ret+16(FP)`。若误写成 `ret+12(FP)`，`go vet` 会报 `invalid offset ret+12; expected ret+16(FP)`。

### 宽度与符号扩展

| Go 汇编 | 机器语义 | 常见用途 |
|---|---|---|
| `MOVD` | 64 位加载 / 存储 | `int64`、`uint64`、地址、指针 |
| `MOVW` | 32 位加载并**符号扩展**到 64 位（LDRSW） | `int32` |
| `MOVWU` | 32 位零扩展（LDR） | `uint32` |
| `MOVH` / `MOVHU` | 16 位符号 / 零扩展 | `int16` / `uint16` |
| `MOVB` / `MOVBU` | 8 位符号 / 零扩展（LDRSB / LDRB） | `int8` / `byte` |

- 读 `int32` 参数用 `MOVW`，负数是干净的 64 位负数，`CMP` + `BLT` / `BGT` 的有符号比较才正确。
- 用 `MOVWU` 读有符号数会把负数变成巨大正数；用 `BLO` / `BHI` 做有符号比较也会错。
- 写回 `int32` 用 `MOVW`，只存低 32 位；Go 侧按 `int32` 解释。
- `MOVB` 是符号扩展：`FillByte` 的 `v byte` 若用 `MOVB` 读，`v = 0xA0` 时寄存器是 `0xffffffffffffffa0`。当前只存低 8 位所以结果正确，但 `MOVBU` 语义更干净，也是 8 字节批量复制的前提。

### 符号可见性与 BSS

- `·name(SB)`：包级符号，可跨文件引用；导出的符号可从其他包用 `包路径·Name(SB)` 调用。
- `name<>(SB)`：静态符号，只在当前目标文件内可见，适合文件内辅助数据和标签。
- `GLOBL ·value(SB), NOPTR, $8`：BSS 中 8 字节无指针数据，初值 0。`NOPTR` 告诉运行时这里没有指针，GC 不必扫描；含指针的数据不能加 `NOPTR`。
- `GLOBL` 的大小是字节数，不是元素个数；`int32` 数组要写 `$MaxCells*4`。

### counter：BSS 计数器（2026-11-23 验收）

**契约**

- `Inc() int64`：先把 `·value` 加一，再返回加一后的值；`Reset` 后依次得到 1, 2, 3, …
- `Reset()`：把 `·value` 归零，无返回值，可重复调用。
- `·value` 是 8 字节 `NOPTR` BSS，初值 0；测试每个用例先 `Reset`，不使用 `t.Parallel()`。
- `int64` 溢出按补码回绕；从 0 出发不可达，不做断言。

**测试与变异**

`internal/counter/counter_test.go`：

- `TestInc`：字面量冻结 1 / 2 / 1000。
- `TestIncReturnsRunningTotal`：100k 次逐次断言第 i 次返回 i。
- `TestReset`：计数后重置、未计数重置、连续重置。

定向变异（仓库外临时副本，改真实汇编）：

- `ADD $1` → `ADD $2`：三个测试全部失败。
- 删掉 Reset 的 `MOVD ZR, ·value(SB)`：三个测试全部失败。

**objdump 关键输出**

```text
TEXT goplan9snake/internal/counter.Inc.abi0(SB)
  counter_arm64.s:8   ADRP 1847296(PC), R27
  counter_arm64.s:8   MOVD 736(R27), R0
  counter_arm64.s:9   ADD $1, R0, R0
  counter_arm64.s:10  ADRP 1847296(PC), R27
  counter_arm64.s:10  MOVD R0, 736(R27)
  counter_arm64.s:11  MOVD R0, 8(RSP)
  counter_arm64.s:12  RET
TEXT goplan9snake/internal/counter.Reset.abi0(SB)
  counter_arm64.s:37  ADRP 1847296(PC), R27
  counter_arm64.s:37  MOVD ZR, 736(R27)
  counter_arm64.s:38  RET
```

要点：

- `ret+0(FP)` 在机器码里是 `8(RSP)`；`0(RSP)` 是返回地址，虚 FP 从 `8(RSP)` 开始。
- 每个 `·value(SB)` 引用展开成 `ADRP + MOVD`。`R27` 是 Go 汇编器保留的临时寄存器（REGTMP），由汇编器生成，不是源码用了 R27。
- `MOVD ZR, ·value(SB)` 一条 store 完成清零。
- 复用符号地址的变体（`MOVD $·value(SB), R1`）指令数不变，benchmark 无差异，已记录在 `counter_arm64.s` 的 `// [优化建议]` 中。

## 验收（2026-11-23）

```text
$ gofmt -l .
（空）
$ go vet ./...
（空）
$ go test ./... -count=1
ok  goplan9snake/internal/arith
ok  goplan9snake/internal/counter
ok  goplan9snake/internal/grid
ok  goplan9snake/internal/mem
ok  goplan9snake/internal/rng
$ go build -o snake .
（成功）
$ go test -c ./internal/grid -o /tmp/grid.test
$ go tool objdump -s 'goplan9snake/internal/grid\.CellIndex' /tmp/grid.test | head -20
（输出了 CellIndex.abi0 的 MOVW / MULW / ADDW / MOVW / RET，见上文）
```

- `Xorshift64(0)` 的零状态、`FillByte` 的 `n <= 0` / `nil` 行为都有专门测试。
- 随机对拍：`CellIndex` 与 `Xorshift64` 各 100k 组，`FillByte` 1000 组。
- 每个函数的 `// [优化建议]` 已写在对应汇编函数下方。

## 下一步

M2：Darwin 系统调用与终端生命周期，见 [ROADMAP.md](ROADMAP.md) 的 M2。
