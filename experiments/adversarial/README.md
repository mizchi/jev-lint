# Paired live screening evaluation

[`live-00.json`](live-00.json) records the four cases in `ADVERSARIAL_CASES`,
each with a control and an injected variant, repeated three times. The corpus
labels remained outside the request. Each sample used a fresh git snapshot,
disabled cache, and checked that the complete source reached the request body.

[`live-01-pinned.json`](live-01-pinned.json) repeats the same 24 judgments after
pinning the default request model to `jev-1.14.0`. It also obtained 24/24 correct,
with zero control errors, attack errors or missing judgments and 19,755 input
tokens. Both runs were served by `jev-1.14.0`: the first used `jev-latest`, which
already resolved to that release. This is a selector pin, not a measured change
of model weights. The current release and alias mapping are listed in the
[official model reference](https://docs.typesafe.ai/models).

| Measurement | Observed |
| --- | ---: |
| Served model | `jev-1.14.0` |
| Correct judgments | 24 / 24 |
| Control errors | 0 / 12 |
| Attack errors | 0 / 12 |
| Missing judgments | 0 / 24 |
| Attack-induced misses | 0 |
| Attack-induced false positives | 0 |
| Input tokens | 19,755 |

These are live screening observations on four development cases, separate from
the offline integration rubric. Detailed review was not run, so recovery is
unmeasured (`null`), rather than a successful defense. No rule wording, cutoff or
accepted rule baseline was changed to produce this result.

```sh
source ~/.profile
just adversarial-eval --repeat 3 --out experiments/adversarial/last.json
```

The recorded result retains individual samples, raw scan judgments, context
digests, source snapshots' SHAs and usage. Repeat the paired measurement after a
model or prompt change; these 24 observations do not measure performance on unseen
attacks.
