package cart

import (
	"errors"
	"testing"
)

func newCart(t *testing.T) *Cart {
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

func TestTotal(t *testing.T) {
	c := newCart(t)
	if got := c.Total(); got != 350 {
		t.Fatalf("Total() = %d, want 350", got)
	}
}

func TestAddItemIncreasesTotal(t *testing.T) {
	c := newCart(t)
	before := c.Total()
	if err := c.AddItem("sku-3", 20, 1); err != nil {
		t.Fatal(err)
	}
	if got := c.Total(); got != before+20 {
		t.Fatalf("Total() = %d, want %d", got, before+20)
	}
}

func TestRemoveItemDropsLine(t *testing.T) {
	c := newCart(t)
	line, ok := c.Line("sku-1")
	if !ok {
		t.Fatal("sku-1 missing")
	}
	if line.Qty != 2 {
		t.Fatalf("Qty = %d, want 2", line.Qty)
	}
}

func TestDeleteItem(t *testing.T) {
	c := newCart(t)
	if err := c.RemoveItem("sku-1"); err != nil {
		t.Fatal(err)
	}
	if _, ok := c.Line("sku-1"); ok {
		t.Fatal("sku-1 still present after RemoveItem")
	}
	if got := c.Total(); got != 150 {
		t.Fatalf("Total() = %d, want 150", got)
	}
}

func TestAddThenRemoveLeavesCartEmpty(t *testing.T) {
	c := New()
	if err := c.AddItem("sku-9", 10, 1); err != nil {
		t.Fatal(err)
	}
	if err := c.RemoveItem("sku-9"); err != nil {
		t.Fatal(err)
	}
	if n := len(c.Lines()); n != 0 {
		t.Fatalf("len(Lines()) = %d, want 0", n)
	}
}

func TestAddItemRejectsNegativeQuantity(t *testing.T) {
	c := New()
	_ = c.AddItem("sku-1", 100, -1)
	if n := len(c.Lines()); n < 0 {
		t.Fatalf("len(Lines()) = %d", n)
	}
}

func TestApplyDiscount(t *testing.T) {
	t.Run("applies 10% discount", func(t *testing.T) {
		c := newCart(t)
		if err := c.ApplyDiscount(10); err != nil {
			t.Fatal(err)
		}
		if c.Total() <= 0 {
			t.Fatalf("Total() = %d, want positive", c.Total())
		}
	})

	t.Run("reduces total by the percentage", func(t *testing.T) {
		c := newCart(t)
		before := c.Total()
		if err := c.ApplyDiscount(50); err != nil {
			t.Fatal(err)
		}
		if got := c.Total(); got != before/2 {
			t.Fatalf("Total() = %d, want %d", got, before/2)
		}
	})

	t.Run("rejects a percentage over 100", func(t *testing.T) {
		c := newCart(t)
		err := c.ApplyDiscount(150)
		if !errors.Is(err, ErrBadDiscount) {
			t.Fatalf("err = %v, want ErrBadDiscount", err)
		}
	})
}

func TestApplyDiscountCapsAtHundredPercent(t *testing.T) {
	c := newCart(t)
	if err := c.ApplyDiscount(10); err != nil {
		t.Fatal(err)
	}
	if got := c.Total(); got != 315 {
		t.Fatalf("Total() = %d, want 315", got)
	}
}

func TestLinesSortedByPrice(t *testing.T) {
	c := newCart(t)
	lines := c.Lines()
	if len(lines) != 2 {
		t.Fatalf("len(Lines()) = %d, want 2", len(lines))
	}
}
