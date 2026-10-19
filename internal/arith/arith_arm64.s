#include "textflag.h"

TEXT ·Add(SB), NOSPLIT, $0-24
	MOVD a+0(FP), R0
	MOVD b+8(FP), R1
	ADD  R0, R1
	MOVD R1, ret+16(FP)
	RET

// v+0(FP) lo+4(FP) hi+8(FP) ret+16(FP)
TEXT ·Clamp(SB), NOSPLIT, $0-20
	MOVW ZR, ret+16(FP) // 占位
	RET

// a+0(FP) b+4(FP) ret+8(FP)
TEXT ·AbsDiff(SB), NOSPLIT, $0-12
	MOVW ZR, ret+8(FP) // 占位
	RET

// n+0(FP) ret+8(FP)
TEXT ·SumTo(SB), NOSPLIT, $0-16
	MOVD ZR, ret+8(FP) // 占位
	RET
