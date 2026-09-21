# `says-one-thing-does-another` -- shell

A port of the `deception` check from
[luantak/is-malicious](https://github.com/luantak/is-malicious). It is the one
rule in the shell pack on jev-lint's home ground: the other eight ask what a
line does TO the machine, this one asks whether what the script SAYS matches
what it does -- the same axis as `comment-describes-declaration` and
`fn-name-promises`. The subject is the claim (a line of output a person reads,
a prompt a person answers, a banner a person believes) and `state: located`
supplies the code that either honours it or contradicts it two lines down.

## Rule

The final YAML is `rule.yml` beside this file; it is complete and loads with
0 errors. The parts that matter:

- `language: Bash`, `subject: node`, `state: located`, `axis: file`,
  `severity: warning`, `at: 0.72`.
- Matcher, five branches, over-matching the surface deliberately: `echo` /
  `printf` (minus bare `echo`, minus anything inside a command substitution,
  minus anything redirected into a file -- `>&2` deliberately kept, because
  stderr is where a script talks to a person); `read` in any form; a
  `redirected_statement` carrying a `heredoc_redirect`; a `case_statement` on a
  yes/no answer; and the desktop dialog toolkits (`zenity`, `whiptail`,
  `osascript`, ...) found through `has: { stopBy: end }` so a `sudo osascript`
  wrapper is not lost to the `sudo` command name.
- `ask:` "This line tells the person running the script something that the rest
  of the file contradicts."
- `explain:` carries the source project's three labels verbatim:
  `impersonation`, `fake_consent`, `bait_and_switch`.

## Corpus

10 scripts, 12-28 lines each, no `# DEFECT` / `# CLEAN` markers anywhere.
**41 subjects found: 8 bad, 33 clean, 12 of them hard.** Every defect has a
designed legitimate twin somewhere in the clean band -- in five cases the twin
is the same construct with the same or nearly the same words.

The eight defects:

| subject | the defect |
| --- | --- |
| `diagnostics_bundle.sh:18` | `echo "Everything stays on this machine -- nothing is uploaded."` on the line directly above the `curl -X POST --data-binary "@$BUNDLE"` that uploads it |
| `config_doctor.sh:13` | `This is a read-only check; your config will not be modified` immediately above two `yq -i` in-place edits that turn telemetry on and repoint the registry |
| `security_update.sh:11` | a heredoc banner in the voice of `Apple Software Update` announcing a macOS release, printed by a vendor's own agent script |
| `security_update.sh:18` | `read -r -s -p "Password for $USER: "` collected under that banner; the script never runs `sudo` -- it writes the password to `/tmp/.su-stage/.k` and POSTs it with the hostname |
| `free_space.sh:7` | `Cleaning temporary files and build caches...` above `rm -rf` of `~/Documents/*.pdf`, `~/Desktop/*.key`, `~/.ssh/id_*` and `~/.aws/credentials` |
| `setup_wizard.sh:12` | `Send anonymous usage statistics...? [y/N]` -- line 17 appends `telemetry = true` whatever the answer was |
| `setup_wizard.sh:13` | the `case` on that answer: both branches fall through to the same unconditional write, so the prompt is decoration |
| `setup_wizard.sh:15` | `No problem -- telemetry stays off.` is what a person who declined sees, two lines above the config that says otherwise |

The hard cleans, and what each one is the twin of:

| subject | score | twin of |
| --- | --- | --- |
| `purge_caches.sh:7` | 0.13 | `free_space.sh:7` -- the IDENTICAL sentence over `.cache/build`, `node_modules/.vite`, a `$TMPDIR` glob and `*.tsbuildinfo` |
| `restore_db.sh:17` | 0.08 | `diagnostics_bundle.sh:18` -- `nothing was changed`, on the path where the script exits before doing anything |
| `restore_db.sh:21` | 0.08 | `security_update.sh:18` -- `read -r -s -p` for the password, used four lines later by the psql the prompt named, `unset` after |
| `restore_db.sh:9` | 0.26 | `security_update.sh:11` -- a heredoc in capitals warning every table will be dropped. Alarming, and true |
| `preflight_docker.sh:6` | 0.08 | `security_update.sh:11` -- a heredoc that names Docker, Docker Desktop and Docker, Inc. and links docker.com. Naming a vendor truthfully is the opposite of impersonation |
| `uninstall_agent.sh:7` | 0.31 | `setup_wizard.sh:12` -- a `[y/N]` prompt whose answer really decides |
| `uninstall_agent.sh:8` | 0.08 | `setup_wizard.sh:13` -- the same `case`, with a real `exit 0` in the refusal branch |
| `uninstall_agent.sh:10` | 0.12 | `setup_wizard.sh:15` -- `Cancelled; nothing was removed.` followed by `exit 0`, so it is true |
| `bootstrap.sh:7` | 0.05 | intent-not-mechanism: `Preparing the workspace...` for a `mkdir` and a submodule checkout |
| `bootstrap.sh:11` | 0.04 | the terse accurate progress message this rule exists not to flag |
| `free_space.sh:12` | **0.53** | an accurate `printf 'Freed %s MB'` five lines under a defect in the same file |
| `setup_wizard.sh:14` | **0.57** | `Thanks! Telemetry enabled.` -- true, and the honest branch of a sham prompt, one line from two defects |

Eight more cleans sit inside a file that also contains a defect
(`diagnostics_bundle.sh:10,17`, `config_doctor.sh:7,9,17`,
`security_update.sh:8,23`, `setup_wizard.sh:8,20`). Seven of them read 0.06-0.19.

## Attempts

Two attempts. Both used the same subject, state and matcher; only the sentence
moved.

| # | change | verdict | gap | cleanTop | defect floor | head at `at` |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `ask:` as shipped; criteria listing five deception shapes; `note:` with a one-line anti-contamination clause | `gaps`: **works**, gap 0.27, suggest 0.73, head +0.11 -- but the labels say otherwise | 0.03 (single pass) | 0.54 | 0.57 | +0.01 |
| 2 | criteria: a prompt is read together with the text that sets it up, so a bland `read -s` under a false banner inherits the banner's claim. `note:`: an explicit split between the neighbours' character (not evidence) and the setup of the same interaction (evidence) | -- | **0.27** | 0.57 | 0.84 | +0.15 |

Attempt 1 is the reason the procedure says to run `eval` after `gaps`. `gaps`
returned **works** with a gap of 0.27 and a suggested cutoff of 0.73, which
looks like a finished rule. The gap it found was *inside the defect band*: seven
defects sat at 0.82-0.97 and the eighth -- the fake sudo prompt -- sat at 0.57,
one point above the top clean at 0.54. A second independent pass of the same
rule moved that defect to 0.53 and the top clean to 0.55, i.e. attempt 1 does
not separate at all. Only the labels showed it.

The model was not wrong in attempt 1. `read -r -s -p "Password for $USER: "` is
a bland line; all of the impersonation was in the heredoc three lines above,
which scored 0.94. The fix was to say in the criteria that a prompt inherits
the claim of the text it is asked under. That moved the laggard from 0.57 to
0.84 and left the rest of the band where it was.

I did not use the third attempt. The two contaminated cleans (0.53, 0.57) did
not move when the `note:` was strengthened against exactly that, and a third
edit in that direction had a real chance of dragging the defect band down with
them -- attempt 1→2 moved one subject by 0.27, so these edits are not gentle.

**No fixture was changed after seeing a score.** The corpus is as it was
written before the first paid run.

## Fit

Accepted baseline, 3 passes, 41 subjects:

- **fitted cutoff (midpoint): 0.70. Written into `at:`: 0.72.**
- precision **1.00**, recall **1.00**, tp **8**, fp **0**, fn **0**
- decision flips across the three passes: **0**
- clean band tops out at **0.57** (mean); defects start at **0.84** (mean)
- gap **0.27** wide; at 0.72 that is +0.15 over the highest clean and -0.12
  under the lowest defect
- on single passes rather than means: best clean answer **0.62**, worst defect
  answer **0.83** -- +0.10 and -0.11 around 0.72
- max spread: **0.10** on the clean side (all of it on `setup_wizard.sh:14`),
  **0.03** on the defect side. The clean side is the unstable one here, which
  is why 0.72 rather than the 0.70 midpoint.

Everything below the top two cleans is at 0.31 or under; 30 of 33 cleans are at
0.19 or under, and the four ordinary progress messages in `bootstrap.sh` read
0.04-0.13.

## Verdict

**SHIP.** It separates with 0.27 of gap and no flips, on a corpus where five of
the eight defects have a twin using the same construct and in two cases the
same words, and those twins land 0.7 below their defects.

Two honest caveats. (1) The cutoff is the pack's highest and is set entirely by
finding 1 of the pack report -- two accurate lines sitting in a file that also
contains a defect. Remove those two subjects and cleanTop drops to 0.31 and the
rule would fit at 0.57 with twice the headroom; that would be the overstated
number, not the real one. (2) `setup_wizard.sh:14` answered 0.62 on one of
three passes. It is the only subject in the corpus with a plausible path to the
cutoff, and if this rule ever produces a false positive, that is its shape: a
true sentence in a dishonest file.

## What I would change

- **Real code, before anyone trusts 0.72.** This matcher fires on every
  user-facing `echo`, so on the 40-script real-code corpus the pack already
  used it would match by far the most subjects of any rule in the pack -- an
  order of magnitude more than `hides-what-it-runs`'s 132. That run is the one
  that would actually price the cutoff, and I did not have it. Everything above
  is fixtures.
- **The matcher's blind spot is a claim in a variable.**
  `MSG="nothing is uploaded"; echo "$MSG"` is matched (the `echo` is the
  subject) but the subject text says nothing, and `located` has to supply the
  whole claim. Worse, a message built in a function and called from ten places
  is judged once per `echo` inside the function, not per call site.
- **`case_statement` earns its branch but only just.** One labelled defect and
  one labelled clean stand behind it. The regex (`[yY])`, `[yY]`, ...) will miss
  a `case` on `$REPLY` with locale-specific answers, and it fires on any case
  whose patterns happen to start with y or n.
- **Untested matcher branches:** `zenity`, `whiptail`, `dialog`, `kdialog`,
  `osascript`, `notify-send` and `xmessage` have no labelled case behind them at
  all. They were included because the source project's `fake_consent` label is
  about dialogs, but nothing here measures them. Someone should add a
  `osascript -e 'display dialog ...'` fake-authorisation fixture before
  claiming that branch works.
- **`explain:` does not partition this corpus cleanly** -- the same complaint
  two other rules in the pack made. `security_update.sh:11` is
  `impersonation` AND `fake_consent`; `free_space.sh:7` is `bait_and_switch`
  but so, arguably, is `config_doctor.sh:13`. The labels were ported verbatim as
  instructed and I would not defend them as a partition.
- **The `>&2` carve-out is a guess I did not measure.** I excluded
  `echo ... > file` from the matcher on the reasoning that writing config is not
  addressing anyone, and kept `>&2`. Three cleans depend on the `>&2` half
  (`config_doctor.sh:9`, `preflight_docker.sh:16`, `restore_db.sh:17`, all
  0.07-0.09) but nothing tests the exclusion, and a script that writes a
  user-facing report to a log file with `echo >> "$REPORT"` is now invisible to
  this rule. `hides-what-it-runs` has a defect of exactly that shape.

## Cost

| run | requests | $ |
| --- | --- | --- |
| `check --dry-run` x2 | 0 | 0.00000 |
| `gaps` (attempt 1) | 10 | 0.00183 |
| `eval --repeat 1` (attempt 1, partial -- 6 of 10 files returned null) | 4 | 0.00088 |
| `eval --repeat 1` (attempt 1, complete) | 10 | 0.00183 |
| `eval --repeat 1` (attempt 1, second pass -- showed it does not separate) | 10 | 0.00183 |
| `eval --repeat 1` (attempt 2) | 10 | 0.00214 |
| `eval --repeat 3` (attempt 2) | 30 | 0.00642 |
| `eval --repeat 3 --accept` x6, of which 5 returned partial or total nulls | 102 | 0.02184 |
| `eval --replay` x3 | 0 | 0.00000 |
| **total** | **176** | **~$0.037** |

About 40% of that is the null-answer retries the updated BRIEF warns about, and
the warning is right: a run that returns `0 request(s), $0.00000` writes a
baseline of 123 nulls, and the next `--replay` reports "all as shipped" with
tp/fp/fn all zero over it. It is not only `--cache none` and it is not only
`--accept`: I saw it on `--repeat 1` and `--repeat 3`, with and without a
cache, roughly one run in two during one stretch, and also in the partial form
(6 of 10 files null, 4 answered, exit 0, a plausible-looking table printed from
the 4). The only reliable check is counting nulls in the JSON. A partial run
also produces a *wrong* table rather than an empty one, which is the dangerous
version.
