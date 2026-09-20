package basket

import (
	"errors"
	"testing"
)

func filled(t *testing.T) *Cart {
	t.Helper()
	c := New()
	if err := c.AddItem("sku-1", 100, 2); err != nil {
		t.Fatal(err)
	}
	if err := c.AddItem("sku-2", 150, 1); err != nil {
		t.Fatal(err)
	}
	return c
}

func TestAddItem(t *testing.T) {
	t.Run("adds a line", func(t *testing.T) {
		c := filled(t)
		if got := c.Total(); got != 350 {
			t.Fatalf("Total() = %d, want 350", got)
		}
	})
	t.Run("merges quantity for an existing sku", func(t *testing.T) {
		c := filled(t)
		if err := c.AddItem("sku-1", 100, 3); err != nil {
			t.Fatal(err)
		}
		l, _ := c.Line("sku-1")
		if l.Qty != 5 {
			t.Fatalf("Qty = %d, want 5", l.Qty)
		}
	})
	t.Run("rejects an empty sku", func(t *testing.T) {
		c := New()
		if err := c.AddItem("", 100, 1); !errors.Is(err, ErrEmptySKU) {
			t.Fatalf("err = %v, want ErrEmptySKU", err)
		}
	})
	t.Run("rejects a zero quantity", func(t *testing.T) {
		c := New()
		if err := c.AddItem("sku-1", 100, 0); !errors.Is(err, ErrBadQuantity) {
			t.Fatalf("err = %v, want ErrBadQuantity", err)
		}
	})
	t.Run("rejects after checkout", func(t *testing.T) {
		c := filled(t)
		if _, err := c.Checkout(); err != nil {
			t.Fatal(err)
		}
		if err := c.AddItem("sku-3", 10, 1); !errors.Is(err, ErrCheckedOut) {
			t.Fatalf("err = %v, want ErrCheckedOut", err)
		}
	})
}

func TestRemoveItem(t *testing.T) {
	c := filled(t)
	if err := c.RemoveItem("sku-1"); err != nil {
		t.Fatal(err)
	}
	if _, ok := c.Line("sku-1"); ok {
		t.Fatal("sku-1 still present")
	}
}

func TestLine(t *testing.T) {
	c := filled(t)
	if _, ok := c.Line("nope"); ok {
		t.Fatal("Line(nope) = ok, want missing")
	}
	l, ok := c.Line("sku-2")
	if !ok || l.Price != 150 {
		t.Fatalf("Line(sku-2) = %+v, %v", l, ok)
	}
}

func TestLinesSorted(t *testing.T) {
	c := filled(t)
	lines := c.Lines()
	if lines[0].SKU != "sku-1" || lines[1].SKU != "sku-2" {
		t.Fatalf("Lines() = %+v, want sorted by sku", lines)
	}
}

func TestApplyDiscount(t *testing.T) {
	c := filled(t)
	if err := c.ApplyDiscount(50); err != nil {
		t.Fatal(err)
	}
	if got := c.Total(); got != 175 {
		t.Fatalf("Total() = %d, want 175", got)
	}
}

func TestCheckout(t *testing.T) {
	t.Run("returns a receipt", func(t *testing.T) {
		c := filled(t)
		r, err := c.Checkout()
		if err != nil {
			t.Fatal(err)
		}
		if r.Total != 350 || len(r.Lines) != 2 {
			t.Fatalf("receipt = %+v", r)
		}
	})
	t.Run("refuses a second checkout", func(t *testing.T) {
		c := filled(t)
		if _, err := c.Checkout(); err != nil {
			t.Fatal(err)
		}
		if _, err := c.Checkout(); !errors.Is(err, ErrCheckedOut) {
			t.Fatalf("err = %v, want ErrCheckedOut", err)
		}
	})
}

func TestParseQuantity(t *testing.T) {
	n, err := ParseQuantity("3")
	if err != nil || n != 3 {
		t.Fatalf("ParseQuantity(3) = %d, %v", n, err)
	}
	if _, err := ParseQuantity("abc"); err == nil {
		t.Fatal("ParseQuantity(abc) = nil error")
	}
}

func TestMerge(t *testing.T) {
	a := filled(t)
	b := New()
	_ = b.AddItem("sku-1", 100, 1)
	m := Merge(a, b)
	if l, _ := m.Line("sku-1"); l.Qty != 3 {
		t.Fatalf("merged Qty = %d, want 3", l.Qty)
	}
}

func TestMustQuantity(t *testing.T) {
	if got := MustQuantity("4"); got != 4 {
		t.Fatalf("MustQuantity(4) = %d", got)
	}
}

func TestReceiptString(t *testing.T) {
	r := Receipt{Total: 5}
	if got := r.String(); got != "0 line(s), total 5" {
		t.Fatalf("String() = %q", got)
	}
}
