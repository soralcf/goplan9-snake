## M1

> 补码、整数溢出与 `AbsDiff` 两种契约的专题笔记：[M1-TWOS-COMPLEMENT-NOTES.md](M1-TWOS-COMPLEMENT-NOTES.md)

### internal

将代码文件与函数移动至 internal 方便管理, 模块名不能包含 - , 才能跨包导入汇编代码

M1 的函数统一用导出名（`CellIndex`、`Clamp`、`FillByte`……）：跨包汇编只能引用导出符号，`CALL goplan9snake/internal/grid·CellIndex(SB)` 这种写法遇到小写名会链接失败。

### 命令

#### 用 objdump 查看 `grid.CellIndex` 的汇编

`go tool objdump` 读的是**可执行文件/测试二进制**，不能直接读 `.s` 源码。步骤：

1. 编译出包含该函数的二进制（`-c` 只编译不运行，`-o` 指定输出路径）：

```bash
go test -c ./internal/grid -o /tmp/grid.test
```

不加 `-o` 时会在当前目录生成 `grid.test`。`/tmp/grid.test` 是 4.2M 的 Mach-O arm64 可执行文件，包含测试入口、grid 包机器码、运行时、符号表和 DWARF 信息。改完 `.s` 后必须重新执行这一步，否则反汇编的是旧代码。

2. 查符号全名：

```bash
go tool nm /tmp/grid.test | grep 'grid\.CellIndex'
# 10011f780 T goplan9snake/internal/grid.CellIndex.abi0
```

手写汇编按 ABI0 实现，链接后符号带 `.abi0` 后缀。

3. 按正则反汇编：

```bash
go tool objdump -s 'goplan9snake/internal/grid\.CellIndex' /tmp/grid.test
```

实际输出：

```text
TEXT goplan9snake/internal/grid.CellIndex.abi0(SB) .../internal/grid/grid_arm64.s
  grid_arm64.s:5   0x10011f780  b9800be0  MOVW 8(RSP), R0
  grid_arm64.s:6   0x10011f784  b9800fe1  MOVW 12(RSP), R1
  grid_arm64.s:7   0x10011f788  b98013e2  MOVW 16(RSP), R2
  grid_arm64.s:8   0x10011f78c  1b017c42  MULW R1, R2, R2
  grid_arm64.s:9   0x10011f790  0b000042  ADDW R0, R2, R2
  grid_arm64.s:10  0x10011f794  b9001be2  MOVW R2, 24(RSP)
  grid_arm64.s:11  0x10011f798  d65f03c0  RET
  grid_arm64.s:11  0x10011f79c  00000000  ?
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

- 输入按各自对齐排布：x+0、y+4、w+8，输入结束于 12。
- 分配结果前，编译器 `abiutils.go` 执行 `stackOffset = RoundUp(stackOffset, types.RegSize)`：12 → 16，所以 `ret+16(FP)`，12–15 是 4 字节填充。
- `go vet` 的 asmdecl 用同一规则：结果前 `offset += -offset & (maxAlign-1)`，`maxAlign = Alignof(int64) = 8`。

ABI 文档中对应栈序列的 `pointer-alignment`（stack-assigned arguments 与 results 之间）。最终大小 = 16（结果偏移）+ 4（int32）= 20。

可在调用点验证：`TestCellIndex.func1` 把 x 写到 `8(RSP)`、y/w 写到 `12(RSP)`，`CALL CellIndex.abi0` 后从 `24(RSP)` 读返回值——即 `ret+16(FP)`。若误写成 `ret+12(FP)`，`go vet` 会报 `invalid offset ret+12; expected ret+16(FP)`。

