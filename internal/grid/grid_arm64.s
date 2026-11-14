#include "textflag.h"

// x+0(FP) y+4(FP) w+8(FP) ret+16(FP)
TEXT ·CellIndex(SB), NOSPLIT, $0-20
	MOVW x+0(FP), R0
	MOVW y+4(FP), R1
	MOVW w+8(FP), R2
	MULW R1, R2
	ADDW R0, R2
	MOVW R2, ret+16(FP)
	RET

// [优化建议]
// - MULW + ADDW 可以合并成一条 MADDW：Rd = Ra + Rn*Rm。
// - 注意 Go 汇编的 MADD 操作数顺序是 Rm, Ra, Rn, Rd（见 Go 源码
//   cmd/internal/obj/arm64/asm7.go 的 case 15 注释），不是 ARM 手册里的
//   Rd, Rn, Rm, Ra，也不是直觉的 Rn, Rm, Ra, Rd。
//   对 x + y*w，按编码顺序的正确写法是：
//       MADDW R2, R0, R1, R2   // Rm=w, Ra=x, Rn=y, Rd=R2
//   我在临时包用 MADD(1,2,3)=7、MADD(5,7,11)=82 验证过这条顺序。
//   我最初按 MADDW R1, R2, R0, R2 写，实际算成了 w + x*y（测试失败）。
// - 收益：少一条指令、少一次依赖；风险：操作数顺序写错时结果完全错误，
//   改完必须用 TestCellIndexRandom 做 100k 组对拍确认。
// - 当前 MULW/ADDW 按 32 位取模；换成 MADDW 后仍是 32 位取模，契约不变。
