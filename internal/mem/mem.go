// Package mem 提供面向字节缓冲区的汇编内存填充工具（M1-06）。
//
// 实现在 mem_arm64.s，契约冻结在 docs/2.2-CONTRACTS.md §4.1。
package mem

// FillByte 把 [buf, buf+n) 连续 n 个字节填充为 v（ABI0: $0-13）。
// 当 n <= 0 时为空操作且不解引用 buf（nil + n <= 0 合法）。
func FillByte(buf *byte, n int32, v byte)
