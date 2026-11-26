// Package arith 提供基础整数算术与边界工具的 Plan 9 汇编声明（M0–M1）。
//
// 所有函数均在 arith_arm64.s 中按 ABI0 实现，契约冻结在 docs/2.2-CONTRACTS.md §4.1。
package arith

// Add 返回 a + b，溢出按 64 位二进制补码回绕（ABI0: $0-24）。
func Add(a, b int64) int64

// Clamp 把 v 夹到 [lo, hi] 区间；当 lo > hi 时返回 hi（ABI0: $0-20）。
func Clamp(v, lo, hi int32) int32

// AbsDiff 返回 |a - b|，全程按 32 位二进制补码回绕计算（ABI0: $0-12）。
// 不做溢出保护：当且仅当真实差值 <= MaxInt32 时结果精确；详见 docs/4.3-TWOS-COMPLEMENT-NOTES.md。
func AbsDiff(a, b int32) int32

// SumTo 返回 1 + 2 + ... + n；n <= 0 时返回 0，正 n 溢出按 int64 补码回绕（ABI0: $0-16）。
func SumTo(n int64) int64
