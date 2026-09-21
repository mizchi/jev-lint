# What a run costs

`--dry-run` prices a run over your own code without sending anything, which
is the number that matters. What follows is this repository measuring
itself, as a shape to expect rather than a promise about your code.


This repository lints itself: `.jev-lint.yaml` points the shipped packs at
`src`, `tools`, `test` and `package.json`, and excludes `test/fixtures`,
which holds planted defects. One full pass, all 23
rules, nothing cached, on a laptop over a home connection, recorded in
`docs/data/self-lint-2026-09-20.json`:

| | |
| --- | --- |
| subjects judged | 2,307 |
| requests | 79, up to 32 in flight |
| input tokens | 2,158,047 |
| output tokens | 44,236 |
| price | $0.0906 |
| wall clock | 5.1 s (54.7 s of request time, summed; 3.6–5.1 s across five runs) |
| model | `jev-1.13.0`, 2026-09-20 |
| findings | 6 |

That is 3.9 cents per 1,000 subjects. `--dry-run` on the same tree estimated
2,458,269 input tokens, 13.9% above what the server billed, so a dry run is a
bound to budget against rather than a quote. A `review` of one commit's diff
is a different order: the three commits behind the outline cap and the
sibling-deviates clause reviewed at 255,822 tokens, $0.011, in 8 s.

The wall clock is not the request time divided by the concurrency. The
server prices and limits input tokens — a bucket of about 1.6M refilling at
200–250k a second, answered with a bare 429 when it runs dry — and this run
is 2.15M, so the client paces itself against a mirror of that bucket and
sends up to 32 requests at once inside it. At the old fixed concurrency of 4
the same run took 9.6 s; past 32 the server's own latency grows with what it
is holding and the wall time stops falling.

Of the six findings, two are what the rule says they are: `computeCalls`,
named as a computation, assigns `calls` and `calledBy` onto every symbol of
the entry it is given, and `toRecord` reads the clock. The other four sit
within 0.17 of their cutoffs — a doc comment, a binding holding a path or
null, two test bindings — and are arguable. Earlier passes over the same
tree caught a test whose name promised "exactly one batch" while its body
only counted placements, a counter named `passed` holding a number, a comment
that counted "four places" above a function that tried seven, and a
`labels` that held the path to the labels; all fixed. `jev-lint replay
docs/data/self-lint-2026-09-20.json` reproduces the table with no API key.

