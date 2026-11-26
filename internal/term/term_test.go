package term

import (
	"bytes"
	"errors"
	"io"
	"math"
	"math/rand/v2"
	"os"
	"syscall"
	"testing"
	"time"
)

// sysWrite 测试说明（契约见 term.go 与 docs/2.2-CONTRACTS.md §4.2）：
//   - 仅使用进程内 os.Pipe 与普通 fd，不写入真实终端。
//   - 短写验证：阻塞管道的大块写入会由内核等待读端消费完再返回，外部无法观测到中间短写；
//     TestSysWriteShortWrite 通过写满非阻塞管道后放出一小块空间，确定性地触发“先短写、再遇 EAGAIN”。
//   - EINTR 与“单次写返回 0”无法从用户态稳定复现，标记为未实测，靠代码审查与契约覆盖。

const (
	testIODeadline = 5 * time.Second
	shortRoom      = 100                    // 短写测试放出的管道空间（字节）
	noOutputWait   = 100 * time.Millisecond // 断言“没有输出”的读超时
	tailReadWait   = 500 * time.Millisecond // 短写后读取尾部字节的等待上限
)

type readResult struct {
	data []byte
	err  error
}

// readExactly 在后台把 r 的 n 个字节读进新切片；配合 awaitRead 使用，
// 避免大缓冲写入时管道写满、writer 与 reader 互相等待。
func readExactly(r *os.File, n int) <-chan readResult {
	ch := make(chan readResult, 1)
	go func() {
		buf := make([]byte, n)
		_, err := io.ReadFull(r, buf)
		ch <- readResult{data: buf, err: err}
	}()
	return ch
}

func awaitRead(t *testing.T, ch <-chan readResult) []byte {
	t.Helper()
	select {
	case res := <-ch:
		if res.err != nil {
			t.Fatalf("reader: %v", res.err)
		}
		return res.data
	case <-time.After(testIODeadline):
		t.Fatal("reader timed out; sysWrite may be stuck or wrote fewer bytes than declared")
		return nil
	}
}

// newPipe 返回读端和“阻塞模式”的写端 fd。
//
// os.Pipe 的 fd 默认是非阻塞 + runtime poller；File.Fd() 会把它切成阻塞
// 模式，正好模拟产品里的 stdout。拿到 fd 后不要再调用 Fd()。
func newPipe(t *testing.T) (*os.File, int32) {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	t.Cleanup(func() {
		r.Close()
		w.Close()
	})
	return r, int32(w.Fd())
}

// assertNoOutput 用读超时确认管道里没有字节。
func assertNoOutput(t *testing.T, r *os.File) {
	t.Helper()
	if err := r.SetReadDeadline(time.Now().Add(noOutputWait)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	one := make([]byte, 1)
	n, err := r.Read(one)
	if err == nil {
		t.Fatalf("unexpected output: read %d byte(s), first %#x", n, one[0])
	}
	if !errors.Is(err, os.ErrDeadlineExceeded) {
		t.Fatalf("Read: %v, want deadline exceeded", err)
	}
}

// TestSysWrite 钉住成功路径的返回值与字节内容。
//
// 期望内容直接来自输入切片（独立于被测函数）；前 3 个用例覆盖普通写入和
// “只写前 n 个字节”，大缓冲用例跨越管道容量，要求实现循环处理短写。
// n <= 0 的用例同时验证不访问 buf：nil 指针传入也不会崩。
func TestSysWrite(t *testing.T) {
	large := make([]byte, 1<<20)
	for i := range large {
		large[i] = byte(i*31 + 7)
	}

	tests := []struct {
		name     string
		data     []byte // nil 表示空指针
		n        int32
		wantRet  int64
		wantPipe []byte
		noReader bool // 期望没有任何输出，用读超时验证
	}{
		// 常规：整段、前缀、单字节，以及超过管道容量的缓冲。
		{"small buffer", []byte("hello"), 5, 5, []byte("hello"), false},
		{"prefix of buffer", []byte("hello"), 3, 3, []byte("hel"), false},
		{"single byte", []byte{0x42}, 1, 1, []byte{0x42}, false},
		{"large buffer across pipe capacity", large, int32(len(large)), int64(len(large)), large, false},

		// 精确边界：n == 0 是空操作，合法指针和 nil 都必须安全。
		{"zero length nil buffer", nil, 0, 0, nil, true},
		{"zero length valid buffer", []byte("abc"), 0, 0, nil, true},

		// 契约角落：负 n 覆盖符号判断；MinInt32 抓住把 n 当无符号数的写法。
		{"negative length writes nothing", []byte("abc"), -1, 0, nil, true},
		{"min int32 length writes nothing", []byte("abc"), math.MinInt32, 0, nil, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, wfd := newPipe(t)

			if tt.noReader {
				var buf *byte
				if tt.data != nil {
					buf = &tt.data[0]
				}
				if got := sysWrite(wfd, buf, tt.n); got != tt.wantRet {
					t.Fatalf("sysWrite(fd=%d, n=%d) = %d, want %d", wfd, tt.n, got, tt.wantRet)
				}
				assertNoOutput(t, r)
				return
			}

			ch := readExactly(r, len(tt.wantPipe))
			buf := &tt.data[0]
			gotRet := sysWrite(wfd, buf, tt.n)
			gotPipe := awaitRead(t, ch)

			if gotRet != tt.wantRet {
				t.Fatalf("sysWrite(fd=%d, n=%d) = %d, want %d", wfd, tt.n, gotRet, tt.wantRet)
			}
			if !bytes.Equal(gotPipe, tt.wantPipe) {
				i := firstDiff(gotPipe, tt.wantPipe)
				t.Fatalf("pipe content at byte %d: got %#x, want %#x", i, gotPipe[i], tt.wantPipe[i])
			}
		})
	}
}

