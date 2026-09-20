package cache

import (
	"container/list"
	"sync"
	"time"
)

// DefaultTTL is the lifetime an entry gets when Set is called with a zero
// ttl.
const DefaultTTL = 5 * time.Minute

type entry struct {
	key     string
	value   []byte
	expires time.Time
	elem    *list.Element
}

// Cache is an LRU cache of byte slices with per-entry expiry. A zero Cache
// is not usable; use New.
type Cache struct {
	mu      sync.Mutex
	max     int
	items   map[string]*entry
	order   *list.List // front is most recently used
	now     func() time.Time
	evicted int
}

// New returns a Cache holding at most max entries. A max of zero or less
// means the cache never evicts by count.
func New(max int) *Cache {
	if max <= 0 {
		max = 1024
	}
	return &Cache{max: max, items: map[string]*entry{}, order: list.New(), now: time.Now}
}

// Get returns the value stored under key and true, or nil and false when the
// key is absent or expired. An expired entry is removed on the way out.
func (c *Cache) Get(key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.items[key]
	if !ok {
		return nil, false
	}
	if c.now().After(e.expires) {
		c.remove(e)
		return nil, false
	}
	c.order.MoveToFront(e.elem)
	return e.value, true
}

// Set stores value under key for ttl. A zero ttl uses DefaultTTL; a negative
// ttl stores nothing. Set never evicts.
func (c *Cache) Set(key string, value []byte, ttl time.Duration) {
	if ttl < 0 {
		return
	}
	if ttl == 0 {
		ttl = 10 * time.Minute
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.items[key]; ok {
		e.value = value
		e.expires = c.now().Add(ttl)
		c.order.MoveToFront(e.elem)
		return
	}
	e := &entry{key: key, value: value, expires: c.now().Add(ttl)}
	e.elem = c.order.PushFront(e)
	c.items[key] = e
	for c.order.Len() > c.max {
		c.remove(c.order.Back().Value.(*entry))
		c.evicted++
	}
}

// remove unlinks e from both structures. The caller holds c.mu.
func (c *Cache) remove(e *entry) {
	delete(c.items, e.key)
	c.order.Remove(e.elem)
}

// Delete removes key and reports whether it was present.
func (c *Cache) Delete(key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.items[key]
	if !ok {
		return false
	}
	c.remove(e)
	return true
}

// Keys returns the live keys, most recently used first.
func (c *Cache) Keys() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]string, 0, len(c.items))
	for el := c.order.Back(); el != nil; el = el.Prev() {
		e := el.Value.(*entry)
		if c.now().After(e.expires) {
			continue
		}
		out = append(out, e.key)
	}
	return out
}

// Len is the number of entries, including any that have expired but not yet
// been touched.
func (c *Cache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

// Purge drops every expired entry and returns how many it dropped.
func (c *Cache) Purge() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for key, e := range c.items {
		if c.now().After(e.expires) {
			delete(c.items, key)
			c.order.Remove(e.elem)
			n++
		}
	}
	return n
}

// Stats is a snapshot of the cache's counters.
type Stats struct {
	Entries int
	Evicted int
}

// Stats returns the counters. Cheap; it takes the lock briefly.
func (c *Cache) Stats() Stats {
	c.mu.Lock()
	defer c.mu.Unlock()
	return Stats{Entries: len(c.items), Evicted: c.evicted}
}

// Replaced the old map-of-slices implementation in v0.3; kept the name so
// callers did not have to change.
func (c *Cache) Evicted() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.evicted
}
