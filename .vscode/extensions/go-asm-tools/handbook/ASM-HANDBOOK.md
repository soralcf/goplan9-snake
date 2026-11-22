# Go Plan 9 汇编手册

> 适用版本：Go 1.27.x
> 主架构：darwin/arm64
> 语法：Go Plan 9 汇编（ABI0）
>
> 本手册由工作区扩展内置，是离线参考手册。标注 [通用] 的规则适用于 Go 手写汇编；标注 [arm64] 的规则以本机 `GOOS=darwin`、`GOARCH=arm64` 为准；标注 [amd64] 的内容仅用于架构对照，不是本项目实现目标。发生冲突时，以 `$GOROOT` 源码、`go vet` 和 `go tool objdump` 的结果为准。

## 1. 阅读约定

### 1.1 架构标记

| 标记 | 含义 | 本项目 | 使用建议 |
|---|---|---|---|
| [通用] | Go 工具链的 Plan 9 汇编通用规则 | 适用 | 必须掌握 |
| [arm64] | darwin/arm64 的寄存器、指令与栈布局 | 主架构 | 必须掌握 |
| [darwin] | macOS 的系统调用与终端约定 | 适用 | 必须掌握 |
| [amd64] | 与 arm64 的差异对照 | 不实现 | 了解即可 |

### 1.2 符号约定

| 写法 | 含义 | 示例 |
|---|---|---|
| `$value` | 立即数 | `MOVD $42, R0` |
| `symbol(SB)` | 符号地址 | `·Add(SB)` |
| `offset(FP)` | 参数/返回值槽 | `a+0(FP)` |
| `name-offset(SP)` | 栈上局部变量 | `local-8(SP)` |
| `//` | 行注释 | `// R0 = sum` |
| `源, …, 目标` | 操作数顺序描述 | `MOVD R0, R1` |
| `TEXT` 行 | 函数声明 | `TEXT ·Add(SB), NOSPLIT, $0-24` |

代码块默认是 Go 汇编；`go`、`bash`、`text` 块会单独标注。`objdump` 输出使用 `text` 块。

### 1.3 章节导航

| 章节 | 内容 | 架构 |
|---|---|---|
| 2 | 架构差异与文件组织 | 通用 + 对照 |
| 3 | 最小函数与 ABI0 | 通用 + arm64 |
| 4 | 参数、返回值与栈帧 | 通用 + arm64 |
| 5 | 伪寄存器与物理寄存器 | 通用 + arm64 |
| 6 | 数据、符号与 GC | 通用 |
| 7 | 操作数与寻址 | arm64 |
| 8 | 指令参考 | arm64 |
| 9 | 条件码与分支 | arm64 |
| 10 | 函数调用 | 通用 + arm64 |
| 11 | Darwin 系统调用 | darwin/arm64 |
| 12 | 终端与 ANSI | 终端通用 |
| 13 | 测试、反汇编与调试 | 通用 |
| 14 | 诊断与常见错误 | 通用 + arm64 |
| 15 | 学习路径与资料 | 通用 |
| 16 | 术语与缩写总表 | 通用 |

本手册的表格在涉及缩写时提供“英文展开”列；完整索引见第 16 章。搜索框支持 `Ctrl+F` / `Cmd+F`，`Enter` / `↓` 跳到下一个匹配，`Shift+Enter` / `↑` 跳到上一个，也可点击搜索框旁的上下按钮；`Esc` 清空。代码块右侧提供复制按钮。

## 2. 架构差异与文件组织

### 2.1 文件命名与构建约束

| 文件模式 | 目标架构 | 说明 |
|---|---|---|
| `*_arm64.s` | arm64 | 本项目使用；Go 构建约束自动生效 |
| `*_amd64.s` | amd64 | 其他平台或对照实验 |
| `*_arm.s` | arm（32 位） | 本项目不使用 |
| `*_<arch>.s` | 由后缀决定 | 需要额外条件时配合 `//go:build` |

规则：

- 架构由文件名后缀决定；`.s` 文件与同包 `.go` 声明一起参与构建。
- 每个 `.s` 文件包含 `#include "textflag.h"`；需要 Go 常量或结构体偏移时再包含 `go_asm.h`。
- 手写汇编使用 ABI0；ABIInternal 的寄存器分配不属于本手册的手写范围。
- 跨架构共享的算法可以放在 `*_<arch>.s` 中分别实现，但不要共享架构相关的指令宏。

### 2.2 arm64 与 amd64 对照

| 项目 | darwin/arm64 | darwin/amd64 | 说明 |
|---|---|---|---|
| 通用寄存器 | `R0`–`R30` | `AX`、`BX`、`CX`、`DX`、`SI`、`DI`、`BP`、`R8`–`R15` | 命名体系完全不同 |
| 栈指针 | `RSP` | `RSP` | 均为硬件栈指针 |
| 帧指针 | `R29` | `RBP` | 手写汇编通常用 `FP` 伪寄存器访问参数 |
| 返回地址 | `R30`（LR） | `CALL` 压栈 | arm64 使用链接寄存器 |
| 栈对齐 | 16 字节 | 8 字节 | 帧大小按 8 字节倍数书写，本项目约定 16 |
| 参数传递 ABI0 | 调用者栈帧 | 调用者栈帧 | 手写汇编保持一致 |
| 操作数顺序 | 多数指令“源, …, 目标”，相对 GNU 反向 | 通常“源, 目标” | 不可直接照搬 |
| 宽度表示 | 助记符内：`MOVD`、`MOVW`、`MOVB` | 后缀式：`MOVQ`、`MOVL`、`MOVW`、`MOVB` | `D`=Doubleword，`Q`=Quadword；arm64 没有 D 宽度后缀，未加 `W` 的整数运算默认 64 位 |
| 条件分支 | `BEQ`、`BNE`、`BLT`、`BGT` | `JEQ`、`JNE`、`JLT`、`JGT` | 条件码含义相同，助记符不同 |
| 系统调用 | `R16` 调用号，`SVC $0x80` | `AX` 调用号 + `0x2000000`，`SYSCALL` | Darwin 约定不同 |
| 本项目 | 主目标 | 不实现 | 仅作差异对照 |

注意：ABIInternal 的整数参数寄存器也不同（arm64 使用 `R0`–`R15` 一带，amd64 使用 `AX`、`BX`、`CX`、`DI`、`SI`、`R8`–`R11` 等）。手写汇编坚持 ABI0，可以避免依赖这些细节。

### 2.3 架构相关与架构无关

| 内容 | 类别 | 说明 |
|---|---|---|
| `TEXT`/`GLOBL`/`DATA` 声明 | 通用 | 语法一致 |
| `FP`/`SB`/`SP`/`PC` 伪寄存器 | 通用 | 语义一致 |
| `go_asm.h` 常量与结构体偏移 | 通用 | 由 Go 编译器生成 |
| 寄存器名称与保留规则 | arm64 | 见第 5 章 |
| 指令助记符与操作数顺序 | arm64 | 见第 7–9 章 |
| Darwin 系统调用号与寄存器 | darwin/arm64 | 见第 11 章 |
| 终端 ANSI 序列 | 终端通用 | 见第 12 章 |

## 3. 最小函数与 ABI0

**适用**：[通用] ABI0 与函数声明；[arm64] 示例指令。

### 3.1 Go 侧声明

Go 文件只保留函数声明，不写函数体：

```go
func Add(a, b int64) int64
```

### 3.2 arm64 实现

```asm
#include "textflag.h"

TEXT ·Add(SB), NOSPLIT, $0-24
	MOVD a+0(FP), R0
	MOVD b+8(FP), R1
	ADD  R0, R1
	MOVD R1, ret+16(FP)
	RET
```

### 3.3 TEXT 行逐项说明

| 部分 | 英文展开 | 含义 | 架构 |
|---|---|---|---|
| `#include "textflag.h"` | Text Flags header | 引入 `NOSPLIT`、`NOFRAME`、`RODATA` 等宏 | 通用 |
| `TEXT` | Text symbol | 声明代码段中的函数符号 | 通用 |
| `·Add` | package-local symbol | `·` 表示当前包；符号名为 `Add` | 通用 |
| `(SB)` | Static Base | 符号地址相对于静态基址 | 通用 |
| `NOSPLIT` | No Stack Split | 不插入栈增长检查 | 通用 |
| `$0-24` | frame size - argument size | 0 字节局部帧；参数 + 返回值共 24 字节 | 通用 |
| `a+0(FP)` | Frame Pointer | 第一个参数；名字和偏移必须与 Go 声明一致 | 通用 |
| `MOVD` | Move Doubleword | 64 位移动/加载/存储 | arm64 |
| `ADD` | Add | 加法；`ADD R0, R1` 等价于 `R1 = R1 + R0` | arm64 |
| `RET` | Return | 返回调用者 | 通用 |