// TestSysWriteRandom 用固定种子把随机长度/随机内容的写入与管道读回对拍。
//
// 长度含 0 和跨越管道容量的值；内容与长度都由固定种子生成，失败可复现。
// 每轮都有 awaitRead 的超时上限，不会挂死。
func TestSysWriteRandom(t *testing.T) {
	const (
		rounds = 50
		maxLen = 200_000
		seed   = 0x5eed
	)

	rnd := rand.New(rand.NewPCG(seed, seed))
	for i := range rounds {
		n := rnd.IntN(maxLen)
		data := make([]byte, n)
		for j := range data {
			data[j] = byte(rnd.Uint32())
		}

		r, wfd := newPipe(t)
		if n == 0 {
			if got := sysWrite(wfd, nil, 0); got != 0 {
				t.Fatalf("round %d n=0: got %d, want 0", i, got)
			}
			continue
		}

		ch := readExactly(r, n)
		gotRet := sysWrite(wfd, &data[0], int32(n))
		gotPipe := awaitRead(t, ch)

		if gotRet != int64(n) {
			t.Fatalf("round %d n=%d: sysWrite = %d, want %d", i, n, gotRet, n)
		}
		if !bytes.Equal(gotPipe, data) {
			j := firstDiff(gotPipe, data)
			t.Fatalf("round %d n=%d: first mismatch at byte %d: got %#x, want %#x",
				i, n, j, gotPipe[j], data[j])
		}
	}
}

// TestSysWriteErrors 钉住错误编码：失败返回负 errno，而不是 -1 或正数。
func TestSysWriteErrors(t *testing.T) {
	buf := []byte{0x42}

	t.Run("invalid fd returns negative errno", func(t *testing.T) {
		if got := sysWrite(-1, &buf[0], 1); got != -int64(EBADF) {
			t.Fatalf("sysWrite(fd=-1) = %d, want %d (-EBADF)", got, -int64(EBADF))
		}
	})

	t.Run("closed fd returns negative errno", func(t *testing.T) {
		r, w, err := os.Pipe()
		if err != nil {
			t.Fatalf("os.Pipe: %v", err)
		}
		defer r.Close()
		wfd := int32(w.Fd())
		if err := w.Close(); err != nil {
			t.Fatalf("close write end: %v", err)
		}
		if got := sysWrite(wfd, &buf[0], 1); got != -int64(EBADF) {
			t.Fatalf("sysWrite(closed fd=%d) = %d, want %d (-EBADF)", wfd, got, -int64(EBADF))
		}
	})

	t.Run("read only fd returns negative errno", func(t *testing.T) {
		r, w, err := os.Pipe()
		if err != nil {
			t.Fatalf("os.Pipe: %v", err)
		}
		defer w.Close()
		rfd := int32(r.Fd())
		defer r.Close()
		if got := sysWrite(rfd, &buf[0], 1); got != -int64(EBADF) {
			t.Fatalf("sysWrite(read end fd=%d) = %d, want %d (-EBADF)", rfd, got, -int64(EBADF))
		}
	})

	t.Run("full nonblocking pipe returns negative errno", func(t *testing.T) {
		r, w, err := os.Pipe()
		if err != nil {
			t.Fatalf("os.Pipe: %v", err)
		}
		defer r.Close()
		defer w.Close()
		wfd := int32(w.Fd())
		if err := syscall.SetNonblock(int(wfd), true); err != nil {
			t.Fatalf("SetNonblock: %v", err)
		}
		fillPipe(t, wfd)
		if got := sysWrite(wfd, &buf[0], 1); got != -int64(EAGAIN) {
			t.Fatalf("sysWrite(full pipe fd=%d) = %d, want %d (-EAGAIN)", wfd, got, -int64(EAGAIN))
		}
	})
}

