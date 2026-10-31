package arith

import (
	"math"
	"testing"
)

func TestAdd(t *testing.T) {
	tests := []struct {
		name string
		a, b int64
		want int64
	}{
		{"positive", 1, 2, 3},
		{"positive large", 1000, 2000, 3000},
		{"negative", -1, -2, -3},
		{"negative large", -1000, -2000, -3000},
		{"zero", 0, 0, 0},
		{"zero and positive", 0, 42, 42},
		{"max int64", math.MaxInt64, 0, math.MaxInt64},
		{"min int64", math.MinInt64, 0, math.MinInt64},
		{"min int64 plus one minus one", math.MinInt64 + 1, -1, math.MinInt64},
		{"max int64 plus one overflow", math.MaxInt64, 1, math.MinInt64},
		{"min int64 minus one overflow", math.MinInt64, -1, math.MaxInt64},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Add(tt.a, tt.b); got != tt.want {
				t.Errorf("Add(%d, %d) = %d, want %d", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

// TestClamp 覆盖四条出口：lo >= hi（hi 优先）、v < lo、v > hi、区间内返回 v。
//
// 用例刻意包含负数和 int32 极值：MOVW 会把 int32 符号扩展成 64 位，
// 因此比较必须使用有符号条件码。若误用 MOVWU 或 BLO/BHI，负数和极值会立刻暴露。
func TestClamp(t *testing.T) {
	tests := []struct {
		name      string
		v, lo, hi int32
		want      int32
	}{
		{"inside", 2, 1, 3, 2},
		{"equals lo", 1, 1, 3, 1},
		{"equals hi", 3, 1, 3, 3},
		{"below lo", 0, 1, 3, 1},
		{"above hi", 4, 1, 3, 3},
		{"negative inside", -2, -5, -1, -2},
		{"negative below lo", -6, -5, -1, -5},
		{"above negative hi", 0, -5, -1, -1},
		{"negative v in positive range", -1, 0, 10, 0},
		{"min int32 inside", math.MinInt32, math.MinInt32, math.MaxInt32, math.MinInt32},
		{"min int32 below lo", math.MinInt32, math.MinInt32 + 1, math.MaxInt32, math.MinInt32 + 1},
		{"max int32 inside", math.MaxInt32, math.MinInt32, math.MaxInt32, math.MaxInt32},
		{"lo equals hi", 0, 1, 1, 1},
		{"lo equals hi, v above", 2, 1, 1, 1},
		{"lo greater than hi", 0, 3, 1, 1},
		{"lo greater than hi, v between", 2, 3, 1, 1},
		{"lo greater than hi, v above lo", 4, 3, 1, 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Clamp(tt.v, tt.lo, tt.hi); got != tt.want {
				t.Errorf("Clamp(%d, %d, %d) = %d, want %d", tt.v, tt.lo, tt.hi, got, tt.want)
			}
		})
	}
}

// TODO: TestAbsDiff, TestSumTo.
