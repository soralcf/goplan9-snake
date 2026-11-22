package mem

import (
	"bytes"
	"math"
	"math/rand/v2"
	"testing"
)

// wantFill 是测试专用参考实现（oracle），不进入产品路径。
// 契约：只写 buf 起的前 n 个字节；n <= 0 一个字节都不写。
// n > size 属于调用方错误（会越界），不在契约内，测试也不构造。
func wantFill(size, n int32, v byte, sentinel byte) []byte {
	want := bytes.Repeat([]byte{sentinel}, int(size))
	if n <= 0 {
		return want
	}
	for i := range int(n) {
		want[i] = v
	}
	return want
}

const fillSentinel = 0xA5

// checkFill 比较实测与期望；失败时只报首个不一致字节的位置和上下文，
// 避免 1 MiB 用例把整个缓冲区打进日志。
func checkFill(t *testing.T, label string, got, want []byte) {
	t.Helper()
	for i := range got {
		if i >= len(want) {
			t.Fatalf("%s: got longer than want at byte %d", label, i)
		}
		if got[i] != want[i] {
			lo, hi := max(0, i-2), min(len(got), i+3)
			t.Fatalf("%s: first mismatch at byte %d: got %#x, want %#x (context % x)",
				label, i, got[i], want[i], got[lo:hi])
		}
	}
	if len(got) != len(want) {
		t.Fatalf("%s: length %d, want %d", label, len(got), len(want))
	}
}

// TestFillByte 钉住填充范围：前 n 个字节变成 v，其余字节保持原值。
//
// 缓冲区先铺满 sentinel，n 之后的字节必须逐字节原样保留，
// 这样才能抓住“多写一个字节”“循环用 <=”“写入长度按 4 字节对齐”这类越界错误。
func TestFillByte(t *testing.T) {
	tests := []struct {
		name string
		size int32
		n    int32
		v    byte
	}{
		// 常规：整段、部分、单字节，覆盖 0 与 0xFF 两个极值。
		{"full buffer zero value", 8, 8, 0x00},
		{"full buffer max value", 8, 8, 0xFF},
		{"single byte", 1, 1, 0x42},
		{"prefix only", 8, 3, 0x7E},

		// 精确边界：n 恰好等于缓冲区长度，最后一个字节合法，不能多写。
		{"exact buffer length", 256, 256, 0x80},

		// 契约角落：n <= 0 是空操作，缓冲区一个字节都不变。
		{"zero n writes nothing", 8, 0, 0xFF},
		{"negative n writes nothing", 8, -1, 0xFF},
		{"min int32 writes nothing", 8, math.MinInt32, 0xFF},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			buf := bytes.Repeat([]byte{fillSentinel}, int(tt.size))
			FillByte(&buf[0], tt.n, tt.v)
			want := wantFill(tt.size, tt.n, tt.v, fillSentinel)
			checkFill(t, tt.name, buf, want)
		})
	}
}

// TestFillByteBounds 把 buf 指向大缓冲区的中间，验证写入被限制在 [buf, buf+n)：
// 前缀和后缀都必须保持 sentinel。表驱动用例只看 n 之后的区域，这里看 n 之前。
func TestFillByteBounds(t *testing.T) {
	const (
		pad  = 3
		size = 16
		n    = 5
		v    = 0x11
	)

	outer := bytes.Repeat([]byte{fillSentinel}, pad+size+pad)
	FillByte(&outer[pad], n, v)

	want := bytes.Repeat([]byte{fillSentinel}, pad+size+pad)
	for i := pad; i < pad+n; i++ {
		want[i] = v
	}
	checkFill(t, "offset buffer", outer, want)
}

// TestFillByteNilNoop 钉住“先判 n、后解引用”的顺序：n <= 0 时传入 nil
// 也不能崩溃。实现若先读 buf 再检查 n，这里会直接 segfault。
func TestFillByteNilNoop(t *testing.T) {
	for _, n := range []int32{0, -1, math.MinInt32} {
		FillByte(nil, n, 0xFF)
	}
}

// TestFillByteLarge 用 1 MiB 缓冲验证长循环不提前停、不多写：
// 整段填 0xFF 后与参考切片的每个字节比较。
func TestFillByteLarge(t *testing.T) {
	const size = 1 << 20

	buf := make([]byte, size)
	FillByte(&buf[0], size, 0xFF)
	want := bytes.Repeat([]byte{0xFF}, size)
	checkFill(t, "1 MiB buffer", buf, want)
}

// TestFillByteRandom 用固定种子生成 1000 组 size/n/v，与参考实现对拍。
// n 取 [0, size]，既覆盖整段也覆盖各种前缀长度；sentinel 检查越界写。
func TestFillByteRandom(t *testing.T) {
	const (
		cases   = 1000
		maxSize = 4096
		seed    = 0x5eed
	)

	r := rand.New(rand.NewPCG(seed, seed))
	for range cases {
		// size >= 1：下面要取 &buf[0]，空缓冲区会 panic；
		// 空缓冲区/nil 的契约由 TestFillByteNilNoop 单独覆盖。
		size := int32(1 + r.IntN(maxSize))
		n := int32(r.IntN(int(size) + 1))
		v := byte(r.Uint32())

		buf := bytes.Repeat([]byte{fillSentinel}, int(size))
		FillByte(&buf[0], n, v)

		want := wantFill(size, n, v, fillSentinel)
		checkFill(t, "random case", buf, want)
	}
}
