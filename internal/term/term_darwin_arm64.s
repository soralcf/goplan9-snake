#include "textflag.h"

// fd+0(FP) buf+8(FP) n+16(FP) ret+24(FP)
TEXT ·sysWrite(SB), NOSPLIT, $0-32
	MOVW n+16(FP), R22
	CMP  $0, R22
	BLE  _ret
	MOVW fd+0(FP), R19
	MOVD buf+8(FP), R20

_loop:

_ret:

	RET
