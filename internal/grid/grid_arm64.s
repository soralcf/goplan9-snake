#include "textflag.h"

// x+0(FP) y+4(FP) w+8(FP) ret+16(FP)
TEXT ·Index(SB), NOSPLIT, $0-20
	MOVW ZR, ret+16(FP) // 占位
	RET
