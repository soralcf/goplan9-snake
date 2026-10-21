package grid

import (
	"math"
	"math/rand/v2"
	"testing"
)

// refCellIndex 是测试专用参考实现（oracle），不进入产品路径。
// test oracle（测试预言 / 测试基准 / 预期值来源）。指的是“用来判定被测代码行为是否正确”的权威参考
// 直接按定义写 y*w+x，不要从汇编逐句翻译。
func refCellIndex(x, y, w int32) int32 {
	return y*w + x
}

func TestCellIndex(t *testing.T) {
	tests := []struct {
		name    string
		x, y, w int32
		want    int32
	}{
		{"normal", 1, 2, 3, 7},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CellIndex(tt.x, tt.y, tt.w); got != tt.want {
				t.Errorf("CellIndex(%d, %d, %d) = %d, want %d", tt.x, tt.y, tt.w, got, tt.want)
			}
		})
	}
}

// TestCellIndexRandom 用固定种子的 100k 组分层随机输入，把汇编实现与 Go 参考实现对拍。
//
// 分层的目的：
//   - 大多数输入落在真实棋盘域，覆盖实际使用方式；
//   - 一部分取满 int32 范围，覆盖负数、符号扩展和 32 位溢出；
//   - 固定注入边界值，避免依赖随机恰好抽中极值。
func TestCellIndexRandom(t *testing.T) {
	const (
		cases = 100_000
		seed  = 0x5eed
	)

	r := rand.New(rand.NewPCG(seed, seed))
	for i := range cases {
		x, y, w := genCellIndexInput(r, i)
		got := CellIndex(x, y, w)
		want := refCellIndex(x, y, w)
		if got != want {
			t.Fatalf("seed=%#x i=%d CellIndex(%d, %d, %d) = %d, want %d",
				seed, i, x, y, w, got, want)
		}
	}
}

// genCellIndexInput 按 i%10 分层生成输入。
func genCellIndexInput(r *rand.Rand, i int) (x, y, w int32) {
	switch i % 10 {
	case 8:
		// 满 int32 范围：用 Uint32 覆盖负半轴（Rand.Int32 只返回非负数）。
		x = int32(r.Uint32())
		y = int32(r.Uint32())
		w = int32(r.Uint32())
	case 9:
		// 固定边界值轮换：0、1、-1、最大值、最小值会依次出现在 x/y/w 上。
		edges := [...]int32{0, 1, -1, math.MaxInt32, math.MinInt32}
		k := i / 10
		x = edges[k%len(edges)]
		y = edges[(k+1)%len(edges)]
		w = edges[(k+2)%len(edges)]
	default:
		// 合法棋盘域：w、h >= 1，且 x < w、y < h。
		w = int32(1 + r.IntN(1000))
		h := int32(1 + r.IntN(1000))
		x = int32(r.IntN(int(w)))
		y = int32(r.IntN(int(h)))
	}
	return x, y, w
}