### 3.4 参数大小计算

`argsize` 是参数与返回值的总字节数，不是参数个数。

| Go 类型 | 字节数 | 说明 |
|---|---:|---|
| `int32`、`uint32`、`rune` | 4 | 32 位整数 |
| `int64`、`uint64`、指针 | 8 | 64 位整数/地址 |
| `string` | 16 | 数据指针 + 长度 |
| `slice` | 24 | 数据指针 + 长度 + 容量 |
| `interface` | 16 | 类型指针 + 数据指针 |

示例：`func Add(a, b int64) int64` 的参数大小为 `8 + 8 + 8 = 24`，所以写 `$0-24`。

### 3.5 符号与 FP 伪寄存器

`FP` 是伪寄存器，不是硬件寄存器。汇编器根据 ABI0 栈布局把它翻译成实际的 `RSP` 偏移。本项目的实测输出：

```text
10009b5c0 T main.Add.abi0

TEXT main.Add.abi0(SB) add_arm64.s
  add_arm64.s:4    f94007e0    MOVD 8(RSP), R0
  add_arm64.s:5    f9400be1    MOVD 16(RSP), R1
  add_arm64.s:6    8b000021    ADD R0, R1, R1
  add_arm64.s:7    f9000fe1    MOVD R1, 24(RSP)
  add_arm64.s:8    d65f03c0    RET
```

手写 `.s` 使用 ABI0，符号名带 `.abi0`；Go 函数使用 ABIInternal。两者之间的转换由编译器/链接器处理，小函数上可能直接看到对 `.abi0` 符号的调用。硬件偏移由 ABI0 布局决定，不应手工推导；参数名和 `go vet` 才是正确的检查手段。

### 3.6 构建与验证

```bash
go build -o snake .
go tool nm ./snake | grep 'main\.Add'
go tool objdump -s 'main\.Add' ./snake | head -20
```

验收标准：

- `go tool nm` 能看到 `main.Add.abi0`。
- `objdump` 中的指令与源码一致，而不是编译器生成的替身。
- `go vet ./...` 不报告参数大小或偏移错误。

## 4. 参数、返回值与栈帧

**适用**：[通用] ABI0；[arm64] 栈布局与帧大小。

### 4.1 ABI0 与 ABIInternal

| 名称 | 英文展开 | 参数位置 | 结果位置 | 使用场景 |
|---|---|---|---|---|
| ABI0 | Application Binary Interface, version 0 | 调用者栈帧，经 `FP` 访问 | 调用者栈帧 | 手写汇编默认 |
| ABIInternal | Go internal register-based ABI | 优先寄存器，栈上放溢出区 | 寄存器，必要时栈 | Go 编译器生成的函数 |

| 对比项 | ABI0 | ABIInternal |
|---|---|---|
| 符号示例 | `main.Add.abi0` | `main.Add` |
| 从汇编调用 | `BL ·foo(SB)` | `BL ·foo<ABIInternal>(SB)` 或依赖包装 |
| 是否手写 | 是 | 否；除非明确了解兼容性风险 |

现代 Go 通常不需要 `GO_ARGS`、`GO_RESULTS_INITIALIZED` 这类旧写法。手写汇编保持 ABI0。

### 4.2 帧大小与参数大小

语法：

```asm
TEXT ·f(SB), flags, $帧大小-参数大小
```

| 项 | 单位 | 说明 |
|---|---|---|
| 帧大小 | 字节 | 局部变量占用的空间；不含自动保存的 `LR`/`FP` |
| 参数大小 | 字节 | 参数 + 返回值的总字节数 |
| 对齐 | 字节 | 本项目约定帧大小为 16 的倍数 |
| `NOFRAME` | 标志 | 要求帧大小为 0，并关闭分配帧的序言 |

汇编器会为非叶子函数补上保存 `R30`（LR）与 `R29`（FP）的序言，并把栈帧补齐到 16 字节对齐。叶子函数可以省略这些保存。

### 4.3 局部变量

局部变量使用“名字-偏移”的写法，例如 `local-8(SP)`。名字只是可读锚点，不需要在 Go 中声明；偏移必须在帧大小范围内。

```asm
TEXT ·useFrame(SB), NOSPLIT, $16-16
	MOVD a+0(FP), R0
	MOVD R0, local-8(SP)
	MOVD local-8(SP), R1
	MOVD R1, ret+8(FP)
	RET
```

`$16-16` 表示 16 字节局部帧、16 字节参数区（一个参数加一个返回值）。汇编器会把源码中的 `local-8(SP)` 换算成实际帧内的硬件偏移，不要假设两者数值相同。局部变量应控制在帧大小以内；越界会覆盖保存的 `LR`/`FP` 或其他局部槽。

### 4.4 分支与比较示例

```asm
TEXT ·clamp(SB), NOSPLIT, $0-32
	MOVD v+0(FP), R0
	MOVD lo+8(FP), R1
	MOVD hi+16(FP), R2
	CMP  R1, R0
	BLT  use_lo
	CMP  R2, R0
	BGT  use_hi
	B    done
use_lo:
	MOVD R1, R0
	B    done
use_hi:
	MOVD R2, R0
done:
	MOVD R0, ret+24(FP)
	RET
```

`CMP R1, R0` 比较的是 `R0` 与 `R1`：后一个操作数是被比较的值。`BLT` 在 `R0 < R1`（有符号）时跳转；`CMP R2, R0` 与 `BGT` 同理。arm64 的操作数顺序见第 7 章。

### 4.5 NOSPLIT 与 NOFRAME

| 标志 | 英文展开 | 含义 | 限制 |
|---|---|---|---|
| `NOSPLIT` | No Stack Split | 不插入栈增长检查 | 函数自身帧和调用链必须能放进当前栈段剩余空间 |
| `NOFRAME` | No Frame | 不生成分配帧、保存 `LR`/`FP` 的序言 | 只允许帧大小为 0；函数内若有 `BL`，返回地址会被覆盖 |
| 无标志 | — | 汇编器按需插入栈检查与序言 | 需要栈增长时使用 |

递归函数、调用链较深的函数不要随手加 `NOSPLIT`。

## 5. 伪寄存器与物理寄存器

**适用**：[通用] 伪寄存器；[arm64] 物理寄存器。

### 5.1 伪寄存器

| 名称 | 英文展开 | 含义 | 架构 |
|---|---|---|---|
| `SB` | Static Base | 静态基址；`·name(SB)` 表示当前包符号地址 | 通用 |
| `FP` | Frame Pointer | 参数/返回值区的帧指针；`0(FP)` 是第一个参数 | 通用 |
| `SP` | Stack Pointer | 栈指针；局部变量用负偏移 | 通用 |
| `PC` | Program Counter | 程序计数器；`2(PC)` 表示相对跳转 | 通用 |
| `TLS` | Thread-Local Storage | 线程局部存储 | 通用 |
| `ZR` | Zero Register | ARM64 零寄存器；读为 0，写入被丢弃 | arm64 |

### 5.2 arm64 物理寄存器

| 寄存器 | 英文展开 | 用途 | 约定 |
|---|---|---|---|
| `R0`–`R17` | General-Purpose Register | 通用寄存器 | 业务代码优先使用 |
| `R19`–`R26` | General-Purpose Register | 通用寄存器 | 可用 |
| `R18` | Platform Register | 平台保留 | 不要使用 |
| `R27` | Assembler Temporary | 汇编器/链接器临时寄存器 | 不要使用 |
| `R28` | Goroutine Pointer (g) | 当前 goroutine 指针 | 不要改写 |
| `R29` | Frame Pointer | 帧指针 | 不要使用 |
| `R30` | Link Register (LR) | 返回地址/链接寄存器 | 不要使用 |
| `RSP` | Stack Pointer | 栈指针 | 由运行时/序言维护 |
| `F0`–`F31` | Floating-point Register | 标量浮点寄存器 | 按宽度使用 |
| `V0`–`V31` | Vector Register | SIMD/浮点向量寄存器 | 需要元素排列后缀 |

