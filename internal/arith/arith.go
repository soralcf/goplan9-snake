package arith

func Add(a, b int64) int64
func Clamp(v, lo, hi int32) int32 // lo>hi ret hi
// AbsDiff returns |a-b| with 32-bit two's-complement wraparound.
// No overflow protection: exact only when the true difference fits in int32.
func AbsDiff(a, b int32) int32
func SumTo(n int64) int64