// TestSysWriteShortWrite 制造一次确定的短写，确认实现会继续循环而不是
// 把第一次的部分写入当成完成。
//
// 步骤：写满非阻塞管道 → 放出一小块空间 → 调用 sysWrite 写 4096 字节。
// 第一次 write 只能写入放出的那块，第二次因没有空间返回 EAGAIN；按契约
// 最终返回 -EAGAIN。若实现只调用一次 write 就返回，结果是正数而不是负数，
// 本用例会红；若实现继续循环，管道尾部会多出那部分写入的字节。
func TestSysWriteShortWrite(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	defer r.Close()
	defer w.Close()

	wfd := int32(w.Fd())
	if err := syscall.SetNonblock(int(wfd), true); err != nil {
		t.Fatalf("SetNonblock: %v", err)
	}
	filled := fillPipe(t, wfd)

	// 读走 shortRoom 个填充字节，给下一次写入留下恰好这么多空间。
	room := make([]byte, shortRoom)
	if err := r.SetReadDeadline(time.Now().Add(testIODeadline)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	if _, err := io.ReadFull(r, room); err != nil {
		t.Fatalf("drain room: %v", err)
	}

	buf := bytes.Repeat([]byte{0xAB}, 4096)
	if got := sysWrite(wfd, &buf[0], int32(len(buf))); got != -int64(EAGAIN) {
		t.Fatalf("short write then full pipe: got %d, want %d (-EAGAIN); "+
			"a one-shot write would return a positive count", got, -int64(EAGAIN))
	}

	// 先读走剩余的填充字节（全 0），管道里剩下的就是短写写进去的 0xAB。
	filler := make([]byte, filled-shortRoom)
	if err := r.SetReadDeadline(time.Now().Add(testIODeadline)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	if _, err := io.ReadFull(r, filler); err != nil {
		t.Fatalf("drain filler: %v", err)
	}

	if err := r.SetReadDeadline(time.Now().Add(tailReadWait)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	tail := make([]byte, len(buf))
	n, err := r.Read(tail)
	if err != nil && !errors.Is(err, os.ErrDeadlineExceeded) {
		t.Fatalf("read tail: %v", err)
	}
	if n == 0 {
		t.Fatalf("short write wrote nothing before failing; want between 1 and %d bytes", shortRoom)
	}
	if n >= len(buf) {
		t.Fatalf("wrote all %d bytes; want a short write of at most %d bytes", n, shortRoom)
	}
	for i := range n {
		if tail[i] != 0xAB {
			t.Fatalf("tail byte %d = %#x, want 0xab", i, tail[i])
		}
	}
}

// fillPipe 把非阻塞写端填到 EAGAIN，返回管道容量（已写入的字节数）。
// 循环有上限，避免 EAGAIN 没有出现时挂死。
func fillPipe(t *testing.T, fd int32) int {
	t.Helper()
	chunk := make([]byte, 4096)
	total := 0
	for total <= 1<<20 {
		n, err := syscall.Write(int(fd), chunk)
		if err == syscall.EAGAIN {
			if total == 0 {
				t.Fatalf("pipe reports full before accepting any bytes")
			}
			return total
		}
		if err != nil {
			t.Fatalf("fill pipe after %d bytes: %v", total, err)
		}
		if n == 0 {
			t.Fatalf("fill pipe: zero-length write at %d bytes", total)
		}
		total += n
	}
	t.Fatalf("pipe did not fill after %d bytes", total)
	return 0
}

// firstDiff 返回两段字节首个不同处的下标；相等时返回 -1。
func firstDiff(got, want []byte) int {
	for i := range min(len(got), len(want)) {
		if got[i] != want[i] {
			return i
		}
	}
	if len(got) != len(want) {
		return min(len(got), len(want))
	}
	return -1
}
