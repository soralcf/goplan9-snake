// Package rng 提供无状态的 xorshift64 伪随机数步进函数（M1-05）。
//
// 实现在 rng_arm64.s，契约冻结在 docs/2.2-CONTRACTS.md §4.1。
package rng

// Xorshift64 输入当前状态 state，按移位三元组 (<<13, >>7, <<17) 计算并返回下一个状态（ABI0: $0-16）。
// 状态 0 是唯一吸收态（恒返回 0），调用方应保证初始种子非零。
func Xorshift64(state uint64) uint64