补充缩写：GPR = General-Purpose Register（通用寄存器）；SIMD = Single Instruction, Multiple Data（单指令多数据）；LR = Link Register（链接寄存器）。

### 5.3 调用者保存

`R0`–`R17`、`R19`–`R26` 都是调用者保存（scratch）寄存器。跨 `BL` 调用仍需使用的值必须自己保存到栈或重新计算，不能指望被调用者保留。`R28`（g）、`R29`（FP）、`R30`（LR）由运行时和调用约定维护，不应作为普通数据寄存器。

### 5.4 浮点与 SIMD

`F0`–`F31` 用于标量浮点；`V0`–`V31` 用于 SIMD 和向量浮点。向量指令通常带元素排列后缀，例如 `V0.S4`、`V1.D2`、`V2.B16`。本项目以整数和内存操作为主，浮点/SIMD 只在必要时使用。

## 6. 数据、符号与 GC

**适用**：[通用]

### 6.1 DATA、GLOBL 与 BSS

| 名称 | 英文展开 | 作用 |
|---|---|---|
| `DATA` | Data symbol | 初始化符号的指定偏移与宽度 |
| `GLOBL` | Global symbol | 声明全局符号、标志和总大小 |
| BSS | Block Started by Symbol | 未初始化数据段；只写 `GLOBL` 不写 `DATA` |
| `RODATA` | Read-Only Data | 只读数据段 |
| `NOPTR` | No Pointers | 数据中不含指针，GC 不扫描 |

语法：

```asm
DATA symbol+offset(SB)/width, value
GLOBL symbol(SB), flags, size
```

示例：

```asm
DATA ·table+0(SB)/8, $1
DATA ·table+8(SB)/8, $2
GLOBL ·table(SB), RODATA|NOPTR, $16
```

规则：

- `DATA` 的偏移必须递增。
- 宽度常用 1、2、4、8 字节。
- `GLOBL` 必须放在对应的 `DATA` 之后。
- 未显式初始化的字节为 0。
- 本项目约定包级 BSS 直接定义在汇编中，跨 `.s` 文件用 `·name(SB)` 访问。

### 6.2 常用标志

| 标志 | 英文展开 | 含义 | 适用 |
|---|---|---|---|
| `NOSPLIT` | No Stack Split | 不插入栈增长检查 | `TEXT` |
| `NOFRAME` | No Frame | 不生成分配帧的序言，帧大小必须为 0 | `TEXT` |
| `RODATA` | Read-Only Data | 放入只读段 | `DATA`、`GLOBL` |
| `NOPTR` | No Pointers | 不含指针，GC 不扫描 | `DATA`、`GLOBL` |
| `DUPOK` | Duplicate OK | 允许多个同名定义，链接器选一个 | `TEXT`、`DATA` |
| `WRAPPER` | Wrapper function | 标记为包装函数 | `TEXT` |
| `NEEDCTXT` | Need Context | 闭包使用传入的上下文指针 | `TEXT` |
| `TLSBSS` | Thread-Local Storage BSS | 放入线程局部存储 | `DATA`、`GLOBL` |
| `TOPFRAME` | Top Frame | 栈回溯到此为止 | `TEXT` |
| `ABIWRAPPER` | ABI Wrapper | ABI 包装函数 | `TEXT` |

### 6.3 go_asm.h 与 Go 常量

只要包内存在 `.s` 文件，`go build` 就会生成 `go_asm.h`：

```asm
#include "go_asm.h"
```

| Go 声明 | 汇编名称 | 说明 |
|---|---|---|
| `const MaxW = 256` | `const_MaxW` | Go 常量 |
| `type reader struct{...}` | `reader__size` | 结构体总大小 |
| `reader.buf` 字段 | `reader_buf` | 字段偏移 |

示例：

```go
const (
	MaxW     = 256
	MaxH     = 128
	MaxCells = MaxW * MaxH
)
```

```asm
MOVD $const_MaxCells, R0
```

使用 `go_asm.h` 可以避免在汇编中硬编码布局；修改 Go 常量或结构体后，汇编不需要跟着改魔数。

### 6.4 字符串与字节表

短字符串可以直接用 `DATA` 写入：

```asm
DATA ·msg+0(SB)/8, $0x6f6c6c6568
DATA ·msg+8(SB)/1, $0x21
GLOBL ·msg(SB), RODATA|NOPTR, $9
```

ARM64 是小端：`$0x6f6c6c6568` 的低字节先出现在低地址，对应字节序列 `68 65 6c 6c 6f`（`hello`）。长字符串或需要渲染的字符串建议放在 `RODATA` 表中，用循环发送。

### 6.5 GC 与指针规则

| 规则 | 说明 |
|---|---|
| 不含指针的数据 | 必须标 `NOPTR`；`RODATA` 隐含 `NOPTR` |
| 含 Go 指针的全局数据 | 必须定义在 Go 源码中，不能定义在汇编中 |
| 从 Go 传入的指针 | 只在调用期间使用，不要长期保存到全局 BSS |
| 小于一个指针大小的数据 | 视为隐式 `NOPTR` |
| BSS 状态 | 本项目所有全局状态都必须是 `NOPTR` |

## 7. 操作数与寻址

**适用**：[arm64]

### 7.1 操作数形式

| 形式 | 语法 | 含义 |
|---|---|---|
| 立即数 | `$123`、`$-1`、`$0x10` | `$` 表示常量，不能省略 |
| 符号地址 | `·name(SB)` | 当前包的符号地址 |
| 基址 + 偏移 | `8(R0)` | 地址 = `R0 + 8` |
| 基址 + 变址 | `(R1)(R2<<2)` | 地址 = `R1 + R2*4` |
| 前索引写回 | `.W`，如 `MOVB.W 16(R16), R10`、`MOVB.W R10, 16(R16)` | 先更新基址，再访问 |
| 后索引写回 | `.P`，如 `MOVD.P -8(R10), R8`、`MOVD.P R8, -8(R10)` | 先访问，再更新基址 |
| 寄存器对 | `(R7, R8)` | `LDP`/`STP` 使用 |
| 移位操作数 | `R1<<2`、`R1>>22`、`R1->11` | 左移、逻辑右移、算术右移 |
| 扩展操作数 | `R2.SXTH`、`R2.UXTH`、`R1.SXTX` | 符号/零扩展后参与运算 |

表中的符号地址、基址 + 偏移、基址 + 变址、前/后索引写回和寄存器对都是**内存地址形式**，只有搬运指令（`MOV*`、`LDP`/`STP`）接受；运算、比较指令不能直接使用。移位和扩展操作数是寄存器修饰，可以参与运算。完整规则见 7.5 节。

`.P`/`.W` 的偏移同时是写回量，load 和 store 都适用。`MOV*`/`FMOV*` 用未缩放的 9 位有符号字节偏移（-256..255）；`LDP`/`STP` 按访问宽度缩放且必须是宽度的倍数（64 位为 8），例如 `STP.P (R1, R2), 7(R3)` 会被汇编器拒绝。

### 7.2 操作数顺序规则

Go arm64 汇编与 GNU ARM64 汇编的操作数顺序不同：**大多数指令按“源, …, 目标”排列，目标在最后**。

```asm
MOVD R0, R1          // R1 = R0
ADD  R0, R1          // R1 = R1 + R0
SUB  R3, R1, R4      // R4 = R1 - R3
CMP  $8, R3          // 比较 R3 与 8
BHI  greater_8       // 无符号 R3 > 8 时跳转
```

规则：

- 最后一个寄存器或内存操作数通常是目标/左值。
- `CMP a, b` 判断的是 `b` 相对 `a` 的关系。
- `SUB` 的三操作数形式顺序容易写反；写完用表驱动测试覆盖。
- 部分 store 指令、`CBZ`/`CBNZ`、`MADD` 等有特殊顺序，见第 8 章。

### 7.3 宽度与扩展

