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
