// Package term 封装本项目用到的 Darwin/arm64 系统调用、终端尺寸和终端序列。
//
// # Darwin arm64 系统调用约定
//
// 手写汇编直接执行 SVC，约定如下：
//
//	R16   = 系统调用号
//	R0–R5 = 参数，R0 同时是返回值
//	SVC $0x80
//	carry 清空 = 成功，R0 = 返回值
//	carry 置位 = 失败，R0 = errno
//
// 要点：
//
//   - Darwin arm64 的系统调用号是 1/4/54 这样的裸值，没有 amd64 的
//     0x2000000 偏移。核对来源：$GOROOT/src/syscall/zsysnum_darwin_arm64.go、
//     XNU bsd/kern/syscalls.master。
//   - 裸 SVC 不经过 runtime 的 entersyscall/exitsyscall。本项目只做
//     write/ioctl/exit 这类短调用；睡眠走 libc usleep（M2-03），避免裸
//     poll/select 被 Go 的异步抢占反复打断。
//   - 返回时只有 R0（个别调用还有 R1）有定义；需要跨 SVC 保存的循环状态
//     放在 R19–R25。Go ABI 把它们当 scratch，Darwin 内核在返回时恢复。
//   - 封装统一用“成功返回非负值、失败返回 -errno”的单个 int 形式，不拆成
//     (n, err) 多返回值；errno 值见下面常量。
//   - 本项目不读 stdin、也不打开/关闭文件，所以只列 exit/write/ioctl 三个
//     系统调用号，不引入 SYS_READ、SYS_OPEN、SYS_CLOSE。
//
// # 错误与 errno
//
// errno 数值来自 $GOROOT/src/syscall/zerrors_darwin_arm64.go，只列本项目
// 会用到的值。向已关闭的管道写入时，进程通常先收到 SIGPIPE 而终止，EPIPE
// 未必能作为返回值观察到；本项目不屏蔽 SIGPIPE。
package term

// Darwin arm64 系统调用号（放进 R16）。
const (
	SYS_EXIT  = 1  // exit(code)
	SYS_WRITE = 4  // write(fd, buf, n)
	SYS_IOCTL = 54 // ioctl(fd, req, arg)
)

// Darwin errno（失败时 R0 的值；封装函数返回 -errno）。
const (
	EINTR  = 4  // 被信号打断；sysWrite 原地重试
	EIO    = 5  // 通用 I/O 错误；sysWrite 用它表示“写了 0 字节”
	EBADF  = 9  // fd 无效或不可写
	ENOTTY = 25 // fd 不是 tty；termSize 据此回退
	EPIPE  = 32 // 管道读端已关闭
	EAGAIN = 35 // 非阻塞 fd 暂时不可写
)

// TIOCGWINSZ 是 ioctl 请求码，不是系统调用号。参数指向 8 字节 winsize：
// 4 个 uint16，依次为 ws_row、ws_col、ws_xpixel、ws_ypixel。
const TIOCGWINSZ = 0x40087468

// termSize 失败或读到 0 时的回退尺寸。
const (
	FallbackRows = 24
	FallbackCols = 80
)

// sysWrite 把 buf 指向的 n 个字节写到 fd，处理短写和 EINTR。
//
// 契约（docs/2.2-CONTRACTS.md §4.2）：
//
//   - n <= 0 返回 0，不解引用 buf；nil + n == 0 合法。
//   - 成功返回 n。
//   - 短写时推进 buf、减少剩余，继续写，直到写完或出错。
//   - EINTR 原地重试，不推进、不减少。
//   - 其他错误返回 -errno（例如 EBADF → -9），不单独报告已写字节数。
//   - 单次写返回 0 且仍有剩余时返回 -EIO，避免死循环。
//   - nil + n > 0 未定义，测试不覆盖。
//
// 实现见 term_darwin_arm64.s。
func sysWrite(fd int32, buf *byte, n int32) int64