| 助记符 | 英文展开 | 位宽 | 扩展方式 |
|---|---|---:|---|
| `MOVD` | Move Doubleword | 64 | 直接移动 |
| `MOVW` | Move Word | 32 | 加载时符号扩展 |
| `MOVWU` | Move Word Unsigned | 32 | 零扩展 |
| `MOVH` | Move Halfword | 16 | 加载时符号扩展 |
| `MOVHU` | Move Halfword Unsigned | 16 | 零扩展 |
| `MOVB` | Move Byte | 8 | 加载时符号扩展 |
| `MOVBU` | Move Byte Unsigned | 8 | 零扩展 |

寄存器到寄存器时，宽度后缀决定写入宽度；32 位写入会清零高 32 位。做有符号 32 位运算时，确认符号扩展行为，必要时显式使用 `SXTW` 或 `MOVW` 加载。

算术、逻辑、比较和条件选择指令还可以带宽度/标志后缀：

| 后缀 | 含义 | 例子 |
|---|---|---|
| `W` | 32 位形式；只处理低 32 位，写入型指令会清零目标寄存器的高 32 位 | `NEGW`、`ADDSW`、`CMPW`、`CSELW` |
| `S` | 同时设置条件标志 N/Z/C/V | `NEGS`、`ADDS`、`SUBS`、`ANDS` |
| `SW` | 32 位形式并设置条件标志 | `NEGSW`、`ADDSW`、`SUBSW`、`BICSW` |

`NEG` 是 64 位取负，`NEGW` 是 32 位取负，`NEGSW` 是 32 位取负并设置标志。不是所有指令都有这些变体：例如 `TBZ`/`TBNZ` 没有 W 形式；`MOVZ`/`MOVK`/`MOVN` 有 `MOVZW`/`MOVKW`/`MOVNW`，但源码里通常写 `MOVW`/`MOVD` 让汇编器选择。以本机 `anames.go` 和补全列表为准。

arm64 的整数运算只有 64 位和 32 位两档：**不带后缀的基名就是 64 位**，加 `W` 才是 32 位；不存在 `CMPD` 这类 D 宽度后缀（`ADD`/`SUB` 也没有 `ADDD`/`SUBD`），写出来会报 `unrecognized instruction`。`D` 只在别处表示宽度：`MOVD` 的 D 是 doubleword（64 位），`FADDD`/`FCMPD` 的 D 是 double 浮点精度——都不是“整数 64 位运算”的后缀。

### 7.4 加载与存储

```asm
MOVD $42, R0          // R0 = 42
MOVD R0, R1           // R1 = R0
MOVD 8(R2), R3        // R3 = *(R2 + 8)
MOVD R3, 16(R2)       // *(R2 + 16) = R3
LDP  16(R2), (R3, R4) // 一次加载两个 64 位值
STP  (R3, R4), 16(R2) // 一次存储两个 64 位值
MOVD.P 8(R2), R3      // 后索引 load：R3 = [R2]，然后 R2 += 8
MOVD.W 8(R2), R3      // 前索引 load：R2 += 8，然后 R3 = [R2]
MOVD.P R3, 16(R2)     // 后索引 store：先写 [R2]，然后 R2 += 16
MOVD.W R3, 16(R2)     // 前索引 store：R2 += 16，然后写 [R2]
STP.P  (R3, R4), 16(R2) // 后索引 pair store：先写，然后 R2 += 16
STP.W  (R3, R4), 16(R2) // 前索引 pair store：R2 += 16，然后写
```

### 7.5 指令与操作数类型的匹配

ARM64 是 load/store 架构：**运算只在寄存器之间进行，内存只能由搬运指令读写**。Go 汇编不会自动把 `x+0(FP)` 解引用成参数值，它只是一个地址写法。

| 指令类别 | 允许的操作数 | 示例 |
|---|---|---|
| 运算与比较 | 寄存器 + 寄存器，或寄存器 + 立即数 | `ADD R1, R0`、`CMP $0, R0` |
| 加载与存储 | 寄存器 + 地址形式 | `MOVW 8(R1), R0`、`MOVD R0, 16(R1)` |
| 分支 | 标签、立即数偏移或寄存器 | `B label`、`CBZ R0, label` |

`CMP`、`ADD`、`SUB`、`MUL`、`EOR`、`LSL` 等运算指令不能直接使用 `x+0(FP)`、`8(R1)`、`(R1)(R2<<2)` 这类地址操作数：

```asm
MOVW x+0(FP), R0      // 合法：加载到寄存器
CMP  R1, R0           // 合法：寄存器 vs 寄存器
CMP  $0, R0           // 合法：寄存器 vs 立即数
CMP  x+0(FP), R0      // 非法：CMP 不接受内存/FP 操作数
ADD  8(R1), R0        // 非法：ADD 不接受内存操作数
```

汇编器报 `illegal combination`，并列出每个操作数的种类：

```text
asm: illegal combination: CMP x(FP), R0 PSAUTO_8 REG NONE NONE NONE
asm: illegal combination: ADD (R1), R0 ZOREG NONE NONE REG NONE
```

`PSAUTO_8` 表示伪寄存器的参数地址，`ZOREG` 表示基址寻址，`REG` 表示寄存器，`NONE` 表示该位置为空；报错的含义是“指令编码模板不接受这个位置的这种操作数”。

比较或计算参数时，先加载到寄存器：

```asm
MOVW x+0(FP), R0
MOVW y+4(FP), R1
CMP  R1, R0           // 比较 R0 与 R1
```

规则：

- `FP`、`SB`、`SP` 是伪寄存器（见 5.1 节），只是地址锚点，不能参与运算或比较。
- 立即数只能是常数；`CMP x+0(FP), R0` 这类写法不成立。
- 索引寻址 `(R1)(R2<<2)` 和符号地址 `·name(SB)` 同样只用于搬运指令。
- 与常量比较用 `CMP $imm, Rn`，不需要先把常量装入寄存器。
- 移位（`R1<<2`）和扩展（`R2.SXTH`）是寄存器修饰，不是内存操作数，可用于部分运算指令。

记忆规则：**除了搬运指令，其他指令只认寄存器和立即数。**

拿不准某条指令接受哪种操作数时，写一个三行的临时 `TEXT` 跑 `go build`，看是否报 `illegal combination`；也可以翻 `$GOROOT/src` 下的 `*_arm64.s`，对照标准库的写法。诊断条目见第 14 章。

## 8. 指令参考

**适用**：[arm64]

### 8.1 数据移动

| 指令 | 英文展开 | 说明 |
|---|---|---|
| `MOVD` | Move Doubleword | 64 位加载/存储/寄存器移动 |
| `MOVW` | Move Word | 32 位有符号加载/存储 |
| `MOVWU` | Move Word Unsigned | 32 位无符号加载 |
| `MOVH` | Move Halfword | 16 位有符号加载/存储 |
| `MOVHU` | Move Halfword Unsigned | 16 位无符号加载 |
| `MOVB` | Move Byte | 8 位有符号加载/存储 |
| `MOVBU` | Move Byte Unsigned | 8 位无符号加载 |
| `LDP` | Load Pair | 一次加载两个 64 位寄存器（`LDPW` 为两个 32 位字） |
| `STP` | Store Pair | 一次存储两个 64 位寄存器（`STPW` 为两个 32 位字） |
| `MOVZ` | Move Zero | 把 16 位立即数写入 64 位寄存器并清零其余位（`MOVZW` 为 32 位形式） |
| `MOVK` | Move Keep | 把 16 位立即数写入 64 位寄存器的指定半字，保留其他位（`MOVKW` 为 32 位形式） |
| `MOVN` | Move Not | 把立即数取反后写入 64 位寄存器（`MOVNW` 为 32 位形式） |

大立即数通常由 `MOVZ`/`MOVK` 组合，或由汇编器把 `MOVD $imm, Rn` 展开成多条指令。关心实际指令数时用 `objdump` 确认。

### 8.2 算术与逻辑

