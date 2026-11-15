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

// TestAbsDiff 钉住 AbsDiff 的契约：结果按 32 位二补码回绕计算。
//
// 常规与符号用例验证 |a-b| 的定义；极值用例验证三个反直觉角落：
//   - MinInt32 取负仍回绕到 MinInt32，所以真实差为 2^31 时会得到负数；
//   - 双极值相减的真实差是 2^32-1，截断成 -1，取绝对值后为 1；
//   - 真实差恰好等于 MaxInt32 时仍然精确，不触发回绕。
//
// 随机对拍几乎抽不到这些角落，因此必须由固定用例覆盖。
func TestAbsDiff(t *testing.T) {
	tests := []struct {
		name string
		a, b int32
		want int32
	}{
		// 常规与符号：|a-b| 的基本定义。
		{"equal positive", 1, 1, 0},
		{"equal negative", -1, -1, 0},
		{"equal zero", 0, 0, 0},
		{"a below b", 1, 2, 1},
		{"a above b", 2, 1, 1},
		{"opposite signs", -7, 3, 10},

		// 精确边界：真实差值装得下 int32 时必须给出精确结果。
		{"max int32 exact", math.MaxInt32, 0, math.MaxInt32},
		{"min int32 minus negative one exact", math.MinInt32, -1, math.MaxInt32},

		// MinInt32 取负按 32 位回绕，结果仍是 MinInt32。
		{"min minus zero wraps to itself", math.MinInt32, 0, math.MinInt32},
		{"zero minus min wraps to itself", 0, math.MinInt32, math.MinInt32},
		{"equal min int32", math.MinInt32, math.MinInt32, 0},

		// 真实差 2^32-1 截断成 -1，取绝对值后为 1。
		{"max minus min wraps to one", math.MaxInt32, math.MinInt32, 1},
		{"min minus max wraps to one", math.MinInt32, math.MaxInt32, 1},

		// 32 位截断会翻转符号：精确差是 +2^31 / -(2^31+1) 时，结果与精确值不同。
		// 其中 min minus one 能抓住“先用 64 位精确相减、再取绝对值”的实现错误。
		{"max minus negative one wraps to min", math.MaxInt32, -1, math.MinInt32},
		{"min minus one wraps to max", math.MinInt32, 1, math.MaxInt32},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := AbsDiff(tt.a, tt.b); got != tt.want {
				t.Errorf("AbsDiff(%d, %d) = %d, want %d", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

// TestSumTo 钉住契约：n <= 0 返回 0，正 n 按 int64 回绕。
// MinInt64 用例同时保证实现没有把负 n 当成 countdown 起点（否则约 2^64 轮）。
//
// 两条溢出边界用例各需约 2^32 次累加（实测合计约 2 秒），上界固定；
// n = MaxInt64 的回绕在循环实现下跑不完，等切换成闭式公式后再补。
func TestSumTo(t *testing.T) {
	tests := []struct {
		name string
		n    int64
		want int64
	}{
		// 常规：正 n 逐轮累加。
		{"positive", 1, 1},
		{"positive multiple terms", 10, 55},
		{"positive large", 100000, 5000050000},

		// 符号：0 与负 n 都必须直接返回 0。
		{"zero", 0, 0},
		{"negative", -1, 0},
		{"negative large", -1000, 0},

		// 精确边界：MinInt64 是负向端点；2^32-1 是和仍能装进 int64 的最大 n。
		{"min int64", math.MinInt64, 0},
		{"largest n whose sum fits", 1<<32 - 1, math.MaxInt64 - math.MaxInt32},

		// 契约角落：再多一项就越界，按 int64 回绕成负数。
		{"next n wraps to negative", 1 << 32, math.MinInt64 + 1<<31},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := SumTo(tt.n); got != tt.want {
				t.Errorf("SumTo(%d) = %d, want %d", tt.n, got, tt.want)
			}
		})
	}
}

// TestSumToReference 在 [1, 10000] 上逐点与 Go 循环参考实现对拍，
// 覆盖表驱动用例抽不到的中段取值，抓循环差一或提前退出。
func TestSumToReference(t *testing.T) {
	var want int64
	for n := int64(1); n <= 10000; n++ {
		want += n
		if got := SumTo(n); got != want {
			t.Fatalf("SumTo(%d) = %d, want %d", n, got, want)
		}
	}
}
