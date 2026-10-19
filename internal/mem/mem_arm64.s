#include "textflag.h"

// buf+0(FP) n+8(FP) v+12(FP)
TEXT ·FillByte(SB), NOSPLIT, $0-13
	RET // 占位
