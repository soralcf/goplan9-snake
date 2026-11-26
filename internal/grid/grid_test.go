package grid

import (
	"math"
	"math/rand/v2"
	"testing"
)

// refCellIndex 是测试专用参考实现（test oracle），不进入产品路径。
// 直接按数学定义写 y*w + x，不要从汇编指令逐句翻译。
func refCellIndex(x, y, w int32) int32 {
	return y*w + x
}

// TestCellIndex 钉住一维索引公式 y*w + x 的参数顺序（x 列、y 行、w 宽）与 32 位补码回绕语义。
//
// 若把 x 与 y 对调（算成 x*w + y）或把 w 与 y 对调（算成 w + x*y），
// 非对称坐标用例会立即失败。
func TestCellIndex(t *testing.T) {
	tests := []struct {
		name    string
		x, y, w int32
		want    int32
	}{
		// 常规：原点、首行、首列与内部格，检验 x/y/w 参数位置没有写反。
		{"origin", 0, 0, 10, 0},
		{"first row", 5, 0, 10, 5},
		{"first column", 0, 3, 10, 30},
		{"interior cell", 1, 2, 3, 7},
		{"typical board end", 39, 19, 40, 799},

		// 符号：负坐标参与 32 位有符号乘加。
		{"negative x offset", -1, 2, 10, 19},
		{"negative y row", 3, -2, 10, -17},

		// 精确边界：结果恰好到达 MaxInt32。
		{"max int32 exact", math.MaxInt32 - 10, 1, 10, math.MaxInt32},

		// 契约角落：超出 int32 上界时按 32 位二补码回绕。
		{"max int32 plus one wraps to min", math.MaxInt32, 1, 1, math.MinInt32},
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
