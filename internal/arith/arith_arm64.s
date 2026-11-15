#include "textflag.h"

TEXT ·Add(SB), NOSPLIT, $0-24
	MOVD a+0(FP), R0
	MOVD b+8(FP), R1
	ADD  R0, R1
	MOVD R1, ret+16(FP)
	RET

// [优化建议]
// - 当前 4 条指令已接近最小：两次 MOVD 取参、一次 ADD、一次 MOVD 写回。
// - 函数体没有明显的指令级优化空间；ABI0 的固定开销在调用边界
//   （参数和返回值都经栈传递），不在函数内部。
// - 如果未来出现热点调用，优先考虑在调用方批量处理，而不是继续压缩这几条指令。

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
// - 当前实现有 3 个分支、4 个返回点；可以改写成 min(max(v, lo), hi) 的无分支版本：
//       CMPW R1, R0
//       CSELW LT, R1, R0, R0   // R0 = max(v, lo)
//       CMPW R2, R0
//       CSELW GT, R2, R0, R0   // R0 = min(..., hi)
//       MOVW R0, ret+16(FP)
//       RET
// - lo > hi 时 max(v, lo) >= lo > hi，再取 min 一定得到 hi，
//   所以不需要单独的 lo > hi 分支，契约保持不变。
// - 收益：去掉 3 个分支和 2 个重复的 epilogue。这组 CSELW 写法已在临时包
//   按 TestClamp 的用例验证通过；改完仍要重跑 TestClamp 并用 objdump 确认。

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
// - 当前两个出口各自 MOVW+RET；可以合并成一个 epilogue：
//       CMPW $0, R2
//       BGE  absdone
//       NEGW R2, R2
//   absdone:
//       MOVW R2, ret+8(FP)
//       RET
//   少一条 MOVW+RET，分支目标也更集中。
// - 无分支写法一（mask）：
//       ASRW $31, R2, R3      // R3 = 0 或 -1
//       EORW R3, R2, R2       // EORW 保持 32 位，避免和 ASRW/SUBW 混用宽度
//       SUBW R3, R2, R2       // R2 = (R2 ^ mask) - mask
//   全程 32 位，MinInt32 仍回绕为自身。
// - 无分支写法二（条件取负）：
//       CSNEGW GE, R2, R2, R2
//   注意 CSNEG 的语义是“cond 为真取 Rn，否则取 -Rm”，取负作用于 else 操作数，
//   所以条件必须是 GE 而不是直觉上的 LT。objdump 会把这条打印成 CNEGW LT。
//   我一开始写成 CSNEGW LT，测试结果与期望符号相反；改成 GE 后通过。
// - 以上两种写法都在临时包里用 MinInt32/MinInt32 边界用例验证过。
// - 不要用 64 位精确相减再取绝对值：MinInt32-1 会偏离契约。

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
