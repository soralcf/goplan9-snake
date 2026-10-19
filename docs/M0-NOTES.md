# What Me Do

## M0

### 初始化

- go mod init goplan9-sanke

### 编写代码

- main.go
- add.go
- add_test.go
- add_arm64.s

### 常用命令

```zsh
go vet ./...
go test ./... -count=1
GOARCH=arm64 go build -o snake .
go tool objdump -s 'main.Add' snake
GOARCH=arm64 go build -o snake . && go tool objdump -s 'main.Add' snake 
```

### 自测

1. `TEXT ·Add(SB), NOSPLIT, $0-24` 中每个部分的含义是什么？

TEXT定义函数类似于 func, ·ADD(SB)表示这是包级函数ADD 且·会被链接器转换成 go 中的 . , NOSPLIT 表示不开启栈分裂, $0-24中 0 是帧大小 24 是参数大小

2. 为什么汇编函数里读参数用 `0(FP)`、`8(FP)`，而不是寄存器？

FP是 go 语言汇编的虚拟寄存器, 存储栈帧指针, 参数由调用方传入, 通过 FP + 偏移地址读取参数, abi0 使用这种写法更稳定便于维护, 实际会转为 ABIINternal, 用的就是寄存器存取参数, 性能更好

3. `go vet` 对汇编函数检查了什么？

检查声明的函数函数是否存在, 以及参数大小是否计算正确

4. `main.Add.abi0` 符号和 Go 里的 `Add` 是什么关系？

这个就是 Add 的 abi0 声明吧? 我不太确定