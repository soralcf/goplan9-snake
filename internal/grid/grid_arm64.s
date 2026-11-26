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
// - 当前写法：3 次 MOVW 取参，随后 MULW R1, R2 与 ADDW R0, R2 分两步完成 y*w + x。
// - 可选优化（MADDW 乘加融合）：把 MULW + ADDW 合并成一条 MADDW（Rd = Ra + Rn*Rm）：
//       MADDW R2, R0, R1, R2   // Rm=w(R2), Ra=x(R0), Rn=y(R1), Rd=R2
//   注意 Go 汇编的 MADD 操作数顺序是 Rm, Ra, Rn, Rd（见 Go 源码
//   cmd/internal/obj/arm64/asm7.go 的 case 15 注释），既不是 ARM 手册的
//   Rd, Rn, Rm, Ra，也不是直觉的 Rn, Rm, Ra, Rd。若误写成 MADDW R1, R2, R0, R2，
//   实际会算成 w + x*y。
// - 收益/风险/验证：少一条算术指令和一级寄存器依赖，32 位取模回绕语义不变；
//   风险全在四操作数顺序，已在仓库外临时副本通过 TestCellIndex 与
//   TestCellIndexRandom（100k 组对拍）验证。