| 指令 | 英文展开 | 说明 |
|---|---|---|
| `ADD` / `ADDW` / `ADDS` / `ADDSW` | Add / Add and Set flags | 加；`ADDS` 同时设置标志；`W` 为 32 位形式 |
| `SUB` / `SUBW` / `SUBS` / `SUBSW` | Subtract / Subtract and Set flags | 减；`SUBS` 同时设置标志；`W` 为 32 位形式 |
| `MUL` / `MULW` | Multiply | 乘；溢出回绕，不陷入 |
| `MADD` / `MADDW` | Multiply-Add | `MADD Rm, Ra, Rn, Rd` 对应 `Rd = Ra + Rn*Rm` |
| `MSUB` / `MSUBW` | Multiply-Subtract | 乘减 |
| `SDIV` / `SDIVW` | Signed Divide | 有符号除；除数为 0 时结果为 0，不陷入 |
| `UDIV` / `UDIVW` | Unsigned Divide | 无符号除 |
| `AND` / `ANDW` / `ANDS` / `ANDSW` | Bitwise AND / AND and Set flags | 按位与；`ANDS` 设置标志 |
| `ORR` / `ORRW` | Bitwise OR | 按位或 |
| `EOR` / `EORW` | Exclusive OR | 按位异或 |
| `BIC` / `BICW` / `BICS` / `BICSW` | Bit Clear / Bit Clear and Set flags | `BIC Rm, Rn, Rd` 即 `Rd = Rn &^ Rm`；`BICS` 设置标志 |
| `MVN` / `MVNW` | Move Not | 按位取反 |
| `NEG` / `NEGW` / `NEGS` / `NEGSW` | Negate / Negate and Set flags | 取负；`NEGW` 为 32 位取负，`NEGSW` 同时设置标志 |
| `LSL` / `LSLW` | Logical Shift Left | 左移 |
| `LSR` / `LSRW` | Logical Shift Right | 逻辑右移 |
| `ASR` / `ASRW` | Arithmetic Shift Right | 算术右移 |
| `ROR` / `RORW` | Rotate Right | 循环右移 |
| `TST` / `TSTW` | Test | 按位测试，等价于丢弃结果的 `ANDS` |

`W` 后缀表示 32 位形式；`S` 后缀表示设置条件标志；两者可以组合，例如 `NEGSW`。不带 `W` 的基名（`ADD`、`SUBS`、`CMP` 等）都是 64 位形式，arm64 没有 D 宽度后缀。写 32 位运算时优先用 W 形式，避免把 64 位结果误当成 32 位。

### 8.3 比较与分支

| 指令 | 英文展开 | 说明 |
|---|---|---|
| `CMP` / `CMPW` | Compare | 比较 64 位值并设置标志（`b - a`）；`CMPW` 只比较低 32 位；不存在 `CMPD` |
| `CMN` / `CMNW` | Compare Negative | 比较 64 位值并设置标志（`b + a`）；`CMNW` 只比较低 32 位 |
| `CCMP` / `CCMPW` | Conditional Compare | 64 位条件比较，用于链式条件；`CCMPW` 只比较低 32 位 |
| `CCMN` / `CCMNW` | Conditional Compare Negative | 64 位条件比较（加法形式）；`CCMNW` 只处理低 32 位 |
| `CBZ` / `CBZW` | Compare and Branch on Zero | `R0 == 0` 时跳转；`CBZW` 只测试低 32 位 |
| `CBNZ` / `CBNZW` | Compare and Branch on Non-Zero | `R0 != 0` 时跳转；`CBNZW` 只测试低 32 位 |
| `TBZ` | Test Bit and Branch if Zero | 64 位寄存器中指定位为 0 时跳转 |
| `TBNZ` | Test Bit and Branch if Non-Zero | 64 位寄存器中指定位为 1 时跳转 |
| `B` | Branch | 无条件跳转 |
| `BL` | Branch with Link | 带链接跳转（函数调用） |
| `JMP` | Jump | 跳转到寄存器地址 |
| `CALL` | Call | 调用寄存器地址 |
| `RET` | Return | 返回 |

`TBZ`/`TBNZ` 没有 W 形式；`CMPW`/`CBZW` 等 W 形式只处理低 32 位。`CMP`/`CMN`/`CCMP`/`CCMN` 的基名默认就是 64 位，不存在 `CMPD`/`CMND`。

`B 2(PC)` 表示从当前分支指令向后数 2 条指令的位置；源码中常用于跳过下一条指令。Go 文档中寄存器 `br` 的规范写法是 `JMP`，寄存器 `blr` 的规范写法是 `CALL`。

### 8.4 条件选择

| 指令 | 英文展开 | 说明 |
|---|---|---|
| `CSEL` / `CSELW` | Conditional Select | `CSEL cond, Rn, Rm, Rd`：条件成立选 `Rn`，否则选 `Rm` |
| `CSET` / `CSETW` | Conditional Set | 条件成立写 1，否则写 0 |
| `CSETM` / `CSETMW` | Conditional Set Mask | 条件成立写全 1，否则写 0 |
| `CSINC` / `CSINCW` | Conditional Select Increment | 条件选择并对未选中值加 1 |
| `CSINV` / `CSINVW` | Conditional Select Invert | 条件选择并对未选中值按位取反 |
| `CSNEG` / `CSNEGW` | Conditional Select Negate | 条件选择并对未选中值取负 |

```asm
CSEL GT, R0, R19, R1   // 若 GT 则 R1 = R0，否则 R1 = R19
CSET EQ, R2            // 若 EQ 则 R2 = 1，否则 0
```

条件选择不产生分支，适合替代短小的 `if/else`。不带 `W` 的基名是 64 位形式；带 `W` 的 `CSELW`/`CSETW` 等只写 32 位结果。

## 9. 条件码与分支

**适用**：[arm64]

### 9.1 条件标志

| 标志 | 英文展开 | 含义 |
|---|---|---|
| N | Negative | 结果为负 |
| Z | Zero | 结果为零 |
| C | Carry | 进位/无符号借位 |
| V | oVerflow | 有符号溢出 |

### 9.2 分支条件

| 助记符 | 英文展开 | 条件 | 含义（以 `CMP a, b` 为例） |
|---|---|---|---|
| `BEQ` | Branch if EQual | Z = 1 | `b == a` |
| `BNE` | Branch if Not Equal | Z = 0 | `b != a` |
| `BHS` | Branch if Higher or Same | C = 1 | 无符号 `b >= a` |
| `BCS` | Branch if Carry Set | C = 1 | 同 `BHS` |
| `BLO` | Branch if LOwer | C = 0 | 无符号 `b < a` |
| `BCC` | Branch if Carry Clear | C = 0 | 同 `BLO` |
| `BHI` | Branch if HIgher | C = 1 且 Z = 0 | 无符号 `b > a` |
| `BLS` | Branch if Lower or Same | C = 0 或 Z = 1 | 无符号 `b <= a` |
| `BGE` | Branch if Greater or Equal | N = V | 有符号 `b >= a` |
| `BLT` | Branch if Less Than | N != V | 有符号 `b < a` |
| `BGT` | Branch if Greater Than | Z = 0 且 N = V | 有符号 `b > a` |
| `BLE` | Branch if Less or Equal | Z = 1 或 N != V | 有符号 `b <= a` |
| `BMI` | Branch if MInus | N = 1 | 结果为负 |
| `BPL` | Branch if PLus | N = 0 | 结果为非负 |
| `BVS` | Branch if oVerflow Set | V = 1 | 有符号溢出 |
| `BVC` | Branch if oVerflow Clear | V = 0 | 无符号溢出 |

### 9.3 使用规则

- `CMP a, b` 把后一个操作数 `b` 作为被比较值；条件描述的是 `b` 相对 `a` 的关系。
- 无符号比较使用 `BHS`/`BLO`/`BHI`/`BLS`；有符号比较使用 `BGE`/`BLT`/`BGT`/`BLE`。
- 数组下标、长度、地址一律按无符号处理，避免负数被当成巨大正数。
- `BCC`/`BCS` 与 `BLO`/`BHS` 等价，系统调用错误检查通常使用 `BCC`/`BCS`。

## 10. 函数调用

**适用**：[通用] ABI0 调用；[arm64] 寄存器与栈细节。

### 10.1 汇编内调用

```asm
BL ·leaf(SB)       // 调用另一个 ABI0 汇编函数
```

ABI0 的参数和返回值都在栈上。调用者需要预留出参区，偏移与 callee 的 `FP` 布局一致；返回后在相同位置读取结果。`BL` 把返回地址写入 `R30`；非叶子函数在序言中保存它。

### 10.2 调用 Go 函数

从汇编调用 Go 函数通常写 `BL ·name(SB)`；需要 ABIInternal 符号时加 `<ABIInternal>` 后缀：

