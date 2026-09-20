package model

import "time"

type User struct {
	ID       string
	Email    string
	Name     string
	Created  time.Time
	Disabled bool
}

type Order struct {
	ID      string
	UserID  string
	Lines   []Line
	Total   int64
	Placed  time.Time
	Shipped *time.Time
}

type Line struct {
	SKU   string
	Qty   int
	Price int64
}

type Invoice struct {
	ID      string
	OrderID string
	Amount  int64
	Due     time.Time
	Paid    bool
}

func (o *Order) Recalculate() {
	o.Total = 0
	for _, l := range o.Lines {
		o.Total += int64(l.Qty) * l.Price
	}
}

func (i Invoice) Overdue(now time.Time) bool {
	return !i.Paid && now.After(i.Due)
}
