#include "textflag.h"
#include "go_asm.h"

GLOBL ·value(SB), NOPTR, $const_counterBytes

// ret+0(FP)
TEXT ·Inc(SB), NOSPLIT, $0-8
	MOVD ·value(SB), R0
	ADD  $1, R0
	MOVD R0, ·value(SB)
	MOVD R0, ret+0(FP)
	RET

// [优化建议]
// - 当前写法已是 ABI0 下的最小形态：源程序 4 条指令，objdump 展开为 6 条数据
//   指令 + RET：ADRP + MOVD 读、ADD、ADRP + MOVD 写、MOVD 写返回值。两次 ADRP
//   是 ·value(SB) 两次独立符号寻址的固定开销；汇编器用保留的临时寄存器 R27
//   暂存页基址，不是业务代码误用了 R27。ret+0(FP) 在机器码里是 8(RSP)，
//   因为 0(RSP) 是返回地址。
// - 可选写法（复用符号地址，只做一次符号寻址）：
//	MOVD $·value(SB), R1
//	MOVD (R1), R0
//	ADD  $1, R0
//	MOVD R0, (R1)
//	MOVD R0, ret+0(FP)
//	RET
//   把两次 ADRP 换成一次 ADRP + ADD，总指令数不变（含 RET 共 7 条，已在临时
//   副本用 objdump 确认），依赖链反而多一级（ADRP→ADD→load）。
//   实测（Apple M4，300ms×3，含 ABI0 调用开销）：当前约 0.740–0.742 ns/op，
//   复用地址版约 0.736–0.742 ns/op，无差异。结论：不值得改。
// - 不要为此引入 LDADD 等原子指令：契约明确包级共享状态不支持并发，测试也不
//   并行；原子操作只会变慢并扩大契约。若未来真成热点，应在调用方批量计数，
//   而不是继续压缩这几条指令。
// - 以上变体只在仓库外临时副本验证；原仓库保留当前写法。

TEXT ·Reset(SB), NOSPLIT, $0-0
	MOVD ZR, ·value(SB)
	RET

// [优化建议]
// - Reset 已是最小形态：ADRP + MOVD ZR 写入 + RET，没有循环、分支或返回值搬运
//   可省。改成先取地址（MOVD $·value(SB), R1; MOVD ZR, (R1)）会多出一条 ADD，
//   指令数从 3 条（含 RET）变成 4 条，没有收益。
// - 与 Inc 一样，不要为不存在的并发需求换成原子写；契约和测试都按非并发设计。
// - 若想让 Reset 复用返回值（例如返回清零前的旧值），需要改 Go 声明和契约，
//   那属于契约变更，不是优化。