```asm
BL runtime·entersyscall<ABIInternal>(SB)
```

跨 ABI 的参数布局由编译器和链接器处理。优先参考 `$GOROOT/src/runtime/asm_arm64.s` 与 `abi-internal.md`，不要依据旧文章推断。

### 10.3 调用约定检查

| 检查项 | 说明 |
|---|---|
| 参数区大小 | 与 Go 声明一致；`go vet` 检查 |
| 调用者保存寄存器 | 跨 `BL` 的值必须自己保存 |
| 栈对齐 | arm64 为 16 字节 |
| 返回地址 | `R30` 由调用机制写入；需要跨调用时保存 |
| `NOSPLIT` | 被调用链必须能放进当前栈段剩余空间 |

## 11. Darwin 系统调用

**适用**：[darwin/arm64]

### 11.1 调用约定

| 项目 | 寄存器/值 | 英文展开 | 说明 |
|---|---|---|---|
| 调用号 | `R16` | Syscall Number | 放入系统调用编号 |
| 参数 | `R0`–`R5` | Argument Registers | 依次放第 1–6 个参数 |
| 触发 | `SVC $0x80` | Supervisor Call | 进入内核 |
| 成功 | carry clear | Carry Flag | 返回值在 `R0`/`R1` |
| 失败 | carry set | Carry Flag | `R0` 为 errno |

补充：SVC = Supervisor Call（管理员调用）；errno = Error Number（错误号）；syscall = System Call（系统调用）。

### 11.2 常用调用号

| 名称 | 英文展开 | 编号 | 用途 |
|---|---|---:|---|
| `SYS_EXIT` | System Exit | 1 | 退出进程 |
| `SYS_READ` | System Read | 3 | 读文件描述符 |
| `SYS_WRITE` | System Write | 4 | 写文件描述符 |
| `SYS_IOCTL` | System I/O Control | 54 | 终端控制，例如 `TIOCGWINSZ` |

### 11.3 write 示例

```asm
TEXT ·write(SB), NOSPLIT, $0-24
	MOVD $1, R0            // fd = stdout
	MOVD buf+0(FP), R1     // 缓冲区指针
	MOVD n+8(FP), R2       // 字节数
	MOVD $4, R16           // SYS_write
	SVC  $0x80
	BCC  ok
	MOVD $-1, R0           // 失败：返回 -1；errno 原本在 R0，需要时先保存
ok:
	MOVD R0, ret+16(FP)
	RET
```

`fd` = File Descriptor（文件描述符）。成功时 `R0` 是写入字节数；失败时 carry set，`R0` 是 errno。若需要把 errno 返回给调用者，应在覆盖 `R0` 前保存。

### 11.4 exit 示例

```asm
MOVD $1, R16           // SYS_exit
MOVD code+0(FP), R0    // 退出码
SVC  $0x80
```

`exit` 不返回。

### 11.5 libSystem trampoline

Darwin 的很多 libc 函数通过 libSystem 调用，而不是裸 `SVC`。声明放在 Go 文件里（本项目允许 `//go:cgo_import_dynamic`），汇编侧用 `BL` 调用。参考 `$GOROOT/src/runtime/sys_darwin_arm64.s` 中的 `usleep_trampoline`：

| 名称 | 英文展开 | 说明 |
|---|---|---|
| libSystem | System Library | macOS 的系统库 |
| `usleep` | Microsecond Sleep | 微秒级睡眠 |
| trampoline | Trampoline | 跳转到动态导入函数的短桩 |

本项目已实测 `write`/`ioctl`/`exit` 的裸 `SVC` 可用；睡眠选择 libc `usleep`，原因见 [DESIGN](docs/3.1-DESIGN.md)。

### 11.6 终端尺寸

`TIOCGWINSZ` = Terminal I/O Control Get WINdow SiZe（获取终端窗口大小）。`struct winsize` 由 4 个 `uint16` 组成，共 8 字节：

| 偏移 | 字段 | 英文展开 | 含义 |
|---:|---|---|---|
| 0 | `ws_row` | Window Size Row | 行数 |
| 2 | `ws_col` | Window Size Column | 列数 |
| 4 | `ws_xpixel` | Window Size X Pixel | 像素宽，常为 0 |
| 6 | `ws_ypixel` | Window Size Y Pixel | 像素高，常为 0 |

调用形式：`ioctl(fd, TIOCGWINSZ, &winsize)`，`fd` 用 0（stdin）或 1（stdout），指针放在 `R2`。

### 11.7 amd64 对照

| 项目 | arm64 | amd64 |
|---|---|---|
| 触发指令 | `SVC $0x80` | `SYSCALL` |
| 调用号 | `R16` | `AX`，调用前加 `0x2000000` |
| 参数 | `R0`–`R5` | `DI`、`SI`、`DX`、`R10`、`R8`、`R9` |
| 返回值 | `R0`/`R1` | `AX`/`DX` |
| 错误 | carry set，`R0` = errno | carry set，`AX` = errno |

该表只用于阅读跨平台源码时的对照；本项目不实现 amd64 系统调用。

## 12. 终端与 ANSI

**适用**：终端通用

| 缩写 | 英文展开 | 说明 |
|---|---|---|
| ANSI | American National Standards Institute | 终端转义序列标准来源 |
| CSI | Control Sequence Introducer | 控制序列引导符，`ESC [` |
| CUP | Cursor Position | 光标定位 |
| SGR | Select Graphic Rendition | 选择图形属性（颜色、粗体等） |
| OPOST | Output Post-processing | 终端输出后处理 |

| 序列 | 作用 |
|---|---|
| `\x1b[?1049h` | 进入备用屏幕（alternate screen） |
| `\x1b[?1049l` | 离开备用屏幕，恢复原画面 |
| `\x1b[?25l` | 隐藏光标 |
| `\x1b[?25h` | 显示光标 |
| `\x1b[H` | 光标移动到左上角 |
| `\x1b[2J` | 清屏；尽量少用，避免闪烁 |
| `\x1b[row;colH` | 光标定位（行、列从 1 开始） |
| `\x1b[0m` | 重置 SGR 样式 |
| `\x1b[31m` / `\x1b[32m` | 设置前景色 |

渲染约定：

- 进入备用屏幕后隐藏光标；退出前恢复光标和主屏幕。
- 每帧用 `\r\n` 明确换行，不完全依赖终端 OPOST。
- 清屏尽量少用，优先覆盖重写已有内容，减少闪烁。
- 终端尺寸通过 `ioctl(TIOCGWINSZ)` 获取，见第 11.6 节。

## 13. 测试、反汇编与调试

**适用**：[通用]

### 13.1 每个里程碑的固定检查

```bash
gofmt -l .
go test ./... -count=1
go vet ./...
go build -o snake .
```

`go vet` 的 `asmdecl` 检查汇编函数的参数名、偏移和参数大小；`go build` 不执行这些检查。参数大小写错时可能仍然构建成功，因此每次修改汇编后都必须运行 `go vet`。

### 13.2 工具

| 工具/命令 | 英文展开 | 用途 |
|---|---|---|
| `go tool nm` | Name List | 查看链接后的符号 |
| `go tool objdump` | Object Dump | 反汇编，查看真实指令 |
| `go tool objdump -gnu` | GNU syntax dump | 对照 GNU 汇编语法 |
| `go build -gcflags=-S` | Assembly output | 查看编译器生成的汇编 |
| `asmfmt` | Assembly Formatter | 格式化 `.s` 文件 |
| `gofmt` | Go Formatter | 格式化 `.go` 文件 |
| `dlv` | Delve | 汇编级调试器 |

### 13.3 常用命令

```bash
go tool nm ./snake | grep 'main\.'
go tool objdump -s 'main\.tick' ./snake
go tool objdump -gnu -s 'main\.tick' ./snake
go build -gcflags=-S . 2>&1 | head -100
asmfmt -w .
dlv exec ./snake
```

Delve 常用命令：

```text
(dlv) disassemble -l main.tick
(dlv) break main.tick
(dlv) step-instruction
(dlv) regs
```

### 13.4 测试约束

- 共享 BSS 的测试不要使用 `t.Parallel()`。
- 随机/长跑测试必须有 tick 或时间上限断言，避免算法 bug 时挂死。
- 先写纯函数表驱动测试，再写状态机不变量测试。
- 每个里程碑保持 `gofmt`、`test`、`vet`、`build` 全部通过。

