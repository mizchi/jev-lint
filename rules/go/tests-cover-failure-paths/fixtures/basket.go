package basket

import (
	"errors"
	"fmt"
	"sort"
)

var (
	ErrEmptySKU    = errors.New("cart: empty sku")
	ErrBadQuantity = errors.New("cart: quantity must be positive")
	ErrNotFound    = errors.New("cart: line not found")
	ErrBadDiscount = errors.New("cart: discount must be between 0 and 100")
	ErrCheckedOut  = errors.New("cart: already checked out")
)

type Line struct {
	SKU   string
	Price int64
	Qty   int
}

type Cart struct {
	lines      map[string]*Line
	discount   int
	checkedOut bool
}

func New() *Cart {
	return &Cart{lines: map[string]*Line{}}
}

func (c *Cart) AddItem(sku string, price int64, qty int) error {
	if sku == "" {
		return ErrEmptySKU
	}
	if qty <= 0 {
		return ErrBadQuantity
	}
	if c.checkedOut {
		return ErrCheckedOut
	}
	if l, ok := c.lines[sku]; ok {
		l.Qty += qty
		return nil
	}
	c.lines[sku] = &Line{SKU: sku, Price: price, Qty: qty}
	return nil
}

func (c *Cart) RemoveItem(sku string) error {
	if _, ok := c.lines[sku]; !ok {
		return ErrNotFound
	}
	delete(c.lines, sku)
	return nil
}

func (c *Cart) Line(sku string) (Line, bool) {
	l, ok := c.lines[sku]
	if !ok {
		return Line{}, false
	}
	return *l, true
}

func (c *Cart) Lines() []Line {
	out := make([]Line, 0, len(c.lines))
	for _, l := range c.lines {
		out = append(out, *l)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SKU < out[j].SKU })
	return out
}

func (c *Cart) Total() int64 {
	var total int64
	for _, l := range c.lines {
		total += l.Price * int64(l.Qty)
	}
	return total - total*int64(c.discount)/100
}

func (c *Cart) ApplyDiscount(percent int) error {
	if percent < 0 || percent > 100 {
		return ErrBadDiscount
	}
	c.discount = percent
	return nil
}

func (c *Cart) Checkout() (Receipt, error) {
	if len(c.lines) == 0 {
		return Receipt{}, errors.New("cart: nothing to check out")
	}
	if c.checkedOut {
		return Receipt{}, ErrCheckedOut
	}
	c.checkedOut = true
	return Receipt{Lines: c.Lines(), Total: c.Total()}, nil
}

type Receipt struct {
	Lines []Line
	Total int64
}

func (r Receipt) String() string {
	return fmt.Sprintf("%d line(s), total %d", len(r.Lines), r.Total)
}

func ParseQuantity(s string) (int, error) {
	var n int
	if _, err := fmt.Sscanf(s, "%d", &n); err != nil {
		return 0, fmt.Errorf("cart: %q is not a quantity: %w", s, err)
	}
	if n <= 0 {
		return 0, ErrBadQuantity
	}
	return n, nil
}

func Merge(a, b *Cart) *Cart {
	out := New()
	for _, l := range a.Lines() {
		_ = out.AddItem(l.SKU, l.Price, l.Qty)
	}
	for _, l := range b.Lines() {
		_ = out.AddItem(l.SKU, l.Price, l.Qty)
	}
	return out
}

func MustQuantity(s string) int {
	n, err := ParseQuantity(s)
	if err != nil {
		panic(err)
	}
	return n
}
