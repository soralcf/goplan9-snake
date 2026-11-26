// Package grid 提供棋盘二维坐标到一维扁平索引的转换函数（M1-01）。
//
// 实现在 grid_arm64.s，契约冻结在 docs/2.2-CONTRACTS.md §4.1。
package grid

// CellIndex 返回棋盘坐标 (x, y) 在宽度 w 下的一维索引 y*w + x（ABI0: $0-20）。
// x 为列号，y 为行号；按 32 位二进制补码运算。
func CellIndex(x, y, w int32) int32