## 14. 诊断与常见错误

**适用**：[通用]；部分条目为 [arm64]

| 现象 | 可能原因 | 处理 | 架构 |
|---|---|---|---|
| `undefined: NOSPLIT` | 缺少头文件 | 加 `#include "textflag.h"` | 通用 |
| `wrong argument size` | `$帧-参数` 的参数大小与 Go 声明不符 | 按字节重算参数 + 返回值，运行 `go vet ./...` | 通用 |
| `invalid offset` / 参数名不匹配 | `a+0(FP)` 的名字或偏移与 Go 声明不一致 | 对照 Go 函数签名；名字必须完全一致 | 通用 |
| `invalid instruction` / `illegal combination` | 操作数顺序、宽度后缀或寄存器组合错误 | 查第 7–9 章；用最小例子验证 | arm64 |
| `illegal combination` 且操作数含 `(FP)`、`(R1)` 等 | 给运算/比较指令传了内存或伪寄存器操作数 | 先用 `MOV*` 装入寄存器；见 7.5 节 | arm64 |
| `unexpected EOF` | 标签、括号或 `.P`/`.W` 后缀不完整 | 检查标签定义和操作数 | 通用 |
| `relocation target ... not defined` | 符号拼写错误或缺少 `.s` 实现 | 用 `go tool nm` 查符号；确认文件名后缀 | 通用 |
| `missing function body` | Go 有声明但没有汇编实现 | 检查 `TEXT ·Name(SB)` | 通用 |
| 测试通过但行为不对 | 使用保留寄存器或错误条件码 | 检查 `R18`/`R27`–`R30`；检查 `CMP` 顺序 | arm64 |
| 数字被截断 | 使用了 `MOVW`/`MOVB` 或立即数范围不足 | 改用 `MOVD`；大立即数先装入寄存器 | arm64 |
| 栈上数据被覆盖 | 局部帧太小或偏移越界 | 用 `go vet`、`objdump` 和 Delve 检查帧布局 | 通用 + arm64 |
| `go build` 通过但运行异常 | 参数大小错误未被构建阶段检查 | 运行 `go vet`；检查 ABI0 布局 | 通用 |
| 从 amd64 示例照搬失败 | 寄存器名、指令后缀、系统调用约定不同 | 先读第 2 章，改写为 arm64 形式 | arm64/amd64 |

## 15. 学习路径与资料

### 15.1 按里程碑查手册

| 里程碑 | 先读 | 再读 |
|---|---|---|
| M0 工程骨架/ABI0 | 第 2、3、4 章 | 第 13.1–13.2 节的验证命令 |
| M1 数据/循环/分支/BSS | 第 6、7、8、9 章 | [M1 笔记](docs/4.2-FUNDAMENTALS-NOTES.md) |
| M2 系统调用/终端 | 第 11、12 章 | [DESIGN](docs/3.1-DESIGN.md) 的终端部分 |
| M3 游戏状态/移动 | 第 6、7、8、9 章 | 第 13.4 节的测试约束 |
| M4 渲染/主循环 | 第 11、12 章 | 第 8.1 节的 LDP/STP |
| M5–M7 算法 | 第 7、8、9 章 | [DESIGN](docs/3.1-DESIGN.md)、[REFERENCES](docs/3.2-REFERENCES.md) |
| M8 打磨/验收 | 第 13、14 章 | [ROADMAP](docs/1.2-ROADMAP.md) |

### 15.2 官方资料

| 资料 | 路径/链接 | 用途 |
|---|---|---|
| A Quick Guide to Go's Assembler | `$GOROOT/doc/asm.html` | 官方语法、符号、数据、函数、ARM64 |
| Go arm64 汇编器说明 | `$GOROOT/src/cmd/internal/obj/arm64/doc.go` | Go 语法与 GNU 语法映射、操作数顺序 |
| 汇编器测试用例 | `$GOROOT/src/cmd/asm/internal/asm/testdata/arm64.s` | 真实指令语法示例 |
| Go 内部 ABI 规范 | `$GOROOT/src/cmd/compile/abi-internal.md` | ABI0/ABIInternal、寄存器与栈布局 |
| runtime arm64 汇编 | `$GOROOT/src/runtime/asm_arm64.s` | 函数序言、调用、系统调用协调 |
| Darwin 系统调用 | `$GOROOT/src/syscall/asm_darwin_arm64.s` | `SVC`、errno、返回值约定 |
| 系统调用号 | `$GOROOT/src/syscall/zsysnum_darwin_arm64.go` | `SYS_WRITE`、`SYS_IOCTL`、`SYS_EXIT` |

更多资料与阅读顺序见 [REFERENCES](docs/3.2-REFERENCES.md)。

## 16. 术语与缩写总表

### 16.1 通用与 ABI

| 缩写 | 英文全称 | 说明 |
|---|---|---|
| ABI | Application Binary Interface | 应用二进制接口 |
| ABI0 | ABI, version 0 | 基于栈的手写汇编 ABI |
| ABIInternal | Go internal ABI | Go 编译器使用的寄存器 ABI |
| ABIWRAPPER | ABI Wrapper | ABI 包装函数标志 |
| BSS | Block Started by Symbol | 未初始化数据段 |
| DUPOK | Duplicate OK | 允许多个同名定义 |
| GLOBL | Global symbol | 全局符号声明 |
| DATA | Data symbol | 数据初始化声明 |
| GC | Garbage Collector | 垃圾回收器 |
| Load/Store | Load/Store architecture | 加载/存储架构：运算只在寄存器间进行，内存由搬运指令访问 |
| NOPTR | No Pointers | 不含指针 |
| NOSPLIT | No Stack Split | 不插入栈增长检查 |
| NOFRAME | No Frame | 不生成帧序言 |
| PCALIGN | Program Counter Align | 指令对齐伪指令 |
| RODATA | Read-Only Data | 只读数据段 |
| TEXT | Text symbol | 代码段函数声明 |
| TLS | Thread-Local Storage | 线程局部存储 |
| TLSBSS | Thread-Local Storage BSS | 线程局部 BSS |
| TOPFRAME | Top Frame | 栈回溯终止帧 |
| WRAPPER | Wrapper function | 包装函数标志 |

### 16.2 寄存器与伪寄存器

| 缩写 | 英文全称 | 说明 |
|---|---|---|
| FP | Frame Pointer | 帧指针（伪寄存器） |
| GPR | General-Purpose Register | 通用寄存器 |
| LR | Link Register | 链接寄存器（arm64 的 `R30`） |
| PC | Program Counter | 程序计数器 |
| SB | Static Base | 静态基址（伪寄存器） |
| SIMD | Single Instruction, Multiple Data | 单指令多数据 |
| SP | Stack Pointer | 栈指针 |
| ZR | Zero Register | 零寄存器 |
| g | goroutine | 当前 goroutine 指针（arm64 的 `R28`） |

### 16.3 arm64 指令

`W` 后缀表示 32 位形式（如 `NEGW`、`CMPW`、`CSELW`），`S` 后缀表示设置条件标志（如 `NEGS`），两者可以组合为 `NEGSW`。不带 `W` 的基名是 64 位形式；arm64 没有 D 宽度后缀（`CMP` 已是 64 位，不存在 `CMPD`）。下表列出常用基名和主要变体；完整列表见第 8 章。

