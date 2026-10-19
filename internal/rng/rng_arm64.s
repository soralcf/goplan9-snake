#include "textflag.h"

// state+0(FP) ret+8(FP)
TEXT ·Xorshift64(SB), NOSPLIT, $0-16
	MOVD ZR, ret+8(FP) // 占位
	RET
