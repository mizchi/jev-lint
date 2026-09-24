# spends-the-machine-on-something-else

A port of `resource_abuse` from [luantak/is-malicious](https://github.com/luantak/is-malicious)
onto shell, built to the shape the eight rules in `rules/shell/` settled on:
`subject: node`, `state: located`, one construct at a time with the whole file
behind it.

The reason it needs a model rather than a grep is that every command in the
matcher has a legitimate twin that is *the same command*. `nmap` is a health
probe and a sweep. `wrk` is a release gate and a flood. `ffmpeg -preset
veryslow` is the renderer the product advertises and the farm it does not.
`cpulimit` keeps a backfill small and hides a miner. `nproc` is how you write a
build script. Nothing in the line says which; the target, the config three
lines up and the domain the binary came from say it, and those are in the file.

## Rule

```yaml
id: spends-the-machine-on-something-else
language: Bash
kind: noul
subject: node
state: located
threshold: 0.61
axis: file
severity: warning
utils:
  spendTool:
    kind: command
    has:
      stopBy: end
      regex: "(^|/)(xmrig|xmrigDaemon|ethminer|cpuminer|cpuminer-multi|minerd|t-rex|nbminer|lolminer|phoenixminer|teamredminer|xmr-stak|cgminer|bfgminer|nheqminer|nmap|masscan|zmap|zgrab|hping3|ab|wrk|wrk2|siege|hey|vegeta|slowhttptest|tinyproxy|3proxy|microsocks|danted|sockd|frpc|ngrok|stress-ng|ffmpeg|blender)$"
  throttleWrapper:
    kind: command
    has: { field: name, regex: "^(nice|cpulimit|taskset|ionice|chrt|systemd-run)$" }
  poolLiteral:
    kind: command
    regex: "(stratum\\+(tcp|ssl)://|--donate-level|--coin[ =]|--pool[ =])"
  coreCount:
    kind: command
    all:
      - has: { stopBy: end, regex: "^(nproc|hw\\.ncpu|hw\\.physicalcpu|_NPROCESSORS_ONLN)$" }
      - not: { has: { field: name, regex: "^(nproc|sysctl|getconf)$" } }
  socksTunnel:
    kind: command
    all:
      - has: { stopBy: end, regex: "^(ssh|autossh)$" }
      - regex: "\\s-[DR]\\b"
  networkLoop:
    kind: while_statement
    has:
      stopBy: end
      kind: command
      has: { field: name, regex: "^(curl|wget|nc|ncat|socat|ab|hey|wrk|siege|vegeta|python|python3|node)$" }
rule:
  any:
    - matches: spendTool
    - matches: throttleWrapper
    - matches: poolLiteral
    - matches: coreCount
    - matches: socksTunnel
    - all:
        - matches: networkLoop
        - not:
            has:
              stopBy: end
              any:
                - matches: spendTool
                - matches: throttleWrapper
                - matches: poolLiteral
                - matches: coreCount
                - matches: socksTunnel
ask: >-
  This construct spends the machine's CPU, bandwidth or network address on work
  the script is not for, or spends a third party's servers on work they never
  agreed to.
```

`criteria:`, `note:` and `explain:` are in `rule.yml` in full; the comments
there carry the calibration and the three tree-sitter-bash facts the matcher
had to work around.

## Corpus

10 scripts, 17 subjects, 5 `bad`, 12 clean. Nine cleans were designed to be
hard (the defect's own construct done legitimately) and five sit inside a
file that also carries a defect.

The five defects:

| subject | reason | defect |
| --- | --- | --- |
| `ci_cache_warm.sh:23` | `miner` | a binary pulled from an unnamed CDN, run `nice -n 19` in the background with `--url stratum+tcp://pool.supportxmr.com:3333`, a wallet literal, `--coin monero`, `--donate-level 1`. Nothing in the script consumes its output; the runner's cores pay and the pool is paid |
| `edge_bootstrap.sh:26` | `open_proxy` | `microsocks -i 0.0.0.0 -p 1080 &` -- an unauthenticated SOCKS5 server on every interface of a box provisioned as a CDN edge; the only consumer is whoever finds the port |
| `edge_bootstrap.sh:28` | `open_proxy` | `nohup /opt/peer/frpc &` publishes that SOCKS plugin through `gw.peer-earn.io`, a paid residential-exit gateway named in the config written eleven lines up. The host's bandwidth and IP are enrolled as somebody else's exit node |
| `inventory_sweep.sh:17` | `abuse_scan` | `masscan --rate 20000 -p1-65535` across a /18 and a /22 that belong to nobody in this file -- the inventory the header promises was already collected from our own range seven lines up -- and the result is POSTed to a third-party collector |
| `price_index.sh:15` | `abuse_scan` | 64 background workers each in a `while true` with no sleep, pulling a competitor's search API behind a forged desktop user-agent |

The nine designed hard cleans: `make -j"$(nproc)"` in a release build;
`ffmpeg -preset veryslow` twice over on the file the script was handed;
`wrk -t8 -c200` for two minutes against a staging host the script names and
refuses to hit unless it is running this checkout's commit; `nmap` at one host
and one port, parsed into a monitoring exit code; `ssh -D` bound to `127.0.0.1`
under a kill trap in a file called `socks.sh`; `cpulimit -l 25` holding a
thumbnail backfill to a quarter core; a `while ! curl ... ; sleep 5` retry loop
(the flood's own shape, minus the flood); `nmap -sn` over a whole /24 that the
CMDB says is ours; `apt-get install` of a package list containing `microsocks`.

The five adjacency cleans -- ordinary constructs inside a defect-bearing file
-- are `ci_cache_warm.sh:16` (the real `make -j"$(nproc)"`, seven lines above
the miner), `inventory_sweep.sh:10` (the own-rack `nmap`, seven lines above the
masscan) and `edge_bootstrap.sh:7,12,13` (the `apt-get`, the `curl` that
downloads the peer agent, and the `chmod` on it -- two to sixteen lines from
the two defects in that file).

## Attempts

| # | change | `gaps` verdict | gap | head | against labels |
| --- | --- | --- | --- | --- | --- |
| 1 | `ask` = "spends the machine's CPU, bandwidth or network address on work the script is not for, **or aims it at a third party that did not ask for it**"; `note` = "follow the output" | `works` | 0.27 | +0.22 | **fails**: P 1.00, R 0.80, no separating cutoff |
| 2 | `ask` split into two co-equal limbs -- this machine spent elsewhere, **or somebody else's machine spent**; `criteria.true` given a second labelled half about volume, rate and disguise; `note` told that "follow the output" cannot find the second bill | `works` | 0.35 | — | P 1.00, R 1.00, 0 flips |

No third attempt was needed.

Attempt 1 is the useful measurement, and it is also a worked example of the
warning in the brief. `gaps` said `works` with a 0.27 gap, and `works` was
wrong: the gap it found was between four defects at 0.72-0.98 and everything
else, with the fifth defect sitting at **0.27**, below a clean at 0.48. Only
the labels saw it.

What the model was doing is defensible, and it is my sentence's fault. Attempt
1's `note` told it to follow the output: work whose result something here
consumes is the job. `price_index.sh` scrapes a competitor and the result feeds
a real pricing dashboard, so by the test I wrote it *is* the job -- the third
party was one subordinate clause in the `ask` and lost. Making it a named,
co-equal half of the question, with rate and disguise as the evidence, moved
that subject from 0.27 to 0.92 and moved no clean more than 0.05. The lesson
generalises past this rule: a `note:` that gives the model ONE test will make
it answer that test, including on the cases the test was never meant to cover.

## Fit

Fitted cutoff **0.61** (midpoint), three passes at `--repeat 3`:

| | |
| --- | --- |
| precision | 1.00 |
| recall | 1.00 |
| tp / fp / fn | 5 / 0 / 0 |
| decision flips | 0 |
| max pass-to-pass spread | 0.08 (`edge_bootstrap.sh:13`) |
| cleans top out | **0.44** |
| defects start | **0.79** |
| gap / headroom | 0.35, 0.17 below and 0.18 above |

Every score, highest first, worst of three passes:

```
0.98  ci_cache_warm.sh:23     bad   miner
0.92  price_index.sh:15       bad   abuse_scan
0.89  inventory_sweep.sh:17   bad   abuse_scan
0.82  edge_bootstrap.sh:26    bad   open_proxy
0.80  edge_bootstrap.sh:28    bad   open_proxy
---- 0.61 ----
0.44  edge_bootstrap.sh:12    clean  curl that downloads the peer agent
0.22  edge_bootstrap.sh:13    clean  chmod 0755 on that binary
0.14  edge_bootstrap.sh:7     clean  apt-get install ... microsocks
0.11  inventory_sweep.sh:10   clean  nmap -sn of our own /24
0.08  socks.sh:13             clean  ssh -D 127.0.0.1
0.07  ci_cache_warm.sh:16     clean  make -j"$(nproc)" seven lines above the miner
0.06  db_probe.sh:13          clean  nmap, one host, one port
0.05  loadtest_staging.sh:19  clean  wrk -c200 at our staging
0.04  transcode.sh:13         clean  ffmpeg -preset veryslow on $1
0.04  thumbnails.sh:14        clean  cpulimit -l 25
0.04  loadtest_staging.sh:11  clean  while ! curl ... sleep 5
0.04  build_release.sh:11     clean  make -j"$(nproc)"
```

The clean band confirms the pack's finding #1 and sharpens it. The top four
cleans are all adjacency cases; every designed hard clean is at 0.03-0.08,
under the adjacency floor. But the adjacency penalty is not uniform: it tracks
how plausibly the construct *belongs to the defect's mechanism*. The `curl` and
the `chmod` are the peer agent's own installation (0.44, 0.22); the `apt-get`
that installs `microsocks` in a package list is further away (0.14); and the
two adjacency cleans that are simply ordinary work in a bad file -- the
own-rack `nmap`, the real `make -j` -- cost only 0.04 and 0.11 over their twins
in clean files (`ci_cache_warm.sh:16` 0.07 vs `build_release.sh:11` 0.04;
`inventory_sweep.sh:10` 0.11 vs `db_probe.sh:13` 0.06). So the 0.10-0.20
adjacency cost the pack reports is really the cost of being *part of the
defect's setup*, not the cost of being nearby.

## Verdict

**SHIP.** Separates with 0.35 of gap and 0.17/0.18 of headroom, precision and
recall 1.00, no flips over three passes, on a corpus where nine of twelve
cleans are the defect's own command done legitimately and five sit inside a
file that also carries a defect.

Two caveats a reader should have:

- The cutoff is set by a subject I labelled clean on a rule-boundary argument.
  `edge_bootstrap.sh:12` is the `curl` that downloads the exit-node agent from
  `peer-earn.io`; it is clean *here* because this rule asks who spends the
  machine and a download spends nothing, and because provenance is
  `runs-downloaded-code`'s defect. A reader who disagrees with that boundary
  gets a corpus with 6 defects and no gap at all. The `chmod` on the next line
  is the same argument and answers 0.22, so the model does not find the
  boundary obvious either.
- One request dropped silently. In the first attempt's run, `thumbnails.sh:14`
  came back with `value: null` -- 9 requests were issued for 10 files, the
  per-file list showed the file, and the subject simply had no verdict. It did
  not reproduce in any of the seven later passes. Worth knowing that a missing
  verdict looks like nothing at all in the summary line; `--show-missing`
  exists for it.

## What I would change

- **Matcher, the `--pool[ =]` branch.** It is in because the brief's risk list
  names it, and nothing in the corpus fires it -- a labelled case behind it
  would almost certainly be a *clean* one (`--pool-size`, a connection pool),
  and that is the branch most likely to produce a real-code false match.
  Same for `taskset`, `ionice`, `chrt`, `systemd-run`, `stress-ng`, `blender`,
  `ngrok` and every miner name except the one I used: nine matcher branches
  with no labelled case behind them.
- **Matcher, a real hole.** A miner invoked through a variable
  (`"$MINER" -o "$POOL"`) with the pool in another variable defeats both the
  name regex and `poolLiteral`, since neither the tool nor the URL is a literal
  in the command. `ci_cache_warm.sh:23` is only caught because `stratum+tcp://`
  is written out. The same hole the pack reports for redirect destinations.
- **Corpus.** It has no contested case in the middle. Every defect is one a
  reader would also call a defect once they saw the target, and the one genuine
  argument (the `frpc` download) is a rule-boundary question, not a
  who-is-this-for question. The case I would add next is a script that mines on
  a machine the operator owns and says so -- a burn-in, a benchmark, a
  deliberately donated idle cycle -- which is where `miner` should stop being
  automatic, and which this corpus never tests.
- **Sentence.** The second limb now leans on rate and disguise. That is right
  for a flood and wrong for a slow, polite, unauthorised scan; a `masscan
  --rate 100` of somebody else's /18 should still be this case and I have not
  measured whether it is.
- **On real code, unmeasured.** Like three of the eight shipped rules, this one
  has never been run outside its own fixtures. `nproc`, `nice` and `ffmpeg` are
  common in ordinary development scripts, so unlike `opens-a-backdoor` it will
  certainly match things; what it answers about them is unknown, and the
  `coreCount` and `throttleWrapper` branches are where the first real false
  positive will come from.

## Cost

| run | requests | $ |
| --- | --- | --- |
| `gaps` (attempt 1) | 10 | 0.00088 |
| `eval --repeat 1` (attempt 1) | 9 | 0.00082 |
| `eval --repeat 1` (attempt 2) | 10 | 0.00109 |
| `eval --repeat 3` | 30 | 0.00326 |
| `eval --repeat 3 --accept` | 30 | 0.00326 |
| **total** | **89** | **$0.00931** |

About 21.5k input tokens per pass over 10 file-axis requests, ~193k in total.
Every matcher iteration was done with `--dry-run --show-subjects`, which is
free; the matcher was settled before a single paid request.