| 缩写 | 英文全称 | 说明 |
|---|---|---|
| ADD | Add | 加 |
| ADDS | Add and Set flags | 加法并设置标志 |
| ADDSW | Add and Set flags, 32-bit | 32 位加法并设置标志 |
| ADDW | Add, 32-bit | 32 位加法 |
| AND | Bitwise AND | 按位与 |
| ANDS | Bitwise AND and Set flags | 按位与并设置标志 |
| ANDSW | Bitwise AND and Set flags, 32-bit | 32 位按位与并设置标志 |
| ANDW | Bitwise AND, 32-bit | 32 位按位与 |
| ASR | Arithmetic Shift Right | 算术右移 |
| ASRW | Arithmetic Shift Right, 32-bit | 32 位算术右移 |
| B | Branch | 分支 |
| BCC | Branch if Carry Clear | 无符号小于 |
| BCS | Branch if Carry Set | 无符号大于等于 |
| BEQ | Branch if EQual | 相等 |
| BGE | Branch if Greater or Equal | 有符号大于等于 |
| BGT | Branch if Greater Than | 有符号大于 |
| BHI | Branch if HIgher | 无符号大于 |
| BHS | Branch if Higher or Same | 无符号大于等于 |
| BIC | Bit Clear | 位清除 |
| BICSW | Bit Clear and Set flags, 32-bit | 32 位位清除并设置标志 |
| BICW | Bit Clear, 32-bit | 32 位位清除 |
| BL | Branch with Link | 带链接分支（调用） |
| BLE | Branch if Less or Equal | 有符号小于等于 |
| BLO | Branch if LOwer | 无符号小于 |
| BLS | Branch if Lower or Same | 无符号小于等于 |
| BLT | Branch if Less Than | 有符号小于 |
| BMI | Branch if MInus | 负 |
| BNE | Branch if Not Equal | 不等 |
| BPL | Branch if PLus | 非负 |
| BVC | Branch if oVerflow Clear | 溢出清除 |
| BVS | Branch if oVerflow Set | 溢出设置 |
| CBZ | Compare and Branch on Zero | 为零则分支 |
| CBZW | Compare and Branch on Zero, 32-bit | 32 位为零则分支 |
| CBNZ | Compare and Branch on Non-Zero | 非零则分支 |
| CBNZW | Compare and Branch on Non-Zero, 32-bit | 32 位非零则分支 |
| CCMN | Conditional Compare Negative | 64 位条件比较（加法） |
| CCMP | Conditional Compare | 64 位条件比较 |
| CMP | Compare | 比较（64 位；没有 `CMPD`） |
| CMPW | Compare, 32-bit | 32 位比较 |
| CMN | Compare Negative | 比较负数（64 位，加法形式） |
| CMNW | Compare Negative, 32-bit | 32 位比较负数 |
| CSEL | Conditional Select | 条件选择 |
| CSELW | Conditional Select, 32-bit | 32 位条件选择 |
| CSET | Conditional Set | 条件置位 |
| CSETM | Conditional Set Mask | 条件置位为全 1 |
| CSETMW | Conditional Set Mask, 32-bit | 32 位条件置位为全 1 |
| CSETW | Conditional Set, 32-bit | 32 位条件置位 |
| CSINC | Conditional Select Increment | 条件选择并自增 |
| CSINCW | Conditional Select Increment, 32-bit | 32 位条件选择并自增 |
| CSINV | Conditional Select Invert | 条件选择并取反 |
| CSINVW | Conditional Select Invert, 32-bit | 32 位条件选择并取反 |
| CSNEG | Conditional Select Negate | 条件选择并取负 |
| CSNEGW | Conditional Select Negate, 32-bit | 32 位条件选择并取负 |
| EOR | Exclusive OR | 异或 |
| EORW | Exclusive OR, 32-bit | 32 位异或 |
| LDP | Load Pair | 加载寄存器对 |
| LDPW | Load Pair, 32-bit | 32 位加载寄存器对 |
| LSL | Logical Shift Left | 逻辑左移 |
| LSLW | Logical Shift Left, 32-bit | 32 位逻辑左移 |
| LSR | Logical Shift Right | 逻辑右移 |
| LSRW | Logical Shift Right, 32-bit | 32 位逻辑右移 |
| MADD | Multiply-Add | 乘加 |
| MADDW | Multiply-Add, 32-bit | 32 位乘加 |
| MOVB | Move Byte | 字节移动 |
| MOVBU | Move Byte Unsigned | 无符号字节移动 |
| MOVD | Move Doubleword | 双字（64 位）移动 |
| MOVH | Move Halfword | 半字（16 位）移动 |
| MOVHU | Move Halfword Unsigned | 无符号半字移动 |
| MOVK | Move Keep | 保留其他位并写入半字 |
| MOVN | Move Not | 立即数取反写入 |
| MOVW | Move Word | 字（32 位）移动 |
| MOVWU | Move Word Unsigned | 无符号字移动 |
| MOVZ | Move Zero | 写入半字并清零其余位 |
| MSUB | Multiply-Subtract | 乘减 |
| MSUBW | Multiply-Subtract, 32-bit | 32 位乘减 |
| MUL | Multiply | 乘 |
| MULW | Multiply, 32-bit | 32 位乘 |
| MVN | Move Not | 按位取反 |
| MVNW | Move Not, 32-bit | 32 位按位取反 |
| NEG | Negate | 取负 |
| NEGSW | Negate and Set flags, 32-bit | 32 位取负并设置标志 |
| NEGW | Negate, 32-bit | 32 位取负 |
| ORR | Bitwise OR | 按位或 |
| ORRW | Bitwise OR, 32-bit | 32 位按位或 |
| RET | Return | 返回 |
| ROR | Rotate Right | 循环右移 |
| RORW | Rotate Right, 32-bit | 32 位循环右移 |
| SDIV | Signed Divide | 有符号除 |
| SDIVW | Signed Divide, 32-bit | 32 位有符号除 |
| STP | Store Pair | 存储寄存器对 |
| STPW | Store Pair, 32-bit | 32 位存储寄存器对 |
| SUB | Subtract | 减 |
| SUBS | Subtract and Set flags | 减法并设置标志 |
| SUBSW | Subtract and Set flags, 32-bit | 32 位减法并设置标志 |
| SUBW | Subtract, 32-bit | 32 位减法 |
| SVC | Supervisor Call | 管理员调用（系统调用指令） |
| TBZ | Test Bit and Branch if Zero | 测试位为零则分支 |
| TBNZ | Test Bit and Branch if Non-Zero | 测试位非零则分支 |
| TST | Test | 按位测试 |
| TSTW | Test, 32-bit | 32 位按位测试 |
| UDIV | Unsigned Divide | 无符号除 |
| UDIVW | Unsigned Divide, 32-bit | 32 位无符号除 |

### 16.4 系统调用、终端与工具

| 缩写 | 英文全称 | 说明 |
|---|---|---|
| ANSI | American National Standards Institute | 终端转义序列标准来源 |
| CALL | Call | 调用寄存器地址（Go 语法） |
| CSI | Control Sequence Introducer | 控制序列引导符 |
| CUP | Cursor Position | 光标定位 |
| errno | Error Number | 错误号 |
| fd | File Descriptor | 文件描述符 |
| JMP | Jump | 跳转到寄存器地址（Go 语法） |
| libSystem | System Library | macOS 系统库 |
| OPOST | Output Post-processing | 终端输出后处理 |
| SGR | Select Graphic Rendition | 选择图形属性 |
| SYSCALL | System Call instruction | amd64 系统调用指令 |
| TIOCGWINSZ | Terminal I/O Control Get WINdow SiZe | 获取终端窗口大小 |
| usleep | Microsecond Sleep | 微秒级睡眠 |
| ws_row | Window Size Row | 终端行数 |
| ws_col | Window Size Column | 终端列数 |

### 16.5 工具

| 缩写 | 英文全称 | 说明 |
|---|---|---|
| asmfmt | Assembly Formatter | 汇编格式化工具 |
| dlv | Delve | Go 调试器 |
| gofmt | Go Formatter | Go 格式化工具 |
| nm | Name List | 符号表查看工具 |
| objdump | Object Dump | 目标文件反汇编工具 |

## 17. 维护说明

本页由工作区扩展 `Go Assembly: Open Handbook` 从 `.vscode/extensions/go-asm-tools/handbook/ASM-HANDBOOK.md` 渲染。修改后重新执行该命令即可刷新；新增标题会自动进入左侧目录。手册中的项目链接（`docs/1.2-ROADMAP.md`、`docs/3.2-REFERENCES.md` 等）按工作区根目录解析。

架构相关内容应标注 [通用]、[arm64]、[darwin] 或 [amd64]；新增缩写时优先在对应表格中补“英文展开”列，并在第 16 章登记。

指令 hover 文档与 fallback 补全列表集中在同目录的 `instruction-data.js`。修改静态表或本手册第 8 章后，运行：

```bash
node .vscode/extensions/go-asm-tools/scripts/check-mnemonics.js
```

脚本会对照本机 Go 的 `anames.go` 检查 hover 文档、fallback 和本手册第 8 章的助记符，并确认项目 `.s` 中出现的助记符都有 hover 说明。
