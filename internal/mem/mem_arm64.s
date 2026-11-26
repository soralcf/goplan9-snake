#include "textflag.h"

// buf+0(FP) n+8(FP) v+12(FP)
TEXT ·FillByte(SB), NOSPLIT, $0-13
	MOVW n+8(FP), R1
	CMPW $0, R1
	BLE  _done
	MOVD buf+0(FP), R0
	MOVB v+12(FP), R2

_loop:
	MOVB R2, (R0)
	ADD  $1, R0
	SUBW $1, R1
	CMPW $0, R1
	BGT  _loop

_done:
	RET

// [优化建议]
// - 第 9 行 `MOVB v+12(FP), R2` 换成 MOVBU 语义更准确：参数 v 是 byte
//   （无符号），而 MOVB 是符号扩展（LDRSB 语义），v = 0xA0 时 R2 实际是
//   0xffffffffffffffa0。当前 `MOVB R2, (R0)` 只写低 8 位，所以输出正确，
//   但正确性依赖“高位脏了也没关系”这个隐含前提。MOVBU 做零扩展（LDRB
//   语义），R2 就是干净的 0x00..0xFF，读代码和用调试器时不用反推截断；
//   它也是下面 8 字节复制的前提。收益：语义准确，指令数与性能都不变；
//   风险：无，store 仍只取低字节；验证：TestFillByte 里 v=0xFF 的用例。
// - 当前写法每字节 5 条指令：MOVB 存储、ADD 指针、SUBW 计数、CMPW、BGT。
//   两条小改动能把循环压到 3 条，契约不变：
//   ARM64 支持后索引 store，`MOVB.P R2, 1(R0)` 存完把 R0 += 1；
//   `SUBSW` 是设置标志的 32 位减法，可以直接接 BGT，省掉 CMPW：
//	_loop:
//		MOVB.P R2, 1(R0)
//		SUBSW  $1, R1, R1
//		BGT    _loop
//   实测（Apple M4，临时包，含 ABI0 调用/出入栈开销，200ms×3 取中位数）：
//	16B 5.2 -> 5.4 ns，1KiB 246 -> 246 ns，1MiB 239 -> 240 µs。
//   逐字节 fill 已经是 store/内存带宽主导，少了 2 条指令也不变快；这个
//   改动的价值是代码更短，不是吞吐。风险低：后索引只改 R0，R0 是调用者
//   保存寄存器，返回后调用方不依赖；验证：现有 FillByte 全部测试。
// - 可选优化 2（8 字节宽存储，量级提升）：把 v 复制成 64 位字，每 8 字节一存。
//   注意复制必须用 MOVBU 零扩展，不能用 MOVB：MOVB 会把 0xA0 符号扩展为
//   0xffffffffffffffa0，移位或运算后会填出 a0 ff ff ...（TestFillByte 会立即失败）：
//	MOVBU v+12(FP), R2
//	ORR   R2<<8, R2
//	ORR   R2<<16, R2
//	ORR   R2<<32, R2      // R2 = v 重复 8 次
//	LSR   $3, R1, R3      // 完整 8 字节组数
//	CBZ   R3, _tail
// _chunk:
//	MOVD.P R2, 8(R0)
//	SUBS   $1, R3, R3
//	BNE    _chunk
// _tail:
//	ANDW   $7, R1, R1     // 剩余 0..7 字节
//	CBZ    R1, _done
// _tailLoop:
//	MOVB.P R2, 1(R0)
//	SUBSW  $1, R1, R1
//	BNE    _tailLoop
//   实测：16B 5.2 -> 1.6 ns，1KiB 246 -> 36 ns，1MiB 239 -> 30 µs（约 8 倍，
//   1MiB 从约 4.4 GB/s 提升到约 35 GB/s）。
//   风险：写入范围仍是 [buf, buf+n)：完整组覆盖 floor(n/8)*8 字节，尾循环
//   覆盖 n%8，合起来恰好 n 字节，不会多写；Darwin/arm64 允许非对齐的 8 字节
//   store，buf 不必 8 字节对齐；v == 0 时复制结果仍全 0。验证：现有
//   TestFillByte（含 n=3、n=256 这类非整齐长度）、Bounds 用例看前缀/后缀
//   sentinel，再跑 Random 对拍即可。n < 8 时直接走尾循环，多一次 CBZ。
// - 再往上可以用 16 字节 NEON store（V2 / ST1），但需要对齐与尾部处理，
//   M3 的占用数组和帧缓冲尺寸下 8 字节已经够用，先不引入。
