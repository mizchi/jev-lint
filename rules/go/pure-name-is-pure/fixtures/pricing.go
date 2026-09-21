package pricing

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Line struct {
	SKU   string
	Qty   int
	Price int64
}

type Order struct {
	ID    string
	Lines []Line
	Total int64
}

var taxTable = map[string]float64{"DE": 0.19, "FR": 0.20, "US": 0.0}

func computeTotal(lines []Line) int64 {
	var total int64
	for _, l := range lines {
		total += int64(l.Qty) * l.Price
	}
	slog.Info("computed total", "lines", len(lines), "total", total)
	return total
}

func ComputeTax(country string, subtotal int64) int64 {
	rate, ok := taxTable[strings.ToUpper(country)]
	if !ok {
		rate = 0.2
	}
	return int64(float64(subtotal) * rate)
}

func CalculateShipping(weightGrams int, express bool) int64 {
	base := int64(weightGrams/500+1) * 150
	if express {
		base *= 2
	}
	if time.Now().Weekday() == time.Sunday {
		base += 500
	}
	return base
}

var keyCache = struct {
	sync.Mutex
	m map[string][]byte
}{m: map[string][]byte{}}

func deriveKey(secret, salt string) []byte {
	keyCache.Lock()
	defer keyCache.Unlock()
	if k, ok := keyCache.m[secret+salt]; ok {
		return k
	}
	sum := sha256.Sum256([]byte(secret + ":" + salt))
	keyCache.m[secret+salt] = sum[:]
	return sum[:]
}

func computeDigest(o Order) string {
	h := sha256.New()
	fmt.Fprintf(h, "%s|%d|", o.ID, o.Total)
	for _, l := range o.Lines {
		fmt.Fprintf(h, "%s:%d:%d;", l.SKU, l.Qty, l.Price)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func FormatAmount(cents int64, currency string) string {
	sign := ""
	if cents < 0 {
		sign = "-"
		cents = -cents
	}
	return fmt.Sprintf("%s%d.%02d %s", sign, cents/100, cents%100, currency)
}

func FormatReceipt(o Order, path string) (string, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "Order %s\n", o.ID)
	for _, l := range o.Lines {
		fmt.Fprintf(&b, "  %-12s x%d  %s\n", l.SKU, l.Qty, FormatAmount(int64(l.Qty)*l.Price, "EUR"))
	}
	fmt.Fprintf(&b, "Total %s\n", FormatAmount(o.Total, "EUR"))
	if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		return "", err
	}
	return b.String(), nil
}

func FormatDuration(d time.Duration) string {
	d = d.Round(time.Second)
	h := d / time.Hour
	m := (d % time.Hour) / time.Minute
	s := (d % time.Minute) / time.Second
	if h > 0 {
		return fmt.Sprintf("%dh%02dm%02ds", h, m, s)
	}
	return fmt.Sprintf("%dm%02ds", m, s)
}

func ParseLine(s string) (Line, error) {
	parts := strings.Split(s, ",")
	if len(parts) != 3 {
		return Line{}, fmt.Errorf("pricing: want sku,qty,price; got %q", s)
	}
	qty, err := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err != nil {
		return Line{}, err
	}
	price, err := strconv.ParseInt(strings.TrimSpace(parts[2]), 10, 64)
	if err != nil {
		return Line{}, err
	}
	return Line{SKU: strings.TrimSpace(parts[0]), Qty: qty, Price: price}, nil
}

type Config struct {
	Currency string
	Country  string
	Express  bool
}

func ParseConfig(raw map[string]string) Config {
	cfg := Config{Currency: raw["currency"], Country: raw["country"]}
	if cfg.Currency == "" {
		cfg.Currency = os.Getenv("PRICING_CURRENCY")
	}
	cfg.Express = raw["express"] == "true"
	return cfg
}

func ParseAddr(s string) (net.IP, int, error) {
	host, port, err := net.SplitHostPort(s)
	if err != nil {
		return nil, 0, err
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return nil, 0, errors.New("pricing: bad ip")
	}
	p, err := strconv.Atoi(port)
	return ip, p, err
}

func (o Order) ToJSON() ([]byte, error) {
	return json.Marshal(struct {
		ID    string `json:"id"`
		Total int64  `json:"total"`
		Lines []Line `json:"lines"`
	}{o.ID, o.Total, o.Lines})
}

func toRow(o *Order) []string {
	o.Total = computeTotal(o.Lines)
	return []string{o.ID, strconv.FormatInt(o.Total, 10), strconv.Itoa(len(o.Lines))}
}

func derivePlan(lines []Line) []Line {
	plan := make([]Line, len(lines))
	copy(plan, lines)
	sort.Slice(plan, func(i, j int) bool { return plan[i].Price > plan[j].Price })
	return plan
}

func computeBuckets(lines []Line) map[string][]Line {
	out := map[string][]Line{}
	for _, l := range lines {
		prefix := l.SKU
		if i := strings.IndexByte(prefix, '-'); i > 0 {
			prefix = prefix[:i]
		}
		out[prefix] = append(out[prefix], l)
	}
	return out
}

func parseEnvInt(raw string, def int) int {
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	return n
}

func FormatLocalTime(t time.Time, zone string) string {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		loc = time.UTC
	}
	return t.In(loc).Format("2006-01-02 15:04")
}

type Counter struct {
	mu    sync.Mutex
	hits  int64
	since time.Time
}

func ComputeRate(c *Counter, now time.Time) float64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	elapsed := now.Sub(c.since).Seconds()
	if elapsed <= 0 {
		return 0
	}
	return float64(c.hits) / elapsed
}

// readEnvInt and readEnvString are named for the environment but only ever
// look at the value they are handed; ParseWorkerLimits below is the only
// place either is called, and it calls them with fields off its own
// parameter.
func readEnvInt(raw string, def, min, max int) int {
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < min || n > max {
		return def
	}
	return n
}

func readEnvString(raw, def string) string {
	if raw == "" {
		return def
	}
	return raw
}

type WorkerLimits struct {
	MaxJobs    int
	Queue      string
	TimeoutSec int
}

func ParseWorkerLimits(raw map[string]string) WorkerLimits {
	return WorkerLimits{
		MaxJobs:    readEnvInt(raw["max_jobs"], 4, 1, 64),
		Queue:      readEnvString(raw["queue"], "default"),
		TimeoutSec: readEnvInt(raw["timeout_sec"], 30, 1, 3600),
	}
}

type CliOptions struct {
	BaseURL string
	Token   string
	Room    string
	JSON    bool
}

func ParseCliOptions(argv []string) CliOptions {
	baseURL := ""
	token := os.Getenv("CLUSTER_API_TOKEN")
	room := "main"
	asJSON := false
	for i := 0; i < len(argv); i++ {
		switch argv[i] {
		case "--base-url":
			i++
			if i < len(argv) {
				baseURL = argv[i]
			}
		case "--token":
			i++
			if i < len(argv) {
				token = argv[i]
			}
		case "--room":
			i++
			if i < len(argv) {
				room = argv[i]
			}
		case "--json":
			asJSON = true
		}
	}
	return CliOptions{BaseURL: baseURL, Token: token, Room: room, JSON: asJSON}
}
