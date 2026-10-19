package arith

import (
	"math"
	"testing"
)

func TestAdd(t *testing.T) {
	tests := []struct {
		name string
		a, b int64
		want int64
	}{
		{"positive", 1, 2, 3},
		{"positive large", 1000, 2000, 3000},
		{"negative", -1, -2, -3},
		{"negative large", -1000, -2000, -3000},
		{"zero", 0, 0, 0},
		{"zero and positive", 0, 42, 42},
		{"max int64", math.MaxInt64, 0, math.MaxInt64},
		{"min int64", math.MinInt64, 0, math.MinInt64},
		{"min int64 plus one minus one", math.MinInt64 + 1, -1, math.MinInt64},
		{"max int64 plus one overflow", math.MaxInt64, 1, math.MinInt64},
		{"min int64 minus one overflow", math.MinInt64, -1, math.MaxInt64},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Add(tt.a, tt.b); got != tt.want {
				t.Errorf("Add(%d, %d) = %d, want %d", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

// TODO: TestClamp, TestAbsDiff, TestSumTo.
