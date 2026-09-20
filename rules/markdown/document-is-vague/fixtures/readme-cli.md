# logsift

Filter, group and count structured log lines from stdin. One binary, no config file.

```
cat app.log | logsift --where level=error --group route --count
```

Reads newline-delimited JSON. A line that is not JSON is kept as `{"_raw": "<line>"}` so nothing is silently dropped; `--strict` makes it a hard error instead (exit 3, line number on stderr).

## Install

```
cargo install logsift        # 1.2 MB binary, no runtime deps
brew install logsift         # macOS, arm64 and x86_64
```

Minimum supported Rust version is 1.74.

## Usage

```
logsift [--where KEY=VALUE]... [--group KEY] [--count | --sum KEY | --p KEY=50,95,99]
        [--since DUR] [--strict] [--out json|tsv|table]
```

- `--where KEY=VALUE` keeps lines where `KEY` equals `VALUE`. Repeat for AND. `KEY~REGEX` matches; `KEY!=VALUE` excludes. A dotted key (`req.path`) reaches into nested objects.
- `--group KEY` collects lines by the value of `KEY`. Missing key groups under `(none)`.
- `--count`, `--sum KEY`, `--p KEY=50,95` are the aggregations. Without one, matching lines are printed as they came in.
- `--since 15m` keeps lines whose `ts` (RFC 3339 or epoch ms) is within the window, relative to now. `--since 2024-03-01T00:00:00Z` is an absolute lower bound.
- `--out table` is the default on a TTY, `tsv` otherwise.

`logsift --help` prints this list; `logsift --version` prints the version and the commit it was built from.

## Examples

Error rate per route over the last hour:

```
logsift --since 1h --group route --count --where level=error
```

95th percentile latency per upstream, only 5xx:

```
logsift --where status~^5 --group upstream --p latency_ms=50,95,99
```

Count lines that did not parse:

```
logsift --where _raw~. --count
```

## Performance

Streams; memory is bounded by the number of groups, not the number of lines. On a 2.1 GB file with 9.4 million lines, `--group route --count` runs in 6.8 s on an M2 (single thread, 310 MB/s). `--p` keeps a t-digest per group, 100 centroids, so percentiles are approximate to about 0.5% at p99.

## Exit codes

| code | meaning |
| --- | --- |
| 0 | ran; output written |
| 1 | no line matched `--where` (only with `--fail-empty`) |
| 2 | bad argument |
| 3 | `--strict` and a line did not parse |

## Limitations

- No `OR` between `--where` clauses. Use two runs or `KEY~a|b`.
- `--since` needs a `ts` field; a line without one is excluded when `--since` is given, and a count of excluded lines goes to stderr.
- Timestamps without a zone are read as UTC.
- Nested arrays are not addressable (`items.0.id` does not work).

## License

MIT.
