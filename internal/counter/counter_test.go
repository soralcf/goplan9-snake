package counter

import "testing"

// 契约（代理复述；与实现冲突时先停下来改契约，不要迁就实现）：
//
//   - Reset 把包级 BSS 计数器归零，无返回值；可重复调用。
//   - Inc 先把计数器加一，再返回加一后的值：Reset 后连续调用依次得到
//     1, 2, 3, ...。返回“加一前的旧值”（0, 1, 2, ...）是另一种可选契约；
//     当前测试按“返回新值”编写，若改成旧值需同步改 TestInc 与
//     TestIncReturnsRunningTotal 的期望。
//   - 初始值是 BSS 零值 0，但测试不依赖执行顺序：每个测试/子测试先 Reset。
//   - 计数器是包级共享状态：测试不使用 t.Parallel()。
//   - int64 溢出按二进制补码回绕（ADD 语义）；从 0 出发需要 2^63 次调用
//     才可能触发，测试不可达，因此这里只记录契约、不做断言。
//
// 由于没有 getter，Reset 的效果只能通过随后的 Inc 观察。

// incSequenceLen 是逐次对拍的长度：有上限，算法错误时测试不会挂死。
const incSequenceLen = 100_000

// TestInc 用字面量冻结“Reset 后第 N 次调用返回 N”。
//
// 计数器从 0 起只增不减，没有负数/符号分支；精确极值需要 2^63 次调用，
// 测试不可达，所以本表只有常规用例。返回旧值、没有加一、加错步长都会
// 让最后一次返回值偏离 want。
func TestInc(t *testing.T) {
	tests := []struct {
		name  string
		calls int
		want  int64
	}{
		{"single call", 1, 1},
		{"consecutive calls", 2, 2},
		{"many calls", 1000, 1000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			Reset()
			var got int64
			for i := 0; i < tt.calls; i++ {
				got = Inc()
			}
			if got != tt.want {
				t.Errorf("%d calls after Reset: Inc() = %d, want %d", tt.calls, got, tt.want)
			}
		})
	}
}

// TestIncReturnsRunningTotal 逐次断言第 i 次调用返回 i，而不只看最后一次。
//
// 期望来自调用序号本身（独立于被测函数）。它抓的是“中途归零/跳号”这类
// 只在序列中间暴露的错误；100k 次调用是固定的上界，不会挂死。
func TestIncReturnsRunningTotal(t *testing.T) {
	Reset()
	for i := 1; i <= incSequenceLen; i++ {
		got := Inc()
		if got != int64(i) {
			t.Fatalf("call %d after Reset: Inc() = %d, want %d", i, got, int64(i))
		}
	}
}

// TestReset 验证 Reset 把任意当前值归零，包括未计数和连续重置。
//
// Reset 无返回值，只能通过随后的 Inc 观察：归零后第一次调用必须返回 1。
// 若 Reset 是空操作，前面计数越多，got 偏得越远；若 Reset 写成置 1 或
// 减一，所有用例都会失败。
func TestReset(t *testing.T) {
	tests := []struct {
		name   string
		before int
		resets int
		want   int64
	}{
		// 常规：先计数，再重置一次。
		{"reset after increments", 5, 1, 1},
		{"reset after many increments", 1000, 1, 1},
		// 精确边界：从未计数时重置。
		{"reset untouched counter", 0, 1, 1},
		// 契约角落：连续重置仍保持归零。
		{"reset twice", 3, 2, 1},
		{"reset repeatedly", 7, 3, 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			Reset()
			for i := 0; i < tt.before; i++ {
				Inc()
			}
			for i := 0; i < tt.resets; i++ {
				Reset()
			}
			if got := Inc(); got != tt.want {
				t.Errorf("%d increments, %d resets, then Inc() = %d, want %d",
					tt.before, tt.resets, got, tt.want)
			}
		})
	}
}
