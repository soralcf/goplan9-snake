#include "textflag.h"

TEXT ·Add(SB), NOSPLIT, $0-24
	MOVD a+0(FP), R0
	MOVD b+8(FP), R1
	ADD  R0, R1
	MOVD R1, ret+16(FP)
	RET

// [优化建议]
// - 当前 4 条指令已接近最小：两次 MOVD 取参、一次 ADD、一次 MOVD 写回。
// - 函数体没有明显的指令级优化空间；ABI0 的固定开销在调用边界
//   （参数和返回值都经栈传递），不在函数内部。
// - 如果未来出现热点调用，优先考虑在调用方批量处理，而不是继续压缩这几条指令。

// v+0(FP) lo+4(FP) hi+8(FP) ret+16(FP)
TEXT ·Clamp(SB), NOSPLIT, $0-20
	MOVW v+0(FP), R0
	MOVW lo+4(FP), R1
	MOVW hi+8(FP), R2
	CMP  R2, R1
	BGE  logehi
	CMP  R1, R0
	BLT  vltlo
	CMP  R2, R0
	BGT  vgthi
	MOVW R0, ret+16(FP)
	RET

logehi:
	MOVW R2, ret+16(FP)
	RET

vltlo:
	MOVW R1, ret+16(FP)
	RET

vgthi:
	MOVW R2, ret+16(FP)
	RET

// [优化建议]
// - 当前实现有 3 个分支、4 个返回点；可以改写成 min(max(v, lo), hi) 的无分支版本：
//       CMPW R1, R0
//       CSELW LT, R1, R0, R0   // R0 = max(v, lo)
//       CMPW R2, R0
//       CSELW GT, R2, R0, R0   // R0 = min(..., hi)
//       MOVW R0, ret+16(FP)
//       RET
// - lo > hi 时 max(v, lo) >= lo > hi，再取 min 一定得到 hi，
//   所以不需要单独的 lo > hi 分支，契约保持不变。
// - 收益：去掉 3 个分支和 2 个重复的 epilogue。这组 CSELW 写法已在临时包
//   按 TestClamp 的用例验证通过；改完仍要重跑 TestClamp 并用 objdump 确认。

// a+0(FP) b+4(FP) ret+8(FP)
TEXT ·AbsDiff(SB), NOSPLIT, $0-12
	MOVW a+0(FP), R1
	MOVW b+4(FP), R2
	SUBW R1, R2
	CMPW $0, R2
	BLT  negative
	MOVW R2, ret+8(FP)
	RET

negative:
	NEGW R2, R2
	MOVW R2, ret+8(FP)
	RET

// [优化建议]
// - 当前两个出口各自 MOVW+RET；可以合并成一个 epilogue：
//       CMPW $0, R2
//       BGE  absdone
//       NEGW R2, R2
//   absdone:
//       MOVW R2, ret+8(FP)
//       RET
//   少一条 MOVW+RET，分支目标也更集中。
// - 无分支写法一（mask）：
//       ASRW $31, R2, R3      // R3 = 0 或 -1
//       EORW R3, R2, R2       // EORW 保持 32 位，避免和 ASRW/SUBW 混用宽度
//       SUBW R3, R2, R2       // R2 = (R2 ^ mask) - mask
//   全程 32 位，MinInt32 仍回绕为自身。
// - 无分支写法二（条件取负）：
//       CSNEGW GE, R2, R2, R2
//   注意 CSNEG 的语义是“cond 为真取 Rn，否则取 -Rm”，取负作用于 else 操作数，
//   所以条件必须是 GE 而不是直觉上的 LT。objdump 会把这条打印成 CNEGW LT。
//   我一开始写成 CSNEGW LT，测试结果与期望符号相反；改成 GE 后通过。
// - 以上两种写法都在临时包里用 MinInt32/MinInt32 边界用例验证过。
// - 不要用 64 位精确相减再取绝对值：MinInt32-1 会偏离契约。

// n+0(FP) ret+8(FP)
TEXT ·SumTo(SB), NOSPLIT, $0-16
	MOVD ZR, ret+8(FP) // 占位
	RET
