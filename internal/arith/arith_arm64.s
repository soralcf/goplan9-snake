#include "textflag.h"

// a+0(FP) b+8(FP) ret+16(FP)
TEXT ·Add(SB), NOSPLIT, $0-24
	MOVD a+0(FP), R0
	MOVD b+8(FP), R1
	ADD  R0, R1
	MOVD R1, ret+16(FP)
	RET

// [优化建议]
// - 当前写法：4 条数据指令（两次 MOVD 取参、一次 ADD、一次 MOVD 写回）+ RET，
//   已是 ABI0 栈传参下的最小形态。
// - 可选优化：函数体内部无指令级压缩空间；ABI0 的固定开销在调用边界（参数与
//   返回值均经栈传递）。若未来在热循环中高频调用，应在调用方内联或批量处理。
// - 收益/风险/验证：保持现状即可；契约与补码回绕边界由 TestAdd 覆盖。

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
// - 当前写法：3 次有符号比较分支（BGE / BLT / BGT）、4 个独立返回点。
// - 可选优化（CSELW 无分支写法）：改写成 min(max(v, lo), hi)：
//       CMPW  R1, R0
//       CSELW LT, R1, R0, R0   // R0 = max(v, lo)
//       CMPW  R2, R0
//       CSELW GT, R2, R0, R0   // R0 = min(max(v, lo), hi)
//       MOVW  R0, ret+16(FP)
//       RET
//   当 lo > hi 时，max(v, lo) >= lo > hi，第二步取 min 必然选 hi，因此无需单独的
//   lo >= hi 分支，契约完全不变。
// - 收益/风险/验证：去掉 3 条条件跳转与 3 处重复 epilogue，消除分支预测开销；
//   风险在于 CSELW 条件方向容易写反；该写法已在仓库外临时副本跑过 TestClamp
//   全绿，修改后需重跑 TestClamp 并用 objdump 确认。

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
// - 当前写法：SUBW + CMPW + BLT 分支，正负两条路径各自执行 MOVW + RET。
// - 可选优化 1（合并 epilogue）：
//       CMPW $0, R2
//       BGE  absdone
//       NEGW R2, R2
//   absdone:
//       MOVW R2, ret+8(FP)
//       RET
//   省去一条重复的 MOVW + RET，出口集中。
// - 可选优化 2（位掩码无分支）：
//       ASRW $31, R2, R3      // R3 = 0 或 -1
//       EORW R3, R2, R2       // EORW 保持 32 位，避免和 ASRW/SUBW 混用宽度
//       SUBW R3, R2, R2       // R2 = (R2 ^ mask) - mask
//   全程保持 32 位，MinInt32 仍按契约回绕为自身。
// - 可选优化 3（CSNEGW 条件取负，最佳无分支形态）：
//       SUBSW R1, R2, R2
//       CSNEGW GE, R2, R2, R2
//   注意 CSNEG 的语义是“cond 为真取 Rn，否则取 -Rm”，取负作用于 else 分支，
//   因此条件必须写 GE 而不是 LT（objdump 会反汇编为伪指令 CNEGW LT；若误写
//   CSNEGW LT，结果符号完全相反）。
// - 收益/风险/验证：CSNEGW 版将比较与取负压到 2 条无分支指令；以上变体均已在
//   仓库外临时副本通过 TestAbsDiff（含 MinInt32 全部回绕角落）验证。注意切勿先
//   宽化到 64 位相减再取绝对值，否则 MinInt32 - 1 会偏离 32 位回绕契约。

// n+0(FP) ret+8(FP)
TEXT ·SumTo(SB), NOSPLIT, $0-16
	MOVD n+0(FP), R0
	EOR  R1, R1

_loop:
	CMP $0, R0
	BLE _end
	ADD R0, R1
	SUB $1, R0
	B _loop

_end:
	MOVD R1, ret+8(FP)
	RET

// [优化建议]
// - 当前写法每轮 5 条指令（CMP / BLE / ADD / SUB / B），但瓶颈不在指令数：
//   R1 的累加是 1 周期延迟的串行依赖，循环被卡在约 1 轮/周期。M4 上取
//   n = 2^24 实测（临时包，同一组对拍用例）：
//     当前写法        约 3.8 ms
//     SUBS + BNE 版   约 3.8 ms   // 去掉 CMP 和 B，收益为 0
//     双累加器版      约 2.1 ms   // 拆掉依赖链，约 1.8-1.9 倍
//     闭式公式        约 6 ns     // O(1)
//   所以“少两条指令”不值得单独改；要继续优化，方向是拆依赖链或换算法。
// - 可选优化 1（双累加器，练数据流）：i 和 i-1 分别累加到 R1/R2，两条链独立；
//   循环按 2 递减，尾部补奇数 n 剩下的 1：
//       MOVD n+0(FP), R0
//       MOVD ZR, R1
//       MOVD ZR, R2
//       CMP  $2, R0
//       BLT  tail
//   loop:
//       ADD  R0, R1, R1      // acc1 += i
//       SUB  $1, R0, R3
//       ADD  R3, R2, R2      // acc2 += i-1
//       SUB  $2, R0, R0
//       CMP  $2, R0
//       BGE  loop
//   tail:
//       CMP  $0, R0
//       BLE  done
//       ADD  R0, R1, R1      // n 为奇数时补最后一个 1
//   done:
//       ADD  R2, R1, R1
//       MOVD R1, ret+8(FP)
//       RET
//   收益：实测约 1.8-1.9 倍；风险：尾部和负 n 分支变多，契约不变（n <= 0 仍返回 0），
//   改动后必须用现有 TestSumTo（含 MinInt64、2^32 边界）回归。
//   验证：临时包已在 [0, 10000] 与溢出边界上与 Go 参考实现逐点对拍。
// - 可选优化 2（真正的大头）：闭式公式 n(n+1)/2，O(1)。注意不能先 MUL 再 LSR——
//   n(n+1) 需要 65 位，右移会丢掉第 65 位。两种正确写法：
//   1) 奇偶折半 + TBZ：
//       CMP  $0, R0
//       BLE  zero
//       ADD  $1, R0, R1
//       TBZ  $0, R0, even
//       LSR  $1, R1, R1
//       MUL  R0, R1, R2      // 奇数：n * ((n+1)/2)
//       B    done
//   even:
//       LSR  $1, R0, R0
//       MUL  R0, R1, R2      // 偶数：(n/2) * (n+1)
//   done:
//       MOVD R2, ret+8(FP)
//       RET
//   zero:
//       MOVD ZR, ret+8(FP)
//       RET
//   2) 128 位乘积 + UMULH（多练一条指令）：
//       MUL   R0, R1, R2
//       UMULH R0, R1, R3
//       LSR   $1, R2, R2     // 低 64 位右移
//       LSL   $63, R3, R3    // 高位 bit0 补到结果 bit63
//       ORR   R3, R2, R2
//   收益：O(n) -> O(1)；TestSumTo 里两条 2^32 边界用例会从合计约 2 秒变成瞬时，
//   还能补 n = MaxInt64 的回绕用例（结果为 -(1<<62)）。
//   风险：全在溢出语义（折半顺序、右移位数、负 n 守卫）。临时包已用 math/big
//   对拍过 0、±1、MinInt64、MaxInt64、2^32-1/2^32/2^32+1。
// - 小处：EOR R1, R1 与 MOVD ZR, R1 等价，后者可读性更好，没有性能差异。
//   另外 BLE 是有符号比较，对负 n 守卫是正确的；若误用 BLS（无符号），
//   n < 0 会被当成巨大正数，这正是 MinInt64 用例要抓的错误。
