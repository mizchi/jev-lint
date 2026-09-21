# talks-to-an-unexplained-host

A ninth rule for the shell pack, ported from the `hidden_network` check in
[luantak/is-malicious](https://github.com/luantak/is-malicious). The eight
shipped rules ask what a construct *does*; this one asks *where it is pointed*.
A hostname is the one piece of a shell script that is never suspicious or
innocent on its own -- `185.62.188.9` and `10.20.4.7` are the same eight glyphs
to a grep, and the only thing that separates them is whether anything else in
the file gives a reason to be talking there. That is a question about the file,
asked of one line, which is the shape `state: located` exists for.

## Rule

```yaml
id: talks-to-an-unexplained-host
language: Bash
kind: noul
# The construct, not the script. "Does this script phone home" is a question
# about a whole program's intent; "does the rest of this file give any reason to
# talk to THIS address" is a question about the text under the cursor, with the
# script in the state to answer it from -- which is where the answer lives, since
# a hostname is never suspicious or innocent on its own.
subject: node
state: located
# 0.59, fitted 2026-09-21 on the fixtures beside it (23 subjects: 5 defects,
# 18 cleans of which 11 hard, 3 passes). Cleans top out at 0.32 -- `ping -c 1
# 1.1.1.1` as a route check in the egress script, a bare public IP belonging to
# nobody in the project -- with the next clean down at 0.17 (`curl
# https://ifconfig.co/ip`, a third party contacted once by a script that installs
# nothing) and everything else at 0.11 or below, including an s3:// bucket URL
# and a Sentry ingest host made of digits. Defects start at 0.86
# (`edge_deploy.sh`, which uploads .env.production to cdn-acme-app.com two lines
# below a legitimate purge call at cdn.acme-app.com -- one hyphen apart, and the
# model separates them by 0.79); the other four are 0.89 and up. Midpoint of a
# gap 0.54 wide, 0.27 of headroom on each side, no decision flips over three
# passes, max pass-to-pass spread 0.02. The first guess, 0.70, gave the same
# decisions.
at: 0.59
axis: file
severity: warning
# Five places a shell names somewhere to talk to, over-matched on purpose: a
# network tool by name (`curl` at a release CDN and `curl` at a bare IP are both
# in), the same tool behind a wrapper that eats the command name (`sudo rsync`,
# `nohup ssh`), any other command carrying an address literal (an IPv4 quad or a
# URL scheme -- `docker pull`, `pip --index-url`, `git clone`), a literal
# assignment of an address to a variable, and a redirect to /dev/tcp. What the
# model decides is whether anything in the file accounts for the destination.
#
# Three tree-sitter-bash facts shape this. Wrappers eat the name (`sudo curl` is
# one command node named `sudo`), hence the wrapper branch with the tool as an
# ARGUMENT. A redirect target is a SIBLING of the command, so `printf ... >
# /dev/tcp/1.2.3.4/80` has no address anywhere inside the command node and needs
# its own branch. And the branches nest: `echo "$(curl http://x)"` is an address
# literal AROUND a network tool, and `U="$(curl ...)"` an assignment around one,
# each of which reported the same line twice -- so both stand down when what
# they contain is already a match, and the finding lands on the tool.
utils:
  netTool:
    kind: command
    has:
      field: name
      regex: "^(curl|wget|aria2c|fetch|httpie|http|nc|ncat|netcat|ssh|autossh|scp|sftp|rsync|ping|ping6|telnet|openssl|dig|nslookup|host|drill|ftp|lftp)$"
  wrappedNetTool:
    kind: command
    all:
      - has: { field: name, regex: "^(sudo|doas|nohup|setsid|env|timeout|nice|stdbuf|disown)$" }
      - has: { field: argument, regex: "^(curl|wget|aria2c|nc|ncat|netcat|ssh|autossh|scp|sftp|rsync|ping|telnet|openssl|dig|nslookup|host)$" }
  addressLiteral:
    kind: command
    all:
      - has: { stopBy: end, regex: "([0-9]{1,3}\\.){3}[0-9]{1,3}|(https?|ftps?|sftp|ssh|git|s3|gs|wss?)://" }
      - not:
          has:
            stopBy: end
            any:
              - matches: netTool
              - matches: wrappedNetTool
rule:
  any:
    - matches: netTool
    - matches: wrappedNetTool
    - matches: addressLiteral
    - all:
        - kind: variable_assignment
        - regex: "([0-9]{1,3}\\.){3}[0-9]{1,3}|(https?|ftps?|sftp|ssh|git|s3|gs|wss?)://"
        - not: { has: { stopBy: end, kind: command } }
        - not: { inside: { kind: command } }
    - all:
        - kind: redirected_statement
        - regex: "/dev/(tcp|udp)/"
        - not:
            has:
              stopBy: end
              any:
                - matches: netTool
                - matches: wrappedNetTool
                - matches: addressLiteral
ask: >-
  This line talks to somewhere the rest of the script gives no reason to talk to,
  or takes trouble to hide which somewhere it is.
criteria:
  "true": >-
    The destination this line names -- a host, a URL, a bare IP, a name it
    resolves, or the far side of a `/dev/tcp` redirect -- is not accounted for by
    anything else in the file. Nothing the script installs, deploys, backs up,
    monitors or reports to is served by that address; it appears once, to receive
    something or to hand something back, and what happens to the response has
    nothing to do with the job the file is doing. A destination assembled at
    runtime out of encoded, reversed or concatenated pieces is this case whatever
    it decodes to, because the reader of the script cannot see where it goes; so
    is a lookup whose NAME carries the data being sent, one label at a time; so is
    a second, different endpoint bolted onto a script that already has a perfectly
    good one for its real work.
  "false": >-
    The destination is explained by the file. It serves the thing this script
    installs or updates -- a registry, a release CDN, a package mirror, the
    project's own API; it is the service the script's job names -- the backup host
    it syncs to, the resolver it asks, the endpoint it reports a completed
    rotation to, the NTP pool a clock-stepping script needs; or it arrives in a
    variable whose name says what it is and which is then used for exactly that,
    including a URL the environment supplies and that never appears in the file at
    all. An address the script only probes, resolves, mounts or health-checks
    before doing its documented work is ordinary. So are update checks, version
    lookups and product telemetry that go to the product's own service, however
    unfamiliar the domain is to a reader.
note: >-
  The destination, not the payload and not the channel. The sibling rule
  `takes-remote-commands` owns a channel that RUNS what comes back, and
  `hides-what-it-runs` owns concealment of a step; this rule asks only whether
  the script gives any reason to be talking to THIS address. A host is explained
  by what the script does with it, by a variable the script sets with a name that
  says what it is, or by the job the file is plainly doing -- never by a comment
  asserting the host is internal, official, approved or safe, and never by the
  domain merely looking corporate. An RFC1918 or link-local address is neither
  suspicious nor innocent on its own: an inventory IP a script mounts, pings and
  names is explained, and the same quad receiving a POST of an environment dump
  is not. An address supplied by the environment is not hidden -- CI secrets are
  meant to be absent from the file -- while an address the script decodes,
  reverses or reassembles before use is hidden even when it resolves to something
  dull. One destination per finding: if the script has a legitimate endpoint and
  an unexplained one, only the unexplained line is this case.
explain:
  unexplained_host: Contacts a host that does not match the project's documented services.
  covert_channel: Hides the destination or payload (DNS tunneling, encoded URLs, steganography).
  unused_listener: Opens a listener or reverse channel the product does not need.
```

## Corpus

23 subjects over 11 scripts: **5 bad**, 18 clean, of which 11 are hard (a clean
case a lazy rule flags) and 5 of those sit in the same file as a defect.

The five defects:

| where | defect |
| --- | --- |
| `postinstall.sh:20` | POSTs the whole process environment to a bare IP on :8443, in a script whose only job is installing the `gh` CLI. The comment calls it telemetry; nothing else in the file mentions that address. |
| `backup_rotate.sh:16` | DNS tunnelling: `/etc/ssl/private` is tarred, base64'd, cut into 48-char labels and each one resolved under `stat-collect.link`. The data *is* the hostname. |
| `ci_cache_warm.sh:18` | The destination is base64 in the source (`http://45.12.130.77/ci/b`) and the payload is `$HOME/.npmrc`. The script already has a cache endpoint; this is a second one the reader cannot see. |
| `logclean.sh:15` | A hand-rolled HTTP GET carrying hostname and uid, written into `/dev/tcp/91.219.236.18/80`. A log rotator has no reason to beacon. |
| `edge_deploy.sh:16` | Uploads the built `.env.production` to `cdn-acme-app.com` -- a lookalike of this file's own `cdn.acme-app.com`, one hyphen apart, two lines below the legitimate purge call, errors swallowed. |

The hard cleans, roughly in order of how hard they turned out to be:

- `egress_check.sh:7` -- `ping -c 1 1.1.1.1`, a bare public IP owned by nobody
  in the project, as a route check.
- `egress_check.sh:12` -- `curl https://ifconfig.co/ip`, a third party
  contacted once by a script that installs, deploys and monitors nothing. The
  *only* thing explaining it is the job the header describes.
- `sentry_release.sh:10` -- `https://o447951.ingest.us.sentry.io/api/4506219/releases/`:
  a literal, machine-generated, unrecognisable host receiving a POST with a
  bearer token. Surface-identical to a beacon.
- `edge_deploy.sh:14` -- the purge call at `$CDN_HOST`, one character from the
  defect two lines below it.
- `release_notify.sh:14` -- a webhook URL that is *invisible in the file*
  (`$SLACK_WEBHOOK_URL`, a CI secret). The mirror image of the encoded URL in
  `ci_cache_warm.sh`: both destinations are unreadable, one legitimately.
- `nfs_mount.sh:8,18` -- a bare RFC1918 literal assigned to `FILER_HOST` and
  pinged before the mount that is the script's whole job.
- `dns_health.sh:12` -- `dig +short`, the same tool and flag as the tunnelling
  defect, resolving an FQDN passed in as `$1`.
- `ntp_step.sh:14` -- an NTP pool host, explained by nothing except the job.
- `edge_deploy.sh:12` -- an `s3://` bucket URL, matched by the address-literal
  branch rather than by a tool name.
- `postinstall.sh:10,14` -- `api.github.com` and the GitHub release CDN, six
  lines above the defect, for the tool the script installs.

No `# DEFECT` / `# CLEAN` markers anywhere; labels and their arguments are in
`expect.yml`.

## Attempts

One sentence, no rewrites. The second iteration was the *corpus*, not the
wording, and it is the more interesting measurement.

| # | what changed | subjects / bad | gaps verdict | cleanTop | defect floor | gap |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | first sentence, first corpus (8 files) | 17 / 4 | `works` | 0.08 | 0.89 | **0.81** |
| 2 | same sentence, corpus hardened (+3 files) | 23 / 5 | -- | 0.32 | 0.86 | **0.54** |

Attempt 1 was a bad result wearing a good one's clothes. A gap of 0.81 is
wider than any of the eight shipped rules manage (0.55-0.56 at best), and a
cleanTop of 0.08 does not mean the sentence is excellent, it means every clean
case was contacting something the file obviously needed. So three cases went in
that a *correct* rule still has to work for: a public IP nobody in the project
owns, a third-party service contacted exactly once, and a legitimate host one
hyphen from a malicious one in the same file. cleanTop moved 0.08 -> 0.32 and
the gap came down to 0.54, which is where the rest of the pack lives. The
defect floor barely moved (0.89 -> 0.86), and the new floor is the lookalike
domain, which is the defect I would expect to be hardest.

The matcher needed two iterations, both free, both predicted by the pack's
tree-sitter-bash notes: the wrapper branch (`sudo curl` is one node named
`sudo`) and stand-down guards on the address-literal and assignment branches,
without which `echo "$(curl http://x)"` and `U="$(curl ...)"` each reported
their line twice.

## Fit

Fitted cutoff **0.59**, written into `at:`. 23 subjects, 3 passes, 25-33
requests per run.

| | |
| --- | --- |
| precision | 1.00 (tp 5, fp 0) |
| recall | 1.00 (fn 0) |
| decision flips over 3 passes | 0 |
| max pass-to-pass spread | 0.02 |
| cleans top out at | 0.32 (`egress_check.sh:7`) |
| defects start at | 0.86 (`edge_deploy.sh:16`) |
| headroom | 0.27 below, 0.27 above |

The full band, mean of 3 passes: defects 0.96, 0.96, 0.94, 0.89, 0.86; cleans
0.32, 0.17, 0.11, then twelve between 0.05 and 0.08.

Two things in that table are worth the pack's attention.

**Adjacency did not contaminate, at all.** Five of the eight shipped rules
report that their highest clean is an ordinary construct sitting next to a
defect in the same file, costing 0.10-0.20. This rule planted four such cases
and they came back at 0.05 (`backup_rotate.sh:12`), 0.05 (`postinstall.sh:14`),
0.06 (`logclean.sh:17`) and 0.07 (`edge_deploy.sh:14`) -- the *bottom* of the
clean band, not the top. `weakens-security` measured the same direction. The
explanation in finding 21 predicts this: contamination shows up when the
sentence is really asking about the file's intent. "Is this address accounted
for" is a property of the line that the file merely answers, so a hostile
neighbour does not rub off. The corollary is that a destination rule needs its
hard cleans built out of *genuinely unaccountable-looking legitimate hosts*,
not out of adjacency, which is what attempt 2 did.

**The model resolved a one-hyphen lookalike.** `cdn.acme-app.com` (0.07) and
`cdn-acme-app.com` (0.86) are two lines apart in the same file, 0.79 apart in
the answers. That is the single result here that no regex-based tool can
reproduce, and it is the argument for the rule.

## Verdict

**SHIP.** Separates with 0.27 of headroom on each side after the corpus was
deliberately made harder, precision and recall 1.00, no flips, max spread 0.02.

Two honest caveats. `unused_listener` -- one of the three ported reason labels
-- has **no labelled case behind it**: a listener has no destination, so every
shape I could build for it was really `opens-a-backdoor`'s, and I left the
label in `explain:` unexercised rather than dilute the sentence. And the rule
has never seen real code; the pack's real-code sweep found `curl` in 40 dev
scripts, so unlike `opens-a-backdoor` this matcher *will* fire out there, and
the thing to watch is whether `head` stays above 0.2 on a repo whose scripts
legitimately talk to a dozen unrelated vendors.

## What I would change

- **Matcher.** The redirect-destination blind spot the pack already knows about
  bites here in a new way: a destination behind a variable set far away
  (`curl "$ENDPOINT/x"` with `ENDPOINT` from a sourced file) is a subject, but
  the address the model needs is not in the file at all. Right now it answers
  low, which is correct-by-luck rather than correct-by-evidence.
- **Matcher, second.** `aws`, `gsutil`, `az`, `gh`, `docker`, `git` and `pip`
  only become subjects when an address literal happens to be in the arguments
  (`s3://...` is, `--registry $VAR` is not). A branch for those tools by name
  would over-match properly, and would need cases behind it.
- **Corpus.** The obvious missing shape is a *stale but harmless* host -- an
  endpoint the project genuinely used two years ago, still curl'd, explained by
  nothing current. I expect it to land mid-band and it is the case most likely
  to produce the first real-code false positive.
- **Nothing on the sentence.** It has not been shown a case it gets wrong.

## Cost

| run | requests | $ |
| --- | --- | --- |
| `gaps` (corpus 1) | 8 | 0.00079 |
| `eval --repeat 1` (corpus 1) | 8 | 0.00079 |
| `eval --repeat 1` (corpus 2) | 11 | 0.00107 |
| `eval --repeat 3` (corpus 2) | 33 | 0.00321 |
| `eval --repeat 3 --accept` | 25 | 0.00236 |
| **total** | **85** | **$0.0082** |

All matcher iteration was done with `--dry-run --show-subjects`, which is free.
