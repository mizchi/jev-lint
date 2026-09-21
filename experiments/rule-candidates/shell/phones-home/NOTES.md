# `phones-home` (shell) -- candidate notes

A port of the `telemetry` check from
[luantak/is-malicious](https://github.com/luantak/is-malicious) onto shell, in
the shape the rest of `rules/shell/` uses: one construct at a time, `subject:
node`, `state: located`, the file in the state to say what the run's work
actually was.

This is the ninth rule of the pack and the first one that is not about a
defect. A shell script that posts a usage event is not doing anything wrong;
it is doing something its reader cannot see from the line, and often cannot
see from the README either. The finding is a fact -- *this script tells
someone that it ran* -- which is why it is `severity: info` and why the
sentence is written so that documented, anonymous, opt-out-able telemetry
answers yes just as loudly as a silent beacon does.

## Rule

The final YAML is `rule.yml` beside this file. The parts that carry it:

- `subject: node`, `state: located`, `axis: file`, `at: 0.55`, `severity: info`.
- Matcher, over-matched on purpose, three branches: every `curl`/`wget`-family
  command whatever its shape; the same tools behind a wrapper that eats the
  command name (`sudo`, `nohup`, `timeout`, `env`, ...); and every `trap`.
  The trap branch exists because `trap '... curl ...' ERR` is the one telemetry
  shape with no network tool at the head of the line -- and because a `trap`
  body is a tree-sitter-bash `raw_string` with no command node inside it, the
  `curl` in it is NOT also caught by branch one, so the line is reported once.
  22 subjects over the first 8 fixtures, 29 over all 10, one per line, no
  double matches, nothing unintended.
- `ask:` "This command reports the run itself to a collector -- that it
  happened, on what machine, how long it took, or whether it failed."
- `explain:` the source project's three labels verbatim, minus `none`:
  `usage_analytics`, `crash_or_diagnostics`, `vendor_sdk`.

## Corpus

10 scripts, 172 lines, 29 subjects: **6 reportable, 23 clean, 14 of them
hard**. No markers in the fixtures; every label and its argument is in
`expect.yml`.

Reportable:

| subject | what it is |
| --- | --- |
| `backup_nightly.sh:24` | `hc-ping.com` heartbeat with the run id and host, after the backup has finished and been cleaned up |
| `run_tests.sh:17` | suite, duration, exit status, runner hostname and branch POSTed to an internal insights endpoint |
| `install_agent.sh:9` | `trap ... ERR` posting `$LINENO`, `uname -sr` and the version to an install-errors collector |
| `provision_host.sh:17` | a Segment `/v1/track` event with a machine id, provider, CLI version and `uname` -- documented in the file header, anonymous, and opt-out-able by env var |
| `cron_wrapper.sh:19` | `wget` whose whole point is the query string: job, `rc`, elapsed seconds, host |
| `etl_nightly.sh:10` | `trap ... ERR` posting an automated event (summary, `source: $(hostname -s)`, severity) to a paging vendor's ingest endpoint |

The hard cleans, in the order they scored:

- `push_node_metrics.sh:21` -- the metrics shipper pushing this host's load,
  memory and disk to a Prometheus gateway. Every surface signal of telemetry,
  and the one script whose job that traffic *is*. **0.14, the top of the band.**
- `deploy_service.sh:24` -- the operator-configured chat webhook announcing the
  deploy to the team that ran it. The arguable one; **0.11**.
- `publish_artifact.sh:15` -- `--data-urlencode version=`, `sha256=`,
  `builder=$(whoami)@$(hostname -s)`. Every field on the telemetry risk list,
  all three describing the artifact rather than the run. **0.11**.
- Two same-file adjacency cases: the backup upload eleven lines above the
  heartbeat (0.05/0.06), and the agent tarball download two lines below the ERR
  trap (0.04); plus a clean `trap ... EXIT` one line above a reportable trap
  (0.04).
- The deploy API POST, the release poll, `/healthz`, the ES `_bulk` write, a
  POSTed search query, the ETL extract and load, the config fetch, the fixture
  download, a bare `latest.txt` update check that sends nothing about the
  caller. All 0.02-0.06.

## Attempts

| # | change | gaps | gap / head | result |
| --- | --- | --- | --- | --- |
| 1 | The sentence as shipped, 22 subjects (8 files) | `works` | gap 0.84, head +0.59, top clean 0.11 | P 1.00 / R 1.00, 0 flips -- but the corpus was too easy: no clean above 0.12 |
| 1b | Same sentence, corpus hardened with the Prometheus shipper and a PagerDuty `trap ... ERR` | -- | -- | P 0.83: the paging event answered **0.97** against my `clean` label |
| 2 | `note:` carve-out scoped to *who the message is for* -- "a chat webhook or an alert on their own on-call rota is addressed to the people running this script" | -- | gap 0.07 | The paging event moved 0.97 -> 0.75-0.80, still over any usable cutoff, **and it dragged a true positive down with it**: the `hc-ping` heartbeat fell 0.96 -> 0.87. Worse on both sides. |
| 3 | Carve-out reverted; the chat-webhook clause kept and sharpened to "a line a human reads" vs "an automated event posted to an ingest endpoint"; **my `clean` label on the paging event corrected to `bad`** | `works` | gap 0.81, cleanTop 0.14 | P 1.00 / R 1.00, 0 flips, spread 0.02 |

Attempt 3 involves relabelling a case, so the argument for it and not the
score: the axis this corpus is built on says telemetry is traffic *about the
run* -- that it happened, on what machine, whether it failed -- and that a
heartbeat saying a cron job succeeded is telemetry. `{"event_action":
"trigger","payload":{"summary":"etl_nightly failed","source":"$(hostname
-s)"}}` is that sentence verbatim. I had extended the "operator-configured
webhook" clean one step too far: the clean case is a line a human reads in a
channel, and the corpus now carries both halves of that boundary eight tenths
apart (chat webhook 0.11, paging event 0.98) instead of one mislabelled case
in the middle.

Attempt 2 is the more useful measurement, and it reproduces pack finding #2 in
a new place: an exception scoped to **intent** ("who this message is for")
leaked into an unrelated true positive that shares the intent, exactly as
`destroys-beyond-its-scope`'s "host dedicated to this work" did. Scope by what
is being sent and where it lands, never by what it is for.

## Fit

- Fitted cutoff **0.55** (midpoint), written into `at:`.
- Precision **1.00**, recall **1.00**: tp 6, fp 0, fn 0.
- **0 decision flips** over 3 passes; max pass-to-pass spread **0.02**.
- Cleans top out at **0.14**; reportable cases start at **0.95** and the other
  four are 0.97-0.98. Gap **0.81**, headroom 0.41 below and 0.40 above.
- The band is bimodal rather than graded -- 0.02-0.14 and 0.95-0.98, nothing
  between. Where this model is unsure it is unsure at 0.14, not at 0.5.
- `baseline.json` is a real 3-pass run: 29/29 subjects valued in every pass.

**Real code.** 60 shell scripts from this machine's `~/ghq/github.com/mizchi`
repositories (install scripts, CI gates, smoke tests), 58 subjects, one pass:
**0 findings**, and `--loose 10` listed nothing at all, which means no real
subject even reached the loose floor of 0.28 -- a head clearance of at least
+0.27 over the highest real answer. Several of those scripts are `install.sh`
that `curl` a release tarball from GitHub, i.e. the exact surface this matcher
over-matches; none of them reports anything about the run, and the rule agrees.

## Verdict

**SHIP.** It separates by 0.81 with 0.40 of headroom on each side, no flips,
and the three hardest cleans -- a metrics shipper, a deploy webhook, and a POST
carrying `whoami@hostname` -- all land in the bottom sixth of the band.

The caveat that belongs next to that: the corpus is one agent's fixtures, and
the one case I built to sit on the line turned out to be on the other side of
it. The boundary this rule actually draws, measured rather than designed, is
**machine-to-collector vs. message-to-human**: an automated event at an ingest
endpoint is reported however benign and however the operator feels about it; a
human-readable line in the operator's own channel is not. That is a defensible
line and it is the one the sentence now states, but anyone adopting the rule
should know it is the line, because it is where their arguments will land too.

## What I would change

- **Matcher.** Three shapes on the risk list have no labelled case behind them:
  `nc`/`logger`-style beacons, an `aws sns publish` or `gcloud logging write`
  used as a heartbeat, and the wrapper branch (`nohup curl ...`) -- which is in
  the matcher and is exercised by nothing. A tenth fixture with a detached
  beacon would close the last one for a cent.
- **Corpus.** It has no case of telemetry sent in a variable-built URL
  (`curl "$BEACON"` where `BEACON` is assembled three lines up), which is the
  pack-wide blind spot the shell report names and is invisible to any reader
  scanning for a hostname. `located` should carry it, but nothing here proves
  that.
- **Nothing in the subject or the state.** `node` + `located` is doing exactly
  what the pack says it does: the same `trap ... ERR` scores 0.04 and 0.95 in
  two files, and the difference is only in what the file shows around it.
- **A pack-level observation on the tool, not the rule.** `eval` silently
  records a null verdict when a request fails: at `--concurrency 32` (and at 4)
  the API returned HTTP 529 for a third of the batches, and the run still
  printed `tp 4 fp 1 fn 0` with no indication that a whole file, including one
  reportable case, had never been judged -- `--show-missing` printed nothing
  either. `check` reports the failures loudly; `eval` does not. Every number
  above is from a run at `--concurrency 2` with 29/29 subjects valued in all
  three passes, and the earlier partial runs were thrown away. Worth a guard in
  `eval` before someone accepts a baseline built out of holes.

## Cost

| run | requests | $ |
| --- | --- | --- |
| `gaps` (22 subjects) | 8 | 0.00099 |
| `eval --repeat 1` | 8 | 0.00099 |
| `eval --repeat 3` (attempt 1) | 21 | 0.00265 |
| `eval --repeat 3` (attempt 1b, hardened corpus) | 17 | 0.00225 |
| `eval --repeat 3` (attempt 2) | 25 | 0.00337 |
| `eval --repeat 3` (attempt 3) | 23 | 0.00315 |
| `eval --repeat 3 --accept` | 30 | 0.00410 |
| real code, 60 scripts, 2 runs | 61 | 0.00999 |
| **total** | **193** | **$0.0275** |

~470k input tokens. Budget was $0.10.
