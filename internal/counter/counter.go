// Package counter 提供基于包级 NOPTR BSS 的全局计数器练习（M1-07）。
//
// 实现在 counter_arm64.s，契约冻结在 docs/2.2-CONTRACTS.md §4.1。
package counter

// counterBytes 是包级 BSS 符号 ·value 的字节大小（导出到 go_asm.h 为 const_counterBytes）。
const counterBytes = 8

// Inc 先把包级 BSS 计数器 ·value 加一，再返回加一后的新值（ABI0: $0-8）。
// 包级共享状态不支持并发，测试应在每个用例前调用 Reset 且不使用 t.Parallel()。
func Inc() int64

// Reset 把包级 BSS 计数器 ·value 清零（ABI0: $0-0）。
func Reset()
