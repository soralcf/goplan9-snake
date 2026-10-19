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
