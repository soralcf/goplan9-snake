package rng

import (
	"math"
	"math/rand/v2"
	"testing"
)

// refXorshift64 是测试专用参考实现（oracle），不进入产品路径。
// 契约：Marsaglia xorshift64，移位量依次为 13、7、17，全部按 uint64 回绕。
// 直接按定义写，不要从汇编逐句翻译。
func refXorshift64(state uint64) uint64 {
	state ^= state << 13
	state ^= state >> 7
	state ^= state << 17
	return state
}

// TestXorshift64 钉住移位常量、移位方向和 64 位宽度。
//
// 期望值由参考实现独立算出并冻结：常量写成字面量，任何一侧改常量都会失败。
// 改契约（换三元组）时必须同时更新本表，这是有意的摩擦。
func TestXorshift64(t *testing.T) {
	tests := []struct {
		name  string
		state uint64
		want  uint64
	}{
		// 常规：小种子，三组移位都真实参与输出。
		{"one", 1, 0x40822041},
		{"two", 2, 0x81044082},
		{"three", 3, 0xc18660c3},
		{"deadbeef", 0xdeadbeef, 0x37c59ca7bf06be52},
		{"mixed bits", 0x0123456789abcdef, 0x3f2800d6569e01b4},

		// 精确边界：最高位或全部位被置满，32 位寄存器或算术右移都会在此暴露。
		{"high bit only", 1 << 63, 0x8100000000000000},
		{"max uint64", math.MaxUint64, 0x3f801fc0},

		// 契约角落：0 是唯一的不动点，吸收态。
		{"zero state stays zero", 0, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Xorshift64(tt.state); got != tt.want {
				t.Errorf("Xorshift64(%#x) = %#x, want %#x", tt.state, got, tt.want)
			}
		})
	}
}

// TestXorshift64Zero 单独覆盖 0 状态：一步为 0 还不够，必须永远停在 0。
//
// 这是有意的契约角落而不是 bug：xorshift 的 0 是吸收态，任何移位异或
// 都不会离开 0。产品路径（M3 的 initGame）必须保证种子非零。
func TestXorshift64Zero(t *testing.T) {
	state := uint64(0)
	for i := range 1000 {
		if state = Xorshift64(state); state != 0 {
			t.Fatalf("iteration %d: Xorshift64 from zero state produced %#x, want 0", i+1, state)
		}
	}
}

// TestXorshift64Sequence 把返回值接回输入，验证长序列与参考实现一致、
// 且非零状态永远不会跌进 0；实现若漏写某次移位，偏差会在此放大。
func TestXorshift64Sequence(t *testing.T) {
	seeds := [...]uint64{1, 0xdeadbeef, 0x0123456789abcdef, math.MaxUint64}
	const steps = 10_000

	for _, seed := range seeds {
		got, want := seed, seed
		for i := range steps {
			got = Xorshift64(got)
			want = refXorshift64(want)
			if got != want {
				t.Fatalf("seed=%#x step %d: got %#x, want %#x", seed, i+1, got, want)
			}
			if got == 0 {
				t.Fatalf("seed=%#x step %d: nonzero state fell into zero", seed, i+1)
			}
		}
	}
}

// TestXorshift64Random 用固定种子的 100k 组输入与参考实现对拍。
//
// 分层目的：
//   - 大多数输入取满 uint64 范围，覆盖高位与回绕；
//   - 一部分是单比特（稀疏位图），放大移位方向错误；
//   - 固定轮换边界值，保证 0、1、最高位、全 1 一定被覆盖到。
func TestXorshift64Random(t *testing.T) {
	const (
		cases = 100_000
		seed  = 0x5eed
	)

	r := rand.New(rand.NewPCG(seed, seed))
	for i := range cases {
		state := genXorshiftInput(r, i)
		got := Xorshift64(state)
		want := refXorshift64(state)
		if got != want {
			t.Fatalf("seed=%#x i=%d Xorshift64(%#x) = %#x, want %#x",
				seed, i, state, got, want)
		}
	}
}

// genXorshiftInput 按 i%10 分层生成输入。
func genXorshiftInput(r *rand.Rand, i int) uint64 {
	switch i % 10 {
	case 8:
		// 单比特置位：移位 13/7/17 后哪一位落到哪里都由常量决定。
		return uint64(1) << r.IntN(64)
	case 9:
		// 固定边界值轮换：0、1、全 1、最高位、低位全 1。
		edges := [...]uint64{0, 1, math.MaxUint64, 1 << 63, 1<<63 - 1}
		return edges[(i/10)%len(edges)]
	default:
		return r.Uint64()
	}
}
