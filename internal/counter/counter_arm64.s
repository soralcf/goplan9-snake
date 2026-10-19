#include "textflag.h"
#include "go_asm.h"

GLOBL ·value(SB), NOPTR, $const_counterBytes

// ret+0(FP)
TEXT ·Inc(SB), NOSPLIT, $0-8
	MOVD ZR, ret+0(FP) // 占位
	RET

TEXT ·Reset(SB), NOSPLIT, $0-0
	RET // 占位
